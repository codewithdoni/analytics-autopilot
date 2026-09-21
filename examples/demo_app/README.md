# demo_app

A three-screen Flutter app whose only purpose is to show what
[flutter-analytics-autopilot](../../skills/flutter-analytics-autopilot) does to a codebase.

Two commits tell the story:

```bash
git log --oneline -- examples/demo_app
git show <second-commit> -- examples/demo_app/lib   # the instrumentation diff
```

**Before**: `flutter create` plus go_router, three screens, a bottom sheet, a dialog, a
counter, a settings form. Zero analytics, three routes without names.

**After**: every route and modal named, twelve user actions tracked, user-profile sync on
both sinks, a typed event enum generated from `analytics/plan.json`, and
`analytics_catalog.json` — the file the Telegram agent reads to answer questions about
this app.

## Running it

The AppMetrica key is read through [envied](https://pub.dev/packages/envied), whose
generated file is not committed, so generate it once after cloning:

```bash
cp lib/core/secrets/.env.example lib/core/secrets/.env   # placeholder key is fine
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter test      # 5 tests, proves the instrumentation fires
flutter run       # every event prints one "Analytics: …" line
```

Nothing is sent anywhere until you put a real AppMetrica key in `lib/core/secrets/.env`
(gitignored) and run `flutterfire configure` for Firebase. Both SDKs are optional at
runtime: the app works, logs locally, and never crashes when they are absent.

## Checking it

```bash
node ../../skills/flutter-analytics-autopilot/scripts/scan.mjs --root .      # the inventory
node ../../skills/flutter-analytics-autopilot/scripts/coverage.mjs --root .  # the gate
```

What is tracked, and what is deliberately not, is in [docs/ANALYTICS.md](docs/ANALYTICS.md).
