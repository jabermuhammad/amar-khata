# Amar Khata (আমার খাতা)

Amar Khata is a Bengali-first Android app for organizing shopping lists and notes. It is built with Expo, React Native, TypeScript, and Expo Router.

## Features

- Create and manage shopping lists, including item quantities, prices, and purchase status.
- Write and organize notes.
- Keep profile photos on the device.
- Sign in with Firebase Authentication and collaborate on shared notes and shopping lists through Cloud Firestore.
- Receive app update information from a separately maintained GitHub updates repository.
- Print shopping lists using the device's available print flow.

Local notes, lists, and profile-photo references use AsyncStorage. Cloud collaboration requires Firebase configuration. Profile photos are local and are not uploaded by this app.

## Technology

- Expo SDK 58 and React Native 0.88
- TypeScript and Expo Router
- Firebase Authentication and Cloud Firestore
- AsyncStorage for on-device data
- pnpm (the repository lockfile and EAS configuration pin pnpm 11.25.0)

## Requirements

- Node.js supported by the installed Expo SDK and pnpm 11.25.0
- Android phone with Expo Go for the JavaScript preview, or Android SDK/JDK for a local native build
- Firebase project configuration for Authentication and Firestore features

## Local setup

1. Clone the repository and enter the app directory.
2. Install pnpm 11.25.0 if it is not already available.
3. Copy `.env.example` to `.env.local` and fill in the five Firebase Web App values from your own Firebase project. Do not commit `.env.local`.
4. Install dependencies from the lockfile:

   ```sh
   pnpm install --frozen-lockfile
   ```

5. Start the Expo Go development server:

   ```sh
   pnpm start
   ```

   Scan the displayed QR code with Expo Go. For a different network path, use `pnpm start:tunnel`.

## Environment variables

The app reads these public Firebase Web App configuration values at bundle time:

```text
EXPO_PUBLIC_FIREBASE_API_KEY
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN
EXPO_PUBLIC_FIREBASE_PROJECT_ID
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
EXPO_PUBLIC_FIREBASE_APP_ID
```

Expo public variables are embedded in the client app and are not a place for private credentials. Never put service-account keys, passwords, signing keys, or access tokens in `EXPO_PUBLIC_*` variables. Firebase authorization must be enforced by Firebase Security Rules.

The production EAS profile also supplies `EXPO_PUBLIC_UPDATE_MANIFEST_URL`. APK updates are maintained separately in the `amar-khata-updates` repository; do not place APK release assets or its runtime `update.json` in this source repository.

## Development checks

```sh
pnpm exec tsc --noEmit
pnpm lint
pnpm exec expo config --type public
```

Firestore Rules tests use the local Firebase Emulator and the fake project ID `amar-khata-firestore-rules-test`. With Firebase CLI available, run:

```sh
firebase emulators:exec --project amar-khata-firestore-rules-test --only firestore "pnpm test:rules"
```

Never use the production Firebase project ID for Rules tests. The emulator configuration is in `firebase.json` and the Rules tests are in `tests/firestore.rules.test.mjs`.

## Android builds

The EAS profiles in `eas.json` produce internal APKs. The `preview` profile is for internal testing; the `production` profile is for the production APK. EAS-managed Android signing credentials must be kept stable so future APKs can update existing installations. A production build or release should only be started by an authorized maintainer after checking the profile, version, environment, and signing key.

## Repository safety

- Keep `.env.local`, signing credentials, private keys, local logs, build output, and `node_modules` out of Git.
- `.env.example` contains variable names and safe placeholders only; replace placeholders locally, never commit real values.
- Review `git status` and the complete staged diff before committing. Do not commit APKs, user data, local databases, or personal profile photos.
- GitHub APK releases and the update manifest belong in the separate updates repository.
