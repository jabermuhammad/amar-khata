import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationResourceId, sameListContent, sameNoteContent, scopedKey } from '../src/lib/storagePolicy.mjs';

test('guest and account scopes never share local keys', () => {
  const keys = [
    scopedKey({ kind: 'guest', id: 'install-a' }, 'notes'),
    scopedKey({ kind: 'user', uid: 'account-a' }, 'notes'),
    scopedKey({ kind: 'user', uid: 'account-b' }, 'notes'),
  ];
  assert.equal(new Set(keys).size, keys.length);
  const preferenceKeys = [
    scopedKey({ kind: 'guest', id: 'install-a' }, 'preferences'),
    scopedKey({ kind: 'user', uid: 'account-a' }, 'preferences'),
    scopedKey({ kind: 'user', uid: 'account-b' }, 'preferences'),
  ];
  assert.equal(new Set(preferenceKeys).size, preferenceKeys.length);
});

test('migration IDs are repeatable for one source and differ across accounts and guest spaces', () => {
  const id = migrationResourceId('uid-a', 'guest-a', 'note', 'note/1');
  assert.equal(id, migrationResourceId('uid-a', 'guest-a', 'note', 'note/1'));
  assert.notEqual(id, migrationResourceId('uid-b', 'guest-a', 'note', 'note/1'));
  assert.notEqual(id, migrationResourceId('uid-a', 'guest-b', 'note', 'note/1'));
  assert.notEqual(id, migrationResourceId('uid-a', 'guest-a', 'list', 'note/1'));
  assert.ok(!id.includes('/'));
});

test('migration content comparison accepts reordered equivalent items but rejects conflicts', () => {
  const left = { title: 'বাজার', category: 'today', items: [{ id: 2, name: 'মাছ', qty: '১ কেজি', status: 'pending' }, { id: 1, name: 'চাল', qty: '২ কেজি', status: 'purchased', price: 120 }] };
  const same = { ...left, items: [...left.items].reverse() };
  assert.equal(sameListContent(left, same), true);
  assert.equal(sameListContent(left, { ...same, title: 'অন্য তালিকা' }), false);
  assert.equal(sameListContent(left, { ...same, items: [{ ...same.items[0], qty: '৯ কেজি' }, same.items[1]] }), false);
  assert.equal(sameNoteContent({ title: 'নোট', body: 'লেখা' }, { title: 'নোট', body: 'লেখা' }), true);
  assert.equal(sameNoteContent({ title: 'নোট', body: 'লেখা' }, { title: 'নোট', body: 'ভিন্ন' }), false);
});
