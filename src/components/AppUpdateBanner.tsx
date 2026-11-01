import { useSegments } from 'expo-router';
import React from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlossyPressable } from './GlossyPressable';
import { useAppUpdate } from '../contexts/AppUpdateContext';

export default function AppUpdateBanner() {
  const { manifest, dismissForWeek, downloadAndInstall, dismissed, checking } = useAppUpdate();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const home = segments[0] === 'index';
  const [keyboardVisible, setKeyboardVisible] = React.useState(false);
  React.useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (checking || !manifest || dismissed || keyboardVisible) return null;
  return <View style={[s.container, { bottom: insets.bottom + (home ? 84 : 12) }]} accessibilityRole="summary">
    <GlossyPressable style={s.later} onPress={() => { void dismissForWeek(); }} accessibilityRole="button"><Text style={s.laterText}>পরে করব</Text></GlossyPressable>
    <GlossyPressable style={s.update} onPress={() => { void downloadAndInstall(); }} accessibilityRole="button"><Text style={s.updateText}>Update Now</Text></GlossyPressable>
  </View>;
}

const s = StyleSheet.create({
  container: { position: 'absolute', left: 12, maxWidth: '76%', flexDirection: 'row', alignItems: 'center', gap: 7, padding: 5, borderRadius: 16, backgroundColor: 'rgba(12,20,25,0.94)', borderWidth: 1, borderColor: 'rgba(90,190,145,0.35)', elevation: 5 },
  later: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 11 },
  laterText: { color: '#c5d2cb', fontSize: 12, fontWeight: '600' },
  update: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 11, backgroundColor: '#21865d' },
  updateText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
