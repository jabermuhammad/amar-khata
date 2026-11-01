import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const projectId = 'amar-khata-firestore-rules-test';
const owner = { uid: 'owner-1', email: 'owner@example.com', email_verified: true };
const shopper = { uid: 'shopper-1', email: 'shopper@example.com', email_verified: true };
const editor = { uid: 'editor-1', email: 'editor@example.com', email_verified: true };
const viewer = { uid: 'viewer-1', email: 'viewer@example.com', email_verified: true };
const outsider = { uid: 'outside-1', email: 'outside@example.com', email_verified: true };
let env;

const asUser = ({ uid, ...tokenOptions }) => env.authenticatedContext(uid, tokenOptions).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'shoppingLists', 'list-1'), { ownerUid: owner.uid, title: 'বাজার', category: 'today', createdAt: new Date().toISOString(), schemaVersion: 1 });
    await setDoc(doc(db, 'shoppingLists/list-1/members', owner.uid), { uid: owner.uid, permission: 'owner' });
    await setDoc(doc(db, 'shoppingLists/list-1/members', shopper.uid), { uid: shopper.uid, permission: 'shopper' });
    await setDoc(doc(db, 'shoppingLists/list-1/members', editor.uid), { uid: editor.uid, permission: 'editor' });
    await setDoc(doc(db, `users/${shopper.uid}/resourceRefs/list-list-1`), { kind: 'list', resourceId: 'list-1', permission: 'shopper' });
    await setDoc(doc(db, `users/${editor.uid}/resourceRefs/list-list-1`), { kind: 'list', resourceId: 'list-1', permission: 'editor' });
    await setDoc(doc(db, 'shoppingLists/list-1/items', 'rice'), { name: 'চাল', qty: '১ কেজি', status: 'pending', createdAt: new Date().toISOString(), updatedBy: owner.uid });
    await setDoc(doc(db, 'notes', 'note-1'), { ownerUid: owner.uid, title: 'নোট', body: 'মূল লেখা', revision: 0, createdAt: new Date().toISOString(), schemaVersion: 1 });
    await setDoc(doc(db, 'notes/note-1/members', owner.uid), { uid: owner.uid, permission: 'owner' });
    await setDoc(doc(db, 'notes/note-1/members', viewer.uid), { uid: viewer.uid, permission: 'viewer' });
    await setDoc(doc(db, 'notes/note-1/members', editor.uid), { uid: editor.uid, permission: 'editor' });
    await setDoc(doc(db, `users/${editor.uid}/resourceRefs/note-note-1`), { kind: 'note', resourceId: 'note-1', permission: 'editor' });
  });
});

after(async () => { await env?.cleanup(); });

test('approved shoppers can change price and purchased state', async () => {
  const db = asUser(shopper);
  const item = doc(db, 'shoppingLists/list-1/items/rice');
  await assertSucceeds(updateDoc(item, { price: 60, updatedBy: shopper.uid, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(item, { status: 'purchased', updatedBy: shopper.uid, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(item, { status: 'pending', updatedBy: shopper.uid, updatedAt: serverTimestamp() }));
});

test('shoppers cannot change core products or list structure', async () => {
  const db = asUser(shopper);
  await assertFails(setDoc(doc(collection(db, 'shoppingLists/list-1/items')), { name: 'তেল', qty: '১ লিটার', status: 'new', updatedBy: shopper.uid }));
  await assertFails(updateDoc(doc(db, 'shoppingLists/list-1/items/rice'), { name: 'বাসমতি চাল', updatedBy: shopper.uid }));
  await assertFails(updateDoc(doc(db, 'shoppingLists/list-1/items/rice'), { qty: '২ কেজি', updatedBy: shopper.uid }));
  await assertFails(deleteDoc(doc(db, 'shoppingLists/list-1/items/rice')));
  await assertFails(updateDoc(doc(db, 'shoppingLists/list-1'), { title: 'অন্য তালিকা' }));
});

test('editors can add and remove shopping items', async () => {
  const db = asUser(editor);
  await assertSucceeds(setDoc(doc(db, 'shoppingLists/list-1/items/oil'), { name: 'তেল', qty: '১ লিটার', status: 'new', updatedBy: editor.uid }));
  await assertSucceeds(updateDoc(doc(db, 'shoppingLists/list-1/items/rice'), { name: 'বাসমতি চাল', updatedBy: editor.uid }));
  await assertSucceeds(deleteDoc(doc(db, 'shoppingLists/list-1/items/oil')));
});

test('note viewers can read but cannot edit; note editors can edit with the next revision', async () => {
  const readerDb = asUser(viewer);
  await assertSucceeds(getDoc(doc(readerDb, 'notes/note-1')));
  await assertFails(updateDoc(doc(readerDb, 'notes/note-1'), { body: 'অন্য লেখা', revision: 1, updatedBy: viewer.uid }));
  const editorDb = asUser(editor);
  await assertSucceeds(updateDoc(doc(editorDb, 'notes/note-1'), { body: 'সম্পাদিত', revision: 1, updatedBy: editor.uid, updatedAt: serverTimestamp() }));
});

test('owners can atomically change a member role and its resource reference', async () => {
  const db = asUser(owner);
  const listBatch = writeBatch(db);
  listBatch.update(doc(db, 'shoppingLists/list-1/members', shopper.uid), { permission: 'editor' });
  listBatch.update(doc(db, `users/${shopper.uid}/resourceRefs/list-list-1`), { permission: 'editor' });
  await assertSucceeds(listBatch.commit());
  assert.equal((await getDoc(doc(db, 'shoppingLists/list-1/members', shopper.uid))).data().permission, 'editor');
  assert.equal((await getDoc(doc(db, `users/${shopper.uid}/resourceRefs/list-list-1`))).data().permission, 'editor');

  const noteBatch = writeBatch(db);
  noteBatch.update(doc(db, 'notes/note-1/members', editor.uid), { permission: 'viewer' });
  noteBatch.update(doc(db, `users/${editor.uid}/resourceRefs/note-note-1`), { permission: 'viewer' });
  await assertSucceeds(noteBatch.commit());
  assert.equal((await getDoc(doc(db, 'notes/note-1/members', editor.uid))).data().permission, 'viewer');
  assert.equal((await getDoc(doc(db, `users/${editor.uid}/resourceRefs/note-note-1`))).data().permission, 'viewer');
  await assertFails(updateDoc(doc(asUser(editor), 'notes/note-1'), { body: 'revoked edit', revision: 1, updatedBy: editor.uid, updatedAt: serverTimestamp() }));

  const restore = writeBatch(db);
  restore.update(doc(db, 'shoppingLists/list-1/members', shopper.uid), { permission: 'shopper' });
  restore.update(doc(db, `users/${shopper.uid}/resourceRefs/list-list-1`), { permission: 'shopper' });
  restore.update(doc(db, 'notes/note-1/members', editor.uid), { permission: 'editor' });
  restore.update(doc(db, `users/${editor.uid}/resourceRefs/note-note-1`), { permission: 'editor' });
  await assertSucceeds(restore.commit());
  await assertFails(setDoc(doc(asUser(shopper), 'shoppingLists/list-1/items/revoked-structure'), { name: 'নিজে যোগ', qty: '১টি', status: 'new', updatedBy: shopper.uid }));
});

test('role updates fail for non-owners or when the member and resource reference do not match', async () => {
  const nonOwnerDb = asUser(editor);
  const forgedBatch = writeBatch(nonOwnerDb);
  forgedBatch.update(doc(nonOwnerDb, 'shoppingLists/list-1/members', shopper.uid), { permission: 'editor' });
  forgedBatch.update(doc(nonOwnerDb, `users/${shopper.uid}/resourceRefs/list-list-1`), { permission: 'editor' });
  await assertFails(forgedBatch.commit());
  await assertFails(updateDoc(doc(asUser(shopper), `users/${shopper.uid}/resourceRefs/list-list-1`), { permission: 'editor' }));

  const ownerDb = asUser(owner);
  await assertFails(updateDoc(doc(ownerDb, `users/${shopper.uid}/resourceRefs/list-list-1`), { permission: 'editor' }));
  const missingReferenceWrite = writeBatch(ownerDb);
  missingReferenceWrite.update(doc(ownerDb, 'shoppingLists/list-1/members', shopper.uid), { permission: 'editor' });
  await assertFails(missingReferenceWrite.commit());

  const missingMemberWrite = writeBatch(ownerDb);
  missingMemberWrite.update(doc(ownerDb, `users/${shopper.uid}/resourceRefs/list-list-1`), { permission: 'editor' });
  await assertFails(missingMemberWrite.commit());

  const mismatchedBatch = writeBatch(ownerDb);
  mismatchedBatch.update(doc(ownerDb, 'shoppingLists/list-1/members', shopper.uid), { permission: 'editor' });
  mismatchedBatch.update(doc(ownerDb, `users/${shopper.uid}/resourceRefs/list-list-1`), { permission: 'shopper' });
  await assertFails(mismatchedBatch.commit());
});

test('members can read their own membership but only owners can list collaborators', async () => {
  const shopperDb = asUser(shopper);
  await assertSucceeds(getDoc(doc(shopperDb, 'shoppingLists/list-1/members', shopper.uid)));
  await assertFails(getDoc(doc(shopperDb, 'shoppingLists/list-1/members', editor.uid)));
  await assertFails(getDocs(collection(shopperDb, 'shoppingLists/list-1/members')));
  await assertSucceeds(getDocs(collection(asUser(owner), 'shoppingLists/list-1/members')));
});

test('uninvited accounts cannot read shared documents', async () => {
  const db = asUser(outsider);
  await assertFails(getDoc(doc(db, 'shoppingLists/list-1')));
  await assertFails(getDoc(doc(db, 'notes/note-1')));
});

test('an invited verified email can accept once and receives a shared reference', async () => {
  const inviteCode = 'invite-1';
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'invites', inviteCode), {
      kind: 'list', resourceId: 'list-1', ownerUid: owner.uid,
      targetEmail: shopper.email, permission: 'shopper', status: 'pending',
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });
  const db = asUser({ ...shopper, uid: 'new-shopper', email: 'shopper@example.com' });
  const newUid = 'new-shopper';
  await assertSucceeds(runTransaction(db, async transaction => {
    const invite = doc(db, 'invites', inviteCode);
    const inviteSnap = await transaction.get(invite);
    assert.equal(inviteSnap.exists(), true);
    const member = doc(db, 'shoppingLists/list-1/members', newUid);
    const ref = doc(db, `users/${newUid}/resourceRefs/list-list-1`);
    const [memberSnap, refSnap] = await Promise.all([transaction.get(member), transaction.get(ref)]);
    assert.equal(memberSnap.exists(), false);
    assert.equal(refSnap.exists(), false);
    transaction.set(member, { uid: newUid, permission: 'shopper', email: 'shopper@example.com', joinedAt: serverTimestamp(), inviteId: inviteCode });
    transaction.set(ref, { kind: 'list', resourceId: 'list-1', permission: 'shopper', createdAt: serverTimestamp() });
    transaction.update(invite, { status: 'accepted', acceptedBy: newUid, acceptedAt: serverTimestamp() });
  }));
  await assertSucceeds(getDoc(doc(db, `users/${newUid}/resourceRefs/list-list-1`)));
});

test('stale invites cannot create memberships or references after a list or note is deleted', async () => {
  const inviteCode = 'stale-list-invite';
  const staleUid = 'stale-list-user';
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'shoppingLists/deleted-list'), { ownerUid: owner.uid, title: 'পুরোনো তালিকা' });
    await setDoc(doc(db, 'shoppingLists/deleted-list/members', owner.uid), { uid: owner.uid, permission: 'owner' });
    await setDoc(doc(db, 'invites', inviteCode), {
      kind: 'list', resourceId: 'deleted-list', ownerUid: owner.uid,
      targetEmail: 'stale@example.com', permission: 'editor', status: 'pending',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await setDoc(doc(db, 'notes/deleted-note'), { ownerUid: owner.uid, title: 'পুরোনো নোট', body: '', revision: 0 });
    await setDoc(doc(db, 'notes/deleted-note/members', owner.uid), { uid: owner.uid, permission: 'owner' });
    await setDoc(doc(db, 'invites/stale-note-invite'), {
      kind: 'note', resourceId: 'deleted-note', ownerUid: owner.uid,
      targetEmail: 'stale@example.com', permission: 'editor', status: 'pending',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  const ownerDb = asUser(owner);
  const removeRoots = writeBatch(ownerDb);
  removeRoots.update(doc(ownerDb, 'shoppingLists/deleted-list'), { deleting: true });
  removeRoots.update(doc(ownerDb, 'notes/deleted-note'), { deleting: true });
  await assertSucceeds(removeRoots.commit());
  const deleteRoots = writeBatch(ownerDb);
  deleteRoots.delete(doc(ownerDb, 'shoppingLists/deleted-list'));
  deleteRoots.delete(doc(ownerDb, 'shoppingLists/deleted-list/members', owner.uid));
  deleteRoots.delete(doc(ownerDb, 'notes/deleted-note'));
  deleteRoots.delete(doc(ownerDb, 'notes/deleted-note/members', owner.uid));
  await assertSucceeds(deleteRoots.commit());

  const listDb = asUser({ uid: staleUid, email: 'stale@example.com', email_verified: true });
  await assertFails(runTransaction(listDb, async transaction => {
    const invite = doc(listDb, 'invites', inviteCode);
    await transaction.get(invite);
    transaction.set(doc(listDb, 'shoppingLists/deleted-list/members', staleUid), {
      uid: staleUid, permission: 'editor', email: 'stale@example.com', inviteId: inviteCode,
    });
    transaction.set(doc(listDb, `users/${staleUid}/resourceRefs/list-deleted-list`), {
      kind: 'list', resourceId: 'deleted-list', permission: 'editor',
    });
    transaction.update(invite, { status: 'accepted', acceptedBy: staleUid, acceptedAt: serverTimestamp() });
  }));
  await assertFails(runTransaction(listDb, async transaction => {
    const invite = doc(listDb, 'invites/stale-note-invite');
    await transaction.get(invite);
    transaction.set(doc(listDb, 'notes/deleted-note/members', staleUid), {
      uid: staleUid, permission: 'editor', email: 'stale@example.com', inviteId: 'stale-note-invite',
    });
    transaction.set(doc(listDb, `users/${staleUid}/resourceRefs/note-deleted-note`), {
      kind: 'note', resourceId: 'deleted-note', permission: 'editor',
    });
    transaction.update(invite, { status: 'accepted', acceptedBy: staleUid, acceptedAt: serverTimestamp() });
  }));
});

test('orphan editor membership cannot create items without an existing active list root', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'shoppingLists/orphan-list/members', editor.uid), {
      uid: editor.uid, permission: 'editor',
    });
  });
  const editorDb = asUser(editor);
  await assertFails(setDoc(doc(editorDb, 'shoppingLists/orphan-list/items/orphan-item'), {
    name: 'আটা', qty: '১ কেজি', status: 'new', updatedBy: editor.uid,
  }));
});

test('owner deletion lock rejects new invites and clears pending invites before deleting resource', async () => {
  const inviteId = 'pending-delete-invite';
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'invites', inviteId), {
      kind: 'list', resourceId: 'list-1', ownerUid: owner.uid,
      targetEmail: 'future@example.com', permission: 'shopper', status: 'pending',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });
  const db = asUser(owner);
  await assertSucceeds(updateDoc(doc(db, 'shoppingLists/list-1'), { deleting: true }));
  await assertFails(setDoc(doc(db, 'invites/new-during-delete'), {
    kind: 'list', resourceId: 'list-1', ownerUid: owner.uid,
    targetEmail: 'another@example.com', permission: 'shopper', status: 'pending',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  }));
  await assertSucceeds(deleteDoc(doc(db, 'invites', inviteId)));
  await env.withSecurityRulesDisabled(async context => {
    assert.equal((await getDoc(doc(context.firestore(), 'invites', inviteId))).exists(), false);
  });
});

test('owner creation batch can atomically create a list, owner membership, item and reference', async () => {
  const db = asUser(owner);
  const batch = writeBatch(db);
  const id = 'created-together';
  const now = serverTimestamp();
  batch.set(doc(db, 'shoppingLists', id), { ownerUid: owner.uid, title: 'নতুন তালিকা', category: 'today', createdAt: new Date().toISOString(), updatedAt: now, schemaVersion: 1 });
  batch.set(doc(db, `shoppingLists/${id}/members`, owner.uid), { uid: owner.uid, permission: 'owner', joinedAt: now });
  batch.set(doc(db, `users/${owner.uid}/resourceRefs/list-${id}`), { kind: 'list', resourceId: id, permission: 'owner', createdAt: now });
  batch.set(doc(db, `shoppingLists/${id}/items`, 'sample'), { name: 'আটা', qty: '১ কেজি', status: 'new', createdAt: now, updatedAt: now, updatedBy: owner.uid });
  await assertSucceeds(batch.commit());
});

test('owner can delete a resource root only together with their owner membership', async () => {
  const db = asUser(owner);
  await assertSucceeds(updateDoc(doc(db, 'shoppingLists/list-1'), { deleting: true }));
  await assertFails(setDoc(doc(asUser(editor), 'shoppingLists/list-1/items/late-item'), {
    name: 'তেল', qty: '১ লিটার', status: 'new', updatedBy: editor.uid,
  }));
  await assertSucceeds(deleteDoc(doc(db, 'shoppingLists/list-1/items/rice')));
  const incomplete = writeBatch(db);
  incomplete.delete(doc(db, 'shoppingLists/list-1'));
  await assertFails(incomplete.commit());
  const complete = writeBatch(db);
  complete.delete(doc(db, 'shoppingLists/list-1'));
  complete.delete(doc(db, `shoppingLists/list-1/members/${owner.uid}`));
  await assertSucceeds(complete.commit());
  await assertFails(getDoc(doc(asUser(editor), 'shoppingLists/list-1/items/rice')));
});
