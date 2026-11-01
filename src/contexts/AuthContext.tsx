import { onIdTokenChanged, type User } from 'firebase/auth';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { auth, firebaseConfigured } from '../lib/firebase';

type AuthState = { user: User | null; loading: boolean; configured: boolean };
const AuthContext = createContext<AuthState>({ user: null, loading: true, configured: false });

export function AuthProvider({ children }: React.PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseConfigured);
  useEffect(() => {
    if (!auth) return;
    return onIdTokenChanged(auth, value => { setUser(value); setLoading(false); });
  }, []);
  const value = useMemo(() => ({ user, loading, configured: firebaseConfigured }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
