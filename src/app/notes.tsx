import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { STORE, type Note } from '../data';
import { useAuth } from '../contexts/AuthContext';
import { loadResourceSummaries } from '../lib/collaboration';

type RemoteSummary = Awaited<ReturnType<typeof loadResourceSummaries>>[number];

const displayDate = (value?: string) => value ? new Date(value).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export default function NotesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [remoteNotes, setRemoteNotes] = useState<RemoteSummary[]>([]);
  useFocusEffect(useCallback(() => {
    let active = true;
    Promise.all([AsyncStorage.getItem(STORE.notes), AsyncStorage.getItem(STORE.note)]).then(async ([saved, legacy]) => {
      let entries: Note[] = saved ? JSON.parse(saved) : [];
      if (saved === null && legacy) {
        const old: Note = JSON.parse(legacy);
        entries = [{ ...old, id: old.id || `note-legacy-${Date.now()}`, createdAt: old.createdAt || new Date().toISOString() }];
        await AsyncStorage.setItem(STORE.notes, JSON.stringify(entries));
      }
      if (legacy !== null) await AsyncStorage.removeItem(STORE.note);
      if (active) setNotes(entries);
    }).catch(() => {});
    if (user) loadResourceSummaries(user.uid).then(values => { if (active) setRemoteNotes(values.filter(value => value.kind === 'note')); }).catch(() => setRemoteNotes([]));
    else setRemoteNotes([]);
    return () => { active = false; };
  }, [user]));
  const createNote = async () => {
    const now = new Date().toISOString();
    const note: Note = { id: `note-${Date.now()}`, title: 'নতুন নোট', body: '', createdAt: now, updatedAt: now };
    const next = [note, ...notes];
    setNotes(next);
    await AsyncStorage.setItem(STORE.notes, JSON.stringify(next)).catch(() => {});
    router.push({ pathname: '/note', params: { id: note.id } });
  };
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
    <View style={s.header}><Pressable onPress={() => router.back()} style={s.back}><Text style={s.backText}>‹</Text></Pressable><Text style={s.headerTitle}>আমার নোট</Text><Pressable onPress={createNote} style={s.add}><Text style={s.addText}>＋</Text></Pressable></View>
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.subtitle}>তারিখসহ আপনার লেখা নোটগুলো</Text>
      {(notes.filter(note => !note.cloudId).length + remoteNotes.length) ? <>{notes.filter(note => !note.cloudId).map(note => <Pressable key={note.id} onPress={() => router.push({ pathname: '/note', params: { id: note.id } })} style={s.card}>
        <View style={s.cardTop}><Text numberOfLines={1} style={s.title}>{note.title || 'শিরোনামহীন নোট'}</Text><Text style={s.arrow}>›</Text></View>
        <Text numberOfLines={2} style={s.preview}>{note.body || 'এখনো কোনো লেখা নেই'}</Text>
        <View style={s.datePill}><Text style={s.calendar}>▦</Text><Text style={s.date}>{displayDate(note.createdAt)}</Text></View>
      </Pressable>)}{remoteNotes.map(note => <Pressable key={`remote-${note.id}`} onPress={() => router.push({ pathname: '/note', params: { remoteId: note.id } })} style={s.card}><View style={s.cardTop}><Text numberOfLines={1} style={s.title}>{note.title}</Text><Text style={s.arrow}>›</Text></View><View style={s.datePill}><Text style={s.calendar}>▦</Text><Text style={s.date}>{displayDate(typeof note.date === 'string' ? note.date : undefined)} · {note.permission}</Text></View></Pressable>)}</> : <View style={s.empty}><Text style={s.emptyTitle}>এখনো কোনো নোট নেই</Text><Text style={s.emptyText}>উপরে + চিহ্নে চাপ দিয়ে প্রথম নোটটি লিখুন।</Text></View>}
    </ScrollView>
    <Pressable onPress={createNote} style={s.fab} accessibilityLabel="নতুন নোট লিখুন"><Text style={s.fabText}>＋</Text></Pressable>
  </SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#fafaf7' }, header: { height: 60, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#e8e9e3' }, back: { width: 40 }, backText: { color: '#315f47', fontSize: 34 }, headerTitle: { color: '#20231f', fontSize: 18, fontWeight: '600' }, add: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, addText: { color: '#27804d', fontSize: 30 }, content: { padding: 18, paddingBottom: 100 }, subtitle: { color: '#81867e', fontSize: 13, marginBottom: 14 }, card: { padding: 16, marginBottom: 11, borderRadius: 17, borderWidth: 1, borderColor: '#e6e9e1', backgroundColor: '#fff' }, cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { flex: 1, color: '#222720', fontSize: 17, fontWeight: '600' }, arrow: { color: '#7c867d', fontSize: 26 }, preview: { color: '#71776f', fontSize: 13, lineHeight: 20, marginTop: 7 }, datePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#edf5ee' }, calendar: { color: '#36764e', fontSize: 12 }, date: { color: '#36764e', fontSize: 11, fontWeight: '600' }, empty: { alignItems: 'center', padding: 30, marginTop: 20, borderRadius: 17, backgroundColor: '#fff' }, emptyTitle: { color: '#29312b', fontSize: 16, fontWeight: '600' }, emptyText: { color: '#858a82', fontSize: 12, marginTop: 7, textAlign: 'center' }, fab: { position: 'absolute', right: 22, bottom: 22, width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: '#2aab6d', elevation: 5 }, fabText: { color: '#fff', fontSize: 32, lineHeight: 37 } });
