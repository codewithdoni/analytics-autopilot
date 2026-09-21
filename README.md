# Analytics Autopilot

An analytics engineer that lives in your Telegram chat — and an agent skill that writes the
analytics it reads.

Most mobile teams have the same two problems. Nobody opens the analytics console, because
answering "why did paywall conversion drop on Android last week?" means three dashboards and
twenty minutes. And the data is half-missing anyway, because instrumenting every screen and
every button is boring work that never makes the sprint.

This project attacks both ends:

- **The bot** answers analytics questions where the team already talks, in plain language,
  across AppMetrica, GA4 (Firebase), RevenueCat and Firebase Remote Config. It knows the
  app's real event names because it reads a catalog generated from the app's source code.
- **The skill** is installed into Claude Code or Codex. One prompt takes a Flutter app from
  zero to every route named, every screen reported, every action tracked and users described
  by properties — then proves it with a coverage gate that exits non-zero until it is 100%.

They close a loop: the skill instruments an app and emits its event catalog; the bot loads
that catalog and can immediately answer questions about the app that did not exist an hour
ago. `/instrument <github-url>` in Telegram runs the whole thing and opens a pull request.

## What it looks like

```
you   Onboarding last week vs the week before?
bot   AppMetrica, 14–20 Sep vs 7–13 Sep. Onboarding funnel, devices:

      step                      users   step %
      onboarding_started        4 812      —
      onboarding_step_shown     4 651    96.7
      onboarding_data_captured  3 402    73.1
      onboarding_completed      2 190    64.4

      Overall 45.5%, up from 43.1%. The big loss is still
      onboarding_data_captured → onboarding_completed: 1,212 people.

you   Why is revenue zero in GA4?
bot   It is not a reporting problem. In the catalog, logPurchase is only
      called from logSubscriptionPurchased(), and nothing calls that
      method — so GA4 never receives a purchase. Use RevenueCat for money
      until that is wired up.
```

## Repository layout

| Path | What it is |
|---|---|
| `apps/bot` | Telegram bot: the agent, its tools, the digest, `/instrument` |
| `packages/analytics-core` | API clients (AppMetrica, GA4, Remote Config, RevenueCat), funnel math, catalog loader |
| `skills/flutter-analytics-autopilot` | The agent skill: SKILL.md, scanner, coverage gate, Dart templates |
| `scripts/build-catalog.mjs` | Build an event catalog from an existing Flutter app |
| `catalog/` | Generated catalogs, one JSON per app |
| `examples/demo_app` | A three-screen Flutter app, instrumented by the skill as a worked example |

## Quickstart — the bot

Needs Node 22+.

```bash
npm install
cp .env.example .env     # fill in what you have; every source is optional
npm run smoke            # one line per data source, no LLM involved
npm run catalog -- --repo /path/to/your/flutter/app --app myapp
npm run bot
```

Then message the bot. `/id` tells you the chat id to put in `ALLOWED_CHAT_IDS` — everyone
else is ignored. Without Telegram, ask from the terminal:

```bash
npm run ask -- "DAU last 7 days vs the week before"
```

### Credentials

| Variable | Where it comes from | Without it |
|---|---|---|
| `OPENAI_API_KEY` | platform.openai.com | nothing works |
| `TELEGRAM_BOT_TOKEN` | @BotFather | use `npm run ask` instead |
| `APPMETRICA_OAUTH_TOKEN` | oauth.yandex.com, scopes `appmetrica:read` **and** `appmetrica:write` | no events, funnels or profiles |
| `APPMETRICA_APP_ID` | AppMetrica → Settings | as above |
| `GOOGLE_APPLICATION_CREDENTIALS` | a service-account JSON, added as **Viewer on the GA4 property** | no GA4, no Remote Config |
| `GA4_PROPERTY_ID` | Firebase → Project settings → Integrations → Google Analytics | no GA4 |
| `FIREBASE_PROJECT_ID` | Firebase console | no Remote Config |
| `REVENUECAT_SECRET_KEY`, `REVENUECAT_PROJECT_ID` | RevenueCat dashboard | no subscription revenue |

A missing credential disables exactly one tool. The agent says which source is unavailable
and answers from the rest.

### What the bot can do

| Command | |
|---|---|
| anything in plain language | ask in Uzbek, Russian or English |
| `/digest` | active and new users, sessions, top events, funnels and revenue vs the previous period |
| `/funnel <name>` | one funnel from the catalog, this period against the last |
| `/flags` | Remote Config parameters and kill switches |
| `/apps`, `/app <name>` | switch between catalogs |
| `/instrument <github-url>` | clone, instrument, open a PR, load the new catalog |

Remote Config is read-only for the model. When you ask for a flag change it files a proposal
and you get Apply / Cancel buttons; only your tap writes anything, and the write is
`If-Match`-guarded so a template someone else edited meanwhile is never clobbered.

## Quickstart — the skill

```bash
skills/flutter-analytics-autopilot/install.sh
```

Open a Flutter project in a **new** session (skills load at startup) and run:

```
/flutter-analytics-autopilot app_name=my_app appmetrica_key=<sdk-key>
```

Codex uses `$flutter-analytics-autopilot`. Add `dry_run=true` to get the plan without edits.

The skill scans the project, writes an event plan for you to correct, scaffolds the
analytics layer, names every route and modal, instruments every handler, wires user-profile
sync, and then loops on its own coverage report until:

```
Category                   Covered  Total     %
Routes named                     3      3   100
Modals with routeSettings        2      2   100
Screens reported                 3      3   100
User actions instrumented       12     12   100
Event names valid               17     17   100
Scaffold / bootstrap            11     11   100
User profile sync                1      1   100

COVERAGE COMPLETE
```

That table is from `examples/demo_app`, which is in this repo before and after: commit one
is the bare `flutter create` app, and `git log -p examples/demo_app` is the diff the skill
produces.

The scanner and the gate also run standalone, on any Flutter project, without an agent:

```bash
node skills/flutter-analytics-autopilot/scripts/scan.mjs --root /path/to/app
node skills/flutter-analytics-autopilot/scripts/coverage.mjs --root /path/to/app
```

## The event catalog

The catalog is what makes the agent trustworthy: it is generated from source, so the bot
uses real event names, knows which parameters exist, and can point at the file and line
where an event fires. It also records what is *broken* — events declared but never fired,
events that reach only one SDK, routes with no name, names Firebase will silently reject.

```bash
npm run catalog -- --repo ~/apps/plusfit --app plusfit
```

```
plusfit: 131 events (104 active, 14 dead, 12 raw, 1 bypass), 51 screens, 7 funnels
  gap: Revenue never reaches GA4: logPurchase is only called from
       logSubscriptionPurchased(), and nothing calls it.
  gap: 31 bottom sheets open without routeSettings, so they never produce a screen_view.
  gap: No user properties are set anywhere, so users cannot be segmented by plan or goal.
```

Those gaps are injected into the agent's instructions, which is why it can explain a
suspicious number instead of reporting it.

## Design notes

**Every number carries its source and range.** The agent is instructed to name the source
(AppMetrica / GA4 / RevenueCat) and the dates for every figure, and to say which source
failed rather than quietly omitting it.

**Two funnel modes.** `fast` counts unique users per event from the Reporting API — instant,
but steps are independent. `sequential` replays raw events from the Logs API and only counts
an entity at step *n* if it got there after step *n−1*. The first Logs API call queues an
export and can take minutes; results are cached to disk so a demo never waits twice.

**Tools never throw into the agent loop.** A failing source returns `{error, hint}`, so one
dead credential degrades the answer instead of killing the turn.

**The skill is regex-based on purpose.** No Dart analyzer, no build step — it runs anywhere
an agent runs, in about a second on a 500-file project. What it cannot see is documented in
`references/router-patterns.md`, and everything ambiguous is reported for a human (or the
agent) to open rather than silently assumed.

## Tests

```bash
npm test          # scanner, catalog, funnel math, Telegram formatting
npm run typecheck
npm run selfcheck # builds the agent offline and validates every tool schema
```

The demo app has its own tests proving the generated instrumentation fires with the right
parameters and keeps typed text out of the payload: `cd examples/demo_app && flutter test`.

## Security

Secrets live in `.env` and `secrets/`, both gitignored, and the skill appends
`lib/core/secrets/.env` to the target app's `.gitignore` *before* it writes the key there.
`/instrument` refuses to commit if that file is not ignored. Chat access is an allow-list.
Point `/instrument` only at repositories you trust — it runs a coding agent with edit
permissions inside the clone.

## License

MIT.
