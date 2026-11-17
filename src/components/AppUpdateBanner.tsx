import { useSegments } from 'expo-router';
import React from 'react';
import { Keyboard, StyleSheet, useWindowDimensions } from 'react-native';
import { ThemedText as Text, ThemedView as View } from './ThemePrimitives';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlossyPressable } from './GlossyPressable';
import { useAppUpdate } from '../contexts/AppUpdateContext';
import { useTheme } from '../contexts/ThemeContext';
import { shouldShowBottomNavigation } from '../lib/themePolicy.mjs';

export default function AppUpdateBanner() {
  const { manifest, dismissForWeek, downloadAndInstall, dismissed, checking, downloading } = useAppUpdate();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const segments = useSegments();
  const { theme } = useTheme();
  const route = segments[0] || 'index';
  const home = route === 'index';
  const hasBottomNav = shouldShowBottomNavigation(route);
  const [keyboardVisible, setKeyboardVisible] = React.useState(false);
  React.useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (checking || !manifest || dismissed || keyboardVisible) return null;
  const fabReservedWidth = home ? 102 : 0;
  const maxWidth = Math.max(0, windowWidth - insets.left - insets.right - 24 - fabReservedWidth);
  return <View style={[s.container, { left: insets.left + 12, bottom: insets.bottom + (hasBottomNav ? 84 : 12), maxWidth }, theme === 'light' ? s.containerLight : s.containerDark]} accessibilityRole="summary">
    <GlossyPressable disabled={downloading} style={[s.later, downloading && s.disabled, theme === 'light' ? s.laterLight : s.laterDark]} onPress={() => { void dismissForWeek(); }} accessibilityRole="button" accessibilityState={{ disabled: downloading }} android_ripple={{ color: theme === 'light' ? 'rgba(38,93,61,0.08)' : 'rgba(231,245,237,0.10)' }}><Text style={[s.laterText, theme === 'light' ? s.laterTextLight : s.laterTextDark]}>পরে করব</Text></GlossyPressable>
    <GlossyPressable disabled={downloading} style={[s.update, downloading && s.disabled]} onPress={() => { void downloadAndInstall(); }} accessibilityRole="button" accessibilityState={{ disabled: downloading }} android_ripple={{ color: 'rgba(255,255,255,0.14)' }}><Text style={s.updateText}>{downloading ? 'ডাউনলোড হচ্ছে…' : 'Update Now'}</Text></GlossyPressable>
  </View>;
}

const s = StyleSheet.create({
  container: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 6, padding: 5, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 10, elevation: 4 },
  containerDark: { backgroundColor: 'rgba(17,27,32,0.86)', borderColor: 'rgba(195,229,210,0.20)' },
  containerLight: { backgroundColor: 'rgba(250,252,249,0.90)', borderColor: 'rgba(40,105,70,0.18)' },
  later: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 9, overflow: 'hidden' },
  laterDark: { backgroundColor: 'rgba(238,247,241,0.08)' },
  laterLight: { backgroundColor: 'rgba(35,91,58,0.06)' },
  laterText: { fontSize: 12, fontWeight: '600' },
  laterTextDark: { color: '#d3e0d9' },
  laterTextLight: { color: '#425249' },
  update: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, overflow: 'hidden', backgroundColor: '#21865d' },
  updateText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  disabled: { opacity: 0.58 },
});
