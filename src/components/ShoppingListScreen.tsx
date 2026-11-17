import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Platform,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ThemedKeyboardAvoidingView as KeyboardAvoidingView, ThemedScrollView as ScrollView, ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, ThemedSafeAreaView as SafeAreaView, ThemedIcon } from './ThemePrimitives';
import { useTheme } from '../contexts/ThemeContext';
import { bn, normalizeStoredLists, removeEmptyLocalListDrafts, type Item, type ListCategory, type ListId, type ShoppingList } from '../data';
import ShoppingCartIcon from './ShoppingCartIcon';
import ShareDialog from './ShareDialog';
import PdfCenterModal from './PdfCenterModal';
import { GlossyPressable as Pressable } from './GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import { addRemoteItem, cacheRemoteList, deleteRemoteItem, flushPendingCloudChanges, getPendingCloudChanges, getRemoteList, resolvePendingCloudChange, retryBlockedCloudChange, updateRemoteItem, updateRemoteListTitle, watchRemoteList, type RemoteList } from '../lib/collaboration';
import { readLists, storageScopeId, writeLists } from '../lib/localStorage';
import { goBackOrReplace } from '../lib/navigation.mjs';

const labels = { pending: 'কেনা বাকি', purchased: 'কেনা সম্পন্ন', omitted: 'তালিকা থেকে বাদ', new: 'নতুন যোগ করা হয়েছে' } as const;

export default function ShoppingListScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; remoteId?: string; startAdd?: string; category?: ListCategory }>();
  const { user, scope, mode } = useAuth();
  const listId = params.id || 'today';
  const [activeRemoteId, setActiveRemoteId] = useState(params.remoteId || '');
  const remoteId = params.remoteId || activeRemoteId || undefined;
  const [lists, setLists] = useState<Record<ListId, ShoppingList>>({});
  const [remoteList, setRemoteList] = useState<RemoteList | null>(null);
  const remoteListRef = useRef(remoteList);
  const pendingTitleWrites = useRef<Promise<unknown>>(Promise.resolve());
  const [loaded, setLoaded] = useState(false);
  const [loadedScopeId, setLoadedScopeId] = useState('');
  const [loadedRemoteId, setLoadedRemoteId] = useState('');
  const currentScopeId = scope ? storageScopeId(scope) : '';
  const dataReady = remoteId ? Boolean(loaded && loadedRemoteId === remoteId) : Boolean(scope && loaded && loadedScopeId === currentScopeId);
  const [shareOpen, setShareOpen] = useState(false);
  const [pdfCenterOpen, setPdfCenterOpen] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [editName, setEditName] = useState('');
  const [editQty, setEditQty] = useState('');
  const editQtyRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const editNameRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const didAutoOpenAdd = useRef(false);
  const handledConflictIds = useRef(new Set<string>());
  const [priceItem, setPriceItem] = useState<Item | null>(null);
  const [priceText, setPriceText] = useState('');
  const [menuItem, setMenuItem] = useState<Item | null>(null);
  useEffect(() => { remoteListRef.current = remoteList; }, [remoteList]);

  const list: ShoppingList = remoteList || (loadedScopeId === currentScopeId ? lists[listId] : undefined) || { title: '', category: params.category, items: [] };
  const remotePermission = remoteList?.permission;
  const canEditStructure = !remoteId || remotePermission === 'editor' || remotePermission === 'owner';
  const total = useMemo(() => list.items.reduce((sum, item) => sum + (item.status === 'purchased' && typeof item.price === 'number' ? item.price : 0), 0), [list.items]);

  useEffect(() => {
    if (remoteId && mode !== 'account') {
      let active = true;
      void Promise.resolve().then(() => { if (active) { setRemoteList(null); setLoaded(false); } });
      return () => { active = false; };
    }
    if (remoteId && user && mode === 'account') {
      return watchRemoteList(remoteId, user.uid, value => { setRemoteList(value); setLoadedRemoteId(remoteId); setLoaded(true); }, error => {
        const code = (error as Error & { code?: string }).code;
        const accessLost = code === 'permission-denied' || error.message.includes('তালিকাটি আর নেই') || error.message.includes('অনুমতি বাতিল');
        if (accessLost) {
          setRemoteList(null); setLoadedRemoteId(''); setLoaded(false);
          Alert.alert('শেয়ার করা তালিকা বন্ধ হয়েছে', error.message);
          return;
        }
        if (remoteListRef.current) {
          setRemoteList(current => current ? { ...current, cached: true } : current);
          setLoadedRemoteId(remoteId); setLoaded(true);
        } else {
          setLoadedRemoteId(''); setLoaded(false);
          Alert.alert('তালিকা অফলাইনে খোলা যাচ্ছে না', 'আগে এই তালিকাটি অনলাইনে খুলে local copy তৈরি করুন, অথবা ইন্টারনেট সংযোগ ফিরিয়ে আনুন।');
        }
      });
    }
    let active = true;
    if (!scope) {
      void Promise.resolve().then(() => { if (active) { setLists({}); setLoaded(false); setLoadedScopeId(''); } });
      return () => { active = false; };
    }
    readLists(scope).then(storedValue => {
      if (active) {
        const stored = removeEmptyLocalListDrafts(normalizeStoredLists(storedValue));
        const dated = Object.fromEntries(Object.entries(stored).map(([id, saved]) => [id, { ...saved, createdAt: saved.createdAt || (saved.title.trim() ? new Date().toISOString() : undefined) }]));
        setLists(dated);
        setLoadedScopeId(storageScopeId(scope));
        setLoadedRemoteId('');
        setLoaded(true);
        if (JSON.stringify(storedValue) !== JSON.stringify(dated)) void writeLists(scope, dated).catch(error => Alert.alert('তালিকা সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'));
      }
    }).catch(error => { if (active) { setLoaded(false); setLoadedScopeId(''); Alert.alert('লোকাল তালিকা পড়া যায়নি', error instanceof Error ? error.message : 'ডাটা অক্ষত আছে; storage যাচাই করে আবার চেষ্টা করুন।'); } });
    return () => { active = false; };
  }, [mode, remoteId, scope, user]);
  useEffect(() => { if (!remoteId && loaded && scope && loadedScopeId === currentScopeId) writeLists(scope, lists).catch(error => Alert.alert('তালিকা সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।')); }, [lists, loaded, loadedScopeId, currentScopeId, remoteId, scope]);

  useEffect(() => {
    if (!remoteId || !user || !remoteList) return;
    let active = true;
    void getPendingCloudChanges(user.uid).then(entries => {
      if (!active) return;
      const conflict = entries.find(entry => (entry.kind === 'list-item' || entry.kind === 'list-title') && entry.resourceId === remoteId && (entry.status === 'conflict' || entry.status === 'blocked') && !handledConflictIds.current.has(entry.id));
      if (!conflict) return;
      handledConflictIds.current.add(conflict.id);
      if (conflict.status === 'blocked') {
        Alert.alert('Cloud-এ পরিবর্তন পাঠানো যায়নি', `${conflict.error || 'পরিবর্তন ডিভাইসে অক্ষত আছে।'} Permission ঠিক হলে আবার চেষ্টা করুন।`, [
          { text: 'আবার চেষ্টা', onPress: async () => {
            try { await retryBlockedCloudChange(user, conflict.id); setRemoteList(await getRemoteList(remoteId, user.uid)); }
            catch (error) { Alert.alert('আবার সিঙ্ক হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
          } },
          { text: 'পরে', style: 'cancel' },
        ]);
        return;
      }
      const actions: Parameters<typeof Alert.alert>[2] = [
        { text: 'Cloud সংস্করণ', onPress: async () => {
          await resolvePendingCloudChange(user.uid, conflict.id, 'remote');
          try { setRemoteList(await getRemoteList(remoteId, user.uid)); } catch { /* Keep the visible cached copy until the listener refreshes. */ }
        } },
      ];
      if (conflict.operation !== 'create-item') actions.push({ text: 'আমার পরিবর্তন রাখুন', onPress: async () => {
        try {
          await resolvePendingCloudChange(user.uid, conflict.id, 'local');
          await flushPendingCloudChanges(user);
          setRemoteList(await getRemoteList(remoteId, user.uid));
        } catch (error) { Alert.alert('পরিবর্তন সিঙ্ক হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
      } });
      actions.push({ text: 'পরে', style: 'cancel' });
      Alert.alert(conflict.kind === 'list-title' ? 'অন্য কেউ শিরোনাম পরিবর্তন করেছেন' : 'অন্য কেউ পণ্যটি পরিবর্তন করেছেন', 'আপনার পরিবর্তন ডিভাইসে সংরক্ষিত আছে। কোন সংস্করণ রাখবেন?', actions);
    }).catch(() => {});
    return () => { active = false; };
  }, [remoteId, user, remoteList]);

  const updateItems = (update: (items: Item[]) => Item[]) => {
    if (remoteId && remoteList && user) {
      const previous = remoteList.items;
      const next = update(previous);
      const optimistic = { ...remoteList, items: next };
      setRemoteList(optimistic);
      void cacheRemoteList(user.uid, optimistic).catch(() => {});
      const oldById = new Map(previous.map(item => [String(item.id), item]));
      const nextById = new Map(next.map(item => [String(item.id), item]));
      for (const item of next) {
        const before = oldById.get(String(item.id));
        if (!before) {
          addRemoteItem(remoteId, user, item).then(result => {
            if (result.queued) Alert.alert('পণ্য ডিভাইসে রাখা হয়েছে', 'ইন্টারনেট ফিরে এলে সিঙ্ক হবে।');
          }).catch(error => { if (!(error && typeof error === 'object' && 'conflict' in error)) Alert.alert('পণ্য যোগ হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); });
        } else {
          const changed: Partial<Pick<Item, 'name' | 'qty' | 'price' | 'status'>> = {};
          if (before.name !== item.name) changed.name = item.name;
          if (before.qty !== item.qty) changed.qty = item.qty;
          if (before.status !== item.status) changed.status = item.status;
          if (before.price !== item.price) changed.price = item.price;
          if (Object.keys(changed).length) updateRemoteItem(remoteId, item.id, user, changed, Number((before as typeof item & { revision?: number }).revision || 0), before).then(result => {
            if (result.queued) Alert.alert('পরিবর্তন ডিভাইসে রাখা হয়েছে', 'ইন্টারনেট ফিরে এলে সিঙ্ক হবে। অন্য account-এ পরিবর্তন হলে আগে conflict জানানো হবে।');
          }).catch(error => { if (!(error && typeof error === 'object' && 'conflict' in error)) Alert.alert('পরিবর্তন সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'অনুমতি বা ইন্টারনেট পরীক্ষা করুন।'); });
        }
      }
      for (const item of previous) if (!nextById.has(String(item.id))) deleteRemoteItem(remoteId, item, user).then(result => {
        if (result.queued) Alert.alert('মোছার অনুরোধ ডিভাইসে রাখা হয়েছে', 'ইন্টারনেট ফিরে এলে সিঙ্ক হবে; conflict হলে তালিকায় জানানো হবে।');
      }).catch(error => { if (!(error && typeof error === 'object' && 'conflict' in error)) Alert.alert('পণ্য মোছা যায়নি', error instanceof Error ? error.message : 'অনুমতি বা ইন্টারনেট পরীক্ষা করুন।'); });
      return;
    }
    if (!dataReady) return;
    setLists(current => {
      const existing = current[listId] || list;
      const items = update(existing.items);
      return { ...current, [listId]: { ...existing, items, createdAt: existing.createdAt || (existing.title.trim() || items.length ? new Date().toISOString() : undefined) } };
    });
  };
  const updateTitle = (title: string) => {
    if (remoteId) {
      if (canEditStructure && user && remoteList) {
        const baseRevision = Number((remoteList as RemoteList & { revision?: number }).revision || 0);
        const baseTitle = remoteList.title;
        setRemoteList(current => current ? { ...current, title, localSyncState: 'pending' } : current);
        const write = updateRemoteListTitle(remoteId, user.uid, title, baseRevision, baseTitle);
        pendingTitleWrites.current = Promise.all([pendingTitleWrites.current.catch(() => {}), write]).then(() => undefined);
        void write.catch(error => Alert.alert('শিরোনাম ডিভাইসে রাখা যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'));
      }
      return;
    }
    if (!dataReady) return;
    setLists(current => {
      const existing = current[listId] || list;
      return { ...current, [listId]: { ...existing, title, createdAt: existing.createdAt || (title.trim() || existing.items.length ? new Date().toISOString() : undefined) } };
    });
  };

  const syncRemoteTitle = () => {
    if (!remoteId || !user) return;
    void pendingTitleWrites.current.then(() => flushPendingCloudChanges(user)).then(async () => {
      const titleEntry = (await getPendingCloudChanges(user.uid)).find(entry => entry.kind === 'list-title' && entry.resourceId === remoteId);
      if (titleEntry && (titleEntry.status === 'conflict' || titleEntry.status === 'blocked')) {
        setRemoteList(current => current ? { ...current, localSyncState: titleEntry.status, localOutboxId: titleEntry.id, localRemoteValue: titleEntry.remoteValue, localRemoteRevision: titleEntry.remoteRevision } : current);
      }
    }).catch(error => Alert.alert('শিরোনাম সিঙ্ক হয়নি', error instanceof Error ? error.message : 'আপনার লেখা ডিভাইসে রাখা আছে; পরে আবার চেষ্টা করুন।'));
  };

  const beginPurchase = (item: Item) => {
    updateItems(items => items.map(value => value.id === item.id ? { ...value, status: 'purchased' } : value));
    setPriceItem(item);
    setPriceText(typeof item.price === 'number' ? String(item.price) : '');
  };

  const updatePrice = (value: string) => {
    const digits = value.replace(/[^\d.]/g, '');
    const decimalAt = digits.indexOf('.');
    const clean = decimalAt < 0 ? digits : digits.slice(0, decimalAt + 1) + digits.slice(decimalAt + 1).replace(/\./g, '');
    setPriceText(clean);
    if (!priceItem) return;
    updateItems(items => items.map(item => {
      if (item.id !== priceItem.id) return item;
      const amount = clean.trim() ? Number(clean) : undefined;
      const { price: _oldPrice, ...withoutPrice } = item;
      return Number.isFinite(amount) ? { ...withoutPrice, price: amount } : withoutPrice;
    }));
  };

  const openEdit = (item: Item) => {
    setMenuItem(null);
    setAddingItem(false);
    setEditItem(item);
    setEditName(item.name);
    setEditQty(item.qty);
  };
  const openAddItem = useCallback(() => {
    if (!dataReady) return;
    if (!canEditStructure) {
      Alert.alert('Edit Permission দরকার', 'নতুন পণ্য যোগ করতে তালিকার মালিকের কাছ থেকে Edit Permission নিন।');
      return;
    }
    setAddingItem(true);
    setEditItem(null);
    setEditName('');
    setEditQty('১টি');
  }, [canEditStructure, dataReady]);
  useEffect(() => {
    if (dataReady && params.startAdd === '1' && !didAutoOpenAdd.current) {
      didAutoOpenAdd.current = true;
      openAddItem();
    }
  }, [dataReady, openAddItem, params.startAdd]);
  const saveEdit = () => {
    if (!canEditStructure || !editName.trim()) return;
    if (addingItem) {
      const name = editName.trim();
      const qty = editQty.trim() || '১টি';
      updateItems(items => {
        const nextId = Math.max(Date.now(), ...items.map(item => (typeof item.id === 'number' ? item.id : Number(item.id) || 0) + 1));
        return [...items, { id: nextId, name, qty, status: 'new' }];
      });
      setEditName('');
      setEditQty('১টি');
      requestAnimationFrame(() => editNameRef.current?.focus());
      return;
    } else if (editItem) {
      updateItems(items => items.map(item => item.id === editItem.id ? { ...item, name: editName.trim(), qty: editQty.trim() || '১টি' } : item));
    } else {
      return;
    }
    setAddingItem(false);
    setEditItem(null);
  };
  const omitItem = (item: Item) => {
    setMenuItem(null);
    updateItems(items => items.map(value => value.id === item.id ? { ...value, status: 'omitted' } : value));
  };
  const restoreItem = (item: Item) => updateItems(items => items.map(value => value.id === item.id ? { ...value, status: 'pending' } : value));
  const removeItem = (item: Item) => {
    setMenuItem(null);
    Alert.alert('জিনিসটি মুছে ফেলবেন?', `“${item.name}” তালিকা থেকে স্থায়ীভাবে মুছে যাবে।`, [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'মুছে ফেলুন', style: 'destructive', onPress: () => updateItems(items => items.filter(value => value.id !== item.id)) },
    ]);
  };

  return <SafeAreaView style={s.page} edges={['top', 'right', 'bottom', 'left']}>
    <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    <View style={s.header}>
      <Pressable onPress={() => goBackOrReplace(router, remoteId ? '/shared' : '/lists')} hitSlop={10} accessibilityRole="button" accessibilityLabel="পেছনে যান" style={s.backButton}><ThemedIcon role="primary" style={s.back}>‹</ThemedIcon></Pressable>
      <View style={s.headerIcon} accessibilityLabel="তালিকা"><ShoppingCartIcon size={32} /></View>
      <View style={s.headerCopy}><Text numberOfLines={1} ellipsizeMode="tail" style={s.headerTitle}>তালিকা</Text><TextInput value={list.title} onChangeText={updateTitle} onEndEditing={syncRemoteTitle} editable={dataReady && canEditStructure} numberOfLines={1} placeholder="তালিকার শিরোনাম লিখুন" placeholderTextColor="#78848e" style={s.headerTitleInput} returnKeyType="done" /><Text style={s.headerDate}>{list.title.trim() && list.createdAt ? `${new Date(list.createdAt).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' })} · ${new Date(list.createdAt).toLocaleTimeString('bn-BD', { hour: 'numeric', minute: '2-digit' })}` : 'শিরোনাম দিলে তারিখ ও সময় যোগ হবে'}</Text></View>
    </View>

    <View style={s.summaryRow}><View style={s.totalSummary}><View style={s.totalInfo}><Text style={s.totalLabel}>মোট</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={s.totalValue}>৳{bn(total)}</Text></View></View><Pressable onPress={() => setPdfCenterOpen(true)} disabled={!dataReady} style={[s.summaryPrintButton, theme === 'light' && s.summaryActionLight]} accessibilityRole="button" accessibilityLabel="PDF Center খুলুন" hitSlop={6}><Image source={require('../../assets/printer.png')} resizeMode="contain" style={[s.summaryIconImage, theme === 'light' && s.summaryIconLight]} accessible={false} /></Pressable><Pressable disabled={!dataReady} onPress={() => setShareOpen(true)} style={[s.summaryShareButton, theme === 'light' && s.summaryActionLight]} accessibilityRole="button" accessibilityLabel="এই বাজারের তালিকা শেয়ার করুন" hitSlop={6}><Image source={require('../../assets/send.png')} resizeMode="contain" style={[s.summaryIconImage, theme === 'light' && s.summaryIconLight]} accessible={false} /></Pressable></View>
    {remoteId && remoteList?.cached && <Text style={s.syncNotice}>{remoteList.items.some(item => Boolean((item as typeof item & { localSyncState?: string }).localSyncState)) || remoteList.localSyncState ? 'অফলাইন কপি · কিছু পরিবর্তন সিঙ্কের অপেক্ষায়' : 'অফলাইন কপি · সর্বশেষ দেখা তালিকা'}</Text>}
    {remoteId && remoteList && !remoteList.cached && remoteList.localSyncState && <Text style={s.syncNotice}>{remoteList.localSyncState === 'conflict' ? 'শিরোনামে পরিবর্তন-সংঘাত · আপনার লেখা ডিভাইসে রাখা আছে' : remoteList.localSyncState === 'blocked' ? 'শিরোনাম সিঙ্ক হয়নি · আবার চেষ্টা প্রয়োজন' : 'শিরোনাম সিঙ্কের অপেক্ষায়'}</Text>}
    <ScrollView style={s.listScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.items} showsVerticalScrollIndicator={false}>
      {remoteId && !dataReady ? <ActivityIndicator style={{ marginTop: 35 }} color="#2b8655" /> : list.items.length ? list.items.map(item => <ItemRow
        key={item.id}
        item={item}
        onToggle={() => item.status === 'purchased' ? restoreItem(item) : item.status === 'omitted' ? restoreItem(item) : beginPurchase(item)}
        onPrice={() => item.status === 'purchased' ? (setPriceItem(item), setPriceText(typeof item.price === 'number' ? String(item.price) : '')) : beginPurchase(item)}
        onEdit={() => canEditStructure && openEdit(item)}
        onMore={() => canEditStructure && setMenuItem(item)}
        onOmit={() => canEditStructure && omitItem(item)}
        canEditStructure={canEditStructure}
      />) : <View style={s.empty}><Text style={s.emptyTitle}>তালিকাটি এখনো খালি</Text><Text style={s.emptyText}>নিচের + চিহ্নে চাপ দিয়ে জিনিস যোগ করুন।</Text></View>}
    </ScrollView>

    <Pressable disabled={!dataReady} onPress={openAddItem} style={[s.addFab, !dataReady && s.addFabDisabled]} accessibilityRole="button" accessibilityLabel="বাজারের নতুন পণ্য যোগ করুন" hitSlop={10}><ThemedIcon role="inverse" style={s.addFabGlyph}>＋</ThemedIcon></Pressable>

    <Modal visible={!!priceItem} transparent animationType="slide" onRequestClose={() => setPriceItem(null)}>
      <KeyboardAvoidingView style={s.modalKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={s.scrim} onPress={() => setPriceItem(null)}>
        <Pressable style={s.sheet} onPress={event => event.stopPropagation()}><ScrollView style={s.sheetScroll} contentContainerStyle={s.sheetScrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={s.grabber} /><View style={s.sheetHeading}><View><Text style={s.sheetEyebrow}>কেনা সম্পন্ন</Text><Text style={s.sheetTitle}>{priceItem?.name}</Text></View><Pressable onPress={() => setPriceItem(null)} style={s.sheetClose}><ThemedIcon role="secondary" style={s.sheetCloseText}>×</ThemedIcon></Pressable></View>
          <Text style={s.fieldLabel}>দাম (টাকা)</Text>
          <View style={s.moneyField}><Text style={s.currency}>৳</Text><TextInput autoFocus keyboardType="decimal-pad" value={priceText} onChangeText={updatePrice} placeholder="দাম লিখুন" placeholderTextColor="#75818c" style={s.moneyInput} /></View>
          <Text style={s.autoSave}>দাম লেখার সঙ্গে সঙ্গে সংরক্ষিত হবে</Text>
          <Pressable style={s.sheetDone} onPress={() => setPriceItem(null)}><Text style={s.sheetDoneText}>{priceText ? 'সম্পন্ন' : 'দাম ছাড়া সম্পন্ন'}</Text></Pressable>
        </ScrollView></Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>

    <Modal visible={addingItem || !!editItem} transparent animationType="slide" onRequestClose={() => { setAddingItem(false); setEditItem(null); }}>
      <KeyboardAvoidingView style={s.modalKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={s.scrim} onPress={() => { setAddingItem(false); setEditItem(null); }}>
        <Pressable style={s.sheet} onPress={event => event.stopPropagation()}><ScrollView style={s.sheetScroll} contentContainerStyle={s.sheetScrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={s.grabber} /><Text style={s.sheetTitle}>{addingItem ? 'বাজারের জিনিস যোগ করুন' : 'জিনিস সম্পাদনা করুন'}</Text>
          <Text style={s.fieldLabel}>জিনিসের নাম</Text><TextInput ref={editNameRef} autoFocus={addingItem} value={editName} onChangeText={setEditName} onSubmitEditing={() => editQtyRef.current?.focus()} returnKeyType="next" placeholder="যেমন—আলু" placeholderTextColor="#75818c" style={s.formInput} />
          <Text style={s.fieldLabel}>পরিমাণ</Text><TextInput ref={editQtyRef} value={editQty} onChangeText={setEditQty} onSubmitEditing={saveEdit} returnKeyType="done" placeholder="যেমন—২ কেজি" placeholderTextColor="#75818c" style={s.formInput} />
          {addingItem ? <View style={s.addActions}><Pressable style={[s.sheetDone, s.addAnother]} onPress={saveEdit}><Text style={s.sheetDoneText}>যোগ করে আরেকটি</Text></Pressable><Pressable style={s.addFinish} onPress={() => { setAddingItem(false); setEditName(''); setEditQty('১টি'); }}><Text style={s.addFinishText}>সম্পন্ন</Text></Pressable></View> : <Pressable style={s.sheetDone} onPress={saveEdit}><Text style={s.sheetDoneText}>পরিবর্তন সংরক্ষণ</Text></Pressable>}
        </ScrollView></Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>

    <Modal visible={!!menuItem} transparent animationType="slide" onRequestClose={() => setMenuItem(null)}>
      <Pressable style={s.scrim} onPress={() => setMenuItem(null)}><Pressable style={s.sheet} onPress={event => event.stopPropagation()}><View style={s.grabber} /><Text style={s.sheetTitle}>{menuItem?.name}</Text>
        <MenuAction label="জিনিস সম্পাদনা করুন" onPress={() => menuItem && openEdit(menuItem)} />
        {menuItem?.status === 'omitted' ? <MenuAction label="তালিকায় ফিরিয়ে আনুন" onPress={() => { if (menuItem) restoreItem(menuItem); setMenuItem(null); }} /> : <MenuAction label="তালিকা থেকে বাদ দিন" destructive onPress={() => menuItem && omitItem(menuItem)} />}
        <MenuAction label="স্থায়ীভাবে মুছে ফেলুন" destructive onPress={() => menuItem && removeItem(menuItem)} />
        <Pressable style={s.cancelAction} onPress={() => setMenuItem(null)}><Text style={s.cancelText}>বাতিল</Text></Pressable>
      </Pressable></Pressable>
    </Modal>
    <ShareDialog visible={shareOpen} onClose={() => setShareOpen(false)} kind="list" localId={listId} resourceId={remoteId || list.cloudId} list={list} keyboardAvoiding onLinked={setActiveRemoteId} onDeleted={() => { setActiveRemoteId(''); setRemoteList(null); router.replace('/'); }} />
    <PdfCenterModal visible={pdfCenterOpen} onClose={() => setPdfCenterOpen(false)} list={list} total={total} />
  </SafeAreaView>;
}

function ItemRow({ item, onToggle, onPrice, onEdit, onMore, onOmit, canEditStructure = true }: {
  item: Item; onToggle: () => void; onPrice: () => void; onEdit: () => void; onMore: () => void; onOmit: () => void; canEditStructure?: boolean;
}) {
  const purchased = item.status === 'purchased';
  const omitted = item.status === 'omitted';
  return <View style={[s.row, (purchased || omitted) && s.rowEmphasis]}>
    <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={`${item.name}: ${labels[item.status]}`} style={s.statusButton}>
      <View style={[s.statusCircle, purchased && s.statusPurchased, omitted && s.statusOmitted]}>
        {purchased ? <Text style={s.statusMark}>✓</Text> : omitted ? <ThemedIcon role="destructive" style={[s.statusMark, s.omittedMark]}>╱</ThemedIcon> : <Text style={s.statusMark} />}
      </View>
    </Pressable>
    <Pressable onPress={onEdit} style={s.itemCopy} accessibilityRole="button" accessibilityLabel={`${item.name} সম্পাদনা করুন`}>
      <View style={s.nameLine}><Text numberOfLines={1} style={[s.itemName, omitted && s.itemOmitted]}>{item.name}</Text>{item.status === 'new' && <Text style={s.newBadge}>নতুন</Text>}</View>
      <Text style={[s.itemQty, omitted && s.itemOmitted]}>{item.qty}</Text>
      <Text style={s.itemStatus}>{labels[item.status]}</Text>
    </Pressable>
    {purchased ? <View style={s.purchasedActions}>
      <Text style={[s.itemPrice, typeof item.price !== 'number' && s.itemPriceEmpty]}>{typeof item.price === 'number' ? `৳${bn(item.price)}` : 'দাম'}</Text>
      <Pressable onPress={onPrice} style={s.actionButton} accessibilityLabel={`${item.name} দাম সম্পাদনা করুন`}><ThemedIcon role="secondary" style={s.editGlyph}>✎</ThemedIcon></Pressable>
      {canEditStructure && <Pressable onPress={onMore} style={s.actionButton} accessibilityLabel={`${item.name} এর আরও অপশন`}><ThemedIcon role="secondary" style={s.moreGlyph}>⋮</ThemedIcon></Pressable>}
    </View> : omitted ? (canEditStructure ? <Pressable onPress={onMore} style={s.actionButton} accessibilityLabel={`${item.name} এর আরও অপশন`}><ThemedIcon role="secondary" style={s.moreGlyph}>⋮</ThemedIcon></Pressable> : <View style={s.actionButton} />) : <View style={s.pendingActions}>
      <Pressable onPress={onPrice} style={s.pricePrompt} accessibilityLabel={`${item.name} কেনা সম্পন্ন করে দাম যোগ করুন`}><Text style={s.pricePromptText}>দাম</Text><ThemedIcon role="secondary" style={s.plusGlyph}>＋</ThemedIcon></Pressable>
      {canEditStructure && <><Pressable onPress={onOmit} style={s.omitButton} accessibilityLabel={`${item.name} তালিকা থেকে বাদ দিন`}><ThemedIcon role="destructive" style={s.omitGlyph}>×</ThemedIcon></Pressable><Pressable onPress={onMore} style={s.actionButton} accessibilityLabel={`${item.name} এর আরও অপশন`}><ThemedIcon role="secondary" style={s.moreGlyph}>⋮</ThemedIcon></Pressable></>}
    </View>}
  </View>;
}

function MenuAction({ label, onPress, destructive = false }: { label: string; onPress: () => void; destructive?: boolean }) {
  return <Pressable style={s.menuAction} onPress={onPress}><Text style={[s.menuActionText, destructive && s.destructiveText]}>{label}</Text><ThemedIcon role={destructive ? 'destructive' : 'secondary'} style={s.menuChevron}>›</ThemedIcon></Pressable>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#030507' },
  header: { minHeight: 106, paddingHorizontal: 16, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: '#101820' },
  backButton: { width: 30, height: 44, alignItems: 'center', justifyContent: 'center' }, back: { color: '#a7b4be', fontSize: 34, lineHeight: 39 },
  headerIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#105b49', borderWidth: 1, borderColor: '#278d70' }, headerCopy: { flex: 1, minWidth: 0 }, headerTitle: { color: '#f2f5f6', fontSize: 22, fontWeight: '600' }, headerTitleInput: { color: '#d3dce1', fontSize: 14, fontWeight: '500', marginTop: 1, padding: 0, height: 23 }, headerDate: { color: '#78848e', fontSize: 10, marginTop: 2 }, totalLabel: { color: '#93a0a8', fontSize: 12 }, totalValue: { color: '#bdebd9', fontSize: 18, fontWeight: '700', flexShrink: 1 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 15, marginTop: 11, marginBottom: 5 }, syncNotice: { marginHorizontal: 18, marginBottom: 5, color: '#e9c78d', fontSize: 11 }, totalSummary: { flex: 1, minWidth: 0, minHeight: 58, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderRadius: 15, borderWidth: 1, borderColor: '#1b3931', backgroundColor: '#0c1917' }, totalInfo: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }, summaryShareButton: { width: 52, height: 58, marginLeft: 7, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17372d', borderWidth: 1, borderColor: '#255442' }, summaryPrintButton: { width: 52, height: 58, marginLeft: 7, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17372d', borderWidth: 1, borderColor: '#255442' }, summaryIconImage: { width: 31, height: 31, tintColor: '#4bc28b' }, summaryIconLight: { tintColor: '#fff' }, summaryActionLight: { backgroundColor: '#187a52', borderColor: '#a9d8bf' }, addActions: { flexDirection: 'row', gap: 10, marginTop: 18 }, addAnother: { flex: 1, marginTop: 0 }, addFinish: { height: 49, minWidth: 78, paddingHorizontal: 14, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#40524b', backgroundColor: '#1a2824' }, addFinishText: { color: '#d6e2dc', fontSize: 15, fontWeight: '600' }, listScroll: { flex: 1 },
  items: { paddingBottom: 100 }, row: { minHeight: 101, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#030507', borderBottomWidth: 1, borderBottomColor: '#0a0e12' }, rowEmphasis: { backgroundColor: '#0c141c' }, statusButton: { width: 48, height: 58, alignItems: 'center', justifyContent: 'center' }, statusCircle: { width: 38, height: 38, borderRadius: 19, borderWidth: 2.5, borderColor: '#42c6a0', alignItems: 'center', justifyContent: 'center' }, statusPurchased: { borderColor: '#00a77b', backgroundColor: '#00a77b' }, statusOmitted: { borderWidth: 0, backgroundColor: '#f21820' }, statusMark: { color: '#fff', fontSize: 24, fontWeight: '700', lineHeight: 27 }, omittedMark: { fontSize: 30, fontWeight: '400', transform: [{ rotate: '45deg' }] }, itemCopy: { flex: 1, minWidth: 0, paddingVertical: 13 }, nameLine: { flexDirection: 'row', alignItems: 'center', gap: 7 }, itemName: { flexShrink: 1, color: '#f3f5f6', fontSize: 20, fontWeight: '500' }, itemOmitted: { color: '#737a80', textDecorationLine: 'line-through' }, newBadge: { color: '#70d7b1', backgroundColor: '#153d32', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, fontSize: 10, overflow: 'hidden' }, itemQty: { color: '#737e87', fontSize: 14, marginTop: 3 }, itemStatus: { display: 'none' },
  purchasedActions: { minWidth: 109, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }, itemPrice: { color: '#eef2f4', fontSize: 17, minWidth: 34, textAlign: 'right' }, itemPriceEmpty: { color: '#aeb8bf' }, actionButton: { width: 34, height: 48, alignItems: 'center', justifyContent: 'center' }, editGlyph: { color: '#d9e2e7', fontSize: 23 }, moreGlyph: { color: '#eef1f3', fontSize: 25, lineHeight: 28 }, pendingActions: { minWidth: 136, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }, pricePrompt: { minWidth: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, pricePromptText: { color: '#e2e8eb', fontSize: 17 }, plusGlyph: { color: '#aab5bd', fontSize: 22, paddingHorizontal: 3 }, omitButton: { width: 30, height: 44, alignItems: 'center', justifyContent: 'center' }, omitGlyph: { color: '#f21d2a', fontSize: 26, lineHeight: 28 },
  empty: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 24 }, emptyTitle: { color: '#e8edf0', fontSize: 19, fontWeight: '600' }, emptyText: { color: '#82909a', fontSize: 13, marginTop: 7, textAlign: 'center' },
  addFab: { position: 'absolute', right: 20, bottom: 28, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00a77b', elevation: 8, shadowColor: '#00a77b', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, addFabDisabled: { opacity: 0.55 }, addFabGlyph: { color: '#fff', fontSize: 35, lineHeight: 40, fontWeight: '300' },
  modalKeyboard: { flex: 1 }, sheetScroll: { flexShrink: 1 }, sheetScrollContent: { flexGrow: 1 }, scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.68)' }, sheet: { maxHeight: '88%', paddingHorizontal: 22, paddingTop: 12, paddingBottom: 24, backgroundColor: '#111920', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: '#26333d' }, grabber: { width: 38, height: 4, borderRadius: 3, backgroundColor: '#59656e', alignSelf: 'center', marginBottom: 18 }, sheetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sheetEyebrow: { color: '#54c99e', fontSize: 12 }, sheetTitle: { color: '#f2f5f6', fontSize: 19, fontWeight: '600', marginBottom: 9 }, sheetClose: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1b2730' }, sheetCloseText: { color: '#d4dde2', fontSize: 25 }, fieldLabel: { color: '#c1cbd1', fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 7 }, moneyField: { minHeight: 53, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, borderWidth: 1, borderColor: '#34434e', borderRadius: 13, backgroundColor: '#0a1015' }, currency: { color: '#7ed9b7', fontSize: 20, fontWeight: '600' }, moneyInput: { flex: 1, minHeight: 50, color: '#f4f6f7', fontSize: 17 }, autoSave: { color: '#72808a', fontSize: 11, marginTop: 8 }, sheetDone: { height: 49, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00a77b', marginTop: 18 }, sheetDoneText: { color: '#fff', fontSize: 15, fontWeight: '600' }, formInput: { minHeight: 51, paddingHorizontal: 14, borderWidth: 1, borderColor: '#34434e', borderRadius: 13, color: '#f4f6f7', backgroundColor: '#0a1015', fontSize: 15 },
  menuAction: { minHeight: 53, borderBottomWidth: 1, borderColor: '#26333d', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, menuActionText: { color: '#e8edf0', fontSize: 15 }, destructiveText: { color: '#ff666c' }, menuChevron: { color: '#7d8992', fontSize: 24 }, cancelAction: { minHeight: 47, alignItems: 'center', justifyContent: 'center', marginTop: 7 }, cancelText: { color: '#9ca8b0', fontSize: 14 },
});
