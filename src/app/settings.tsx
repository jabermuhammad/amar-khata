import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useAppUpdate } from '../contexts/AppUpdateContext';

export default function SettingsScreen() {
  const router = useRouter();
  const { currentVersion, latestVersion } = useAppUpdate();
  const build = Constants.expoConfig?.android?.versionCode || 1;
  return <SafeAreaView style={s.page} edges={['top']}>
    <View style={s.header}><Pressable onPress={() => router.back()} style={s.back}><Text style={s.backText}>‹</Text></Pressable><Text style={s.headerTitle}>সেটিংস</Text><View style={s.spacer} /></View>
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.section}>অ্যাপ সম্পর্কে</Text>
      <Pressable style={s.card} onPress={() => router.push('/whats-new')} accessibilityRole="button">
        <View style={s.cardCopy}><Text style={s.cardTitle}>{"What's New"}</Text><Text style={s.cardDetail}>নতুন সুবিধা, উন্নতি ও সংশোধন দেখুন</Text></View><Text style={s.arrow}>›</Text>
      </Pressable>
      <View style={s.versionBox}><Text style={s.versionLabel}>বর্তমান ভার্সন</Text><Text style={s.version}>{currentVersion} · build {build}</Text><Text style={s.versionLabel}>সর্বশেষ প্রকাশিত ভার্সন</Text><Text style={s.version}>{latestVersion}</Text></View>
    </ScrollView>
  </SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#fafaf7' }, header: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#e8e9e3' }, back: { width: 40, minHeight: 44, justifyContent: 'center' }, backText: { color: '#315f47', fontSize: 34 }, headerTitle: { color: '#20231f', fontSize: 18, fontWeight: '600' }, spacer: { width: 40 }, content: { padding: 18, paddingBottom: 100 }, section: { marginTop: 8, marginBottom: 10, color: '#687168', fontSize: 13, fontWeight: '700' }, card: { minHeight: 68, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', borderRadius: 15, borderWidth: 1, borderColor: '#e5e9e1', backgroundColor: '#fff' }, cardCopy: { flex: 1 }, cardTitle: { color: '#28342b', fontSize: 15, fontWeight: '700' }, cardDetail: { color: '#7c847b', fontSize: 12, marginTop: 4 }, arrow: { color: '#528166', fontSize: 25 }, versionBox: { marginTop: 15, padding: 15, borderRadius: 15, borderWidth: 1, borderColor: '#e5e9e1', backgroundColor: '#fff' }, versionLabel: { color: '#828980', fontSize: 11, marginTop: 5 }, version: { color: '#2a4835', fontSize: 14, fontWeight: '600', marginTop: 3 } });
