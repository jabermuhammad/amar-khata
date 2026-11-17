import AsyncStorage from '@react-native-async-storage/async-storage';
import { createCloudSyncStore } from './cloudOutbox.mjs';

export const cloudSyncStore = createCloudSyncStore(AsyncStorage);

let networkAvailable = false;

export function setCloudNetworkAvailable(available: boolean) {
  networkAvailable = available;
}

export function isCloudNetworkAvailable() {
  return networkAvailable;
}

export function isRetryableCloudError(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  return ['unavailable', 'deadline-exceeded', 'network-request-failed'].includes(code);
}
