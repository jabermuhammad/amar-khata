import * as Linking from 'expo-linking';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Share, StyleSheet } from 'react-native';
import { ThemedScrollView as ScrollView, ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, ThemedIcon } from './ThemePrimitives';
import { GlossyPressable as Pressable } from './GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import { claimUsername, createConnectionInvite, findContactByUsername, getOwnContactProfile, type PublicContactProfile } from '../lib/collaboration';
import { normalizeContactEmail } from '../lib/contactPolicy.mjs';
import { useTheme } from '../contexts/ThemeContext';

type Props = { visible: boolean; onClose: () => void; onCreated: () => void };

export default function ContactInviteDialog({ visible, onClose, onCreated }: Props) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const c = dark
    ? { surface: '#141c25', raised: '#19222d', text: '#eef2f4', muted: '#98a4ad', border: '#26323e', accent: '#35bd83', wash: '#203b35' }
    : { surface: '#fff', raised: '#f1f4ef', text: '#20231f', muted: '#747d74', border: '#e5e9e1', accent: '#187a52', wash: '#e5f2eb' };
  const [query, setQuery] = useState('');
  const [candidate, setCandidate] = useState<PublicContactProfile | null>(null);
  const [ownProfile, setOwnProfile] = useState<PublicContactProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState<{ uid: string; displayName: string; username: string }>({ uid: user?.uid || '', displayName: user?.displayName || '', username: '' });
  const [inviteId, setInviteId] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [busy, setBusy] = useState(false);
  const visibleOwnProfile = ownProfile?.uid === user?.uid ? ownProfile : null;
  const displayName = profileDraft.uid === user?.uid ? profileDraft.displayName : user?.displayName || '';
  const username = profileDraft.uid === user?.uid ? profileDraft.username : '';

  useEffect(() => {
    if (!visible || !user?.emailVerified) return;
    let active = true;
    void getOwnContactProfile(user).then(value => { if (active) setOwnProfile(value); }).catch(() => {});
    return () => { active = false; };
  }, [visible, user]);

  const close = () => { if (busy) return; setQuery(''); setCandidate(null); setInviteId(''); setShareLink(''); setOwnProfile(null); onClose(); };
  const saveUsername = async () => {
    if (!user) return;
    setBusy(true);
    try { setOwnProfile(await claimUsername(user, username, displayName)); onCreated(); Alert.alert('Username সংরক্ষিত', 'এখন অন্যরা username দিয়ে আপনাকে খুঁজে পাবে।'); }
    catch (error) { Alert.alert('Username সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  };
  const create = async (target: { uid: string } | { email: string }) => {
    if (!user?.emailVerified) throw new Error('অনুরোধ পাঠাতে verified account প্রয়োজন।');
    const id = await createConnectionInvite(user, target);
    const link = 'uid' in target ? Linking.createURL('invite', { queryParams: { connectionInviteId: id } }) : '';
    setInviteId(id); setShareLink(link); setCandidate(null); onCreated();
    return link;
  };
  const lookupOrInvite = async () => {
    if (!user) { Alert.alert('সাইন ইন দরকার', 'পরিচিতির অনুরোধ পাঠাতে account-এ সাইন ইন করুন।'); return; }
    const input = query.trim();
    if (!input) { Alert.alert('Username বা Email দিন', 'পরিচিতির username অথবা ইমেইল লিখুন।'); return; }
    setBusy(true); setCandidate(null);
    try {
      if (input.includes('@')) {
        const email = normalizeContactEmail(input);
        await create({ email });
        Alert.alert('অনুরোধ তৈরি হয়েছে', 'কোনো account আছে কি না প্রকাশ না করে request সংরক্ষণ হয়েছে। App স্বয়ংক্রিয় email বা notification পাঠায় না; একই verified email-এর account থেকে পরিচিতি পেজে request গ্রহণ করা যাবে।');
      } else {
        const match = await findContactByUsername(user, input);
        if (!match) { Alert.alert('পরিচিতি পাওয়া যায়নি', 'Username যাচাই করুন; email-এ অনুরোধ পাঠাতে সম্পূর্ণ email লিখুন।'); return; }
        if (match.uid === user.uid) { Alert.alert('নিজেকে যুক্ত করা যাবে না', 'অন্য ব্যক্তির username লিখুন।'); return; }
        setCandidate(match);
      }
    } catch (error) { Alert.alert('অনুরোধ তৈরি হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  };
  const sendRequest = async () => {
    if (!user || !candidate) return;
    setBusy(true);
    try {
      await create({ uid: candidate.uid });
      Alert.alert('অনুরোধ তৈরি হয়েছে', `${candidate.displayName}-এর জন্য request সংরক্ষণ হয়েছে। পরিচিতি link পাঠাতে নিচের বোতামটি চাপুন।`);
    } catch (error) { Alert.alert('অনুরোধ পাঠানো যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  };
  const share = async () => {
    if (!shareLink) return;
    try {
      await Share.share({ title: 'Amar Khata পরিচিতির অনুরোধ', message: `Amar Khata-তে আমার পরিচিতির অনুরোধ গ্রহণ করুন:\n${shareLink}` });
    } catch (error) { Alert.alert('লিংক শেয়ার করা যায়নি', error instanceof Error ? error.message : 'লিংকটি নির্বাচন করে কপি করুন।'); }
  };

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView style={s.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={s.scrim}><Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="বন্ধ করুন" />
      <ScrollView style={[s.sheet, { backgroundColor: c.surface, borderColor: c.border }]} contentContainerStyle={s.sheetContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={s.header}><View style={s.headerCopy}><Text style={[s.title, { color: c.text }]}>পরিচিতি যুক্ত করুন</Text><Text style={[s.copy, { color: c.muted }]}>Username খুঁজুন অথবা email-এ private request তৈরি করুন।</Text></View><Pressable onPress={close} accessibilityRole="button" accessibilityLabel="বন্ধ করুন"><ThemedIcon role="secondary" style={s.close}>×</ThemedIcon></Pressable></View>
        {!user?.emailVerified && <Text style={[s.warning, { backgroundColor: c.wash, color: c.text }]}>Request পাঠাতে verified account দরকার।</Text>}
        {user?.emailVerified && !visibleOwnProfile && <View style={[s.profileCard, { backgroundColor: c.raised }]}><Text style={[s.candidateName, { color: c.text }]}>নিজের username সেট করুন</Text><Text style={[s.copy, { color: c.muted }]}>নাম ও একটি unique username দিলে পরিচিতিরা আপনাকে খুঁজে পাবে।</Text><TextInput value={displayName} onChangeText={value => setProfileDraft(current => ({ uid: user.uid, displayName: value, username: current.uid === user.uid ? current.username : '' }))} placeholder="আপনার নাম" style={[s.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface, marginTop: 8 }]} /><TextInput value={username} onChangeText={value => setProfileDraft(current => ({ uid: user.uid, displayName: current.uid === user.uid ? current.displayName : user.displayName || '', username: value }))} autoCapitalize="none" autoCorrect={false} placeholder="যেমন: amar_khata" style={[s.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface, marginTop: 7 }]} /><Pressable disabled={busy} onPress={saveUsername} style={[s.shareButton, { backgroundColor: c.accent }, busy && s.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>Username সংরক্ষণ</Text>}</Pressable></View>}
        <View style={s.searchRow}><TextInput value={query} onChangeText={value => { setQuery(value); setCandidate(null); }} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="@username অথবা email" style={[s.input, { color: c.text, borderColor: c.border, backgroundColor: c.raised }]} /><Pressable disabled={busy || !user?.emailVerified} onPress={lookupOrInvite} style={[s.searchButton, { backgroundColor: c.accent }, (busy || !user?.emailVerified) && s.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{query.includes('@') ? 'Request' : 'খুঁজুন'}</Text>}</Pressable></View>
        {candidate && <View style={[s.candidate, { borderColor: c.border }]}><View style={[s.avatar, { backgroundColor: c.wash }]}><ThemedIcon role="primary" style={{ fontSize: 18 }}>{candidate.displayName.slice(0, 1) || '•'}</ThemedIcon></View><View style={{ flex: 1 }}><Text style={[s.candidateName, { color: c.text }]}>{candidate.displayName}</Text><Text style={[s.copy, { color: c.muted }]}>@{candidate.username}</Text></View><Pressable disabled={busy} onPress={sendRequest} style={[s.smallButton, { backgroundColor: c.accent }]}><Text style={s.primaryText}>অনুরোধ</Text></Pressable></View>}
        {!!inviteId && <View style={[s.linkCard, { backgroundColor: c.raised }]}><Text style={[s.copy, { color: c.text }]}>অনুরোধ সংরক্ষিত। Acceptance-এর আগে কোনো তালিকা বা নোটের access দেওয়া হয় না.</Text>{!!shareLink ? <><Text selectable style={[s.link, { color: c.accent }]}>{shareLink}</Text><Pressable onPress={share} style={[s.shareButton, { backgroundColor: c.accent }]}><Text style={s.primaryText}>লিংক শেয়ার করুন</Text></Pressable><Text style={[s.note, { color: c.muted }]}>এই app link খোলার জন্য Amar Khata ইনস্টল থাকা দরকার।</Text></> : <Text style={[s.note, { color: c.muted }]}>Email-এ automatic notification পাঠানো হয়নি। প্রাপক নিবন্ধিত হলে একই verified email দিয়ে সাইন ইন করে পরিচিতি অনুরোধ গ্রহণ করতে পারবেন।</Text>}</View>}
      </ScrollView>
    </View></KeyboardAvoidingView>
  </Modal>;
}

const s = StyleSheet.create({
  keyboard: { flex: 1 }, scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' }, sheet: { maxHeight: '82%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1 }, sheetContent: { padding: 18, paddingBottom: 26 }, header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, headerCopy: { flex: 1 }, title: { fontSize: 17, fontWeight: '700' }, copy: { fontSize: 11, lineHeight: 17, marginTop: 4 }, close: { fontSize: 26 }, warning: { marginTop: 12, padding: 10, borderRadius: 10, fontSize: 11 }, searchRow: { flexDirection: 'row', gap: 8, marginTop: 15 }, input: { flex: 1, minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 12 }, searchButton: { minWidth: 78, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, borderRadius: 12 }, disabled: { opacity: 0.5 }, primaryText: { color: '#fff', fontSize: 11, fontWeight: '700' }, profileCard: { padding: 11, marginTop: 12, borderRadius: 12 }, candidate: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 13, paddingTop: 13 }, avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, candidateName: { fontSize: 12, fontWeight: '700' }, smallButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 10 }, linkCard: { padding: 12, marginTop: 14, borderRadius: 12 }, link: { fontSize: 11, marginTop: 9 }, shareButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 10, marginTop: 10 }, note: { fontSize: 9, marginTop: 8 },
});
