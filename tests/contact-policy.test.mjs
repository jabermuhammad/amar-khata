import assert from 'node:assert/strict';
import test from 'node:test';
import { assertConnectionCounterpart, assertConnectionMember, connectionIdFor, connectionInviteExpiresAt, connectionInviteIdFor, filterConnectedContacts, isConnectionInviteExpired, normalizeContactEmail, normalizeUsername, resolveOutgoingInvite, validateSharedPermission } from '../src/lib/contactPolicy.mjs';

test('username keys are trimmed, lowercased and constrained to safe searchable handles', () => {
  assert.equal(normalizeUsername('  @AbC_12 '), 'abc_12');
  assert.throws(() => normalizeUsername('a'), /ইউজারনেমে/);
  assert.throws(() => normalizeUsername('two words'), /ইউজারনেমে/);
});

test('email invites normalize addresses without disclosing a directory lookup', () => {
  assert.equal(normalizeContactEmail(' Friend@Example.COM '), 'friend@example.com');
  assert.throws(() => normalizeContactEmail('not-an-email'), /ইমেইল ঠিকানা/);
});

test('connection IDs are stable regardless of which member creates the link', () => {
  assert.equal(connectionIdFor('uid-b', 'uid-a'), connectionIdFor('uid-a', 'uid-b'));
  assert.throws(() => connectionIdFor('uid-a', 'uid-a'), /নিজের সঙ্গে/);
});

test('resource sharing requires an active connection and keeps role sets separate', () => {
  assert.equal(assertConnectionMember({ status: 'active', memberUids: ['a', 'b'] }, 'a'), 'b');
  assert.throws(() => assertConnectionMember({ status: 'pending', memberUids: ['a', 'b'] }, 'a'), /অনুমোদিত সংযোগ/);
  assert.equal(validateSharedPermission('list', 'shopper'), 'shopper');
  assert.equal(validateSharedPermission('note', 'viewer'), 'viewer');
  assert.throws(() => validateSharedPermission('list', 'viewer'), /অনুমতি সঠিক/);
  assert.throws(() => validateSharedPermission('note', 'shopper'), /অনুমতি সঠিক/);
});

test('contact details reject forged connection and counterpart route parameters', () => {
  const connection = { status: 'active', memberUids: ['alice', 'bob'] };
  assert.equal(assertConnectionCounterpart('alice~bob', connection, 'alice', 'bob'), 'bob');
  assert.throws(() => assertConnectionCounterpart('alice~mallory', connection, 'alice', 'bob'), /তথ্য মেলে না/);
  assert.throws(() => assertConnectionCounterpart('alice~bob', connection, 'alice', 'mallory'), /তথ্য মেলে না/);
  assert.throws(() => assertConnectionCounterpart('alice~bob', { ...connection, status: 'revoked' }, 'alice', 'bob'), /অনুমোদিত সংযোগ/);
});

test('approved contacts can be searched by their actual display name or username', () => {
  const contacts = [
    { connectionId: 'a', profile: { displayName: 'রহিমা সুলতানা', username: 'rahima' } },
    { connectionId: 'b', profile: { displayName: 'করিম আহমেদ', username: 'karim_7' } },
  ];
  assert.deepEqual(filterConnectedContacts(contacts, 'রহিমা').map(item => item.connectionId), ['a']);
  assert.deepEqual(filterConnectedContacts(contacts, '@KARIM_7').map(item => item.connectionId), ['b']);
  assert.deepEqual(filterConnectedContacts(contacts, ''), contacts);
});

test('outgoing invite resolution reuses pending requests and blocks already accepted connections', () => {
  const prior = [
    { id: 'old', recipientEmail: 'friend@example.com', status: 'declined' },
    { id: 'pending', recipientEmail: 'friend@example.com', status: 'pending', expiresAt: new Date(Date.now() + 60_000) },
    { id: 'expired', recipientEmail: 'friend@example.com', status: 'pending', expiresAt: new Date(Date.now() - 1) },
  ];
  assert.deepEqual(resolveOutgoingInvite(prior, { email: 'friend@example.com' }), { status: 'pending', id: 'pending' });
  assert.deepEqual(resolveOutgoingInvite([{ id: 'accepted', recipientUid: 'uid-2', status: 'accepted', acceptedBy: 'uid-2' }], { uid: 'uid-2' }), { status: 'connected' });
  assert.deepEqual(resolveOutgoingInvite(prior, { email: 'other@example.com' }), { status: 'new' });
});

test('connection invite IDs are deterministic and expiry is bounded to seven days', () => {
  assert.equal(connectionInviteIdFor('sender', { uid: 'recipient' }), connectionInviteIdFor('sender', { uid: 'recipient' }));
  assert.equal(connectionInviteIdFor('sender', { email: 'a@example.com' }), 'request-sender-a@example.com');
  const created = new Date('2026-11-05T00:00:00.000Z');
  assert.equal(connectionInviteExpiresAt(created).getTime() - created.getTime(), 7 * 24 * 60 * 60 * 1000 - 60 * 1000);
  assert.throws(() => connectionInviteExpiresAt(created, 7 * 24 * 60 * 60 * 1000));
  assert.equal(isConnectionInviteExpired({ expiresAt: new Date(created.getTime() - 1) }, created.getTime()), true);
  assert.equal(isConnectionInviteExpired({ expiresAt: new Date(created.getTime() + 1) }, created.getTime()), false);
});
