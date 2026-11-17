import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldApplyAuthSnapshot, shouldInvalidateAuthScope } from '../src/lib/authSessionPolicy.mjs';

test('account, Guest and signed-out transitions invalidate the old local scope immediately', () => {
  assert.equal(shouldInvalidateAuthScope({ activeUid: 'account-a', eventUid: 'account-b' }), true);
  assert.equal(shouldInvalidateAuthScope({ activeUid: 'account-a', eventUid: null }), true);
  assert.equal(shouldInvalidateAuthScope({ activeUid: 'account-a', eventUid: 'account-a' }), false);
  assert.equal(shouldInvalidateAuthScope({ activeUid: null, eventUid: null }), false);
});

test('late auth event cannot overwrite a newer account session', () => {
  assert.equal(shouldApplyAuthSnapshot({ eventGeneration: 3, currentGeneration: 4, eventUid: 'account-a', currentUid: 'account-b' }), false);
});

test('UID mismatch rejects an event even when its generation is current', () => {
  assert.equal(shouldApplyAuthSnapshot({ eventGeneration: 5, currentGeneration: 5, eventUid: 'account-a', currentUid: 'account-b' }), false);
});

test('explicit Guest and logout transitions ignore auth snapshots until transition completes', () => {
  for (const transitionIntent of ['guest', 'none']) {
    assert.equal(shouldApplyAuthSnapshot({ eventGeneration: 1, currentGeneration: 1, eventUid: 'account-a', currentUid: 'account-a', transitionIntent }), false);
    assert.equal(shouldApplyAuthSnapshot({ eventGeneration: 1, currentGeneration: 1, eventUid: null, currentUid: null, transitionIntent }), false);
  }
});
