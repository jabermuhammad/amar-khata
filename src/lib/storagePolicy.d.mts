export function scopePart(scope: { kind: 'guest'; id: string } | { kind: 'user'; uid: string }): string;
export function scopedKey(scope: { kind: 'guest'; id: string } | { kind: 'user'; uid: string }, kind: 'lists' | 'notes' | 'photo' | 'preferences'): string;
export function migrationResourceId(uid: string, guestId: string, kind: 'list' | 'note', localId: string): string;
export function normalizeComparableItems(items: Array<{ id: string | number; name: string; qty: string; status: string; price?: number }>): Array<{ id: string; name: string; qty: string; status: string; price?: number }>;
export function sameListContent(left: { title: string; category?: string; items: Array<{ id: string | number; name: string; qty: string; status: string; price?: number }> }, right: { title: string; category?: string; items: Array<{ id: string | number; name: string; qty: string; status: string; price?: number }> }): boolean;
export function sameNoteContent(left: { title: string; body: string }, right: { title: string; body: string }): boolean;
