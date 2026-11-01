import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, orderBy, query, runTransaction, serverTimestamp, where,
  setDoc, updateDoc, writeBatch, type DocumentData, type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';
import { normalizeStoredLists, removeEmptyLocalListDrafts, type Item, type Note, type ShoppingList } from '../data';

export type ResourceKind = 'list' | 'note';
export type ListPermission = 'shopper' | 'editor' | 'owner';
export type NotePermission = 'viewer' | 'editor' | 'owner';
export type ResourceRef = { id: string; kind: ResourceKind; permission: ListPermission | NotePermission; createdAt?: unknown };
export type RemoteNote = Note & { id: string; ownerUid: string; revision: number; permission: NotePermission };
export type RemoteList = ShoppingList & { id: string; ownerUid: string; permission: ListPermission; items: Item[] };

const requireDb = () => { if (!db) throw new Error('Firebase configuration missing'); return db; };
const resourceCollection = (kind: ResourceKind) => kind === 'list' ? 'shoppingLists' : 'notes';
const memberPath = (kind: ResourceKind, id: string, uid: string) => `${resourceCollection(kind)}/${id}/members/${uid}`;
const refPath = (uid: string, kind: ResourceKind, id: string) => `users/${uid}/resourceRefs/${kind}-${id}`;
const normalizeEmail = (value: string) => value.trim().toLowerCase();

export async function loadResourceRefs(uid: string): Promise<ResourceRef[]> {
  const database = requireDb();
  const result = await getDocs(query(collection(database, 'users', uid, 'resourceRefs'), orderBy('createdAt', 'desc')));
  return result.docs.map(value => ({ id: String(value.data().resourceId), kind: value.data().kind as ResourceKind, permission: value.data().permission as ListPermission | NotePermission, createdAt: value.data().createdAt }));
}

export async function loadResourceSummaries(uid: string) {
  const database = requireDb();
  const refs = await loadResourceRefs(uid);
  return Promise.all(refs.map(async ref => {
    const data = await getDoc(doc(database, resourceCollection(ref.kind), ref.id));
    return data.exists() ? { ...ref, title: String(data.data().title || (ref.kind === 'list' ? 'নতুন বাজারের তালিকা' : 'শিরোনামহীন নোট')), date: data.data().createdAt, category: ref.kind === 'list' ? data.data().category as ShoppingList['category'] : undefined, ownerUid: data.data().ownerUid } : null;
  })).then(values => values.filter((value): value is NonNullable<typeof value> => value !== null));
}

export async function getRemoteNote(id: string, uid: string): Promise<RemoteNote> {
  const database = requireDb();
  const [noteSnap, memberSnap] = await Promise.all([getDoc(doc(database, 'notes', id)), getDoc(doc(database, memberPath('note', id, uid)))]);
  if (!noteSnap.exists() || !memberSnap.exists()) throw new Error('নোটটি পাওয়া যায়নি বা আপনার অনুমতি নেই।');
  return { id, ...noteSnap.data(), permission: memberSnap.data().permission } as RemoteNote;
}

export async function getRemoteList(id: string, uid: string): Promise<RemoteList> {
  const database = requireDb();
  const [listSnap, memberSnap, itemSnap] = await Promise.all([
    getDoc(doc(database, 'shoppingLists', id)),
    getDoc(doc(database, memberPath('list', id, uid))),
    getDocs(query(collection(database, 'shoppingLists', id, 'items'), orderBy('createdAt', 'asc'))),
  ]);
  if (!listSnap.exists() || !memberSnap.exists()) throw new Error('তালিকাটি পাওয়া যায়নি বা আপনার অনুমতি নেই।');
  const items = itemSnap.docs.map(value => ({ id: value.id, ...value.data() })) as Item[];
  return { id, ...listSnap.data(), permission: memberSnap.data().permission, items } as RemoteList;
}

export function watchRemoteNote(id: string, uid: string, onValue: (note: RemoteNote) => void, onError: (error: Error) => void): Unsubscribe {
  const database = requireDb();
  let noteData: DocumentData | undefined;
  let memberData: DocumentData | undefined;
  let failed = false;
  const publish = () => { if (noteData && memberData) onValue({ id, ...noteData, permission: memberData.permission } as RemoteNote); };
  const fail = (error: Error) => { if (!failed) { failed = true; onError(error); } };
  const a = onSnapshot(doc(database, 'notes', id), snapshot => { if (!snapshot.exists()) return fail(new Error('নোটটি আর নেই।')); noteData = snapshot.data(); publish(); }, fail);
  const b = onSnapshot(doc(database, memberPath('note', id, uid)), snapshot => { if (!snapshot.exists()) return fail(new Error('এই নোটের অনুমতি বাতিল হয়েছে।')); memberData = snapshot.data(); publish(); }, fail);
  return () => { a(); b(); };
}

export function watchRemoteList(id: string, uid: string, onValue: (list: RemoteList) => void, onError: (error: Error) => void): Unsubscribe {
  const database = requireDb();
  let listData: DocumentData | undefined;
  let memberData: DocumentData | undefined;
  let items: Item[] = [];
  let failed = false;
  const publish = () => { if (listData && memberData) onValue({ id, ...listData, items, permission: memberData.permission } as RemoteList); };
  const fail = (error: Error) => { if (!failed) { failed = true; onError(error); } };
  const a = onSnapshot(doc(database, 'shoppingLists', id), snapshot => { if (!snapshot.exists()) return fail(new Error('তালিকাটি আর নেই।')); listData = snapshot.data(); publish(); }, fail);
  const b = onSnapshot(doc(database, memberPath('list', id, uid)), snapshot => { if (!snapshot.exists()) return fail(new Error('এই তালিকার অনুমতি বাতিল হয়েছে।')); memberData = snapshot.data(); publish(); }, fail);
  const c = onSnapshot(query(collection(database, 'shoppingLists', id, 'items'), orderBy('createdAt', 'asc')), snapshot => { items = snapshot.docs.map(value => ({ id: value.id, ...value.data() })) as Item[]; publish(); }, fail);
  return () => { a(); b(); c(); };
}

export async function createOwnedNote(user: User, note: Note, id = doc(collection(requireDb(), 'notes')).id) {
  const database = requireDb();
  const batch = writeBatch(database);
  const timestamp = serverTimestamp();
  batch.set(doc(database, 'notes', id), { ownerUid: user.uid, title: note.title, body: note.body, createdAt: note.createdAt || new Date().toISOString(), updatedAt: timestamp, revision: 0, schemaVersion: 1 });
  batch.set(doc(database, memberPath('note', id, user.uid)), { uid: user.uid, permission: 'owner', joinedAt: timestamp });
  batch.set(doc(database, refPath(user.uid, 'note', id)), { kind: 'note', resourceId: id, permission: 'owner', createdAt: timestamp });
  await batch.commit();
  return id;
}

export async function createOwnedList(user: User, list: ShoppingList, id = doc(collection(requireDb(), 'shoppingLists')).id) {
  const database = requireDb();
  if (!list.title.trim() && !list.items.length) throw new Error('খালি তালিকা Cloud-এ তৈরি করা যাবে না। আগে শিরোনাম বা অন্তত একটি পণ্য যোগ করুন।');
  if (list.items.length > 450) throw new Error('একটি তালিকায় একসঙ্গে ৪৫০টির বেশি পণ্য cloud-এ নেওয়া যাবে না।');
  const batch = writeBatch(database);
  const timestamp = serverTimestamp();
  batch.set(doc(database, 'shoppingLists', id), { ownerUid: user.uid, title: list.title, category: list.category || 'today', createdAt: list.createdAt || new Date().toISOString(), updatedAt: timestamp, schemaVersion: 1 });
  batch.set(doc(database, memberPath('list', id, user.uid)), { uid: user.uid, permission: 'owner', joinedAt: timestamp });
  batch.set(doc(database, refPath(user.uid, 'list', id)), { kind: 'list', resourceId: id, permission: 'owner', createdAt: timestamp });
  for (const item of list.items) {
    const itemId = String(item.id);
    const { id: _id, ...fields } = item;
    batch.set(doc(database, 'shoppingLists', id, 'items', itemId), { ...fields, createdAt: timestamp, updatedAt: timestamp, updatedBy: user.uid });
  }
  await batch.commit();
  return id;
}

export async function updateRemoteNote(id: string, uid: string, changes: Pick<Note, 'title' | 'body'>, expectedRevision: number) {
  const database = requireDb();
  await runTransaction(database, async transaction => {
    const target = doc(database, 'notes', id);
    const snap = await transaction.get(target);
    if (!snap.exists()) throw new Error('নোটটি আর নেই।');
    if ((snap.data().revision || 0) !== expectedRevision) throw new Error('অন্য কেউ এই নোটটি আগে পরিবর্তন করেছেন। নতুন লেখা দেখুন, তারপর আবার সম্পাদনা করুন।');
    transaction.update(target, { ...changes, revision: expectedRevision + 1, updatedAt: serverTimestamp(), updatedBy: uid });
  });
}

export async function updateRemoteListTitle(id: string, title: string) {
  await updateDoc(doc(requireDb(), 'shoppingLists', id), { title, updatedAt: serverTimestamp() });
}

export async function addRemoteItem(listId: string, user: User, item: Omit<Item, 'id'>) {
  const database = requireDb();
  const target = doc(collection(database, 'shoppingLists', listId, 'items'));
  await setDoc(target, { ...item, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: user.uid });
  return target.id;
}

export async function updateRemoteItem(listId: string, itemId: string | number, user: User, changes: Partial<Pick<Item, 'name' | 'qty' | 'price' | 'status'>>) {
  const payload: Record<string, unknown> = { ...changes, updatedAt: serverTimestamp(), updatedBy: user.uid };
  if (Object.prototype.hasOwnProperty.call(changes, 'price') && changes.price === undefined) payload.price = deleteField();
  await updateDoc(doc(requireDb(), 'shoppingLists', listId, 'items', String(itemId)), payload);
}

export async function deleteRemoteItem(listId: string, itemId: string | number) {
  await deleteDoc(doc(requireDb(), 'shoppingLists', listId, 'items', String(itemId)));
}

export async function createInvite(user: User, kind: ResourceKind, resourceId: string, targetEmail: string, permission: ListPermission | NotePermission) {
  if (!user.emailVerified || !user.email) throw new Error('শেয়ার করার আগে আপনার ইমেইল যাচাই করুন।');
  const database = requireDb();
  const invite = doc(collection(database, 'invites'));
  await setDoc(invite, { kind, resourceId, ownerUid: user.uid, targetEmail: normalizeEmail(targetEmail), permission, status: 'pending', createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
  return invite.id;
}

export async function acceptInvite(code: string, user: User) {
  if (!user.emailVerified || !user.email) throw new Error('Invite গ্রহণের আগে আপনার ইমেইল যাচাই করুন।');
  const database = requireDb();
  const target = doc(database, 'invites', code.trim());
  return runTransaction(database, async transaction => {
    const inviteSnap = await transaction.get(target);
    if (!inviteSnap.exists()) throw new Error('Invite code সঠিক নয় বা মেয়াদ শেষ।');
    const invite = inviteSnap.data();
    if (invite.status !== 'pending' || invite.expiresAt.toMillis() < Date.now() || invite.targetEmail !== normalizeEmail(user.email!)) throw new Error('এই invite আপনার account-এর জন্য নয়, ব্যবহৃত হয়েছে অথবা মেয়াদ শেষ।');
    const kind = invite.kind as ResourceKind;
    const id = String(invite.resourceId);
    const membership = doc(database, memberPath(kind, id, user.uid));
    const userRef = doc(database, refPath(user.uid, kind, id));
    const [membershipSnap, refSnap] = await Promise.all([transaction.get(membership), transaction.get(userRef)]);
    if (membershipSnap.exists()) throw new Error('আপনি ইতিমধ্যে এই resource-এর সদস্য।');
    if (refSnap.exists()) throw new Error('এই resource আপনার অ্যাকাউন্টে আগে থেকেই আছে।');
    const timestamp = serverTimestamp();
    const role = invite.permission;
    transaction.set(membership, { uid: user.uid, permission: role, joinedAt: timestamp, inviteId: code, email: normalizeEmail(user.email!) });
    transaction.set(userRef, { kind, resourceId: id, permission: role, createdAt: timestamp });
    transaction.update(target, { status: 'accepted', acceptedBy: user.uid, acceptedAt: timestamp });
    return { kind, id };
  });
}

export async function updateMemberPermission(kind: ResourceKind, resourceId: string, memberUid: string, permission: ListPermission | NotePermission) {
  const database = requireDb();
  const batch = writeBatch(database);
  batch.update(doc(database, memberPath(kind, resourceId, memberUid)), { permission });
  batch.update(doc(database, refPath(memberUid, kind, resourceId)), { permission });
  await batch.commit();
}

export async function removeMember(kind: ResourceKind, resourceId: string, memberUid: string) {
  const database = requireDb();
  const batch = writeBatch(database);
  batch.delete(doc(database, memberPath(kind, resourceId, memberUid)));
  batch.delete(doc(database, refPath(memberUid, kind, resourceId)));
  await batch.commit();
}

export async function deleteOwnedResource(kind: ResourceKind, resourceId: string, ownerUid: string) {
  const database = requireDb();
  const root = doc(database, resourceCollection(kind), resourceId);
  const ownerMember = doc(database, memberPath(kind, resourceId, ownerUid));
  const [rootSnap, ownerSnap] = await Promise.all([getDoc(root), getDoc(ownerMember)]);
  if (!rootSnap.exists() || rootSnap.data().ownerUid !== ownerUid || !ownerSnap.exists() || ownerSnap.data().permission !== 'owner') {
    throw new Error('শুধু তালিকা বা নোটের মালিক এটি মুছতে পারবেন।');
  }
  // Lock the resource first. Rules then reject new invites, invite acceptance,
  // and member writes while this multi-batch cleanup is in progress.
  await updateDoc(root, { deleting: true });
  const operations: ReturnType<typeof doc>[] = [];
  const invites = await getDocs(query(collection(database, 'invites'),
    where('ownerUid', '==', ownerUid), where('kind', '==', kind), where('resourceId', '==', resourceId)));
  for (const invite of invites.docs) operations.push(invite.ref);
  for (let index = 0; index < operations.length; index += 400) {
    const batch = writeBatch(database);
    operations.slice(index, index + 400).forEach(reference => batch.delete(reference));
    await batch.commit();
  }
  operations.length = 0;
  // Read members only after invite cleanup so an invite transaction committed
  // just before the lock is included in this cleanup pass.
  const memberSnaps = await getDocs(collection(database, resourceCollection(kind), resourceId, 'members'));
  if (kind === 'list') {
    const items = await getDocs(collection(database, 'shoppingLists', resourceId, 'items'));
    for (const item of items.docs) operations.push(item.ref);
  }
  const memberUids = memberSnaps.docs.map(member => member.id);
  for (const uid of memberUids.filter(value => value !== ownerUid)) {
    const memberRef = doc(database, memberPath(kind, resourceId, uid));
    const userRef = doc(database, refPath(uid, kind, resourceId));
    operations.push(memberRef);
    try { if ((await getDoc(userRef)).exists()) operations.push(userRef); } catch { /* A missing ref cannot be deleted under member-only access. */ }
  }
  for (let index = 0; index < operations.length; index += 400) {
    const batch = writeBatch(database);
    operations.slice(index, index + 400).forEach(reference => batch.delete(reference));
    await batch.commit();
  }
  const ownerRef = doc(database, refPath(ownerUid, kind, resourceId));
  const finalBatch = writeBatch(database);
  finalBatch.delete(root);
  finalBatch.delete(ownerMember);
  if ((await getDoc(ownerRef)).exists()) finalBatch.delete(ownerRef);
  await finalBatch.commit();
}

export async function getMembers(kind: ResourceKind, resourceId: string) {
  const database = requireDb();
  const result = await getDocs(collection(database, resourceCollection(kind), resourceId, 'members'));
  return result.docs.map(value => ({ uid: value.id, ...value.data() })) as { uid: string; permission: string; email?: string }[];
}

export async function getMember(kind: ResourceKind, resourceId: string, uid: string) {
  const snapshot = await getDoc(doc(requireDb(), memberPath(kind, resourceId, uid)));
  return snapshot.exists() ? { uid: snapshot.id, ...snapshot.data() } as { uid: string; permission: string; email?: string } : null;
}

export async function migrateLocalData(user: User, selectedNoteIds: string[], selectedListIds: string[]) {
  const [savedLists, savedNotes, legacyNote] = await Promise.all([
    AsyncStorage.getItem('amar-khata-lists'), AsyncStorage.getItem('amar-khata-notes'), AsyncStorage.getItem('amar-khata-note'),
  ]);
  const lists = removeEmptyLocalListDrafts(normalizeStoredLists(savedLists ? JSON.parse(savedLists) : {})) as Record<string, ShoppingList & { cloudId?: string }>;
  const notes = savedNotes ? JSON.parse(savedNotes) as (Note & { id: string; cloudId?: string })[] : [];
  if (savedNotes === null && legacyNote) { const old = JSON.parse(legacyNote) as Note; notes.push({ ...old, id: old.id || 'legacy-note' }); }
  const migrated = { notes: 0, lists: 0 };
  for (const localId of selectedListIds) {
    const list = lists[localId]; if (!list || list.cloudId) continue;
    const cloudId = `migrated-${user.uid}-${localId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const database = requireDb(); const existing = await getDoc(doc(database, 'shoppingLists', cloudId));
    if (!existing.exists()) await createOwnedList(user, list, cloudId);
    else if (existing.data().ownerUid !== user.uid) throw new Error(`তালিকা ${list.title} নিরাপদে স্থানান্তর করা যায়নি।`);
    lists[localId] = { ...list, cloudId }; migrated.lists++;
    await AsyncStorage.setItem('amar-khata-lists', JSON.stringify(lists));
  }
  for (const local of notes) {
    if (!selectedNoteIds.includes(local.id) || local.cloudId) continue;
    const cloudId = `migrated-${user.uid}-${local.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const database = requireDb(); const existing = await getDoc(doc(database, 'notes', cloudId));
    if (!existing.exists()) await createOwnedNote(user, local, cloudId);
    else if (existing.data().ownerUid !== user.uid) throw new Error(`নোট ${local.title} নিরাপদে স্থানান্তর করা যায়নি।`);
    local.cloudId = cloudId; migrated.notes++;
    await AsyncStorage.setItem('amar-khata-notes', JSON.stringify(notes));
  }
  return migrated;
}
