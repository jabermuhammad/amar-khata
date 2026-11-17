const APP_ID = 'com.jabermuhammad1.amarkhatamobile';
const MAX_APK_BYTES = 150 * 1024 * 1024;
const MANIFEST_URLS = new Set([
  'https://raw.githubusercontent.com/jabermuhammad/amar-khata-updates/main/preview/update.json',
  'https://raw.githubusercontent.com/jabermuhammad/amar-khata-updates/main/update.json',
]);

export function isTrustedManifestUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.port === ''
      && url.search === ''
      && url.hash === ''
      && MANIFEST_URLS.has(url.href);
  } catch {
    return false;
  }
}

export function isTrustedApkUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== 'https://github.com'
      || url.username || url.password || url.port || url.search || url.hash
      || /%(?:2f|5c)/i.test(url.pathname) || url.pathname.includes('\\')) return false;
    const parts = url.pathname.split('/');
    return parts.length === 7
      && parts[1] === 'jabermuhammad'
      && parts[2] === 'amar-khata-updates'
      && parts[3] === 'releases'
      && parts[4] === 'download'
      && parts[5].length > 0
      && parts[6].length > 4
      && parts[6].toLowerCase().endsWith('.apk');
  } catch {
    return false;
  }
}

export function parseUpdateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid update metadata');
  const data = value;
  if (data.packageId !== APP_ID || typeof data.version !== 'string' || !/^\d+(\.\d+){1,3}$/.test(data.version)) throw new Error('Invalid app identity or version');
  if (!Number.isSafeInteger(data.versionCode) || data.versionCode < 1) throw new Error('Invalid version code');
  if (!isTrustedApkUrl(data.apkUrl)) throw new Error('APK link must be a trusted Amar Khata GitHub Release asset');
  if (typeof data.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(data.sha256)) throw new Error('Invalid APK checksum');
  if (!Array.isArray(data.changelog) || data.changelog.some(line => typeof line !== 'string')) throw new Error('Invalid release notes');
  if (!Number.isSafeInteger(data.sizeBytes) || data.sizeBytes <= 0 || data.sizeBytes > MAX_APK_BYTES) throw new Error('Invalid APK size');
  return { packageId: APP_ID, version: data.version, versionCode: data.versionCode, apkUrl: data.apkUrl, sha256: data.sha256.toLowerCase(), changelog: data.changelog, sizeBytes: data.sizeBytes };
}

export function isUpdateDismissed(stored, versionCode, now = Date.now()) {
  if (typeof stored !== 'string' || !stored) return false;
  try {
    const dismissal = JSON.parse(stored);
    return dismissal?.versionCode === versionCode && Number.isSafeInteger(dismissal.until) && dismissal.until > now;
  } catch {
    return false;
  }
}

export async function resolveUpdateNotice(value, currentVersionCode, readDismissal, now = Date.now()) {
  const manifest = parseUpdateManifest(value);
  if (manifest.versionCode <= currentVersionCode) return { manifest: null, dismissed: false };
  const stored = await readDismissal();
  return { manifest, dismissed: isUpdateDismissed(stored, manifest.versionCode, now) };
}

export function matchesApkMetadata(expected, actualSize, actualSha256) {
  return Number.isSafeInteger(actualSize)
    && actualSize > 0
    && actualSize <= MAX_APK_BYTES
    && actualSize === expected.sizeBytes
    && typeof actualSha256 === 'string'
    && actualSha256.toLowerCase() === expected.sha256;
}
