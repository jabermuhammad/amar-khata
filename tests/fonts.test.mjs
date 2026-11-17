import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync } from 'node:fs';
import { bytesToBase64 } from '../src/lib/pdfDocument.mjs';

function readFontMetadata(path) {
  const bytes = readFileSync(path);
  const tableCount = bytes.readUInt16BE(4);
  let nameTable;
  let weightClass;
  for (let index = 0; index < tableCount; index += 1) {
    const entry = 12 + index * 16;
    const tag = bytes.toString('ascii', entry, entry + 4);
    const offset = bytes.readUInt32BE(entry + 8);
    if (tag === 'name') nameTable = { offset, length: bytes.readUInt32BE(entry + 12) };
    if (tag === 'OS/2') weightClass = bytes.readUInt16BE(offset + 4);
  }
  assert.ok(nameTable, 'TTF must include a name table');
  const { offset, length } = nameTable;
  const count = bytes.readUInt16BE(offset + 2);
  const storage = offset + bytes.readUInt16BE(offset + 4);
  const names = new Map();
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 6 + index * 12;
    const platform = bytes.readUInt16BE(entry);
    const nameId = bytes.readUInt16BE(entry + 6);
    const size = bytes.readUInt16BE(entry + 8);
    const start = storage + bytes.readUInt16BE(entry + 10);
    if (![1, 2, 6].includes(nameId) || names.has(nameId)) continue;
    const value = bytes.subarray(start, start + size);
    const decoded = platform === 0 || platform === 3
      ? Buffer.from(Array.from({ length: value.length / 2 }, (_, i) => [value[i * 2 + 1], value[i * 2]]).flat()).toString('utf16le')
      : value.toString('latin1');
    names.set(nameId, decoded.replace(/\0/g, ''));
  }
  return { family: names.get(1), subfamily: names.get(2), postscript: names.get(6), weightClass, byteLength: bytes.length, tableLength: length };
}

test('UN Bangla TTF files have the supplied filenames and expected static weights', () => {
  const expected = [
    ['UNBangla-Thin.ttf', 100, /UN Bangla Thin/i],
    ['UNBangla-Regular.ttf', 400, /UN Bangla/i],
    ['UNBangla-Bold.ttf', 700, /UN Bangla/i],
  ];
  for (const [filename, weight, familyPattern] of expected) {
    const metadata = readFontMetadata(new URL(`../assets/fonts/${filename}`, import.meta.url));
    assert.equal(metadata.weightClass, weight, filename);
    assert.match(metadata.family, familyPattern, filename);
    assert.ok(metadata.byteLength > 0 && metadata.tableLength > 0, filename);
  }
});

test('each supplied PDF font can be encoded and round-tripped byte-for-byte for HTML embedding', () => {
  for (const filename of ['UNBangla-Thin.ttf', 'UNBangla-Regular.ttf', 'UNBangla-Bold.ttf']) {
    const original = readFileSync(new URL(`../assets/fonts/${filename}`, import.meta.url));
    const encoded = bytesToBase64(new Uint8Array(original));
    assert.equal(Buffer.from(encoded, 'base64').compare(original), 0, filename);
  }
});

test('all app JSX text and inputs use shared themed primitives, and Expo loads the three correct weights before hiding splash', () => {
  const sourceDir = new URL('../src/', import.meta.url);
  const files = [];
  const visit = (url) => {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, url);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.tsx')) files.push(path);
    }
  };
  visit(sourceDir);
  const uiFiles = files.filter(path => path.pathname.replaceAll('\\', '/').includes('/app/') || path.pathname.replaceAll('\\', '/').includes('/components/'));
  for (const path of uiFiles) {
    const source = readFileSync(path, 'utf8');
    if (path.pathname.endsWith('/ThemePrimitives.tsx')) continue;
    if (/<Text(?:\s|>)/.test(source)) assert.match(source, /ThemedText as Text/, path.pathname);
    if (/<TextInput(?:\s|>)/.test(source)) assert.match(source, /ThemedTextInput as TextInput/, path.pathname);
  }
  const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
  const primitives = readFileSync(new URL('../src/components/ThemePrimitives.tsx', import.meta.url), 'utf8');
  const pdfCenter = readFileSync(new URL('../src/components/PdfCenterModal.tsx', import.meta.url), 'utf8');
  assert.match(layout, /fontFamily: 'UN Bangla'/);
  assert.match(layout, /UNBangla-Thin\.ttf'\), weight: 100/);
  assert.match(layout, /UNBangla-Regular\.ttf'\), weight: 400/);
  assert.match(layout, /UNBangla-Bold\.ttf'\), weight: 700/);
  assert.match(layout, /fontsReady && !loading/);
  assert.match(primitives, /fontFamily: 'UN Bangla'/);
  assert.match(pdfCenter, /Asset\.fromModule\(moduleId\)\.downloadAsync\(\)/);
  assert.match(pdfCenter, /new File\(asset\.localUri\)\.bytes\(\)/);
  assert.match(pdfCenter, /createPdfHtml\(\{[^}]+fonts: pdfFonts/s);
});
