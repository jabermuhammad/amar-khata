import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Platform, StyleSheet, type FocusEvent, type ScrollViewInstance } from 'react-native';
import { ThemedKeyboardAvoidingView as KeyboardAvoidingView, ThemedScrollView as ScrollView, ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, ThemedSafeAreaView as SafeAreaView, ThemedIcon } from '../components/ThemePrimitives';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import { acceptConnectionInvite, acceptInvite } from '../lib/collaboration';
import { goBackOrReplace } from '../lib/navigation.mjs';

export default function InviteScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; connectionInviteId?: string }>();
  const [inputCode, setInputCode] = useState('');
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const focusedInput = useRef<NonNullable<FocusEvent['target']> | null>(null);
  const connectionInviteId = typeof params.connectionInviteId === 'string' ? params.connectionInviteId : '';
  const code = params.code || inputCode;
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      if (focusedInput.current !== null) scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(focusedInput.current, 80, true);
    });
    return () => subscription.remove();
  }, []);
  const accept = async () => {
    if (!user) { router.replace(connectionInviteId ? { pathname: '/auth', params: { connectionInviteId } } : '/auth'); return; }
    if (!connectionInviteId && !code.trim()) { Alert.alert('কোড বা অনুরোধের লিংক দরকার', 'শেয়ার করা invite link খুলুন অথবা পুরোনো invite code লিখুন।'); return; }
    setBusy(true);
    try {
      if (connectionInviteId) {
        await acceptConnectionInvite(connectionInviteId, user);
        Alert.alert('পরিচিতির অনুরোধ গ্রহণ হয়েছে', 'এখন পরিচিতি পেজে গিয়ে আলাদাভাবে শেয়ার করা তালিকা ও নোট দেখতে পারবেন।', [{ text: 'পরিচিতি খুলুন', onPress: () => router.replace('/shared') }]);
      } else {
        const result = await acceptInvite(code, user);
        Alert.alert('Invite গ্রহণ হয়েছে', 'এখন শেয়ার করা একই নোট বা তালিকা খুলবে।', [{ text: 'খুলুন', onPress: () => router.replace(result.kind === 'list' ? { pathname: '/list', params: { remoteId: result.id } } : { pathname: '/note', params: { remoteId: result.id } }) }]);
      }
    } catch (error) { Alert.alert('Invite গ্রহণ করা যায়নি', error instanceof Error ? error.message : 'ইন্টারনেট ও code পরীক্ষা করুন।'); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right', 'bottom']}>
    <View style={s.header}><Pressable onPress={() => goBackOrReplace(router, '/profile')} hitSlop={10} accessibilityRole="button" accessibilityLabel="প্রোফাইলে ফিরে যান"><ThemedIcon role="primary" style={s.back}>‹</ThemedIcon></Pressable><Text style={s.headerTitle}>Invite গ্রহণ</Text><View style={{ width: 35 }} /></View>
    <KeyboardAvoidingView style={s.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={s.title}>{connectionInviteId ? 'পরিচিতির অনুরোধ গ্রহণ করুন' : 'শেয়ার করা নোট বা তালিকা যোগ করুন'}</Text><Text style={s.copy}>{connectionInviteId ? 'এই link শুধু পরিচিতি-সংযোগের অনুরোধ বহন করে। এটি কোনো তালিকা বা নোটে নিজে থেকে access দেয় না। গ্রহণ করতে প্রাপক account-এ সাইন ইন ও email যাচাই করুন।' : 'Invite code একা access দেয় না। যে verified ইমেইলে আমন্ত্রণ পাঠানো হয়েছে, সেই account দিয়ে সাইন ইন করতে হবে।'}{user && !user.emailVerified ? '\n\nআপনার ইমেইল আগে যাচাই করুন।' : ''}</Text>
        {!connectionInviteId && <TextInput value={code} onChangeText={setInputCode} onFocus={event => { if (event.target !== undefined) focusedInput.current = event.target; }} onBlur={() => { focusedInput.current = null; }} autoCapitalize="none" autoCorrect={false} returnKeyType="done" onSubmitEditing={accept} placeholder="Invite code" placeholderTextColor="#808880" style={s.input} />}
        <Pressable disabled={busy} style={[s.primary, busy && { opacity: .6 }]} onPress={accept}><Text style={s.primaryText}>{busy ? 'যাচাই হচ্ছে…' : connectionInviteId ? 'অনুরোধ গ্রহণ করুন' : 'Invite গ্রহণ করুন'}</Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#fafaf7' }, keyboard: { flex: 1 }, header: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#e8e9e3' }, back: { color: '#315f47', fontSize: 34 }, headerTitle: { color: '#20231f', fontSize: 18, fontWeight: '600' }, scroll: { flex: 1 }, content: { flexGrow: 1, padding: 22, paddingBottom: 36 }, title: { color: '#252b25', fontSize: 22, fontWeight: '700' }, copy: { color: '#737b72', fontSize: 13, lineHeight: 21, marginTop: 9 }, input: { minHeight: 52, paddingHorizontal: 14, borderWidth: 1, borderColor: '#dce3db', borderRadius: 13, marginTop: 22, backgroundColor: '#fff', color: '#252b25' }, primary: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 13, marginTop: 13, backgroundColor: '#2b8655' }, primaryText: { color: '#fff', fontSize: 14, fontWeight: '700' } });
