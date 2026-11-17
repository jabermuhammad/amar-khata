import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { ThemedScrollView as ScrollView, ThemedText as Text, ThemedView as View, ThemedSafeAreaView as SafeAreaView, ThemedIcon } from '../components/ThemePrimitives';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import type { Note } from '../data';
import { useAuth } from '../contexts/AuthContext';
import { deleteOwnedResource, loadResourceSummaries } from '../lib/collaboration';
import { goBackOrReplace } from '../lib/navigation.mjs';
import { deleteScopedCloudResource, deleteScopedLocalResource, readNotes, storageScopeId, writeNotes } from '../lib/localStorage';
import { mayDeleteResource } from '../lib/themePolicy.mjs';
import { formatResourceSummaryIssues } from '../lib/ownedResourceService.mjs';

type RemoteSummary = Awaited<ReturnType<typeof loadResourceSummaries>>['summaries'][number];

const displayDate = (value?: string) => value ? new Date(value).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export default function NotesScreen() {
  const router = useRouter();
  const { user, scope, mode } = useAuth();
  const [notes, setNotes] = useState<(Note & { id: string })[]>([]);
  const [remoteNotes, setRemoteNotes] = useState<RemoteSummary[]>([]);
  const [remoteLoadIssue, setRemoteLoadIssue] = useState('');
  const [loadedScopeId, setLoadedScopeId] = useState('');
  const scopeId = scope ? storageScopeId(scope) : '';
  const scopeIdRef = useRef(scopeId);
  useEffect(() => { scopeIdRef.current = scopeId; }, [scopeId]);
  const localReady = Boolean(scope && loadedScopeId === scopeId);
  const visibleNotes = localReady ? notes : [];
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoadedScopeId(''); setNotes([]); setRemoteNotes([]); setRemoteLoadIssue('');
    if (scope) readNotes(scope).then(entries => { if (active) { setNotes(entries); setLoadedScopeId(storageScopeId(scope)); } }).catch(error => { if (active) Alert.alert('লোকাল নোট পড়া যায়নি', error instanceof Error ? error.message : 'ডাটা অক্ষত আছে; storage যাচাই করে আবার চেষ্টা করুন।'); });
    if (mode === 'account' && user) loadResourceSummaries(user.uid).then(result => { if (active) { setRemoteNotes(result.summaries.filter(value => value.kind === 'note')); setRemoteLoadIssue(formatResourceSummaryIssues(result.issues)); } }).catch(error => { if (active) { setRemoteNotes([]); setRemoteLoadIssue(error instanceof Error ? error.message : 'Cloud নোট পড়া যায়নি।'); } });
    return () => { active = false; };
  }, [mode, scope, user]));
  const createNote = async () => {
    if (!scope || !localReady) { Alert.alert('নোট এখনো প্রস্তুত নয়', 'লোকাল ডাটা পড়া শেষ হলে আবার চেষ্টা করুন।'); return; }
    const now = new Date().toISOString();
    const note: Note & { id: string } = { id: `note-${Date.now()}`, title: 'নতুন নোট', body: '', createdAt: now, updatedAt: now };
    const next = [note, ...notes];
    try { await writeNotes(scope, next); setNotes(next); }
    catch (error) { Alert.alert('নোট সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'ডাটা অক্ষত আছে; আবার চেষ্টা করুন।'); return; }
    router.push({ pathname: '/note', params: { id: note.id } });
  };
  const confirmDelete = (note: Note & { id: string }, cloudId?: string, permission?: string) => {
    const cloudLinked = Boolean(cloudId || note.cloudId);
    const scopeMatches = cloudLinked ? Boolean(user && scope?.kind === 'user' && scope.uid === user.uid) : Boolean(scope && loadedScopeId === scopeId && scopeIdRef.current === scopeId);
    if (!mayDeleteResource({ local: !cloudLinked, cloudLinked, permission, currentScopeMatches: scopeMatches }) || (cloudLinked && !user)) return;
    Alert.alert(cloudLinked ? 'Cloud নোটটি স্থায়ীভাবে মুছবেন?' : 'নোটটি মুছবেন?', `“${note.title || 'শিরোনামহীন নোট'}” ${cloudLinked ? 'এবং এর shared access মুছে যাবে।' : 'এই ডিভাইস থেকে মুছে যাবে।'}`, [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'মুছুন', style: 'destructive', onPress: () => { void (async () => {
        try {
          if (!cloudLinked) {
            if (!scope || scopeIdRef.current !== scopeId) throw new Error('Storage scope বদলেছে; নোট রিফ্রেশ করে আবার চেষ্টা করুন।');
            await deleteScopedLocalResource(scope, 'notes', note.id);
            setNotes(current => current.filter(value => value.id !== note.id));
          } else {
            const id = cloudId || note.cloudId!;
            if (!user) throw new Error('এই account আর সক্রিয় নেই।');
            await deleteOwnedResource('note', id, user.uid);
            if (scopeIdRef.current !== scopeId) { Alert.alert('Cloud নোট মোছা হয়েছে', 'Account বদলে যাওয়ায় পুরোনো scope-এর local link রাখা হয়েছে; নতুন account-এর data অপরিবর্তিত আছে।'); return; }
            if (scope && scopeIdRef.current === scopeId) {
              const linked = (await readNotes(scope)).find(value => value.cloudId === id);
              if (linked) await deleteScopedCloudResource(scope, 'notes', linked.id, id);
            }
            setRemoteNotes(current => current.filter(value => value.id !== id));
            setNotes(current => current.filter(value => value.cloudId !== id));
          }
        } catch (error) { Alert.alert('নোট মোছা সম্পূর্ণ হয়নি', error instanceof Error ? error.message : 'ডাটা অক্ষত রেখে আবার চেষ্টা করুন।'); }
      })(); } },
    ]);
  };
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
    <View style={s.header}><Pressable onPress={() => goBackOrReplace(router, '/')} hitSlop={10} accessibilityRole="button" accessibilityLabel="হোমে ফিরে যান" style={s.back}><ThemedIcon role="primary" style={s.backText}>‹</ThemedIcon></Pressable><Text style={s.headerTitle}>আমার নোট</Text><Pressable disabled={!localReady} onPress={createNote} style={s.add}><ThemedIcon role="primary" style={s.addText}>＋</ThemedIcon></Pressable></View>
    <ScrollView contentContainerStyle={s.content}>
      {!!remoteLoadIssue && <View style={s.remoteWarning}><Text style={s.remoteWarningText}>{remoteLoadIssue}</Text></View>}
      <Text style={s.subtitle}>তারিখসহ আপনার লেখা নোটগুলো</Text>
      {(visibleNotes.filter(note => !note.cloudId).length + remoteNotes.length) ? <>{visibleNotes.filter(note => !note.cloudId).map(note => <View key={note.id} style={s.cardRow}><Pressable onPress={() => router.push({ pathname: '/note', params: { id: note.id } })} style={s.card}>
        <View style={s.cardTop}><Text numberOfLines={1} style={s.title}>{note.title || 'শিরোনামহীন নোট'}</Text><Text style={s.arrow}>›</Text></View>
        <Text numberOfLines={2} style={s.preview}>{note.body || 'এখনো কোনো লেখা নেই'}</Text>
        <View style={s.datePill}><Text style={s.calendar}>▦</Text><Text style={s.date}>{displayDate(note.createdAt)}</Text></View>
      </Pressable><Pressable style={s.deleteButton} onPress={() => confirmDelete(note)} accessibilityRole="button" accessibilityLabel="নোট মুছুন"><Text style={s.deleteText}>⋮</Text></Pressable></View>)}{remoteNotes.map(note => {
        const deletableNote: Note & { id: string } = { id: note.id, title: note.title, body: '', cloudId: note.id };
        return <View key={`remote-${note.id}`} style={s.cardRow}><Pressable onPress={() => router.push({ pathname: '/note', params: { remoteId: note.id } })} style={s.card}><View style={s.cardTop}><Text numberOfLines={1} style={s.title}>{note.title}</Text><Text style={s.arrow}>›</Text></View><View style={s.datePill}><Text style={s.calendar}>▦</Text><Text style={s.date}>{displayDate(typeof note.date === 'string' ? note.date : undefined)} · {note.permission}</Text></View></Pressable>{mayDeleteResource({ local: false, cloudLinked: true, permission: note.permission, currentScopeMatches: Boolean(user && scope?.kind === 'user' && scope.uid === user.uid) }) && <Pressable style={s.deleteButton} onPress={() => confirmDelete(deletableNote, note.id, note.permission)} accessibilityRole="button" accessibilityLabel="Cloud নোট মুছুন"><Text style={s.deleteText}>⋮</Text></Pressable>}</View>;
      })}</> : remoteLoadIssue ? null : <View style={s.empty}><Text style={s.emptyTitle}>এখনো কোনো নোট নেই</Text><Text style={s.emptyText}>উপরে + চিহ্নে চাপ দিয়ে প্রথম নোটটি লিখুন।</Text></View>}
    </ScrollView>
    <Pressable disabled={!localReady} onPress={createNote} style={s.fab} accessibilityLabel="নতুন নোট লিখুন"><Text style={s.fabText}>＋</Text></Pressable>
  </SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#fafaf7' }, header: { height: 60, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#e8e9e3' }, back: { width: 40 }, backText: { color: '#315f47', fontSize: 34 }, headerTitle: { color: '#20231f', fontSize: 18, fontWeight: '600' }, add: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, addText: { color: '#27804d', fontSize: 30 }, content: { padding: 18, paddingBottom: 155 }, remoteWarning: { marginBottom: 12, padding: 11, borderRadius: 10, borderWidth: 1, borderColor: '#e4c7c7', backgroundColor: '#fff8f7' }, remoteWarningText: { color: '#684747', fontSize: 11, lineHeight: 17 }, subtitle: { color: '#81867e', fontSize: 13, marginBottom: 14 }, cardRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 11 }, card: { flex: 1, padding: 16, borderRadius: 17, borderWidth: 1, borderColor: '#e6e9e1', backgroundColor: '#fff' }, deleteButton: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }, deleteText: { color: '#7c867d', fontSize: 25 }, cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { flex: 1, color: '#222720', fontSize: 17, fontWeight: '600' }, arrow: { color: '#7c867d', fontSize: 26 }, preview: { color: '#71776f', fontSize: 13, lineHeight: 20, marginTop: 7 }, datePill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#edf5ee' }, calendar: { color: '#36764e', fontSize: 12 }, date: { color: '#36764e', fontSize: 11, fontWeight: '600' }, empty: { alignItems: 'center', padding: 30, marginTop: 20, borderRadius: 17, backgroundColor: '#fff' }, emptyTitle: { color: '#29312b', fontSize: 16, fontWeight: '600' }, emptyText: { color: '#858a82', fontSize: 12, marginTop: 7, textAlign: 'center' }, fab: { position: 'absolute', right: 22, bottom: 88, width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: '#2aab6d', elevation: 5 }, fabText: { color: '#fff', fontSize: 32, lineHeight: 37 } });
