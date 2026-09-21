# Verifying that events actually arrive

Coverage proves the code is there. These steps prove the data is.

## 1. Console, immediately

Run the app in debug. Every tracked event prints one line:

```
Analytics: home_save_tapped → {platform: android, app_version: 1.0.0, item_count: 3}
AppMetrica: activated
```

No `AppMetrica: activated` line means the key is missing or wrong — events reach Firebase only.

## 2. Firebase DebugView (within a minute)

```bash
# Android
adb shell setprop debug.firebase.analytics.app <applicationId>
# iOS: add the launch argument -FIRDebugEnabled in the Xcode scheme
```

Firebase console → Analytics → DebugView. You should see `screen_view` when you navigate and
your own events when you tap. Check the parameters are there and are not `null`.
Turn it off again with `adb shell setprop debug.firebase.analytics.app .none.`.

## 3. AppMetrica (within about a minute)

AppMetrica console → your app → Real-time (Live stream). Events appear with their parameters.
The user profile shows up under Profiles once `setUserProfileID` has run — that is the check
that `UserProfileSync.sync` works.

## 4. The three failure modes worth checking explicitly

* **Navigate through every tab and sheet**: a `screen_view` with an empty or missing
  `screen_name` means a route without a name.
* **Log in, then log out**: the user id must appear and then disappear; traits must reset.
* **Repeat a purchase with the same `transaction_id`**: it must be counted once.

## 5. Before shipping

* `flutter analyze` clean, `node scripts/coverage.mjs --root .` exits 0.
* `git ls-files | grep -E '\.env$|google-services.json|GoogleService-Info.plist'` prints nothing.
* Register in GA4 the event parameters and user properties you plan to report on
  (custom definitions), otherwise they are invisible to the GA4 Data API.
* Note in the privacy policy that the app sends analytics to Google and to Yandex (AppMetrica
  processes data on Yandex servers).
