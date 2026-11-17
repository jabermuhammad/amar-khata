import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { isTrustedManifestUrl, matchesApkMetadata, resolveUpdateNotice, type UpdateManifest } from '../lib/updatePolicy.mjs';

const APK_MIME = 'application/vnd.android.package-archive';
const DISMISSED_KEY = '@amar-khata/update-dismissal';
const MAX_APK_BYTES = 150 * 1024 * 1024;

type AppUpdateValue = {
  manifest: UpdateManifest | null;
  currentVersion: string;
  latestVersion: string;
  dismissForWeek: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  checking: boolean;
  dismissed: boolean;
  downloading: boolean;
};

const AppUpdateContext = createContext<AppUpdateValue | null>(null);
const manifestUrl = process.env.EXPO_PUBLIC_UPDATE_MANIFEST_URL?.trim() || '';
const validManifestUrl = isTrustedManifestUrl(manifestUrl);
const currentVersion = Constants.expoConfig?.version || '1.0.0';
const currentVersionCode = Constants.expoConfig?.android?.versionCode || 1;

export function AppUpdateProvider({ children }: React.PropsWithChildren) {
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(validManifestUrl);
  const [downloading, setDownloading] = useState(false);
  const downloadInProgress = useRef(false);

  useEffect(() => {
    let active = true;
    if (!validManifestUrl) return;
    void (async () => {
      try {
        const response = await fetch(manifestUrl, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Manifest request failed');
        if (!isTrustedManifestUrl(response.url)) throw new Error('Manifest redirected outside the trusted endpoint');
        const latest = await response.json();
        if (!active) return;
        const decision = await resolveUpdateNotice(
          latest,
          currentVersionCode,
          () => AsyncStorage.getItem(DISMISSED_KEY),
          Date.now(),
        );
        if (active) {
          setDismissed(decision.dismissed);
          setManifest(decision.manifest);
        }
      } catch {
        // Updates stay hidden on offline, malformed, or unreachable metadata.
      } finally { if (active) setChecking(false); }
    })();
    return () => { active = false; };
  }, []);

  const dismissForWeek = useCallback(async () => {
    if (!manifest) return;
    const until = Date.now() + 7 * 24 * 60 * 60 * 1000;
    try {
      await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify({ versionCode: manifest.versionCode, until }));
      setDismissed(true);
    } catch {
      Alert.alert('পরে মনে রাখা যায়নি', 'স্টোরেজে সমস্যা হয়েছে। আবার চেষ্টা করুন।');
    }
  }, [manifest]);

  const downloadAndInstall = useCallback(async () => {
    if (!manifest || downloadInProgress.current) return;
    if (Platform.OS !== 'android') { Alert.alert('Android আপডেট', 'এই APK আপডেটটি Android-এর জন্য।'); return; }
    if (manifest.sizeBytes > MAX_APK_BYTES) { Alert.alert('APK ডাউনলোড বাতিল', 'ফাইলটির ঘোষিত আকার সীমার বেশি।'); return; }
    downloadInProgress.current = true;
    setDownloading(true);
    const destination = new File(Paths.cache, `amar-khata-${manifest.versionCode}.apk`);
    const controller = new AbortController();
    try {
      if (destination.exists) destination.delete();
      const file = await File.downloadFileAsync(manifest.apkUrl, destination, {
        idempotent: true,
        signal: controller.signal,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (bytesWritten > MAX_APK_BYTES || (totalBytes > 0 && totalBytes > MAX_APK_BYTES)) controller.abort();
        },
      });
      if (!file.exists || file.size <= 0 || file.size > MAX_APK_BYTES || file.size !== manifest.sizeBytes) throw new Error('Downloaded APK has an unexpected size');
      if (!matchesApkMetadata(manifest, file.size, await file.digest('SHA-256'))) { file.delete(); throw new Error('APK checksum did not match'); }
      if (!(await File.canPreview(file, { mimeType: APK_MIME }))) throw new Error('No Android package installer can open this APK');
      await File.preview(file, { mimeType: APK_MIME, title: `আমার খাতা ${manifest.version}` });
    } catch {
      try { if (destination.exists) destination.delete(); } catch { /* Best-effort cleanup of this update's cache file. */ }
      Alert.alert('আপডেট খোলা যায়নি', 'ডাউনলোড/যাচাই পরীক্ষা করুন। Android-এর Install unknown apps অনুমতি চাইলে এই অ্যাপের জন্য অনুমতি দিন।');
    } finally {
      downloadInProgress.current = false;
      setDownloading(false);
    }
  }, [manifest]);

  const value = useMemo(() => ({ manifest, currentVersion, latestVersion: manifest?.version || currentVersion, dismissForWeek, downloadAndInstall, checking, dismissed, downloading }), [checking, dismissForWeek, dismissed, downloadAndInstall, downloading, manifest]);
  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdate() {
  const value = useContext(AppUpdateContext);
  if (!value) throw new Error('useAppUpdate must be used inside AppUpdateProvider');
  return value;
}
