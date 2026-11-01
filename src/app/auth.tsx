import { createUserWithEmailAndPassword, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import { auth } from '../lib/firebase';

const readableError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('email-already-in-use')) return 'এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে।';
  if (code.includes('invalid-credential') || code.includes('user-not-found') || code.includes('wrong-password')) return 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।';
  if (code.includes('invalid-email')) return 'সঠিক ইমেইল ঠিকানা লিখুন।';
  if (code.includes('operation-not-allowed')) return 'Firebase Authentication-এ ইমেইল/পাসওয়ার্ড সুবিধাটি চালু নেই।';
  if (code.includes('weak-password')) return 'পাসওয়ার্ডটি আরও শক্তিশালী করুন।';
  if (code.includes('network-request-failed')) return 'ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।';
  if (code.includes('too-many-requests')) return 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।';
  return 'কাজটি সম্পন্ন হয়নি। ইমেইল, পাসওয়ার্ড ও ইন্টারনেট পরীক্ষা করুন।';
};

export default function AuthScreen() {
  const router = useRouter();
  const { user, configured } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const submit = async () => {
    if (!auth || !configured) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || password.length < 6) { Alert.alert('তথ্য অসম্পূর্ণ', 'ইমেইল দিন এবং অন্তত ৬ অক্ষরের পাসওয়ার্ড লিখুন।'); return; }
    setBusy(true); setNotice('');
    try {
      if (mode === 'signup') {
        const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
        await sendEmailVerification(credential.user);
        setNotice('অ্যাকাউন্ট তৈরি হয়েছে। শেয়ার করার আগে ইমেইলের যাচাইকরণ লিংকে চাপ দিন।');
      } else {
        await signInWithEmailAndPassword(auth, normalizedEmail, password);
        router.replace('/');
      }
    } catch (error) { Alert.alert('অ্যাকাউন্ট খোলা যায়নি', readableError(error)); }
    finally { setBusy(false); }
  };

  const resetPassword = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!auth || !configured) { Alert.alert('সুবিধাটি চালু নেই', 'Firebase Email/Password কনফিগারেশন পরীক্ষা করুন।'); return; }
    if (!normalizedEmail) { Alert.alert('ইমেইল লিখুন', 'পাসওয়ার্ড রিসেট লিংক পাঠাতে আপনার ইমেইল দিন।'); return; }
    if (resetBusy) return;
    setResetBusy(true);
    try { await sendPasswordResetEmail(auth, normalizedEmail); Alert.alert('লিংক পাঠানো হয়েছে', 'ইমেইল ইনবক্স ও স্প্যাম ফোল্ডারে পাসওয়ার্ড রিসেট লিংক দেখুন।'); }
    catch (error) { Alert.alert('লিংক পাঠানো যায়নি', readableError(error)); }
    finally { setResetBusy(false); }
  };

  if (user) return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.pageContent} keyboardShouldPersistTaps="handled"><View style={s.card}><Text style={s.title}>আমার খাতা</Text><Text style={s.copy}>{user.email}</Text><Text style={s.copy}>{user.emailVerified ? 'ইমেইল যাচাই করা হয়েছে।' : 'শেয়ার ব্যবহারের আগে ইমেইল যাচাই করুন।'}</Text><Pressable style={s.primary} onPress={() => router.replace('/')}><Text style={s.primaryText}>অ্যাপে ফিরুন</Text></Pressable>{!user.emailVerified && <><Pressable style={s.secondary} onPress={async () => { try { await sendEmailVerification(user); Alert.alert('পাঠানো হয়েছে', 'যাচাইকরণ ইমেইল পাঠানো হয়েছে।'); } catch (error) { Alert.alert('পাঠানো যায়নি', readableError(error)); } }}><Text style={s.secondaryText}>যাচাইকরণ ইমেইল আবার পাঠান</Text></Pressable><Pressable style={s.secondary} onPress={async () => { try { await reload(user); await user.getIdToken(true); Alert.alert(user.emailVerified ? 'যাচাই হয়েছে' : 'এখনো যাচাই হয়নি', user.emailVerified ? 'এখন শেয়ার করা যাবে।' : 'ইমেইলের inbox-এ যাচাইকরণ লিংকটি খুলে, তারপর আবার চেষ্টা করুন.'); } catch (error) { Alert.alert('যাচাই করা যায়নি', readableError(error)); } }}><Text style={s.secondaryText}>আমি যাচাই করেছি · আবার পরীক্ষা করুন</Text></Pressable></>}<Pressable style={s.secondary} onPress={() => signOut(auth!)}><Text style={s.secondaryText}>সাইন আউট</Text></Pressable></View></ScrollView></SafeAreaView>;

  return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.pageContent} keyboardShouldPersistTaps="handled"><View style={s.card}><Text style={s.title}>আমার খাতা</Text><Text style={s.subtitle}>অ্যাকাউন্টে ঢুকে আপনার তালিকা ও নোট নিরাপদে শেয়ার করুন</Text>
    {!configured ? <><Text style={s.notice}>Firebase Web App-এর public config এখনো অ্যাপে যোগ করা হয়নি। `.env.local`-এ `.env.example`-এর মানগুলো বসালে Email/Password sign-in চালু হবে। এই অবস্থায় লোকাল নোটবুক ব্যবহার করা যাবে; cloud sharing বন্ধ থাকবে।</Text><Pressable style={s.secondary} onPress={() => router.replace('/')}><Text style={s.secondaryText}>লোকাল নোটবুকে ফিরুন</Text></Pressable></> : <>
      <View style={s.switcher}><Pressable onPress={() => setMode('signin')} style={[s.switch, mode === 'signin' && s.activeSwitch]}><Text style={[s.switchText, mode === 'signin' && s.activeSwitchText]}>সাইন ইন</Text></Pressable><Pressable onPress={() => setMode('signup')} style={[s.switch, mode === 'signup' && s.activeSwitch]}><Text style={[s.switchText, mode === 'signup' && s.activeSwitchText]}>নতুন অ্যাকাউন্ট</Text></Pressable></View>
      {mode === 'signup' && <TextInput value={name} onChangeText={setName} placeholder="আপনার নাম (ঐচ্ছিক)" placeholderTextColor="#858a82" style={s.input} />}
      <TextInput value={email} onChangeText={setEmail} placeholder="ইমেইল" placeholderTextColor="#858a82" keyboardType="email-address" autoCapitalize="none" autoComplete="email" style={s.input} />
      <TextInput value={password} onChangeText={setPassword} placeholder="পাসওয়ার্ড (অন্তত ৬ অক্ষর)" placeholderTextColor="#858a82" secureTextEntry autoCapitalize="none" style={s.input} />
      {!!notice && <Text style={s.notice}>{notice}</Text>}
      <Pressable disabled={busy} onPress={submit} style={[s.primary, busy && { opacity: .65 }]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{mode === 'signin' ? 'সাইন ইন' : 'অ্যাকাউন্ট তৈরি করুন'}</Text>}</Pressable>
      {mode === 'signin' && <Pressable disabled={resetBusy} style={[s.secondary, resetBusy && { opacity: .65 }]} onPress={resetPassword}>{resetBusy ? <ActivityIndicator color="#356d49" /> : <Text style={s.secondaryText}>পাসওয়ার্ড ভুলে গেছেন?</Text>}</Pressable>}
    </>}
  </View></ScrollView></SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#f4f5ef' }, pageContent: { flexGrow: 1, justifyContent: 'center', padding: 22 }, card: { padding: 22, borderRadius: 22, borderWidth: 1, borderColor: '#e4e8de', backgroundColor: '#fff' }, title: { color: '#223329', fontSize: 27, fontWeight: '700' }, subtitle: { color: '#727b72', fontSize: 13, lineHeight: 20, marginTop: 6, marginBottom: 18 }, copy: { color: '#727b72', fontSize: 14, marginTop: 10 }, switcher: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: '#f0f3ee', marginVertical: 18 }, switch: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, activeSwitch: { backgroundColor: '#fff', elevation: 1 }, switchText: { color: '#777f76', fontSize: 13 }, activeSwitchText: { color: '#315f47', fontWeight: '700' }, input: { minHeight: 52, paddingHorizontal: 14, marginTop: 11, borderWidth: 1, borderColor: '#e1e5dd', borderRadius: 13, color: '#252a24', backgroundColor: '#fbfcfa', fontSize: 15 }, primary: { minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 18, borderRadius: 13, backgroundColor: '#2b8655' }, primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' }, secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 9 }, secondaryText: { color: '#356d49', fontSize: 13, fontWeight: '600' }, notice: { marginTop: 15, padding: 12, borderRadius: 12, color: '#73541b', backgroundColor: '#fff5d9', fontSize: 12, lineHeight: 18 } });
