# Firebase collaboration setup

This app uses Firebase Authentication and Cloud Firestore through the Firebase JavaScript SDK. It does not use Cloud Storage, Cloud Functions, a custom server, or profile-photo uploads. Profile photos remain in the existing local AsyncStorage flow.

## Add the Firebase Web App config

Copy `.env.example` to `.env.local` in this `android-app` folder and fill in the public config values from the registered Firebase Web App. The variables are embedded in the client app; they are identifiers, not access-control secrets. Firestore Security Rules provide the access control.

Email/Password Authentication must be enabled in the Firebase project. Then restart Expo so it reads `.env.local`:

```powershell
pnpm android
```

Open Expo Go on the Android phone and scan the QR code. No Android Studio is needed for this Expo Go flow.

## Copy existing phone data

Sign in with an email-verified account. Open **শেয়ার করা → পুরোনো লোকাল নোট ও তালিকা কপি করুন**, select the entries to migrate, and confirm. The app copies selected notes and lists to Firestore and marks their local entries with the cloud IDs; it does not delete the local records or touch the profile photo. A repeated migration reuses the stable cloud ID instead of creating another document.

## Security Rules

`firestore.rules` is the proposed rules file. `firebase.json` points the Firebase CLI at it. Rules are not deployed automatically by this project. Keep the current production rules until the emulator tests below pass and the deployment is explicitly approved.

With Java and the Firebase CLI available, start the Firestore Emulator and run:

```powershell
firebase emulators:exec --only firestore "node --test tests/firestore.rules.test.mjs"
```

The tests cover shopper price/status updates, denied structural shopping edits, editor changes, note viewer/editor roles, outsiders, invite acceptance, and atomic owner setup. Deploy only after all tests pass:

```powershell
firebase deploy --only firestore:rules
```

That last command changes the live Firebase project. It has not been run.

## Spark and offline behavior

There is no Storage dependency, so profile pictures do not consume cloud storage. Firestore's Spark free quota currently includes 1 GiB stored data, 50,000 document reads/day, 20,000 writes/day, 20,000 deletes/day, and 10 GiB monthly outbound transfer for one free database. Listener activity and Rules document lookups also consume reads. If the free quota is exceeded, requests can be throttled until the quota resets; do not enable a paid plan without reviewing it first.

Firestore data persists in the cloud after app closure and syncs through snapshot listeners while connected. The Firebase JS SDK does not provide durable Firestore offline persistence in React Native, so pending cloud edits are not guaranteed to survive force-closing the app while offline. Local records are retained during migration as a safety copy. No paid product is required by this implementation.
