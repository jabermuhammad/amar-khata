import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { ThemedSafeAreaView as SafeAreaView, ThemedScrollView as ScrollView, ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, ThemedIcon } from '../components/ThemePrimitives';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import { claimUsername, createConnectionInvite, findContactByUsername, getOwnContactProfile, type PublicContactProfile } from '../lib/collaboration';
import { goBackOrReplace } from '../lib/navigation.mjs';

export default function AddContactScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [profile, setProfile] = useState<PublicContactProfile | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<PublicContactProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [profileOwnerUid, setProfileOwnerUid] = useState('');
  const visibleProfile = profileOwnerUid === user?.uid ? profile : null;
  useEffect(() => { if (!user) return; let active = true; getOwnContactProfile(user).then(value => { if (active) { setProfile(value); setProfileOwnerUid(user.uid); } }).catch(error => Alert.alert('প্রোফাইল পড়া যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।')); return () => { active = false; }; }, [user]);

  const saveProfile = async () => {
    if (!user) return;
    setBusy(true);
    try { const saved = await claimUsername(user, username, displayName); setProfile(saved); Alert.alert('Username সংরক্ষিত', `আপনার পরিচিতি এখন @${saved.username} নামে খুঁজে পাওয়া যাবে।`); }
    catch (error) { Alert.alert('Username সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  };

  const searchUser = async () => {
    if (!user) { router.replace('/auth'); return; }
    setBusy(true); setResult(null);
    try {
      const match = await findContactByUsername(user, search);
      if (!match) { Alert.alert('পরিচিতি পাওয়া যায়নি', 'username যাচাই করুন। Email দিয়ে অনুরোধ পাঠাতে চাইলে নিচের বিকল্প ব্যবহার করুন।'); return; }
      setResult(match);
    } catch (error) { Alert.alert('খোঁজা যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  };

  const inviteByUsername = async () => {
    if (!user || !result) return;
    setBusy(true);
    try { await createConnectionInvite(user, { uid: result.uid }); Alert.alert('অনুরোধ পাঠানো হয়েছে', 'অপর ব্যক্তি গ্রহণ করলে পরিচিতি যুক্ত হবে। কোনো তালিকা বা নোট এখনই শেয়ার হয়নি।', [{ text: 'ঠিক আছে', onPress: () => router.replace('/shared') }]); }
    catch (error) { Alert.alert('অনুরোধ পাঠানো যায়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  };

  const inviteByEmail = async () => {
    if (!user) { router.replace('/auth'); return; }
    setBusy(true);
    try { await createConnectionInvite(user, { email: search }); Alert.alert('অনুরোধ পাঠানো হয়েছে', 'এই ইমেইলে নিবন্ধিত account থেকে অনুরোধ গ্রহণ করা যাবে। গোপনীয়তার জন্য account আছে কি না জানানো হয় না।', [{ text: 'ঠিক আছে', onPress: () => router.replace('/shared') }]); }
    catch (error) { Alert.alert('অনুরোধ পাঠানো যায়নি', error instanceof Error ? error.message : 'ইমেইল পরীক্ষা করে আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  };

  if (!user) return <SafeAreaView style={s.page} edges={['top', 'left', 'right']}><Text style={s.heading}>নতুন পরিচিতি</Text><Text style={s.copy}>পরিচিতি যোগ করতে verified account-এ সাইন ইন করুন।</Text><Pressable style={s.primary} onPress={() => router.replace('/auth')}><Text style={s.primaryText}>সাইন ইন</Text></Pressable></SafeAreaView>;
  const ownProfile = visibleProfile;
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right', 'bottom']}>
    <View style={s.header}><Pressable onPress={() => goBackOrReplace(router, '/shared')} hitSlop={10} style={s.backButton}><ThemedIcon role="primary" style={s.back}>‹</ThemedIcon></Pressable><View style={s.flex}><Text style={s.headerTitle}>নতুন পরিচিতি</Text><Text style={s.muted}>নিরাপদ sharing connection</Text></View></View>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {!user.emailVerified && <View style={s.warning}><Text style={s.warningTitle}>ইমেইল যাচাই দরকার</Text><Text style={s.copy}>পরিচিতি যোগ করতে Firebase account-এর verified email লাগবে।</Text></View>}
      {!ownProfile && <View style={s.card}><Text style={s.sectionTitle}>প্রথমে নিজের পরিচিতি তৈরি করুন</Text><Text style={s.copy}>Username case-insensitive ও unique হবে। আপনার ইমেইল অন্যদের দেখানো হবে না। Username পরে বদলানো যাবে না।</Text><Text style={s.label}>আপনার নাম</Text><TextInput value={displayName} onChangeText={setDisplayName} placeholder="নাম" style={s.input} /><Text style={s.label}>Username</Text><TextInput value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="যেমন: amar_khata" style={s.input} /><Pressable disabled={busy || !user.emailVerified} onPress={saveProfile} style={[s.primary, (busy || !user.emailVerified) && s.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>Username সংরক্ষণ করুন</Text>}</Pressable></View>}
      <View style={s.hero}><ThemedIcon role="primary" style={s.heroIcon}>◎</ThemedIcon><Text style={s.heading}>কাকে যুক্ত করতে চান?</Text><Text style={s.copy}>Username দিয়ে নির্দিষ্ট account খুঁজুন, অথবা email-এ private connection request পাঠান। অনুরোধ গ্রহণ না করা পর্যন্ত কোনো access তৈরি হবে না।</Text></View>
      <View style={s.card}><Text style={s.sectionTitle}>Username দিয়ে খুঁজুন</Text><View style={s.searchRow}><TextInput value={search} onChangeText={value => { setSearch(value); setResult(null); }} autoCapitalize="none" autoCorrect={false} placeholder="@username" style={[s.input, s.searchInput]} /><Pressable disabled={busy || !user.emailVerified} onPress={searchUser} style={s.searchButton}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>খুঁজুন</Text>}</Pressable></View>
        {result && <View style={s.result}><Avatar name={result.displayName} /><View style={s.flex}><Text style={s.name}>{result.displayName}</Text><Text style={s.handle}>@{result.username}</Text></View><Pressable disabled={busy} onPress={inviteByUsername} style={s.smallPrimary}><Text style={s.smallPrimaryText}>অনুরোধ</Text></Pressable></View>}
      </View>
      <View style={s.card}><Text style={s.sectionTitle}>Email-এ connection request</Text><Text style={s.copy}>ইমেইলটি শুধু প্রাপকের matching account-এর কাছে থাকবে; account আছে কি না আমরা প্রকাশ করি না।</Text><Pressable disabled={busy || !user.emailVerified} onPress={inviteByEmail} style={[s.secondary, (busy || !user.emailVerified) && s.disabled]}><Text style={s.secondaryText}>উপরের লেখা Email হলে অনুরোধ পাঠান</Text></Pressable></View>
      <View style={s.privacy}><ThemedIcon role="informational" style={s.privacyIcon}>⌑</ThemedIcon><Text style={s.copy}>Connection মানেই কোনো তালিকা বা নোট দেখা নয়। প্রতিটি resource আলাদাভাবে আপনার অনুমতিতে শেয়ার হবে।</Text></View>
    </ScrollView>
  </SafeAreaView>;
}

function Avatar({ name }: { name: string }) { return <View style={s.avatar}><ThemedIcon role="primary" style={s.avatarText}>{name.slice(0, 1) || '•'}</ThemedIcon></View>; }
const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#f8faf9' }, header: { minHeight: 64, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: '#e1e9e6', backgroundColor: '#fff' }, backButton: { width: 42, height: 48, justifyContent: 'center' }, back: { color: '#087b69', fontSize: 35, lineHeight: 42 }, headerTitle: { color: '#17211f', fontSize: 16, fontWeight: '700' }, muted: { color: '#677471', fontSize: 10, marginTop: 2 }, flex: { flex: 1, minWidth: 0 }, content: { padding: 15, paddingBottom: 40 }, hero: { alignItems: 'center', paddingVertical: 21 }, heroIcon: { color: '#087b69', fontSize: 38 }, heading: { color: '#17211f', fontSize: 17, fontWeight: '700', textAlign: 'center', marginTop: 6 }, copy: { color: '#677471', fontSize: 11, lineHeight: 17, marginTop: 5 }, card: { padding: 14, marginBottom: 11, borderWidth: 1, borderColor: '#e1e9e6', borderRadius: 16, backgroundColor: '#fff' }, sectionTitle: { color: '#17211f', fontSize: 13, fontWeight: '700' }, label: { color: '#677471', fontSize: 10, marginTop: 11, marginBottom: 4 }, input: { minHeight: 44, paddingHorizontal: 11, borderWidth: 1, borderColor: '#e1e9e6', borderRadius: 11, backgroundColor: '#f8faf9', color: '#17211f', fontSize: 12 }, primary: { minHeight: 43, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, marginTop: 11, borderRadius: 12, backgroundColor: '#087b69' }, primaryText: { color: '#fff', fontSize: 11, fontWeight: '700' }, secondary: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 10, borderRadius: 12, backgroundColor: '#e7f0ed' }, secondaryText: { color: '#087b69', fontSize: 11, fontWeight: '700' }, disabled: { opacity: .55 }, searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 }, searchInput: { flex: 1 }, searchButton: { minWidth: 64, height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 11, backgroundColor: '#087b69' }, result: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderColor: '#e1e9e6' }, avatar: { width: 42, height: 42, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#d9f1eb' }, avatarText: { color: '#087b69', fontSize: 18, fontWeight: '700' }, name: { color: '#17211f', fontSize: 12, fontWeight: '700' }, handle: { color: '#087b69', fontSize: 10, marginTop: 2 }, smallPrimary: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#087b69' }, smallPrimaryText: { color: '#fff', fontSize: 10, fontWeight: '700' }, privacy: { flexDirection: 'row', gap: 9, padding: 12, borderRadius: 13, backgroundColor: '#e7f0ed' }, privacyIcon: { color: '#087b69', fontSize: 19 }, warning: { padding: 12, marginBottom: 11, borderRadius: 12, backgroundColor: '#fff0ee' }, warningTitle: { color: '#96363d', fontSize: 12, fontWeight: '700' } });
