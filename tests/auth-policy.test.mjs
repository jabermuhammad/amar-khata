import test from 'node:test';
import assert from 'node:assert/strict';
import { canLinkGoogleEmail, normalizeAuthEmail } from '../src/lib/authPolicy.mjs';

test('normalizes auth email for provider comparisons', () => {
  assert.equal(normalizeAuthEmail('  USER@Example.COM '), 'user@example.com');
  assert.equal(normalizeAuthEmail(null), '');
});

test('allows Google linking only when both normalized emails match', () => {
  assert.equal(canLinkGoogleEmail('user@example.com', ' USER@EXAMPLE.COM '), true);
  assert.equal(canLinkGoogleEmail('user@example.com', 'other@example.com'), false);
  assert.equal(canLinkGoogleEmail('', 'user@example.com'), false);
  assert.equal(canLinkGoogleEmail('user@example.com', null), false);
});
