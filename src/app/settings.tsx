import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, StyleSheet } from 'react-native';
import { ThemedScrollView as ScrollView, ThemedText as Text, ThemedView as View, ThemedTextInput as TextInput, ThemedSafeAreaView as SafeAreaView, ThemedIcon } from '../components/ThemePrimitives';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useAppUpdate } from '../contexts/AppUpdateContext';
import { useTheme } from '../contexts/ThemeContext';
import type { ThemeMode } from '../lib/themePolicy.mjs';
import { useAuth } from '../contexts/AuthContext';
import { readPhoto, storageScopeId, type StorageScope } from '../lib/localStorage';
import { getOwnContactProfile, type PublicContactProfile } from '../lib/collaboration';

const modes: { id: ThemeMode; label: string; symbol: string }[] = [
  { id: 'light', label: 'লাইট', symbol: '☼' },
  { id: 'dark', label: 'ডার্ক', symbol: '☾' },
  { id: 'system', label: 'সিস্টেম', symbol: '▣' },
  { id: 'scheduled', label: 'কাস্টম', symbol: '◷' },
];

const comingSoon: { title: string; detail: string; icon: string }[][] = [
  [
    { title: 'ভাষা', detail: 'শিগগিরই', icon: '文' },
    { title: 'নোটিফিকেশন', detail: 'শিগগিরই', icon: '♧' },
    { title: 'তারিখ ও সময়', detail: 'শিগগিরই', icon: '▦' },
    { title: 'কম্পন', detail: 'শিগগিরই', icon: '⌁' },
  ],
  [
    { title: 'বাজারের তালিকার পছন্দ', detail: 'শিগগিরই', icon: '☷' },
    { title: 'দাম ও হিসাব', detail: 'শিগগিরই', icon: '৳' },
    { title: 'নোটের পছন্দ', detail: 'শিগগিরই', icon: '▤' },
    { title: 'প্রিন্ট সেটিংস', detail: 'শিগগিরই', icon: '▧' },
  ],
  [
    { title: 'ডেটা ব্যাকআপ', detail: 'শিগগিরই', icon: '⇧' },
    { title: 'ব্যাকআপ পুনরুদ্ধার', detail: 'শিগগিরই', icon: '↻' },
    { title: 'ডেটা এক্সপোর্ট', detail: 'শিগগিরই', icon: '⇩' },
    { title: 'স্টোরেজ', detail: 'শিগগিরই', icon: '▣' },
  ],
  [
    { title: 'শেয়ার করা তালিকা ও নোট', detail: 'প্রোফাইল থেকে খুলুন', icon: '♧' },
    { title: 'ডেটা সিঙ্ক', detail: 'শিগগিরই', icon: '⟳' },
    { title: 'গোপনীয়তা', detail: 'শিগগিরই', icon: '◇' },
  ],
  [
    { title: 'সাহায্য ও যোগাযোগ', detail: 'শিগগিরই', icon: '?' },
    { title: 'অ্যাপ সম্পর্কে', detail: "What's New দেখুন", icon: 'ⓘ' },
    { title: 'গোপনীয়তা নীতি', detail: 'শিগগিরই', icon: '◇' },
  ],
];

const sections = ['অ্যাপ পছন্দ', 'তালিকা ও নোট', 'ডেটা ও ব্যাকআপ', 'অ্যাকাউন্ট ও গোপনীয়তা', 'সহায়তা ও অ্যাপ'];
const profileStyles = StyleSheet.create({
  section: { minHeight: 78, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  initial: { fontSize: 20, fontWeight: '700' },
  copy: { flex: 1, minWidth: 0 },
  name: { fontSize: 13, fontWeight: '700' },
  username: { marginTop: 2, fontSize: 10 },
  email: { marginTop: 6, fontSize: 10 },
  chevron: { fontSize: 20, paddingHorizontal: 5 },
});

export default function SettingsScreen() {
  const router = useRouter();
  const { user, scope, mode: authMode, signOutAccount } = useAuth();
  const { currentVersion, latestVersion } = useAppUpdate();
  const { theme, mode, preferences, setMode, setSchedule } = useTheme();
  const dark = theme === 'dark';
  const c = useMemo(() => dark ? {
    bg: '#090f13', surface: '#141f29', raised: '#182630', text: '#f2f6f4', muted: '#8fa0ad', faint: '#63727d', line: 'rgba(255,255,255,0.12)', accent: '#2dce91', accentBright: '#5ae2ae', wash: 'rgba(45,206,145,0.12)', input: '#101922', badge: '#203b35', timeline: '#26333b', yellow: '#ecc66b',
  } : {
    bg: '#f4f1eb', surface: '#ffffff', raised: '#f8faf7', text: '#1b2421', muted: '#68736f', faint: '#8a948f', line: 'rgba(28,53,42,0.11)', accent: '#147a55', accentBright: '#116947', wash: 'rgba(20,122,85,0.10)', input: '#ffffff', badge: '#e5f2eb', timeline: '#e2e9e4', yellow: '#e5b84e',
  }, [dark]);
  const preferenceKey = `${preferences.lightAt}/${preferences.darkAt}`;
  const [draft, setDraft] = useState<{ key: string; lightAt: string; darkAt: string } | null>(null);
  const lightAt = draft?.key === preferenceKey ? draft.lightAt : preferences.lightAt;
  const darkAt = draft?.key === preferenceKey ? draft.darkAt : preferences.darkAt;
  const build = Constants.expoConfig?.android?.versionCode || 1;
  const [profileData, setProfileData] = useState<{ scopeId: string; photo: string | null; contact: PublicContactProfile | null } | null>(null);
  const profileScopeId = scope ? storageScopeId(scope) : '';
  const visibleProfile = profileData?.scopeId === profileScopeId ? profileData : null;
  useEffect(() => {
    if (!scope) return;
    let active = true;
    const ownerScope: StorageScope = scope;
    void Promise.allSettled([readPhoto(ownerScope), user?.emailVerified ? getOwnContactProfile(user) : Promise.resolve(null)]).then(([photo, contact]) => {
      if (active) setProfileData({ scopeId: profileScopeId, photo: photo.status === 'fulfilled' ? photo.value : null, contact: contact.status === 'fulfilled' ? contact.value : null });
    });
    return () => { active = false; };
  }, [scope, profileScopeId, user]);
  const lightSegments = getLightSegments(lightAt, darkAt);
  const nowPercent = (new Date().getHours() * 60 + new Date().getMinutes()) / 14.4;
  const saveMode = (value: ThemeMode) => { void setMode(value).catch(error => Alert.alert('থিম সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।')); };
  const saveSchedule = () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(lightAt) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(darkAt)) { Alert.alert('সময়টি সঠিক নয়', '২৪ ঘণ্টার HH:MM ফরম্যাটে সময় দিন, যেমন 06:00।'); return; }
    void setSchedule(lightAt, darkAt).catch(error => Alert.alert('সময় সংরক্ষণ হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।'));
  };
  const unavailable = (title: string) => Alert.alert(title, 'এই সুবিধাটি এখনো অ্যাপে চালু করা হয়নি।');

  return <SafeAreaView style={[s.page, { backgroundColor: c.bg }]} edges={['top']}>
    <View style={[s.header, { backgroundColor: dark ? 'rgba(9,15,19,0.96)' : 'rgba(244,241,235,0.96)', borderColor: c.line }]}>
      <Pressable onPress={() => router.replace('/profile')} hitSlop={10} style={[s.back, { backgroundColor: c.surface, borderColor: c.line }]} accessibilityRole="button" accessibilityLabel="প্রোফাইলে ফিরে যান"><ThemedIcon role="secondary" style={[s.backText, { color: c.text }]}>‹</ThemedIcon></Pressable>
      <Text style={[s.headerTitle, { color: c.text }]}>সেটিংস</Text><View style={s.headerRight} />
    </View>
    <Pressable onPress={() => router.push('/profile')} style={[profileStyles.section, { backgroundColor: c.surface, borderColor: c.line }]} accessibilityRole="button" accessibilityLabel="প্রোফাইল সম্পাদনা করুন">
      <View style={[profileStyles.avatar, { backgroundColor: c.badge }]}>{visibleProfile?.photo ? <Image source={{ uri: visibleProfile.photo }} style={profileStyles.photo} /> : <ThemedIcon role="primary" style={profileStyles.initial}>{(user?.displayName || visibleProfile?.contact?.displayName || (authMode === 'guest' ? 'G' : 'A')).slice(0, 1)}</ThemedIcon>}</View>
      <View style={profileStyles.copy}><Text numberOfLines={1} style={[profileStyles.name, { color: c.text }]}>{user?.displayName || visibleProfile?.contact?.displayName || (authMode === 'guest' ? 'Guest ব্যবহারকারী' : 'আমার প্রোফাইল')}</Text><ThemedIcon role="primary" style={[profileStyles.username, { color: c.accent }]}>{visibleProfile?.contact?.username ? `@${visibleProfile.contact.username}` : authMode === 'guest' ? 'শুধু এই ডিভাইসে' : 'Username সেট করা নেই'}</ThemedIcon><Text numberOfLines={1} style={[profileStyles.email, { color: c.muted }]}>{user?.email || 'Guest account-এ ইমেইল যুক্ত নেই'}</Text></View>
      <ThemedIcon role="secondary" style={[profileStyles.chevron, { color: c.muted }]}>›</ThemedIcon>
    </Pressable>
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.headingRow}><View style={s.headingCopy}><Text style={[s.pageTitle, { color: c.text }]}>অ্যাপের চেহারা</Text><Text style={[s.pageSubtitle, { color: c.muted }]}>আপনার পছন্দমতো সাজিয়ে নিন</Text></View><View style={[s.statusBadge, { backgroundColor: c.badge }]}><View style={[s.statusDot, { backgroundColor: c.accent }]} /><Text style={[s.statusText, { color: c.accent }]}>{mode === 'system' ? 'ডিভাইস অনুযায়ী' : dark ? 'এখন ডার্ক' : 'এখন লাইট'}</Text></View></View>

      <View style={s.modeGrid}>{modes.map(option => {
        const selected = mode === option.id;
        return <Pressable key={option.id} onPress={() => saveMode(option.id)} style={[s.modeCard, { backgroundColor: c.surface, borderColor: selected ? c.accent : c.line }, selected && { backgroundColor: c.wash }]} accessibilityRole="button" accessibilityState={{ selected }}>
          <ThemedIcon role={selected ? 'primary' : 'secondary'} style={[s.modeIcon, { color: selected ? c.accent : c.muted }]}>{option.symbol}</ThemedIcon><Text style={[s.modeLabel, { color: selected ? c.accent : c.muted }]}>{option.label}</Text>{selected && <View style={[s.selectedMark, { backgroundColor: c.accent }]}><ThemedIcon role="success" style={s.selectedCheck}>✓</ThemedIcon></View>}
        </Pressable>;
      })}</View>

      {mode === 'scheduled' && <View style={[s.scheduleCard, { backgroundColor: c.surface, borderColor: c.line }]}>
        <View style={s.scheduleHeading}><View style={[s.scheduleIcon, { backgroundColor: c.wash }]}><ThemedIcon role="informational" style={{ fontSize: 17 }}>◷</ThemedIcon></View><View style={{ flex: 1 }}><Text style={[s.scheduleTitle, { color: c.text }]}>স্বয়ংক্রিয় সময়সূচি</Text><Text style={[s.scheduleHint, { color: c.muted }]}>বাকি সময় ডার্ক মোড সক্রিয় থাকবে</Text></View></View>
        <View style={s.timeRow}><TimeField label="লাইট মোড শুরু" value={lightAt} onChange={value => setDraft({ key: preferenceKey, lightAt: value, darkAt })} colors={c} /><TimeField label="ডার্ক মোড শুরু" value={darkAt} onChange={value => setDraft({ key: preferenceKey, lightAt, darkAt: value })} colors={c} /></View>
        <View style={[s.timeline, { backgroundColor: c.timeline }]}>{lightSegments.map((segment, index) => <View key={index} style={[s.timelineLight, { backgroundColor: c.yellow, left: `${segment.start}%`, width: `${segment.width}%` }]} />)}<View style={[s.timelineMarker, { backgroundColor: c.text, left: `${nowPercent}%` }]} /></View>
        <View style={s.timelineLabels}>{['রাত ১২', 'সকাল ৬', 'দুপুর ১২', 'সন্ধ্যা ৬', 'রাত ১২'].map((label, i) => <Text key={`${label}-${i}`} style={[s.timelineLabel, { color: c.faint }]}>{label}</Text>)}</View>
        <Text style={[s.timelineHint, { color: c.muted }]}>নির্ধারিত সময়ে থিম স্বয়ংক্রিয়ভাবে বদলাবে</Text>
        <Pressable onPress={saveSchedule} style={[s.saveButton, { backgroundColor: c.accent }]}><Text style={s.saveButtonText}>সময়সূচি সংরক্ষণ</Text></Pressable>
      </View>}

      {sections.map((section, sectionIndex) => <View key={section} style={s.sectionBlock}>
        <Text style={[s.sectionTitle, { color: c.muted }]}>{section}</Text>
        <View style={[s.sectionCard, { backgroundColor: c.surface, borderColor: c.line }]}>
          {comingSoon[sectionIndex].map((row, rowIndex) => <SettingsRow key={row.title} {...row} last={rowIndex === comingSoon[sectionIndex].length - 1} colors={c} onPress={() => {
            if (sectionIndex === 4 && row.title === 'অ্যাপ সম্পর্কে') router.push('/whats-new');
            else if (sectionIndex === 3 && row.title === 'শেয়ার করা তালিকা ও নোট') router.push('/shared');
            else unavailable(row.title);
          }} />)}
        </View>
      </View>)}

      <View style={[s.accountActions, { backgroundColor: c.surface, borderColor: c.line }]}>
        <Text style={[s.accountActionHeading, { color: c.text }]}>অ্যাকাউন্ট</Text>
        {authMode === 'account' ? <>
          <Pressable style={[s.accountActionButton, { borderColor: c.line }]} onPress={() => router.push('/shared')}><ThemedIcon role="primary" style={{ fontSize: 18 }}>◎</ThemedIcon><Text style={[s.accountActionText, { color: c.text }]}>পরিচিতি ও শেয়ারিং</Text><ThemedIcon role="secondary" style={{ fontSize: 21 }}>›</ThemedIcon></Pressable>
          <Pressable style={[s.accountActionButton, { borderColor: c.line }]} onPress={() => router.push('/invite')}><ThemedIcon role="primary" style={{ fontSize: 18 }}>↗</ThemedIcon><Text style={[s.accountActionText, { color: c.text }]}>পুরোনো invite code গ্রহণ</Text><ThemedIcon role="secondary" style={{ fontSize: 21 }}>›</ThemedIcon></Pressable>
          <Pressable style={[s.accountActionButton, { borderColor: c.line }]} onPress={() => Alert.alert('সাইন আউট করবেন?', 'আপনার account-scoped local data এই ডিভাইসে সংরক্ষিত থাকবে।', [{ text: 'থাক', style: 'cancel' }, { text: 'সাইন আউট', style: 'destructive', onPress: () => { void signOutAccount().catch(error => Alert.alert('সাইন আউট হয়নি', error instanceof Error ? error.message : 'আবার চেষ্টা করুন।')); } }])}><ThemedIcon role="destructive" style={{ fontSize: 18 }}>⇥</ThemedIcon><Text style={[s.accountActionText, { color: c.text }]}>সাইন আউট</Text><ThemedIcon role="secondary" style={{ fontSize: 21 }}>›</ThemedIcon></Pressable>
        </> : <Pressable style={[s.accountActionButton, { borderColor: c.line }]} onPress={() => router.push('/auth')}><ThemedIcon role="primary" style={{ fontSize: 18 }}>↗</ThemedIcon><Text style={[s.accountActionText, { color: c.text }]}>সাইন ইন / অ্যাকাউন্ট তৈরি</Text><ThemedIcon role="secondary" style={{ fontSize: 21 }}>›</ThemedIcon></Pressable>}
      </View>

      <View style={[s.versionCard, { backgroundColor: c.surface, borderColor: c.line }]}>
        <View style={[s.versionIcon, { backgroundColor: c.wash }]}><ThemedIcon role="informational" style={{ fontSize: 18 }}>ⓘ</ThemedIcon></View>
        <View style={{ flex: 1 }}><Text style={[s.versionTitle, { color: c.text }]}>আমার খাতা</Text><Text style={[s.versionDetail, { color: c.muted }]}>বর্তমান {currentVersion} · build {build}</Text></View><View style={[s.latestBadge, { backgroundColor: c.wash }]}><Text style={[s.latestText, { color: c.accent }]}>সর্বশেষ {latestVersion}</Text></View>
      </View>
      <Pressable style={s.whatsNew} onPress={() => router.push('/whats-new')}><Text style={[s.whatsNewText, { color: c.accent }]}>{"What's New দেখুন  ›"}</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}

function TimeField({ label, value, onChange, colors }: { label: string; value: string; onChange: (value: string) => void; colors: { text: string; muted: string; line: string; input: string } }) {
  return <View style={{ flex: 1 }}><Text style={[s.timeLabel, { color: colors.muted }]}>{label}</Text><TextInput value={value} onChangeText={onChange} style={[s.timeInput, { color: colors.text, borderColor: colors.line, backgroundColor: colors.input }]} placeholder="06:00" keyboardType="numbers-and-punctuation" maxLength={5} /></View>;
}

function SettingsRow({ title, detail, icon, last, colors, onPress }: { title: string; detail: string; icon: string; last: boolean; colors: { text: string; muted: string; faint: string; line: string; wash: string; accent: string }; onPress: () => void }) {
  const available = detail !== 'শিগগিরই';
  return <Pressable onPress={onPress} style={[s.settingRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }]} accessibilityRole="button" accessibilityState={{ disabled: !available }}>
    <View style={[s.rowIcon, { backgroundColor: colors.wash }]}><ThemedIcon role={available ? 'primary' : 'disabled'} style={[s.rowIconText, { color: colors.accent }]}>{icon}</ThemedIcon></View><View style={s.rowCopy}><Text style={[s.rowTitle, { color: colors.text }]}>{title}</Text><Text style={[s.rowDetail, { color: detail === 'শিগগিরই' ? colors.faint : colors.muted }]}>{detail}</Text></View><ThemedIcon role={available ? 'secondary' : 'disabled'} style={[s.rowChevron, { color: colors.faint }]}>{available ? '›' : '·'}</ThemedIcon>
  </Pressable>;
}

function getLightSegments(lightAt: string, darkAt: string) {
  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 360;
  };
  const start = toMinutes(lightAt);
  const end = toMinutes(darkAt);
  if (start === end) return [{ start: 0, width: 100 }];
  if (start < end) return [{ start: start / 14.4, width: (end - start) / 14.4 }];
  return [{ start: 0, width: end / 14.4 }, { start: start / 14.4, width: (1440 - start) / 14.4 }];
}

const s = StyleSheet.create({
  page: { flex: 1 }, header: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth }, back: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' }, backText: { fontSize: 30, lineHeight: 34, marginTop: -3 }, headerTitle: { fontSize: 17, fontWeight: '700' }, headerRight: { width: 40 }, content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 42 }, headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 17 }, headingCopy: { flex: 1 }, pageTitle: { fontSize: 22, fontWeight: '700' }, pageSubtitle: { fontSize: 12, marginTop: 4 }, statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 18 }, statusDot: { width: 6, height: 6, borderRadius: 3 }, statusText: { fontSize: 10, fontWeight: '600' }, modeGrid: { flexDirection: 'row', gap: 8, marginBottom: 24 }, modeCard: { flex: 1, height: 80, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center', gap: 5, position: 'relative' }, modeIcon: { fontSize: 21, lineHeight: 24 }, modeLabel: { fontSize: 11, fontWeight: '600' }, selectedMark: { position: 'absolute', top: -5, right: -4, width: 17, height: 17, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, selectedCheck: { color: '#fff', fontSize: 10, fontWeight: '700' }, scheduleCard: { borderRadius: 16, borderWidth: 1, padding: 15, marginBottom: 24 }, scheduleHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 }, scheduleIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, scheduleTitle: { fontSize: 14, fontWeight: '700' }, scheduleHint: { marginTop: 2, fontSize: 11 }, timeRow: { flexDirection: 'row', gap: 10, marginTop: 16 }, timeLabel: { fontSize: 10, marginBottom: 6 }, timeInput: { height: 40, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 13 }, timeline: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 21, position: 'relative' }, timelineLight: { position: 'absolute', height: 6, top: 0 }, timelineMarker: { position: 'absolute', top: -3, width: 2, height: 12, borderRadius: 2 }, timelineLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }, timelineLabel: { fontSize: 8 }, timelineHint: { fontSize: 10, marginTop: 12 }, saveButton: { height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, marginTop: 14 }, saveButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' }, sectionBlock: { marginTop: 7, marginBottom: 14 }, sectionTitle: { fontSize: 12, fontWeight: '700', marginBottom: 8, marginLeft: 2 }, sectionCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: 'hidden' }, settingRow: { minHeight: 59, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 11 }, rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, rowIconText: { fontSize: 15, fontWeight: '600' }, rowCopy: { flex: 1 }, rowTitle: { fontSize: 12, fontWeight: '600' }, rowDetail: { fontSize: 10, marginTop: 3 }, rowChevron: { width: 16, textAlign: 'center', fontSize: 23 }, accountActions: { marginTop: 18, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14 }, accountActionHeading: { fontSize: 13, fontWeight: '700', marginBottom: 6 }, accountActionButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth }, accountActionText: { flex: 1, fontSize: 12, fontWeight: '600' }, versionCard: { minHeight: 68, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }, versionIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, versionTitle: { fontSize: 12, fontWeight: '700' }, versionDetail: { fontSize: 10, marginTop: 3 }, latestBadge: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 9 }, latestText: { fontSize: 8, fontWeight: '600' }, whatsNew: { alignSelf: 'center', paddingVertical: 17, paddingHorizontal: 18 }, whatsNewText: { fontSize: 12, fontWeight: '700' },
});
