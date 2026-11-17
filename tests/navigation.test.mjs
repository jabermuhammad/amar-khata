import assert from 'node:assert/strict';
import test from 'node:test';
import { goBackOrReplace } from '../src/lib/navigation.mjs';

test('back button uses history on the first tap when history exists', () => {
  const calls = [];
  const router = { canGoBack: () => true, back: () => calls.push('back'), replace: route => calls.push(`replace:${route}`) };
  assert.equal(goBackOrReplace(router, '/'), 'back');
  assert.deepEqual(calls, ['back']);
});

test('back button safely replaces a deep-linked route when there is no history', () => {
  const calls = [];
  const router = { canGoBack: () => false, back: () => calls.push('back'), replace: route => calls.push(`replace:${route}`) };
  assert.equal(goBackOrReplace(router, '/lists'), 'replace');
  assert.deepEqual(calls, ['replace:/lists']);
});
