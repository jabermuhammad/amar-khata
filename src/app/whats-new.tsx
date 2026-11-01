import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useAppUpdate } from '../contexts/AppUpdateContext';

const LOCAL_NOTES = [
  'বাংলা বাজারের তালিকা ও নোট এক জায়গায় দেখা যায়।',
  'শেয়ার করা নোট ও তালিকার জন্য অনুমতি এবং সিঙ্ক সুবিধা রয়েছে।',
  'প্রোফাইল ছবি ফোনেই থাকে; Cloud-এ আপলোড হয় না।',
];

export default function WhatsNewScreen() {
  const router = useRouter();
  const { currentVersion, latestVersion, manifest } = useAppUpdate();
  const notes = manifest?.changelog.length ? manifest.changelog : LOCAL_NOTES;
  return <SafeAreaView style={s.page} edges={['top']}>
    <View style={s.header}><Pressable onPress={() => router.back()} style={s.back}><Text style={s.backText}>‹</Text></Pressable><Text style={s.headerTitle}>{"What's New"}</Text><View style={s.spacer} /></View>
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.label}>বর্তমান ভার্সন</Text><Text style={s.version}>{currentVersion}</Text>
      <Text style={s.label}>সর্বশেষ ভার্সন</Text><Text style={s.version}>{latestVersion}</Text>
      <View style={s.divider} /><Text style={s.section}>নতুন ফিচার ও উন্নতি</Text>
      {notes.map((note, index) => <View key={`${index}-${note}`} style={s.noteRow}><Text style={s.bullet}>•</Text><Text style={s.note}>{note}</Text></View>)}
      <Text style={s.section}>সমস্যা সংশোধন</Text><Text style={s.note}>প্রকাশিত সংস্করণের পরিবর্তনগুলো এখানে দেখানো হবে।</Text>
    </ScrollView>
  </SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#fafaf7' }, header: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#e8e9e3' }, back: { width: 40, minHeight: 44, justifyContent: 'center' }, backText: { color: '#315f47', fontSize: 34 }, headerTitle: { color: '#20231f', fontSize: 18, fontWeight: '600' }, spacer: { width: 40 }, content: { padding: 20, paddingBottom: 100 }, label: { color: '#7c847b', fontSize: 12, marginTop: 6 }, version: { color: '#2a4835', fontSize: 17, fontWeight: '700', marginTop: 3 }, divider: { height: 1, backgroundColor: '#e6e9e2', marginVertical: 20 }, section: { color: '#26372a', fontSize: 15, fontWeight: '700', marginBottom: 10, marginTop: 8 }, noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 10 }, bullet: { color: '#2f8a5c', fontSize: 18 }, note: { flex: 1, color: '#59635a', fontSize: 13, lineHeight: 20 } });
