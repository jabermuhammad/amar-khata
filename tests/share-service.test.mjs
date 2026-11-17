import assert from 'node:assert/strict';
import test from 'node:test';
import { shareResourceAtomically, shareToContactsSequentially } from '../src/lib/shareService.mjs';
import { assertConnectionMember, validateSharedPermission } from '../src/lib/contactPolicy.mjs';

function harness({ existing = {} } = {}) {
  const writes = [];
  const doc = (_db, ...segments) => ({ path: segments.join('/') });
  const firestore = {
    doc,
    serverTimestamp: () => 'server-time',
    runTransaction: async (_db, body) => body({
      get: async ref => {
        if (!(ref.path in existing)) return { exists: () => false, data: () => undefined };
        return { exists: () => true, data: () => existing[ref.path] };
      },
      set: (...args) => writes.push(['set', ...args]),
      update: (...args) => writes.push(['update', ...args]),
    }),
  };
  return { firestore, writes };
}

test('first share reads only owner-authorized docs and atomically writes membership, recipient ref and history', async () => {
  const database = {};
  const user = { uid: 'owner' };
  const connectionId = 'owner~recipient';
  const connectionPath = `connections/${connectionId}`;
  const rootPath = 'shoppingLists/list-1';
  const memberPath = 'shoppingLists/list-1/members/recipient';
  const { firestore, writes } = harness({ existing: {
    [connectionPath]: { status: 'active', memberUids: ['owner', 'recipient'] },
    [rootPath]: { ownerUid: 'owner', title: 'বাজার' },
  } });
  const readPaths = [];
  const runTransaction = firestore.runTransaction;
  firestore.runTransaction = (db, callback) => runTransaction(db, tx => callback({
    ...tx,
    get: async ref => { readPaths.push(ref.path); return tx.get(ref); },
  }));
  await shareResourceAtomically({ database, user, connectionId, recipientUid: 'recipient', kind: 'list', resourceId: 'list-1', permission: 'shopper', title: 'বাজার', firestore,
    assertCurrentUser: () => {}, assertConnectionMember, validateSharedPermission });
  assert.deepEqual(new Set(readPaths), new Set([connectionPath, rootPath, memberPath]));
  assert.equal(readPaths.some(path => path.includes('/resourceRefs/')), false);
  assert.equal(writes.filter(([kind]) => kind === 'set').length, 3);
  assert.deepEqual(writes.map(([kind, ref]) => `${kind}:${ref.path}`).sort(), [
    'set:connections/owner~recipient/sharedResources/list-list-1',
    'set:shoppingLists/list-1/members/recipient',
    'set:users/recipient/resourceRefs/list-list-1',
    'update:connections/owner~recipient',
  ].sort());
  const refWrite = writes.find(([, ref]) => ref.path === 'users/recipient/resourceRefs/list-list-1');
  assert.equal(refWrite[3].merge, true);
});

test('share validation failure produces no partial writes', async () => {
  const { firestore, writes } = harness({ existing: { 'connections/owner~recipient': { status: 'active', memberUids: ['owner', 'recipient'] } } });
  await assert.rejects(shareResourceAtomically({ database: {}, user: { uid: 'owner' }, connectionId: 'owner~recipient', recipientUid: 'recipient', kind: 'list', resourceId: 'missing', permission: 'shopper', title: 'x', firestore,
    assertCurrentUser: () => {}, assertConnectionMember, validateSharedPermission }), /সক্রিয় resource/);
  assert.equal(writes.length, 0);
});

test('multi-contact sharing continues after a recipient failure and reports retryable failures', async () => {
  const calls = [];
  const contacts = [
    { connectionId: 'c1', profile: { uid: 'u1', displayName: 'A' } },
    { connectionId: 'c2', profile: { uid: 'u2', displayName: 'B' } },
    { connectionId: 'c2', profile: { uid: 'u2', displayName: 'B' } },
    { connectionId: 'c3', profile: { uid: 'u3', displayName: 'C' } },
  ];
  const result = await shareToContactsSequentially(contacts, async contact => {
    calls.push(contact.connectionId);
    if (contact.connectionId === 'c2') throw new Error('permission denied');
  });
  assert.deepEqual(calls, ['c1', 'c2', 'c3']);
  assert.deepEqual(result.succeeded, ['c1', 'c3']);
  assert.deepEqual(result.failed, [{ connectionId: 'c2', name: 'B', error: 'permission denied' }]);
});
