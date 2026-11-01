import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import { acceptInvite } from '../lib/collaboration';

export default function InviteScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const [inputCode, setInputCode] = useState('');
  const code = params.code || inputCode;
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    if (!user) { router.replace('/auth'); return; }
    if (!code.trim()) { Alert.alert('কোড লিখুন', 'শেয়ার করা invite code লিখুন।'); return; }
    setBusy(true);
    try {
      const result = await acceptInvite(code, user);
      Alert.alert('Invite গ্রহণ হয়েছে', 'এখন শেয়ার করা একই নোট বা তালিকা খুলবে।', [{ text: 'খুলুন', onPress: () => router.replace(result.kind === 'list' ? { pathname: '/list', params: { remoteId: result.id } } : { pathname: '/note', params: { remoteId: result.id } }) }]);
    } catch (error) { Alert.alert('Invite গ্রহণ করা যায়নি', error instanceof Error ? error.message : 'ইন্টারনেট ও code পরীক্ষা করুন।'); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={s.page}><View style={s.header}><Pressable onPress={() => router.back()}><Text style={s.back}>‹</Text></Pressable><Text style={s.headerTitle}>Invite গ্রহণ</Text><View style={{ width: 35 }} /></View><ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><Text style={s.title}>শেয়ার করা নোট বা তালিকা যোগ করুন</Text><Text style={s.copy}>Invite code একা access দেয় না। যে verified ইমেইলে আমন্ত্রণ পাঠানো হয়েছে, সেই account দিয়ে সাইন ইন করতে হবে।{user && !user.emailVerified ? '\n\nআপনার ইমেইল আগে যাচাই করুন।' : ''}</Text><TextInput value={code} onChangeText={setInputCode} autoCapitalize="none" autoCorrect={false} placeholder="Invite code" placeholderTextColor="#808880" style={s.input} /><Pressable disabled={busy} style={[s.primary, busy && { opacity: .6 }]} onPress={accept}><Text style={s.primaryText}>{busy ? 'যাচাই হচ্ছে…' : 'Invite গ্রহণ করুন'}</Text></Pressable></ScrollView></SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#fafaf7' }, header: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#e8e9e3' }, back: { color: '#315f47', fontSize: 34 }, headerTitle: { color: '#20231f', fontSize: 18, fontWeight: '600' }, scroll: { flex: 1 }, content: { flexGrow: 1, padding: 22 }, title: { color: '#252b25', fontSize: 22, fontWeight: '700' }, copy: { color: '#737b72', fontSize: 13, lineHeight: 21, marginTop: 9 }, input: { minHeight: 52, paddingHorizontal: 14, borderWidth: 1, borderColor: '#dce3db', borderRadius: 13, marginTop: 22, backgroundColor: '#fff', color: '#252b25' }, primary: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 13, marginTop: 13, backgroundColor: '#2b8655' }, primaryText: { color: '#fff', fontSize: 14, fontWeight: '700' } });
