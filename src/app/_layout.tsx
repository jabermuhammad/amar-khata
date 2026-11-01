import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { AppUpdateProvider } from '../contexts/AppUpdateContext';
import AppUpdateBanner from '../components/AppUpdateBanner';

// Keep Android's native splash visible until auth routing is ready.
void SplashScreen.preventAutoHideAsync();

function RouteGuard() {
  const { user, loading, configured } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const onAuth = segments[0] === 'auth';
  const routeReady = !loading && (!configured || (user ? !onAuth : onAuth));
  useEffect(() => {
    if (loading || !configured) return;
    if (!user && !onAuth) router.replace('/auth');
    else if (user && onAuth) router.replace('/');
  }, [configured, loading, onAuth, router, user]);
  useEffect(() => {
    if (routeReady) void SplashScreen.hideAsync();
  }, [routeReady]);
  if (loading) return null;
  return <><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fafaf7' } }} /><AppUpdateBanner /></>;
}

export default function RootLayout() {
  return <AuthProvider><AppUpdateProvider><StatusBar style="dark" /><RouteGuard /></AppUpdateProvider></AuthProvider>;
}
