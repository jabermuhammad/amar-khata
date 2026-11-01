import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import { bn, normalizeStoredLists, removeEmptyLocalListDrafts, STORE, type Item, type ListCategory, type ListId, type ShoppingList } from '../data';
import ShoppingCartIcon from './ShoppingCartIcon';
import ShareDialog from './ShareDialog';
import { GlossyPressable as Pressable } from './GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import { addRemoteItem, deleteRemoteItem, updateRemoteItem, updateRemoteListTitle, watchRemoteList, type RemoteList } from '../lib/collaboration';

const labels = { pending: 'কেনা বাকি', purchased: 'কেনা সম্পন্ন', omitted: 'তালিকা থেকে বাদ', new: 'নতুন যোগ করা হয়েছে' } as const;

export default function ShoppingListScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; remoteId?: string; startAdd?: string; category?: ListCategory }>();
  const { user } = useAuth();
  const listId = params.id || 'today';
  const [activeRemoteId, setActiveRemoteId] = useState(params.remoteId || '');
  const remoteId = params.remoteId || activeRemoteId || undefined;
  const [lists, setLists] = useState<Record<ListId, ShoppingList>>({});
  const [remoteList, setRemoteList] = useState<RemoteList | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [editName, setEditName] = useState('');
  const [editQty, setEditQty] = useState('');
  const editQtyRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const editNameRef = useRef<React.ElementRef<typeof TextInput>>(null);
  const didAutoOpenAdd = useRef(false);
  const [priceItem, setPriceItem] = useState<Item | null>(null);
  const [priceText, setPriceText] = useState('');
  const [menuItem, setMenuItem] = useState<Item | null>(null);

  const list: ShoppingList = remoteList || lists[listId] || { title: '', category: params.category, items: [] };
  const remotePermission = remoteList?.permission;
  const canEditStructure = !remoteId || remotePermission === 'editor' || remotePermission === 'owner';
  const total = useMemo(() => list.items.reduce((sum, item) => sum + (item.status === 'purchased' && typeof item.price === 'number' ? item.price : 0), 0), [list.items]);

  useEffect(() => {
    if (remoteId && user) {
      return watchRemoteList(remoteId, user.uid, value => { setRemoteList(value); setLoaded(true); }, error => { setRemoteList(null); setLoaded(false); Alert.alert('শেয়ার করা তালিকা বন্ধ হয়েছে', error.message); });
    }
    let active = true;
    AsyncStorage.getItem(STORE.lists).then(value => {
      if (active && value) {
        const stored = removeEmptyLocalListDrafts(normalizeStoredLists(JSON.parse(value)));
        const dated = Object.fromEntries(Object.entries(stored).map(([id, saved]) => [id, { ...saved, createdAt: saved.createdAt || (saved.title.trim() ? new Date().toISOString() : undefined) }]));
        setLists(dated);
        if (JSON.stringify(normalizeStoredLists(JSON.parse(value))) !== JSON.stringify(dated)) AsyncStorage.setItem(STORE.lists, JSON.stringify(dated)).catch(() => {});
      }
    }).catch(() => {}).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [remoteId, user]);
  useEffect(() => { if (!remoteId && loaded) AsyncStorage.setItem(STORE.lists, JSON.stringify(lists)).catch(() => {}); }, [lists, loaded, remoteId]);

  const updateItems = (update: (items: Item[]) => Item[]) => {
    if (remoteId && remoteList && user) {
      const previous = remoteList.items;
      const next = update(previous);
      const oldById = new Map(previous.map(item => [String(item.id), item]));
      const nextById = new Map(next.map(item => [String(item.id), item]));
      for (const item of next) {
        const before = oldById.get(String(item.id));
        if (!before) {
          const { id: _id, ...fields } = item;
          addRemoteItem(remoteId, user, fields).catch(error => Alert.alert('পণ্য যোগ হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'));
        } else {
          const changed: Partial<Pick<Item, 'name' | 'qty' | 'price' | 'status'>> = {};
          if (before.name !== item.name) changed.name = item.name;
          if (before.qty !== item.qty) changed.qty = item.qty;
          if (before.status !== item.status) changed.status = item.status;
          if (before.price !== item.price) changed.price = item.price;
          if (Object.keys(changed).length) updateRemoteItem(remoteId, item.id, user, changed).catch(error => Alert.alert('পরিবর্তন সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'অনুমতি বা ইন্টারনেট পরীক্ষা করুন।'));
        }
      }
      for (const item of previous) if (!nextById.has(String(item.id))) deleteRemoteItem(remoteId, item.id).catch(error => Alert.alert('পণ্য মোছা যায়নি', error instanceof Error ? error.message : 'অনুমতি বা ইন্টারনেট পরীক্ষা করুন।'));
      return;
    }
    setLists(current => {
      const existing = current[listId] || list;
      const items = update(existing.items);
      return { ...current, [listId]: { ...existing, items, createdAt: existing.createdAt || (existing.title.trim() || items.length ? new Date().toISOString() : undefined) } };
    });
  };
  const updateTitle = (title: string) => {
    if (remoteId) {
      if (canEditStructure) updateRemoteListTitle(remoteId, title).catch(error => Alert.alert('শিরোনাম সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'));
      return;
    }
    setLists(current => {
      const existing = current[listId] || list;
      return { ...current, [listId]: { ...existing, title, createdAt: existing.createdAt || (title.trim() || existing.items.length ? new Date().toISOString() : undefined) } };
    });
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
    if (!loaded) return;
    if (!canEditStructure) {
      Alert.alert('Edit Permission দরকার', 'নতুন পণ্য যোগ করতে তালিকার মালিকের কাছ থেকে Edit Permission নিন।');
      return;
    }
    setAddingItem(true);
    setEditItem(null);
    setEditName('');
    setEditQty('১টি');
  }, [canEditStructure, loaded]);
  useEffect(() => {
    if (loaded && params.startAdd === '1' && !didAutoOpenAdd.current) {
      didAutoOpenAdd.current = true;
      openAddItem();
    }
  }, [loaded, openAddItem, params.startAdd]);
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
  const printList = async () => {
    const printableItems = list.items.filter(item => item.status !== 'omitted');
    if (!printableItems.length) {
      Alert.alert('তালিকা খালি', 'প্রিন্ট করার আগে বাজারের জিনিস যোগ করুন।');
      return;
    }
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
    const date = list.createdAt ? new Date(list.createdAt) : new Date();
    const rows = printableItems.map((item, index) => {
      const purchased = item.status === 'purchased';
      const price = typeof item.price === 'number' ? `৳${bn(item.price)}` : '—';
      return `<tr><td class="number">${bn(index + 1)}</td><td>${escapeHtml(item.name)}</td><td class="quantity">${escapeHtml(item.qty || '—')}</td><td class="status"><span class="check ${purchased ? 'checked' : ''}">${purchased ? '✓' : ''}</span> ${purchased ? 'কেনা হয়েছে' : 'বাকি'}</td><td class="price">${price}</td></tr>`;
    }).join('');
    const html = `<!doctype html><html lang="bn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(list.title || 'বাজারের তালিকা')}</title><style>
      @page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{font-family:"Noto Sans Bengali","Nirmala UI",Arial,sans-serif;color:#17231f;margin:0;font-size:11pt}.sheet{width:100%}.brand{font-size:9pt;letter-spacing:.08em;color:#167455;font-weight:700;text-transform:uppercase;margin-bottom:5mm}.heading{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #167455;padding-bottom:5mm;margin-bottom:6mm}.title{font-size:22pt;font-weight:700;margin:0 0 2mm}.subtitle{font-size:9pt;color:#69756f}.meta{text-align:right;font-size:9pt;color:#58655f;line-height:1.7}.summary{display:flex;justify-content:space-between;padding:3mm 4mm;background:#f0f6f3;border:1px solid #d5e3dc;border-radius:2mm;margin-bottom:5mm;font-size:9pt}.summary strong{color:#145a40}.table{width:100%;border-collapse:collapse;table-layout:fixed}.table th{background:#e8f1ec;color:#29483b;font-size:9pt;text-align:left;padding:3mm 2.5mm;border:1px solid #cbd9d1}.table td{padding:3mm 2.5mm;border:1px solid #d8e0dc;vertical-align:middle;height:12mm}.number{width:10mm;text-align:center;color:#68766e}.quantity{width:28mm}.status{width:37mm;font-size:9pt}.price{width:25mm;text-align:right}.check{display:inline-flex;border:1px solid #8b9d92;width:4mm;height:4mm;line-height:3mm;text-align:center;align-items:center;justify-content:center;font-weight:bold}.checked{border-color:#167455;color:#167455}.footer{margin-top:7mm;padding-top:3mm;border-top:1px solid #d8e0dc;display:flex;justify-content:space-between;color:#69756f;font-size:8pt}.emptyline{color:#839087}.totalrow{font-weight:700;background:#f7faf8}.totalrow td{border-top:2px solid #a8bcb0}.keep{break-inside:avoid} </style></head><body><main class="sheet"><div class="brand">আমার খাতা · বাজারের তালিকা</div><header class="heading"><div><h1 class="title">${escapeHtml(list.title || 'বাজারের তালিকা')}</h1><div class="subtitle">পরিকল্পিত বাজার · পণ্য ও খরচের হিসাব</div></div><div class="meta">তালিকার তারিখ<br><strong>${escapeHtml(date.toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }))}</strong><br>${escapeHtml(date.toLocaleTimeString('bn-BD', { hour: 'numeric', minute: '2-digit' }))}</div></header><div class="summary"><span>মোট পণ্য: <strong>${bn(printableItems.length)}টি</strong></span><span>কেনা হয়েছে: <strong>${bn(printableItems.filter(item => item.status === 'purchased').length)}টি</strong></span></div><table class="table"><thead><tr><th class="number">নং</th><th>পণ্যের নাম</th><th class="quantity">পরিমাণ</th><th class="status">অবস্থা</th><th class="price">দাম</th></tr></thead><tbody>${rows}<tr class="totalrow"><td colspan="4" style="text-align:right">কেনা পণ্যের মোট দাম</td><td class="price">৳${bn(total)}</td></tr></tbody></table><footer class="footer"><span>তালিকার আইটেম: ${bn(printableItems.length)}টি</span><span>প্রিন্টের সময়: ${escapeHtml(new Date().toLocaleString('bn-BD'))}</span></footer></main></body></html>`;
    try {
      await Print.printAsync({ html });
    } catch (error) {
      Alert.alert('প্রিন্ট প্রিভিউ খোলা যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।');
    }
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
    <StatusBar style="light" />
    <View style={s.header}>
      <Pressable onPress={() => router.back()} style={s.backButton} accessibilityLabel="পেছনে যান"><Text style={s.back}>‹</Text></Pressable>
      <View style={s.headerIcon} accessibilityLabel="তালিকা"><ShoppingCartIcon size={32} /></View>
      <View style={s.headerCopy}><Text numberOfLines={1} ellipsizeMode="tail" style={s.headerTitle}>তালিকা</Text><TextInput value={list.title} onChangeText={updateTitle} editable={loaded && canEditStructure} numberOfLines={1} placeholder="তালিকার শিরোনাম লিখুন" placeholderTextColor="#78848e" style={s.headerTitleInput} returnKeyType="done" /><Text style={s.headerDate}>{list.title.trim() && list.createdAt ? `${new Date(list.createdAt).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' })} · ${new Date(list.createdAt).toLocaleTimeString('bn-BD', { hour: 'numeric', minute: '2-digit' })}` : 'শিরোনাম দিলে তারিখ ও সময় যোগ হবে'}</Text></View>
    </View>

    <View style={s.summaryRow}><View style={s.totalSummary}><View style={s.totalInfo}><Text style={s.totalLabel}>মোট</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={s.totalValue}>৳{bn(total)}</Text></View></View><Pressable onPress={printList} style={s.summaryPrintButton} accessibilityRole="button" accessibilityLabel="এই বাজারের তালিকা প্রিন্ট করুন" hitSlop={6}><Image source={require('../../assets/printer.png')} resizeMode="contain" style={s.summaryIconImage} accessible={false} /></Pressable><Pressable onPress={() => setShareOpen(true)} style={s.summaryShareButton} accessibilityRole="button" accessibilityLabel="এই বাজারের তালিকা শেয়ার করুন" hitSlop={6}><Image source={require('../../assets/send.png')} resizeMode="contain" style={s.summaryIconImage} accessible={false} /></Pressable></View>
    <ScrollView style={s.listScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={s.items} showsVerticalScrollIndicator={false}>
      {remoteId && !loaded ? <ActivityIndicator style={{ marginTop: 35 }} color="#2b8655" /> : list.items.length ? list.items.map(item => <ItemRow
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

    <Pressable disabled={!loaded} onPress={openAddItem} style={[s.addFab, !loaded && s.addFabDisabled]} accessibilityRole="button" accessibilityLabel="বাজারের নতুন পণ্য যোগ করুন" hitSlop={10}><Text style={s.addFabGlyph}>＋</Text></Pressable>

    <Modal visible={!!priceItem} transparent animationType="slide" onRequestClose={() => setPriceItem(null)}>
      <KeyboardAvoidingView style={s.modalKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={s.scrim} onPress={() => setPriceItem(null)}>
        <Pressable style={s.sheet} onPress={event => event.stopPropagation()}><ScrollView style={s.sheetScroll} contentContainerStyle={s.sheetScrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={s.grabber} /><View style={s.sheetHeading}><View><Text style={s.sheetEyebrow}>কেনা সম্পন্ন</Text><Text style={s.sheetTitle}>{priceItem?.name}</Text></View><Pressable onPress={() => setPriceItem(null)} style={s.sheetClose}><Text style={s.sheetCloseText}>×</Text></Pressable></View>
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
        <Text style={[s.statusMark, omitted && s.omittedMark]}>{purchased ? '✓' : omitted ? '╱' : ''}</Text>
      </View>
    </Pressable>
    <Pressable onPress={onEdit} style={s.itemCopy} accessibilityRole="button" accessibilityLabel={`${item.name} সম্পাদনা করুন`}>
      <View style={s.nameLine}><Text numberOfLines={1} style={[s.itemName, omitted && s.itemOmitted]}>{item.name}</Text>{item.status === 'new' && <Text style={s.newBadge}>নতুন</Text>}</View>
      <Text style={[s.itemQty, omitted && s.itemOmitted]}>{item.qty}</Text>
      <Text style={s.itemStatus}>{labels[item.status]}</Text>
    </Pressable>
    {purchased ? <View style={s.purchasedActions}>
      <Text style={[s.itemPrice, typeof item.price !== 'number' && s.itemPriceEmpty]}>{typeof item.price === 'number' ? `৳${bn(item.price)}` : 'দাম'}</Text>
      <Pressable onPress={onPrice} style={s.actionButton} accessibilityLabel={`${item.name} দাম সম্পাদনা করুন`}><Text style={s.editGlyph}>✎</Text></Pressable>
      {canEditStructure && <Pressable onPress={onMore} style={s.actionButton} accessibilityLabel={`${item.name} এর আরও অপশন`}><Text style={s.moreGlyph}>⋮</Text></Pressable>}
    </View> : omitted ? (canEditStructure ? <Pressable onPress={onMore} style={s.actionButton} accessibilityLabel={`${item.name} এর আরও অপশন`}><Text style={s.moreGlyph}>⋮</Text></Pressable> : <View style={s.actionButton} />) : <View style={s.pendingActions}>
      <Pressable onPress={onPrice} style={s.pricePrompt} accessibilityLabel={`${item.name} কেনা সম্পন্ন করে দাম যোগ করুন`}><Text style={s.pricePromptText}>দাম</Text><Text style={s.plusGlyph}>＋</Text></Pressable>
      {canEditStructure && <><Pressable onPress={onOmit} style={s.omitButton} accessibilityLabel={`${item.name} তালিকা থেকে বাদ দিন`}><Text style={s.omitGlyph}>×</Text></Pressable><Pressable onPress={onMore} style={s.actionButton} accessibilityLabel={`${item.name} এর আরও অপশন`}><Text style={s.moreGlyph}>⋮</Text></Pressable></>}
    </View>}
  </View>;
}

function MenuAction({ label, onPress, destructive = false }: { label: string; onPress: () => void; destructive?: boolean }) {
  return <Pressable style={s.menuAction} onPress={onPress}><Text style={[s.menuActionText, destructive && s.destructiveText]}>{label}</Text><Text style={s.menuChevron}>›</Text></Pressable>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#030507' },
  header: { minHeight: 106, paddingHorizontal: 16, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: '#101820' },
  backButton: { width: 30, height: 44, alignItems: 'center', justifyContent: 'center' }, back: { color: '#a7b4be', fontSize: 34, lineHeight: 39 },
  headerIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#105b49', borderWidth: 1, borderColor: '#278d70' }, headerCopy: { flex: 1, minWidth: 0 }, headerTitle: { color: '#f2f5f6', fontSize: 22, fontWeight: '600' }, headerTitleInput: { color: '#d3dce1', fontSize: 14, fontWeight: '500', marginTop: 1, padding: 0, height: 23 }, headerDate: { color: '#78848e', fontSize: 10, marginTop: 2 }, totalLabel: { color: '#93a0a8', fontSize: 12 }, totalValue: { color: '#bdebd9', fontSize: 18, fontWeight: '700', flexShrink: 1 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 15, marginTop: 11, marginBottom: 5 }, totalSummary: { flex: 1, minWidth: 0, minHeight: 58, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderRadius: 15, borderWidth: 1, borderColor: '#1b3931', backgroundColor: '#0c1917' }, totalInfo: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }, summaryShareButton: { width: 52, height: 58, marginLeft: 7, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17372d', borderWidth: 1, borderColor: '#255442' }, summaryPrintButton: { width: 52, height: 58, marginLeft: 7, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17372d', borderWidth: 1, borderColor: '#255442' }, summaryIconImage: { width: 31, height: 31, tintColor: '#4bc28b' }, addActions: { flexDirection: 'row', gap: 10, marginTop: 18 }, addAnother: { flex: 1, marginTop: 0 }, addFinish: { height: 49, minWidth: 78, paddingHorizontal: 14, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#40524b', backgroundColor: '#1a2824' }, addFinishText: { color: '#d6e2dc', fontSize: 15, fontWeight: '600' }, listScroll: { flex: 1 },
  items: { paddingBottom: 100 }, row: { minHeight: 101, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#030507', borderBottomWidth: 1, borderBottomColor: '#0a0e12' }, rowEmphasis: { backgroundColor: '#0c141c' }, statusButton: { width: 48, height: 58, alignItems: 'center', justifyContent: 'center' }, statusCircle: { width: 38, height: 38, borderRadius: 19, borderWidth: 2.5, borderColor: '#42c6a0', alignItems: 'center', justifyContent: 'center' }, statusPurchased: { borderColor: '#00a77b', backgroundColor: '#00a77b' }, statusOmitted: { borderWidth: 0, backgroundColor: '#f21820' }, statusMark: { color: '#fff', fontSize: 24, fontWeight: '700', lineHeight: 27 }, omittedMark: { fontSize: 30, fontWeight: '400', transform: [{ rotate: '45deg' }] }, itemCopy: { flex: 1, minWidth: 0, paddingVertical: 13 }, nameLine: { flexDirection: 'row', alignItems: 'center', gap: 7 }, itemName: { flexShrink: 1, color: '#f3f5f6', fontSize: 20, fontWeight: '500' }, itemOmitted: { color: '#737a80', textDecorationLine: 'line-through' }, newBadge: { color: '#70d7b1', backgroundColor: '#153d32', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, fontSize: 10, overflow: 'hidden' }, itemQty: { color: '#737e87', fontSize: 14, marginTop: 3 }, itemStatus: { display: 'none' },
  purchasedActions: { minWidth: 109, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }, itemPrice: { color: '#eef2f4', fontSize: 17, minWidth: 34, textAlign: 'right' }, itemPriceEmpty: { color: '#aeb8bf' }, actionButton: { width: 34, height: 48, alignItems: 'center', justifyContent: 'center' }, editGlyph: { color: '#d9e2e7', fontSize: 23 }, moreGlyph: { color: '#eef1f3', fontSize: 25, lineHeight: 28 }, pendingActions: { minWidth: 136, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }, pricePrompt: { minWidth: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, pricePromptText: { color: '#e2e8eb', fontSize: 17 }, plusGlyph: { color: '#aab5bd', fontSize: 22, paddingHorizontal: 3 }, omitButton: { width: 30, height: 44, alignItems: 'center', justifyContent: 'center' }, omitGlyph: { color: '#f21d2a', fontSize: 26, lineHeight: 28 },
  empty: { alignItems: 'center', paddingTop: 90, paddingHorizontal: 24 }, emptyTitle: { color: '#e8edf0', fontSize: 19, fontWeight: '600' }, emptyText: { color: '#82909a', fontSize: 13, marginTop: 7, textAlign: 'center' },
  addFab: { position: 'absolute', right: 20, bottom: 28, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00a77b', elevation: 8, shadowColor: '#00a77b', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, addFabDisabled: { opacity: 0.55 }, addFabGlyph: { color: '#fff', fontSize: 35, lineHeight: 40, fontWeight: '300' },
  modalKeyboard: { flex: 1 }, sheetScroll: { flexShrink: 1 }, sheetScrollContent: { flexGrow: 1 }, scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.68)' }, sheet: { maxHeight: '88%', paddingHorizontal: 22, paddingTop: 12, paddingBottom: 24, backgroundColor: '#111920', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: '#26333d' }, grabber: { width: 38, height: 4, borderRadius: 3, backgroundColor: '#59656e', alignSelf: 'center', marginBottom: 18 }, sheetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sheetEyebrow: { color: '#54c99e', fontSize: 12 }, sheetTitle: { color: '#f2f5f6', fontSize: 19, fontWeight: '600', marginBottom: 9 }, sheetClose: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1b2730' }, sheetCloseText: { color: '#d4dde2', fontSize: 25 }, fieldLabel: { color: '#c1cbd1', fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 7 }, moneyField: { minHeight: 53, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, borderWidth: 1, borderColor: '#34434e', borderRadius: 13, backgroundColor: '#0a1015' }, currency: { color: '#7ed9b7', fontSize: 20, fontWeight: '600' }, moneyInput: { flex: 1, minHeight: 50, color: '#f4f6f7', fontSize: 17 }, autoSave: { color: '#72808a', fontSize: 11, marginTop: 8 }, sheetDone: { height: 49, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00a77b', marginTop: 18 }, sheetDoneText: { color: '#fff', fontSize: 15, fontWeight: '600' }, formInput: { minHeight: 51, paddingHorizontal: 14, borderWidth: 1, borderColor: '#34434e', borderRadius: 13, color: '#f4f6f7', backgroundColor: '#0a1015', fontSize: 15 },
  menuAction: { minHeight: 53, borderBottomWidth: 1, borderColor: '#26333d', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, menuActionText: { color: '#e8edf0', fontSize: 15 }, destructiveText: { color: '#ff666c' }, menuChevron: { color: '#7d8992', fontSize: 24 }, cancelAction: { minHeight: 47, alignItems: 'center', justifyContent: 'center', marginTop: 7 }, cancelText: { color: '#9ca8b0', fontSize: 14 },
});
