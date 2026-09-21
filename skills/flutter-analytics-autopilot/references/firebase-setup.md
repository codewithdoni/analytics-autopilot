# Firebase and AppMetrica project setup

The code compiles and runs without either being configured — events simply go nowhere. These
are the steps a human has to do once, in the console.

## Firebase

1. Create a project, then register the Android app (its `applicationId`) and the iOS app
   (its bundle id). Enable Analytics.
2. `dart pub global activate flutterfire_cli` then, in the project root:
   `flutterfire configure --project=<project-id> --platforms=android,ios --yes`.
   This writes `lib/firebase_options.dart`, `android/app/google-services.json` and
   `ios/Runner/GoogleService-Info.plist`.
3. Android: `android/settings.gradle.kts` needs
   `id("com.google.gms.google-services") version("4.4.2") apply false` in `plugins { }`, and
   `android/app/build.gradle.kts` needs `id("com.google.gms.google-services")`. `minSdk >= 21`.
4. iOS: `ios/Podfile` needs `platform :ios, '15.5'` (or higher) and `use_frameworks!`; run
   `pod install`. `GoogleService-Info.plist` must be added to the Runner target in Xcode, not
   only present on disk.
5. In the bootstrap, pass `options: DefaultFirebaseOptions.currentPlatform` to
   `Firebase.initializeApp` and set `kFirebaseConfigured` to true (or build with
   `--dart-define=FIREBASE_CONFIGURED=true`).
6. Do not commit `google-services.json` / `GoogleService-Info.plist` to a public repository;
   inject them from CI secrets.

**GA4 access for reporting tools**: analytics lands in a linked GA4 property. Its numeric id
is in Firebase console → Project settings → Integrations → Google Analytics. A service
account must be added as a Viewer under GA4 Admin → Property access management before the
Data API returns anything.

## AppMetrica

1. Create an application at appmetrica.yandex.com, copy its **API key** (the SDK key, a UUID)
   — not the OAuth token.
2. Put it in `lib/core/secrets/.env` as `yandexMetricaApiKey=<key>`, then
   `dart run build_runner build --delete-conflicting-outputs`.
3. No native setup is required on either platform: the plugin registers itself, and no ATT
   prompt is needed.
4. Note for the privacy policy: AppMetrica processes data on Yandex servers.

## CI

The build must run `flutter pub get` **and then** `dart run build_runner build
--delete-conflicting-outputs` before compiling, otherwise `env.g.dart` is missing and the
build fails with `_Env.yandexMetricaApiKey undefined`. Materialise `.env` and the Firebase
config files from CI secrets rather than committing them.
