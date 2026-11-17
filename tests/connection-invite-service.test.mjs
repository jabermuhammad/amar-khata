import assert from 'node:assert/strict';
import test from 'node:test';
import { persistConnectionInvite } from '../src/lib/connectionInviteService.mjs';

function harness() {
  const docs = new Map();
  const firestore = {
    runTransaction: async (_database, callback) => callback({
      get: async ref => docs.has(ref.id) ? { exists: () => true, data: () => docs.get(ref.id) } : { exists: () => false },
      set: (ref, value) => docs.set(ref.id, value),
      update: (ref, value) => docs.set(ref.id, { ...docs.get(ref.id), ...value }),
    }),
  };
  return { docs, firestore };
}

test('stable connection invite transaction reuses one live pending request and refreshes an expired one', async () => {
  const { docs, firestore } = harness();
  const inviteRef = { id: 'request-owner-recipient' };
  const database = {};
  const invitation = { senderUid: 'owner', recipientUid: 'recipient', status: 'pending', createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) };
  const args = { database, inviteRef, invitation, firestore, assertCurrentUser: () => {} };
  assert.equal(await persistConnectionInvite(args), inviteRef.id);
  assert.equal(await persistConnectionInvite({ ...args, invitation: { ...invitation, senderUsername: 'different retry' } }), inviteRef.id);
  assert.equal(docs.size, 1);
  assert.equal(docs.get(inviteRef.id).senderUsername, undefined);
  docs.set(inviteRef.id, { ...docs.get(inviteRef.id), expiresAt: new Date(Date.now() - 1) });
  await persistConnectionInvite({ ...args, invitation: { ...invitation, expiresAt: new Date(Date.now() + 60_000) } });
  assert.equal(docs.get(inviteRef.id).status, 'pending');
  assert.ok(docs.get(inviteRef.id).expiresAt.getTime() > Date.now());
});

test('accepted connection invite cannot be recreated as pending', async () => {
  const { docs, firestore } = harness();
  const inviteRef = { id: 'request-owner-recipient' };
  docs.set(inviteRef.id, { status: 'accepted', expiresAt: new Date(Date.now() + 60_000) });
  await assert.rejects(persistConnectionInvite({ database: {}, inviteRef, invitation: { status: 'pending' }, firestore, assertCurrentUser: () => {} }), /ইতিমধ্যে আপনার পরিচিতি/);
  assert.equal(docs.get(inviteRef.id).status, 'accepted');
});
