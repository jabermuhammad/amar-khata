/** Pure identifiers/comparators shared by storage and migration code. */
export function scopePart(scope) {
  if (scope?.kind === 'guest' && typeof scope.id === 'string' && scope.id) return `guest:${encodeURIComponent(scope.id)}`;
  if (scope?.kind === 'user' && typeof scope.uid === 'string' && scope.uid) return `user:${encodeURIComponent(scope.uid)}`;
  throw new Error('Storage scope identifier is missing.');
}

export function scopedKey(scope, kind) {
  if (!['lists', 'notes', 'photo', 'preferences'].includes(kind)) throw new Error('Unknown local record kind.');
  return `@amar-khata/v2/${scopePart(scope)}/${kind}`;
}

export function migrationResourceId(uid, guestId, kind, localId) {
  if (![uid, guestId, localId].every(value => typeof value === 'string' && value.length > 0)) throw new Error('Migration identity is incomplete.');
  if (kind !== 'list' && kind !== 'note') throw new Error('Unknown migration resource kind.');
  const id = `guestcopy-${encodeURIComponent(uid)}-${encodeURIComponent(guestId)}-${kind}-${encodeURIComponent(localId)}`;
  if (id.length > 1200) throw new Error('Migration identifier is too long; no cloud write was attempted.');
  return id;
}

export function normalizeComparableItems(items) {
  return items.map(item => ({
    id: String(item.id), name: String(item.name ?? ''), qty: String(item.qty ?? ''), status: String(item.status ?? ''),
    ...(typeof item.price === 'number' ? { price: item.price } : {}),
  })).sort((a, b) => a.id.localeCompare(b.id));
}

export function sameListContent(left, right) {
  return left.title === right.title
    && (left.category || 'today') === (right.category || 'today')
    && JSON.stringify(normalizeComparableItems(left.items)) === JSON.stringify(normalizeComparableItems(right.items));
}

export function sameNoteContent(left, right) {
  return left.title === right.title && left.body === right.body;
}
