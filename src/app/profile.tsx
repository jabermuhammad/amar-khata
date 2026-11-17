import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Modal, PanResponder, StyleSheet, useWindowDimensions } from 'react-native';
import { ThemedScrollView as ScrollView, ThemedText as Text, ThemedView as View, ThemedSafeAreaView as SafeAreaView, ThemedIcon } from '../components/ThemePrimitives';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../contexts/AuthContext';
import { readPhoto, writePhoto } from '../lib/localStorage';
import { GlossyPressable as Pressable } from '../components/GlossyPressable';
import { useTheme } from '../contexts/ThemeContext';
import { goBackOrReplace } from '../lib/navigation.mjs';

export default function ProfileScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { user, configured, scope, mode } = useAuth();
  const { width, height } = useWindowDimensions();
  const stage = Math.max(220, Math.min(width - 40, height * 0.48, 420));
  const [photoState, setPhotoState] = useState<{ scopeKey: string; value: string | null } | null>(null);
  const scopeKey = scope ? scope.kind === 'guest' ? `guest:${scope.id}` : `user:${scope.uid}` : null;
  const photo = photoState?.scopeKey === scopeKey ? photoState.value : null;
  const [menu, setMenu] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const offsetRef = useRef(offset);
  const zoomRef = useRef(zoom);
  useEffect(() => { offsetRef.current = offset; }, [offset]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  React.useEffect(() => { let active = true; if (scope && scopeKey) readPhoto(scope).then(value => { if (active) setPhotoState({ scopeKey, value }); }).catch(() => {}); return () => { active = false; }; }, [scope, scopeKey]);
  const commitPhoto = (uri: string | null) => { if (scopeKey) setPhotoState({ scopeKey, value: uri }); if (scope) writePhoto(scope, uri).catch(() => Alert.alert('ছবি সংরক্ষণ হয়নি', 'আবার চেষ্টা করুন।')); };

  const choose = async (camera = false) => {
    setMenu(false);
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { Alert.alert('ক্যামেরা অনুমতি দরকার', 'ছবি তুলতে ক্যামেরা ব্যবহারের অনুমতি দিন।'); return; }
      }
      const result = camera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      if (asset.fileSize && asset.fileSize > 15 * 1024 * 1024) { Alert.alert('ছবিটি বড়', '১৫ MB-এর কম আকারের ছবি বেছে নিন।'); return; }
      setSourceSize({ width: asset.width || 1, height: asset.height || 1 });
      setSource(asset.uri); setZoom(1); setOffset({ x: 0, y: 0 });
    } catch { Alert.alert('ছবি খোলা যায়নি', 'অন্য ছবি দিয়ে আবার চেষ্টা করুন।'); }
  };

  // PanResponder callbacks read refs only when gestures fire; this stable responder avoids resetting touch state on each render.
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { panStart.current = offsetRef.current; },
    onPanResponderMove: (_event, gesture) => {
      const scale = Math.max(stage / sourceSize.width, stage / sourceSize.height) * zoomRef.current;
      const maxX = Math.max(0, (sourceSize.width * scale - stage) / 2);
      const maxY = Math.max(0, (sourceSize.height * scale - stage) / 2);
      const next = { x: Math.max(-maxX, Math.min(maxX, panStart.current.x + gesture.dx)), y: Math.max(-maxY, Math.min(maxY, panStart.current.y + gesture.dy)) };
      offsetRef.current = next;
      setOffset(next);
    },
  }), [stage, sourceSize.height, sourceSize.width]);

  const saveCrop = async () => {
    if (!source) return;
    setBusy(true);
    try {
      const base = Math.max(stage / sourceSize.width, stage / sourceSize.height) * zoom;
      const cropWidth = Math.min(sourceSize.width, stage / base);
      const cropHeight = Math.min(sourceSize.height, stage / base);
      const originX = Math.max(0, Math.min(sourceSize.width - cropWidth, (sourceSize.width - cropWidth) / 2 - offset.x / base));
      const originY = Math.max(0, Math.min(sourceSize.height - cropHeight, (sourceSize.height - cropHeight) / 2 - offset.y / base));
      const image = await ImageManipulator.manipulateAsync(source, [
        { crop: { originX, originY, width: cropWidth, height: cropHeight } },
        { resize: { width: 512, height: 512 } },
      ], { format: ImageManipulator.SaveFormat.JPEG, compress: 0.86, base64: true });
      if (!image.base64) throw new Error('Missing image data');
      commitPhoto(`data:image/jpeg;base64,${image.base64}`);
      setSource(null);
    } catch { Alert.alert('ছবি সংরক্ষণ হয়নি', 'ছবিটি crop করতে সমস্যা হয়েছে। অন্য ছবি দিয়ে চেষ্টা করুন।'); }
    finally { setBusy(false); }
  };

  return <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
    <StatusBar style={source || viewer || theme === 'dark' ? 'light' : 'dark'} />
    <View style={s.header}><Pressable onPress={() => goBackOrReplace(router, '/')} hitSlop={10} accessibilityRole="button" accessibilityLabel="হোমে ফিরে যান" style={s.back}><ThemedIcon role="primary" style={s.backText}>‹</ThemedIcon></Pressable><Text style={s.headerTitle}>প্রোফাইল</Text><View style={{ width: 40 }} /></View>
    <ScrollView contentContainerStyle={s.profile} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>আপনার অ্যাকাউন্ট</Text>
      <Pressable style={s.avatar} onPress={() => setMenu(true)} accessibilityRole="button" accessibilityLabel="প্রোফাইল ছবি দেখুন বা পরিবর্তন করুন">
        {photo ? <Image source={{ uri: photo }} style={s.avatarImage} /> : <Text style={s.avatarPlaceholder}>👤</Text>}
        <View style={s.cameraBadge}><ThemedIcon role="primary" style={s.cameraText}>📷</ThemedIcon></View>
      </Pressable>
      <Text style={s.name}>আমার প্রোফাইল</Text><Text style={s.hint}>ছবিতে ট্যাপ করে ছবি দেখুন বা আপলোড করুন</Text>
      <Pressable style={s.change} onPress={() => setMenu(true)}><ThemedIcon role="primary" style={s.changeText}>▧  প্রোফাইল ছবি পরিবর্তন</ThemedIcon></Pressable>
      <View style={s.accountBox}><Text style={s.accountTitle}>{mode === 'guest' ? 'Guest · শুধু এই ডিভাইসে' : 'অ্যাকাউন্ট'}</Text><Text style={s.accountDetail}>{user?.email || (mode === 'guest' ? 'এই Guest space-এর নোট ও তালিকা শুধু এই ডিভাইসে থাকবে।' : configured ? 'সাইন ইন করলে শেয়ার ব্যবহার করতে পারবেন' : 'Cloud sharing-এর জন্য Firebase config বাকি')}</Text><Pressable style={s.settingsEntry} onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="সেটিংস খুলুন"><View style={s.settingsIcon}><ThemedIcon role="primary" style={s.settingsIconText}>⚙</ThemedIcon></View><ThemedIcon role="primary" style={s.settingsEntryText}>সেটিংস</ThemedIcon><ThemedIcon role="secondary" style={s.settingsChevron}>›</ThemedIcon></Pressable></View>
    </ScrollView>

    <Modal visible={menu} transparent animationType="slide" onRequestClose={() => setMenu(false)}>
      <Pressable style={s.scrim} onPress={() => setMenu(false)}><Pressable style={s.sheet} onPress={event => event.stopPropagation()}><View style={s.grabber} /><Text style={s.sheetTitle}>প্রোফাইল ছবি</Text>
        {photo && <Action title="ছবি দেখুন" detail="বর্তমান প্রোফাইল ছবি খুলুন" icon="▧" onPress={() => { setMenu(false); setViewer(true); }} />}
        <Action title="গ্যালারি থেকে আপলোড করুন" detail="ফোনের ছবি বেছে নিন" icon="▧" onPress={() => choose(false)} />
        <Action title="ক্যামেরা দিয়ে তুলুন" detail="নতুন ছবি তুলে crop করুন" icon="📷" onPress={() => choose(true)} />
        {photo && <Action title="ছবি সরান" detail="প্রোফাইল ছবি মুছে দিন" icon="×" onPress={() => { commitPhoto(null); setMenu(false); }} />}
        <Pressable style={s.cancel} onPress={() => setMenu(false)}><Text style={s.cancelText}>বাতিল</Text></Pressable>
      </Pressable></Pressable>
    </Modal>

    <Modal visible={viewer} transparent animationType="fade" onRequestClose={() => setViewer(false)}>
      <View style={s.viewer}><Pressable style={s.close} onPress={() => setViewer(false)}><Text style={s.closeText}>×</Text></Pressable>{photo && <Image source={{ uri: photo }} style={s.viewerImage} resizeMode="contain" />}<Pressable style={s.viewerAction} onPress={() => { setViewer(false); setMenu(true); }}><Text style={s.viewerActionText}>ছবি পরিবর্তন</Text></Pressable></View>
    </Modal>

    <Modal visible={!!source} animationType="slide" onRequestClose={() => setSource(null)}>
      <SafeAreaView style={s.cropPage} edges={['top', 'left', 'right', 'bottom']}>
        <View style={s.cropHeader}><Pressable onPress={() => setSource(null)}><Text style={s.cropIcon}>×</Text></Pressable><View style={s.cropHeadText}><Text style={s.cropTitle}>ছবি ক্রপ করুন</Text><Text style={s.cropSub}>ছবিটি টেনে ঠিকভাবে বসান</Text></View><Pressable onPress={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}><Text style={s.reset}>রিসেট</Text></Pressable></View>
        <View style={s.cropBody}><View style={[s.stage, { width: stage, height: stage }]} {...responder.panHandlers}>
          {source && <Image source={{ uri: source }} style={[s.cropImage, { width: stage, height: stage, transform: [{ translateX: offset.x }, { translateY: offset.y }, { scale: zoom }] }]} resizeMode="cover" />}
          <View pointerEvents="none" style={s.circle} />
        </View>
          <View style={[s.zoomRow, { width: stage }]}><Text style={s.zoomText}>জুম</Text><Text style={s.zoomText}>{Math.round(zoom * 100)}%</Text></View>
          <View style={[s.zoomControls, { width: stage }]}><Pressable style={s.zoomButton} disabled={zoom <= 1} onPress={() => setZoom(value => Math.max(1, Number((value - 0.1).toFixed(2))))}><Text style={s.zoomButtonText}>−</Text></Pressable><View style={s.track}><View style={[s.fill, { width: `${((zoom - 1) / 2) * 100}%` }]} /></View><Pressable style={s.zoomButton} disabled={zoom >= 3} onPress={() => setZoom(value => Math.min(3, Number((value + 0.1).toFixed(2))))}><Text style={s.zoomButtonText}>＋</Text></Pressable></View>
        </View>
        <View style={s.cropFooter}><Pressable style={s.cropCancel} onPress={() => setSource(null)}><Text style={s.cropCancelText}>বাতিল</Text></Pressable><Pressable style={[s.cropSave, busy && { opacity: 0.6 }]} disabled={busy} onPress={saveCrop}><Text style={s.cropSaveText}>{busy ? 'সংরক্ষণ হচ্ছে…' : 'ছবি ব্যবহার করুন'}</Text></Pressable></View>
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

function Action({ title, detail, icon, onPress }: { title: string; detail: string; icon: string; onPress: () => void }) {
  return <Pressable style={s.actionRow} onPress={onPress}><View style={s.actionIcon}><ThemedIcon role="primary" style={s.actionSymbol}>{icon}</ThemedIcon></View><View style={{ flex: 1 }}><Text style={s.actionTitle}>{title}</Text><Text style={s.actionDetail}>{detail}</Text></View><ThemedIcon role="secondary" style={s.chevron}>›</ThemedIcon></Pressable>;
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fafaf7' }, header: { height: 58, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#e8e9e3' }, back: { width: 40 }, backText: { color: '#315f47', fontSize: 34 }, headerTitle: { color: '#20231f', fontSize: 18, fontWeight: '600' }, profile: { flex: 1, alignItems: 'center', paddingTop: 48, paddingHorizontal: 24 }, muted: { color: '#777d75', fontSize: 13 }, avatar: { width: 136, height: 136, marginTop: 24, marginBottom: 18, borderRadius: 68, backgroundColor: '#e6ede7', borderWidth: 1, borderColor: '#d9e3db', alignItems: 'center', justifyContent: 'center' }, avatarImage: { width: '100%', height: '100%', borderRadius: 68 }, avatarPlaceholder: { fontSize: 48 }, cameraBadge: { position: 'absolute', right: -2, bottom: -2, width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: '#fafaf7', backgroundColor: '#315f47', alignItems: 'center', justifyContent: 'center' }, cameraText: { fontSize: 16 }, name: { color: '#20231f', fontSize: 22, fontWeight: '600' }, hint: { color: '#777d75', fontSize: 13, textAlign: 'center', marginTop: 7, marginBottom: 24 }, change: { minHeight: 48, borderWidth: 1, borderColor: '#dce5dd', borderRadius: 13, backgroundColor: '#fff', paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' }, changeText: { color: '#315f47', fontSize: 14, fontWeight: '600' }, accountBox: { width: '100%', padding: 15, marginTop: 22, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e6e9e1' }, accountTitle: { color: '#30382f', fontSize: 14, fontWeight: '700' }, accountDetail: { color: '#80877e', fontSize: 11, marginTop: 5 }, settingsEntry: { minHeight: 52, marginTop: 10, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderColor: '#edf0e9' }, settingsIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#e4eee8', alignItems: 'center', justifyContent: 'center' }, settingsIconText: { color: '#276e4b', fontSize: 18 }, settingsEntryText: { flex: 1, color: '#34774e', fontSize: 13, fontWeight: '700' }, settingsChevron: { color: '#92988f', fontSize: 24 }, accountAction: { minHeight: 40, justifyContent: 'center', borderBottomWidth: 1, borderColor: '#edf0e9' }, accountActionText: { color: '#34774e', fontSize: 13, fontWeight: '600' },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(19,24,20,.45)' }, sheet: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, backgroundColor: '#fbfbf8', borderTopLeftRadius: 24, borderTopRightRadius: 24 }, grabber: { width: 36, height: 4, borderRadius: 3, backgroundColor: '#c7cac4', alignSelf: 'center', marginBottom: 19 }, sheetTitle: { color: '#20231f', fontSize: 20, fontWeight: '600', marginBottom: 12 }, actionRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: '#e8e9e4' }, actionIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#e4eee6', alignItems: 'center', justifyContent: 'center' }, actionSymbol: { fontSize: 19, color: '#315f47' }, actionTitle: { color: '#252922', fontSize: 15, fontWeight: '600' }, actionDetail: { color: '#777d75', fontSize: 12, marginTop: 2 }, chevron: { color: '#92988f', fontSize: 25 }, cancel: { height: 48, justifyContent: 'center', alignItems: 'center', marginTop: 8 }, cancelText: { color: '#5f655e', fontSize: 14 },
  viewer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(8,12,9,.96)' }, viewerImage: { width: '92%', height: '72%', borderRadius: 300 }, close: { position: 'absolute', top: 36, right: 20, zIndex: 2, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,.15)', alignItems: 'center', justifyContent: 'center' }, closeText: { color: '#fff', fontSize: 30 }, viewerAction: { position: 'absolute', bottom: 34, height: 48, paddingHorizontal: 22, borderRadius: 14, backgroundColor: '#fff', justifyContent: 'center' }, viewerActionText: { color: '#233b2c', fontWeight: '600' },
  cropPage: { flex: 1, backgroundColor: '#171a18' }, cropHeader: { minHeight: 62, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, cropIcon: { width: 38, color: '#fff', fontSize: 30 }, cropHeadText: { flex: 1, alignItems: 'center' }, cropTitle: { color: '#fff', fontSize: 15, fontWeight: '600' }, cropSub: { color: '#b4bbb6', fontSize: 11, marginTop: 2 }, reset: { width: 42, color: '#c6e5ce', textAlign: 'right', fontSize: 13 }, cropBody: { flex: 1, justifyContent: 'center', paddingBottom: 16 }, stage: { alignSelf: 'center', overflow: 'hidden', borderRadius: 12, backgroundColor: '#252a26' }, cropImage: { position: 'absolute', top: 0, left: 0 }, circle: { ...StyleSheet.absoluteFill, borderWidth: 2, borderColor: '#fff', borderRadius: 999 }, zoomRow: { alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 28 }, zoomText: { color: '#e6e9e6', fontSize: 13 }, zoomControls: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 }, zoomButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#515752', borderRadius: 12 }, zoomButtonText: { color: '#fff', fontSize: 20 }, track: { flex: 1, height: 5, backgroundColor: '#424943', borderRadius: 3, overflow: 'hidden' }, fill: { height: '100%', backgroundColor: '#8ccea0' }, cropFooter: { minHeight: 76, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, borderTopWidth: 1, borderColor: '#343936', flexDirection: 'row', gap: 12 }, cropCancel: { flex: 1, height: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#515752', borderRadius: 13 }, cropCancelText: { color: '#fff', fontSize: 14 }, cropSave: { flex: 1.5, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#4e8b60' }, cropSaveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
