import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ThemedKeyboardAvoidingView as KeyboardAvoidingView, ThemedScrollView as ScrollView, ThemedText as Text, ThemedView as View, ThemedIcon } from './ThemePrimitives';
import { GlossyPressable as Pressable } from './GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import type { Note, ShoppingList } from '../data';
import { createOwnedList, createOwnedNote, deleteOwnedResource, getMember, getMembers, listConnectedContacts, removeMember, shareResourceToContact, updateMemberPermission, type ConnectedContact, type ResourceKind } from '../lib/collaboration';
import { deleteScopedCloudResource, setScopedCloudLink, storageScopeId } from '../lib/localStorage';
import { shareToContactsSequentially } from '../lib/shareService.mjs';

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

export default function ShareDialog({ visible, onClose, kind, localId, resourceId, note, list, onLinked, onDeleted, keyboardAvoiding = true }: Props) {
  const { user, scope, configured } = useAuth();
  const router = useRouter();
  const [permission, setPermission] = useState(kind === 'list' ? 'shopper' : 'viewer');
  const [contacts, setContacts] = useState<ConnectedContact[]>([]);
  const [contactsForUid, setContactsForUid] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoadedFor, setMembersLoadedFor] = useState('');
  const [membersLoadedForUid, setMembersLoadedForUid] = useState('');
  const [busy, setBusy] = useState(false);
  const [cloudId, setCloudId] = useState(resourceId || '');
  const visibleMembers = membersLoadedFor === cloudId && membersLoadedForUid === user?.uid ? members : [];
  const isOwner = visibleMembers.some(member => member.uid === user?.uid && member.permission === 'owner');
  const availableContacts = contactsForUid === user?.uid ? contacts : [];

  const close = () => { setSelectedContacts([]); setMembers([]); setMembersLoadedFor(''); setMembersLoadedForUid(''); setCloudId(resourceId || ''); onClose(); };
  useEffect(() => {
    if (!visible || !user || !configured) return;
    let active = true;
    listConnectedContacts(user).then(value => { if (active) { setContacts(value); setContactsForUid(user.uid); } }).catch(error => Alert.alert('পরিচিতি লোড হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'));
    return () => { active = false; };
  }, [visible, user, configured]);
  useEffect(() => {
    if (!visible || !cloudId || !user) return;
    let active = true;
    getMember(kind, cloudId, user.uid).then(async currentMember => {
      if (!active) return;
      const value = currentMember?.permission === 'owner'
        ? await getMembers(kind, cloudId, user.uid)
        : currentMember ? [currentMember] : [];
      if (active) { setMembers(value); setMembersLoadedFor(cloudId); setMembersLoadedForUid(user.uid); }
    }).catch(error => Alert.alert('সদস্য দেখা যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'));
    return () => { active = false; };
  }, [cloudId, kind, user, visible]);

  const ensureCloudResource = async () => {
    if (!user || !configured) throw new Error('Firebase অ্যাকাউন্ট সংযোগ করা নেই।');
    if (!scope) throw new Error('নির্বাচিত storage scope পাওয়া যায়নি; cloud link লেখা হয়নি।');
    if (cloudId) return cloudId;
    if (kind === 'list' && !list?.title.trim() && !list?.items.length) throw new Error('খালি তালিকা শেয়ার করা যাবে না। আগে শিরোনাম বা অন্তত একটি পণ্য যোগ করুন।');
    const stableId = `local-${encodeURIComponent(user.uid)}-${encodeURIComponent(storageScopeId(scope))}-${kind}-${encodeURIComponent(localId)}`;
    const id = kind === 'list'
      ? await createOwnedList(user, list || { title: '', items: [] }, stableId)
      : await createOwnedNote(user, note || { id: localId, title: '', body: '' }, stableId);
    await setScopedCloudLink(scope, kind === 'list' ? 'lists' : 'notes', localId, id, kind === 'list' ? list : note);
    setCloudId(id);
    onLinked?.(id);
    return id;
  };

  const share = async () => {
    if (!user?.emailVerified) { Alert.alert('ইমেইল যাচাই করুন', 'শেয়ার করার আগে আপনার account-এর ইমেইল যাচাই করুন।'); return; }
    const selected = availableContacts.filter(item => selectedContacts.includes(item.connectionId));
    if (!selected.length) { Alert.alert('পরিচিতি বেছে নিন', 'এক বা একাধিক অনুমোদিত পরিচিতি নির্বাচন করুন।'); return; }
    setBusy(true);
    try {
      const id = await ensureCloudResource();
      const result = await shareToContactsSequentially(selected, (contact: ConnectedContact) => shareResourceToContact(user, contact.connectionId, contact.profile.uid, kind, id, permission as never, kind === 'list' ? list?.title || '' : note?.title || ''));
      try { setMembers(await getMembers(kind, id, user.uid)); }
      catch { /* Share transaction is committed; the member view can refresh when reopened. */ }
      setSelectedContacts(result.failed.map(item => item.connectionId));
      if (result.failed.length && result.succeeded.length) Alert.alert('আংশিক শেয়ার হয়েছে', `${result.succeeded.length} জনের সঙ্গে শেয়ার হয়েছে। বাকিদের জন্য আবার চেষ্টা করুন।\n\n${result.failed.map(item => `${item.name}: ${item.error}`).join('\n')}`);
      else if (result.failed.length) Alert.alert('শেয়ার করা যায়নি', result.failed.map(item => `${item.name}: ${item.error}`).join('\n'));
      else Alert.alert('শেয়ার সম্পন্ন', `${result.succeeded.length} জনের সঙ্গে ${kind === 'list' ? 'তালিকা' : 'নোট'} শেয়ার হয়েছে।`);
    } catch (error) { Alert.alert('শেয়ার করা যায়নি', error instanceof Error ? error.message : 'ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  };

  const changeMember = (member: Member) => {
    if (!user || member.uid === user.uid) return;
    const next = kind === 'list' ? member.permission === 'editor' ? 'shopper' : 'editor' : member.permission === 'editor' ? 'viewer' : 'editor';
    Alert.alert('অনুমতি পরিবর্তন করবেন?', `${member.email || member.uid.slice(0, 10)}: ${next === 'editor' ? 'Editor' : next === 'shopper' ? 'Shopper' : 'Viewer'}`, [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'পরিবর্তন', onPress: async () => { try { if (!user) throw new Error('সাইন ইন করুন।'); await updateMemberPermission(kind, cloudId, user.uid, member.uid, next as never); setMembers(await getMembers(kind, cloudId, user.uid)); } catch (error) { Alert.alert('পরিবর্তন হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); } } },
    ]);
  };

  const kickMember = (member: Member) => {
    if (!user || member.uid === user.uid) return;
    Alert.alert('সদস্য সরাবেন?', 'সরালে তিনি পরবর্তী সময় থেকে এই resource পড়তে বা বদলাতে পারবেন না।', [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'সরিয়ে দিন', style: 'destructive', onPress: async () => { try { if (!user) throw new Error('সাইন ইন করুন।'); await removeMember(kind, cloudId, user.uid, member.uid); setMembers(await getMembers(kind, cloudId, user.uid)); } catch (error) { Alert.alert('সদস্য সরানো যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); } } },
    ]);
  };

  const deleteShared = () => {
    if (!user || !cloudId || !isOwner) return;
    Alert.alert('তালিকা/নোট স্থায়ীভাবে মুছবেন?', 'Cloud-এর রিসোর্স, তার পণ্য/সদস্য এবং এই ফোনে থাকা এর লোকাল কপিও মুছে যাবে। এই কাজটি ফিরিয়ে নেওয়া যাবে না।', [
      { text: 'বাতিল', style: 'cancel' },
      { text: 'স্থায়ীভাবে মুছুন', style: 'destructive', onPress: async () => {
        setBusy(true);
        let remoteDeleted = false;
        try {
          await deleteOwnedResource(kind, cloudId, user.uid);
          remoteDeleted = true;
          if (!scope) throw new Error('Storage scope পাওয়া যায়নি। Cloud মুছে গেছে, কিন্তু লোকাল কপি অক্ষত রাখা হয়েছে; পরে scope যাচাই করে সরান।');
          await deleteScopedCloudResource(scope, kind === 'list' ? 'lists' : 'notes', localId, cloudId);
          close(); onDeleted?.();
        } catch (error) { Alert.alert(remoteDeleted ? 'Cloud মুছে গেছে; লোকাল কপি রয়ে গেছে' : 'Cloud ডাটা মোছা যায়নি', error instanceof Error ? error.message : 'ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।'); }
        finally { setBusy(false); }
      } },
    ]);
  };

  const dialog = <Pressable style={s.scrim} onPress={close}><Pressable style={s.sheet} onPress={event => event.stopPropagation()}><ScrollView style={s.sheetScroll} contentContainerStyle={s.sheetScrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={s.grabber} /><View style={s.heading}><Text style={s.title}>শেয়ার ও অনুমতি</Text><Pressable onPress={close} accessibilityRole="button" accessibilityLabel="বন্ধ করুন"><ThemedIcon role="secondary" style={s.close}>×</ThemedIcon></Pressable></View>
      <Text style={s.description}>{kind === 'list' ? 'সদস্যরা দাম ও কেনাকাটার অবস্থা বদলাতে পারবেন। Edit দিলে পণ্য যোগ, নাম/পরিমাণ বদল ও মুছতেও পারবেন।' : 'Viewer শুধু পড়বেন। Editor নোটের লেখা বদলাতে পারবেন।'}</Text>
      {!configured && <Text style={s.warning}>Firebase Web App config যোগ না হওয়া পর্যন্ত cloud sharing চালু হবে না।</Text>}
      {configured && <>
        {(!cloudId || isOwner) && <><Text style={s.label}>অনুমোদিত পরিচিতি</Text>
      {availableContacts.length ? availableContacts.map(contact => { const selected = selectedContacts.includes(contact.connectionId); return <Pressable key={contact.connectionId} onPress={() => setSelectedContacts(current => selected ? current.filter(id => id !== contact.connectionId) : [...current, contact.connectionId])} style={[s.contactChoice, selected && s.permissionSelected]} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}><View style={s.contactAvatar}><ThemedIcon role="primary" style={s.contactAvatarText}>{contact.profile.displayName.slice(0, 1) || '•'}</ThemedIcon></View><View style={{ flex: 1 }}><Text style={s.memberEmail}>{contact.profile.displayName}</Text><Text style={s.memberPermission}>@{contact.profile.username}</Text></View><ThemedIcon role={selected ? 'success' : 'secondary'} style={s.check}>{selected ? '✓' : '○'}</ThemedIcon></Pressable>; }) : <View style={s.noContacts}><Text style={s.memberPermission}>এখনো কোনো অনুমোদিত পরিচিতি নেই।</Text><Pressable onPress={() => { close(); router.push({ pathname: '/shared', params: { add: '1' } }); }}><Text style={s.memberAction}>নতুন পরিচিতি যুক্ত করুন ›</Text></Pressable></View>}
        <View style={s.permissions}>{(kind === 'list' ? [['shopper', 'সাধারণ বাজার'], ['editor', 'Edit অনুমতি']] : [['viewer', 'শুধু দেখুন'], ['editor', 'সম্পাদনা']]).map(([value, label]) => <Pressable key={value} onPress={() => setPermission(value)} style={[s.permission, permission === value && s.permissionSelected]}><Text style={[s.permissionText, permission === value && s.permissionSelectedText]}>{label}</Text></Pressable>)}</View>
        <Pressable disabled={busy || !user?.emailVerified || !selectedContacts.length} style={[s.primary, (busy || !user?.emailVerified || !selectedContacts.length) && s.disabled]} onPress={share}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{user?.emailVerified ? `${selectedContacts.length} জনের সঙ্গে শেয়ার করুন` : 'ইমেইল যাচাই করে শেয়ার করুন'}</Text>}</Pressable></>}
        {!!visibleMembers.length && <><Text style={s.label}>সদস্য ও অনুমতি</Text>{visibleMembers.map(member => <View key={member.uid} style={s.member}><View style={{ flex: 1 }}><Text numberOfLines={1} style={s.memberEmail}>{member.email || (member.uid === user?.uid ? 'আপনি · Owner' : `সদস্য ${member.uid.slice(0, 8)}`)}</Text><Text style={s.memberPermission}>{member.permission}</Text></View>{isOwner && member.uid !== user?.uid && <><Pressable onPress={() => changeMember(member)}><Text style={s.memberAction}>অনুমতি</Text></Pressable><Pressable onPress={() => kickMember(member)}><Text style={s.remove}>সরান</Text></Pressable></>}</View>)}</>}
        {isOwner && <Pressable onPress={deleteShared} style={s.delete}><Text style={s.deleteText}>এই নোট/তালিকা স্থায়ীভাবে মুছুন</Text></Pressable>}
      </>}
      <Pressable style={s.cancel} onPress={close}><Text style={s.cancelText}>বন্ধ করুন</Text></Pressable>
    </ScrollView></Pressable></Pressable>;
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
    {keyboardAvoiding ? <KeyboardAvoidingView style={s.modalKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>{dialog}</KeyboardAvoidingView> : dialog}
  </Modal>;
}

const s = StyleSheet.create({ modalKeyboard: { flex: 1 }, sheetScroll: { flexShrink: 1 }, sheetScrollContent: { flexGrow: 1 }, scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.56)' }, sheet: { maxHeight: '90%', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 25, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#fbfbf8' }, grabber: { width: 38, height: 4, borderRadius: 3, backgroundColor: '#c7cac4', alignSelf: 'center', marginBottom: 14 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { color: '#20231f', fontSize: 20, fontWeight: '700' }, close: { color: '#697168', fontSize: 28 }, description: { color: '#6e756c', fontSize: 12, lineHeight: 19, marginTop: 4, marginBottom: 12 }, warning: { color: '#765618', backgroundColor: '#fff4d5', padding: 12, borderRadius: 12, fontSize: 12 }, label: { color: '#49534a', fontSize: 12, fontWeight: '700', marginTop: 13, marginBottom: 7 }, permissions: { flexDirection: 'row', gap: 9, marginTop: 10 }, permission: { flex: 1, minHeight: 41, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#dde3da', borderRadius: 12 }, permissionSelected: { borderColor: '#358457', backgroundColor: '#eaf4ec' }, permissionText: { color: '#656d64', fontSize: 12 }, permissionSelectedText: { color: '#2c7048', fontWeight: '700' }, primary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 12, borderRadius: 12, backgroundColor: '#2b8655' }, disabled: { opacity: .5 }, primaryText: { color: '#fff', fontWeight: '700', fontSize: 14 }, secondary: { alignSelf: 'flex-start', paddingVertical: 9 }, secondaryText: { color: '#2f744c', fontSize: 12, fontWeight: '700' }, contactChoice: { minHeight: 57, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 9, marginTop: 6, borderWidth: 1, borderColor: '#dde3da', borderRadius: 12, backgroundColor: '#fff' }, contactAvatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: '#e7f0ed' }, contactAvatarText: { color: '#087b69', fontSize: 15, fontWeight: '700' }, check: { color: '#087b69', fontSize: 18 }, noContacts: { padding: 10, borderRadius: 12, backgroundColor: '#f0f5f3' }, member: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 1, borderColor: '#e7eae3' }, memberEmail: { color: '#29312a', fontSize: 12, fontWeight: '600' }, memberPermission: { color: '#838a81', fontSize: 10, marginTop: 2 }, memberAction: { color: '#327b50', fontSize: 11, fontWeight: '700' }, remove: { color: '#b33535', fontSize: 11, fontWeight: '700' }, delete: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 8 }, deleteText: { color: '#b33535', fontSize: 12, fontWeight: '700' }, cancel: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, cancelText: { color: '#687068', fontSize: 13 } });
