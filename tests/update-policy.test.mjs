import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTrustedApkUrl, isTrustedManifestUrl, matchesApkMetadata, parseUpdateManifest, resolveUpdateNotice } from '../src/lib/updatePolicy.mjs';

const valid = {
  packageId: 'com.jabermuhammad1.amarkhatamobile',
  version: '1.0.2',
  versionCode: 3,
  apkUrl: 'https://github.com/jabermuhammad/amar-khata-updates/releases/download/v1.0.2/amar-khata-1.0.2.apk',
  sha256: 'a'.repeat(64),
  changelog: ['উন্নতি'],
  sizeBytes: 4096,
};
const schema = JSON.parse(readFileSync(new URL('../update.schema.json', import.meta.url), 'utf8'));

test('manifest schema required fields match the fields consumed by the app parser', () => {
  const parserFields = ['packageId', 'version', 'versionCode', 'apkUrl', 'sha256', 'changelog', 'sizeBytes'];
  assert.deepEqual([...schema.required].sort(), [...parserFields].sort());
  assert.equal(schema.properties.packageId.const, valid.packageId);
  assert.match(valid.apkUrl, new RegExp(schema.properties.apkUrl.pattern));
});

test('manifest parser accepts valid metadata and normalizes checksum case', () => {
  assert.equal(parseUpdateManifest({ ...valid, sha256: 'A'.repeat(64) }).sha256, 'a'.repeat(64));
});

test('manifest parser rejects wrong identity, non-HTTPS URL, malformed digest, and invalid size/version', () => {
  for (const value of [
    { ...valid, packageId: 'wrong.package' },
    { ...valid, apkUrl: 'http://example.invalid/release.apk' },
    { ...valid, sha256: 'bad' },
    { ...valid, sizeBytes: 0 },
    { ...valid, versionCode: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, version: 'v1.0' },
  ]) assert.throws(() => parseUpdateManifest(value));
});

test('manifest endpoints allow only the exact Preview and Production raw GitHub URLs', () => {
  assert.equal(isTrustedManifestUrl('https://raw.githubusercontent.com/jabermuhammad/amar-khata-updates/main/preview/update.json'), true);
  assert.equal(isTrustedManifestUrl('https://raw.githubusercontent.com/jabermuhammad/amar-khata-updates/main/update.json'), true);
  for (const url of [
    'http://raw.githubusercontent.com/jabermuhammad/amar-khata-updates/main/update.json',
    'https://raw.githubusercontent.com/attacker/amar-khata-updates/main/update.json',
    'https://raw.githubusercontent.com/jabermuhammad/other/main/update.json',
    'https://raw.githubusercontent.com/jabermuhammad/amar-khata-updates/main/update.json?redirect=evil',
  ]) assert.equal(isTrustedManifestUrl(url), false);
});

test('APK URL accepts only this repository release assets and rejects untrusted sources', () => {
  assert.equal(isTrustedApkUrl(valid.apkUrl), true);
  for (const url of [
    'http://github.com/jabermuhammad/amar-khata-updates/releases/download/v1/app.apk',
    'https://github.com/attacker/amar-khata-updates/releases/download/v1/app.apk',
    'https://github.com/jabermuhammad/other/releases/download/v1/app.apk',
    'https://github.com/jabermuhammad/amar-khata-updates/releases/tag/v1/app.apk',
    'https://github.com/jabermuhammad/amar-khata-updates/releases/download/v1/app.apk?target=evil',
    'https://evil.example/redirect',
  ]) assert.equal(isTrustedApkUrl(url), false);
  assert.throws(() => parseUpdateManifest({ ...valid, apkUrl: 'https://evil.example/app.apk' }));
});

test('snooze decision waits for persistent dismissal before publishing update notice', async () => {
  let releaseRead;
  const readGate = new Promise(resolve => { releaseRead = resolve; });
  let finished = false;
  const decision = resolveUpdateNotice(valid, 2, async () => { await readGate; return JSON.stringify({ versionCode: 3, until: 20_000 }); }, 10_000)
    .then(value => { finished = true; return value; });
  await Promise.resolve();
  assert.equal(finished, false);
  releaseRead();
  assert.deepEqual(await decision, { manifest: parseUpdateManifest(valid), dismissed: true });
});

test('dismissal applies only to its version and expires after seven days', async () => {
  const active = JSON.stringify({ versionCode: 3, until: 20_000 });
  assert.equal((await resolveUpdateNotice(valid, 2, async () => active, 10_000)).dismissed, true);
  assert.equal((await resolveUpdateNotice(valid, 2, async () => active, 20_000)).dismissed, false);
  assert.equal((await resolveUpdateNotice({ ...valid, versionCode: 4 }, 2, async () => active, 10_000)).dismissed, false);
});

test('download metadata must match declared size and SHA-256', () => {
  const manifest = parseUpdateManifest(valid);
  assert.equal(matchesApkMetadata(manifest, valid.sizeBytes, valid.sha256), true);
  assert.equal(matchesApkMetadata(manifest, valid.sizeBytes - 1, valid.sha256), false);
  assert.equal(matchesApkMetadata(manifest, valid.sizeBytes, 'b'.repeat(64)), false);
});
