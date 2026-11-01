import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { SafeAreaView } from 'react-native-safe-area-context';
import { initialNote, STORE, type Note } from '../data';
import ShareDialog from '../components/ShareDialog';
import { useAuth } from '../contexts/AuthContext';
import { getRemoteNote, updateRemoteNote, watchRemoteNote, type RemoteNote } from '../lib/collaboration';

export default function NoteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; remoteId?: string }>();
  const { user } = useAuth();
  const { id } = params;
  const [activeRemoteId, setActiveRemoteId] = useState(params.remoteId || '');
  const remoteId = params.remoteId || activeRemoteId || undefined;
  const [note, setNote] = useState<Note>(initialNote);
  const noteRef = useRef(note);
  const [remoteNote, setRemoteNote] = useState<RemoteNote | null>(null);
  const [conflict, setConflict] = useState<RemoteNote | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [accessLostForId, setAccessLostForId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [syncLabel, setSyncLabel] = useState('');
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { noteRef.current = note; }, [note]);

  useEffect(() => {
    if (remoteId && user) {
      return watchRemoteNote(remoteId, user.uid, value => {
        if (dirtyRef.current && revisionRef.current !== value.revision) { setConflict(value); setSyncLabel('অন্য একজন এই নোট বদলেছেন'); return; }
        revisionRef.current = value.revision;
        setRemoteNote(value);
        setAccessLostForId(null);
        dirtyRef.current = false;
        const next = { id: id || remoteId, cloudId: remoteId, title: value.title, body: value.body, createdAt: value.createdAt, updatedAt: value.updatedAt } as Note;
        noteRef.current = next; setNote(next); setLoaded(true); setSyncLabel('Cloud-এ সংরক্ষিত');
      }, error => {
        const code = (error as Error & { code?: string }).code;
        const accessWasRevoked = code === 'permission-denied'
          || error.message.includes('নোটটি আর নেই')
          || error.message.includes('অনুমতি বাতিল');
        if (accessWasRevoked) {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          dirtyRef.current = false;
          setConflict(null);
          setRemoteNote(null);
          const cleared = { ...initialNote, id: id || remoteId, cloudId: remoteId, title: '', body: '' } as Note;
          noteRef.current = cleared;
          setNote(cleared);
          setLoaded(false);
          setAccessLostForId(remoteId);
          setSyncLabel('অনুমতি নেই');
          Alert.alert('শেয়ার করা নোট বন্ধ হয়েছে', 'এই নোটের অনুমতি আর নেই, তাই আগের লেখা স্ক্রিন থেকে সরানো হয়েছে।');
          return;
        }
        // A temporary network failure is not evidence that access was revoked.
        // Keep the visible note and any unsaved edits available on this device.
        setSyncLabel('সংযোগ সমস্যা—লেখা এই ডিভাইসে রাখা আছে');
        Alert.alert('নোট সিঙ্ক হয়নি', 'সংযোগে সমস্যা হয়েছে। আপনার লেখা এই স্ক্রিনে রাখা হয়েছে; সংযোগ ফিরে এলে আবার চেষ্টা করুন।');
      });
    }
    let active = true;
    Promise.all([AsyncStorage.getItem(STORE.notes), AsyncStorage.getItem(STORE.note)]).then(async ([saved, legacy]) => {
      if (!active) return;
      let parsed: Note[] = saved ? JSON.parse(saved) : [];
      if (saved === null && legacy) {
        const old: Note = JSON.parse(legacy);
        parsed = [{ ...old, id: old.id || `note-legacy-${Date.now()}`, createdAt: old.createdAt || new Date().toISOString() }];
        await AsyncStorage.setItem(STORE.notes, JSON.stringify(parsed));
      }
      if (legacy !== null) await AsyncStorage.removeItem(STORE.note);
      setNotes(parsed);
      const selected = parsed.find(value => value.id === id);
      if (selected) { noteRef.current = selected; setNote(selected); }
      else if (!id && parsed.length) { noteRef.current = parsed[0]; setNote(parsed[0]); }
      else if (!parsed.length) { const fresh = { ...initialNote, id: `note-${Date.now()}`, createdAt: new Date().toISOString() }; noteRef.current = fresh; setNote(fresh); }
    }).catch(() => {}).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [id, remoteId, user]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const persistRemoteDraft = (draft: Note, expectedRevision: number) => {
    if (!remoteId || !user) return;
    updateRemoteNote(remoteId, user.uid, { title: draft.title, body: draft.body }, expectedRevision).then(() => {
      revisionRef.current = expectedRevision + 1;
      setSyncLabel('Cloud-এ সংরক্ষিত');
    }).catch(async error => {
      if (error instanceof Error && error.message.includes('অন্য কেউ')) {
        try { setConflict(await getRemoteNote(remoteId, user.uid)); setSyncLabel('পরিবর্তন মিলিয়ে নিন'); }
        catch { Alert.alert('পরিবর্তন সংরক্ষণ হয়নি', error.message); }
      } else Alert.alert('Cloud-এ সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।');
    });
  };

  const update = (changes: Partial<Note>) => {
    const next: Note = { ...noteRef.current, ...changes, updatedAt: new Date().toISOString() };
    noteRef.current = next; setNote(next);
    if (remoteId && remoteNote && (remoteNote.permission === 'editor' || remoteNote.permission === 'owner')) {
      dirtyRef.current = true; setSyncLabel('পরিবর্তন সংরক্ষণ হচ্ছে…');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const expectedRevision = revisionRef.current;
      saveTimer.current = setTimeout(() => persistRemoteDraft(noteRef.current, expectedRevision), 800);
      return;
    }
    const nextNotes = notes.some(value => value.id === next.id) ? notes.map(value => value.id === next.id ? next : value) : [next, ...notes];
    setNotes(nextNotes);
    if (loaded) AsyncStorage.setItem(STORE.notes, JSON.stringify(nextNotes)).catch(() => {});
  };

  const useCloudVersion = () => {
    if (!conflict) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    revisionRef.current = conflict.revision; dirtyRef.current = false;
    const next = { id: id || conflict.id, cloudId: conflict.id, title: conflict.title, body: conflict.body, createdAt: conflict.createdAt, updatedAt: conflict.updatedAt } as Note;
    noteRef.current = next; setNote(next); setRemoteNote(conflict); setConflict(null); setSyncLabel('Cloud-এ সংরক্ষিত');
  };
  const keepMyVersion = () => {
    if (!conflict) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    revisionRef.current = conflict.revision; dirtyRef.current = true; setConflict(null);
    persistRemoteDraft(noteRef.current, conflict.revision);
  };

  const dateText = note.createdAt ? new Date(note.createdAt).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
  const canEdit = !remoteId || remoteNote?.permission === 'editor' || remoteNote?.permission === 'owner';
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
    <View style={s.header}><Pressable onPress={() => router.back()} style={s.back}><Text style={s.backText}>‹</Text></Pressable><Text style={s.headerTitle}>সাধারণ নোট</Text><Pressable onPress={() => setShareOpen(true)} style={s.share}><Text style={s.shareText}>শেয়ার</Text></Pressable></View>
    <ScrollView style={s.editor} keyboardShouldPersistTaps="handled" contentContainerStyle={s.editorContent}>
      <TextInput value={note.title} editable={loaded && canEdit} onChangeText={title => update({ title })} placeholder="নোটের শিরোনাম" style={s.title} />
      <View style={s.metaRow}><View style={s.datePill}><Text style={s.calendar}>▦</Text><Text style={s.dateText}>{dateText}</Text></View><Text style={s.meta}>{remoteId ? syncLabel : 'স্বয়ংক্রিয়ভাবে সংরক্ষিত'}</Text></View>
      <TextInput value={note.body} editable={loaded && canEdit} onChangeText={body => update({ body })} placeholder="এখানে লিখুন…" multiline textAlignVertical="top" style={[s.body, !canEdit && s.readOnly]} />
      {remoteId && !loaded && <Text style={s.meta}>{accessLostForId === remoteId ? 'এই নোট দেখার অনুমতি নেই।' : 'Cloud থেকে নোট আনা হচ্ছে…'}</Text>}
      {remoteId && remoteNote?.permission === 'viewer' && <Text style={s.viewerNotice}>আপনার অনুমতি শুধু নোট দেখার জন্য।</Text>}
      {!!conflict && <View style={s.conflict}><Text style={s.conflictTitle}>অন্য একজন নোটটি আগে পরিবর্তন করেছেন</Text><Text style={s.conflictBody}>আপনার লেখাটি এখানে অক্ষত আছে। কোন সংস্করণ রাখবেন?</Text><View style={s.conflictActions}><Pressable onPress={useCloudVersion}><Text style={s.conflictAction}>Cloud সংস্করণ</Text></Pressable><Pressable onPress={keepMyVersion}><Text style={s.conflictAction}>আমার লেখা রাখুন</Text></Pressable></View></View>}
    </ScrollView>
    <ShareDialog visible={shareOpen} onClose={() => setShareOpen(false)} kind="note" localId={id || String(note.id || 'note')} resourceId={remoteId || note.cloudId} note={note} onLinked={setActiveRemoteId} onDeleted={() => { setActiveRemoteId(''); setRemoteNote(null); router.replace('/'); }} />
  </SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#fafaf7' }, header: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#e8e9e3' }, back: { width: 40 }, backText: { color: '#315f47', fontSize: 34 }, headerTitle: { color: '#20231f', fontSize: 18, fontWeight: '600' }, share: { padding: 8 }, shareText: { color: '#315f47', fontSize: 12, fontWeight: '700' }, editor: { flex: 1 }, editorContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 }, title: { borderBottomWidth: 1, borderColor: '#e6e7e1', paddingVertical: 10, color: '#20231f', fontSize: 23, fontWeight: '600' }, metaRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginVertical: 9 }, datePill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 13, backgroundColor: '#e9f4ed' }, calendar: { color: '#36764e', fontSize: 14 }, dateText: { color: '#36764e', fontSize: 12, fontWeight: '600' }, meta: { color: '#858a82', fontSize: 11 }, body: { minHeight: 280, flex: 1, color: '#20231f', fontSize: 17, lineHeight: 29, paddingTop: 8 }, readOnly: { color: '#626860' }, viewerNotice: { padding: 11, borderRadius: 12, color: '#536b57', backgroundColor: '#edf5ee', fontSize: 12 }, conflict: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: '#fff2d7' }, conflictTitle: { color: '#684d1b', fontSize: 14, fontWeight: '700' }, conflictBody: { color: '#735e36', fontSize: 12, marginTop: 5 }, conflictActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 13 }, conflictAction: { color: '#2d744a', fontSize: 12, fontWeight: '700' } });
