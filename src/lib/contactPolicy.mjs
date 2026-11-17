const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const CONNECTION_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000 - 60 * 1000;

export function normalizeUsername(value) {
  const normalized = typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new Error('ইউজারনেমে ৩–২৪টি ইংরেজি অক্ষর, সংখ্যা বা underscore ব্যবহার করুন।');
  }
  return normalized;
}

export function normalizeContactEmail(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized.includes('/') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('সঠিক ইমেইল ঠিকানা লিখুন।');
  return normalized;
}

export function connectionIdFor(firstUid, secondUid) {
  if (!firstUid || !secondUid || firstUid === secondUid) throw new Error('নিজের সঙ্গে সংযোগ তৈরি করা যাবে না।');
  return [firstUid, secondUid].sort().join('~');
}

export function connectionInviteIdFor(senderUid, recipient) {
  const target = recipient.uid || recipient.email;
  if (!senderUid || !target || senderUid.includes('/')) throw new Error('পরিচিতির অনুরোধের ID সঠিক নয়।');
  return `request-${senderUid}-${target}`;
}

export function connectionInviteExpiresAt(createdAt, lifetimeMs = CONNECTION_INVITE_TTL_MS) {
  const start = createdAt instanceof Date ? createdAt.getTime() : Number(createdAt);
  if (!Number.isFinite(start) || !Number.isFinite(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > CONNECTION_INVITE_TTL_MS) {
    throw new Error('পরিচিতির অনুরোধের মেয়াদ সঠিক নয়।');
  }
  return new Date(start + lifetimeMs);
}

export function isConnectionInviteExpired(invite, now = Date.now()) {
  const expiry = invite?.expiresAt;
  const millis = expiry instanceof Date ? expiry.getTime() : typeof expiry?.toMillis === 'function' ? expiry.toMillis() : Number.NaN;
  return !Number.isFinite(millis) || millis <= now;
}

export function assertConnectionMember(connection, uid) {
  if (!connection || connection.status !== 'active' || !Array.isArray(connection.memberUids) || !connection.memberUids.includes(uid)) {
    throw new Error('এই পরিচিতির সঙ্গে অনুমোদিত সংযোগ নেই।');
  }
  return connection.memberUids.find(memberUid => memberUid !== uid);
}

/** Validate a route-supplied contact against the canonical active connection. */
export function assertConnectionCounterpart(connectionId, connection, uid, expectedContactUid) {
  const counterpart = assertConnectionMember(connection, uid);
  if (!expectedContactUid || counterpart !== expectedContactUid || connectionId !== connectionIdFor(uid, expectedContactUid)) {
    throw new Error('পরিচিতির সংযোগের তথ্য মেলে না। পরিচিতির তালিকা থেকে আবার খুলুন।');
  }
  return counterpart;
}

export function validateSharedPermission(kind, permission) {
  const allowed = kind === 'list' ? ['editor', 'shopper'] : kind === 'note' ? ['editor', 'viewer'] : [];
  if (!allowed.includes(permission)) throw new Error('এই resource-এর জন্য অনুমতি সঠিক নয়।');
  return permission;
}

export function filterConnectedContacts(contacts, query) {
  const needle = typeof query === 'string' ? query.trim().replace(/^@/, '').toLocaleLowerCase() : '';
  if (!needle) return [...contacts];
  return contacts.filter(contact => `${contact?.profile?.displayName || ''} ${contact?.profile?.username || ''}`.toLocaleLowerCase().includes(needle));
}

export function resolveOutgoingInvite(invites, recipient, now = Date.now()) {
  const matches = invites.filter(invite => recipient.uid
    ? invite.recipientUid === recipient.uid
    : invite.recipientEmail === recipient.email);
  if (matches.some(invite => invite.status === 'accepted' && typeof invite.acceptedBy === 'string' && invite.acceptedBy)) return { status: 'connected' };
  const pending = matches.find(invite => invite.status === 'pending' && !isConnectionInviteExpired(invite, now));
  return pending ? { status: 'pending', id: pending.id } : { status: 'new' };
}
