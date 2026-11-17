import { Stack, useRouter, useSegments } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { AppUpdateProvider } from '../contexts/AppUpdateContext';
import AppUpdateBanner from '../components/AppUpdateBanner';
import AppBottomNav from '../components/AppBottomNav';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import { flushPendingCloudChanges } from '../lib/collaboration';
import { setCloudNetworkAvailable } from '../lib/cloudSync';
import { isInternetAvailable } from '../lib/networkPolicy.mjs';

// Keep Android's native splash visible until auth routing is ready.
void SplashScreen.preventAutoHideAsync();

function RouteGuard({ fontsReady }: { fontsReady: boolean }) {
  const { user, loading, mode } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const { theme } = useTheme();
  const onAuth = segments[0] === 'auth';
  const routeReady = fontsReady && !loading && (mode === 'none' ? onAuth : true);
  useEffect(() => {
    if (loading || mode === 'loading') return;
    if (mode === 'none' && !onAuth) router.replace('/auth');
    else if (user && onAuth) router.replace('/');
  }, [loading, mode, onAuth, router, user]);
  useEffect(() => {
    if (routeReady) void SplashScreen.hideAsync();
  }, [routeReady]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    let running = false;
    let online = false;
    const sync = async () => {
      if (!active || !online || running) return;
      running = true;
      try { await flushPendingCloudChanges(user); } catch { /* Persisted outbox retries on resume or next foreground pass. */ }
      finally { running = false; }
    };
    const updateNetwork = (state: Network.NetworkState) => {
      online = isInternetAvailable(state);
      setCloudNetworkAvailable(online);
      if (online) void sync();
    };
    const networkListener = Network.addNetworkStateListener(updateNetwork);
    void Network.getNetworkStateAsync().then(updateNetwork).catch(() => updateNetwork({ isConnected: false, isInternetReachable: false, type: Network.NetworkStateType.UNKNOWN }));
    const stateListener = AppState.addEventListener('change', state => { if (state === 'active') void sync(); });
    // Fallback retry is limited to an active app with confirmed connectivity.
    const timer = setInterval(() => { if (online && AppState.currentState === 'active') void sync(); }, 30_000);
    return () => { active = false; online = false; setCloudNetworkAvailable(false); networkListener.remove(); stateListener.remove(); clearInterval(timer); };
  }, [user]);
  if (!fontsReady || loading || mode === 'loading') return null;
  return <><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme === 'dark' ? '#0c1117' : '#fafaf7' } }} /><AppBottomNav /><AppUpdateBanner /></>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts([{
    fontFamily: 'UN Bangla',
    fontDefinitions: [
      { path: require('../../assets/fonts/UNBangla-Thin.ttf'), weight: 100 },
      { path: require('../../assets/fonts/UNBangla-Regular.ttf'), weight: 400 },
      { path: require('../../assets/fonts/UNBangla-Bold.ttf'), weight: 700 },
    ],
  }]);
  const fontsReady = fontsLoaded || Boolean(fontError);
  return <AuthProvider><ThemeProvider><AppUpdateProvider><ThemedStatusBar /><RouteGuard fontsReady={fontsReady} /></AppUpdateProvider></ThemeProvider></AuthProvider>;
}

function ThemedStatusBar() {
  const { theme } = useTheme();
  return <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />;
}
