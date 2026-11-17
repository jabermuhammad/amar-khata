import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet } from 'react-native';
import { ThemedScrollView as ScrollView, ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, ThemedSafeAreaView as SafeAreaView, ThemedIcon } from '../components/ThemePrimitives';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import { createOwnedList, createOwnedNote, getUserContactProfile, revokeContactShare, shareResourceToContact, updateMemberPermission, watchConnectionHistory, type PublicContactProfile, type ResourceKind } from '../lib/collaboration';
import { goBackOrReplace } from '../lib/navigation.mjs';
import { readLists, readNotes, setScopedCloudLink, storageScopeId } from '../lib/localStorage';
import type { Note, ShoppingList } from '../data';

type SharedResource = { id: string; kind: 'list' | 'note'; resourceId: string; fromUid: string; toUid: string; permission: string; title: string; createdAt?: unknown };

export default function ContactScreen() {
  const { user, scope } = useAuth(); const router = useRouter();
  const { connectionId = '', contactUid = '' } = useLocalSearchParams<{ connectionId: string; contactUid: string }>();
  const [contactValue, setContactValue] = useState<PublicContactProfile | null>(null);
  const [contactContextKey, setContactContextKey] = useState('');
  const [history, setHistory] = useState<SharedResource[]>([]);
  const [historyContextKey, setHistoryContextKey] = useState('');
  const [filter, setFilter] = useState<'all' | ResourceKind>('all');
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerIssue, setPickerIssue] = useState('');
  const [resources, setResources] = useState<PickerResource[]>([]);
  const [resourceFilter, setResourceFilter] = useState<'all' | ResourceKind>('all');
  const [resourceQuery, setResourceQuery] = useState('');
  const [selectedResource, setSelectedResource] = useState('');
  const [permission, setPermission] = useState<'shopper' | 'editor' | 'viewer'>('shopper');
  const [shareBusy, setShareBusy] = useState(false);
  const activeContactKey = `${user?.uid || ''}:${String(connectionId)}:${String(contactUid)}`;
  const contact = contactContextKey === activeContactKey ? contactValue : null;
  const visibleContact = contact;
  useFocusEffect(useCallback(() => {
    let active = true;
    let stopHistory: (() => void) | undefined;
    if (!user || !connectionId || !contactUid) { setLoading(false); setIssue('পরিচিতির তথ্য পাওয়া যায়নি।'); return () => { active = false; }; }
    setLoading(true); setIssue(''); setContactContextKey(''); setHistoryContextKey('');
    setContactValue(null); setHistory([]);
    void getUserContactProfile(String(contactUid), user, String(connectionId)).then(profile => {
      if (!active) return;
      setContactValue(profile || { uid: String(contactUid), username: '', usernameKey: '', displayName: 'পরিচিতি' });
      setContactContextKey(activeContactKey);
      setLoading(false);
      stopHistory = watchConnectionHistory(String(connectionId), user, items => { if (active) { setHistory(items as SharedResource[]); setHistoryContextKey(activeContactKey); } }, error => { if (active) setIssue(error.message || 'শেয়ারিং ইতিহাস পড়া যায়নি।'); }, String(contactUid));
    }).catch(error => { if (active) { setIssue(error instanceof Error ? error.message : 'শেয়ারিং তথ্য পড়া যায়নি।'); setLoading(false); } });
    return () => { active = false; stopHistory?.(); };
  }, [user, connectionId, contactUid, activeContactKey]));

  const revoke = (item: SharedResource) => {
    if (!user || item.fromUid !== user.uid) return;
    Alert.alert('শেয়ার করা access সরাবেন?', `${contact?.displayName || 'পরিচিতি'} আর এই ${item.kind === 'list' ? 'তালিকা' : 'নোট'} খুলতে পারবেন না।`, [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'Access সরান', style: 'destructive', onPress: async () => {
        try { await revokeContactShare(user, String(connectionId), String(contactUid), item.kind, item.resourceId); setHistory(current => current.filter(value => value.id !== item.id)); }
        catch (error) { Alert.alert('Access সরানো যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
      } },
    ]);
  };

  const changePermission = (item: SharedResource) => {
    if (!user || item.fromUid !== user.uid) return;
    const next = item.kind === 'list' ? item.permission === 'editor' ? 'shopper' : 'editor' : item.permission === 'editor' ? 'viewer' : 'editor';
    const roleLabel = next === 'editor' ? 'Editor' : next === 'shopper' ? 'Shopper' : 'Viewer';
    Alert.alert('অনুমতি পরিবর্তন করবেন?', `${contact?.displayName || 'পরিচিতি'} এখন ${roleLabel} অনুমতি পাবেন।`, [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'পরিবর্তন', onPress: async () => {
        try { await updateMemberPermission(item.kind, item.resourceId, user.uid, String(contactUid), next as never); }
        catch (error) { Alert.alert('অনুমতি বদলায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
      } },
    ]);
  };

  const visible = (historyContextKey === activeContactKey ? history : []).filter(item => filter === 'all' || item.kind === filter);
  const open = (item: SharedResource) => router.push(item.kind === 'list' ? { pathname: '/list', params: { remoteId: item.resourceId } } : { pathname: '/note', params: { remoteId: item.resourceId } });
  const showPicker = async () => {
    if (!user || !scope) { Alert.alert('ডিভাইসের data পাওয়া যায়নি', 'বর্তমান local storage scope যাচাই করে আবার চেষ্টা করুন।'); return; }
    setPickerOpen(true); setPickerLoading(true); setPickerIssue(''); setSelectedResource(''); setPermission('shopper');
    try {
      const [lists, notes] = await Promise.all([readLists(scope), readNotes(scope)]);
      const values: PickerResource[] = [
        ...Object.entries(lists).map(([id, list]) => ({ id, kind: 'list' as const, title: list.title, subtitle: `${list.items.length}টি পণ্য`, cloudId: list.cloudId, list })),
        ...notes.map(note => ({ id: String(note.id), kind: 'note' as const, title: note.title, subtitle: note.body.trim().slice(0, 80) || 'নোটের লেখা', cloudId: note.cloudId, note })),
      ].filter(value => value.title.trim());
      setResources(values);
    } catch (error) { setPickerIssue(error instanceof Error ? error.message : 'লোকাল তালিকা ও নোট পড়া যায়নি।'); }
    finally { setPickerLoading(false); }
  };
  const shareSelected = async () => {
    if (!user || !scope || !visibleContact || !connectionId || !selectedResource) return;
    if (!user.emailVerified) { Alert.alert('ইমেইল যাচাই করুন', 'শেয়ার করার আগে Firebase account-এর ইমেইল যাচাই করুন।'); return; }
    const resource = resources.find(item => `${item.kind}:${item.id}` === selectedResource);
    if (!resource) return;
    setShareBusy(true);
    try {
      let cloudId = resource.cloudId;
      if (!cloudId) {
        const stableId = `local-${encodeURIComponent(user.uid)}-${encodeURIComponent(storageScopeId(scope))}-${resource.kind}-${encodeURIComponent(resource.id)}`;
        cloudId = resource.kind === 'list'
          ? await createOwnedList(user, resource.list!, stableId)
          : await createOwnedNote(user, { ...resource.note!, id: resource.id }, stableId);
        await setScopedCloudLink(scope, resource.kind === 'list' ? 'lists' : 'notes', resource.id, cloudId, resource.kind === 'list' ? resource.list : resource.note);
      }
      await shareResourceToContact(user, String(connectionId), String(contactUid), resource.kind, cloudId, permission, resource.title);
      setPickerOpen(false);
      Alert.alert('শেয়ার সম্পন্ন', `${visibleContact.displayName}-এর সঙ্গে “${resource.title}” শেয়ার হয়েছে।`);
    } catch (error) { Alert.alert('শেয়ার করা যায়নি', error instanceof Error ? error.message : 'ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।'); }
    finally { setShareBusy(false); }
  };
  const filteredResources = resources.filter(item => (resourceFilter === 'all' || item.kind === resourceFilter) && `${item.title} ${item.subtitle}`.toLowerCase().includes(resourceQuery.trim().toLowerCase()));
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right', 'bottom']}>
    <View style={s.header}><Pressable style={s.backButton} hitSlop={10} onPress={() => goBackOrReplace(router, '/shared')} accessibilityRole="button" accessibilityLabel="পরিচিতির তালিকায় ফিরুন"><ThemedIcon role="primary" style={s.back}>‹</ThemedIcon></Pressable><View style={s.avatar}><ThemedIcon role="primary" style={s.avatarText}>{visibleContact?.displayName.slice(0, 1) || '•'}</ThemedIcon></View><View style={s.identity}><Text numberOfLines={1} style={s.name}>{visibleContact?.displayName || 'পরিচিতি'}</Text><Text style={s.handle}>{visibleContact ? `@${visibleContact.username} · অনুমোদিত পরিচিতি` : 'শেয়ারিং সংযোগ'}</Text></View><Pressable onPress={showPicker} style={extra.shareAction} accessibilityRole="button" accessibilityLabel="তালিকা বা নোট শেয়ার করুন"><ThemedIcon role="primary" style={extra.shareActionIcon}>＋</ThemedIcon></Pressable></View>
    <View style={s.tabs}>{(['all', 'list', 'note'] as const).map((value, index) => <Pressable key={value} onPress={() => setFilter(value)} style={[s.tab, filter === value && s.activeTab]}><Text style={[s.tabText, filter === value && s.activeTabText]}>{['সব', 'তালিকা', 'নোট'][index]}</Text></Pressable>)}</View>
    {loading || contactContextKey !== activeContactKey ? <ActivityIndicator style={s.loader} color="#087b69" /> : issue ? <View style={s.empty}><Text style={s.emptyTitle}>ইতিহাস লোড হয়নি</Text><Text style={s.muted}>{issue}</Text></View> : <ScrollView contentContainerStyle={s.timeline}>
      <Text style={s.systemNote}>আপনারা অনুমোদিত পরিচিতি। প্রতিটি resource-এর access আলাদাভাবে নিয়ন্ত্রিত।</Text>
      {visible.length ? visible.map(item => { const outgoing = item.fromUid === user?.uid; return <View key={item.id} style={[s.line, outgoing ? s.outgoing : s.incoming]}><View style={[s.card, outgoing ? s.outCard : s.inCard]}><View style={s.cardKicker}><ThemedIcon role={item.kind === 'list' ? 'primary' : 'informational'} style={s.resourceGlyph}>{item.kind === 'list' ? '▤' : '▧'}</ThemedIcon><Text style={s.kind}>{item.kind === 'list' ? 'শেয়ার করা তালিকা' : 'শেয়ার করা নোট'}</Text><Text style={s.role}>{permissionLabel(item.permission)}</Text></View><Text numberOfLines={2} style={s.title}>{item.title || (item.kind === 'list' ? 'বাজারের তালিকা' : 'সাধারণ নোট')}</Text><Text style={s.muted}>{outgoing ? `${contact?.displayName || 'পরিচিতি'}-কে পাঠানো` : `${contact?.displayName || 'পরিচিতি'} আপনার সঙ্গে শেয়ার করেছেন`}</Text><Text style={extra.time}>{formatSharedAt(item.createdAt)}</Text><Pressable onPress={() => open(item)} style={s.open}><Text style={s.openText}>{item.kind === 'list' ? 'তালিকা খুলুন' : 'নোট খুলুন'}  ›</Text></Pressable>{outgoing && <View style={s.actions}><Pressable onPress={() => changePermission(item)} style={s.action}><Text style={s.actionText}>অনুমতি বদলান</Text></Pressable><Pressable onPress={() => revoke(item)} style={s.action}><Text style={s.revokeText}>Access সরান</Text></Pressable></View>}</View></View>; }) : <View style={s.empty}><Text style={s.emptyTitle}>{filter === 'list' ? 'এখনো কোনো তালিকা শেয়ার হয়নি' : filter === 'note' ? 'এখনো কোনো নোট শেয়ার হয়নি' : 'এখনো কোনো resource শেয়ার হয়নি'}</Text><Text style={s.muted}>আপনার কোনো তালিকা বা নোট এই পরিচিতির সঙ্গে শেয়ার করা হলে এখানে দেখা যাবে।</Text><Pressable onPress={showPicker} style={s.open}><Text style={s.openText}>একটি তালিকা বা নোট শেয়ার করুন</Text></Pressable></View>}
    </ScrollView>}
    <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
      <View style={extra.modalScrim}><View style={extra.pickerSheet}><View style={extra.pickerHeader}><View style={{ flex: 1 }}><Text style={extra.pickerTitle}>{visibleContact?.displayName || 'পরিচিতি'}-কে শেয়ার করুন</Text><Text style={s.muted}>আপনার scoped storage-এর বিদ্যমান তালিকা বা নোট বেছে নিন</Text></View><Pressable onPress={() => setPickerOpen(false)} accessibilityLabel="বন্ধ করুন"><ThemedIcon role="secondary" style={extra.closeIcon}>×</ThemedIcon></Pressable></View>
        <View style={extra.pickerFilters}>{(['all', 'list', 'note'] as const).map((value, index) => <Pressable key={value} onPress={() => { setResourceFilter(value); setSelectedResource(''); }} style={[extra.filterButton, resourceFilter === value && extra.filterButtonActive]}><Text style={[extra.filterText, resourceFilter === value && extra.filterTextActive]}>{['সব', 'তালিকা', 'নোট'][index]}</Text></Pressable>)}</View>
        <TextInput value={resourceQuery} onChangeText={setResourceQuery} placeholder="তালিকা বা নোট খুঁজুন" style={extra.resourceSearch} />
        {pickerLoading ? <ActivityIndicator style={s.loader} /> : pickerIssue ? <Text style={extra.pickerError}>{pickerIssue}</Text> : <ScrollView style={extra.pickerList} keyboardShouldPersistTaps="handled">{filteredResources.length ? filteredResources.map(item => { const key = `${item.kind}:${item.id}`; const selected = selectedResource === key; const existing = history.find(entry => entry.kind === item.kind && entry.resourceId === item.cloudId && entry.fromUid === user?.uid && entry.toUid === contactUid); return <Pressable key={key} onPress={() => { setSelectedResource(key); setPermission(item.kind === 'list' ? 'shopper' : 'viewer'); }} style={[extra.resourceChoice, selected && extra.resourceChoiceActive]}><View style={{ flex: 1 }}><Text numberOfLines={1} style={s.title}>{item.title}</Text><Text numberOfLines={1} style={s.muted}>{item.kind === 'list' ? 'তালিকা' : 'নোট'} · {item.subtitle}{item.cloudId ? ' · Cloud-এ যুক্ত' : ' · শুধু এই ডিভাইসে'}{existing ? ` · আগে ${permissionLabel(existing.permission)} হিসেবে শেয়ার করা` : ''}</Text></View><ThemedIcon role={selected ? 'success' : 'secondary'} style={extra.check}>{selected ? '✓' : '○'}</ThemedIcon></Pressable>; }) : <Text style={s.muted}>{resourceQuery ? 'মিলেছে এমন resource নেই।' : 'শেয়ার করার মতো স্থানীয় তালিকা বা নোট নেই।'}</Text>}</ScrollView>}
        {!!selectedResource && <><Text style={extra.permissionLabel}>অনুমতি</Text><View style={extra.pickerFilters}>{(resources.find(item => `${item.kind}:${item.id}` === selectedResource)?.kind === 'list' ? [['shopper', 'Shopper'], ['editor', 'Editor']] : [['viewer', 'Viewer'], ['editor', 'Editor']]).map(([value, label]) => <Pressable key={value} onPress={() => setPermission(value as typeof permission)} style={[extra.filterButton, permission === value && extra.filterButtonActive]}><Text style={[extra.filterText, permission === value && extra.filterTextActive]}>{label}</Text></Pressable>)}</View><Text style={s.muted}>{permission === 'shopper' ? 'Shopper পণ্যের অবস্থা ও দাম বদলাতে পারবেন; তালিকার কাঠামো নয়।' : permission === 'viewer' ? 'Viewer নোট পড়তে পারবেন, সম্পাদনা করতে পারবেন না।' : 'Editor resource সম্পাদনা করতে পারবেন।'}</Text></>}
        <Pressable disabled={!selectedResource || shareBusy || pickerLoading} onPress={shareSelected} style={[extra.shareConfirm, (!selectedResource || shareBusy) && { opacity: 0.55 }]}>{shareBusy ? <ActivityIndicator color="#fff" /> : <Text style={extra.shareConfirmText}>শেয়ার করুন</Text>}</Pressable>
      </View></View>
    </Modal>
  </SafeAreaView>;
}

type PickerResource = { id: string; kind: ResourceKind; title: string; subtitle: string; cloudId?: string; list?: ShoppingList; note?: Note };
function permissionLabel(permission: string) { return ({ owner: 'Owner', editor: 'Editor', shopper: 'Shopper', viewer: 'Viewer' } as Record<string, string>)[permission] || 'অনুমতি'; }
function formatSharedAt(value: unknown) { const date = value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function' ? (value as { toDate: () => Date }).toDate() : typeof value === 'string' ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date.toLocaleString('bn-BD', { dateStyle: 'medium', timeStyle: 'short' }) : 'সময় তথ্য পাওয়া যায়নি'; }

const extra = StyleSheet.create({
  shareAction: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#e7f0ed' }, shareActionIcon: { fontSize: 24 }, time: { marginTop: 6, color: '#8a948f', fontSize: 9 },
  modalScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }, pickerSheet: { maxHeight: '88%', padding: 16, paddingBottom: 22, backgroundColor: '#fbfbf8', borderTopLeftRadius: 22, borderTopRightRadius: 22 }, pickerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }, pickerTitle: { color: '#17211f', fontSize: 16, fontWeight: '700' }, closeIcon: { fontSize: 26, paddingHorizontal: 5 }, pickerFilters: { flexDirection: 'row', gap: 8, marginBottom: 9 }, filterButton: { minHeight: 36, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#f0f5f3' }, filterButtonActive: { backgroundColor: '#d9f1eb' }, filterText: { color: '#677471', fontSize: 11 }, filterTextActive: { color: '#087b69', fontWeight: '700' }, resourceSearch: { minHeight: 43, paddingHorizontal: 11, marginBottom: 8, borderRadius: 11, backgroundColor: '#f0f5f3', color: '#17211f' }, pickerList: { flexGrow: 0, minHeight: 80, maxHeight: 310 }, pickerError: { color: '#96363d', paddingVertical: 12 }, resourceChoice: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, marginBottom: 6, borderWidth: 1, borderColor: '#e1e9e6', borderRadius: 12, backgroundColor: '#fff' }, resourceChoiceActive: { borderColor: '#27804d', backgroundColor: '#eef7f0' }, check: { fontSize: 19 }, permissionLabel: { marginTop: 12, marginBottom: 7, color: '#17211f', fontSize: 12, fontWeight: '700' }, shareConfirm: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 13, borderRadius: 12, backgroundColor: '#087b69' }, shareConfirmText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#f8faf9' }, header: { minHeight: 66, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, gap: 8, borderBottomWidth: 1, borderColor: '#e1e9e6', backgroundColor: '#fff' }, backButton: { width: 37, height: 48, justifyContent: 'center' }, back: { color: '#087b69', fontSize: 35, lineHeight: 42 }, avatar: { width: 42, height: 42, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#d9f1eb' }, avatarText: { color: '#087b69', fontSize: 18, fontWeight: '700' }, identity: { flex: 1, minWidth: 0 }, name: { color: '#17211f', fontSize: 13, fontWeight: '700' }, handle: { color: '#087b69', fontSize: 9, marginTop: 2 }, tabs: { height: 45, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 15, borderBottomWidth: 1, borderColor: '#e1e9e6', backgroundColor: '#fff' }, tab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 15 }, activeTab: { backgroundColor: '#d9f1eb' }, tabText: { color: '#677471', fontSize: 10 }, activeTabText: { color: '#087b69', fontWeight: '700' }, loader: { marginTop: 35 }, timeline: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 28 }, systemNote: { alignSelf: 'center', maxWidth: 270, paddingHorizontal: 11, paddingVertical: 7, marginBottom: 14, borderRadius: 12, backgroundColor: '#fff', color: '#677471', fontSize: 9, textAlign: 'center' }, line: { width: '100%', marginBottom: 10, flexDirection: 'row' }, outgoing: { justifyContent: 'flex-end' }, incoming: { justifyContent: 'flex-start' }, card: { width: '85%', padding: 12, borderWidth: 1, borderColor: '#e1e9e6', borderRadius: 16, backgroundColor: '#fff' }, inCard: { borderBottomLeftRadius: 5 }, outCard: { borderBottomRightRadius: 5, backgroundColor: '#e0f3ee' }, cardKicker: { flexDirection: 'row', alignItems: 'center', gap: 6 }, resourceGlyph: { color: '#087b69', fontSize: 16 }, kind: { flex: 1, color: '#677471', fontSize: 9 }, role: { color: '#087b69', fontSize: 9, fontWeight: '700' }, title: { color: '#17211f', fontSize: 13, fontWeight: '700', marginTop: 8, marginBottom: 4 }, muted: { color: '#677471', fontSize: 10, lineHeight: 15 }, open: { minHeight: 34, alignItems: 'center', justifyContent: 'center', marginTop: 9, borderRadius: 10, backgroundColor: '#d9f1eb' }, openText: { color: '#087b69', fontSize: 10, fontWeight: '700' }, actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }, action: { paddingVertical: 5 }, actionText: { color: '#087b69', fontSize: 9, fontWeight: '700' }, revoke: { alignSelf: 'flex-end', marginTop: 7, padding: 4 }, revokeText: { color: '#b33a45', fontSize: 9, fontWeight: '700' }, empty: { alignItems: 'center', paddingHorizontal: 25, paddingVertical: 40 }, emptyTitle: { color: '#17211f', fontSize: 13, fontWeight: '700', textAlign: 'center' },
});
