import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, orderBy, query, runTransaction, serverTimestamp, where,
  setDoc, updateDoc, writeBatch, type DocumentData, type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { auth, db } from './firebase';
import { type Item, type Note, type ShoppingList } from '../data';
import { readLists, readNotes, type StorageScope } from './localStorage';
import { migrationResourceId, sameListContent, sameNoteContent } from './storagePolicy.mjs';
import { assertFirebaseUidMatches, inviteTargetEmailError, permissionForResourceSummary } from './collaborationPolicy.mjs';
import { createOwnedListInFirestore, createOwnedNoteInFirestore, loadResourceSummariesFromFirestore } from './ownedResourceService.mjs';
import { assertConnectionCounterpart, assertConnectionMember, connectionIdFor, connectionInviteExpiresAt, connectionInviteIdFor, isConnectionInviteExpired, normalizeContactEmail, normalizeUsername, validateSharedPermission } from './contactPolicy.mjs';
import { remoteItemDocumentId } from './remoteItemPolicy.mjs';
import { cloudSyncStore, isCloudNetworkAvailable } from './cloudSync';
import { shareResourceAtomically } from './shareService.mjs';
import { persistConnectionInvite } from './connectionInviteService.mjs';

export type ResourceKind = 'list' | 'note';
export type ListPermission = 'shopper' | 'editor' | 'owner';
export type NotePermission = 'viewer' | 'editor' | 'owner';
export type ResourceRef = { id: string; kind: ResourceKind; permission: ListPermission | NotePermission; createdAt?: unknown };
export type RemoteNote = Note & { id: string; ownerUid: string; revision: number; permission: NotePermission; updatedBy?: string; cached?: boolean; localSyncState?: string; localOutboxId?: string; localRemoteValue?: unknown; localRemoteRevision?: number };
export type RemoteList = ShoppingList & { id: string; ownerUid: string; permission: ListPermission; items: (Item & { revision?: number; updatedAt?: unknown; updatedBy?: string; localSyncState?: string; localOutboxId?: string; localRemoteValue?: unknown; localRemoteRevision?: number })[]; cached?: boolean; localSyncState?: string; localOutboxId?: string; localRemoteValue?: unknown; localRemoteRevision?: number };

const requireDb = () => { if (!db) throw new Error('Firebase configuration missing'); return db; };
function assertCurrentUser(uid: string) {
  assertFirebaseUidMatches(auth?.currentUser?.uid, uid);
}
function assertVerifiedUser(user: User) {
  assertCurrentUser(user.uid);
  if (!user.emailVerified) throw new Error('Cloud sharing বা migration-এর আগে ইমেইল যাচাই করুন।');
}
const resourceCollection = (kind: ResourceKind) => kind === 'list' ? 'shoppingLists' : 'notes';
const memberPath = (kind: ResourceKind, id: string, uid: string) => `${resourceCollection(kind)}/${id}/members/${uid}`;
const refPath = (uid: string, kind: ResourceKind, id: string) => `users/${uid}/resourceRefs/${kind}-${id}`;
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const itemBaseSnapshot = (item: Item | undefined) => item ? ({
  id: item.id, name: item.name, qty: item.qty, status: item.status,
  ...(item.price === undefined ? {} : { price: item.price }),
}) : undefined;

export type PublicContactProfile = { uid: string; username: string; usernameKey: string; displayName: string };
export type ConnectedContact = { connectionId: string; profile: PublicContactProfile; sharedCount: number; updatedAt?: unknown };
export type ConnectionInvite = { id: string; senderUid: string; senderUsername?: string; recipientUid?: string; recipientEmail?: string; status: string; acceptedBy?: string; createdAt?: unknown; expiresAt?: unknown };

function requireVerifiedCurrentUser(user: User) {
  assertVerifiedUser(user);
  if (!user.email) throw new Error('নিরাপদ শেয়ারিংয়ের আগে account ইমেইল যাচাই করুন।');
}

/** Register one immutable, case-insensitive public handle; only safe profile fields are stored. */
export async function claimUsername(user: User, requestedUsername: string, displayName = user.displayName || ''): Promise<PublicContactProfile> {
  requireVerifiedCurrentUser(user);
  const database = requireDb();
  const usernameKey = normalizeUsername(requestedUsername);
  const profileRef = doc(database, 'userProfiles', user.uid);
  const usernameRef = doc(database, 'usernames', usernameKey);
  return runTransaction(database, async transaction => {
    requireVerifiedCurrentUser(user);
    const [profileSnap, usernameSnap] = await Promise.all([transaction.get(profileRef), transaction.get(usernameRef)]);
    if (profileSnap.exists()) {
      const existing = profileSnap.data() as PublicContactProfile;
      if (existing.usernameKey !== usernameKey) throw new Error('এই account-এর username আগে থেকেই নির্ধারিত; এটি পরিবর্তন করা যাবে না।');
      return existing;
    }
    if (usernameSnap.exists() && usernameSnap.data().uid !== user.uid) throw new Error('এই username আগে থেকেই ব্যবহৃত হচ্ছে। অন্যটি বেছে নিন।');
    const profile: PublicContactProfile = { uid: user.uid, username: usernameKey, usernameKey, displayName: displayName.trim().slice(0, 60) || usernameKey };
    const timestamp = serverTimestamp();
    requireVerifiedCurrentUser(user);
    transaction.set(profileRef, { ...profile, createdAt: timestamp });
    transaction.set(usernameRef, { uid: user.uid, username: usernameKey, createdAt: timestamp });
    return profile;
  });
}

export async function getOwnContactProfile(user: User): Promise<PublicContactProfile | null> {
  requireVerifiedCurrentUser(user);
  const snapshot = await getDoc(doc(requireDb(), 'userProfiles', user.uid));
  requireVerifiedCurrentUser(user);
  return snapshot.exists() ? snapshot.data() as PublicContactProfile : null;
}

export async function getUserContactProfile(uid: string, user: User, expectedConnectionId?: string): Promise<PublicContactProfile | null> {
  requireVerifiedCurrentUser(user);
  const database = requireDb();
  const canonicalConnectionId = connectionIdFor(user.uid, uid);
  if (expectedConnectionId && expectedConnectionId !== canonicalConnectionId) throw new Error('পরিচিতির সংযোগের তথ্য মেলে না। পরিচিতির তালিকা থেকে আবার খুলুন।');
  const connection = await getDoc(doc(database, 'connections', canonicalConnectionId));
  if (!connection.exists() || assertConnectionCounterpart(canonicalConnectionId, connection.data(), user.uid, uid) !== uid) throw new Error('এই profile পড়ার জন্য সক্রিয় পরিচিতি সংযোগ দরকার।');
  const profile = await getDoc(doc(database, 'userProfiles', uid));
  return profile.exists() ? profile.data() as PublicContactProfile : null;
}

export async function findContactByUsername(user: User, value: string): Promise<PublicContactProfile | null> {
  requireVerifiedCurrentUser(user);
  const usernameKey = normalizeUsername(value);
  const database = requireDb();
  const usernameSnap = await getDoc(doc(database, 'usernames', usernameKey));
  requireVerifiedCurrentUser(user);
  if (!usernameSnap.exists()) return null;
  const targetUid = String(usernameSnap.data().uid || '');
  if (!targetUid || targetUid === user.uid) return null;
  const profileSnap = await getDoc(doc(database, 'userProfiles', targetUid));
  requireVerifiedCurrentUser(user);
  if (!profileSnap.exists()) throw new Error('পরিচিতির প্রোফাইল অসম্পূর্ণ; নিরাপত্তার জন্য অনুরোধ পাঠানো হয়নি।');
  return profileSnap.data() as PublicContactProfile;
}

export async function createConnectionInvite(user: User, recipient: { uid: string } | { email: string }) {
  requireVerifiedCurrentUser(user);
  const database = requireDb();
  const targetUid = 'uid' in recipient ? recipient.uid : undefined;
  const targetEmail = 'email' in recipient ? normalizeContactEmail(recipient.email) : undefined;
  const ownEmail = user.email ? normalizeContactEmail(user.email) : '';
  if (targetUid === user.uid || targetEmail && ownEmail && targetEmail === ownEmail) throw new Error('নিজেকে পরিচিতি হিসেবে যুক্ত করা যাবে না।');
  if (!targetUid && !targetEmail) throw new Error('পরিচিতির username বা ইমেইল দিন।');
  if (targetUid) {
    const existingConnections = await getDocs(query(collection(database, 'connections'), where('memberUids', 'array-contains', user.uid)));
    requireVerifiedCurrentUser(user);
    if (existingConnections.docs.some(snapshot => snapshot.data().status === 'active' && snapshot.data().memberUids.includes(targetUid))) {
      throw new Error('এই ব্যক্তি ইতিমধ্যে আপনার পরিচিতি।');
    }
  }
  const senderProfile = await getOwnContactProfile(user);
  requireVerifiedCurrentUser(user);
  const normalizedRecipient = targetUid ? { uid: targetUid } : { email: targetEmail! };
  const inviteRef = doc(database, 'connectionInvites', connectionInviteIdFor(user.uid, normalizedRecipient));
  requireVerifiedCurrentUser(user);
  const now = new Date();
  return persistConnectionInvite({
    database,
    inviteRef,
    invitation: {
      senderUid: user.uid,
      senderUsername: senderProfile?.username || '',
      ...(targetUid ? { recipientUid: targetUid } : { recipientEmail: targetEmail }),
      status: 'pending', createdAt: serverTimestamp(), expiresAt: connectionInviteExpiresAt(now),
    },
    firestore: { runTransaction },
    assertCurrentUser: () => requireVerifiedCurrentUser(user),
  });
}

export async function listConnectionInvites(user: User): Promise<ConnectionInvite[]> {
  requireVerifiedCurrentUser(user);
  const database = requireDb();
  const byUid = await getDocs(query(collection(database, 'connectionInvites'), where('recipientUid', '==', user.uid)));
  const byEmail = await getDocs(query(collection(database, 'connectionInvites'), where('recipientEmail', '==', normalizeContactEmail(user.email!))));
  requireVerifiedCurrentUser(user);
  const unique = new Map<string, ConnectionInvite>();
  [...byUid.docs, ...byEmail.docs].forEach(snapshot => {
    const invite = { id: snapshot.id, ...snapshot.data() } as ConnectionInvite;
    if (invite.status === 'pending' && !isConnectionInviteExpired(invite)) unique.set(snapshot.id, invite);
  });
  return [...unique.values()];
}

export async function listSentConnectionInvites(user: User): Promise<ConnectionInvite[]> {
  requireVerifiedCurrentUser(user);
  const snapshot = await getDocs(query(collection(requireDb(), 'connectionInvites'), where('senderUid', '==', user.uid)));
  requireVerifiedCurrentUser(user);
  return snapshot.docs.map(item => ({ id: item.id, ...item.data() } as ConnectionInvite)).filter(invite => invite.status !== 'pending' || !isConnectionInviteExpired(invite));
}

export async function cancelConnectionInvite(inviteId: string, user: User) {
  requireVerifiedCurrentUser(user);
  await deleteDoc(doc(requireDb(), 'connectionInvites', inviteId));
  requireVerifiedCurrentUser(user);
}

export async function acceptConnectionInvite(inviteId: string, user: User) {
  requireVerifiedCurrentUser(user);
  const database = requireDb();
  const inviteRef = doc(database, 'connectionInvites', inviteId);
  const accepted = await runTransaction(database, async transaction => {
    requireVerifiedCurrentUser(user);
    const inviteSnap = await transaction.get(inviteRef);
    if (!inviteSnap.exists()) throw new Error('অনুরোধটি পাওয়া যায়নি।');
    const invite = inviteSnap.data();
    const addressedToUser = invite.recipientUid === user.uid || invite.recipientEmail === normalizeContactEmail(user.email!);
    if (!addressedToUser || invite.senderUid === user.uid) throw new Error('এই অনুরোধটি আপনার জন্য নয়।');
    const connectionId = connectionIdFor(invite.senderUid, user.uid);
    if (invite.status === 'accepted') {
      const acceptedAt = invite.acceptedAt?.toMillis?.() ?? (invite.acceptedAt instanceof Date ? invite.acceptedAt.getTime() : NaN);
      const expiresAt = invite.expiresAt?.toMillis?.() ?? (invite.expiresAt instanceof Date ? invite.expiresAt.getTime() : NaN);
      if (invite.acceptedBy !== user.uid || invite.connectionId !== connectionId || !Number.isFinite(acceptedAt) || !Number.isFinite(expiresAt) || acceptedAt > Date.now() || acceptedAt >= expiresAt) {
        throw new Error('এই অনুরোধটি আগে গ্রহণ করা হয়েছে, তবে নিরাপদে পুনরায় সংযোগ করা যাচ্ছে না।');
      }
      return { connectionId, inviteId, senderUid: invite.senderUid as string };
    }
    if (invite.status !== 'pending' || isConnectionInviteExpired(invite)) throw new Error('এই অনুরোধটির মেয়াদ শেষ হয়েছে বা এটি নিষ্পত্তি হয়েছে।');
    const acceptedAt = serverTimestamp();
    requireVerifiedCurrentUser(user);
    transaction.update(inviteRef, { status: 'accepted', acceptedBy: user.uid, acceptedAt, connectionId });
    return { connectionId, inviteId, senderUid: invite.senderUid as string };
  });

  // Step B is intentionally separate: Rules authorize connection creation
  // from the already-committed recipient consent and keep invite/connection
  // checks one-directional.
  requireVerifiedCurrentUser(user);
  const expectedMembers = [accepted.senderUid, user.uid].sort();
  const connectionRef = doc(database, 'connections', accepted.connectionId);
  const findExistingConnection = async () => {
    requireVerifiedCurrentUser(user);
    const snapshot = await getDocs(query(collection(database, 'connections'), where('memberUids', 'array-contains', user.uid)));
    requireVerifiedCurrentUser(user);
    return snapshot.docs.find(item => item.id === accepted.connectionId);
  };
  const validateExistingConnection = (snapshot: { id: string; data(): DocumentData } | undefined) => {
    if (!snapshot) return false;
    const data = snapshot.data();
    const members = Array.isArray(data.memberUids) ? [...data.memberUids].sort() : [];
    if (snapshot.id !== accepted.connectionId || data.status !== 'active'
      || members.length !== 2 || members[0] !== expectedMembers[0] || members[1] !== expectedMembers[1]
      || data.inviteId !== inviteId) {
      throw new Error('এই পরিচিতির connection তথ্য invite-এর সঙ্গে মেলে না; নিরাপত্তার জন্য সংযোগটি তৈরি করা হয়নি।');
    }
    return true;
  };

  if (!validateExistingConnection(await findExistingConnection())) {
    try {
      await setDoc(connectionRef, {
        memberUids: expectedMembers,
        status: 'active', inviteId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    } catch (writeError) {
      requireVerifiedCurrentUser(user);
      // A concurrent retry may have created the stable-ID connection first.
      // Treat it as success only after validating the exact membership/link.
      if (!validateExistingConnection(await findExistingConnection())) throw writeError;
    }
  }
  requireVerifiedCurrentUser(user);
  return accepted.connectionId;
}

export async function declineConnectionInvite(inviteId: string, user: User) {
  requireVerifiedCurrentUser(user);
  const database = requireDb();
  const inviteRef = doc(database, 'connectionInvites', inviteId);
  await runTransaction(database, async transaction => {
    requireVerifiedCurrentUser(user);
    const snapshot = await transaction.get(inviteRef);
    if (!snapshot.exists()) throw new Error('অনুরোধটি পাওয়া যায়নি।');
    const invite = snapshot.data();
    if (invite.status !== 'pending' || isConnectionInviteExpired(invite) || (invite.recipientUid !== user.uid && invite.recipientEmail !== normalizeContactEmail(user.email!))) throw new Error('এই অনুরোধটি আপনার জন্য নয়, মেয়াদ শেষ অথবা আগে থেকেই নিষ্পত্তি হয়েছে।');
    requireVerifiedCurrentUser(user);
    transaction.update(inviteRef, { status: 'declined', declinedAt: serverTimestamp() });
  });
}

export async function listConnectedContacts(user: User): Promise<ConnectedContact[]> {
  requireVerifiedCurrentUser(user);
  const database = requireDb();
  const snapshot = await getDocs(query(collection(database, 'connections'), where('memberUids', 'array-contains', user.uid)));
  requireVerifiedCurrentUser(user);
  const activeConnections = snapshot.docs.filter(item => item.data().status === 'active');
  const contacts = await Promise.all(activeConnections.map(async connectionSnap => {
    const connection = connectionSnap.data();
    const otherUid = assertConnectionMember(connection, user.uid);
    const profileSnap = await getDoc(doc(database, 'userProfiles', otherUid));
    const profile = profileSnap.exists()
      ? profileSnap.data() as PublicContactProfile
      : { uid: otherUid, username: '', usernameKey: '', displayName: 'নতুন পরিচিতি' };
    const history = await getDocs(collection(database, 'connections', connectionSnap.id, 'sharedResources'));
    return { connectionId: connectionSnap.id, profile, sharedCount: history.size, updatedAt: connection.updatedAt };
  }));
  requireVerifiedCurrentUser(user);
  return contacts;
}

export async function getConnectionHistory(connectionId: string, user: User) {
  requireVerifiedCurrentUser(user);
  const database = requireDb();
  const connection = await getDoc(doc(database, 'connections', connectionId));
  requireVerifiedCurrentUser(user);
  if (!connection.exists()) throw new Error('এই পরিচিতির সংযোগ আর নেই।');
  assertConnectionMember(connection.data(), user.uid);
  const history = await getDocs(query(collection(database, 'connections', connectionId, 'sharedResources'), orderBy('createdAt', 'desc')));
  requireVerifiedCurrentUser(user);
  return history.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
}

export function watchConnectionHistory(connectionId: string, user: User, onValue: (items: { id: string }[]) => void, onError: (error: Error) => void, expectedContactUid?: string): Unsubscribe {
  requireVerifiedCurrentUser(user);
  const database = requireDb();
  let stopped = false;
  let historyUnsubscribe: Unsubscribe | undefined;
  void getDoc(doc(database, 'connections', connectionId)).then(connection => {
    if (stopped) return;
    requireVerifiedCurrentUser(user);
    if (!connection.exists()) throw new Error('এই পরিচিতির সংযোগ আর নেই।');
    if (expectedContactUid) assertConnectionCounterpart(connectionId, connection.data(), user.uid, expectedContactUid);
    else assertConnectionMember(connection.data(), user.uid);
    historyUnsubscribe = onSnapshot(query(collection(database, 'connections', connectionId, 'sharedResources'), orderBy('createdAt', 'desc')),
      snapshot => onValue(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      error => onError(error));
  }).catch(error => { if (!stopped) onError(error instanceof Error ? error : new Error('শেয়ারিং ইতিহাস পড়া যায়নি।')); });
  return () => { stopped = true; historyUnsubscribe?.(); };
}

export async function shareResourceToContact(user: User, connectionId: string, recipientUid: string, kind: ResourceKind, resourceId: string, permission: ListPermission | NotePermission, title: string) {
  requireVerifiedCurrentUser(user);
  const database = requireDb();
  return shareResourceAtomically({
    database, user, connectionId, recipientUid, kind, resourceId, permission, title,
    firestore: { doc, runTransaction, serverTimestamp },
    assertCurrentUser: requireVerifiedCurrentUser,
    assertConnectionMember,
    validateSharedPermission,
  });
}

export async function revokeContactShare(user: User, connectionId: string, recipientUid: string, kind: ResourceKind, resourceId: string) {
  requireVerifiedCurrentUser(user);
  const database = requireDb();
  const connectionRef = doc(database, 'connections', connectionId);
  const rootRef = doc(database, resourceCollection(kind), resourceId);
  const memberRef = doc(database, memberPath(kind, resourceId, recipientUid));
  const recipientResourceRef = doc(database, refPath(recipientUid, kind, resourceId));
  const historyRef = doc(database, 'connections', connectionId, 'sharedResources', `${kind}-${resourceId}`);
  await runTransaction(database, async transaction => {
    requireVerifiedCurrentUser(user);
    const [connectionSnap, rootSnap, memberSnap] = await Promise.all([transaction.get(connectionRef), transaction.get(rootRef), transaction.get(memberRef)]);
    if (!connectionSnap.exists() || assertConnectionMember(connectionSnap.data(), user.uid) !== recipientUid) throw new Error('পরিচিতির সংযোগ যাচাই করা যায়নি।');
    if (!rootSnap.exists() || rootSnap.data().ownerUid !== user.uid) throw new Error('শুধু resource-এর মালিক access সরাতে পারবেন।');
    if (memberSnap.exists() && memberSnap.data().permission === 'owner') throw new Error('Owner access সরানো যাবে না।');
    requireVerifiedCurrentUser(user);
    transaction.delete(memberRef);
    transaction.delete(recipientResourceRef);
    transaction.delete(historyRef);
    transaction.update(connectionRef, { updatedAt: serverTimestamp() });
  });
}

export async function loadResourceRefs(uid: string): Promise<ResourceRef[]> {
  assertCurrentUser(uid);
  const database = requireDb();
  const result = await getDocs(query(collection(database, 'users', uid, 'resourceRefs'), orderBy('createdAt', 'desc')));
  return result.docs.map(value => ({ id: String(value.data().resourceId), kind: value.data().kind as ResourceKind, permission: value.data().permission as ListPermission | NotePermission, createdAt: value.data().createdAt }));
}

export async function loadResourceSummaries(uid: string) {
  assertCurrentUser(uid);
  const database = requireDb();
  return loadResourceSummariesFromFirestore({
    database, uid,
    firestore: { collection, doc, getDoc, getDocs, orderBy, query },
    permissionForSummary: permissionForResourceSummary,
  });
}

export async function getRemoteNote(id: string, uid: string): Promise<RemoteNote> {
  assertCurrentUser(uid);
  const database = requireDb();
  const [noteSnap, memberSnap] = await Promise.all([getDoc(doc(database, 'notes', id)), getDoc(doc(database, memberPath('note', id, uid)))]);
  if (!noteSnap.exists() || !memberSnap.exists()) throw new Error('নোটটি পাওয়া যায়নি বা আপনার অনুমতি নেই।');
  return { id, ...noteSnap.data(), permission: memberSnap.data().permission } as RemoteNote;
}

export async function getRemoteList(id: string, uid: string): Promise<RemoteList> {
  assertCurrentUser(uid);
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
  assertCurrentUser(uid);
  const database = requireDb();
  let noteData: DocumentData | undefined;
  let memberData: DocumentData | undefined;
  let failed = false;
  let stopped = false;
  const publish = () => { if (noteData && memberData) { const value = { id, ...noteData, permission: memberData.permission } as RemoteNote; void deliverCachedNote(uid, value).then(onValue).catch(() => onValue(value)); } };
  const fail = (error: Error) => { if (!failed) { failed = true; const code = (error as Error & { code?: string }).code; if (code === 'permission-denied' || error.message.includes('নোটটি আর নেই')) void cloudSyncStore.removeCache(uid, 'note', id).catch(() => {}); onError(error); } };
  void cloudSyncStore.readCache(uid, 'note', id).then(value => { if (!stopped && !failed && value && !noteData) void deliverCachedNote(uid, { ...value, cached: true } as RemoteNote).then(onValue).catch(() => onValue(value as RemoteNote)); }).catch(() => {});
  const a = onSnapshot(doc(database, 'notes', id), snapshot => { if (!snapshot.exists()) return fail(new Error('নোটটি আর নেই।')); noteData = snapshot.data(); publish(); }, fail);
  const b = onSnapshot(doc(database, memberPath('note', id, uid)), snapshot => { if (!snapshot.exists()) return fail(new Error('এই নোটের অনুমতি বাতিল হয়েছে।')); memberData = snapshot.data(); publish(); }, fail);
  return () => { stopped = true; a(); b(); };
}

export function watchRemoteList(id: string, uid: string, onValue: (list: RemoteList) => void, onError: (error: Error) => void): Unsubscribe {
  assertCurrentUser(uid);
  const database = requireDb();
  let listData: DocumentData | undefined;
  let memberData: DocumentData | undefined;
  let items: Item[] = [];
  let failed = false;
  const publish = () => { if (listData && memberData) { const value = { id, ...listData, items, permission: memberData.permission } as RemoteList; void deliverCachedList(uid, value).then(onValue).catch(() => onValue(value)); } };
  const fail = (error: Error) => { if (!failed) { failed = true; const code = (error as Error & { code?: string }).code; if (code === 'permission-denied' || error.message.includes('তালিকাটি আর নেই')) void cloudSyncStore.removeCache(uid, 'list', id).catch(() => {}); onError(error); } };
  let stopped = false;
  void cloudSyncStore.readCache(uid, 'list', id).then(value => { if (!stopped && !failed && value && !listData) void deliverCachedList(uid, { ...value, cached: true } as RemoteList).then(onValue).catch(() => onValue(value as RemoteList)); }).catch(() => {});
  const a = onSnapshot(doc(database, 'shoppingLists', id), snapshot => { if (!snapshot.exists()) return fail(new Error('তালিকাটি আর নেই।')); listData = snapshot.data(); publish(); }, fail);
  const b = onSnapshot(doc(database, memberPath('list', id, uid)), snapshot => { if (!snapshot.exists()) return fail(new Error('এই তালিকার অনুমতি বাতিল হয়েছে।')); memberData = snapshot.data(); publish(); }, fail);
  const c = onSnapshot(query(collection(database, 'shoppingLists', id, 'items'), orderBy('createdAt', 'asc')), snapshot => { items = snapshot.docs.map(value => ({ id: value.id, ...value.data() })) as Item[]; publish(); }, fail);
  return () => { stopped = true; a(); b(); c(); };
}

async function deliverCachedNote(uid: string, note: RemoteNote) {
  const entries = await cloudSyncStore.list(uid);
  const pending = entries.filter(entry => entry.kind === 'note' && entry.resourceId === note.id && entry.operation === 'save-note' && (entry.status === 'pending' || entry.status === 'conflict' || entry.status === 'blocked'));
  const latest = pending[pending.length - 1];
  const value = latest ? { ...note, ...(latest.value as Pick<Note, 'title' | 'body'>), localSyncState: latest.status, localOutboxId: latest.id, localRemoteValue: latest.remoteValue, localRemoteRevision: latest.remoteRevision } : note;
  if (!note.cached) await cloudSyncStore.writeCache(uid, 'note', note.id, value);
  return value as RemoteNote;
}

async function deliverCachedList(uid: string, list: RemoteList) {
  const entries = await cloudSyncStore.list(uid);
  const pending = entries.filter(entry => (entry.kind === 'list-item' || entry.kind === 'list-title') && entry.resourceId === list.id && (entry.status === 'pending' || entry.status === 'conflict' || entry.status === 'blocked'));
  let items = [...list.items];
  let title = list.title;
  for (const entry of pending) {
    if (entry.kind === 'list-title') {
      title = (entry.value as { title: string }).title;
      continue;
    }
    const index = items.findIndex(item => String(item.id) === entry.targetId);
    if (entry.operation === 'delete-item') { items = items.filter(item => String(item.id) !== entry.targetId); continue; }
    if (entry.operation === 'create-item') {
      const value = entry.value as Item;
      if (index < 0) items.push({ ...value, revision: 0, localSyncState: entry.status, localOutboxId: entry.id, localRemoteValue: entry.remoteValue, localRemoteRevision: entry.remoteRevision } as RemoteList['items'][number]);
      continue;
    }
    if (index >= 0) items[index] = { ...items[index], ...(entry.value as Partial<Item>), localSyncState: entry.status, localOutboxId: entry.id, localRemoteValue: entry.remoteValue, localRemoteRevision: entry.remoteRevision } as RemoteList['items'][number];
  }
  const latestTitle = [...pending].reverse().find(entry => entry.kind === 'list-title');
  const value = { ...list, title, items,
    ...(latestTitle ? {
      localSyncState: latestTitle.status,
      localOutboxId: latestTitle.id,
      localRemoteValue: latestTitle.remoteValue,
      localRemoteRevision: latestTitle.remoteRevision,
    } : {}),
  };
  if (!list.cached) await cloudSyncStore.writeCache(uid, 'list', list.id, value);
  return value;
}

export async function cacheRemoteList(uid: string, list: RemoteList) {
  assertCurrentUser(uid);
  await cloudSyncStore.writeCache(uid, 'list', list.id, list);
}

export async function getPendingCloudChanges(uid: string) { assertCurrentUser(uid); return cloudSyncStore.list(uid); }

export async function createOwnedNote(user: User, note: Note, id = doc(collection(requireDb(), 'notes')).id) {
  assertVerifiedUser(user);
  const database = requireDb();
  return createOwnedNoteInFirestore({
    database, user, note, id, sameNoteContent,
    firestore: { doc, getDoc, serverTimestamp, writeBatch },
  });
}

export async function createOwnedList(user: User, list: ShoppingList, id = doc(collection(requireDb(), 'shoppingLists')).id) {
  assertVerifiedUser(user);
  if (!list.title.trim() && !list.items.length) throw new Error('খালি তালিকা Cloud-এ তৈরি করা যাবে না। আগে শিরোনাম বা অন্তত একটি পণ্য যোগ করুন।');
  if (list.items.length > 450) throw new Error('একটি তালিকায় একসঙ্গে ৪৫০টির বেশি পণ্য cloud-এ নেওয়া যাবে না।');
  const database = requireDb();
  return createOwnedListInFirestore({
    database, user, list, id, sameListContent,
    firestore: { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch },
  });
}

export async function updateRemoteNote(id: string, uid: string, changes: Pick<Note, 'title' | 'body'>, expectedRevision: number) {
  assertCurrentUser(uid);
  const entry = await queueRemoteNoteDraft(id, uid, changes, expectedRevision);
  await flushPendingCloudChanges({ uid } as User);
  const remaining = (await cloudSyncStore.list(uid)).find(item => item.id === entry?.id);
  if (remaining?.status === 'conflict') throw Object.assign(new Error('অন্য কেউ এই নোটটি আগে পরিবর্তন করেছেন। আপনার লেখা রাখা আছে; Cloud বা নিজের সংস্করণ বেছে নিন।'), { conflict: true, remoteValue: remaining.remoteValue, entryId: remaining.id, remoteRevision: remaining.remoteRevision });
  if (remaining?.status === 'blocked') throw new Error(typeof remaining.error === 'string' ? remaining.error : 'নোট সিঙ্ক করা যায়নি; পরিবর্তন ডিভাইসে রাখা আছে।');
  return { synced: !remaining, queued: Boolean(remaining) };
}

export async function queueRemoteNoteDraft(id: string, uid: string, changes: Pick<Note, 'title' | 'body'>, expectedRevision: number) {
  assertCurrentUser(uid);
  return cloudSyncStore.enqueue(uid, { uid, kind: 'note', resourceId: id, targetId: 'note', operation: 'save-note', baseRevision: expectedRevision, value: changes });
}

export async function updateRemoteListTitle(id: string, uid: string, title: string, baseRevision = 0, baseTitle = '') {
  assertCurrentUser(uid);
  if (title.length > 120) throw new Error('তালিকার শিরোনাম ১২০ অক্ষরের মধ্যে রাখুন।');
  const entry = await cloudSyncStore.enqueue(uid, { uid, kind: 'list-title', resourceId: id, targetId: 'title', operation: 'update-title', baseRevision: Number(baseRevision || 0), baseValue: { title: baseTitle }, value: { title } });
  return { synced: false, queued: Boolean(entry), entryId: entry?.id };
}

export async function addRemoteItem(listId: string, user: User, item: Item) {
  assertCurrentUser(user.uid);
  const targetId = remoteItemDocumentId(item.id);
  const entry = await cloudSyncStore.enqueue(user.uid, { uid: user.uid, kind: 'list-item', resourceId: listId, targetId, operation: 'create-item', baseRevision: null, value: item });
  await flushPendingCloudChanges(user);
  const remaining = (await cloudSyncStore.list(user.uid)).find(value => value.id === entry?.id);
  if (remaining?.status === 'conflict') throw Object.assign(new Error('একই পণ্যের ID-তে অন্য পরিবর্তন আছে; আপনার লেখা ডিভাইসে রাখা হয়েছে।'), { conflict: true, remoteValue: remaining.remoteValue, entryId: remaining.id, remoteRevision: remaining.remoteRevision });
  if (remaining?.status === 'blocked') throw new Error(typeof remaining.error === 'string' ? remaining.error : 'পণ্য সিঙ্ক করা যায়নি; পরিবর্তন ডিভাইসে রাখা আছে।');
  return { id: targetId, synced: !remaining, queued: Boolean(remaining) };
}

export async function updateRemoteItem(listId: string, itemId: string | number, user: User, changes: Partial<Pick<Item, 'name' | 'qty' | 'price' | 'status'>>, expectedRevision = 0, baseValue?: Item) {
  assertCurrentUser(user.uid);
  const entry = await cloudSyncStore.enqueue(user.uid, { uid: user.uid, kind: 'list-item', resourceId: listId, targetId: remoteItemDocumentId(itemId), operation: 'update-item', baseRevision: expectedRevision, baseValue: itemBaseSnapshot(baseValue), value: changes });
  await flushPendingCloudChanges(user);
  const remaining = (await cloudSyncStore.list(user.uid)).find(value => value.id === entry?.id);
  if (remaining?.status === 'conflict') throw Object.assign(new Error('অন্য কেউ এই পণ্যটি পরিবর্তন করেছেন। আপনার সম্পাদনা রাখা আছে; Cloud বা নিজের সংস্করণ বেছে নিন।'), { conflict: true, remoteValue: remaining.remoteValue, entryId: remaining.id, remoteRevision: remaining.remoteRevision });
  if (remaining?.status === 'blocked') throw new Error(typeof remaining.error === 'string' ? remaining.error : 'পণ্যের পরিবর্তন সিঙ্ক করা যায়নি; ডিভাইসে রাখা আছে।');
  return { synced: !remaining, queued: Boolean(remaining) };
}

export async function deleteRemoteItem(listId: string, item: Item & { revision?: number }, user: User) {
  assertCurrentUser(user.uid);
  const entry = await cloudSyncStore.enqueue(user.uid, { uid: user.uid, kind: 'list-item', resourceId: listId, targetId: remoteItemDocumentId(item.id), operation: 'delete-item', baseRevision: Number(item.revision || 0), baseValue: itemBaseSnapshot(item) });
  await flushPendingCloudChanges(user);
  const remaining = (await cloudSyncStore.list(user.uid)).find(value => value.id === entry?.id);
  if (remaining?.status === 'conflict') throw Object.assign(new Error('অন্য কেউ এই পণ্যটি পরিবর্তন করেছেন; আপনার delete অপেক্ষায় রাখা হয়েছে।'), { conflict: true, remoteValue: remaining.remoteValue, entryId: remaining.id, remoteRevision: remaining.remoteRevision });
  if (remaining?.status === 'blocked') throw new Error(typeof remaining.error === 'string' ? remaining.error : 'পণ্য মুছে ফেলা সিঙ্ক হয়নি; পরিবর্তন ডিভাইসে রাখা আছে।');
  return { synced: !remaining, queued: Boolean(remaining) };
}

export async function resolvePendingCloudChange(uid: string, id: string, choice: 'local' | 'remote') {
  assertCurrentUser(uid);
  return cloudSyncStore.resolve(uid, id, choice);
}

export async function retryBlockedCloudChange(user: Pick<User, 'uid'>, id: string) {
  assertCurrentUser(user.uid);
  const retried = await cloudSyncStore.retry(user.uid, id);
  if (retried) return flushPendingCloudChanges(user);
  return { synced: false, pending: true };
}

export async function flushPendingCloudChanges(user: Pick<User, 'uid'>) {
  assertCurrentUser(user.uid);
  if (!isCloudNetworkAvailable()) return { synced: false, pending: true, offline: true };
  const database = requireDb();
  return cloudSyncStore.drain(user.uid, async entry => {
    assertCurrentUser(user.uid);
    if (entry.kind === 'note') {
      const reference = doc(database, 'notes', entry.resourceId);
      await runTransaction(database, async transaction => {
        assertCurrentUser(user.uid);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw Object.assign(new Error('নোটটি Cloud-এ আর নেই।'), { conflict: true, remoteValue: null });
        const remote = snapshot.data(); const revision = Number(remote.revision || 0);
        const value = entry.value as Pick<Note, 'title' | 'body'>;
        if (revision !== Number(entry.baseRevision)) {
          if (remote.updatedBy === user.uid && remote.title === value.title && remote.body === value.body) return;
          throw Object.assign(new Error('অন্য কেউ এই নোটটি পরিবর্তন করেছেন।'), { conflict: true, remoteValue: { ...remote, revision } });
        }
        transaction.update(reference, { ...value, revision: revision + 1, updatedAt: serverTimestamp(), updatedBy: user.uid });
      });
      return;
    }
    if (entry.kind === 'list-title') {
      const reference = doc(database, 'shoppingLists', entry.resourceId);
      await runTransaction(database, async transaction => {
        assertCurrentUser(user.uid);
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists()) throw Object.assign(new Error('Cloud তালিকাটি আর নেই।'), { conflict: true, remoteValue: null });
        const remote = snapshot.data(); const revision = Number(remote.revision || 0);
        const title = (entry.value as { title: string }).title;
        if (revision !== Number(entry.baseRevision)) {
          if (remote.updatedBy === user.uid && remote.title === title) return;
          throw Object.assign(new Error('অন্য কেউ তালিকার শিরোনাম পরিবর্তন করেছেন।'), { conflict: true, remoteValue: { ...remote, revision } });
        }
        transaction.update(reference, { title, revision: revision + 1, updatedAt: serverTimestamp(), updatedBy: user.uid });
      });
      return;
    }
    const reference = doc(database, 'shoppingLists', entry.resourceId, 'items', entry.targetId);
    await runTransaction(database, async transaction => {
      assertCurrentUser(user.uid);
      const snapshot = await transaction.get(reference);
      if (entry.operation === 'create-item') {
        const value = entry.value as Item;
        if (snapshot.exists()) {
          const remote = snapshot.data();
          if (remote.name === value.name && remote.qty === value.qty && remote.status === value.status && (remote.price ?? undefined) === value.price) return;
          throw Object.assign(new Error('এই পণ্যের ID-তে ভিন্ন Cloud item আছে।'), { conflict: true, remoteValue: { ...remote, revision: Number(remote.revision || 0) } });
        }
        const { id: _id, ...fields } = value;
        transaction.set(reference, { ...fields, revision: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: user.uid });
        return;
      }
      if (!snapshot.exists()) {
        if (entry.operation === 'delete-item') return;
        throw Object.assign(new Error('Cloud-এ পণ্যটি আর নেই.'), { conflict: true, remoteValue: null });
      }
      const remote = snapshot.data(); const revision = Number(remote.revision || 0);
      if (revision !== Number(entry.baseRevision)) {
        const intended = entry.operation === 'update-item' ? entry.value as Partial<Item> : null;
        const alreadyApplied = intended && remote.updatedBy === user.uid && Object.entries(intended).every(([key, value]) =>
          key === 'price' && value === undefined ? !Object.prototype.hasOwnProperty.call(remote, 'price') : remote[key] === value);
        if (alreadyApplied) return;
        throw Object.assign(new Error('অন্য কেউ এই পণ্যটি পরিবর্তন করেছেন।'), { conflict: true, remoteValue: { ...remote, revision } });
      }
      if (entry.operation === 'delete-item') transaction.delete(reference);
      else {
        const changes = entry.value as Partial<Item>;
        const update: Record<string, unknown> = { ...changes, revision: revision + 1, updatedAt: serverTimestamp(), updatedBy: user.uid };
        if (Object.prototype.hasOwnProperty.call(changes, 'price') && changes.price === undefined) update.price = deleteField();
        transaction.update(reference, update);
      }
    });
  });
}

export async function createInvite(user: User, kind: ResourceKind, resourceId: string, targetEmail: string, permission: ListPermission | NotePermission) {
  assertVerifiedUser(user);
  if (!user.emailVerified || !user.email) throw new Error('শেয়ার করার আগে আপনার ইমেইল যাচাই করুন।');
  const emailError = inviteTargetEmailError(user.email, targetEmail);
  if (emailError) throw new Error(emailError);
  const validPermission = kind === 'list'
    ? ['shopper', 'editor'].includes(permission)
    : kind === 'note' && ['viewer', 'editor'].includes(permission);
  if (!validPermission) throw new Error('এই resource-এর জন্য invite permission সঠিক নয়।');
  const database = requireDb();
  const invite = doc(collection(database, 'invites'));
  await setDoc(invite, { kind, resourceId, ownerUid: user.uid, targetEmail: normalizeEmail(targetEmail), permission, status: 'pending', createdAt: serverTimestamp(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
  return invite.id;
}

export async function acceptInvite(code: string, user: User) {
  assertVerifiedUser(user);
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

export async function updateMemberPermission(kind: ResourceKind, resourceId: string, actorUid: string, memberUid: string, permission: ListPermission | NotePermission) {
  assertCurrentUser(actorUid);
  const database = requireDb();
  const memberSnapshot = await getDoc(doc(database, memberPath(kind, resourceId, memberUid)));
  const batch = writeBatch(database);
  batch.update(doc(database, memberPath(kind, resourceId, memberUid)), { permission });
  batch.update(doc(database, refPath(memberUid, kind, resourceId)), { permission });
  const connectionId = memberSnapshot.data()?.connectionId as string | undefined;
  if (connectionId) {
    const historyRef = doc(database, 'connections', connectionId, 'sharedResources', `${kind}-${resourceId}`);
    const history = await getDoc(historyRef);
    if (history.exists()) batch.update(historyRef, { permission, updatedAt: serverTimestamp() });
  }
  await batch.commit();
}

export async function removeMember(kind: ResourceKind, resourceId: string, actorUid: string, memberUid: string) {
  assertCurrentUser(actorUid);
  const database = requireDb();
  const memberSnapshot = await getDoc(doc(database, memberPath(kind, resourceId, memberUid)));
  const batch = writeBatch(database);
  batch.delete(doc(database, memberPath(kind, resourceId, memberUid)));
  batch.delete(doc(database, refPath(memberUid, kind, resourceId)));
  const connectionId = memberSnapshot.data()?.connectionId as string | undefined;
  if (connectionId) {
    const historyRef = doc(database, 'connections', connectionId, 'sharedResources', `${kind}-${resourceId}`);
    const history = await getDoc(historyRef);
    if (history.exists()) batch.delete(historyRef);
  }
  await batch.commit();
}

export async function deleteOwnedResource(kind: ResourceKind, resourceId: string, ownerUid: string) {
  assertCurrentUser(ownerUid);
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
  for (const member of memberSnaps.docs) {
    const connectionId = member.data().connectionId as string | undefined;
    if (connectionId) operations.push(doc(database, 'connections', connectionId, 'sharedResources', `${kind}-${resourceId}`));
  }
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

export async function getMembers(kind: ResourceKind, resourceId: string, uid: string) {
  assertCurrentUser(uid);
  const database = requireDb();
  const result = await getDocs(collection(database, resourceCollection(kind), resourceId, 'members'));
  return result.docs.map(value => ({ uid: value.id, ...value.data() })) as { uid: string; permission: string; email?: string }[];
}

export async function getMember(kind: ResourceKind, resourceId: string, uid: string) {
  assertCurrentUser(uid);
  const snapshot = await getDoc(doc(requireDb(), memberPath(kind, resourceId, uid)));
  return snapshot.exists() ? { uid: snapshot.id, ...snapshot.data() } as { uid: string; permission: string; email?: string } : null;
}

export async function migrateLocalData(user: User, guestScope: StorageScope, selectedNoteIds: string[], selectedListIds: string[]) {
  assertVerifiedUser(user);
  if (guestScope.kind !== 'guest' || !guestScope.id) throw new Error('শুধু নির্দিষ্ট Guest space থেকে বেছে নেওয়া ডাটা কপি করা যাবে।');
  const [lists, notes] = await Promise.all([readLists(guestScope), readNotes(guestScope)]);
  const selectedLists = [...new Set(selectedListIds)];
  const selectedNotes = [...new Set(selectedNoteIds)];
  if (selectedLists.some(id => !lists[id]) || selectedNotes.some(id => !notes.some(note => note.id === id))) throw new Error('নির্বাচিত Guest ডাটা আর নেই। তালিকা রিফ্রেশ করে আবার বেছে নিন।');
  const migrated = { notes: 0, lists: 0 };
  for (const localId of selectedLists) {
    const list = lists[localId];
    if (list.cloudId) throw new Error(`তালিকা “${list.title}” আগেই cloud-এ যুক্ত। Migration-এ cloud link-যুক্ত record ашиг করা যাবে না।`);
    const cloudId = migrationResourceId(user.uid, guestScope.id, 'list', localId);
    await createOwnedList(user, list, cloudId);
    migrated.lists++;
  }
  for (const localId of selectedNotes) {
    const local = notes.find(value => value.id === localId)!;
    if (local.cloudId) throw new Error(`নোট “${local.title}” আগেই cloud-এ যুক্ত। Migration-এ cloud link-যুক্ত record ব্যবহার করা যাবে না।`);
    const cloudId = migrationResourceId(user.uid, guestScope.id, 'note', localId);
    await createOwnedNote(user, local, cloudId);
    migrated.notes++;
  }
  return migrated;
}
