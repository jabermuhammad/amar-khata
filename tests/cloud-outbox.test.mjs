import assert from 'node:assert/strict';
import test from 'node:test';
import { createCloudSyncStore } from '../src/lib/cloudOutbox.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
}

test('pending changes survive a new store instance and remain account isolated', async () => {
  const storage = memoryStorage(); const firstApp = createCloudSyncStore(storage);
  await firstApp.enqueue('uid-a', { uid: 'uid-a', kind: 'list-item', resourceId: 'list', targetId: 'item', operation: 'update-item', baseRevision: 2, value: { status: 'purchased' } });
  const afterRestart = createCloudSyncStore(storage);
  assert.equal((await afterRestart.list('uid-a')).length, 1);
  assert.equal((await afterRestart.list('uid-b')).length, 0);
});

test('list title edits persist across restart, remain UID scoped, and retry without losing the pending title', async () => {
  const storage = memoryStorage(); const store = createCloudSyncStore(storage);
  const entry = await store.enqueue('uid-a', { kind: 'list-title', resourceId: 'list-1', targetId: 'title', operation: 'update-title', baseRevision: 3, baseValue: { title: 'আগের' }, value: { title: 'নতুন' } });
  const afterRestart = createCloudSyncStore(storage);
  assert.equal((await afterRestart.list('uid-a'))[0].value.title, 'নতুন');
  assert.equal((await afterRestart.list('uid-b')).length, 0);
  await afterRestart.drain('uid-a', async () => { const error = new Error('offline'); error.code = 'unavailable'; throw error; });
  assert.equal((await afterRestart.list('uid-a'))[0].status, 'pending');
  await afterRestart.drain('uid-a', async () => { const error = new Error('revision conflict'); error.conflict = true; error.remoteValue = { title: 'Cloud title', revision: 4 }; throw error; });
  const [conflict] = await afterRestart.list('uid-a');
  assert.equal(conflict.id, entry.id);
  assert.equal(conflict.value.title, 'নতুন');
  assert.equal(conflict.remoteRevision, 4);
  await afterRestart.resolve('uid-a', entry.id, 'local');
  assert.equal((await afterRestart.list('uid-a'))[0].baseRevision, 4);
});

test('repeated edits coalesce and preserve the original conflict base revision', async () => {
  const store = createCloudSyncStore(memoryStorage());
  await store.enqueue('uid-a', { uid: 'uid-a', kind: 'list-item', resourceId: 'list', targetId: 'item', operation: 'update-item', baseRevision: 4, value: { name: 'আপেল' } });
  await store.enqueue('uid-a', { uid: 'uid-a', kind: 'list-item', resourceId: 'list', targetId: 'item', operation: 'update-item', baseRevision: 4, value: { status: 'purchased' } });
  const [entry] = await store.list('uid-a');
  assert.equal(entry.baseRevision, 4);
  assert.deepEqual(entry.value, { name: 'আপেল', status: 'purchased' });
  assert.equal((await store.list('uid-a')).length, 1);
});

test('drain preserves retryable offline work and blocks writes on a detected revision conflict', async () => {
  const store = createCloudSyncStore(memoryStorage());
  const entry = await store.enqueue('uid-a', { uid: 'uid-a', kind: 'note', resourceId: 'note', targetId: 'note', operation: 'save-note', baseRevision: 1, value: { title: 'স্থানীয়', body: 'draft' } });
  await store.drain('uid-a', async () => { const error = new Error('offline'); error.code = 'unavailable'; throw error; });
  assert.equal((await store.list('uid-a'))[0].status, 'pending');
  await store.drain('uid-a', async () => { const error = new Error('revision conflict'); error.conflict = true; error.remoteValue = { revision: 2, title: 'cloud', body: 'Cloud text' }; throw error; });
  const [conflict] = await store.list('uid-a');
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.value.title, 'স্থানীয়');
  assert.equal(conflict.remoteRevision, 2);
  await store.resolve('uid-a', entry.id, 'local');
  assert.equal((await store.list('uid-a'))[0].baseRevision, 2);
  await store.drain('uid-a', async () => { const error = new Error('second conflict'); error.conflict = true; error.remoteValue = { revision: 3, title: 'Cloud v3', body: 'Cloud body' }; throw error; });
  await store.resolve('uid-a', entry.id, 'remote');
  assert.equal((await store.list('uid-a')).length, 0);
});

test('permission-denied and unclassified errors block instead of being retried forever', async () => {
  const store = createCloudSyncStore(memoryStorage());
  const entry = await store.enqueue('uid-a', { kind: 'note', resourceId: 'note-secure', targetId: 'note', operation: 'save-note', baseRevision: 0, value: { title: 'local', body: '' } });
  const unknownEntry = await store.enqueue('uid-a', { kind: 'note', resourceId: 'note-unknown', targetId: 'note', operation: 'save-note', baseRevision: 0, value: { title: 'local', body: '' } });
  let calls = 0;
  const apply = async entryToApply => { calls++; const error = new Error('failed'); error.code = entryToApply.resourceId === 'note-secure' ? 'permission-denied' : 'unknown'; throw error; };
  await store.drain('uid-a', apply);
  await store.drain('uid-a', apply);
  const blocked = await store.list('uid-a');
  assert.equal(blocked.every(value => value.status === 'blocked'), true);
  assert.equal(calls, 2);
  assert.deepEqual(blocked.map(value => value.id), [entry.id, unknownEntry.id]);
});

test('a queued create followed by delete becomes an idempotent delete operation', async () => {
  const store = createCloudSyncStore(memoryStorage());
  await store.enqueue('uid-a', { uid: 'uid-a', kind: 'list-item', resourceId: 'list', targetId: 'new', operation: 'create-item', baseRevision: null, value: { id: 'new', name: 'তেল', qty: '১ বোতল', status: 'new' } });
  await store.enqueue('uid-a', { uid: 'uid-a', kind: 'list-item', resourceId: 'list', targetId: 'new', operation: 'delete-item', baseRevision: 0 });
  const [entry] = await store.list('uid-a');
  assert.equal(entry.operation, 'delete-item');
  assert.equal(entry.baseRevision, 0);
});

test('an edit arriving while a sync is in flight is not removed with the older write', async () => {
  const store = createCloudSyncStore(memoryStorage());
  await store.enqueue('uid-a', { uid: 'uid-a', kind: 'list-item', resourceId: 'list', targetId: 'item', operation: 'update-item', baseRevision: 0, value: { name: 'প্রথম' } });
  await store.drain('uid-a', async () => {
    await store.enqueue('uid-a', { uid: 'uid-a', kind: 'list-item', resourceId: 'list', targetId: 'item', operation: 'update-item', baseRevision: 0, value: { status: 'purchased' } });
  });
  const [entry] = await store.list('uid-a');
  assert.ok(entry);
  assert.deepEqual(entry.value, { name: 'প্রথম', status: 'purchased' });
});

test('a delete arriving while an item create is syncing remains queued after the create commits', async () => {
  const store = createCloudSyncStore(memoryStorage());
  await store.enqueue('uid-a', { uid: 'uid-a', kind: 'list-item', resourceId: 'list', targetId: 'item', operation: 'create-item', baseRevision: null, value: { id: 'item', name: 'তেল', qty: '১ বোতল', status: 'new' } });
  await store.drain('uid-a', async () => {
    await store.enqueue('uid-a', { uid: 'uid-a', kind: 'list-item', resourceId: 'list', targetId: 'item', operation: 'delete-item', baseRevision: 0 });
  });
  const [entry] = await store.list('uid-a');
  assert.equal(entry.operation, 'delete-item');
});

test('malformed, unsupported, mismatched-UID and inconsistent-key entries fail closed without overwriting the queue', async () => {
  const storage = memoryStorage(); const store = createCloudSyncStore(storage);
  const key = '@amar-khata/cloud-outbox/v1/uid-a';
  const valid = { uid: 'uid-a', kind: 'note', resourceId: 'note-1', targetId: 'note', operation: 'save-note', baseRevision: 0, value: { title: 'খসড়া', body: 'লেখা' }, status: 'pending', updatedAt: 1, id: 'note:note-1:note', key: 'note:note-1:note' };
  for (const malformed of [
    { ...valid, uid: 'uid-b' },
    { ...valid, operation: 'unsupported' },
    { ...valid, key: 'other-key' },
    { ...valid, baseRevision: -1 },
    { ...valid, status: 'conflict' },
    { ...valid, unexpected: true },
  ]) {
    const raw = JSON.stringify([malformed]);
    await storage.setItem(key, raw);
    await assert.rejects(store.list('uid-a'), /malformed|format/i);
    await assert.equal(await storage.getItem(key), raw);
    await assert.rejects(store.enqueue('uid-a', { kind: 'note', resourceId: 'other', targetId: 'note', operation: 'save-note', baseRevision: 0, value: { title: '', body: '' } }));
    await assert.equal(await storage.getItem(key), raw);
  }
});

test('conflict resolution accepts only local or remote choices', async () => {
  const store = createCloudSyncStore(memoryStorage());
  const entry = await store.enqueue('uid-a', { kind: 'note', resourceId: 'note-1', targetId: 'note', operation: 'save-note', baseRevision: 0, value: { title: 'local', body: '' } });
  await store.drain('uid-a', async () => { const error = new Error('conflict'); error.conflict = true; error.remoteValue = { revision: 1, title: 'remote', body: '' }; throw error; });
  await assert.rejects(store.resolve('uid-a', entry.id, 'keep-both'));
  assert.equal((await store.list('uid-a'))[0].status, 'conflict');
});

test('edits made while a conflict is visible stay durable and keep the original remote conflict', async () => {
  const storage = memoryStorage(); const store = createCloudSyncStore(storage);
  const entry = await store.enqueue('uid-a', { kind: 'note', resourceId: 'note-1', targetId: 'note', operation: 'save-note', baseRevision: 1, value: { title: 'আগের local', body: 'লেখা' } });
  await store.drain('uid-a', async () => { const error = new Error('conflict'); error.conflict = true; error.remoteValue = { revision: 2, title: 'Cloud', body: 'Cloud text' }; throw error; });
  await store.enqueue('uid-a', { kind: 'note', resourceId: 'note-1', targetId: 'note', operation: 'save-note', baseRevision: 2, value: { title: 'নতুন local', body: 'আরও লেখা' } });
  const afterRestart = createCloudSyncStore(storage);
  const [conflict] = await afterRestart.list('uid-a');
  assert.equal(conflict.id, entry.id);
  assert.equal(conflict.status, 'conflict');
  assert.deepEqual(conflict.value, { title: 'নতুন local', body: 'আরও লেখা' });
  assert.equal(conflict.remoteRevision, 2);
  assert.equal(conflict.remoteValue.title, 'Cloud');
});

test('delete conflict can rebase on the observed remote revision and becomes a new conflict if Cloud changes again', async () => {
  const store = createCloudSyncStore(memoryStorage());
  const entry = await store.enqueue('uid-a', { kind: 'list-item', resourceId: 'list-1', targetId: 'item-1', operation: 'delete-item', baseRevision: 2, baseValue: { id: 'item-1', name: 'চাল', qty: '১ কেজি', status: 'pending' } });
  await store.drain('uid-a', async () => { const error = new Error('remote edit'); error.conflict = true; error.remoteValue = { revision: 3, name: 'চাল', qty: '২ কেজি', status: 'pending' }; throw error; });
  assert.equal((await store.list('uid-a'))[0].status, 'conflict');
  await store.resolve('uid-a', entry.id, 'local');
  const [rebased] = await store.list('uid-a');
  assert.equal(rebased.operation, 'delete-item');
  assert.equal(rebased.baseRevision, 3);
  await store.drain('uid-a', async () => { const error = new Error('changed again'); error.conflict = true; error.remoteValue = { revision: 4, name: 'চাল', qty: '৩ কেজি', status: 'pending' }; throw error; });
  const [latest] = await store.list('uid-a');
  assert.equal(latest.status, 'conflict');
  assert.equal(latest.remoteRevision, 4);
  assert.equal(latest.operation, 'delete-item');
});

test('different account queues drain independently while one account drain is in flight', async () => {
  const store = createCloudSyncStore(memoryStorage());
  await store.enqueue('uid-a', { kind: 'note', resourceId: 'note-a', targetId: 'note', operation: 'save-note', baseRevision: 0, value: { title: 'A', body: '' } });
  await store.enqueue('uid-b', { kind: 'note', resourceId: 'note-b', targetId: 'note', operation: 'save-note', baseRevision: 0, value: { title: 'B', body: '' } });
  let releaseA;
  const gate = new Promise(resolve => { releaseA = resolve; });
  let aStarted = false;
  const drainingA = store.drain('uid-a', async entry => { aStarted = true; await gate; assert.equal(entry.uid, 'uid-a'); });
  while (!aStarted) await new Promise(resolve => setImmediate(resolve));
  let bApplied = false;
  const drainingB = store.drain('uid-b', async entry => { assert.equal(entry.uid, 'uid-b'); bApplied = true; });
  await drainingB;
  assert.equal(bApplied, true);
  releaseA();
  await drainingA;
  assert.equal((await store.list('uid-a')).length, 0);
  assert.equal((await store.list('uid-b')).length, 0);
});
