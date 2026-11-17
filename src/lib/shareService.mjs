/** Atomic share writes without reading a recipient-owned reference that may not exist yet. */
export async function shareResourceAtomically({
  database, user, connectionId, recipientUid, kind, resourceId, permission, title, firestore,
  assertCurrentUser, assertConnectionMember, validateSharedPermission,
}) {
  validateSharedPermission(kind, permission);
  const { doc, runTransaction, serverTimestamp } = firestore;
  const rootCollection = kind === 'list' ? 'shoppingLists' : 'notes';
  const connectionRef = doc(database, 'connections', connectionId);
  const rootRef = doc(database, rootCollection, resourceId);
  const memberRef = doc(database, rootCollection, resourceId, 'members', recipientUid);
  const recipientResourceRef = doc(database, 'users', recipientUid, 'resourceRefs', `${kind}-${resourceId}`);
  const historyRef = doc(database, 'connections', connectionId, 'sharedResources', `${kind}-${resourceId}`);

  await runTransaction(database, async transaction => {
    assertCurrentUser(user.uid);
    const [connectionSnap, rootSnap, memberSnap] = await Promise.all([
      transaction.get(connectionRef), transaction.get(rootRef), transaction.get(memberRef),
    ]);
    if (!connectionSnap.exists()) throw new Error('পরিচিতির সংযোগ পাওয়া যায়নি।');
    if (assertConnectionMember(connectionSnap.data(), user.uid) !== recipientUid) throw new Error('নির্বাচিত পরিচিতির সঙ্গে সংযোগ মেলে না।');
    if (!rootSnap.exists() || rootSnap.data().ownerUid !== user.uid || rootSnap.data().deleting === true) throw new Error('শুধু সক্রিয় resource-এর মালিক এটি শেয়ার করতে পারবেন।');
    if (memberSnap.exists() && memberSnap.data().permission === 'owner') throw new Error('Owner permission অন্য account-এ দেওয়া যাবে না।');

    const timestamp = serverTimestamp();
    if (memberSnap.exists()) transaction.update(memberRef, { permission, connectionId });
    else transaction.set(memberRef, { uid: recipientUid, permission, joinedAt: timestamp, connectionId });
    // A missing recipient ref cannot be read under the Rules. A merge write is
    // authorized atomically by the matching membership and resource owner.
    transaction.set(recipientResourceRef, { kind, resourceId, permission, createdAt: timestamp }, { merge: true });
    transaction.set(historyRef, { kind, resourceId, fromUid: user.uid, toUid: recipientUid, permission, title: title.trim().slice(0, 120), createdAt: timestamp, updatedAt: timestamp });
    assertCurrentUser(user.uid);
    transaction.update(connectionRef, { updatedAt: timestamp });
  });
  return resourceId;
}

/** Share sequentially per recipient and retain explicit partial-failure results. */
export async function shareToContactsSequentially(contacts, shareOne) {
  const seen = new Set();
  const succeeded = [];
  const failed = [];
  for (const contact of contacts) {
    if (!contact?.connectionId || seen.has(contact.connectionId)) continue;
    seen.add(contact.connectionId);
    try {
      await shareOne(contact);
      succeeded.push(contact.connectionId);
    } catch (error) {
      failed.push({ connectionId: contact.connectionId, name: contact.profile?.displayName || 'পরিচিতি', error: error instanceof Error ? error.message : String(error || 'শেয়ার ব্যর্থ') });
    }
  }
  return { succeeded, failed };
}
