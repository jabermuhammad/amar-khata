import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { GlossyPressable as Pressable } from './GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import { STORE, type Note, type ShoppingList } from '../data';
import { createInvite, createOwnedList, createOwnedNote, deleteOwnedResource, getMember, getMembers, removeMember, updateMemberPermission, type ResourceKind } from '../lib/collaboration';

type Props = {
  visible: boolean;
  onClose: () => void;
  kind: ResourceKind;
  localId: string;
  resourceId?: string;
  note?: Note;
  list?: ShoppingList;
  onLinked?: (cloudId: string) => void;
  onDeleted?: () => void;
  keyboardAvoiding?: boolean;
};
type Member = { uid: string; permission: string; email?: string };

export default function ShareDialog({ visible, onClose, kind, localId, resourceId, note, list, onLinked, onDeleted, keyboardAvoiding = false }: Props) {
  const { user, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState(kind === 'list' ? 'shopper' : 'viewer');
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoadedFor, setMembersLoadedFor] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [cloudId, setCloudId] = useState(resourceId || '');
  const visibleMembers = membersLoadedFor === cloudId ? members : [];
  const isOwner = visibleMembers.some(member => member.uid === user?.uid && member.permission === 'owner');

  const close = () => { setCode(''); setMembers([]); setMembersLoadedFor(''); setCloudId(resourceId || ''); onClose(); };
  useEffect(() => {
    if (!visible || !cloudId || !user) return;
    let active = true;
    getMember(kind, cloudId, user.uid).then(async currentMember => {
      if (!active) return;
      const value = currentMember?.permission === 'owner'
        ? await getMembers(kind, cloudId)
        : currentMember ? [currentMember] : [];
      if (active) { setMembers(value); setMembersLoadedFor(cloudId); }
    }).catch(error => Alert.alert('সদস্য দেখা যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'));
    return () => { active = false; };
  }, [cloudId, kind, user, visible]);

  const ensureCloudResource = async () => {
    if (!user || !configured) throw new Error('Firebase অ্যাকাউন্ট সংযোগ করা নেই।');
    if (cloudId) return cloudId;
    if (kind === 'list' && !list?.title.trim() && !list?.items.length) throw new Error('খালি তালিকা শেয়ার করা যাবে না। আগে শিরোনাম বা অন্তত একটি পণ্য যোগ করুন।');
    const id = kind === 'list'
      ? await createOwnedList(user, list || { title: '', items: [] })
      : await createOwnedNote(user, note || { id: localId, title: '', body: '' });
    if (kind === 'list') {
      const saved = await AsyncStorage.getItem(STORE.lists);
      const lists = saved ? JSON.parse(saved) as Record<string, ShoppingList & { cloudId?: string }> : {};
      lists[localId] = { ...(lists[localId] || list || { title: '', items: [] }), cloudId: id };
      await AsyncStorage.setItem(STORE.lists, JSON.stringify(lists));
    } else {
      const saved = await AsyncStorage.getItem(STORE.notes);
      const notes = saved ? JSON.parse(saved) as (Note & { id: string; cloudId?: string })[] : [];
      const index = notes.findIndex(value => value.id === localId);
      if (index >= 0) notes[index] = { ...notes[index], cloudId: id };
      else notes.unshift({ ...(note || { title: '', body: '' }), id: localId, cloudId: id });
      await AsyncStorage.setItem(STORE.notes, JSON.stringify(notes));
    }
    setCloudId(id);
    onLinked?.(id);
    return id;
  };

  const share = async () => {
    if (!user?.emailVerified) { Alert.alert('ইমেইল যাচাই করুন', 'শেয়ার করার আগে আপনার account-এর ইমেইল যাচাই করুন।'); return; }
    if (!email.trim()) { Alert.alert('ইমেইল লিখুন', 'যার সঙ্গে শেয়ার করবেন তার account-এর ইমেইল লিখুন।'); return; }
    setBusy(true);
    try {
      const id = await ensureCloudResource();
      const inviteId = await createInvite(user, kind, id, email, permission as never);
      setCode(inviteId);
      setEmail('');
      setMembers(await getMembers(kind, id));
      Alert.alert('Invite তৈরি হয়েছে', 'এই code শুধু আমন্ত্রিত verified ইমেইল দিয়ে গ্রহণ করা যাবে।');
    } catch (error) { Alert.alert('শেয়ার করা যায়নি', error instanceof Error ? error.message : 'ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  };

  const sendCode = async () => {
    if (!code) return;
    const message = `আমার খাতা অ্যাপে ${kind === 'list' ? 'বাজারের তালিকা' : 'নোট'}-এর invite code: ${code}\nঅ্যাপে Invite গ্রহণ করুন। শুধু আমন্ত্রিত ইমেইল দিয়ে code কাজ করবে।`;
    try { await Share.share({ message }); } catch { Alert.alert('শেয়ার প্যানেল খোলা যায়নি', message); }
  };

  const changeMember = (member: Member) => {
    if (!user || member.uid === user.uid) return;
    const next = kind === 'list' ? member.permission === 'editor' ? 'shopper' : 'editor' : member.permission === 'editor' ? 'viewer' : 'editor';
    Alert.alert('অনুমতি পরিবর্তন করবেন?', `${member.email || member.uid.slice(0, 10)}: ${next === 'editor' ? 'Editor' : next === 'shopper' ? 'Shopper' : 'Viewer'}`, [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'পরিবর্তন', onPress: async () => { try { await updateMemberPermission(kind, cloudId, member.uid, next as never); setMembers(await getMembers(kind, cloudId)); } catch (error) { Alert.alert('পরিবর্তন হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); } } },
    ]);
  };

  const kickMember = (member: Member) => {
    if (!user || member.uid === user.uid) return;
    Alert.alert('সদস্য সরাবেন?', 'সরালে তিনি পরবর্তী সময় থেকে এই resource পড়তে বা বদলাতে পারবেন না।', [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'সরিয়ে দিন', style: 'destructive', onPress: async () => { try { await removeMember(kind, cloudId, member.uid); setMembers(await getMembers(kind, cloudId)); } catch (error) { Alert.alert('সদস্য সরানো যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); } } },
    ]);
  };

  const deleteShared = () => {
    if (!user || !cloudId || !isOwner) return;
    Alert.alert('তালিকা/নোট স্থায়ীভাবে মুছবেন?', 'Cloud-এর রিসোর্স, তার পণ্য/সদস্য এবং এই ফোনে থাকা এর লোকাল কপিও মুছে যাবে। এই কাজটি ফিরিয়ে নেওয়া যাবে না।', [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'স্থায়ীভাবে মুছুন', style: 'destructive', onPress: async () => {
        setBusy(true);
        try {
          await deleteOwnedResource(kind, cloudId, user.uid);
          if (kind === 'list') {
            const saved = await AsyncStorage.getItem(STORE.lists);
            const lists = saved ? JSON.parse(saved) as Record<string, ShoppingList & { cloudId?: string }> : {};
            for (const [key, value] of Object.entries(lists)) if (key === localId || value.cloudId === cloudId) delete lists[key];
            await AsyncStorage.setItem(STORE.lists, JSON.stringify(lists));
          } else {
            const saved = await AsyncStorage.getItem(STORE.notes);
            const notes = saved ? JSON.parse(saved) as (Note & { id: string; cloudId?: string })[] : [];
            await AsyncStorage.setItem(STORE.notes, JSON.stringify(notes.filter(entry => entry.id !== localId && entry.cloudId !== cloudId)));
          }
          close(); onDeleted?.();
        } catch (error) { Alert.alert('Cloud ডাটা মোছা যায়নি', error instanceof Error ? error.message : 'ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।'); }
        finally { setBusy(false); }
      } },
    ]);
  };

  const dialog = <Pressable style={s.scrim} onPress={close}><Pressable style={s.sheet} onPress={event => event.stopPropagation()}><ScrollView style={s.sheetScroll} contentContainerStyle={s.sheetScrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode={keyboardAvoiding ? 'on-drag' : undefined}>
      <View style={s.grabber} /><View style={s.heading}><Text style={s.title}>শেয়ার ও অনুমতি</Text><Pressable onPress={close}><Text style={s.close}>×</Text></Pressable></View>
      <Text style={s.description}>{kind === 'list' ? 'সদস্যরা দাম ও কেনাকাটার অবস্থা বদলাতে পারবেন। Edit দিলে পণ্য যোগ, নাম/পরিমাণ বদল ও মুছতেও পারবেন।' : 'Viewer শুধু পড়বেন। Editor নোটের লেখা বদলাতে পারবেন।'}</Text>
      {!configured && <Text style={s.warning}>Firebase Web App config যোগ না হওয়া পর্যন্ত cloud sharing চালু হবে না।</Text>}
      {configured && <>
        {(!cloudId || isOwner) && <><Text style={s.label}>ইমেইল-নির্দিষ্ট invite</Text><TextInput value={email} onChangeText={setEmail} placeholder="যার সঙ্গে শেয়ার করবেন তার ইমেইল" placeholderTextColor="#858a82" keyboardType="email-address" autoCapitalize="none" style={s.input} />
        <View style={s.permissions}>{(kind === 'list' ? [['shopper', 'সাধারণ বাজার'], ['editor', 'Edit অনুমতি']] : [['viewer', 'শুধু দেখুন'], ['editor', 'সম্পাদনা']]).map(([value, label]) => <Pressable key={value} onPress={() => setPermission(value)} style={[s.permission, permission === value && s.permissionSelected]}><Text style={[s.permissionText, permission === value && s.permissionSelectedText]}>{label}</Text></Pressable>)}</View>
        <Pressable disabled={busy || !user?.emailVerified} style={[s.primary, (busy || !user?.emailVerified) && s.disabled]} onPress={share}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{user?.emailVerified ? 'Invite code তৈরি করুন' : 'ইমেইল যাচাই করে শেয়ার করুন'}</Text>}</Pressable></>}
        {!!code && <View style={s.codeBox}><Text style={s.label}>আমন্ত্রণ কোড</Text><Text selectable style={s.code}>{code}</Text><Pressable style={s.secondary} onPress={sendCode}><Text style={s.secondaryText}>ফোনের Share প্যানেলে পাঠান</Text></Pressable></View>}
        {!!visibleMembers.length && <><Text style={s.label}>সদস্য ও অনুমতি</Text>{visibleMembers.map(member => <View key={member.uid} style={s.member}><View style={{ flex: 1 }}><Text numberOfLines={1} style={s.memberEmail}>{member.email || (member.uid === user?.uid ? 'আপনি · Owner' : `সদস্য ${member.uid.slice(0, 8)}`)}</Text><Text style={s.memberPermission}>{member.permission}</Text></View>{isOwner && member.uid !== user?.uid && <><Pressable onPress={() => changeMember(member)}><Text style={s.memberAction}>অনুমতি</Text></Pressable><Pressable onPress={() => kickMember(member)}><Text style={s.remove}>সরান</Text></Pressable></>}</View>)}</>}
        {isOwner && <Pressable onPress={deleteShared} style={s.delete}><Text style={s.deleteText}>এই নোট/তালিকা স্থায়ীভাবে মুছুন</Text></Pressable>}
      </>}
      <Pressable style={s.cancel} onPress={close}><Text style={s.cancelText}>বন্ধ করুন</Text></Pressable>
    </ScrollView></Pressable></Pressable>;
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
    {keyboardAvoiding ? <KeyboardAvoidingView style={s.modalKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>{dialog}</KeyboardAvoidingView> : dialog}
  </Modal>;
}

const s = StyleSheet.create({ modalKeyboard: { flex: 1 }, sheetScroll: { flexShrink: 1 }, sheetScrollContent: { flexGrow: 1 }, scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.56)' }, sheet: { maxHeight: '90%', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 25, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#fbfbf8' }, grabber: { width: 38, height: 4, borderRadius: 3, backgroundColor: '#c7cac4', alignSelf: 'center', marginBottom: 14 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { color: '#20231f', fontSize: 20, fontWeight: '700' }, close: { color: '#697168', fontSize: 28 }, description: { color: '#6e756c', fontSize: 12, lineHeight: 19, marginTop: 4, marginBottom: 12 }, warning: { color: '#765618', backgroundColor: '#fff4d5', padding: 12, borderRadius: 12, fontSize: 12 }, label: { color: '#49534a', fontSize: 12, fontWeight: '700', marginTop: 13, marginBottom: 7 }, input: { minHeight: 48, paddingHorizontal: 13, borderWidth: 1, borderColor: '#dde3da', borderRadius: 12, color: '#222720', backgroundColor: '#fff', fontSize: 14 }, permissions: { flexDirection: 'row', gap: 9, marginTop: 10 }, permission: { flex: 1, minHeight: 41, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dde3da', borderRadius: 12 }, permissionSelected: { borderColor: '#358457', backgroundColor: '#eaf4ec' }, permissionText: { color: '#656d64', fontSize: 12 }, permissionSelectedText: { color: '#2c7048', fontWeight: '700' }, primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 12, borderRadius: 12, backgroundColor: '#2b8655' }, disabled: { opacity: .5 }, primaryText: { color: '#fff', fontWeight: '700', fontSize: 14 }, codeBox: { padding: 12, marginTop: 8, borderRadius: 13, backgroundColor: '#edf5ed' }, code: { color: '#263b2e', fontSize: 20, fontWeight: '700', letterSpacing: 1.5 }, secondary: { alignSelf: 'flex-start', paddingVertical: 9 }, secondaryText: { color: '#2f744c', fontSize: 12, fontWeight: '700' }, member: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, borderColor: '#e7eae3' }, memberEmail: { color: '#29312a', fontSize: 12, fontWeight: '600' }, memberPermission: { color: '#838a81', fontSize: 10, marginTop: 2 }, memberAction: { color: '#327b50', fontSize: 11, fontWeight: '700' }, remove: { color: '#b33535', fontSize: 11, fontWeight: '700' }, delete: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 8 }, deleteText: { color: '#b33535', fontSize: 12, fontWeight: '700' }, cancel: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, cancelText: { color: '#687068', fontSize: 13 } });
