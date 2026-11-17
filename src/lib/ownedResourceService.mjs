async function createOrVerify({ readMembership, readExisting, createAtomically, verifyExisting }) {
  const membership = await readMembership();
  if (membership.exists()) return verifyExisting(await readExisting(membership));

  try {
    return await createAtomically();
  } catch (createError) {
    // A commit can succeed remotely while its response is lost. Only treat it as
    // a retry when this user's membership now exists and the full record matches.
    let committedMembership;
    try { committedMembership = await readMembership(); }
    catch { throw createError; }
    if (!committedMembership.exists()) throw createError;
    return verifyExisting(await readExisting(committedMembership));
  }
}

export async function createOwnedListInFirestore({ database, user, list, id, firestore, sameListContent }) {
  const { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } = firestore;
  const root = doc(database, 'shoppingLists', id);
  const membership = doc(database, 'shoppingLists', id, 'members', user.uid);
  const userRef = doc(database, 'users', user.uid, 'resourceRefs', `list-${id}`);
  const readMembership = () => getDoc(membership);
  const readExisting = async memberSnap => {
    const [rootSnap, refSnap, itemSnap] = await Promise.all([
      getDoc(root), getDoc(userRef), getDocs(collection(database, 'shoppingLists', id, 'items')),
    ]);
    return { rootSnap, memberSnap, refSnap, itemSnap };
  };
  const verifyExisting = existing => {
    const { rootSnap, memberSnap, refSnap, itemSnap } = existing;
    if (!rootSnap.exists()) throw new Error('এই তালিকার membership আছে, কিন্তু মূল তালিকা নেই; কোনো ডাটা লেখা হয়নি।');
    const data = rootSnap.data();
    if (data.ownerUid !== user.uid || data.title !== list.title || (data.category || 'today') !== (list.category || 'today')
      || memberSnap.data().permission !== 'owner' || !refSnap.exists() || refSnap.data().kind !== 'list'
      || refSnap.data().resourceId !== id || refSnap.data().permission !== 'owner') {
      throw new Error('এই তালিকা ID-তে ভিন্ন, অন্য account-এর বা অসম্পূর্ণ permission-এর ডাটা আছে; overwrite করা হয়নি।');
    }
    const remoteItems = itemSnap.docs.map(item => {
      const itemData = item.data();
      return { id: item.id, name: String(itemData.name || ''), qty: String(itemData.qty || ''), status: String(itemData.status || ''), ...(typeof itemData.price === 'number' ? { price: itemData.price } : {}) };
    });
    if (!sameListContent({ title: data.title, category: data.category, items: remoteItems }, list)) {
      throw new Error('এই তালিকার বিদ্যমান কপিতে ভিন্ন item আছে; overwrite করা হয়নি।');
    }
    return id;
  };
  const createAtomically = async () => {
    const batch = writeBatch(database);
    const timestamp = serverTimestamp();
    batch.set(root, { ownerUid: user.uid, title: list.title, category: list.category || 'today', createdAt: list.createdAt || new Date().toISOString(), updatedAt: timestamp, schemaVersion: 1 });
    batch.set(membership, { uid: user.uid, permission: 'owner', joinedAt: timestamp });
    batch.set(userRef, { kind: 'list', resourceId: id, permission: 'owner', createdAt: timestamp });
    for (const item of list.items) {
      const itemId = String(item.id);
      const { id: _itemId, ...fields } = item;
      batch.set(doc(database, 'shoppingLists', id, 'items', itemId), { ...fields, createdAt: timestamp, updatedAt: timestamp, updatedBy: user.uid });
    }
    await batch.commit();
    return id;
  };
  return createOrVerify({ readMembership, readExisting, createAtomically, verifyExisting });
}

export async function createOwnedNoteInFirestore({ database, user, note, id, firestore, sameNoteContent }) {
  const { doc, getDoc, serverTimestamp, writeBatch } = firestore;
  const root = doc(database, 'notes', id);
  const membership = doc(database, 'notes', id, 'members', user.uid);
  const userRef = doc(database, 'users', user.uid, 'resourceRefs', `note-${id}`);
  const readMembership = () => getDoc(membership);
  const readExisting = async memberSnap => {
    const [rootSnap, refSnap] = await Promise.all([getDoc(root), getDoc(userRef)]);
    return { rootSnap, memberSnap, refSnap };
  };
  const verifyExisting = existing => {
    const { rootSnap, memberSnap, refSnap } = existing;
    if (!rootSnap.exists()) throw new Error('এই নোটের membership আছে, কিন্তু মূল নোট নেই; কোনো ডাটা লেখা হয়নি।');
    const data = rootSnap.data();
    if (data.ownerUid !== user.uid || memberSnap.data().permission !== 'owner' || !refSnap.exists()
      || refSnap.data().kind !== 'note' || refSnap.data().resourceId !== id || refSnap.data().permission !== 'owner') {
      throw new Error('এই নোট ID-তে ভিন্ন, অন্য account-এর বা অসম্পূর্ণ permission-এর ডাটা আছে; overwrite করা হয়নি।');
    }
    if (!sameNoteContent({ title: String(data.title || ''), body: String(data.body || '') }, note)) {
      throw new Error('এই নোটের বিদ্যমান কপিতে ভিন্ন লেখা আছে; overwrite করা হয়নি।');
    }
    return id;
  };
  const createAtomically = async () => {
    const batch = writeBatch(database);
    const timestamp = serverTimestamp();
    batch.set(root, { ownerUid: user.uid, title: note.title, body: note.body, createdAt: note.createdAt || new Date().toISOString(), updatedAt: timestamp, revision: 0, schemaVersion: 1 });
    batch.set(membership, { uid: user.uid, permission: 'owner', joinedAt: timestamp });
    batch.set(userRef, { kind: 'note', resourceId: id, permission: 'owner', createdAt: timestamp });
    await batch.commit();
    return id;
  };
  return createOrVerify({ readMembership, readExisting, createAtomically, verifyExisting });
}

export async function loadResourceSummariesFromFirestore({ database, uid, firestore, permissionForSummary }) {
  const { collection, doc, getDoc, getDocs, orderBy, query } = firestore;
  let refDocs;
  try {
    refDocs = (await getDocs(query(collection(database, 'users', uid, 'resourceRefs'), orderBy('createdAt', 'desc')))).docs;
  } catch (error) {
    const wrapped = new Error(`Cloud resource reference পড়া যায়নি${error?.code ? ` (${error.code})` : ''}.`, { cause: error });
    wrapped.operation = 'resource-refs-query';
    wrapped.code = error?.code;
    throw wrapped;
  }

  const outcomes = await Promise.all(refDocs.map(async refDoc => {
    const raw = refDoc.data();
    const kind = raw.kind;
    const resourceId = typeof raw.resourceId === 'string' ? raw.resourceId : '';
    const issue = (operation, reason, code) => ({ kind, resourceId: resourceId || undefined, operation, reason, ...(code ? { code } : {}) });
    if ((kind !== 'list' && kind !== 'note') || !resourceId.trim()) {
      return { issue: issue('reference-validation', 'invalid-reference') };
    }
    const rootCollection = kind === 'list' ? 'shoppingLists' : 'notes';
    const member = doc(database, rootCollection, resourceId, 'members', uid);
    let membership;
    try { membership = await getDoc(member); }
    catch (error) { return { issue: issue('membership-read', error?.code === 'permission-denied' ? 'permission-denied' : 'read-failed', error?.code) }; }
    if (!membership.exists()) return { issue: issue('membership-read', 'missing-membership') };
    let permission;
    try { permission = permissionForSummary(kind, membership.data()); }
    catch { return { issue: issue('membership-validation', 'invalid-permission') }; }
    if (!permission) return { issue: issue('membership-validation', 'missing-membership') };

    let root;
    try { root = await getDoc(doc(database, rootCollection, resourceId)); }
    catch (error) { return { issue: issue('resource-root-read', error?.code === 'permission-denied' ? 'permission-denied' : 'read-failed', error?.code) }; }
    if (!root.exists()) return { issue: issue('resource-root-read', 'missing-resource') };
    const data = root.data();
    if (data.deleting === true) return { issue: issue('resource-root-read', 'inactive-resource') };
    return { summary: { id: resourceId, kind, permission, title: String(data.title || (kind === 'list' ? 'নতুন বাজারের তালিকা' : 'শিরোনামহীন নোট')), date: data.createdAt, category: kind === 'list' ? data.category : undefined, ownerUid: data.ownerUid } };
  }));
  return { summaries: outcomes.flatMap(outcome => outcome.summary ? [outcome.summary] : []), issues: outcomes.flatMap(outcome => outcome.issue ? [outcome.issue] : []) };
}

export function formatResourceSummaryIssues(issues) {
  if (!issues?.length) return '';
  const permissionDenied = issues.filter(issue => issue.reason === 'permission-denied').length;
  const missingMembership = issues.filter(issue => issue.reason === 'missing-membership').length;
  const missingResource = issues.filter(issue => issue.reason === 'missing-resource').length;
  const inactive = issues.filter(issue => issue.reason === 'inactive-resource').length;
  const other = issues.length - permissionDenied - missingMembership - missingResource - inactive;
  const parts = [];
  if (permissionDenied) parts.push(`${permissionDenied}টি resource-এ permission denied`);
  if (missingMembership) parts.push(`${missingMembership}টি পুরোনো reference-এ membership নেই`);
  if (missingResource) parts.push(`${missingResource}টি reference-এর resource নেই`);
  if (inactive) parts.push(`${inactive}টি resource বন্ধ বা মুছে ফেলার প্রক্রিয়ায়`);
  if (other) parts.push(`${other}টি reference যাচাই করা যায়নি`);
  return `কিছু Cloud item লোড হয়নি (${parts.join(', ')}); অন্য বৈধ item দেখানো হয়েছে। কোনো reference স্বয়ংক্রিয়ভাবে মুছে ফেলা হয়নি।`;
}
