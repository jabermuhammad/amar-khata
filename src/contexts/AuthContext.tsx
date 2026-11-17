import { onIdTokenChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { StorageScope } from '../lib/localStorage';
import {
  accountScopeFor, clearPendingGuestImport, clearSessionMode, getInstallationId, getPendingGuestImport,
  getSessionMode, guestScopeFor, importLegacyDataToGuest, markGuestImportPending, setSessionMode,
} from '../lib/localStorage';
import { auth, firebaseConfigured } from '../lib/firebase';
import { shouldApplyAuthSnapshot, shouldInvalidateAuthScope } from '../lib/authSessionPolicy.mjs';

export type SessionMode = 'loading' | 'none' | 'guest' | 'account';
type AuthState = {
  user: User | null;
  loading: boolean;
  configured: boolean;
  mode: SessionMode;
  scope: StorageScope | null;
  guestScope: StorageScope | null;
  pendingGuestImport: string | null;
  continueAsGuest: (importLegacy: boolean) => Promise<void>;
  beginAccountAuth: () => Promise<void>;
  signOutAccount: () => Promise<void>;
  dismissGuestImport: () => Promise<void>;
};

const emptyState: AuthState = {
  user: null, loading: true, configured: false, mode: 'loading', scope: null, guestScope: null,
  pendingGuestImport: null,
  continueAsGuest: async () => {}, beginAccountAuth: async () => {}, signOutAccount: async () => {}, dismissGuestImport: async () => {},
};
const AuthContext = createContext<AuthState>(emptyState);

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<SessionMode>('loading');
  const [scope, setScope] = useState<StorageScope | null>(null);
  const [guestScope, setGuestScope] = useState<StorageScope | null>(null);
  const [pendingGuestImport, setPendingGuestImport] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const authGeneration = useRef(0);
  const resolvedAuthUid = useRef<string | null | undefined>(undefined);
  const transitionIntent = useRef<'guest' | 'none' | null>(null);
  const sessionWrite = useRef<Promise<void>>(Promise.resolve());

  const persistSession = useCallback((generation: number, value: string | null) => {
    const next = sessionWrite.current.catch(() => {}).then(async () => {
      if (generation !== authGeneration.current) return;
      if (value === null) await clearSessionMode();
      else await setSessionMode(value);
    });
    sessionWrite.current = next;
    return next;
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const installationId = await getInstallationId();
        const localGuestScope = guestScopeFor(installationId);
        if (!active) return;
        setGuestScope(localGuestScope);
        if (!auth) {
          const savedMode = await getSessionMode();
          if (!active) return;
          const isGuest = savedMode === 'guest';
          setMode(isGuest ? 'guest' : 'none');
          setScope(isGuest ? localGuestScope : null);
          setLoading(false);
          return;
        }
        unsubscribe = onIdTokenChanged(auth, currentUser => {
          const eventUid = currentUser?.uid ?? null;
          // Ignore late snapshots from an account that is no longer active,
          // and token callbacks during an explicit Guest/logout transition.
          if (eventUid !== (auth?.currentUser?.uid ?? null)) return;
          if (transitionIntent.current) return;
          const eventId = ++authGeneration.current;
          if (shouldInvalidateAuthScope({ activeUid: resolvedAuthUid.current, eventUid })) {
            // Remove the prior account's visible scope synchronously before
            // any AsyncStorage work for the incoming session begins.
            setUser(null);
            setScope(null);
            setPendingGuestImport(null);
            setMode('loading');
            setLoading(true);
          }
          void (async () => {
            if (!active) return;
            if (!shouldApplyAuthSnapshot({ eventGeneration: eventId, currentGeneration: authGeneration.current, eventUid, currentUid: auth?.currentUser?.uid ?? null, transitionIntent: transitionIntent.current })) return;
            if (currentUser) {
              const pendingGuestId = await getPendingGuestImport();
              if (!active || !shouldApplyAuthSnapshot({ eventGeneration: eventId, currentGeneration: authGeneration.current, eventUid, currentUid: auth?.currentUser?.uid ?? null, transitionIntent: transitionIntent.current })) return;
              setUser(currentUser);
              setMode('account');
              setScope(accountScopeFor(currentUser.uid));
              resolvedAuthUid.current = currentUser.uid;
              setPendingGuestImport(pendingGuestId);
              void persistSession(eventId, `account:${currentUser.uid}`).catch(() => {});
            } else {
              const savedMode = await getSessionMode();
              if (!active || !shouldApplyAuthSnapshot({ eventGeneration: eventId, currentGeneration: authGeneration.current, eventUid, currentUid: auth?.currentUser?.uid ?? null, transitionIntent: transitionIntent.current })) return;
              const isGuest = savedMode === 'guest';
              setUser(null);
              setMode(isGuest ? 'guest' : 'none');
              setScope(isGuest ? localGuestScope : null);
              setPendingGuestImport(null);
              resolvedAuthUid.current = null;
              transitionIntent.current = null;
            }
            setLoading(false);
          })().catch(() => {
            if (!active || eventId !== authGeneration.current) return;
            setUser(null);
            setScope(null);
            setPendingGuestImport(null);
            setMode('none');
            setLoading(false);
          });
        });
      } catch {
        if (active) { setMode('none'); setScope(null); setLoading(false); }
      }
    })();
    return () => { active = false; unsubscribe?.(); };
  }, [persistSession]);

  const continueAsGuest = useCallback(async (importLegacy: boolean) => {
    const generation = ++authGeneration.current;
    transitionIntent.current = 'guest';
    setUser(null); setScope(null); setMode('loading'); setLoading(true);
    let guest: StorageScope | null = null;
    try {
      const id = await getInstallationId();
      guest = guestScopeFor(id);
      // Persist Guest intent before sign-out so the null auth callback restores
      // this scope even if it races the explicit transition.
      await persistSession(generation, 'guest');
      if (auth?.currentUser) await firebaseSignOut(auth);
      if (auth?.currentUser) throw new Error('Firebase account থেকে নিরাপদে বের হওয়া যায়নি; Guest scope চালু করা হয়নি।');
      setUser(null); setScope(guest); setGuestScope(guest); setMode('guest'); setLoading(false); setPendingGuestImport(null); resolvedAuthUid.current = null;
      transitionIntent.current = null;
    } catch (error) {
      transitionIntent.current = null;
      const current = auth?.currentUser ?? null;
      const recoveryGeneration = ++authGeneration.current;
      if (current) {
        setUser(current); setScope(accountScopeFor(current.uid)); setMode('account');
        void persistSession(recoveryGeneration, `account:${current.uid}`).catch(() => {});
      } else { setUser(null); setScope(null); setMode('none'); }
      setLoading(false);
      throw error;
    }
    if (importLegacy && guest) await importLegacyDataToGuest(guest);
  }, [persistSession]);

  const beginAccountAuth = useCallback(async () => {
    if (mode === 'guest' && scope?.kind === 'guest') await markGuestImportPending(scope);
  }, [mode, scope]);

  const signOutAccount = useCallback(async () => {
    const generation = ++authGeneration.current;
    transitionIntent.current = 'none';
    setUser(null); setMode('none'); setScope(null); setLoading(true);
    try {
      await persistSession(generation, null);
      // Keep a pending Guest ID so a later verified sign-in can explicitly resume
      // the selected migration; no data is uploaded automatically.
      const hadGoogleProvider = auth?.currentUser?.providerData.some(provider => provider.providerId === 'google.com') ?? false;
      if (auth) await firebaseSignOut(auth);
      if (hadGoogleProvider) {
        try {
          const { GoogleOneTapSignIn } = await import('react-native-nitro-google-signin');
          await GoogleOneTapSignIn.signOut();
        } catch {
          // Firebase is already signed out; this is best-effort native account-picker cleanup.
        }
      }
      setUser(null); setLoading(false); resolvedAuthUid.current = null;
      transitionIntent.current = null;
    } catch (error) {
      transitionIntent.current = null;
      const current = auth?.currentUser ?? null;
      const recoveryGeneration = ++authGeneration.current;
      if (current) {
        setUser(current); setScope(accountScopeFor(current.uid)); setMode('account');
        void persistSession(recoveryGeneration, `account:${current.uid}`).catch(() => {});
      }
      setLoading(false);
      throw error;
    }
  }, [persistSession]);

  const dismissGuestImport = useCallback(async () => {
    await clearPendingGuestImport();
    setPendingGuestImport(null);
  }, []);

  const value = useMemo(() => ({
    user, loading, configured: firebaseConfigured, mode, scope, guestScope, pendingGuestImport,
    continueAsGuest, beginAccountAuth, signOutAccount, dismissGuestImport,
  }), [user, loading, mode, scope, guestScope, pendingGuestImport, continueAsGuest, beginAccountAuth, signOutAccount, dismissGuestImport]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
