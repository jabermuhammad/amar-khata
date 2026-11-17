import assert from 'node:assert/strict';
import test from 'node:test';
import { isInternetAvailable } from '../src/lib/networkPolicy.mjs';

test('offline and uninitialized network state never starts cloud sync', () => {
  assert.equal(isInternetAvailable(undefined), false);
  assert.equal(isInternetAvailable({ isConnected: false, isInternetReachable: false }), false);
  assert.equal(isInternetAvailable({ isConnected: true, isInternetReachable: false }), false);
});

test('connected network without a negative reachability result can resume pending sync', () => {
  assert.equal(isInternetAvailable({ isConnected: true, isInternetReachable: true }), true);
  assert.equal(isInternetAvailable({ isConnected: true, isInternetReachable: null }), true);
});
