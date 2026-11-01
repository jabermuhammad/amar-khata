import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Alert, Platform } from 'react-native';

const APP_ID = 'com.jabermuhammad1.amarkhatamobile';
const APK_MIME = 'application/vnd.android.package-archive';
const DISMISSED_KEY = '@amar-khata/update-dismissal';
const MAX_APK_BYTES = 150 * 1024 * 1024;

export type UpdateManifest = {
  packageId: string;
  version: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
  changelog: string[];
  sizeBytes: number;
};

type AppUpdateValue = {
  manifest: UpdateManifest | null;
  currentVersion: string;
  latestVersion: string;
  dismissForWeek: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  checking: boolean;
  dismissed: boolean;
};

const AppUpdateContext = createContext<AppUpdateValue | null>(null);
const manifestUrl = process.env.EXPO_PUBLIC_UPDATE_MANIFEST_URL?.trim() || '';
const currentVersion = Constants.expoConfig?.version || '1.0.0';
const currentVersionCode = Constants.expoConfig?.android?.versionCode || 1;

function parseManifest(value: unknown): UpdateManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid update metadata');
  const data = value as Record<string, unknown>;
  if (data.packageId !== APP_ID || typeof data.version !== 'string' || !/^\d+(\.\d+){1,3}$/.test(data.version)) throw new Error('Invalid app identity or version');
  if (!Number.isSafeInteger(data.versionCode) || Number(data.versionCode) < 1) throw new Error('Invalid version code');
  if (typeof data.apkUrl !== 'string' || !data.apkUrl.startsWith('https://')) throw new Error('APK link must use HTTPS');
  if (typeof data.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(data.sha256)) throw new Error('Invalid APK checksum');
  if (!Array.isArray(data.changelog) || data.changelog.some(line => typeof line !== 'string')) throw new Error('Invalid release notes');
  if (!Number.isSafeInteger(data.sizeBytes) || Number(data.sizeBytes) <= 0 || Number(data.sizeBytes) > MAX_APK_BYTES) throw new Error('Invalid APK size');
  return { packageId: APP_ID, version: data.version, versionCode: Number(data.versionCode), apkUrl: data.apkUrl, sha256: data.sha256.toLowerCase(), changelog: data.changelog as string[], sizeBytes: Number(data.sizeBytes) };
}

export function AppUpdateProvider({ children }: React.PropsWithChildren) {
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(manifestUrl.startsWith('https://'));

  useEffect(() => {
    let active = true;
    if (!manifestUrl || !manifestUrl.startsWith('https://')) return;
    void (async () => {
      try {
        const response = await fetch(manifestUrl, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Manifest request failed');
        const latest = parseManifest(await response.json());
        if (!active) return;
        if (latest.versionCode > currentVersionCode) {
          const stored = await AsyncStorage.getItem(DISMISSED_KEY);
          let isDismissed = false;
          if (stored) {
            const dismissal = JSON.parse(stored) as { versionCode?: number; until?: number };
            isDismissed = dismissal.versionCode === latest.versionCode && Number(dismissal.until) > Date.now();
          }
          if (active) {
            setDismissed(isDismissed);
            setManifest(latest);
          }
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
    if (!manifest) return;
    if (Platform.OS !== 'android') { Alert.alert('Android আপডেট', 'এই APK আপডেটটি Android-এর জন্য।'); return; }
    if (manifest.sizeBytes > MAX_APK_BYTES) { Alert.alert('APK ডাউনলোড বাতিল', 'ফাইলটির ঘোষিত আকার সীমার বেশি।'); return; }
    const destination = new File(Paths.cache, `amar-khata-${manifest.versionCode}.apk`);
    const controller = new AbortController();
    try {
      const file = await File.downloadFileAsync(manifest.apkUrl, destination, {
        idempotent: true,
        signal: controller.signal,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (bytesWritten > MAX_APK_BYTES || (totalBytes > 0 && totalBytes > MAX_APK_BYTES)) controller.abort();
        },
      });
      if (!file.exists || file.size <= 0 || file.size > MAX_APK_BYTES || file.size !== manifest.sizeBytes) throw new Error('Downloaded APK has an unexpected size');
      if ((await file.digest('SHA-256')).toLowerCase() !== manifest.sha256) { file.delete(); throw new Error('APK checksum did not match'); }
      if (!(await File.canPreview(file, { mimeType: APK_MIME }))) throw new Error('No Android package installer can open this APK');
      await File.preview(file, { mimeType: APK_MIME, title: `আমার খাতা ${manifest.version}` });
    } catch {
      if (destination.exists) destination.delete();
      Alert.alert('আপডেট খোলা যায়নি', 'ডাউনলোড/যাচাই পরীক্ষা করুন। Android-এর Install unknown apps অনুমতি চাইলে এই অ্যাপের জন্য অনুমতি দিন।');
    }
  }, [manifest]);

  const value = useMemo(() => ({ manifest, currentVersion, latestVersion: manifest?.version || currentVersion, dismissForWeek, downloadAndInstall, checking, dismissed }), [checking, dismissForWeek, dismissed, downloadAndInstall, manifest]);
  return <AppUpdateContext.Provider value={value}>{children}</AppUpdateContext.Provider>;
}

export function useAppUpdate() {
  const value = useContext(AppUpdateContext);
  if (!value) throw new Error('useAppUpdate must be used inside AppUpdateProvider');
  return value;
}
