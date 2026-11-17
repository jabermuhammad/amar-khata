import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Modal, StyleSheet } from 'react-native';
import { ThemedScrollView as ScrollView, ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, ThemedSafeAreaView as SafeAreaView, ThemedIcon } from '../components/ThemePrimitives';
import { bn, normalizeStoredLists, removeEmptyLocalListDrafts, type ListId, type Note, type ShoppingList, type Status } from '../data';
import ShoppingCartIcon from '../components/ShoppingCartIcon';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import ShareDialog from '../components/ShareDialog';
import { useAuth } from '../contexts/AuthContext';
import { deleteOwnedResource, loadResourceSummaries } from '../lib/collaboration';
import { formatResourceSummaryIssues } from '../lib/ownedResourceService.mjs';
import { deleteScopedCloudResource, deleteScopedLocalResource, readLists, readNotes, storageScopeId, writeLists } from '../lib/localStorage';

type RemoteSummary = Awaited<ReturnType<typeof loadResourceSummaries>>['summaries'][number];
type HomeCategory = 'list' | 'notebook';

const normalizeSearch = (value: string) => value.toLocaleLowerCase().replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit))).trim();
const noteDateTerms = (value?: string) => {
  if (!value) return [];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return [];
  return [
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    date.toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }),
    date.toLocaleDateString('en-GB'),
    `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`,
    `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`,
  ].map(normalizeSearch);
};
const noteDateLabel = (value?: string) => value ? new Date(value).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export default function HomeScreen() {
  const router = useRouter();
  const { user, scope, mode } = useAuth();
  const currentScopeId = scope ? storageScopeId(scope) : '';
  const scopeIdRef = useRef(currentScopeId);
  useEffect(() => { scopeIdRef.current = currentScopeId; }, [currentScopeId]);
  const [lists, setLists] = useState<Record<ListId, ShoppingList>>({});
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<HomeCategory | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [remoteResources, setRemoteResources] = useState<RemoteSummary[]>([]);
  const [remoteLoadIssue, setRemoteLoadIssue] = useState('');
  useFocusEffect(useCallback(() => {
    let active = true;
    setLists({}); setNotes([]); setRemoteResources([]); setRemoteLoadIssue('');
    const localLoad = scope ? Promise.all([readLists(scope), readNotes(scope)]).then(async ([storedLists, savedNotes]) => {
      if (!active) return;
      const datedLists = removeEmptyLocalListDrafts(Object.fromEntries(Object.entries(normalizeStoredLists(storedLists)).map(([id, list]) => [id, { ...list, createdAt: list.createdAt || (list.title.trim() ? new Date().toISOString() : undefined) }])));
      setLists(datedLists);
      if (JSON.stringify(storedLists) !== JSON.stringify(datedLists)) await writeLists(scope, datedLists).catch(() => {});
      setNotes(savedNotes);
    }).catch(() => {}) : Promise.resolve();
    const remoteLoad = mode === 'account' && user ? loadResourceSummaries(user.uid).then(result => { if (active) { setRemoteResources(result.summaries); setRemoteLoadIssue(formatResourceSummaryIssues(result.issues)); } }).catch(error => { if (active) { setRemoteResources([]); setRemoteLoadIssue(error instanceof Error ? error.message : 'Cloud তালিকা ও নোট পড়া যায়নি।'); } }) : Promise.resolve();
    Promise.all([localLoad, remoteLoad]).catch(() => {});
    return () => { active = false; };
  }, [mode, scope, user]));
  const openList = (id: ListId) => lists[id]?.cloudId ? router.push({ pathname: '/list', params: { remoteId: lists[id].cloudId } }) : router.push({ pathname: '/list', params: { id } });
  const listIds = Object.keys(lists).filter(id => !lists[id]?.cloudId && (Boolean(lists[id]?.title.trim()) || Boolean(lists[id]?.items.length)));
  const remoteLists = remoteResources.filter(item => item.kind === 'list');
  const categoryIds: HomeCategory[] = ['list', 'notebook'];
  const activeCategory = selectedCategory && categoryIds.includes(selectedCategory) ? selectedCategory : null;
  const notebookSelected = activeCategory === 'notebook';
  const visibleIds = listIds.filter(id => {
    const list = lists[id];
    if (!list || notebookSelected) return false;
    const statusMatch = statusFilter === 'all' || list.items.some(item => item.status === statusFilter);
    const needle = normalizeSearch(query);
    const searchMatch = !needle || normalizeSearch(`${list.title} ${list.items.map(item => item.name).join(' ')}`).includes(needle);
    return statusMatch && searchMatch;
  });
  const matchingNotes = useMemo(() => {
    const needle = normalizeSearch(query);
    return [...notes].filter(note => !note.cloudId).filter(note => !needle || normalizeSearch(note.title).includes(needle) || noteDateTerms(note.createdAt).some(term => term.includes(needle))).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [notes, query]);
  const matchingRemote = remoteResources.filter(item => {
    const needle = normalizeSearch(query);
    const textMatch = !needle || normalizeSearch(item.title).includes(needle) || noteDateTerms(typeof item.date === 'string' ? item.date : undefined).some(term => term.includes(needle));
    return textMatch;
  });
  const createList = () => setAddMenuOpen(true);
  const createMarketList = () => {
    setAddMenuOpen(false);
    const id = `list-${Date.now()}`;
    router.push({ pathname: '/list', params: { id, startAdd: '1', category: 'today' } });
  };
  const createNotebookNote = () => { setAddMenuOpen(false); router.push('/notes'); };
  const deleteLocalList = (id: string) => Alert.alert('তালিকাটি মুছবেন?', 'এই তালিকাটি শুধু এই ডিভাইসের বর্তমান space থেকে মুছে যাবে।', [
    { text: 'বাতিল', style: 'cancel' }, { text: 'মুছুন', style: 'destructive', onPress: () => { void (async () => {
      try { if (!scope || scopeIdRef.current !== currentScopeId) throw new Error('Storage scope বদলেছে; তালিকা রিফ্রেশ করে আবার চেষ্টা করুন।'); await deleteScopedLocalResource(scope, 'lists', id); setLists(current => { const next = { ...current }; delete next[id]; return next; }); }
      catch (error) { Alert.alert('তালিকা মোছা যায়নি', error instanceof Error ? error.message : 'ডাটা অক্ষত আছে; আবার চেষ্টা করুন।'); }
    })(); } },
  ]);
  const deleteCloudList = (id: string) => Alert.alert('Cloud তালিকাটি স্থায়ীভাবে মুছবেন?', 'এই তালিকা, এর items ও shared access মুছে যাবে।', [
    { text: 'বাতিল', style: 'cancel' }, { text: 'স্থায়ীভাবে মুছুন', style: 'destructive', onPress: () => { void (async () => {
      try {
        if (!user) throw new Error('এই account আর সক্রিয় নেই.');
        await deleteOwnedResource('list', id, user.uid);
        if (scopeIdRef.current !== currentScopeId) { Alert.alert('Cloud তালিকা মোছা হয়েছে', 'Account বদলে যাওয়ায় বর্তমান screen-এর নতুন account data অপরিবর্তিত রাখা হয়েছে। পুরোনো scope-এর local link রয়ে গেছে।'); return; }
        if (scope && scopeIdRef.current === currentScopeId) {
          const linked = await readLists(scope);
          const localId = Object.keys(linked).find(key => linked[key].cloudId === id);
          if (localId) await deleteScopedCloudResource(scope, 'lists', localId, id);
        }
        setRemoteResources(current => current.filter(item => item.id !== id));
      } catch (error) { Alert.alert('Cloud তালিকা মোছা সম্পূর্ণ হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
    })(); } },
  ]);
  const deleteNote = (note: Note & { id: string }, remote?: RemoteSummary) => {
    const cloudId = remote?.id || note.cloudId;
    if (cloudId && (!user || remote?.permission !== 'owner')) return;
    Alert.alert(cloudId ? 'Cloud নোটটি মুছবেন?' : 'নোটটি মুছবেন?', cloudId ? 'নোটটি এবং এর shared access স্থায়ীভাবে মুছে যাবে।' : 'নোটটি এই ডিভাইস থেকে মুছে যাবে।', [
      { text: 'বাতিল', style: 'cancel' }, { text: 'মুছুন', style: 'destructive', onPress: () => { void (async () => {
        try {
          if (cloudId) {
            if (!user) throw new Error('এই account আর সক্রিয় নেই।');
            await deleteOwnedResource('note', cloudId, user.uid);
            if (scopeIdRef.current !== currentScopeId) { Alert.alert('Cloud নোট মোছা হয়েছে', 'Account বদলে যাওয়ায় বর্তমান screen-এর নতুন account data অপরিবর্তিত রাখা হয়েছে। পুরোনো scope-এর local link রয়ে গেছে।'); return; }
            if (scope && scopeIdRef.current === currentScopeId) { const linked = (await readNotes(scope)).find(value => value.cloudId === cloudId); if (linked) await deleteScopedCloudResource(scope, 'notes', linked.id, cloudId); }
            setRemoteResources(current => current.filter(value => value.id !== cloudId));
          } else {
            if (!scope || scopeIdRef.current !== currentScopeId) throw new Error('Storage scope বদলেছে; নোট রিফ্রেশ করে আবার চেষ্টা করুন।');
            await deleteScopedLocalResource(scope, 'notes', note.id);
          }
          setNotes(current => current.filter(value => value.id !== note.id && (!cloudId || value.cloudId !== cloudId)));
        } catch (error) { Alert.alert('নোট মোছা সম্পূর্ণ হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
      })(); } },
    ]);
  };
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
    <View style={s.header}><View style={s.heading}><Text style={s.title}>আমার খাতা</Text><View style={s.underline} /><Text style={s.subtitle}>বাজারের হিসাব, সব এক জায়গায়</Text></View></View>
    <View style={s.searchRow}><View style={s.searchBox}><ThemedIcon role="secondary" style={s.searchIcon}>⌕</ThemedIcon><TextInput value={query} onChangeText={setQuery} placeholder="তালিকা বা নোট খুঁজুন..." placeholderTextColor="#778390" style={s.searchInput} returnKeyType="search" /></View><Pressable onPress={() => setFilterOpen(true)} style={s.filterButton} accessibilityLabel="তালিকা ফিল্টার করুন"><ThemedIcon role="secondary" style={s.filterIcon}>☷</ThemedIcon></Pressable></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
      {!!remoteLoadIssue && <View style={s.cloudWarning}><Text style={s.cloudWarningText}>{remoteLoadIssue}</Text></View>}
      <View style={s.categoryHeader}><Text style={s.section}>ক্যাটাগরি</Text></View>
      {!!categoryIds.length && <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categories}>
        {categoryIds.map(id => {
          const selected = activeCategory === id;
          const notebook = id === 'notebook';
          const tone = notebook ? '#72b8ed' : '#4bc28b';
          const count = notebook
            ? matchingNotes.length + matchingRemote.filter(item => item.kind === 'note').length
            : listIds.length + remoteLists.length;
          return <Pressable key={id} onPress={() => setSelectedCategory(selected ? null : id)} style={[s.categoryCard, selected && s.categorySelected]}>
            <View style={[s.categoryIcon, { backgroundColor: `${tone}22` }]}>{notebook ? <Image source={require('../../assets/nav-sticky-note.png')} resizeMode="contain" style={s.categoryImage} accessible={false} /> : <ShoppingCartIcon size={25} color={tone} />}</View><Text numberOfLines={1} style={s.categoryName}>{notebook ? 'নোটবুক' : 'তালিকা'}</Text><Text style={s.categoryCountText}>{bn(count)}টি {notebook ? 'নোট' : 'তালিকা'}</Text><Text style={s.categoryArrow}>→</Text>
          </Pressable>;
        })}
      </ScrollView></>}
      {!notebookSelected && <>
        {visibleIds.map(id => <ListCard key={id} title={lists[id].title || 'নতুন বাজারের তালিকা'} createdAt={lists[id].createdAt} pendingCount={lists[id].items.filter(item => item.status === 'pending' || item.status === 'new').length} localId={id} list={lists[id]} onLinked={cloudId => setLists(current => ({ ...current, [id]: { ...current[id], cloudId } }))} onDeleted={() => { setLists(current => { const next = { ...current }; delete next[id]; return next; }); setRemoteResources(current => current.filter(item => item.id !== lists[id]?.cloudId)); }} onDelete={() => deleteLocalList(id)} onPress={() => openList(id)} />)}
        {matchingRemote.filter(item => item.kind === 'list').map(item => <ListCard key={`cloud-${item.id}`} title={item.title} createdAt={typeof item.date === 'string' ? item.date : undefined} pendingCount={0} localId={item.id} resourceId={item.id} list={{ title: item.title, category: item.category || 'today', items: [] }} canShare={item.permission === 'owner'} onDelete={item.permission === 'owner' ? () => deleteCloudList(item.id) : undefined} onDeleted={() => setRemoteResources(current => current.filter(value => value.id !== item.id))} onPress={() => router.push({ pathname: '/list', params: { remoteId: item.id } })} />)}
        {query && visibleIds.length === 0 && matchingRemote.filter(item => item.kind === 'list').length === 0 && <View style={s.empty}><Text style={s.emptyTitle}>কোনো মিল পাওয়া যায়নি</Text><Text style={s.emptyCopy}>তালিকার শিরোনাম বা পণ্যের নাম দিয়ে খুঁজুন।</Text></View>}
      </>}
      {notebookSelected && <>
        {matchingNotes.map(note => <View key={note.id} style={s.noteRow}><Pressable onPress={() => router.push({ pathname: '/note', params: note.id ? { id: note.id } : {} })} style={s.noteCard}><View style={s.noteIcon}><ThemedIcon role="informational" style={s.noteGlyph}>▤</ThemedIcon></View><View style={s.noteCopy}><Text numberOfLines={1} style={s.noteTitle}>{note.title || 'শিরোনামহীন নোট'}</Text><Text numberOfLines={2} style={s.notePreview}>{note.body || 'এখনো কোনো লেখা নেই'}</Text><Text style={s.noteDate}>▦  {noteDateLabel(note.createdAt)}</Text></View><ThemedIcon role="secondary" style={s.cardArrow}>›</ThemedIcon></Pressable><Pressable style={s.noteDelete} onPress={() => deleteNote(note as Note & { id: string })} accessibilityLabel="নোট মুছুন"><ThemedIcon role="secondary" style={s.noteDeleteText}>⋮</ThemedIcon></Pressable></View>)}
        {matchingRemote.filter(item => item.kind === 'note').map(item => <View key={`cloud-note-${item.id}`} style={s.noteRow}><Pressable onPress={() => router.push({ pathname: '/note', params: { remoteId: item.id } })} style={s.noteCard}><View style={s.noteIcon}><ThemedIcon role="informational" style={s.noteGlyph}>▤</ThemedIcon></View><View style={s.noteCopy}><Text numberOfLines={1} style={s.noteTitle}>{item.title}</Text><Text style={s.noteDate}>▦  {noteDateLabel(typeof item.date === 'string' ? item.date : undefined)} · {item.permission}</Text></View><ThemedIcon role="secondary" style={s.cardArrow}>›</ThemedIcon></Pressable>{item.permission === 'owner' && <Pressable style={s.noteDelete} onPress={() => deleteNote({ id: item.id, title: item.title, body: '' }, item)} accessibilityLabel="Cloud নোট মুছুন"><ThemedIcon role="secondary" style={s.noteDeleteText}>⋮</ThemedIcon></Pressable>}</View>)}
        {!matchingNotes.length && !matchingRemote.some(item => item.kind === 'note') && <View style={s.empty}><Text style={s.emptyTitle}>{query ? 'কোনো নোট পাওয়া যায়নি' : 'এখনো কোনো নোট নেই'}</Text><Text style={s.emptyCopy}>{query ? 'শিরোনামের অক্ষর বা তারিখ দিয়ে খুঁজুন।' : 'নোটবুকের সব নোট এখানে দেখা যাবে।'}</Text><Pressable onPress={() => router.push('/notes')} style={s.notebookAction}><Text style={s.notebookActionText}>নোট লিখুন →</Text></Pressable></View>}
      </>}
    </ScrollView>
    <Pressable style={s.fab} onPress={createList} accessibilityRole="button" accessibilityLabel="নতুন তালিকা বা নোট যোগ করুন"><Text style={s.fabText}>＋</Text></Pressable>
    <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}><Pressable style={s.modalScrim} onPress={() => setFilterOpen(false)}><Pressable style={s.filterSheet} onPress={event => event.stopPropagation()}><View style={s.grabber} /><Text style={s.filterTitle}>তালিকা ফিল্টার</Text><Text style={s.filterLabel}>কেনাকাটার অবস্থা</Text>{([['all', 'সব জিনিস'], ['pending', 'কেনা বাকি'], ['purchased', 'কেনা সম্পন্ন'], ['new', 'নতুন যোগ করা'], ['omitted', 'বাদ দেওয়া']] as const).map(([value, label]) => <Pressable key={value} onPress={() => { setStatusFilter(value); setFilterOpen(false); }} style={s.filterOption}><Text style={s.filterOptionText}>{label}</Text><Text style={s.radio}>{statusFilter === value ? '●' : '○'}</Text></Pressable>)}</Pressable></Pressable></Modal>
    <Modal visible={addMenuOpen} transparent animationType="slide" onRequestClose={() => setAddMenuOpen(false)}><Pressable style={s.modalScrim} onPress={() => setAddMenuOpen(false)}><Pressable style={s.addMenuSheet} onPress={event => event.stopPropagation()}><View style={s.grabber} /><Text style={s.filterTitle}>কী যোগ করবেন?</Text><Pressable onPress={createMarketList} style={s.addMenuOption}><View style={s.addMenuIcon}><ShoppingCartIcon size={24} color="#4bc28b" /></View><View style={s.addMenuCopy}><Text style={s.addMenuOptionTitle}>বাজারের তালিকা</Text><Text style={s.addMenuOptionHint}>বাজারের জিনিস লিখুন</Text></View><Text style={s.addMenuArrow}>›</Text></Pressable><Pressable onPress={createNotebookNote} style={s.addMenuOption}><View style={[s.addMenuIcon, s.addMenuNotebookIcon]}><Image source={require('../../assets/nav-sticky-note.png')} resizeMode="contain" style={s.addMenuNotebookImage} accessible={false} /></View><View style={s.addMenuCopy}><Text style={s.addMenuOptionTitle}>নোটবুক</Text><Text style={s.addMenuOptionHint}>নতুন নোট লিখুন</Text></View><Text style={s.addMenuArrow}>›</Text></Pressable></Pressable></Pressable></Modal>
  </SafeAreaView>;
}

function ListCard({ title, createdAt, pendingCount, localId, resourceId, list, canShare = true, onLinked, onDeleted, onDelete, onPress }: { title: string; createdAt?: string; pendingCount: number; localId: string; resourceId?: string; list: ShoppingList; canShare?: boolean; onLinked?: (cloudId: string) => void; onDeleted?: () => void; onDelete?: () => void; onPress: () => void }) {
  const [shareOpen, setShareOpen] = useState(false);
  const date = createdAt && !Number.isNaN(new Date(createdAt).getTime()) ? new Date(createdAt).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return <View style={s.listCard}>
    <Pressable onPress={onPress} style={s.listCardPress} accessibilityRole="button" accessibilityLabel={`${title}, ${date}, ${bn(pendingCount)}টি কেনা বাকি`}>
      <View style={s.listCardCopy}><Text numberOfLines={1} style={s.cardTitle}>{title}</Text><Text style={s.cardDate}>{date}</Text></View>
    </Pressable>
    {pendingCount > 0 && <View style={s.pendingBadge}><Text style={s.pendingBadgeText}>{bn(pendingCount)}</Text></View>}
    {canShare && <Pressable onPress={() => setShareOpen(true)} style={s.listShareButton} accessibilityRole="button" accessibilityLabel={`${title} শেয়ার করুন`} hitSlop={5}><Image source={require('../../assets/send.png')} resizeMode="contain" style={s.listShareIcon} accessible={false} /></Pressable>}
    {onDelete && <Pressable onPress={() => Alert.alert('তালিকাটি মুছবেন?', `“${title}” মুছে যাবে।`, [{ text: 'বাতিল', style: 'cancel' }, { text: 'মুছুন', style: 'destructive', onPress: onDelete }])} style={s.listDeleteButton} accessibilityRole="button" accessibilityLabel="তালিকা মুছুন"><Text style={s.listDeleteGlyph}>⋮</Text></Pressable>}
    <ShareDialog visible={shareOpen} onClose={() => setShareOpen(false)} kind="list" localId={localId} resourceId={resourceId} list={list} onLinked={onLinked} onDeleted={onDeleted} />
  </View>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0c1117' }, header: { minHeight: 112, paddingTop: 14, paddingHorizontal: 24, paddingBottom: 14, flexDirection: 'row', alignItems: 'center' }, heading: { flex: 1 }, title: { color: '#f3f6f8', fontSize: 28, fontWeight: '700', letterSpacing: -0.5 }, underline: { width: 43, height: 4, borderRadius: 4, backgroundColor: '#32bb83', marginTop: 3, transform: [{ rotate: '-7deg' }] }, subtitle: { color: '#88939e', fontSize: 13, marginTop: 8 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 10 }, searchBox: { flex: 1, height: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderRadius: 30, backgroundColor: '#19222d' }, searchIcon: { color: '#e0e8ef', fontSize: 29, marginRight: 11 }, searchInput: { flex: 1, height: 52, color: '#f1f4f6', fontSize: 15 }, filterButton: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#19222d', alignItems: 'center', justifyContent: 'center' }, filterIcon: { color: '#dce5eb', fontSize: 26 },
  content: { paddingTop: 9, paddingBottom: 132 }, categoryHeader: { marginTop: 8, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, section: { color: '#f1f4f6', fontSize: 19, fontWeight: '700' }, categoryCount: { color: '#89949f', fontSize: 12 }, categories: { paddingLeft: 17, paddingRight: 20, paddingTop: 8, paddingBottom: 13, gap: 11 }, categoryCard: { width: 151, minHeight: 152, padding: 16, borderWidth: 1, borderColor: '#26323e', borderRadius: 24, backgroundColor: '#151d26' }, categorySelected: { borderColor: '#3fbe88', backgroundColor: '#14251f' }, categoryIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }, categoryImage: { width: 27, height: 27, tintColor: '#72b8ed' }, categoryName: { color: '#eef2f4', fontSize: 14, fontWeight: '600' }, categoryCountText: { color: '#909ca7', fontSize: 12, marginTop: 5 }, categoryArrow: { position: 'absolute', right: 15, top: 24, color: '#89949f', fontSize: 18 },
  listHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 9, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, listSubheading: { color: '#87939e', fontSize: 12, marginTop: 3 }, clearText: { color: '#50c28f', fontSize: 13, fontWeight: '600' }, listCard: { marginHorizontal: 17, marginTop: 8, minHeight: 76, paddingHorizontal: 17, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, borderColor: '#1c2732', backgroundColor: '#141c25' }, listCardPress: { flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center' }, listShareButton: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17372d', borderWidth: 1, borderColor: '#255442' }, listShareIcon: { width: 22, height: 22, tintColor: '#4bc28b' }, cardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 }, cardIcon: { width: 47, height: 47, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, cardHeading: { flex: 1 }, cardTitle: { color: '#f0f3f5', fontSize: 16, fontWeight: '600' }, listCardCopy: { flex: 1, minWidth: 0 }, pendingBadge: { minWidth: 29, height: 29, paddingHorizontal: 7, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#a92836' }, pendingBadgeText: { color: '#fff2f3', fontSize: 13, fontWeight: '700' }, cardDate: { color: '#87939e', fontSize: 11, marginTop: 2 }, more: { color: '#84909b', fontSize: 18, letterSpacing: 2, paddingHorizontal: 3 }, cardPreview: { color: '#8d99a4', fontSize: 12, marginTop: 11 }, cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 }, cardMeta: { color: '#a1acb5', fontSize: 11 }, cardProgress: { flex: 1, height: 4, borderRadius: 3, backgroundColor: '#29343e', overflow: 'hidden' }, cardProgressFill: { height: '100%', borderRadius: 3 }, cardArrow: { color: '#85919b', fontSize: 17 }, empty: { marginHorizontal: 18, marginTop: 14, padding: 24, alignItems: 'center', borderRadius: 22, backgroundColor: '#141c25' }, emptyTitle: { color: '#e8edf0', fontSize: 15, fontWeight: '600' }, emptyCopy: { color: '#87939e', fontSize: 12, marginTop: 6 }, notebookAction: { marginTop: 17, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14, backgroundColor: '#17372d' }, notebookActionText: { color: '#65d5a8', fontSize: 14, fontWeight: '600' }, quoteCard: { marginHorizontal: 18, marginTop: 20, marginBottom: 10, minHeight: 108, padding: 20, borderWidth: 1, borderColor: '#18312d', borderRadius: 24, backgroundColor: '#10201f', justifyContent: 'center' }, quoteMark: { color: '#426260', fontSize: 32, height: 26, fontWeight: '700' }, quoteText: { color: '#c5d6d1', fontSize: 14, lineHeight: 22 },
  notesSection: { marginTop: 14 }, noteRow: { flexDirection: 'row', alignItems: 'center', gap: 4 }, noteDelete: { width: 35, height: 44, alignItems: 'center', justifyContent: 'center' }, noteDeleteText: { color: '#89949f', fontSize: 24 }, noteCard: { flex: 1, minHeight: 82, marginHorizontal: 17, marginTop: 8, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18, borderWidth: 1, borderColor: '#1c2732', backgroundColor: '#141c25' }, noteIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1b3a30' }, noteGlyph: { color: '#5bd39d', fontSize: 20 }, noteCopy: { flex: 1, minWidth: 0 }, noteTitle: { color: '#f0f3f5', fontSize: 14, fontWeight: '600' }, notePreview: { color: '#8d99a4', fontSize: 11, marginTop: 3 }, noteDate: { color: '#65bf95', fontSize: 10, marginTop: 5 }, fab: { position: 'absolute', bottom: 88, right: 24, width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: '#27b983', elevation: 8 }, fabText: { color: '#fff', fontSize: 33, lineHeight: 38, fontWeight: '400' },
  listDeleteButton: { width: 31, height: 40, alignItems: 'center', justifyContent: 'center' }, listDeleteGlyph: { color: '#89949f', fontSize: 23 }, cloudWarning: { marginHorizontal: 18, marginTop: 4, padding: 11, borderRadius: 10, borderWidth: 1, borderColor: '#61484a', backgroundColor: '#21191c' }, cloudWarningText: { color: '#e7b8b5', fontSize: 11, lineHeight: 17 },
  modalScrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.55)' }, filterSheet: { paddingHorizontal: 22, paddingTop: 13, paddingBottom: 30, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: '#151d26' }, addMenuSheet: { paddingHorizontal: 22, paddingTop: 14, paddingBottom: 30, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: '#151d26' }, addMenuOption: { minHeight: 72, marginTop: 12, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 13, borderRadius: 17, borderWidth: 1, borderColor: '#27333e', backgroundColor: '#101820' }, addMenuIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#18382e' }, addMenuNotebookIcon: { backgroundColor: '#1c2c3b' }, addMenuNotebookImage: { width: 27, height: 27, tintColor: '#72b8ed' }, addMenuCopy: { flex: 1 }, addMenuOptionTitle: { color: '#edf2f4', fontSize: 15, fontWeight: '600' }, addMenuOptionHint: { color: '#8e9aa5', fontSize: 12, marginTop: 4 }, addMenuArrow: { color: '#8996a1', fontSize: 25, paddingHorizontal: 6 }, grabber: { width: 38, height: 4, borderRadius: 3, alignSelf: 'center', backgroundColor: '#52606c', marginBottom: 18 }, filterTitle: { color: '#f1f4f6', fontSize: 19, fontWeight: '700' }, filterLabel: { color: '#a1acb5', fontSize: 12, marginTop: 18, marginBottom: 6 }, filterOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#26323e' }, filterOptionText: { color: '#e8edf0', fontSize: 14 }, radio: { color: '#43c28d', fontSize: 19 }, createInput: { height: 50, borderRadius: 13, borderWidth: 1, borderColor: '#34414d', backgroundColor: '#0c131a', paddingHorizontal: 14, color: '#f1f4f6', fontSize: 15 }, categoryChoices: { gap: 8 }, categoryChoice: { padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0c131a', borderWidth: 1, borderColor: '#26323e' }, categoryChoiceSelected: { borderColor: '#43c28d', backgroundColor: '#14251f' }, categoryChoiceText: { color: '#d8e0e5', fontSize: 14 }, categoryChoiceTextSelected: { color: '#65d5a8' }, createButton: { height: 49, marginTop: 18, borderRadius: 13, backgroundColor: '#27b983', alignItems: 'center', justifyContent: 'center' }, createButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
