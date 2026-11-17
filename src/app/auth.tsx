import { createUserWithEmailAndPassword, EmailAuthProvider, GoogleAuthProvider, linkWithCredential, reauthenticateWithCredential, reload, sendEmailVerification, sendPasswordResetEmail, signInWithCredential, signInWithEmailAndPassword, signOut as firebaseSignOut, updateProfile } from 'firebase/auth';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Platform, StyleSheet, type FocusEvent, type ScrollViewInstance } from 'react-native';
import { ThemedKeyboardAvoidingView as KeyboardAvoidingView, ThemedScrollView as ScrollView, ThemedText as Text, ThemedTextInput as TextInput, ThemedView as View, ThemedSafeAreaView as SafeAreaView } from '../components/ThemePrimitives';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useAuth } from '../contexts/AuthContext';
import { auth } from '../lib/firebase';
import { hasLegacyDeviceData } from '../lib/localStorage';
import { requestPasswordReset } from '../lib/passwordReset.mjs';
import { canLinkGoogleEmail, normalizeAuthEmail } from '../lib/authPolicy.mjs';

type PendingGoogleLink = { idToken: string; email: string };
let nativeGoogleConfigured = false;

async function requestGoogleIdentity(webClientId: string): Promise<PendingGoogleLink | null> {
  const { GoogleOneTapSignIn, isCancelledResponse, isSuccessResponse } = await import('react-native-nitro-google-signin');
  if (!nativeGoogleConfigured) {
    GoogleOneTapSignIn.configure({ webClientId, scopes: ['email'], autoSelectOnSignIn: false });
    nativeGoogleConfigured = true;
  }
  await GoogleOneTapSignIn.checkPlayServices();
  const response = await GoogleOneTapSignIn.presentExplicitSignIn();
  if (isCancelledResponse(response)) return null;
  if (!isSuccessResponse(response) || !response.data.idToken || !response.data.user.email) {
    throw new Error('Google থেকে প্রয়োজনীয় ID token বা ইমেইল পাওয়া যায়নি।');
  }
  return { idToken: response.data.idToken, email: normalizeAuthEmail(response.data.user.email) };
}

const readableError = (error: unknown) => {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('email-already-in-use')) return 'এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে।';
  if (code.includes('invalid-credential') || code.includes('user-not-found') || code.includes('wrong-password')) return 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।';
  if (code.includes('invalid-email')) return 'সঠিক ইমেইল ঠিকানা লিখুন।';
  if (code.includes('operation-not-allowed')) return 'Firebase Authentication-এ ইমেইল/পাসওয়ার্ড সুবিধাটি চালু নেই।';
  if (code.includes('account-exists-with-different-credential')) return 'এই ইমেইলে অন্য sign-in পদ্ধতির account আছে। একই ইমেইল ও পাসওয়ার্ড দিয়ে সাইন ইন করে Google যুক্ত করুন।';
  if (code.includes('credential-already-in-use') || code.includes('credential-already-linked')) return 'এই Google account অন্য Firebase account-এ যুক্ত; account merge করা হয়নি।';
  if (code.includes('weak-password')) return 'পাসওয়ার্ডটি আরও শক্তিশালী করুন।';
  if (code.includes('network-request-failed')) return 'ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।';
  if (code.includes('too-many-requests')) return 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।';
  if (code.includes('requires-recent-login')) return 'নিরাপত্তার জন্য আবার sign-in করে কাজটি পুনরায় করুন।';
  return 'কাজটি সম্পন্ন হয়নি। ইমেইল, পাসওয়ার্ড ও ইন্টারনেট পরীক্ষা করুন।';
};

export default function AuthScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ connectionInviteId?: string }>();
  const connectionInviteId = typeof params.connectionInviteId === 'string' ? params.connectionInviteId : '';
  const finishSignIn = () => router.replace(connectionInviteId ? { pathname: '/invite', params: { connectionInviteId } } : '/');
  const { user, configured, continueAsGuest, beginAccountAuth, signOutAccount } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [guestBusy, setGuestBusy] = useState(false);
  const [pendingGoogleLink, setPendingGoogleLink] = useState<PendingGoogleLink | null>(null);
  const [notice, setNotice] = useState('');
  const formScrollRef = useRef<ScrollViewInstance | null>(null);
  const focusedInput = useRef<NonNullable<FocusEvent['target']> | null>(null);
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      if (focusedInput.current !== null) formScrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(focusedInput.current, 32, true);
    });
    return () => subscription.remove();
  }, []);
  const onInputFocus = (target: NonNullable<FocusEvent['target']>) => {
    focusedInput.current = target;
    requestAnimationFrame(() => formScrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(target, 32, true));
  };
  const onInputBlur = () => { focusedInput.current = null; };

  useEffect(() => {
    if (!resetCooldown) return;
    const timer = setTimeout(() => setResetCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [resetCooldown]);

  const enterGuest = async (importLegacy: boolean) => {
    setGuestBusy(true);
    try { await continueAsGuest(importLegacy); router.replace('/'); }
    catch { Alert.alert('Guest-এ কপি হয়নি', 'পুরোনো ডিভাইসের মূল ডাটা অক্ষত আছে। Guest space-এ কপি আবার চেষ্টা করা যাবে।'); router.replace('/'); }
    finally { setGuestBusy(false); }
  };

  const chooseGuest = async () => {
    if (guestBusy) return;
    try {
      if (await hasLegacyDeviceData()) {
        Alert.alert('পুরোনো ডিভাইসের ডাটা', 'পুরোনো নোট ও তালিকা আলাদা Legacy data হিসেবে আছে। Guest space-এ একটি যাচাইযোগ্য কপি আনবেন?', [
          { text: 'এখন নয়', style: 'cancel', onPress: () => { void enterGuest(false); } },
          { text: 'কপি করে Guest খুলুন', onPress: () => { void enterGuest(true); } },
        ]);
      } else await enterGuest(false);
    } catch { Alert.alert('ডাটা পরীক্ষা হয়নি', 'তবু Guest space খোলা যাবে; পুরোনো ডাটা অপরিবর্তিত থাকবে।', [{ text: 'Guest খুলুন', onPress: () => { void enterGuest(false); } }, { text: 'বাতিল', style: 'cancel' }]); }
  };

  const submit = async () => {
    if (!auth || !configured) return;
    const normalizedEmail = normalizeAuthEmail(email);
    if (!normalizedEmail || password.length < 6) { Alert.alert('তথ্য অসম্পূর্ণ', 'ইমেইল দিন এবং অন্তত ৬ অক্ষরের পাসওয়ার্ড লিখুন।'); return; }
    if (pendingGoogleLink && !canLinkGoogleEmail(normalizedEmail, pendingGoogleLink.email)) {
      Alert.alert('ইমেইল মিলছে না', 'Google account-এর একই ইমেইল ও পাসওয়ার্ড দিয়ে সাইন ইন করুন।');
      return;
    }
    setBusy(true); setNotice('');
    try {
      await beginAccountAuth();
      if (mode === 'signup') {
        const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        if (name.trim()) await updateProfile(credential.user, { displayName: name.trim() });
        await sendEmailVerification(credential.user);
        setNotice('অ্যাকাউন্ট তৈরি হয়েছে। শেয়ার করার আগে ইমেইলের যাচাইকরণ লিংকে চাপ দিন।');
      } else {
        const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
        if (pendingGoogleLink) {
          if (!canLinkGoogleEmail(credential.user.email, pendingGoogleLink.email)) {
            await firebaseSignOut(auth);
            throw new Error('Google ও Email/Password account-এর ইমেইল মিলছে না। সঠিক account দিয়ে আবার চেষ্টা করুন।');
          }
          try {
            await linkWithCredential(credential.user, GoogleAuthProvider.credential(pendingGoogleLink.idToken));
          } catch (linkError) {
            setPendingGoogleLink(null);
            const linkCode = typeof linkError === 'object' && linkError && 'code' in linkError ? String(linkError.code) : '';
            if (linkCode.includes('credential-already-in-use') || linkCode.includes('credential-already-linked')) {
              Alert.alert('Google account আগে থেকেই যুক্ত', 'এই Google account অন্য Firebase account-এর সঙ্গে যুক্ত। কোনো account merge করা হয়নি। যে account-এ Google যুক্ত আছে সেটি দিয়ে সাইন ইন করুন।');
              return;
            }
            throw linkError;
          }
          setPendingGoogleLink(null);
          Alert.alert('Account যুক্ত হয়েছে', 'Email/Password ও Google Sign-In এখন একই Firebase account ব্যবহার করবে।');
        }
        finishSignIn();
      }
    } catch (error) {
      const message = error instanceof Error && !('code' in error) ? error.message : readableError(error);
      Alert.alert('অ্যাকাউন্ট খোলা যায়নি', message);
    }
    finally { setBusy(false); }
  };

  const continueWithGoogle = async () => {
    if (!auth || !configured || busy) return;
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
    if (!webClientId) {
      Alert.alert('Google Sign-In প্রস্তুত নয়', 'Google Sign-In চালাতে Google Web OAuth Client ID EAS environment-এ যোগ করে নতুন Development/Production build করতে হবে।');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const googleLink = await requestGoogleIdentity(webClientId);
      if (!googleLink) return;
      const currentUser = auth.currentUser;
      if (currentUser) {
        if (!canLinkGoogleEmail(currentUser.email, googleLink.email)) {
          throw new Error('নিরাপত্তার জন্য Google ও বর্তমান account-এর ইমেইল একই হতে হবে।');
        }
        await linkWithCredential(currentUser, GoogleAuthProvider.credential(googleLink.idToken));
        Alert.alert('Google account যুক্ত হয়েছে', 'আপনার বর্তমান Firebase account-এ Google Sign-In যুক্ত হয়েছে।');
        return;
      }

      await beginAccountAuth();
      try {
        await signInWithCredential(auth, GoogleAuthProvider.credential(googleLink.idToken));
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
        if (code.includes('account-exists-with-different-credential')) {
          setPendingGoogleLink(googleLink);
          setEmail(googleLink.email);
          setPassword('');
          setMode('signin');
          setNotice('এই ইমেইলে Email/Password account আছে। একই ইমেইল ও পাসওয়ার্ড দিয়ে সাইন ইন করলে Google নিরাপদে ওই account-এ যুক্ত হবে।');
          return;
        }
        throw error;
      }
      finishSignIn();
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      const errorText = error instanceof Error ? error.message : '';
      if (code.toLowerCase().includes('sign_in_cancelled')) {
        return;
      } else if (/native module|nitro module/i.test(errorText)) {
        Alert.alert('Development Build দরকার', 'Google Sign-In native module Expo Go-তে নেই। Amar Khata-এর নতুন Development/Preview APK ইনস্টল করে চেষ্টা করুন।');
      } else if (code.includes('operation-not-allowed')) {
        Alert.alert('Google Sign-In চালু নেই', 'Firebase Console → Authentication → Sign-in method-এ Google provider চালু করতে হবে।');
      } else if (code.includes('credential-already-in-use') || code.includes('credential-already-linked')) {
        Alert.alert('Google account আগে থেকেই যুক্ত', 'এই Google account অন্য Firebase account-এর সঙ্গে যুক্ত। কোনো account merge করা হয়নি।');
      } else if (code.includes('DEVELOPER_ERROR') || code.includes('developer_error')) {
        Alert.alert('Google OAuth configuration মিলছে না', 'Android package ID, OAuth client type এবং EAS signing certificate-এর SHA-1 যাচাই করুন।');
      } else if (code.includes('PLAY_SERVICES_NOT_AVAILABLE')) {
        Alert.alert('Google Play Services পাওয়া যায়নি', 'ফোনে Google Play Services আপডেট করে আবার চেষ্টা করুন।');
      } else {
        const message = error instanceof Error && !('code' in error) ? error.message : readableError(error);
        Alert.alert('Google Sign-In হয়নি', message);
      }
    } finally {
      setBusy(false);
    }
  };

  const linkEmailPasswordToGoogleAccount = async () => {
    if (!auth || !user || !configured || busy) return;
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
    if (!webClientId) {
      Alert.alert('Google Sign-In প্রস্তুত নয়', 'Google Web OAuth Client ID configure করে নতুন native build তৈরি করতে হবে।');
      return;
    }
    if (password.length < 6) {
      Alert.alert('পাসওয়ার্ড অসম্পূর্ণ', 'Email/Password sign-in-এর জন্য অন্তত ৬ অক্ষরের পাসওয়ার্ড দিন।');
      return;
    }
    setBusy(true);
    try {
      const googleLink = await requestGoogleIdentity(webClientId);
      if (!googleLink) return;
      if (!canLinkGoogleEmail(user.email, googleLink.email)) {
        throw new Error('নিরাপত্তার জন্য Google ও বর্তমান account-এর ইমেইল একই হতে হবে।');
      }
      await reauthenticateWithCredential(user, GoogleAuthProvider.credential(googleLink.idToken));
      await linkWithCredential(user, EmailAuthProvider.credential(user.email!, password));
      setPassword('');
      Alert.alert('Email/Password যুক্ত হয়েছে', 'Google ও Email/Password এখন একই Firebase account ব্যবহার করবে।');
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
      const errorText = error instanceof Error ? error.message : '';
      if (code.toLowerCase().includes('sign_in_cancelled')) {
        return;
      } else if (/native module|nitro module/i.test(errorText)) {
        Alert.alert('Development Build দরকার', 'Google Sign-In native module Expo Go-তে নেই। Amar Khata-এর নতুন Development/Preview APK ইনস্টল করে চেষ্টা করুন।');
      } else if (code.includes('credential-already-in-use') || code.includes('credential-already-linked')) {
        Alert.alert('ইমেইল আগে থেকেই ব্যবহৃত', 'এই Email/Password credential অন্য Firebase account-এ যুক্ত। কোনো account merge করা হয়নি।');
      } else {
        const message = error instanceof Error && !('code' in error) ? error.message : readableError(error);
        Alert.alert('Email/Password যুক্ত হয়নি', message);
      }
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (resetBusy || resetCooldown) return;
    setResetBusy(true);
    try {
      const result = await requestPasswordReset(auth, normalizedEmail, sendPasswordResetEmail);
      if (result.ok) {
        setResetCooldown(30);
        Alert.alert('অনুরোধ গ্রহণ করা হয়েছে', 'এই ঠিকানার জন্য কোনো অ্যাকাউন্ট থাকলে পাসওয়ার্ড রিসেট লিংক পাঠানো হবে। Inbox ও Spam/Junk ফোল্ডার দেখুন।');
      } else {
        const messages = {
          config: 'Firebase Authentication কনফিগারেশন বা Email/Password provider পরীক্ষা করুন।',
          'invalid-email': 'সঠিক ইমেইল ঠিকানা লিখুন।',
          throttled: 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
          network: 'ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।',
          unknown: 'রিসেট অনুরোধ পাঠানো যায়নি। পরে আবার চেষ্টা করুন।',
        } as const;
        Alert.alert('লিংক পাঠানো যায়নি', messages[result.reason]);
      }
    } catch {
      Alert.alert('লিংক পাঠানো যায়নি', 'রিসেট অনুরোধ পাঠানো যায়নি। পরে আবার চেষ্টা করুন।');
    }
    finally { setResetBusy(false); }
  };

  if (user) {
    const googleLinked = user.providerData.some(provider => provider.providerId === 'google.com');
    const passwordLinked = user.providerData.some(provider => provider.providerId === 'password');
    return <SafeAreaView style={s.page} edges={['top', 'left', 'right', 'bottom']}><ScrollView contentContainerStyle={s.pageContent} keyboardShouldPersistTaps="handled"><View style={s.card}>
      <Text style={s.title}>আমার খাতা</Text><Text style={s.copy}>{user.email}</Text><Text style={s.copy}>{user.emailVerified ? 'ইমেইল যাচাই করা হয়েছে।' : 'শেয়ার ব্যবহারের আগে ইমেইল যাচাই করুন।'}</Text>
      <Pressable style={s.primary} onPress={() => router.replace('/')}><Text style={s.primaryText}>অ্যাপে ফিরুন</Text></Pressable>
      {!user.emailVerified && <><Pressable style={s.secondary} onPress={async () => { try { await sendEmailVerification(user); Alert.alert('পাঠানো হয়েছে', 'যাচাইকরণ ইমেইল পাঠানো হয়েছে।'); } catch (error) { Alert.alert('পাঠানো যায়নি', readableError(error)); } }}><Text style={s.secondaryText}>যাচাইকরণ ইমেইল আবার পাঠান</Text></Pressable><Pressable style={s.secondary} onPress={async () => { try { await reload(user); await user.getIdToken(true); Alert.alert(user.emailVerified ? 'যাচাই হয়েছে' : 'এখনো যাচাই হয়নি', user.emailVerified ? 'এখন শেয়ার করা যাবে।' : 'ইমেইলের inbox-এ যাচাইকরণ লিংকটি খুলে, তারপর আবার চেষ্টা করুন.'); } catch (error) { Alert.alert('যাচাই করা যায়নি', readableError(error)); } }}><Text style={s.secondaryText}>আমি যাচাই করেছি · আবার পরীক্ষা করুন</Text></Pressable></>}
      {!googleLinked && configured && <Pressable disabled={busy} style={[s.google, busy && { opacity: .65 }]} onPress={() => { void continueWithGoogle(); }}>{busy ? <ActivityIndicator color="#315f47" /> : <Text style={s.googleText}>Google account যুক্ত করুন</Text>}</Pressable>}
      {googleLinked && !passwordLinked && configured && <><TextInput value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" placeholder="নতুন Email/Password পাসওয়ার্ড" placeholderTextColor="#858a82" style={s.input} /><Pressable disabled={busy} style={[s.google, busy && { opacity: .65 }]} onPress={() => { void linkEmailPasswordToGoogleAccount(); }}>{busy ? <ActivityIndicator color="#315f47" /> : <Text style={s.googleText}>Email/Password যুক্ত করুন</Text>}</Pressable></>}
      <Pressable style={s.secondary} onPress={() => { void signOutAccount().catch(error => Alert.alert('সাইন আউট হয়নি', readableError(error))); }}><Text style={s.secondaryText}>সাইন আউট</Text></Pressable>
    </View></ScrollView></SafeAreaView>;
  }

  return <SafeAreaView style={s.page} edges={['top', 'left', 'right', 'bottom']}><KeyboardAvoidingView style={s.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView ref={formScrollRef} contentContainerStyle={s.pageContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"><View style={s.card}><Text style={s.title}>আমার খাতা</Text><Text style={s.subtitle}>অ্যাকাউন্টে ঢুকে আপনার তালিকা ও নোট নিরাপদে শেয়ার করুন</Text>
    <Pressable disabled={guestBusy} style={[s.guest, guestBusy && { opacity: .6 }]} onPress={() => { void chooseGuest(); }}><Text style={s.guestText}>{guestBusy ? 'Guest space প্রস্তুত হচ্ছে…' : 'লগইন ছাড়া চালিয়ে যান'}</Text></Pressable>
    {!configured ? <Text style={s.notice}>Firebase config না থাকায় sign-in, cloud sync, invite ও sharing বন্ধ। Guest mode-এ নোট ও তালিকা এই ডিভাইসেই থাকবে।</Text> : <>
      <View style={s.switcher}><Pressable onPress={() => setMode('signin')} style={[s.switch, mode === 'signin' && s.activeSwitch]}><Text style={[s.switchText, mode === 'signin' && s.activeSwitchText]}>সাইন ইন</Text></Pressable><Pressable onPress={() => setMode('signup')} style={[s.switch, mode === 'signup' && s.activeSwitch]}><Text style={[s.switchText, mode === 'signup' && s.activeSwitchText]}>নতুন অ্যাকাউন্ট</Text></Pressable></View>
      {mode === 'signup' && <TextInput value={name} onChangeText={setName} onFocus={event => { if (event.target !== undefined) onInputFocus(event.target); }} onBlur={onInputBlur} placeholder="আপনার নাম (ঐচ্ছিক)" placeholderTextColor="#858a82" style={s.input} />}
      <TextInput value={email} onChangeText={setEmail} onFocus={event => { if (event.target !== undefined) onInputFocus(event.target); }} onBlur={onInputBlur} placeholder="ইমেইল" placeholderTextColor="#858a82" keyboardType="email-address" autoCapitalize="none" autoComplete="email" style={s.input} />
      <TextInput value={password} onChangeText={setPassword} onFocus={event => { if (event.target !== undefined) onInputFocus(event.target); }} onBlur={onInputBlur} placeholder="পাসওয়ার্ড (অন্তত ৬ অক্ষর)" placeholderTextColor="#858a82" secureTextEntry autoCapitalize="none" style={s.input} />
      {!!notice && <Text style={s.notice}>{notice}</Text>}
      <Pressable disabled={busy} onPress={submit} style={[s.primary, busy && { opacity: .65 }]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{mode === 'signin' ? 'সাইন ইন' : 'অ্যাকাউন্ট তৈরি করুন'}</Text>}</Pressable>
      <Pressable disabled={busy} onPress={() => { void continueWithGoogle(); }} style={[s.google, busy && { opacity: .65 }]}>{busy ? <ActivityIndicator color="#315f47" /> : <Text style={s.googleText}>Google দিয়ে চালিয়ে যান</Text>}</Pressable>
      {mode === 'signin' && <Pressable disabled={resetBusy || resetCooldown > 0} style={[s.secondary, (resetBusy || resetCooldown > 0) && { opacity: .65 }]} onPress={resetPassword}>{resetBusy ? <ActivityIndicator color="#356d49" /> : <Text style={s.secondaryText}>{resetCooldown ? `আবার অনুরোধ ${resetCooldown} সেকেন্ড পরে` : 'পাসওয়ার্ড ভুলে গেছেন?'}</Text>}</Pressable>}
    </>}
  </View></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#f4f5ef' }, keyboard: { flex: 1 }, pageContent: { flexGrow: 1, justifyContent: 'center', padding: 22, paddingBottom: 36 }, card: { padding: 22, borderRadius: 22, borderWidth: 1, borderColor: '#e4e8de', backgroundColor: '#fff' }, title: { color: '#223329', fontSize: 27, fontWeight: '700' }, subtitle: { color: '#727b72', fontSize: 13, lineHeight: 20, marginTop: 6, marginBottom: 18 }, copy: { color: '#727b72', fontSize: 14, marginTop: 10 }, switcher: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: '#f0f3ee', marginVertical: 18 }, switch: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, activeSwitch: { backgroundColor: '#fff', elevation: 1 }, switchText: { color: '#777f76', fontSize: 13 }, activeSwitchText: { color: '#315f47', fontWeight: '700' }, input: { minHeight: 52, paddingHorizontal: 14, marginTop: 11, borderWidth: 1, borderColor: '#e1e5dd', borderRadius: 13, color: '#252a24', backgroundColor: '#fbfcfa', fontSize: 15 }, primary: { minHeight: 50, alignItems: 'center', justifyContent: 'center', marginTop: 18, borderRadius: 13, backgroundColor: '#2b8655' }, primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' }, google: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 10, borderRadius: 13, borderWidth: 1, borderColor: '#d9ded8', backgroundColor: '#fff' }, googleText: { color: '#315f47', fontSize: 14, fontWeight: '700' }, guest: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 14, borderRadius: 13, borderWidth: 1, borderColor: '#bdd9c4', backgroundColor: '#f0f7f1' }, guestText: { color: '#315f47', fontSize: 14, fontWeight: '700' }, secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 9 }, secondaryText: { color: '#356d49', fontSize: 13, fontWeight: '600' }, notice: { marginTop: 15, padding: 12, borderRadius: 12, color: '#73541b', backgroundColor: '#fff5d9', fontSize: 12, lineHeight: 18 } });
