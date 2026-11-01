# আমার খাতা — Project Handoff

এই handoff নতুন ChatGPT/Gemini/Codex chat-এর শুরুতে দিন। এটি প্রজেক্ট, আগের সিদ্ধান্ত, বর্তমান অবস্থা ও নিরাপত্তার সীমা বোঝায়। নতুন AI-কে আগে repository-এর AGENTS.md, README, Git diff/status এবং প্রাসঙ্গিক বর্তমান কোড পরীক্ষা করতে হবে। এই নথি পুরোনো হতে পারে; বাস্তব source-ই চূড়ান্ত।

## নতুন AI-এর কাজের নিয়ম

- ব্যবহারকারী বাংলা ভাষায় কথা বলেন; সহজ বাংলায় কাজ ও ফলাফল বুঝিয়ে বলুন। তিনি কাজ করতে বললে অপ্রয়োজনীয় অনুমতি/প্রশ্ন না করে scope-এর কাজ সম্পন্ন করুন।
- পরিবর্তনের scope ছোট রাখুন; অন্য screen, data, permissions, design বা user data যেন নষ্ট না হয়। Test না চালিয়ে pass দাবি করবেন না।
- Live Firebase project my-notes-app-f8b79-এ Rules deploy, data operation, Authentication/Console setting পরিবর্তন করবেন না—ব্যবহারকারীর আলাদা স্পষ্ট অনুমতি ছাড়া। Blaze/paid services, Cloud Storage, Cloud Functions বা custom server যোগ করবেন না।
- Profile photo শুধু ফোনের local storage-এ থাকবে; cloud upload বা অন্য ব্যবহারকারীর কাছে প্রদর্শনের ফিচার নয়। .env.local, API key বা credentials কখনো output/report/git-এ প্রকাশ করবেন না।

## অ্যাপের লক্ষ্য ও UX

- Android-first বাংলা নোটবুক এবং যৌথ বাজারের তালিকা অ্যাপ।
- Home-এর category দুটো: ‘তালিকা’ (সব বাজারের তালিকা) এবং ‘নোটবুক’ (সব নোট)। category চাপলে համապատասխան সব বাস্তব/local/shared item দেখাবে। Empty placeholder/sample lists বাস্তব data হিসেবে দেখানো যাবে না।
- Home-এর + চাপলে bottom sheet খুলবে: প্রথমে ‘বাজারের তালিকা’, তারপরে ‘নোটবুক’। প্রথমটি নতুন list screen খুলবে; দ্বিতীয়টি notes screen খুলবে।
- Home থেকে ‘সাম্প্রতিক নোট’ ও quote card সরানো হয়েছে; নোটবুক category-তে সব নোট থাকে।
- Shopping list screen header ‘তালিকা’; তার নিচে editable list title, স্বয়ংক্রিয় তারিখ ও সময়। item যোগের floating + থেকে name/quantity modal। কেনার status, price, A4 print ও per-list share রয়েছে।
- Notes-এর title/body এবং date আছে। Home search note title-এর অক্ষর ও date term দিয়ে খোঁজে।
- Profile image gallery/camera থেকে নেওয়া, crop/pan/zoom করে local AsyncStorage-এ রাখা হয়।

## Project path আলাদা—এগুলো গুলিয়ে ফেলবেন না

- Workspace root: `<workspace-root>`। এখানে Figma Make/Vite preview-ও থাকতে পারে; সেটি Android app নয়।
- Canonical Expo app: `<workspace-root>/android-app`। প্রকৃত source, assets, Firebase Rules ও tests এখানে।
- ব্যবহারকারীর Expo Go/local Android build copy: `<runtime-copy>`। এটি আলাদা runtime/build copy; canonical নয়। কোড/assets update না করলে ফোনে নতুন পরিবর্তন দেখা যাবে না। Metro চালু থাকলে source copy করার আগে Ctrl+C দিয়ে Metro বন্ধ করতে বলুন। Runtime copy-তে সরাসরি write করা না গেলে ব্যবহারকারীকে নিজের path অনুযায়ী PowerShell Copy-Item কমান্ড দিন।
- Expo Go কেবল Metro থেকে app preview করে; APK তৈরি করে না।

## Stack ও storage

- Expo SDK ~58.0.20, React Native 0.88.0, React 19.3.0, TypeScript ~6.0.3, Expo Router ~58.0.27। Firebase JS SDK ^12.19.0।
- Local data: AsyncStorage। Data types/normalizers/constants: src/data.ts। Empty list draft removal helper আছে। Sample initialLists/initialNote legacy constants—সেগুলোকে ব্যবহারকারীর বাস্তব data হিসেবে seed করবেন না।
- Image picker/crop: expo-image-picker ও expo-image-manipulator; A4 print: expo-print; Firebase: Auth ও Firestore। Native dependency/API বদলানোর আগে Expo SDK 58 official docs মিলিয়ে নিন।
- Firebase config src/lib/firebase.ts থেকে android-app/.env.local-এর EXPO_PUBLIC_FIREBASE_* variable পড়ে। .env.local local-only, কখনো প্রকাশ করবেন না।

## Firebase sharing design

- Real Firebase project ID: my-notes-app-f8b79; Firestore location Singapore (asia-southeast1)। ব্যবহারকারী Spark free plan-এ থাকতে চান। Paid/Blaze আগে অনুমতি লাগবে।
- Email/Password Firebase Auth এবং Cloud Firestore ব্যবহৃত হয়। Cloud Storage/Functions/server নেই। Profile photo local-only।
- Cloud resources Notes collection ও Shopping Lists collection-এ; list items subcollection-এ। Member documents এবং users/{uid}/resourceRefs দিয়ে access/reference পরিচালিত হয়। Invite code target email-এর সঙ্গে যুক্ত; verified email, pending status এবং expiry যাচাই করে accept করতে হবে।
- Permission: Note owner/editor/viewer। Shopping list owner/editor/shopper। Shopper কেবল price ও purchased/status পরিবর্তন করতে পারবে; নতুন item, name/quantity edit, delete ও list structure edit-এ Editor permission চাই। Owner permission/member পরিচালনা করে।
- Firestore Rules-এ identity, owner/member, verified invite, expiry/reuse, revocation, deleted-resource/stale-invite, orphan item prevention, permission-change batch + getAfter consistency enforce করার code/tests আছে। UI-তে button disable করাই নিরাপত্তা নয়—Rules-ও enforce করতে হবে।
- Emulator test project ID সর্বদা amar-khata-firestore-rules-test। firebase.json-এ Firestore Emulator port 8080 এবং Rules file firestore.rules। Live ID ব্যবহার করে tests/deploy করবেন না।
- ব্যবহারকারী আগে ১৪টি Rules test pass হওয়ার কথা জানিয়েছেন। এটি অতীতের দাবি; নতুন test চালালে প্রকৃত output অনুসারে রিপোর্ট করবেন। Windows/Codex context-এ Java/Netty loopback selector সমস্যা হয়েছে; ordinary PowerShell-এ কখনো Emulator চালু হয়েছে। বারবার retry নয়; error evidence দিয়ে থামুন।
- Live Rules deploy করা হয়েছে—এমন প্রমাণ নেই; README-তেও deploy হয়নি বলা আছে। Live Rules পূর্বে default deny ছিল বলে ব্যবহারকারী জানিয়েছেন। পরিবর্তন/deploy নয়।
- React Native Firebase JS SDK-তে Firestore durable offline persistence নেই; force-close-এর সময় pending cloud writes টিকে থাকবে ধরে নেবেন না। Migration local records রেখে দেয়।
- Password reset code Firebase sendPasswordResetEmail ব্যবহার করে; source code flow review হয়েছে, live inbox delivery পরীক্ষা হয়নি। Auth UI success message-ийг live email delivery-এর proof বলবেন না।

## মূল ফাইল

- src/app/index.tsx — Home categories, list/note rendering, search, add bottom sheet, profile nav।
- src/components/ShoppingListScreen.tsx — market list/items, auto title/date, price/status, A4 print, share।
- src/app/notes.tsx, src/app/note.tsx — local/shared notes list/editor।
- src/app/profile.tsx — local profile photo upload/crop/view/account navigation।
- src/app/auth.tsx, src/contexts/AuthContext.tsx — email/password, verification, reset email, auth state।
- src/lib/firebase.ts — config/init; src/lib/collaboration.ts — Firestore sharing operations।
- firestore.rules, tests/firestore.rules.test.mjs, firebase.json — Rules, tests, Emulator config।
- assets/icon.png — Android app icon; assets/nav-home.png, nav-checklist.png, nav-sticky-note.png, shopping-cart.png, send.png, printer.png — app UI assets।

## Expo Go চালানো (PowerShell)

Runtime copy-তে সব source/assets sync করার পর:

    Set-Location '<runtime-copy>'
    .\node_modules\.bin\expo.cmd start --go --clear --lan

Phone ও PC একই Wi-Fi-তে রাখুন, terminal খোলা রাখুন, QR Expo Go দিয়ে scan করুন। LAN ব্যর্থ হলে terminal-এ Ctrl+C দিয়ে থামিয়ে --tunnel চেষ্টা করা যায়; internet লাগে।

## Standalone APK build

Expo Go APK বানায় না। Local Android native project ও Android SDK থাকলে Java 21 Temurin ব্যবহার করে build করা যায়। JDK path মেশিনভেদে আলাদা:

    <local-jdk-21-path>

SDK: `%LOCALAPPDATA%\Android\Sdk`; Android Platform/build tools API 37 / 37.0.0; NDK 27.1.12297006; CMake 3.31.6। Unicode project path-এর জন্য `android.overridePathCheck=true` দরকার হতে পারে। Windows-এ native build সমস্যা হলে ASCII-only working path ব্যবহার করে দেখুন।

আগে একটি ASCII-only working copy-তে `gradlew.bat assembleDebug` সফল হয়েছিল; Metro না থাকলে Debug APK-তে “Unable to load script” দেখা গেছে। Standalone APK-এর জন্য Release task প্রস্তাব করা হয়েছে, কিন্তু Release build সফল হওয়া এখনো নিশ্চিত নয়:

    cd /d C:\MyNotesApp
    set "JAVA_HOME=%USERPROFILE%\Downloads\OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1\jdk-21.0.12.1+1"
    set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
    set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
    set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"
    cd android
    gradlew.bat assembleRelease

Expected output: C:\MyNotesApp\android\app\build\outputs\apk\release\app-release.apk। android/app/build.gradle release debug keystore-এ sign করে; personal testing-এ install করা যায়, Play Store production signing key নয়। Build-এর আগে source/assets sync করুন।

## Test / checks / known warnings

- TypeScript: node_modules\.bin\tsc.cmd --noEmit; সাম্প্রতিক Home/Auth/List edits-এর পরে pass।
- Lint: npm run lint -- --no-cache (expo lint); সাম্প্রতিক edits-এর পরে pass; legacy ESLint config warning ছিল।
- Android bundle: node --max-old-space-size=4096 .\node_modules\expo\bin\cli export --platform android --no-bytecode --output-dir $env:TEMP\...; Home/Auth/List edits-এর পরে pass। এটা ফোনে visual test নয়।
- Rules tests: firebase emulators:exec --project amar-khata-firestore-rules-test --only firestore "npm run test:rules"। Emulator unavailable হলে স্পষ্টভাবে unavailable বলুন।
- Expo Go-তে SafeAreaView deprecation warning দেখা গেছে; bundling successful ছিল। এটি warning, runtime failure-এর proof নয়। Scope ছাড়া refactor করবেন না।
- No Firebase deploy/billing/Blaze change করা হয়েছে।

## নতুন কাজের ক্ষেত্রে

১. Canonical android-app ও runtime C:\MyNotesApp-এর অবস্থা আলাদা করে যাচাই করুন। ২. Date ISO storage-এ, UI-তে Asia/Dhaka/Bangla locale বিবেচনা করুন। ৩. Data loss, permission/security weakening, live changes, paid features নয়। ৪. পরিবর্তনের পরে AGENTS নির্দেশমতো TypeScript/lint চালান; bundle বা Emulator relevant হলে প্রকৃত output সংগ্রহ করুন। ৫. Android/Expo API update হলে versioned official Expo docs অনুসরণ করুন।
