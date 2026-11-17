import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFirebaseUidMatches, inviteTargetEmailError, permissionForResourceSummary } from '../src/lib/collaborationPolicy.mjs';

test('orphaned cloud references are skipped when current-user membership is absent', () => {
  assert.equal(permissionForResourceSummary('list', null), null);
});

test('resource summary uses a valid current membership role', () => {
  assert.equal(permissionForResourceSummary('list', { permission: 'shopper' }), 'shopper');
  assert.equal(permissionForResourceSummary('note', { permission: 'viewer' }), 'viewer');
});

test('invalid membership roles fail closed', () => {
  assert.throws(() => permissionForResourceSummary('list', { permission: 'viewer' }), /permission যাচাই/);
  assert.throws(() => permissionForResourceSummary('note', { permission: 'shopper' }), /permission যাচাই/);
});

test('Firebase operations require the currently signed-in UID; Guest and stale accounts fail closed', () => {
  assert.equal(assertFirebaseUidMatches('account-a', 'account-a'), undefined);
  assert.throws(() => assertFirebaseUidMatches(null, 'account-a'), /বর্তমান Firebase account/);
  assert.throws(() => assertFirebaseUidMatches('account-b', 'account-a'), /বর্তমান Firebase account/);
});

test('invite validation rejects malformed and self-targeted email before cloud work', () => {
  assert.match(inviteTargetEmailError('owner@example.com', 'not-an-email'), /সঠিক ইমেইল/);
  assert.match(inviteTargetEmailError('Owner@Example.com', ' owner@example.com '), /নিজের ইমেইলে/);
  assert.equal(inviteTargetEmailError('owner@example.com', 'friend@example.com'), null);
});
