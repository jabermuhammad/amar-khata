import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, useColorScheme } from 'react-native';
import type { StorageScope, ThemePreferences } from '../lib/localStorage';
import { readThemePreferences, storageScopeId, writeThemePreferences } from '../lib/localStorage';
import type { ThemeMode } from '../lib/themePolicy.mjs';
import { resolveTheme } from '../lib/themePolicy.mjs';
import { useAuth } from './AuthContext';

type ThemeContextValue = {
  theme: 'light' | 'dark';
  mode: ThemeMode;
  preferences: ThemePreferences;
  ready: boolean;
  setMode: (mode: ThemeMode) => Promise<void>;
  setSchedule: (lightAt: string, darkAt: string) => Promise<void>;
};
const defaults: ThemePreferences = { mode: 'dark', lightAt: '06:00', darkAt: '18:00' };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: React.PropsWithChildren) {
  const { scope } = useAuth();
  const scopeId = scope ? storageScopeId(scope) : 'unscoped';
  const systemScheme = useColorScheme();
  const [loaded, setLoaded] = useState<{ scopeId: string; value: ThemePreferences } | null>(null);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    let active = true;
    if (!scope) return () => { active = false; };
    readThemePreferences(scope).then(value => { if (active) setLoaded({ scopeId, value }); }).catch(() => {
      if (active) setLoaded({ scopeId, value: defaults });
    });
    return () => { active = false; };
  }, [scope, scopeId]);

  useEffect(() => {
    const tick = () => setClock(new Date());
    const timer = setInterval(tick, 30_000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') tick(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, []);

  const preferences = loaded?.scopeId === scopeId ? loaded.value : defaults;
  const ready = !scope || loaded?.scopeId === scopeId;
  const theme = resolveTheme(preferences.mode, systemScheme, clock, preferences.lightAt, preferences.darkAt);
  const persist = useCallback(async (next: ThemePreferences) => {
    const ownerScope: StorageScope | null = scope;
    const ownerScopeId = scopeId;
    setLoaded({ scopeId: ownerScopeId, value: next });
    if (ownerScope) {
      try { await writeThemePreferences(ownerScope, next); }
      catch (error) {
        setLoaded(current => current?.scopeId === ownerScopeId ? { scopeId: ownerScopeId, value: preferences } : current);
        throw error;
      }
    }
  }, [scope, scopeId, preferences]);
  const value = useMemo<ThemeContextValue>(() => ({
    theme, mode: preferences.mode, preferences, ready,
    setMode: mode => persist({ ...preferences, mode }),
    setSchedule: (lightAt, darkAt) => persist({ ...preferences, mode: 'scheduled', lightAt, darkAt }),
  }), [theme, preferences, ready, persist]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
