const VERSION = 1;
const locks = new Map();
const drains = new Map();
let sequence = 0;

function assertUid(uid) {
  if (typeof uid !== 'string' || !uid.trim() || uid.includes('/')) throw new Error('Cloud sync-এর account ID সঠিক নয়।');
}

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function validateEntry(entry, uid) {
  const fail = () => { throw new Error('Cloud sync queue-এ অসমর্থিত বা malformed পরিবর্তন আছে; এটি চালানো বা বাদ দেওয়া হয়নি।'); };
  if (!isRecord(entry)) fail();
  const allowed = new Set(['uid', 'kind', 'resourceId', 'targetId', 'operation', 'baseRevision', 'baseValue', 'value', 'status', 'updatedAt', 'createdAt', 'id', 'key', 'error', 'remoteValue', 'remoteRevision']);
  if (Object.keys(entry).some(key => !allowed.has(key))) fail();
  if (entry.uid !== uid || typeof entry.resourceId !== 'string' || !entry.resourceId || entry.resourceId.includes('/') || typeof entry.targetId !== 'string' || !entry.targetId || entry.targetId.includes('/')) fail();
  if (!['pending', 'conflict', 'blocked'].includes(entry.status)) fail();
  const validRevision = value => value === null || Number.isSafeInteger(value) && value >= 0;
  if (!validRevision(entry.baseRevision) || !['string', 'number'].includes(typeof entry.updatedAt)) fail();
  if (entry.createdAt !== undefined && !['string', 'number'].includes(typeof entry.createdAt)) fail();
  if (entry.baseValue !== undefined && !isRecord(entry.baseValue)) fail();
  if (entry.error !== undefined && typeof entry.error !== 'string') fail();
  if (entry.status === 'blocked' && typeof entry.error !== 'string') fail();
  if (entry.status === 'conflict' && (!validRevision(entry.remoteRevision) || !Object.prototype.hasOwnProperty.call(entry, 'remoteValue') || typeof entry.error !== 'string')) fail();
  if (entry.status !== 'conflict' && (entry.remoteRevision !== undefined || entry.remoteValue !== undefined)) fail();
  const validNote = entry.kind === 'note' && entry.targetId === 'note' && entry.operation === 'save-note'
    && entry.baseRevision !== null && isRecord(entry.value) && typeof entry.value.title === 'string' && typeof entry.value.body === 'string';
  const validListTitle = entry.kind === 'list-title' && entry.targetId === 'title' && entry.operation === 'update-title'
    && entry.baseRevision !== null && isRecord(entry.value) && typeof entry.value.title === 'string' && entry.value.title.length <= 120;
  const itemOperations = ['create-item', 'update-item', 'delete-item'];
  const validItem = entry.kind === 'list-item' && itemOperations.includes(entry.operation)
    && (entry.operation === 'create-item' ? entry.baseRevision === null && isRecord(entry.value)
      : entry.baseRevision !== null && (entry.operation === 'delete-item' ? entry.value === undefined : isRecord(entry.value)));
  if (!validNote && !validListTitle && !validItem) fail();
  if (entry.kind === 'list-item' && entry.operation !== 'delete-item' && isRecord(entry.value)) {
    const valueKeys = new Set(['id', 'name', 'qty', 'price', 'status']);
    if (Object.keys(entry.value).some(key => !valueKeys.has(key))) fail();
    if (entry.operation === 'create-item' && (typeof entry.value.name !== 'string' || typeof entry.value.qty !== 'string' || typeof entry.value.status !== 'string')) fail();
    if (entry.operation === 'create-item' && String(entry.value.id) !== entry.targetId) fail();
    if (entry.value.price !== undefined && (typeof entry.value.price !== 'number' || !Number.isFinite(entry.value.price))) fail();
    if (entry.value.id !== undefined && !['string', 'number'].includes(typeof entry.value.id)) fail();
    if (entry.value.name !== undefined && typeof entry.value.name !== 'string') fail();
    if (entry.value.qty !== undefined && typeof entry.value.qty !== 'string') fail();
    if (entry.value.status !== undefined && !['new', 'pending', 'purchased', 'omitted'].includes(entry.value.status)) fail();
  }
  if (entry.kind === 'list-item' && entry.baseValue !== undefined) {
    const baseKeys = new Set(['id', 'name', 'qty', 'price', 'status', 'revision', 'updatedBy', 'createdAt', 'updatedAt']);
    if (Object.keys(entry.baseValue).some(key => !baseKeys.has(key))) fail();
    if (entry.baseValue.name !== undefined && typeof entry.baseValue.name !== 'string') fail();
    if (entry.baseValue.qty !== undefined && typeof entry.baseValue.qty !== 'string') fail();
    if (entry.baseValue.price !== undefined && (typeof entry.baseValue.price !== 'number' || !Number.isFinite(entry.baseValue.price))) fail();
    if (entry.baseValue.status !== undefined && !['new', 'pending', 'purchased', 'omitted'].includes(entry.baseValue.status)) fail();
    if (entry.baseValue.revision !== undefined && !validRevision(entry.baseValue.revision)) fail();
    if (entry.baseValue.updatedBy !== undefined && typeof entry.baseValue.updatedBy !== 'string') fail();
  }
  if (entry.kind === 'note' && isRecord(entry.value) && Object.keys(entry.value).some(key => !['title', 'body'].includes(key))) fail();
  if (entry.status === 'conflict' && entry.remoteValue !== null) {
    if (!isRecord(entry.remoteValue)) fail();
    const remoteKeys = entry.kind === 'note'
      ? new Set(['ownerUid', 'title', 'body', 'revision', 'updatedBy', 'createdAt', 'updatedAt', 'deleting', 'schemaVersion'])
      : entry.kind === 'list-title'
        ? new Set(['ownerUid', 'title', 'category', 'revision', 'updatedBy', 'createdAt', 'updatedAt', 'deleting', 'schemaVersion'])
      : new Set(['name', 'qty', 'price', 'status', 'revision', 'updatedBy', 'createdAt', 'updatedAt']);
    if (Object.keys(entry.remoteValue).some(key => !remoteKeys.has(key))) fail();
    if (entry.remoteValue.revision !== undefined && !validRevision(entry.remoteValue.revision)) fail();
    if ((entry.kind === 'note' || entry.kind === 'list-title') && typeof entry.remoteValue.title !== 'string') fail();
    if (entry.kind === 'note' && typeof entry.remoteValue.body !== 'string') fail();
    if (entry.kind === 'list-item' && (typeof entry.remoteValue.name !== 'string' || typeof entry.remoteValue.qty !== 'string' || !['new', 'pending', 'purchased', 'omitted'].includes(entry.remoteValue.status))) fail();
    if (entry.remoteValue.price !== undefined && (typeof entry.remoteValue.price !== 'number' || !Number.isFinite(entry.remoteValue.price))) fail();
  }
  const expectedKey = `${entry.kind}:${entry.resourceId}:${entry.targetId}`;
  if (entry.id !== expectedKey || entry.key !== expectedKey) fail();
  return entry;
}

function serializeChange(change) {
  const key = `${change.kind}:${change.resourceId}:${change.targetId}`;
  return { ...change, id: key, key, status: 'pending', updatedAt: `${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}` };
}

export function createCloudSyncStore(storage) {
  async function locked(uid, operation) {
    const previous = locks.get(uid) || Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const chain = previous.then(() => gate);
    locks.set(uid, chain);
    await previous;
    try { return await operation(); }
    finally { release(); if (locks.get(uid) === chain) locks.delete(uid); }
  }
  const queueKey = uid => `@amar-khata/cloud-outbox/v${VERSION}/${encodeURIComponent(uid)}`;
  const cacheKey = (uid, kind, id) => `@amar-khata/cloud-cache/v${VERSION}/${encodeURIComponent(uid)}/${kind}/${encodeURIComponent(id)}`;
  async function read(uid) {
    assertUid(uid);
    const raw = await storage.getItem(queueKey(uid));
    if (!raw) return [];
    let value;
    try { value = JSON.parse(raw); } catch (error) { throw new Error('Cloud sync queue পড়া যায়নি; pending পরিবর্তন অক্ষত রাখা হয়েছে।', { cause: error }); }
    if (!Array.isArray(value)) {
      throw new Error('Cloud sync queue-এর format সঠিক নয়; recovery ছাড়া পরিবর্তন করা হয়নি।');
    }
    const ids = new Set();
    for (const entry of value) {
      validateEntry(entry, uid);
      if (ids.has(entry.id)) throw new Error('Cloud sync queue-এ duplicate operation আছে; recovery ছাড়া পরিবর্তন করা হয়নি।');
      ids.add(entry.id);
    }
    return value;
  }
  async function write(uid, entries) {
    assertUid(uid);
    for (const entry of entries) validateEntry(entry, uid);
    if (entries.length) await storage.setItem(queueKey(uid), JSON.stringify(entries));
    else await storage.removeItem(queueKey(uid));
  }
  async function list(uid) { return read(uid); }
  async function enqueue(uid, change) {
    assertUid(uid);
    if (!change || change.uid && change.uid !== uid) throw new Error('Pending change-এর account মেলেনি।');
    return locked(uid, async () => {
      const entries = await read(uid);
      const next = serializeChange({ ...change, uid });
      const index = entries.findIndex(entry => entry.id === next.id);
      if (index < 0) entries.push(next);
      else {
        const existing = entries[index];
        if (existing.status !== 'pending' && existing.operation !== next.operation && !(existing.operation === 'create-item' && next.operation === 'update-item')) {
          throw new Error('এই পরিবর্তনে conflict আছে; আগে সেটি সমাধান করুন।');
        }
        // Coalesce edits for the same document but retain the first server base
        // version so the eventual write cannot silently overwrite a collaborator.
        if (existing.status !== 'pending') {
          const mergedValue = existing.operation === 'create-item' && next.operation === 'update-item'
            ? { ...(existing.value || {}), ...(next.value || {}) }
            : existing.operation === 'update-item' && next.operation === 'update-item'
              ? { ...(existing.value || {}), ...(next.value || {}) }
              : next.value;
          entries[index] = {
            ...existing, ...next,
            operation: existing.operation === 'create-item' && next.operation === 'update-item' ? 'create-item' : next.operation,
            value: mergedValue, status: existing.status,
            baseRevision: existing.baseRevision, baseValue: existing.baseValue,
            remoteValue: existing.remoteValue, remoteRevision: existing.remoteRevision, error: existing.error,
            createdAt: existing.createdAt,
          };
        } else if (existing.operation === 'create-item' && next.operation === 'delete-item') {
          entries[index] = { ...next, baseRevision: 0, baseValue: existing.value, createdAt: existing.createdAt };
        } else if (existing.operation === 'create-item' && next.operation === 'update-item') {
          entries[index] = { ...existing, value: { ...(existing.value || {}), ...(next.value || {}) }, updatedAt: next.updatedAt };
        } else {
          entries[index] = {
            ...existing, ...next,
            value: existing.operation === 'update-item' && next.operation === 'update-item'
              ? { ...(existing.value || {}), ...(next.value || {}) } : next.value,
            baseRevision: existing.baseRevision, baseValue: existing.baseValue, createdAt: existing.createdAt,
          };
        }
      }
      await write(uid, entries);
      return entries.find(entry => entry.id === next.id) || null;
    });
  }
  async function remove(uid, id) {
    return locked(uid, async () => { const entries = await read(uid); await write(uid, entries.filter(entry => entry.id !== id)); });
  }
  async function removeIfUnchanged(uid, id, updatedAt) {
    return locked(uid, async () => {
      const entries = await read(uid); const index = entries.findIndex(entry => entry.id === id);
      if (index >= 0 && entries[index].updatedAt === updatedAt) { entries.splice(index, 1); await write(uid, entries); }
    });
  }
  async function markConflict(uid, id, remote, message) {
    return locked(uid, async () => {
      const entries = await read(uid);
      const entry = entries.find(value => value.id === id);
      if (!entry) return;
      entry.status = 'conflict'; entry.remoteValue = remote; entry.remoteRevision = Number(remote?.revision || 0); entry.error = message;
      await write(uid, entries);
    });
  }
  async function markBlocked(uid, id, message) {
    return locked(uid, async () => {
      const entries = await read(uid); const entry = entries.find(value => value.id === id);
      if (entry) { entry.status = 'blocked'; entry.error = message; await write(uid, entries); }
    });
  }
  async function resolve(uid, id, choice) {
    assertUid(uid);
    if (choice !== 'local' && choice !== 'remote') throw new Error('Conflict সমাধানের পছন্দ সঠিক নয়।');
    return locked(uid, async () => {
      const entries = await read(uid); const index = entries.findIndex(value => value.id === id);
      if (index < 0 || entries[index].status !== 'conflict') return false;
      if (choice === 'remote') entries.splice(index, 1);
      else entries[index] = { ...entries[index], baseRevision: entries[index].remoteRevision, baseValue: entries[index].remoteValue, status: 'pending', error: undefined, remoteValue: undefined, remoteRevision: undefined, updatedAt: Date.now() };
      await write(uid, entries); return true;
    });
  }
  async function retry(uid, id) {
    assertUid(uid);
    return locked(uid, async () => {
      const entries = await read(uid); const entry = entries.find(value => value.id === id);
      if (!entry || entry.status !== 'blocked') return false;
      entry.status = 'pending'; entry.error = undefined; entry.updatedAt = `${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`;
      await write(uid, entries); return true;
    });
  }
  async function drainInternal(uid, apply) {
    for (const entry of await read(uid)) {
      if (entry.status !== 'pending') continue;
      try { await apply(entry); await removeIfUnchanged(uid, entry.id, entry.updatedAt); }
      catch (error) {
        if (error?.conflict) { await markConflict(uid, entry.id, error.remoteValue, error.message); continue; }
        const code = typeof error?.code === 'string' ? error.code.replace(/^firestore\//, '') : '';
        if (error?.retryable || ['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(code)) return { synced: false, pending: true, error };
        await markBlocked(uid, entry.id, error instanceof Error ? error.message : 'পরিবর্তন সিঙ্ক করা যায়নি।');
      }
    }
    const remaining = await read(uid);
    return { synced: remaining.length === 0, pending: remaining.length > 0, entries: remaining };
  }
  async function drain(uid, apply) {
    assertUid(uid);
    if (drains.has(uid)) return drains.get(uid);
    const promise = drainInternal(uid, apply);
    drains.set(uid, promise);
    try { return await promise; }
    finally { if (drains.get(uid) === promise) drains.delete(uid); }
  }
  async function readCache(uid, kind, id) {
    const raw = await storage.getItem(cacheKey(uid, kind, id));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  async function writeCache(uid, kind, id, value) {
    await storage.setItem(cacheKey(uid, kind, id), JSON.stringify(value));
  }
  async function removeCache(uid, kind, id) { await storage.removeItem(cacheKey(uid, kind, id)); }
  return { list, enqueue, remove, resolve, retry, drain, readCache, writeCache, removeCache };
}
