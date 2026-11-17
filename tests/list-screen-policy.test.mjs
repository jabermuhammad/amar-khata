import assert from 'node:assert/strict';
import test from 'node:test';
import { getListScreenState } from '../src/lib/listScreenPolicy.mjs';

const state = overrides => getListScreenState({ rows: [], localLoading: false, remoteLoading: false, localError: null, remoteError: null, ...overrides });

test('empty is shown only after both sources finish without errors', () => {
  assert.equal(state({}), 'empty');
  assert.equal(state({ localLoading: true }), 'loading');
  assert.equal(state({ remoteLoading: true }), 'loading');
});

test('permission or storage failures are not represented as an empty list', () => {
  assert.equal(state({ remoteError: 'Missing or insufficient permissions' }), 'error');
  assert.equal(state({ localError: 'storage read failed' }), 'error');
});

test('available local rows remain visible when the cloud source fails', () => {
  assert.equal(state({ rows: [{ id: 'guest-list' }], remoteError: 'Missing or insufficient permissions' }), 'content');
});
