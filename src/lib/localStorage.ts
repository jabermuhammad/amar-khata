import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORE, normalizeStoredLists, type Note, type ShoppingList } from '../data';
import { scopePart, scopedKey } from './storagePolicy.mjs';

export type StorageScope = { kind: 'guest'; id: string } | { kind: 'user'; uid: string };
export type LocalRecordKind = 'lists' | 'notes' | 'photo' | 'preferences';

const INSTALLATION_ID_KEY = '@amar-khata/installation-id';
const SESSION_MODE_KEY = '@amar-khata/session-mode';
const PENDING_GUEST_IMPORT_KEY = '@amar-khata/pending-guest-import';
const legacyJournalKey = (scope: StorageScope) => `@amar-khata/migration/legacy-to-${scopePart(scope)}`;
export const LEGACY_DATA_KEYS = { lists: STORE.lists, notes: STORE.notes, note: STORE.note, photo: STORE.photo } as const;

export const scopedStorageKey = (scope: StorageScope, kind: LocalRecordKind) => scopedKey(scope, kind);
export const storageScopeId = (scope: StorageScope) => scopePart(scope);
export const sessionModeKey = SESSION_MODE_KEY;
export const pendingGuestImportKey = PENDING_GUEST_IMPORT_KEY;

export class LocalStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'LocalStorageError'; }
}

const parse = <T>(value: string | null, fallback: T): T => {
  if (value === null) return fallback;
  try { return JSON.parse(value) as T; }
  catch (error) { throw new LocalStorageError('লোকাল ডাটা পড়া যায়নি। ডাটা অক্ষত রাখা হয়েছে; মেরামত বা backup ছাড়া আবার সেভ করবেন না।', { cause: error }); }
};

function validateLists(value: unknown): Record<string, ShoppingList> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LocalStorageError('লোকাল তালিকার ডাটা কাঠামো সঠিক নয়; মূল ডাটা অক্ষত রাখা হয়েছে।');
  for (const [id, raw] of Object.entries(value)) {
    if (!id || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new LocalStorageError('লোকাল তালিকার একটি রেকর্ড পড়া যায়নি; মূল ডাটা অক্ষত রাখা হয়েছে।');
    const list = raw as Partial<ShoppingList>;
    if (typeof list.title !== 'string' || !Array.isArray(list.items)) throw new LocalStorageError('লোকাল তালিকার একটি রেকর্ড অসম্পূর্ণ; মূল ডাটা অক্ষত রাখা হয়েছে।');
    if (list.items.some(item => !item || typeof item !== 'object' || !('id' in item) || typeof item.name !== 'string' || typeof item.qty !== 'string')) throw new LocalStorageError('লোকাল তালিকার পণ্যের ডাটা সঠিক নয়; মূল ডাটা অক্ষত রাখা হয়েছে।');
    if (new Set(list.items.map(item => String(item.id))).size !== list.items.length) throw new LocalStorageError('লোকাল তালিকায় একই পণ্যের ID একাধিকবার আছে; conflict মেটানো পর্যন্ত ডাটা সেভ বন্ধ।');
  }
  return normalizeStoredLists(value);
}

function validateNotes(value: unknown): (Note & { id: string })[] {
  if (!Array.isArray(value)) throw new LocalStorageError('লোকাল নোটের ডাটা কাঠামো সঠিক নয়; মূল ডাটা অক্ষত রাখা হয়েছে।');
  const ids = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id || typeof raw.title !== 'string' || typeof raw.body !== 'string') throw new LocalStorageError('লোকাল নোটের একটি রেকর্ড অসম্পূর্ণ; মূল ডাটা অক্ষত রাখা হয়েছে।');
    if (ids.has(raw.id)) throw new LocalStorageError('লোকাল নোটে একই ID একাধিকবার আছে; conflict মেটানো পর্যন্ত ডাটা সেভ করা বন্ধ।');
    ids.add(raw.id);
  }
  return value as (Note & { id: string })[];
}

export async function getInstallationId() {
  const existing = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  await AsyncStorage.setItem(INSTALLATION_ID_KEY, id);
  return id;
}

export const guestScopeFor = (id: string): StorageScope => ({ kind: 'guest', id });
export const accountScopeFor = (uid: string): StorageScope => ({ kind: 'user', uid });

export async function readLists(scope: StorageScope): Promise<Record<string, ShoppingList>> {
  return validateLists(parse(await AsyncStorage.getItem(scopedStorageKey(scope, 'lists')), {}));
}

export async function writeLists(scope: StorageScope, value: Record<string, ShoppingList>) {
  validateLists(value);
  await AsyncStorage.setItem(scopedStorageKey(scope, 'lists'), JSON.stringify(value));
}

export async function readNotes(scope: StorageScope): Promise<(Note & { id: string })[]> {
  return validateNotes(parse(await AsyncStorage.getItem(scopedStorageKey(scope, 'notes')), []));
}

export async function writeNotes(scope: StorageScope, value: (Note & { id: string })[]) {
  validateNotes(value);
  await AsyncStorage.setItem(scopedStorageKey(scope, 'notes'), JSON.stringify(value));
}

/** Link/unlink only a record in the selected namespace; refuse stale/mismatched IDs. */
export async function setScopedCloudLink(scope: StorageScope, kind: 'lists' | 'notes', localId: string, cloudId: string | null, fallback?: ShoppingList | Note) {
  if (kind === 'lists') {
    const lists = await readLists(scope);
    const existing = lists[localId];
    if (!existing && !fallback) throw new LocalStorageError('এই scope-এ তালিকাটি নেই; cloud link লেখা হয়নি।');
    if (existing?.cloudId && cloudId && existing.cloudId !== cloudId) throw new LocalStorageError('তালিকাটি অন্য cloud resource-এর সঙ্গে যুক্ত; link পরিবর্তন করা হয়নি।');
    if (cloudId) lists[localId] = { ...(existing || fallback as ShoppingList), cloudId };
    else if (existing) { const { cloudId: _old, ...local } = existing; lists[localId] = local; }
    await writeLists(scope, lists);
    return;
  }
  const notes = await readNotes(scope);
  const existing = notes.find(value => value.id === localId);
  if (!existing && !fallback) throw new LocalStorageError('এই scope-এ নোটটি নেই; cloud link লেখা হয়নি।');
  if (existing?.cloudId && cloudId && existing.cloudId !== cloudId) throw new LocalStorageError('নোটটি অন্য cloud resource-এর সঙ্গে যুক্ত; link পরিবর্তন করা হয়নি।');
  const next = notes.filter(value => value.id !== localId);
  if (cloudId) next.unshift({ ...(existing || fallback as Note), id: localId, cloudId });
  else if (existing) next.unshift({ ...existing, cloudId: undefined });
  await writeNotes(scope, next);
}

/** Remove the matching scoped record only after the remote deletion is confirmed. */
export async function deleteScopedCloudResource(scope: StorageScope, kind: 'lists' | 'notes', localId: string, cloudId: string) {
  if (kind === 'lists') {
    const lists = await readLists(scope);
    const entry = lists[localId];
    if (!entry) return; // A remotely opened resource has no local record to delete.
    if (entry.cloudId !== cloudId) throw new LocalStorageError('লোকাল তালিকার cloud ID মেলেনি; অন্য ডাটা মোছা হয়নি।');
    delete lists[localId];
    await writeLists(scope, lists);
    return;
  }
  const notes = await readNotes(scope);
  const entry = notes.find(value => value.id === localId);
  if (!entry) return;
  if (entry.cloudId !== cloudId) throw new LocalStorageError('লোকাল নোটের cloud ID মেলেনি; অন্য ডাটা মোছা হয়নি।');
  await writeNotes(scope, notes.filter(value => value.id !== localId));
}

export async function readPhoto(scope: StorageScope) {
  return (await AsyncStorage.getItem(scopedStorageKey(scope, 'photo'))) || null;
}

export async function writePhoto(scope: StorageScope, value: string | null) {
  if (value === null) await AsyncStorage.removeItem(scopedStorageKey(scope, 'photo'));
  else await AsyncStorage.setItem(scopedStorageKey(scope, 'photo'), value);
}

export type ThemePreferences = { mode: 'light' | 'dark' | 'system' | 'scheduled'; lightAt: string; darkAt: string };
const DEFAULT_THEME_PREFERENCES: ThemePreferences = { mode: 'dark', lightAt: '06:00', darkAt: '18:00' };
export async function readThemePreferences(scope: StorageScope): Promise<ThemePreferences> {
  const value = parse<Partial<ThemePreferences>>(await AsyncStorage.getItem(scopedStorageKey(scope, 'preferences')), {});
  const validTime = (time: unknown, fallback: string) => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : fallback;
  const mode = value.mode === 'light' || value.mode === 'dark' || value.mode === 'scheduled' || value.mode === 'system' ? value.mode : DEFAULT_THEME_PREFERENCES.mode;
  return { mode, lightAt: validTime(value.lightAt, DEFAULT_THEME_PREFERENCES.lightAt), darkAt: validTime(value.darkAt, DEFAULT_THEME_PREFERENCES.darkAt) };
}
export async function writeThemePreferences(scope: StorageScope, value: ThemePreferences) {
  const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  if (!['light', 'dark', 'system', 'scheduled'].includes(value.mode) || !validTime(value.lightAt) || !validTime(value.darkAt)) throw new LocalStorageError('থিম সেটিংস সঠিক নয়; আগের পছন্দ অক্ষত রাখা হয়েছে।');
  await AsyncStorage.setItem(scopedStorageKey(scope, 'preferences'), JSON.stringify(value));
}

/** Delete a local-only record from exactly one namespace. Cloud-linked records require owner deletion flow. */
export async function deleteScopedLocalResource(scope: StorageScope, kind: 'lists' | 'notes', localId: string) {
  if (kind === 'lists') {
    const lists = await readLists(scope);
    const entry = lists[localId];
    if (!entry) return false;
    if (entry.cloudId) throw new LocalStorageError('এই তালিকা cloud-এর সঙ্গে যুক্ত; অনুমতিসহ cloud deletion ব্যবহার করুন।');
    delete lists[localId];
    await writeLists(scope, lists);
    return true;
  }
  const notes = await readNotes(scope);
  const entry = notes.find(note => note.id === localId);
  if (!entry) return false;
  if (entry.cloudId) throw new LocalStorageError('এই নোট cloud-এর সঙ্গে যুক্ত; অনুমতিসহ cloud deletion ব্যবহার করুন।');
  await writeNotes(scope, notes.filter(note => note.id !== localId));
  return true;
}

export async function hasLegacyDeviceData() {
  const values = await AsyncStorage.multiGet(Object.values(LEGACY_DATA_KEYS));
  return values.some(([, value]) => value !== null && value !== '');
}

const fingerprint = (value: unknown) => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

function legacyNotes(notesValue: string | null, singleValue: string | null): (Note & { id: string })[] {
  const notes = validateNotes(parse(notesValue, []));
  if (!singleValue) return notes;
  const old = parse<Note>(singleValue, { title: '', body: '' });
  if (!old || typeof old !== 'object' || typeof old.title !== 'string' || typeof old.body !== 'string') throw new LocalStorageError('পুরোনো নোটের ডাটা অসম্পূর্ণ; মূল ডাটা অক্ষত রাখা হয়েছে।');
  const id = old.id || 'legacy-note';
  const sameId = notes.find(note => note.id === id);
  if (sameId && sameId.title === old.title && sameId.body === old.body) return notes;
  if (sameId) return [...notes, { ...old, id: uniqueId(id, new Set(notes.map(note => note.id))) }];
  return validateNotes([...notes, { ...old, id }]);
}

const uniqueId = (base: string, occupied: Set<string>) => {
  let candidate = `legacy-${base}`;
  let suffix = 2;
  while (occupied.has(candidate)) candidate = `legacy-${base}-${suffix++}`;
  return candidate;
};

/** Copies old installation-wide data into the guest namespace. Source keys are retained. */
export async function importLegacyDataToGuest(scope: StorageScope) {
  if (scope.kind !== 'guest') throw new Error('পুরোনো ডিভাইসের ডাটা শুধু Guest space-এ কপি করা যাবে।');
  const raw = Object.fromEntries(await AsyncStorage.multiGet(Object.values(LEGACY_DATA_KEYS)));
  const sourceListsRaw = validateLists(parse(raw[STORE.lists], {}));
  const sourceNotesRaw = legacyNotes(raw[STORE.notes], raw[STORE.note]);
  const sourceLists = Object.fromEntries(Object.entries(sourceListsRaw).map(([id, list]) => { const { cloudId: _cloudId, ...local } = list; return [id, local]; }));
  const sourceNotes = sourceNotesRaw.map(note => { const { cloudId: _cloudId, ...local } = note; return local; });
  validateNotes(sourceNotes);
  const sourcePhoto = raw[STORE.photo] || null;
  const sourceHash = fingerprint({ lists: sourceLists, notes: sourceNotes, photo: sourcePhoto });
  const journalKey = legacyJournalKey(scope);
  const journalRaw = await AsyncStorage.getItem(journalKey);
  const prior = journalRaw ? parse<{ sourceHash: string; targetLists: Record<string, string>; targetNotes: Record<string, string>; photoTarget: string | null; status: string }>(journalRaw, { sourceHash: '', targetLists: {}, targetNotes: {}, photoTarget: null, status: '' }) : null;
  if (prior?.status === 'complete' && prior.sourceHash === sourceHash) return { imported: false, counts: { lists: 0, notes: 0, photo: false } };
  if (prior?.status === 'copying' && prior.sourceHash !== sourceHash) throw new LocalStorageError('অসমাপ্ত Legacy import চলাকালে source ডাটা বদলেছে। আগের কপি ও source অক্ষত আছে; conflict যাচাই না করে retry করা হয়নি।');

  const destinationLists = await readLists(scope);
  const destinationNotes = await readNotes(scope);
  const targetLists = prior?.targetLists || {};
  const targetNotes = prior?.targetNotes || {};
  const occupiedListIds = new Set(Object.keys(destinationLists));
  for (const sourceId of Object.keys(sourceLists)) {
    if (!targetLists[sourceId]) targetLists[sourceId] = occupiedListIds.has(sourceId) ? uniqueId(sourceId, occupiedListIds) : sourceId;
    occupiedListIds.add(targetLists[sourceId]);
  }
  const occupiedNoteIds = new Set(destinationNotes.map(note => note.id));
  for (const note of sourceNotes) {
    if (!targetNotes[note.id]) targetNotes[note.id] = occupiedNoteIds.has(note.id) ? uniqueId(note.id, occupiedNoteIds) : note.id;
    occupiedNoteIds.add(targetNotes[note.id]);
  }
  const photoTarget = prior?.sourceHash === sourceHash ? prior.photoTarget : sourcePhoto && await readPhoto(scope) ? null : sourcePhoto ? sourcePhoto : null;
  const journal = { sourceHash, targetLists, targetNotes, photoTarget, status: 'copying' };
  await AsyncStorage.setItem(journalKey, JSON.stringify(journal));

  const mergedLists = { ...destinationLists };
  for (const [sourceId, list] of Object.entries(sourceLists)) {
    const targetId = targetLists[sourceId];
    const current = mergedLists[targetId];
    if (current && JSON.stringify(current) !== JSON.stringify(list)) {
      const alreadyImported = current.title === list.title && current.category === list.category && JSON.stringify(current.items) === JSON.stringify(list.items);
      if (!alreadyImported) throw new Error('একটি Guest তালিকার ID-তে ভিন্ন ডাটা আছে। মূল ডাটা অক্ষত আছে; conflict মিটিয়ে আবার চেষ্টা করুন।');
    } else mergedLists[targetId] = list;
  }
  await writeLists(scope, mergedLists);
  if (JSON.stringify(await readLists(scope)) !== JSON.stringify(mergedLists)) throw new Error('Guest তালিকা কপি যাচাই হয়নি। পুরোনো ডাটা অক্ষত আছে।');

  const mergedNotes = [...destinationNotes];
  for (const note of sourceNotes) {
    const targetId = targetNotes[note.id];
    const copy = { ...note, id: targetId };
    const index = mergedNotes.findIndex(value => value.id === targetId);
    if (index >= 0 && JSON.stringify(mergedNotes[index]) !== JSON.stringify(copy)) throw new Error('একটি Guest নোটের ID-তে ভিন্ন ডাটা আছে। মূল ডাটা অক্ষত আছে; conflict মিটিয়ে আবার চেষ্টা করুন।');
    if (index < 0) mergedNotes.push(copy);
  }
  await writeNotes(scope, mergedNotes);
  if (JSON.stringify(await readNotes(scope)) !== JSON.stringify(mergedNotes)) throw new Error('Guest নোট কপি যাচাই হয়নি। পুরোনো ডাটা অক্ষত আছে।');

  if (photoTarget && !(await readPhoto(scope))) {
    await writePhoto(scope, photoTarget);
    if ((await readPhoto(scope)) !== photoTarget) throw new Error('Guest profile photo কপি যাচাই হয়নি। পুরোনো ডাটা অক্ষত আছে।');
  }
  await AsyncStorage.setItem(journalKey, JSON.stringify({ ...journal, status: 'complete' }));
  return { imported: true, counts: { lists: Object.keys(sourceLists).length, notes: sourceNotes.length, photo: Boolean(sourcePhoto && photoTarget) } };
}

export async function markGuestImportPending(scope: StorageScope | null) {
  if (scope?.kind === 'guest') await AsyncStorage.setItem(PENDING_GUEST_IMPORT_KEY, scope.id);
}

export async function getPendingGuestImport() {
  return AsyncStorage.getItem(PENDING_GUEST_IMPORT_KEY);
}

export async function clearPendingGuestImport() {
  await AsyncStorage.removeItem(PENDING_GUEST_IMPORT_KEY);
}

export async function setSessionMode(value: string) {
  await AsyncStorage.setItem(SESSION_MODE_KEY, value);
}

export async function getSessionMode() {
  return AsyncStorage.getItem(SESSION_MODE_KEY);
}

export async function clearSessionMode() {
  await AsyncStorage.removeItem(SESSION_MODE_KEY);
}
