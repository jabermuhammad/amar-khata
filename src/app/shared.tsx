import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { ThemedScrollView as ScrollView, ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, ThemedSafeAreaView as SafeAreaView, ThemedIcon } from '../components/ThemePrimitives';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import { acceptConnectionInvite, cancelConnectionInvite, declineConnectionInvite, getOwnContactProfile, listConnectedContacts, listConnectionInvites, listSentConnectionInvites, loadResourceSummaries, type ConnectedContact, type ConnectionInvite, type PublicContactProfile } from '../lib/collaboration';
import { goBackOrReplace } from '../lib/navigation.mjs';
import { formatResourceSummaryIssues } from '../lib/ownedResourceService.mjs';
import { useTheme } from '../contexts/ThemeContext';
import { filterConnectedContacts } from '../lib/contactPolicy.mjs';
import ContactInviteDialog from '../components/ContactInviteDialog';

type Summary = Awaited<ReturnType<typeof loadResourceSummaries>>['summaries'][number];

export default function SharedScreen() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ add?: string }>();
  const [contacts, setContacts] = useState<ConnectedContact[]>([]);
  const [invites, setInvites] = useState<ConnectionInvite[]>([]);
  const [sentInvites, setSentInvites] = useState<ConnectionInvite[]>([]);
  const [legacy, setLegacy] = useState<Summary[]>([]);
  const [profile, setProfile] = useState<PublicContactProfile | null>(null);
  const [dataUid, setDataUid] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadIssue, setLoadIssue] = useState('');
  const [filter, setFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const showAddDialog = addOpen || params.add === '1';

  useFocusEffect(useCallback(() => {
    let active = true;
    if (!user) { setLoading(false); setDataUid(''); setContacts([]); setInvites([]); setSentInvites([]); setLegacy([]); setProfile(null); return () => { active = false; }; }
    setLoading(true); setLoadIssue('');
    setDataUid(''); setContacts([]); setInvites([]); setSentInvites([]); setLegacy([]); setProfile(null);
    void Promise.allSettled([listConnectedContacts(user), listConnectionInvites(user), listSentConnectionInvites(user), getOwnContactProfile(user), loadResourceSummaries(user.uid)]).then(results => {
      if (!active) return;
      const [contactResult, inviteResult, sentInviteResult, profileResult, summaryResult] = results;
      if (contactResult.status === 'fulfilled') setContacts(contactResult.value.sort((a, b) => a.profile.displayName.localeCompare(b.profile.displayName)));
      else setLoadIssue(contactResult.reason instanceof Error ? contactResult.reason.message : 'পরিচিতি লোড করা যায়নি।');
      if (inviteResult.status === 'fulfilled') setInvites(inviteResult.value);
      else setLoadIssue(current => current || (inviteResult.reason instanceof Error ? inviteResult.reason.message : 'অনুরোধ লোড করা যায়নি।'));
      if (sentInviteResult.status === 'fulfilled') setSentInvites(sentInviteResult.value);
      else setLoadIssue(current => current || (sentInviteResult.reason instanceof Error ? sentInviteResult.reason.message : 'পাঠানো অনুরোধ লোড করা যায়নি।'));
      if (profileResult.status === 'fulfilled') setProfile(profileResult.value);
      else setLoadIssue(current => current || (profileResult.reason instanceof Error ? profileResult.reason.message : 'প্রোফাইল লোড করা যায়নি।'));
      if (summaryResult.status === 'fulfilled') {
        setLegacy(summaryResult.value.summaries);
        const formatted = formatResourceSummaryIssues(summaryResult.value.issues);
        if (formatted) setLoadIssue(current => current || formatted);
      } else setLoadIssue(current => current || `আগের shared resource পড়া যায়নি: ${summaryResult.reason instanceof Error ? summaryResult.reason.message : 'আবার চেষ্টা করুন।'}`);
      setDataUid(user.uid);
      setLoading(false);
    });
    return () => { active = false; };
  // The retry token intentionally restarts the focused loader after contact actions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, reloadToken]));

  const resolveInvite = async (invite: ConnectionInvite, accept: boolean) => {
    if (!user) return;
    try {
      if (accept) await acceptConnectionInvite(invite.id, user);
      else await declineConnectionInvite(invite.id, user);
      setInvites(current => current.filter(item => item.id !== invite.id));
      if (accept) Alert.alert('পরিচিতি যুক্ত হয়েছে', 'এখন থেকে তালিকা বা নোট আলাদাভাবে শেয়ার করতে পারবেন।');
    } catch (error) { Alert.alert('অনুরোধ সম্পন্ন হয়নি', error instanceof Error ? error.message : 'ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।'); }
  };
  const cancelSentInvite = (invite: ConnectionInvite) => {
    if (!user || invite.status !== 'pending') return;
    Alert.alert('অনুরোধ বাতিল করবেন?', 'প্রাপক এটি গ্রহণ করতে পারবেন না। পরে নতুন করে অনুরোধ পাঠানো যাবে।', [
      { text: 'ফিরে যান', style: 'cancel' },
      { text: 'বাতিল করুন', style: 'destructive', onPress: async () => {
        try { await cancelConnectionInvite(invite.id, user); setSentInvites(current => current.filter(item => item.id !== invite.id)); }
        catch (error) { Alert.alert('অনুরোধ বাতিল হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'); }
      } },
    ]);
  };

  const scopedContacts = dataUid === user?.uid ? contacts : [];
  const scopedInvites = dataUid === user?.uid ? invites : [];
  const scopedSentInvites = dataUid === user?.uid ? sentInvites : [];
  const scopedLegacy = dataUid === user?.uid ? legacy : [];
  const scopedProfile = dataUid === user?.uid ? profile : null;
  const visibleContacts = filterConnectedContacts(scopedContacts, filter);
  const recentContacts = [...scopedContacts].sort((a, b) => timestampValue(b.updatedAt) - timestampValue(a.updatedAt)).slice(0, 6);
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right', 'bottom']}>
    <View style={s.header}>
      <Pressable onPress={() => goBackOrReplace(router, '/profile')} hitSlop={10} accessibilityRole="button" accessibilityLabel="প্রোফাইলে ফিরে যান" style={s.iconButton}><ThemedIcon role="primary" style={s.back}>‹</ThemedIcon></Pressable>
      <View style={s.headerTitleWrap}><Text style={s.headerTitle}>পরিচিতি</Text><Text style={s.headerSubtitle}>সংযোগ ও শেয়ারিং ইতিহাস</Text></View>
      <Pressable onPress={() => setAddOpen(true)} accessibilityRole="button" accessibilityLabel="নতুন পরিচিতি যুক্ত করুন" style={s.addButton}><ThemedIcon role="primary" style={s.add}>＋</ThemedIcon></Pressable>
    </View>
    {!user ? <View style={s.emptyCard}><Text style={s.emptyTitle}>শেয়ারিংয়ের জন্য account দরকার</Text><Text style={s.muted}>Guest-এর ব্যক্তিগত তালিকা ও নোট স্থানীয় থাকবে। পরিচিতির সঙ্গে শেয়ার করতে account-এ সাইন ইন করুন।</Text><Pressable style={s.primary} onPress={() => router.push('/auth')}><Text style={s.primaryText}>সাইন ইন করুন</Text></Pressable></View> : <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.intro}><Text style={s.introTitle}>আপনার পরিচিতি</Text><Text style={s.muted}>অনুমোদিত সংযোগ থাকলেও কোনো তালিকা বা নোট স্বয়ংক্রিয়ভাবে শেয়ার হয় না।</Text></View>
      {recentContacts.length > 0 && <View style={s.recentSection}><View style={s.sectionHeading}><Text style={s.sectionTitle}>সাম্প্রতিক পরিচিতি</Text><ThemedIcon role="secondary" style={s.recentHint}>›</ThemedIcon></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.recentRow}>{recentContacts.map(contact => <Pressable key={contact.connectionId} onPress={() => router.push({ pathname: '/contact', params: { connectionId: contact.connectionId, contactUid: contact.profile.uid } })} style={s.recentContact}><Avatar name={contact.profile.displayName} /><Text numberOfLines={1} style={s.recentName}>{contact.profile.displayName}</Text><Text numberOfLines={1} style={s.recentUsername}>@{contact.profile.username}</Text></Pressable>)}</ScrollView></View>}
      {!loading && dataUid === user.uid && !scopedProfile && <Pressable style={s.profileSetup} onPress={() => setAddOpen(true)}><Text style={s.sectionTitle}>আপনার username সেট করুন</Text><Text style={s.muted}>অন্যরা আপনাকে username দিয়ে খুঁজে পাবে। ইমেইল বা private তথ্য directory-তে দেখানো হয় না।</Text></Pressable>}
      {scopedInvites.length > 0 && <View style={s.section}><Text style={s.sectionTitle}>পরিচিতির অনুরোধ · {scopedInvites.length}</Text>{scopedInvites.map(invite => <View key={invite.id} style={s.inviteCard}><Avatar name={invite.senderUsername || 'নতুন'} /><View style={s.flex}><Text style={s.contactName}>{invite.senderUsername ? `@${invite.senderUsername}` : 'নতুন পরিচিতি'}</Text><Text style={s.muted}>আপনার সঙ্গে নিরাপদ sharing connection করতে চান</Text><View style={s.inlineActions}><Pressable onPress={() => resolveInvite(invite, true)} style={s.smallPrimary}><Text style={s.smallPrimaryText}>গ্রহণ</Text></Pressable><Pressable onPress={() => resolveInvite(invite, false)} style={s.smallSecondary}><Text style={s.smallSecondaryText}>না</Text></Pressable></View></View></View>)}</View>}
      {scopedSentInvites.some(invite => invite.status === 'pending') && <View style={s.section}><Text style={s.sectionTitle}>পাঠানো অনুরোধ</Text>{scopedSentInvites.filter(invite => invite.status === 'pending').map(invite => <View key={invite.id} style={s.sentRow}><View style={s.flex}><Text style={s.contactName}>{invite.recipientEmail || (invite.recipientUid ? `ব্যবহারকারী ${invite.recipientUid.slice(0, 8)}` : 'পরিচিতি')}</Text><Text style={s.muted}>অনুমতির অপেক্ষায় · এখনো কোনো resource শেয়ার হয়নি</Text></View><Pressable onPress={() => cancelSentInvite(invite)} hitSlop={7}><Text style={s.cancelText}>বাতিল</Text></Pressable></View>)}</View>}
      <View style={s.search}><ThemedIcon role="secondary" style={s.searchIcon}>⌕</ThemedIcon><TextInput value={filter} onChangeText={setFilter} placeholder="পরিচিতির নাম বা username" autoCapitalize="none" style={s.searchInput} /><Pressable onPress={() => setAddOpen(true)}><ThemedIcon role="primary" style={s.searchAction}>নতুন</ThemedIcon></Pressable></View>
      {loading || dataUid !== user.uid ? <ActivityIndicator style={s.loader} color={theme === 'dark' ? '#8bd5a5' : '#27804d'} /> : <>{!!loadIssue && <View style={s.warning}><Text style={s.warningTitle}>কিছু তথ্য লোড হয়নি</Text><Text style={s.warningText}>{loadIssue}</Text><Pressable onPress={() => setReloadToken(value => value + 1)}><ThemedIcon role="primary" style={s.retry}>আবার চেষ্টা করুন</ThemedIcon></Pressable></View>}{visibleContacts.length ? <View style={s.section}><Text style={s.sectionTitle}>অনুমোদিত পরিচিতি · {visibleContacts.length}</Text>{visibleContacts.map(contact => <Pressable key={contact.connectionId} onPress={() => router.push({ pathname: '/contact', params: { connectionId: contact.connectionId, contactUid: contact.profile.uid } })} style={s.contactRow}><Avatar name={contact.profile.displayName} /><View style={s.flex}><View style={s.nameLine}><Text numberOfLines={1} style={s.contactName}>{contact.profile.displayName}</Text>{contact.sharedCount > 0 && <Text style={s.count}>{contact.sharedCount}</Text>}</View><ThemedIcon role="primary" style={s.handle}>@{contact.profile.username || 'username নেই'}</ThemedIcon><Text numberOfLines={1} style={s.muted}>{contact.sharedCount ? `${contact.sharedCount}টি শেয়ার করা resource` : 'এখনো কোনো তালিকা বা নোট শেয়ার হয়নি'}</Text></View><ThemedIcon role="secondary" style={s.chevron}>›</ThemedIcon></Pressable>)}</View> : <View style={s.emptyCard}><ThemedIcon role="primary" style={{ fontSize: 38, marginBottom: 7 }}>◎</ThemedIcon><Text style={s.emptyTitle}>{filter ? 'মিলেছে এমন পরিচিতি নেই' : 'এখনো কোনো পরিচিতি নেই'}</Text><Text style={s.muted}>নতুন পরিচিতির অনুরোধ পাঠান। অপর পক্ষ গ্রহণ না করা পর্যন্ত connection তৈরি হবে না।</Text><Pressable style={s.primary} onPress={() => setAddOpen(true)}><Text style={s.primaryText}>＋  নতুন পরিচিতি যুক্ত করুন</Text></Pressable></View>}</>}
      {!!scopedLegacy.length && <View style={s.legacy}><Text style={s.sectionTitle}>আগের শেয়ার করা resource</Text><Text style={s.muted}>পুরোনো invite দিয়ে যুক্ত resource-গুলো এখানে সাময়িকভাবে দেখানো হচ্ছে।</Text>{scopedLegacy.map(resource => <Pressable key={`${resource.kind}-${resource.id}`} style={s.legacyRow} onPress={() => router.push(resource.kind === 'list' ? { pathname: '/list', params: { remoteId: resource.id } } : { pathname: '/note', params: { remoteId: resource.id } })}><Text style={s.legacyIcon}>{resource.kind === 'list' ? '▤' : '▧'}</Text><View style={s.flex}><Text numberOfLines={1} style={s.contactName}>{resource.title}</Text><Text style={s.muted}>{resource.kind === 'list' ? 'তালিকা' : 'নোট'} · {resource.permission}</Text></View><Text style={s.chevron}>›</Text></Pressable>)}</View>}
      <Pressable style={s.migration} onPress={() => router.push('/migrate')}><Text style={s.migrationTitle}>পুরোনো লোকাল নোট ও তালিকা কপি করুন ›</Text><Text style={s.muted}>আপনার নিশ্চিত অনুমতি ছাড়া Guest data Cloud-এ যাবে না।</Text></Pressable>
    </ScrollView>}
    <ContactInviteDialog visible={showAddDialog} onClose={() => { setAddOpen(false); if (params.add === '1') router.setParams({ add: undefined }); setReloadToken(value => value + 1); }} onCreated={() => setReloadToken(value => value + 1)} />
  </SafeAreaView>;
}

function Avatar({ name }: { name: string }) {
  const initials = name.trim().slice(0, 1) || '•';
  return <View style={s.avatar}><ThemedIcon role="primary" style={s.avatarText}>{initials}</ThemedIcon></View>;
}

function timestampValue(value: unknown) {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis?: unknown }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis();
  if (typeof value === 'string' || value instanceof Date) return new Date(value).getTime() || 0;
  return 0;
}

const s = StyleSheet.create({
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, marginBottom: 7, borderRadius: 13, backgroundColor: '#fff' },
  cancelText: { color: '#b33a45', fontSize: 10, fontWeight: '700' },
  page: { flex: 1, backgroundColor: '#f8faf9' }, header: { minHeight: 70, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: '#e1e9e6', backgroundColor: '#fff' }, iconButton: { width: 42, height: 48, justifyContent: 'center' }, back: { fontSize: 35, lineHeight: 42 }, headerTitleWrap: { flex: 1 }, headerTitle: { color: '#17211f', fontSize: 17, fontWeight: '700' }, headerSubtitle: { color: '#677471', fontSize: 10, marginTop: 1 }, addButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#d9f1eb', alignItems: 'center', justifyContent: 'center' }, add: { fontSize: 27, lineHeight: 32 }, content: { paddingHorizontal: 15, paddingTop: 13, paddingBottom: 42 }, intro: { marginBottom: 8 }, introTitle: { color: '#17211f', fontSize: 15, fontWeight: '700' }, muted: { color: '#677471', fontSize: 11, lineHeight: 17, marginTop: 3 }, flex: { flex: 1, minWidth: 0 }, profileSetup: { padding: 13, marginVertical: 8, borderRadius: 14, backgroundColor: '#e7f0ed' }, section: { marginTop: 8 }, sectionTitle: { color: '#17211f', fontSize: 13, fontWeight: '700', marginBottom: 8 }, recentSection: { marginVertical: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e1e9e6' }, sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, recentHint: { fontSize: 21 }, recentRow: { gap: 15, paddingTop: 8, paddingBottom: 2 }, recentContact: { width: 76, alignItems: 'center', gap: 3 }, recentName: { maxWidth: 76, color: '#17211f', fontSize: 10, fontWeight: '600' }, recentUsername: { maxWidth: 76, color: '#677471', fontSize: 8 }, inviteCard: { flexDirection: 'row', gap: 11, padding: 13, marginBottom: 8, borderRadius: 16, borderWidth: 1, borderColor: '#e1e9e6', backgroundColor: '#fff' }, avatar: { width: 47, height: 47, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#d9f1eb' }, avatarText: { fontSize: 20, fontWeight: '700' }, inlineActions: { flexDirection: 'row', gap: 8, marginTop: 9 }, smallPrimary: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: '#087b69' }, smallPrimaryText: { color: '#fff', fontSize: 11, fontWeight: '700' }, smallSecondary: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: '#f0f5f3' }, smallSecondaryText: { color: '#677471', fontSize: 11, fontWeight: '600' }, search: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#f0f5f3' }, searchIcon: { fontSize: 22 }, searchInput: { flex: 1, minHeight: 44, paddingVertical: 5, color: '#17211f', fontSize: 12 }, searchAction: { fontSize: 11, fontWeight: '700' }, loader: { marginTop: 35 }, warning: { marginTop: 15, padding: 13, borderRadius: 14, backgroundColor: '#fff0ee' }, warningTitle: { color: '#8e343b', fontWeight: '700' }, warningText: { color: '#734b4b', fontSize: 11, marginTop: 4 }, retry: { fontWeight: '700', marginTop: 8 }, contactRow: { minHeight: 75, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 9, borderRadius: 15 }, nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 }, contactName: { color: '#17211f', fontSize: 12, fontWeight: '700', flexShrink: 1 }, count: { minWidth: 19, paddingHorizontal: 5, borderRadius: 10, overflow: 'hidden', backgroundColor: '#087b69', color: '#fff', fontSize: 9, textAlign: 'center' }, handle: { fontSize: 10, marginTop: 1 }, chevron: { fontSize: 24 }, emptyCard: { alignItems: 'center', paddingHorizontal: 23, paddingVertical: 25, marginTop: 20, borderRadius: 18, backgroundColor: '#fff' }, emptyTitle: { color: '#17211f', fontSize: 14, fontWeight: '700', textAlign: 'center' }, primary: { minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 13, borderRadius: 13, backgroundColor: '#087b69' }, primaryText: { color: '#fff', fontSize: 11, fontWeight: '700' }, legacy: { marginTop: 21, paddingTop: 13, borderTopWidth: 1, borderColor: '#e1e9e6' }, legacyRow: { minHeight: 55, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, backgroundColor: '#fff', borderRadius: 12, marginTop: 6 }, legacyIcon: { width: 35, height: 35, textAlign: 'center', textAlignVertical: 'center', borderRadius: 11, overflow: 'hidden', backgroundColor: '#e7f0ed', fontSize: 19 }, migration: { padding: 13, marginTop: 18, borderRadius: 14, backgroundColor: '#f0f5f3' }, migrationTitle: { color: '#087b69', fontSize: 12, fontWeight: '700' },
});
