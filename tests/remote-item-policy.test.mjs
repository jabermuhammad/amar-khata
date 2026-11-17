import assert from 'node:assert/strict';
import test from 'node:test';
import { remoteItemDocumentId } from '../src/lib/remoteItemPolicy.mjs';

test('remote item IDs are stable across retries and safe as Firestore document IDs', () => {
  assert.equal(remoteItemDocumentId(1793729848659), '1793729848659');
  assert.equal(remoteItemDocumentId('client-item-1'), 'client-item-1');
  assert.equal(remoteItemDocumentId(1793729848659), remoteItemDocumentId(1793729848659));
  assert.throws(() => remoteItemDocumentId('bad/item'), /স্থায়ী ID/);
  assert.throws(() => remoteItemDocumentId(''), /স্থায়ী ID/);
});
