import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet } from 'react-native';
import { ThemedKeyboardAvoidingView as KeyboardAvoidingView, ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, ThemedSafeAreaView as SafeAreaView, ThemedIcon } from '../components/ThemePrimitives';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { initialNote, type Note } from '../data';
import ShareDialog from '../components/ShareDialog';
import { useAuth } from '../contexts/AuthContext';
import { flushPendingCloudChanges, getPendingCloudChanges, getRemoteNote, queueRemoteNoteDraft, resolvePendingCloudChange, retryBlockedCloudChange, updateRemoteNote, watchRemoteNote, type RemoteNote } from '../lib/collaboration';
import { readNotes, storageScopeId, writeNotes } from '../lib/localStorage';
import { goBackOrReplace } from '../lib/navigation.mjs';

export default function NoteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; remoteId?: string }>();
  const { user, scope, mode } = useAuth();
  const { id } = params;
  const [activeRemoteId, setActiveRemoteId] = useState(params.remoteId || '');
  const remoteId = params.remoteId || activeRemoteId || undefined;
  const [note, setNote] = useState<Note>(initialNote);
  const noteRef = useRef(note);
  const [remoteNote, setRemoteNote] = useState<RemoteNote | null>(null);
  const [conflict, setConflict] = useState<RemoteNote | null>(null);
  const [conflictOutboxId, setConflictOutboxId] = useState('');
  const [notes, setNotes] = useState<(Note & { id: string })[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadedScopeId, setLoadedScopeId] = useState('');
  const currentScopeId = scope ? storageScopeId(scope) : '';
  const localReady = Boolean(scope && loaded && loadedScopeId === currentScopeId);
  const visibleNote = remoteId || loadedScopeId === currentScopeId ? note : { ...initialNote, title: '', body: '' };
  const [accessLostForId, setAccessLostForId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [syncLabel, setSyncLabel] = useState('');
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { noteRef.current = note; }, [note]);

  useEffect(() => {
    let active = true;
    if (remoteId && mode !== 'account') {
      void Promise.resolve().then(() => {
        if (!active) return;
        setNote({ ...initialNote, title: '', body: '' }); setNotes([]); setLoaded(false);
        setAccessLostForId(remoteId);
      });
      return () => { active = false; };
    }
    if (remoteId && user && mode === 'account') {
      return watchRemoteNote(remoteId, user.uid, value => {
        if (value.localSyncState === 'conflict' && value.localOutboxId) {
          dirtyRef.current = true;
          revisionRef.current = value.revision;
          setConflictOutboxId(value.localOutboxId);
          setConflict(value.localRemoteValue ? { ...value.localRemoteValue, id: remoteId, permission: value.permission } as RemoteNote : value);
          setRemoteNote(value);
          const local = { id: id || remoteId, cloudId: remoteId, title: value.title, body: value.body, createdAt: value.createdAt, updatedAt: value.updatedAt } as Note;
          noteRef.current = local; setNote(local); setLoaded(true); setSyncLabel('পরিবর্তন মিলিয়ে নিন');
          return;
        }
        if (value.localSyncState === 'pending' && value.localOutboxId) {
          dirtyRef.current = true;
          revisionRef.current = value.revision;
          setRemoteNote(value);
          const local = { id: id || remoteId, cloudId: remoteId, title: value.title, body: value.body, createdAt: value.createdAt, updatedAt: value.updatedAt } as Note;
          noteRef.current = local; setNote(local); setLoaded(true); setSyncLabel('ইন্টারনেটের অপেক্ষায় · ডিভাইসে সংরক্ষিত');
          return;
        }
        if (value.localSyncState === 'blocked' && value.localOutboxId) {
          dirtyRef.current = true;
          revisionRef.current = value.revision;
          setRemoteNote(value);
          const local = { id: id || remoteId, cloudId: remoteId, title: value.title, body: value.body, createdAt: value.createdAt, updatedAt: value.updatedAt } as Note;
          noteRef.current = local; setNote(local); setLoaded(true); setSyncLabel('Cloud access সমস্যা · draft ডিভাইসে আছে');
          return;
        }
        if (dirtyRef.current && revisionRef.current + 1 === value.revision && value.updatedBy === user.uid && noteRef.current.title === value.title && noteRef.current.body === value.body) {
          revisionRef.current = value.revision; dirtyRef.current = false; setConflict(null); setConflictOutboxId(''); setRemoteNote(value); setSyncLabel('Cloud-এ সংরক্ষিত'); return;
        }
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
    if (!scope) {
      let active = true;
        void Promise.resolve().then(() => { if (active) { setLoaded(false); setLoadedScopeId(''); setNotes([]); } });
      return () => { active = false; };
    }
    readNotes(scope).then(async parsed => {
      if (!active) return;
      setNotes(parsed);
      setLoadedScopeId(storageScopeId(scope));
      const selected = parsed.find(value => value.id === id);
      if (selected) { noteRef.current = selected; setNote(selected); }
      else if (!id && parsed.length) { noteRef.current = parsed[0]; setNote(parsed[0]); }
      else if (!parsed.length) { const fresh = { ...initialNote, id: `note-${Date.now()}`, createdAt: new Date().toISOString() }; noteRef.current = fresh; setNote(fresh); }
      setLoaded(true);
    }).catch(error => { if (active) { setLoaded(false); setLoadedScopeId(''); Alert.alert('লোকাল নোট পড়া যায়নি', error instanceof Error ? error.message : 'ডাটা অক্ষত আছে; storage যাচাই করে আবার চেষ্টা করুন।'); } });
    return () => { active = false; };
  }, [id, mode, remoteId, scope, user]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const persistRemoteDraft = (draft: Note, expectedRevision: number) => {
    if (!remoteId || !user) return;
    updateRemoteNote(remoteId, user.uid, { title: draft.title, body: draft.body }, expectedRevision).then(result => {
      if (result.queued) { setSyncLabel('ইন্টারনেটের অপেক্ষায় · ডিভাইসে সংরক্ষিত'); return; }
      revisionRef.current = expectedRevision + 1;
      dirtyRef.current = false;
      setSyncLabel('Cloud-এ সংরক্ষিত');
    }).catch(async error => {
      if (error instanceof Error && error.message.includes('অন্য কেউ')) {
        try {
          const remote = error && 'remoteValue' in error && error.remoteValue ? error.remoteValue as RemoteNote : await getRemoteNote(remoteId, user.uid);
          setConflict(remote); setConflictOutboxId('entryId' in error ? String(error.entryId || '') : ''); setSyncLabel('পরিবর্তন মিলিয়ে নিন');
        }
        catch { Alert.alert('পরিবর্তন সংরক্ষণ হয়নি', error.message); }
      } else if (error instanceof Error && error.message.includes('ইন্টারনেট')) setSyncLabel('ইন্টারনেটের অপেক্ষায় · ডিভাইসে সংরক্ষিত');
      else Alert.alert('Cloud-এ সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।');
    });
  };

  const update = (changes: Partial<Note>) => {
    if (!remoteId && !localReady) { Alert.alert('নোট এখনো প্রস্তুত নয়', 'লোকাল ডাটা পড়া শেষ হলে আবার লিখুন।'); return; }
    const next: Note & { id: string } = { ...noteRef.current, ...changes, id: noteRef.current.id || `note-${Date.now()}`, updatedAt: new Date().toISOString() };
    noteRef.current = next; setNote(next);
    if (remoteId && remoteNote && (remoteNote.permission === 'editor' || remoteNote.permission === 'owner')) {
      dirtyRef.current = true; setSyncLabel('পরিবর্তন সংরক্ষণ হচ্ছে…');
      void queueRemoteNoteDraft(remoteId, user!.uid, { title: next.title, body: next.body }, revisionRef.current).then(() => {
        if (dirtyRef.current) setSyncLabel('ইন্টারনেটের অপেক্ষায় · ডিভাইসে সংরক্ষিত');
      }).catch(error => Alert.alert('ডিভাইসে draft রাখা যায়নি', error instanceof Error ? error.message : 'নোট পরিবর্তন বন্ধ রাখুন এবং আবার চেষ্টা করুন।'));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const expectedRevision = revisionRef.current;
      saveTimer.current = setTimeout(() => persistRemoteDraft(noteRef.current, expectedRevision), 800);
      return;
    }
    const nextNotes = notes.some(value => value.id === next.id) ? notes.map(value => value.id === next.id ? next : value) : [next, ...notes];
    setNotes(nextNotes);
    if (localReady && scope) writeNotes(scope, nextNotes).catch(error => Alert.alert('নোট সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'ডাটা অক্ষত আছে; আবার চেষ্টা করুন।'));
  };

  const useCloudVersion = () => {
    if (!conflict) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    revisionRef.current = conflict.revision; dirtyRef.current = false;
    if (conflictOutboxId && user) void resolvePendingCloudChange(user.uid, conflictOutboxId, 'remote').catch(error => Alert.alert('Cloud সংস্করণ বেছে নেওয়া যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'));
    setConflictOutboxId('');
    const next = { id: id || conflict.id, cloudId: conflict.id, title: conflict.title, body: conflict.body, createdAt: conflict.createdAt, updatedAt: conflict.updatedAt } as Note;
    noteRef.current = next; setNote(next); setRemoteNote(conflict); setConflict(null); setSyncLabel('Cloud-এ সংরক্ষিত');
  };
  const keepMyVersion = () => {
    if (!conflict) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    revisionRef.current = conflict.revision; dirtyRef.current = true; setConflict(null);
    if (conflictOutboxId && user) {
      void resolvePendingCloudChange(user.uid, conflictOutboxId, 'local').then(() => flushPendingCloudChanges(user)).then(async result => {
        const remaining = (await getPendingCloudChanges(user.uid)).find(entry => entry.id === conflictOutboxId);
        if (remaining?.status === 'conflict') {
          setConflict({ ...(remaining.remoteValue || {}), id: conflict.id, permission: conflict.permission } as RemoteNote);
          setSyncLabel('আবার conflict হয়েছে—আপনার লেখা রাখা আছে');
          return;
        }
        if (result.pending || remaining) { setSyncLabel('ইন্টারনেটের অপেক্ষায় · ডিভাইসে সংরক্ষিত'); return; }
        revisionRef.current = conflict.revision + 1; dirtyRef.current = false; setConflictOutboxId(''); setSyncLabel('Cloud-এ সংরক্ষিত');
      }).catch(error => Alert.alert('পরিবর্তন সিঙ্ক হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'));
    } else persistRemoteDraft(noteRef.current, conflict.revision);
  };

  const dateText = visibleNote.createdAt ? new Date(visibleNote.createdAt).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' });
  const canEdit = !remoteId || remoteNote?.permission === 'editor' || remoteNote?.permission === 'owner';
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
    <View style={s.header}><Pressable onPress={() => goBackOrReplace(router, remoteId ? '/shared' : '/notes')} hitSlop={10} accessibilityRole="button" accessibilityLabel="পেছনে যান" style={s.back}><ThemedIcon role="primary" style={s.backText}>‹</ThemedIcon></Pressable><Text style={s.headerTitle}>সাধারণ নোট</Text><Pressable disabled={!remoteId && !localReady} onPress={() => setShareOpen(true)} style={s.share}><Text style={s.shareText}>শেয়ার</Text></Pressable></View>
    <KeyboardAvoidingView style={s.editorViewport} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.editor}>
      <TextInput value={visibleNote.title} editable={(remoteId ? loaded : localReady) && canEdit} onChangeText={title => update({ title })} placeholder="নোটের শিরোনাম" style={s.title} />
      <View style={s.metaRow}><View style={s.datePill}><Text style={s.calendar}>▦</Text><Text style={s.dateText}>{dateText}</Text></View><Text style={s.meta}>{remoteId ? syncLabel : 'স্বয়ংক্রিয়ভাবে সংরক্ষিত'}</Text></View>
      <TextInput value={visibleNote.body} editable={(remoteId ? loaded : localReady) && canEdit} onChangeText={body => update({ body })} placeholder="এখানে লিখুন…" multiline textAlignVertical="top" style={[s.body, !canEdit && s.readOnly]} />
      {remoteId && !loaded && <Text style={s.meta}>{accessLostForId === remoteId ? 'এই নোট দেখার অনুমতি নেই।' : 'Cloud থেকে নোট আনা হচ্ছে…'}</Text>}
      {remoteId && remoteNote?.permission === 'viewer' && <Text style={s.viewerNotice}>আপনার অনুমতি শুধু নোট দেখার জন্য।</Text>}
      {remoteId && remoteNote?.localSyncState === 'blocked' && remoteNote.localOutboxId && <Pressable style={s.syncRetry} onPress={() => user && void retryBlockedCloudChange(user, remoteNote.localOutboxId!).then(() => setSyncLabel('সিঙ্কের চেষ্টা চলছে…')).catch(error => Alert.alert('আবার সিঙ্ক হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'))}><Text style={s.syncRetryText}>Cloud-এ সিঙ্ক ব্যর্থ · আবার চেষ্টা করুন</Text></Pressable>}
      {!!conflict && <View style={s.conflict}><Text style={s.conflictTitle}>অন্য একজন নোটটি আগে পরিবর্তন করেছেন</Text><Text style={s.conflictBody}>আপনার লেখাটি এখানে অক্ষত আছে। কোন সংস্করণ রাখবেন?</Text><View style={s.conflictActions}><Pressable onPress={useCloudVersion}><Text style={s.conflictAction}>Cloud সংস্করণ</Text></Pressable><Pressable onPress={keepMyVersion}><Text style={s.conflictAction}>আমার লেখা রাখুন</Text></Pressable></View></View>}
      </View>
    </KeyboardAvoidingView>
    <ShareDialog visible={shareOpen} onClose={() => setShareOpen(false)} kind="note" localId={id || String(note.id || 'note')} resourceId={remoteId || note.cloudId} note={visibleNote} keyboardAvoiding onLinked={setActiveRemoteId} onDeleted={() => { setActiveRemoteId(''); setRemoteNote(null); router.replace('/'); }} />
  </SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#fafaf7' }, header: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#e8e9e3' }, back: { width: 40 }, backText: { color: '#315f47', fontSize: 34 }, headerTitle: { color: '#20231f', fontSize: 18, fontWeight: '600' }, share: { padding: 8 }, shareText: { color: '#315f47', fontSize: 12, fontWeight: '700' }, editorViewport: { flex: 1 }, editor: { flex: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 12 }, title: { borderBottomWidth: 1, borderColor: '#e6e7e1', paddingVertical: 10, color: '#20231f', fontSize: 23, fontWeight: '600' }, metaRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginVertical: 9 }, datePill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 13, backgroundColor: '#e9f4ed' }, calendar: { color: '#36764e', fontSize: 14 }, dateText: { color: '#36764e', fontSize: 12, fontWeight: '600' }, meta: { color: '#858a82', fontSize: 11 }, body: { minHeight: 0, flex: 1, color: '#20231f', fontSize: 17, lineHeight: 29, paddingTop: 8 }, readOnly: { color: '#626860' }, viewerNotice: { padding: 11, borderRadius: 12, color: '#536b57', backgroundColor: '#edf5ee', fontSize: 12 }, syncRetry: { padding: 9, marginTop: 8, borderRadius: 10, backgroundColor: '#fff1d8' }, syncRetryText: { color: '#76531b', fontSize: 11, fontWeight: '700' }, conflict: { marginTop: 16, padding: 14, borderRadius: 14, backgroundColor: '#fff2d7' }, conflictTitle: { color: '#684d1b', fontSize: 14, fontWeight: '700' }, conflictBody: { color: '#735e36', fontSize: 12, marginTop: 5 }, conflictActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 13 }, conflictAction: { color: '#2d744a', fontSize: 12, fontWeight: '700' } });
