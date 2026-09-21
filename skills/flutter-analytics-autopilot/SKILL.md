---
name: flutter-analytics-autopilot
description: Instrument a Flutter app with Firebase Analytics and Yandex AppMetrica — every route, screen, user action and user profile — then prove 100% coverage with a scanner. Use when asked to add or fix analytics in a Flutter project, track screens or events, set user properties, wire up AppMetrica or Firebase Analytics, or audit what an app is missing.
license: MIT
compatibility: Flutter 3.x project on disk; node >= 18 for the bundled scripts; flutter/dart on PATH; flutterfire CLI optional
metadata:
  version: "0.1.0"
  author: analytics-autopilot
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(node:*), Bash(flutter:*), Bash(dart:*), Bash(flutterfire:*), Bash(git status:*), Bash(git diff:*)
---

# Flutter Analytics Autopilot

Take a Flutter app from "no analytics" (or "half-instrumented") to: every route named,
every screen reported, every user action tracked, users described by properties on both
sinks, and a machine-checked coverage report that says 100%.

`$SKILL` below means this skill's directory. In Claude Code use `${CLAUDE_SKILL_DIR}`;
in Codex use the directory this SKILL.md lives in. Set it once:

```bash
SKILL="${CLAUDE_SKILL_DIR:-$PWD/skills/flutter-analytics-autopilot}"
```

Arguments (`$ARGUMENTS`, all optional): `app_name=<snake>` `appmetrica_key=<key|env>`
`firebase_project=<id>` `dry_run=true`.

## Non-negotiables

1. **The scanner decides when you are done**, not your impression. `coverage.mjs` must exit 0.
2. **Never invent a second way to send an event.** Everything goes through `Analytics.track`.
3. **Never log PII or free text.** No email, phone, message bodies, search strings, names
   typed by a user. Log `length`, `is_empty`, an id, or a category instead.
4. **Never commit secrets.** `lib/core/secrets/.env` is added to `.gitignore` *before* it is written.
5. **Do not reformat or refactor** code you are not instrumenting. Diffs stay reviewable.
6. `dry_run=true` means: do steps 1-2, write the plan, print the coverage table, change nothing else.

## Step 1 — Look before you touch

```bash
node "$SKILL/scripts/scan.mjs" --root . --out analytics-inventory.json
```

Read the printed summary and `analytics-inventory.json`. It tells you the router, the
state-management style, what analytics already exists, and lists every route, modal,
screen, action, bloc/cubit handler and user model, each with `file`, `line` and a
`suggested` event name.

If the app already has an analytics layer, **keep it**. Extend the existing facade and
enum instead of installing a parallel one; only scaffold what `setup` reports missing.

Read `references/router-patterns.md` for what the scanner can and cannot see. Anything it
marks `delegate` you must open and judge yourself.

## Step 2 — Write the plan

Produce `analytics/plan.json` — the single source of truth for event names:

```json
{
  "events": [
    { "name": "home_save_tapped", "domain": "Home", "params": ["item_count"] },
    { "name": "settings_plan_changed", "domain": "Settings", "params": ["plan", "source"] }
  ],
  "user_properties": ["plan", "locale", "notifications_enabled"],
  "funnels": { "signup": ["app_opened", "signup_started", "signup_completed"] }
}
```

Rules for names and parameters are in `references/event-naming.md`; platform limits (which
silently drop events when exceeded) are in `references/limits.md`. Read both before writing
the plan. Start from the `suggested` names in the inventory, then fix them by hand: a good
name says what the user did, not which widget they touched.

Also write `analytics/funnels.json` with the ordered funnels (same content as the `funnels`
key) — the catalog step reads it.

Show the plan as a short table (screen, action, event, params) before continuing. If you are
interactive, ask for corrections; if you are headless, continue.

## Step 3 — Scaffold what is missing

Skip anything that already exists and works. `{{PACKAGE}}` in the templates is the `name:`
from `pubspec.yaml`.

**Dependencies** (`flutter pub add firebase_core firebase_analytics appmetrica_plugin envied`
and `flutter pub add --dev envied_generator build_runner`). Keep `appmetrica_plugin: ^3.4.0`.

**Secrets — gitignore first, then write:**

```bash
grep -qxF 'lib/core/secrets/.env' .gitignore || printf '\n# analytics secrets (never commit)\nlib/core/secrets/.env\n' >> .gitignore
```

Then `lib/core/secrets/.env` with `yandexMetricaApiKey=<key>` (from `appmetrica_key=`, or the
placeholder from `assets/templates/dotenv.example.tmpl` when none was given), copy
`env.dart.tmpl` → `lib/core/secrets/env.dart`, commit `.env.example` next to it, and run
`dart run build_runner build --delete-conflicting-outputs`.

**Analytics layer** — copy into `lib/core/analytics/`, replacing `{{PACKAGE}}`:

| Template | Destination | Role |
|---|---|---|
| `analytics.dart.tmpl` | `analytics.dart` | the only API call sites use |
| `analytics_service.dart.tmpl` | `analytics_service.dart` | fan-out, base attributes, purchase dedup, Firebase-safe coercion |
| `appmetrica_service.dart.tmpl` | `appmetrica_service.dart` | AppMetrica wrapper, no-op until activated |
| `analytics_event.dart.tmpl` | `analytics_event.dart` | typed enum (generated block) |
| `analytics_navigator_observer.dart.tmpl` | `analytics_navigator_observer.dart` | screen_view for AppMetrica |
| `user_profile_sync.dart.tmpl` | `user_profile_sync.dart` | Firebase user properties + AppMetrica profile |

**Firebase**: if `firebase_project=` was given and `flutterfire` is logged in, run
`flutterfire configure --project=<id> --platforms=android,ios --yes`, then import
`firebase_options.dart` in the bootstrap and pass `options:`. Otherwise leave the
`kFirebaseConfigured` guard in place and write the remaining manual steps into
`docs/ANALYTICS.md` (see `references/firebase-setup.md`). The app must compile and run either way.

**Bootstrap**: merge `bootstrap_snippet.dart.tmpl` into the existing `main.dart` — keep the
app's own initialisation, add `runZonedGuarded`, Firebase init on the critical path, then a
deferred block that activates AppMetrica, seeds base attributes, calls
`UserProfileSync.syncAnonymous(...)` and fires `app_opened`. Never delay the first frame.

**Observers**: add `AnalyticsService.instance.navigatorObservers` to the `GoRouter`
(`observers:`) or `MaterialApp` (`navigatorObservers:`). With `auto_route`, pass them to
`navigatorObservers` on the router delegate.

## Step 4 — Name every route and modal

`screen_view` is derived from `route.settings.name`. A route with no name is invisible.

* `GoRoute(path: '/details/:id', name: 'details', ...)` — name every route, including shell and nested ones.
* `MaterialPageRoute(settings: const RouteSettings(name: 'details'), builder: ...)`.
* `showModalBottomSheet(routeSettings: const RouteSettings(name: 'filters_sheet'), ...)`,
  same for `showDialog`, `showCupertinoModalPopup` and friends. Suffix sheets `_sheet` and dialogs `_dialog`.

Names are snake_case and stable — renaming one breaks historical reports.

## Step 5 — Track every action

For each entry in `actions` that is not yet `instrumented`, add exactly one
`Analytics.track(...)` at the place where the user's intent is known:

```dart
onPressed: () {
  Analytics.track(AnalyticsEvent.homeSaveTapped, parameters: {'item_count': items.length});
  _save();
},
```

* When the handler delegates to a method, a bloc event or a cubit method (the inventory's
  `delegates` field), instrument **inside** that method — one event, not two.
* Outcome matters more than the tap: for anything that can fail, track the result with
  `success` and `error_type` rather than only the attempt.
* Toggles send the new value (`enabled: true`). Selections send the chosen value, never free text.
* A handler that genuinely must not be tracked gets `// analytics:ignore <reason>` on the line
  above. Use this sparingly; the reason is read by humans.
* Non-routed screens (tabs, `PageView` pages) fire their `<screen>_shown` event once, from
  `initState` or the first build — not on every rebuild.

Then regenerate the enum (idempotent, safe to re-run):

```bash
node "$SKILL/scripts/gen_events.mjs" --root . --plan analytics/plan.json
```

## Step 6 — Describe the user

Call `UserProfileSync.syncAnonymous(...)` at bootstrap; call `UserProfileSync.sync(...)` on
login, on profile update and whenever a subscription or plan changes; call
`UserProfileSync.clear()` on logout and account deletion. Map the app's user model to traits
using `references/user-profile.md`. Low cardinality, no PII.

## Step 7 — Prove it

```bash
node "$SKILL/scripts/coverage.mjs" --root . --json coverage.json
flutter analyze
```

Fix what the report lists and run it again. Loop until it prints `COVERAGE COMPLETE` and
`flutter analyze` is clean. Do not hand-edit `coverage.json`, and do not use
`// analytics:ignore` to make the number go up.

## Step 8 — Leave a record

```bash
node "$SKILL/scripts/catalog.mjs" --root . --funnels analytics/funnels.json
```

This writes `analytics_catalog.json`: every event, its parameters, where it fires, the
funnels, and the remaining gaps. Then write `docs/ANALYTICS.md` — architecture in a
paragraph, the event table, the user properties, and the verification steps from
`references/verification.md`. Finish by printing the coverage table and the catalog summary.
