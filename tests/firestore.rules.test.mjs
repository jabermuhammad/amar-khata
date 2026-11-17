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
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { createOwnedListInFirestore, createOwnedNoteInFirestore, loadResourceSummariesFromFirestore } from '../src/lib/ownedResourceService.mjs';
import { sameListContent, sameNoteContent } from '../src/lib/storagePolicy.mjs';
import { permissionForResourceSummary } from '../src/lib/collaborationPolicy.mjs';
import { shareResourceAtomically } from '../src/lib/shareService.mjs';
import { persistConnectionInvite } from '../src/lib/connectionInviteService.mjs';
import { assertConnectionMember, validateSharedPermission } from '../src/lib/contactPolicy.mjs';

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
  // Repeated local runs share the same emulator project. Start from a clean
  // fake-project database so stale fixtures cannot change test classifications.
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'shoppingLists', 'list-1'), { ownerUid: owner.uid, title: 'বাজার', category: 'today', createdAt: new Date().toISOString(), schemaVersion: 1 });
    await setDoc(doc(db, 'shoppingLists/list-1/members', owner.uid), { uid: owner.uid, permission: 'owner' });
    await setDoc(doc(db, 'shoppingLists/list-1/members', shopper.uid), { uid: shopper.uid, permission: 'shopper' });
    await setDoc(doc(db, 'shoppingLists/list-1/members', editor.uid), { uid: editor.uid, permission: 'editor' });
    await setDoc(doc(db, `users/${shopper.uid}/resourceRefs/list-list-1`), { kind: 'list', resourceId: 'list-1', permission: 'shopper' });
    await setDoc(doc(db, `users/${editor.uid}/resourceRefs/list-list-1`), { kind: 'list', resourceId: 'list-1', permission: 'editor' });
    await setDoc(doc(db, 'shoppingLists/list-1/items', 'rice'), { name: 'চাল', qty: '১ কেজি', status: 'pending', revision: 0, createdAt: new Date().toISOString(), updatedBy: owner.uid });
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
  await assertSucceeds(updateDoc(item, { price: 60, revision: 1, updatedBy: shopper.uid, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(item, { status: 'purchased', revision: 2, updatedBy: shopper.uid, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(item, { status: 'pending', revision: 3, updatedBy: shopper.uid, updatedAt: serverTimestamp() }));
});

test('item revision rules reject a stale collaborator write after another update', async () => {
  const ownerDb = asUser(owner);
  const item = doc(ownerDb, 'shoppingLists/list-1/items/revision-guard');
  await assertSucceeds(setDoc(item, { name: 'চাল', qty: '১ কেজি', status: 'pending', revision: 0, updatedBy: owner.uid }));
  const shopperItem = doc(asUser(shopper), 'shoppingLists/list-1/items/revision-guard');
  await assertSucceeds(updateDoc(shopperItem, { status: 'purchased', revision: 1, updatedBy: shopper.uid, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(shopperItem, { status: 'pending', revision: 1, updatedBy: shopper.uid, updatedAt: serverTimestamp() }));
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
  await assertSucceeds(updateDoc(doc(db, 'shoppingLists/list-1/items/rice'), { name: 'বাসমতি চাল', revision: 4, updatedBy: editor.uid }));
  await assertSucceeds(deleteDoc(doc(db, 'shoppingLists/list-1/items/oil')));
});

test('item revision is mandatory and monotonic; legacy items can first advance to revision 1', async () => {
  const ownerDb = asUser(owner);
  const editorDb = asUser(editor);
  const shopperDb = asUser(shopper);
  const legacy = doc(ownerDb, 'shoppingLists/list-1/items/legacy-revision');
  await assertSucceeds(setDoc(legacy, { name: 'ডাল', qty: '১ কেজি', status: 'pending', updatedBy: owner.uid }));
  const editorLegacy = doc(editorDb, 'shoppingLists/list-1/items/legacy-revision');
  await assertFails(updateDoc(editorLegacy, { name: 'মসুর ডাল', updatedBy: editor.uid }));
  await assertFails(updateDoc(editorLegacy, { name: 'মসুর ডাল', revision: 0, updatedBy: editor.uid }));
  await assertSucceeds(updateDoc(editorLegacy, { name: 'মসুর ডাল', revision: 1, updatedBy: editor.uid }));
  await assertFails(updateDoc(editorLegacy, { name: 'মসুর ডাল লাল', revision: 1, updatedBy: editor.uid }));
  await assertFails(updateDoc(editorLegacy, { revision: deleteField(), updatedBy: editor.uid }));

  const shopperLegacy = doc(ownerDb, 'shoppingLists/list-1/items/legacy-shopper-revision');
  await assertSucceeds(setDoc(shopperLegacy, { name: 'তেল', qty: '১ লিটার', status: 'pending', updatedBy: owner.uid }));
  const shopperItem = doc(shopperDb, 'shoppingLists/list-1/items/legacy-shopper-revision');
  await assertSucceeds(updateDoc(shopperItem, { status: 'purchased', revision: 1, updatedBy: shopper.uid }));
  await assertFails(updateDoc(shopperItem, { status: 'pending', revision: deleteField(), updatedBy: shopper.uid }));
});

test('legacy note first edit advances revision and revision cannot be removed', async () => {
  const editorDb = asUser(editor);
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'notes/legacy-note-revision'), { ownerUid: owner.uid, title: 'পুরোনো', body: 'খসড়া' });
    await setDoc(doc(db, 'notes/legacy-note-revision/members', editor.uid), { uid: editor.uid, permission: 'editor' });
  });
  const editorNote = doc(editorDb, 'notes/legacy-note-revision');
  await assertFails(updateDoc(editorNote, { body: 'বদল', updatedBy: editor.uid }));
  await assertSucceeds(updateDoc(editorNote, { body: 'বদল', revision: 1, updatedBy: editor.uid }));
  await assertFails(updateDoc(editorNote, { revision: deleteField(), updatedBy: editor.uid }));
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

test('service share creation succeeds without reading a missing root; retry is idempotent and conflicts fail closed', async () => {
  const db = asUser(owner);
  const id = 'service-share-list';
  const list = { title: 'সাপ্তাহিক বাজার', category: 'today', items: [{ id: 'rice', name: 'চাল', qty: '২ কেজি', status: 'new' }] };
  await assertFails(getDoc(doc(db, 'shoppingLists', id)));
  const firestore = { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch };
  assert.equal(await createOwnedListInFirestore({ database: db, user: owner, list, id, firestore, sameListContent }), id);
  assert.equal(await createOwnedListInFirestore({ database: db, user: owner, list, id, firestore, sameListContent }), id);
  assert.equal((await getDocs(collection(db, `shoppingLists/${id}/items`))).size, 1);
  await assert.rejects(createOwnedListInFirestore({ database: db, user: owner, list: { ...list, title: 'অন্য শিরোনাম' }, id, firestore, sameListContent }), /ভিন্ন/);
  assert.equal((await getDoc(doc(db, 'shoppingLists', id))).data().title, list.title);
  const inviteId = 'service-share-invite';
  await assertSucceeds(setDoc(doc(db, 'invites', inviteId), {
    kind: 'list', resourceId: id, ownerUid: owner.uid, targetEmail: 'friend@example.com', permission: 'shopper',
    status: 'pending', createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 60_000),
  }));
});

test('service note creation and migration-style stable-ID retry create one owned resource', async () => {
  const db = asUser(owner);
  const id = 'guestcopy-owner-1-guest-a-note-original-1';
  const note = { id: 'original-1', title: 'স্থানান্তরিত নোট', body: 'বাংলা লেখা' };
  const firestore = { collection, doc, getDoc, serverTimestamp, writeBatch };
  await assertFails(getDoc(doc(db, 'notes', id)));
  assert.equal(await createOwnedNoteInFirestore({ database: db, user: owner, note, id, firestore, sameNoteContent }), id);
  assert.equal(await createOwnedNoteInFirestore({ database: db, user: owner, note, id, firestore, sameNoteContent }), id);
  assert.equal((await getDoc(doc(db, 'notes', id))).data().body, note.body);
  await assert.rejects(createOwnedNoteInFirestore({ database: db, user: owner, note: { ...note, body: 'conflict' }, id, firestore, sameNoteContent }), /ভিন্ন/);
});

test('one stale reference does not hide valid cloud resources and references are never removed', async () => {
  const validId = 'summary-valid';
  const missingRootId = 'summary-missing-root';
  const staleMembershipId = 'summary-stale-membership';
  const inactiveId = 'summary-inactive';
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const now = new Date();
    await setDoc(doc(db, 'shoppingLists', validId), { ownerUid: owner.uid, title: 'বৈধ তালিকা', category: 'today', createdAt: now, schemaVersion: 1 });
    await setDoc(doc(db, `shoppingLists/${validId}/members`, owner.uid), { uid: owner.uid, permission: 'owner' });
    await setDoc(doc(db, `users/${owner.uid}/resourceRefs/list-${validId}`), { kind: 'list', resourceId: validId, permission: 'owner', createdAt: now });
    await setDoc(doc(db, `shoppingLists/${missingRootId}/members`, owner.uid), { uid: owner.uid, permission: 'owner' });
    await setDoc(doc(db, `users/${owner.uid}/resourceRefs/list-${missingRootId}`), { kind: 'list', resourceId: missingRootId, permission: 'owner', createdAt: now });
    await setDoc(doc(db, `users/${owner.uid}/resourceRefs/list-${staleMembershipId}`), { kind: 'list', resourceId: staleMembershipId, permission: 'editor', createdAt: now });
    await setDoc(doc(db, 'shoppingLists', inactiveId), { ownerUid: owner.uid, title: 'বন্ধ তালিকা', category: 'today', createdAt: now, deleting: true, schemaVersion: 1 });
    await setDoc(doc(db, `shoppingLists/${inactiveId}/members`, owner.uid), { uid: owner.uid, permission: 'owner' });
    await setDoc(doc(db, `users/${owner.uid}/resourceRefs/list-${inactiveId}`), { kind: 'list', resourceId: inactiveId, permission: 'owner', createdAt: now });
  });
  const db = asUser(owner);
  const result = await loadResourceSummariesFromFirestore({ database: db, uid: owner.uid, firestore: { collection, doc, getDoc, getDocs, orderBy, query }, permissionForSummary: permissionForResourceSummary });
  assert.ok(result.summaries.some(value => value.id === validId));
  // Firestore Rules intentionally make a missing root unreadable: listActive
  // and listOwner both require exists(root), so the SDK returns permission-denied
  // instead of an exists() == false snapshot. The app must preserve that fact.
  assert.ok(result.issues.some(issue => issue.resourceId === missingRootId
    && issue.operation === 'resource-root-read' && issue.reason === 'permission-denied' && issue.code === 'permission-denied'));
  assert.ok(result.issues.some(issue => issue.resourceId === staleMembershipId && issue.reason === 'missing-membership'));
  assert.ok(result.issues.some(issue => issue.resourceId === inactiveId && issue.reason === 'inactive-resource'));
  await env.withSecurityRulesDisabled(async context => {
    assert.equal((await getDoc(doc(context.firestore(), `users/${owner.uid}/resourceRefs/list-${staleMembershipId}`))).exists(), true);
    assert.equal((await getDoc(doc(context.firestore(), `users/${owner.uid}/resourceRefs/list-${missingRootId}`))).exists(), true);
  });
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

test('username claims stay unique and the public profile schema excludes private fields', async () => {
  const db = asUser(owner);
  const batch = writeBatch(db);
  batch.set(doc(db, 'userProfiles', owner.uid), { uid: owner.uid, username: 'owner_one', usernameKey: 'owner_one', displayName: 'Owner One', createdAt: serverTimestamp() });
  batch.set(doc(db, 'usernames', 'owner_one'), { uid: owner.uid, username: 'owner_one', createdAt: serverTimestamp() });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(asUser(shopper), 'userProfiles', owner.uid)));
  await assertFails(setDoc(doc(db, 'userProfiles', owner.uid), { uid: owner.uid, username: 'owner_one', usernameKey: 'owner_one', displayName: 'Owner One', email: owner.email, createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(asUser(shopper), 'usernames', 'owner_one'), { uid: shopper.uid, username: 'owner_one', createdAt: serverTimestamp() }));
});

test('connection acceptance requires recipient consent; actual share transaction supports first and repeated share and rolls back failures', async () => {
  const ownerDb = asUser(owner);
  const recipientDb = asUser(shopper);
  const inviteId = 'request-owner-1-shopper-1';
  const connectionId = [owner.uid, shopper.uid].sort().join('~');
  await assertSucceeds(setDoc(doc(ownerDb, 'connectionInvites', inviteId), {
    senderUid: owner.uid, senderUsername: 'owner_one', recipientUid: shopper.uid, status: 'pending', createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 60_000),
  }));
  await assertFails(setDoc(doc(asUser(outsider), 'connections', connectionId), {
    memberUids: [owner.uid, outsider.uid].sort(), status: 'active', inviteId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(recipientDb, 'connectionInvites', inviteId), {
    status: 'accepted', acceptedBy: shopper.uid, acceptedAt: serverTimestamp(), connectionId,
  }));
  await assertSucceeds(setDoc(doc(recipientDb, 'connections', connectionId), {
    memberUids: [owner.uid, shopper.uid].sort(), status: 'active', inviteId,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));

  const listId = 'contact-shared-list';
  const list = { title: 'দুই account-এর তালিকা', category: 'today', items: [{ id: 'rice', name: 'চাল', qty: '১ কেজি', status: 'new' }] };
  const create = { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch };
  await createOwnedListInFirestore({ database: ownerDb, user: owner, list, id: listId, firestore: create, sameListContent });
  const shareArgs = { database: ownerDb, user: owner, connectionId, recipientUid: shopper.uid, kind: 'list', resourceId: listId, permission: 'shopper', title: list.title,
    firestore: { doc, runTransaction, serverTimestamp }, assertCurrentUser: () => {}, assertConnectionMember, validateSharedPermission };
  assert.equal(await shareResourceAtomically(shareArgs), listId);
  assert.equal(await shareResourceAtomically(shareArgs), listId);
  await assertFails(shareResourceAtomically({ ...shareArgs, connectionId: 'missing-connection', recipientUid: outsider.uid }));
  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore();
    assert.equal((await getDoc(doc(adminDb, `shoppingLists/${listId}/members/${outsider.uid}`))).exists(), false);
    assert.equal((await getDoc(doc(adminDb, `users/${outsider.uid}/resourceRefs/list-${listId}`))).exists(), false);
  });
  await assertSucceeds(getDoc(doc(recipientDb, `shoppingLists/${listId}`)));
  await assertSucceeds(getDocs(collection(recipientDb, `shoppingLists/${listId}/items`)));
  await assertFails(updateDoc(doc(recipientDb, `shoppingLists/${listId}`), { title: 'shopper cannot rename' }));
  await assertFails(setDoc(doc(recipientDb, 'connections/forged'), { memberUids: [shopper.uid, outsider.uid], status: 'active', inviteId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));

  const noteId = 'contact-shared-note';
  const note = { title: 'ব্যক্তিগত নোট', body: 'শুধু অনুমতিতে শেয়ার', revision: 0 };
  await createOwnedNoteInFirestore({ database: ownerDb, user: owner, note, id: noteId, firestore: create, sameNoteContent });
  await shareResourceAtomically({ ...shareArgs, kind: 'note', resourceId: noteId, permission: 'viewer', title: note.title });
  await assertSucceeds(getDoc(doc(recipientDb, `notes/${noteId}`)));
  await assertFails(updateDoc(doc(recipientDb, `notes/${noteId}`), { body: 'viewer cannot edit', revision: 1, updatedBy: shopper.uid }));
});

test('actual connection invite transaction serializes duplicate sends and refreshes expired requests', async () => {
  const db = asUser(owner);
  const inviteRef = doc(db, 'connectionInvites', 'request-owner-1-transaction-recipient');
  const makeInvitation = () => ({ senderUid: owner.uid, senderUsername: 'owner_one', recipientUid: 'transaction-recipient', status: 'pending', createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 - 60_000) });
  const args = { database: db, inviteRef, invitation: makeInvitation(), firestore: { runTransaction }, assertCurrentUser: () => {} };
  assert.equal((await getDoc(inviteRef)).exists(), false);
  const concurrent = await Promise.all([persistConnectionInvite(args), persistConnectionInvite({ ...args, invitation: makeInvitation() })]);
  assert.deepEqual(concurrent, [inviteRef.id, inviteRef.id]);
  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'connectionInvites', inviteRef.id), { expiresAt: new Date(Date.now() - 1) });
  });
  const renewed = await persistConnectionInvite({ ...args, invitation: makeInvitation() });
  assert.equal(renewed, inviteRef.id);
  const refreshed = await getDoc(inviteRef);
  assert.ok(refreshed.data().expiresAt.toMillis() > Date.now());
});

test('recipient can reject a live invite and sender retry reopens the same deterministic request', async () => {
  const inviteId = 'request-owner-1-outside-1';
  const ownerDb = asUser(owner);
  const recipientDb = asUser(outsider);
  await assertSucceeds(setDoc(doc(ownerDb, 'connectionInvites', inviteId), {
    senderUid: owner.uid, senderUsername: 'owner_one', recipientUid: outsider.uid, status: 'pending', createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 60_000),
  }));
  await assertSucceeds(updateDoc(doc(recipientDb, 'connectionInvites', inviteId), { status: 'declined', declinedAt: serverTimestamp() }));
  const invitation = { senderUid: owner.uid, senderUsername: 'owner_one', recipientUid: outsider.uid, status: 'pending', createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 - 60_000) };
  assert.equal(await persistConnectionInvite({ database: ownerDb, inviteRef: doc(ownerDb, 'connectionInvites', inviteId), invitation, firestore: { runTransaction }, assertCurrentUser: () => {} }), inviteId);
  assert.equal((await getDoc(doc(ownerDb, 'connectionInvites', inviteId))).data().status, 'pending');
});

test('connection invite rules support optional UID/email recipient fields without granting unrelated access', async () => {
  const ownerDb = asUser(owner);
  const unrelatedDb = asUser(viewer);
  // The earlier connection-acceptance test leaves its owner/shopper invite
  // accepted in this shared emulator database; use a distinct valid UID target.
  const optionalUidRecipient = { uid: 'optional-recipient-1', email: 'optional-recipient@example.com', email_verified: true };
  const uidInviteId = `request-${owner.uid}-${optionalUidRecipient.uid}`;
  const senderMissingInvite = await getDoc(doc(ownerDb, 'connectionInvites', 'request-owner-1-not-created-yet'));
  assert.equal(senderMissingInvite.exists(), false);
  await assertFails(getDoc(doc(unrelatedDb, 'connectionInvites', 'request-owner-1-not-created-yet')));
  await assertSucceeds(setDoc(doc(ownerDb, 'connectionInvites', uidInviteId), {
    senderUid: owner.uid, senderUsername: 'owner_one', recipientUid: optionalUidRecipient.uid, status: 'pending',
    createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 60_000),
  }));
  await assertFails(getDoc(doc(unrelatedDb, 'connectionInvites', uidInviteId)));
  const uidRecipientDb = asUser(optionalUidRecipient);
  await assertSucceeds(getDoc(doc(uidRecipientDb, 'connectionInvites', uidInviteId)));
  const uidConnectionId = [owner.uid, optionalUidRecipient.uid].sort().join('~');
  await assertFails(updateDoc(doc(unrelatedDb, 'connectionInvites', uidInviteId), {
    status: 'accepted', acceptedBy: viewer.uid, acceptedAt: serverTimestamp(), connectionId: [owner.uid, viewer.uid].sort().join('~'),
  }));
  await assertSucceeds(updateDoc(doc(uidRecipientDb, 'connectionInvites', uidInviteId), {
    status: 'accepted', acceptedBy: optionalUidRecipient.uid, acceptedAt: serverTimestamp(), connectionId: uidConnectionId,
  }));
  await assertSucceeds(setDoc(doc(uidRecipientDb, 'connections', uidConnectionId), {
    memberUids: [owner.uid, optionalUidRecipient.uid].sort(), status: 'active', inviteId: uidInviteId,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(ownerDb, 'connectionInvites', 'request-owner-1-both-targets'), {
    senderUid: owner.uid, senderUsername: 'owner_one', recipientUid: shopper.uid, recipientEmail: shopper.email,
    status: 'pending', createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 60_000),
  }));
  await assertFails(setDoc(doc(ownerDb, 'connectionInvites', 'request-owner-1-no-target'), {
    senderUid: owner.uid, senderUsername: 'owner_one', status: 'pending',
    createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 60_000),
  }));

  const emailInviteId = 'request-owner-1-outside@example.com';
  await assertSucceeds(setDoc(doc(ownerDb, 'connectionInvites', emailInviteId), {
    senderUid: owner.uid, senderUsername: 'owner_one', recipientEmail: outsider.email, status: 'pending',
    createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 60_000),
  }));
  const recipientDb = asUser(outsider);
  await assertSucceeds(getDoc(doc(recipientDb, 'connectionInvites', emailInviteId)));
  const connectionId = [owner.uid, outsider.uid].sort().join('~');
  await assertSucceeds(updateDoc(doc(recipientDb, 'connectionInvites', emailInviteId), {
    status: 'accepted', acceptedBy: outsider.uid, acceptedAt: serverTimestamp(), connectionId,
  }));
  await assertFails(setDoc(doc(recipientDb, 'connections', connectionId), {
    memberUids: [owner.uid, outsider.uid].sort(), status: 'active', inviteId: 'wrong-invite',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  assert.equal((await getDoc(doc(recipientDb, 'connectionInvites', emailInviteId))).data().status, 'accepted');
  await assertSucceeds(setDoc(doc(recipientDb, 'connections', connectionId), {
    memberUids: [owner.uid, outsider.uid].sort(), status: 'active', inviteId: emailInviteId,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(recipientDb, 'connections', connectionId), {
    memberUids: [owner.uid, outsider.uid].sort(), status: 'active', inviteId: emailInviteId,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));

  // Recipient consent can commit independently; creating the canonical
  // connection afterward must remain retryable without a rules cycle.
  const retryInviteId = `request-${viewer.uid}-${outsider.email}`;
  await assertSucceeds(setDoc(doc(unrelatedDb, 'connectionInvites', retryInviteId), {
    senderUid: viewer.uid, senderUsername: 'viewer_one', recipientEmail: outsider.email, status: 'pending',
    createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 60_000),
  }));
  const retryConnectionId = [viewer.uid, outsider.uid].sort().join('~');
  await assertSucceeds(updateDoc(doc(recipientDb, 'connectionInvites', retryInviteId), {
    status: 'accepted', acceptedBy: outsider.uid, acceptedAt: serverTimestamp(), connectionId: retryConnectionId,
  }));
  await assertSucceeds(setDoc(doc(recipientDb, 'connections', retryConnectionId), {
    memberUids: [viewer.uid, outsider.uid].sort(), status: 'active', inviteId: retryInviteId,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));

  const refreshEmail = viewer.email;
  const refreshInviteId = `request-${owner.uid}-${refreshEmail}`;
  const refreshInviteRef = doc(ownerDb, 'connectionInvites', refreshInviteId);
  await assertSucceeds(setDoc(refreshInviteRef, {
    senderUid: owner.uid, senderUsername: 'owner_one', recipientEmail: refreshEmail, status: 'pending',
    createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 60_000),
  }));
  await assertSucceeds(updateDoc(doc(asUser(viewer), 'connectionInvites', refreshInviteId), {
    status: 'declined', declinedAt: serverTimestamp(),
  }));
  const refreshedId = await persistConnectionInvite({
    database: ownerDb,
    inviteRef: refreshInviteRef,
    invitation: {
      senderUid: owner.uid, senderUsername: 'owner_one', recipientEmail: refreshEmail, status: 'pending',
      createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 - 60_000),
    },
    firestore: { runTransaction },
    assertCurrentUser: () => {},
  });
  assert.equal(refreshedId, refreshInviteId);
  assert.equal((await getDoc(refreshInviteRef)).data().recipientEmail, refreshEmail);
});

test('connection invite expiry is enforced by Rules for creation and acceptance', async () => {
  const senderDb = asUser(owner);
  await assertFails(setDoc(doc(senderDb, 'connectionInvites', 'request-owner-1-expiry-target'), {
    senderUid: owner.uid, senderUsername: 'owner_one', recipientUid: 'expiry-target', status: 'pending', createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
  }));
  const inviteId = 'expired-consent';
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'connectionInvites', inviteId), {
      senderUid: owner.uid, senderUsername: 'owner_one', recipientUid: shopper.uid, status: 'pending', createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), expiresAt: new Date(Date.now() - 1),
    });
  });
  const recipientDb = asUser(shopper);
  const connectionId = [owner.uid, shopper.uid].sort().join('~');
  await assertFails(updateDoc(doc(recipientDb, 'connectionInvites', inviteId), {
    status: 'accepted', acceptedBy: shopper.uid, acceptedAt: serverTimestamp(), connectionId,
  }));
  await assertFails(setDoc(doc(recipientDb, 'connections', connectionId), {
    memberUids: [owner.uid, shopper.uid].sort(), status: 'active', inviteId,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }));
});

test('list title revisions permit editors, reject shoppers and reject stale writes', async () => {
  const listId = 'title-revision-test-list';
  const listPath = `shoppingLists/${listId}`;
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, listPath), {
      ownerUid: owner.uid, title: 'পুরোনো নাম', category: 'today', createdAt: new Date(), schemaVersion: 1,
    });
    await setDoc(doc(db, `${listPath}/members/${owner.uid}`), { uid: owner.uid, permission: 'owner' });
    await setDoc(doc(db, `${listPath}/members/${editor.uid}`), { uid: editor.uid, permission: 'editor' });
    await setDoc(doc(db, `${listPath}/members/${shopper.uid}`), { uid: shopper.uid, permission: 'shopper' });
  });
  await assertSucceeds(updateDoc(doc(asUser(editor), listPath), { title: 'সম্পাদকের নাম', revision: 1, updatedBy: editor.uid, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(asUser(shopper), listPath), { title: 'Shopper নাম', revision: 2, updatedBy: shopper.uid, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(asUser(owner), listPath), { title: 'stale revision', revision: 1, updatedBy: owner.uid, updatedAt: serverTimestamp() }));
});
