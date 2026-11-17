import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { ThemedScrollView as ScrollView, ThemedText as Text, ThemedView as View, ThemedSafeAreaView as SafeAreaView, ThemedIcon } from '../components/ThemePrimitives';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import type { ShoppingList } from '../data';
import { deleteOwnedResource, loadResourceSummaries } from '../lib/collaboration';
import { deleteScopedCloudResource, deleteScopedLocalResource, readLists, storageScopeId } from '../lib/localStorage';
import { mayDeleteResource } from '../lib/themePolicy.mjs';
import { getListScreenState } from '../lib/listScreenPolicy.mjs';
import { goBackOrReplace } from '../lib/navigation.mjs';
import { formatResourceSummaryIssues } from '../lib/ownedResourceService.mjs';

type ListEntry = { id: string; list: ShoppingList; permission?: string; cloudId?: string };
const dateLabel = (value?: string) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export default function ListsScreen() {
  const router = useRouter();
  const { user, mode, scope } = useAuth();
  const [localRows, setLocalRows] = useState<ListEntry[]>([]);
  const [remoteRows, setRemoteRows] = useState<ListEntry[]>([]);
  const [localLoading, setLocalLoading] = useState(true);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [remoteError, setRemoteError] = useState('');
  const [retry, setRetry] = useState(0);
  const [readyScope, setReadyScope] = useState('');
  const scopeId = scope ? storageScopeId(scope) : '';
  const scopeIdRef = useRef(scopeId);
  useEffect(() => { scopeIdRef.current = scopeId; }, [scopeId]);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLocalRows([]); setRemoteRows([]); setReadyScope('');
    setLocalError(''); setRemoteError('');
    setLocalLoading(Boolean(scope) || mode === 'loading' || retry > 0);
    const shouldLoadRemote = mode === 'account' && Boolean(user);
    setRemoteLoading(shouldLoadRemote);
    if (scope) {
      void readLists(scope).then(value => {
        if (!active) return;
        setLocalRows(Object.entries(value).filter(([, list]) => !list.cloudId && (list.title.trim() || list.items.length)).map(([id, list]) => ({ id, list })));
        setReadyScope(scopeId);
      }).catch(error => {
        if (active) setLocalError(error instanceof Error ? error.message : 'লোকাল তালিকা পড়া যায়নি।');
      }).finally(() => { if (active) setLocalLoading(false); });
    } else {
      if (mode !== 'loading') {
        setLocalLoading(false);
        setLocalError('ব্যবহারকারীর local storage scope পাওয়া যায়নি।');
      }
    }
    if (shouldLoadRemote && user) {
      void loadResourceSummaries(user.uid).then(result => {
        if (!active) return;
        setRemoteRows(result.summaries.filter(value => value.kind === 'list').map(value => ({ id: value.id, cloudId: value.id, permission: value.permission, list: { title: value.title, category: value.category as ShoppingList['category'], items: [] } })));
        setRemoteError(formatResourceSummaryIssues(result.issues));
      }).catch(error => {
        if (active) setRemoteError(error instanceof Error ? error.message : 'Cloud তালিকা পড়া যায়নি।');
      }).finally(() => { if (active) setRemoteLoading(false); });
    }
    return () => { active = false; };
  }, [mode, scope, scopeId, user, retry]));

  const rows = useMemo(() => [...localRows, ...remoteRows], [localRows, remoteRows]);

  const confirmDelete = (entry: ListEntry) => {
    const localOnly = !entry.cloudId && !entry.list.cloudId;
    const scopeMatches = localOnly ? Boolean(scope && scopeIdRef.current === readyScope) : Boolean(user && scope?.kind === 'user' && scope.uid === user.uid);
    if (!mayDeleteResource({ local: localOnly, cloudLinked: !localOnly, permission: entry.permission, currentScopeMatches: scopeMatches }) || (!localOnly && !user)) return;
    const label = entry.list.title || 'শিরোনামহীন তালিকা';
    Alert.alert(localOnly ? 'তালিকাটি মুছবেন?' : 'Cloud তালিকাটি স্থায়ীভাবে মুছবেন?', `“${label}” ${localOnly ? 'শুধু এই ডিভাইস থেকে মুছে যাবে।' : 'এবং এর shared members ও items মুছে যাবে।'}`, [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'মুছুন', style: 'destructive', onPress: () => { void (async () => {
        try {
          if (localOnly) {
            if (!scope || scopeIdRef.current !== readyScope) throw new Error('Storage scope বদলেছে; তালিকা রিফ্রেশ করে আবার চেষ্টা করুন।');
            await deleteScopedLocalResource(scope, 'lists', entry.id);
          } else {
            if (!user) throw new Error('এই account আর সক্রিয় নেই।');
            await deleteOwnedResource('list', entry.cloudId!, user.uid);
            if (scopeIdRef.current !== readyScope) { Alert.alert('Cloud তালিকা মোছা হয়েছে', 'Account বদলে যাওয়ায় পুরোনো scope-এর local link রাখা হয়েছে; নতুন account-এর data অপরিবর্তিত আছে।'); return; }
            if (scope && scopeIdRef.current === readyScope) {
              const linked = (await readLists(scope));
              const linkedId = Object.keys(linked).find(id => linked[id].cloudId === entry.cloudId);
              if (linkedId) await deleteScopedCloudResource(scope, 'lists', linkedId, entry.cloudId!);
            }
          }
          setLocalRows(current => current.filter(row => !(row.id === entry.id && row.cloudId === entry.cloudId)));
          setRemoteRows(current => current.filter(row => !(row.id === entry.id && row.cloudId === entry.cloudId)));
        } catch (error) { Alert.alert('তালিকা মোছা সম্পূর্ণ হয়নি', error instanceof Error ? error.message : 'ডাটা অক্ষত রেখে আবার চেষ্টা করুন।'); }
      })(); } },
    ]);
  };
  const create = () => router.push({ pathname: '/list', params: { id: `list-${Date.now()}`, startAdd: '1', category: 'today' } });
  const current = Boolean(scopeId) && readyScope === scopeId;
  const listState = getListScreenState({ rows, localLoading, remoteLoading, localError: localError || null, remoteError: remoteError || null });
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
    <View style={s.header}><Pressable onPress={() => goBackOrReplace(router, '/')} hitSlop={10} accessibilityRole="button" accessibilityLabel="হোমে ফিরে যান" style={s.back}><ThemedIcon role="primary" style={s.backText}>‹</ThemedIcon></Pressable><Text style={s.heading}>তালিকা</Text><Pressable onPress={create} style={s.add} accessibilityLabel="নতুন বাজারের তালিকা"><ThemedIcon role="primary" style={s.addText}>＋</ThemedIcon></Pressable></View>
    <ScrollView contentContainerStyle={s.content}>
      {(localError || remoteError) && <View style={s.errorCard}><Text style={s.errorTitle}>তালিকা সম্পূর্ণভাবে লোড হয়নি</Text>{localError ? <Text style={s.errorText}>ডিভাইসের তালিকা: {localError}</Text> : null}{remoteError ? <Text style={s.errorText}>Cloud তালিকা: {remoteError}</Text> : null}<Pressable onPress={() => setRetry(value => value + 1)} style={s.retry}><Text style={s.retryText}>আবার চেষ্টা করুন</Text></Pressable></View>}
      {listState === 'loading' && <Text style={s.muted}>তালিকা লোড হচ্ছে…</Text>}
      {listState === 'content' && rows.map(entry => <View key={`${entry.cloudId ? 'cloud' : 'local'}-${entry.id}`} style={s.row}>
        <Pressable style={s.rowOpen} onPress={() => router.push(entry.cloudId ? { pathname: '/list', params: { remoteId: entry.cloudId } } : { pathname: '/list', params: { id: entry.id } })}>
          <Text numberOfLines={1} style={s.title}>{entry.list.title || 'শিরোনামহীন তালিকা'}</Text><Text style={s.meta}>{dateLabel(entry.list.createdAt)}{entry.permission ? ` · ${entry.permission}` : ''}</Text>
        </Pressable>
        {mayDeleteResource({ local: !entry.cloudId, cloudLinked: Boolean(entry.cloudId), permission: entry.permission, currentScopeMatches: entry.cloudId ? Boolean(user && scope?.kind === 'user' && scope.uid === user.uid) : current }) && <Pressable style={s.more} onPress={() => confirmDelete(entry)} accessibilityRole="button" accessibilityLabel="তালিকা মুছুন"><Text style={s.moreText}>⋮</Text></Pressable>}
      </View>)}
      {listState === 'empty' && <View style={s.empty}><Text style={s.emptyTitle}>এখনো কোনো তালিকা নেই</Text><Text style={s.muted}>＋ চাপ দিয়ে নতুন বাজারের তালিকা তৈরি করুন।</Text></View>}
    </ScrollView>
    <Pressable style={s.fab} onPress={create} accessibilityLabel="নতুন তালিকা"><Text style={s.fabText}>＋</Text></Pressable>
  </SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#fafaf7' }, header: { height: 60, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#e8e9e3' }, back: { width: 40, minHeight: 44, justifyContent: 'center' }, backText: { color: '#315f47', fontSize: 34 }, heading: { color: '#20231f', fontSize: 19, fontWeight: '700' }, add: { width: 40, alignItems: 'flex-end' }, addText: { color: '#27804d', fontSize: 30 }, content: { padding: 16, paddingBottom: 150 }, row: { minHeight: 74, flexDirection: 'row', alignItems: 'center', marginBottom: 9, paddingLeft: 15, borderRadius: 14, borderWidth: 1, borderColor: '#e5e9e1', backgroundColor: '#fff' }, rowOpen: { flex: 1, justifyContent: 'center', minHeight: 65 }, title: { color: '#263129', fontSize: 15, fontWeight: '600' }, meta: { color: '#7d857c', fontSize: 11, marginTop: 5 }, more: { width: 43, height: 54, alignItems: 'center', justifyContent: 'center' }, moreText: { color: '#737e75', fontSize: 24 }, muted: { color: '#818a82', fontSize: 13, textAlign: 'center', marginTop: 20 }, errorCard: { padding: 14, marginBottom: 14, borderRadius: 12, borderWidth: 1, borderColor: '#e4c7c7', backgroundColor: '#fff8f7' }, errorTitle: { color: '#8b3737', fontSize: 13, fontWeight: '700' }, errorText: { color: '#684747', fontSize: 11, marginTop: 5 }, retry: { alignSelf: 'flex-start', marginTop: 9, paddingVertical: 5 }, retryText: { color: '#315f47', fontSize: 12, fontWeight: '700' }, empty: { padding: 24, marginTop: 30, alignItems: 'center', gap: 9, borderRadius: 15, backgroundColor: '#fff' }, emptyTitle: { color: '#29312b', fontSize: 16, fontWeight: '700' }, fab: { position: 'absolute', right: 22, bottom: 86, width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 29, backgroundColor: '#2aab6d', elevation: 5 }, fabText: { color: '#fff', fontSize: 32, lineHeight: 37 } });
