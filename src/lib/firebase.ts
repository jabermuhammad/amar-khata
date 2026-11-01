import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as authModule from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? '',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
};

export const firebaseConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
const firebaseApp = firebaseConfigured ? (getApps().length ? getApp() : initializeApp(config)) : null;

export const auth = firebaseApp
  ? (() => {
      const { getAuth, initializeAuth } = authModule;
      // Firebase's React Native entry exports this symbol; the package's shared
      // TypeScript declaration currently describes only the web entry.
      const getReactNativePersistence = (authModule as typeof authModule & {
        getReactNativePersistence: (storage: typeof AsyncStorage) => NonNullable<Parameters<typeof initializeAuth>[1]>['persistence'];
      }).getReactNativePersistence;
      try {
        return initializeAuth(firebaseApp, { persistence: getReactNativePersistence(AsyncStorage) });
      } catch {
        return getAuth(firebaseApp);
      }
    })()
  : null;

export const db = firebaseApp ? getFirestore(firebaseApp) : null;
