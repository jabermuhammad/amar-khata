import { useRouter, useSegments } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlossyPressable as Pressable } from './GlossyPressable';
import { ThemedText as Text, ThemedView as View } from './ThemePrimitives';
import { useAuth } from '../contexts/AuthContext';
import { readPhoto, storageScopeId } from '../lib/localStorage';
import { useTheme } from '../contexts/ThemeContext';
import { semanticIconColor, shouldShowBottomNavigation } from '../lib/themePolicy.mjs';

const tabs = [
  { id: 'index', label: 'হোম', icon: require('../../assets/nav-home.png'), route: '/' },
  { id: 'lists', label: 'তালিকা', icon: require('../../assets/nav-checklist.png'), route: '/lists' },
  { id: 'notes', label: 'নোট', icon: require('../../assets/nav-sticky-note.png'), route: '/notes' },
] as const;

export default function AppBottomNav() {
  const segments = useSegments();
  const route = segments[0] || 'index';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { scope } = useAuth();
  const [loadedPhoto, setLoadedPhoto] = useState<{ scopeId: string; value: string | null } | null>(null);
  const scopeId = scope ? storageScopeId(scope) : '';
  const { theme } = useTheme();
  useEffect(() => {
    let active = true;
    if (scope) readPhoto(scope).then(value => { if (active) setLoadedPhoto({ scopeId, value }); }).catch(() => {});
    return () => { active = false; };
  }, [scope, scopeId]);
  const photo = loadedPhoto?.scopeId === scopeId ? loadedPhoto.value : null;
  if (!shouldShowBottomNavigation(route)) return null;
  return <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 8) }, theme === 'dark' && s.barDark]} accessibilityRole="tablist">
    {tabs.map(tab => <Pressable key={tab.id} style={s.item} onPress={() => { if (route !== tab.id) router.replace(tab.route as never); }} accessibilityRole="tab" accessibilityState={{ selected: route === tab.id }}>
      <Image source={tab.icon} resizeMode="contain" style={[s.icon, { tintColor: semanticIconColor(route === tab.id ? 'primary' : 'secondary', theme) }]} accessible={false} />
      <Text style={[s.label, { color: semanticIconColor(route === tab.id ? 'primary' : 'secondary', theme) }, route === tab.id && s.labelActive]}>{tab.label}</Text>
    </Pressable>)}
    <Pressable style={s.item} onPress={() => router.push('/profile')} accessibilityRole="tab" accessibilityLabel="প্রোফাইল">
      <View style={[s.profile, theme === 'dark' && s.profileDark]}>{photo ? <Image source={{ uri: photo }} style={s.photo} /> : <View style={s.profileFallback}><View style={s.profileHead} /><View style={s.profileShoulders} /></View>}</View>
      <Text style={s.label}>প্রোফাইল</Text>
    </Pressable>
  </View>;
}

const s = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 65, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 7, backgroundColor: '#ffffff', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e5e9e1' },
  barDark: { backgroundColor: '#10171d', borderTopColor: '#26323e' },
  item: { minWidth: 58, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 },
  icon: { width: 23, height: 23 },
  label: { fontSize: 10 }, labelActive: { fontWeight: '700' },
  profile: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#e5ece7' }, profileDark: { backgroundColor: '#25323a' }, profileFallback: { width: 25, height: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: '#dcece2' }, profileHead: { position: 'absolute', top: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#358458' }, profileShoulders: { position: 'absolute', bottom: 2, width: 16, height: 9, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: '#358458' }, photo: { width: 25, height: 25 },
});
