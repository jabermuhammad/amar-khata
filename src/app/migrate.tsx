import React, { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { ThemedSafeAreaView as SafeAreaView, ThemedScrollView as ScrollView, ThemedText as Text, ThemedView as View, ThemedIcon } from '../components/ThemePrimitives';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { removeEmptyLocalListDrafts, type Note, type ShoppingList } from '../data';
import { useAuth } from '../contexts/AuthContext';
import { migrateLocalData } from '../lib/collaboration';
import { guestScopeFor, readLists, readNotes } from '../lib/localStorage';
import { goBackOrReplace } from '../lib/navigation.mjs';

type LocalList = ShoppingList & { cloudId?: string };
type LocalNote = Note & { id: string; cloudId?: string };

export default function MigrateScreen() {
  const router = useRouter();
  const { user, pendingGuestImport, dismissGuestImport } = useAuth();
  const [lists, setLists] = useState<Record<string, LocalList>>({});
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [selectedLists, setSelectedLists] = useState<string[]>([]);
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoaded(false);
    if (!pendingGuestImport) { setLists({}); setNotes([]); setSelectedLists([]); setSelectedNotes([]); setLoaded(true); return () => { active = false; }; }
    const guestScope = guestScopeFor(pendingGuestImport);
    Promise.all([readLists(guestScope), readNotes(guestScope)]).then(([savedLists, noteData]) => {
      const listData = removeEmptyLocalListDrafts(savedLists) as Record<string, LocalList>;
      if (active) {
        setLists(listData); setNotes(noteData);
        setSelectedLists([]); setSelectedNotes([]); setLoaded(true);
      }
    }).catch(error => { if (active) Alert.alert('Guest ডাটা পড়া যায়নি', error instanceof Error ? error.message : 'মূল ডাটা অক্ষত আছে; storage ঠিক করে আবার চেষ্টা করুন।'); });
    return () => { active = false; };
  }, [pendingGuestImport]));

  const toggle = (value: string, values: string[], setValues: (next: string[]) => void) => setValues(values.includes(value) ? values.filter(item => item !== value) : [...values, value]);
  const migrate = async () => {
    if (!user || !pendingGuestImport || !loaded) { Alert.alert('Guest ডাটা প্রস্তুত নয়', 'Cloud-এ কপি করতে নির্দিষ্ট Guest data ও account প্রয়োজন।'); return; }
    setBusy(true);
    try {
      const result = await migrateLocalData(user, guestScopeFor(pendingGuestImport), selectedNotes, selectedLists);
      Alert.alert('Cloud-এ কপি সম্পন্ন', `${result.lists}টি তালিকা ও ${result.notes}টি নোট কপি হয়েছে। আপনার ফোনের মূল ডাটা অক্ষত আছে।`, [{ text: 'ঠিক আছে', onPress: () => goBackOrReplace(router, '/shared') }]);
    } catch (error) { Alert.alert('কপি সম্পন্ন হয়নি', error instanceof Error ? error.message : 'ইন্টারনেট সংযোগ পরীক্ষা করুন।'); }
    finally { setBusy(false); }
  };

  return <SafeAreaView style={s.page}><View style={s.header}><Pressable onPress={() => goBackOrReplace(router, '/shared')} hitSlop={10} accessibilityRole="button" accessibilityLabel="শেয়ার করা পেজে ফিরে যান"><ThemedIcon role="primary" style={s.back}>‹</ThemedIcon></Pressable><Text style={s.heading}>লোকাল ডাটা Cloud-এ নিন</Text><View style={{ width: 30 }} /></View><ScrollView contentContainerStyle={s.content}>
    {!pendingGuestImport ? <Text style={s.intro}>কোনো নির্দিষ্ট Guest space থেকে migration অপেক্ষমাণ নেই। পুরোনো global data স্বয়ংক্রিয়ভাবে account-এ নেওয়া হয় না।</Text> : null}
    <Text style={s.intro}>যে নোট ও তালিকা কপি করতে চান সেগুলো বেছে নিন। এটি Cloud-এ একটি কপি তৈরি করবে; ফোনের ডাটা মুছবে না। Profile Photo এই প্রক্রিয়ার অংশ নয়।</Text>
    <Text style={s.section}>বাজারের তালিকা</Text>
    {Object.entries(lists).filter(([, value]) => !value.cloudId).map(([id, list]) => <Pressable key={id} style={s.row} onPress={() => toggle(id, selectedLists, setSelectedLists)}><Text style={s.check}>{selectedLists.includes(id) ? '☑' : '□'}</Text><View style={{ flex: 1 }}><Text style={s.name}>{list.title || 'নতুন বাজারের তালিকা'}</Text><Text style={s.meta}>{list.items.length}টি পণ্য</Text></View></Pressable>)}
    <Text style={s.section}>নোট</Text>
    {notes.filter(note => !note.cloudId).map(note => <Pressable key={note.id} style={s.row} onPress={() => toggle(note.id, selectedNotes, setSelectedNotes)}><Text style={s.check}>{selectedNotes.includes(note.id) ? '☑' : '□'}</Text><View style={{ flex: 1 }}><Text style={s.name}>{note.title || 'শিরোনামহীন নোট'}</Text><Text numberOfLines={1} style={s.meta}>{note.createdAt || 'তারিখ নেই'}</Text></View></Pressable>)}
    {!Object.values(lists).some(list => !list.cloudId) && !notes.some(note => !note.cloudId) && <Text style={s.empty}>নতুন করে কপি করার মতো লোকাল ডাটা নেই।</Text>}
    <Pressable disabled={!loaded || !pendingGuestImport || busy || (!selectedLists.length && !selectedNotes.length)} onPress={migrate} style={[s.primary, (!loaded || !pendingGuestImport || busy || (!selectedLists.length && !selectedNotes.length)) && s.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>বেছে নেওয়া ডাটা Cloud-এ কপি করুন</Text>}</Pressable>
    {pendingGuestImport && <Pressable disabled={busy} onPress={() => { void dismissGuestImport().then(() => goBackOrReplace(router, '/shared')).catch(() => Alert.alert('বন্ধ করা যায়নি', 'পরে আবার চেষ্টা করুন।')); }} style={s.secondary}><Text style={s.secondaryText}>এই Guest migration আপাতত বন্ধ করুন</Text></Pressable>}
  </ScrollView></SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#fafaf7' }, header: { height: 58, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#e7e9e3' }, back: { color: '#315f47', fontSize: 32 }, heading: { color: '#20231f', fontSize: 16, fontWeight: '700' }, content: { padding: 18, paddingBottom: 45 }, intro: { color: '#687168', fontSize: 13, lineHeight: 20, padding: 13, borderRadius: 13, backgroundColor: '#edf4ed', marginBottom: 18 }, section: { color: '#315f47', fontSize: 14, fontWeight: '700', marginTop: 11, marginBottom: 8 }, row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: '#e8ebe5', backgroundColor: '#fff' }, check: { color: '#32865a', fontSize: 22 }, name: { color: '#262c26', fontSize: 14, fontWeight: '600' }, meta: { color: '#858b83', fontSize: 11, marginTop: 3 }, empty: { color: '#7b8279', textAlign: 'center', padding: 20 }, primary: { minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 23, borderRadius: 13, backgroundColor: '#2b8655' }, secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 }, secondaryText: { color: '#687168', fontSize: 12 }, disabled: { opacity: .5 }, primaryText: { color: '#fff', fontSize: 13, fontWeight: '700' } });
