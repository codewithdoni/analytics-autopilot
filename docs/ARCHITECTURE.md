# Architecture

```
                      Telegram (where the team already talks)
                                    │
                            grammY long polling
                                    │
                 ┌──────────────────┴───────────────────┐
                 │  agent (OpenAI Agents SDK)           │
                 │  instructions = persona + catalog    │
                 │  memory = MemorySession per chat     │
                 └──────────────────┬───────────────────┘
                                    │ 10 tools, zod-typed
   ┌──────────────┬─────────────────┼──────────────────┬────────────────┐
   │              │                 │                  │                │
AppMetrica      GA4 Data API   Remote Config      RevenueCat       event catalog
 Reporting      runReport      read + guarded      overview        catalog/<app>.json
 Logs (raw)     realtime       human-confirmed                      ▲
 Management                       write                             │ generated from source
                                                                    │
                    skills/flutter-analytics-autopilot ─────────────┘
                    (Claude Code / Codex) instruments the app
```

## Why a catalog

A general-purpose analytics agent guesses event names and quietly returns zeros. This one
reads a catalog generated from the app's own source: every event, its parameters, the file
and line where it fires, its funnel, and its status (`active`, `dead`, `raw`,
`bypasses_fanout`). The catalog's `gaps` list goes straight into the agent's instructions,
so it can explain a wrong number instead of reporting it.

`packages/analytics-core/src/catalog.ts` loads it; `scripts/build-catalog.mjs` builds one for
an existing app; the skill emits the same shape for an app it just instrumented.

## Bot internals

* `agent.ts` — persona, per-run instructions (today's date, which sources are configured,
  the catalog brief), tool registry.
* `tools/*.ts` — one module per source. Every `execute` is wrapped by `guarded()`, which
  turns a failure into `{error, hint}` and keeps results under ~6 KB.
* `runner.ts` — one turn: `run(agent, text, { session, context, maxTurns, signal })`.
* `sessions.ts` — per-chat memory, active app, and a mutex so one chat never has two runs
  interleaving tool calls.
* `telegram/format.ts` — model Markdown → the Telegram HTML subset, tables as monospace
  blocks, split into chunks that never break a tag.
* `context.ts` — the proposal store behind human-confirmed Remote Config writes.
* `instrument/orchestrator.ts` — clone → create the AppMetrica app → run the coding agent
  headlessly → commit → PR → load the catalog.

## Skill internals

* `scripts/lib/dart.mjs` — a comment/string-masked view of Dart source plus bracket
  matching. Not a parser; enough structure to trust the regexes above it.
* `scripts/lib/scan-core.mjs` — the inventory: routes, modals, screens, actions, bloc/cubit
  handlers, user models, and what the analytics scaffold is missing. Resolves one hop of
  delegation (tear-off, bloc event, controller method).
* `scripts/coverage.mjs` — the gate. Exits non-zero with a worklist until every category is
  complete.
* `scripts/gen_events.mjs` — rewrites the enum between markers from `analytics/plan.json`,
  validating names against Firebase's limits.
* `assets/templates/*.dart.tmpl` — the runtime: facade, fan-out service, AppMetrica wrapper,
  navigator observer, user-profile sync, bootstrap.

## Decisions worth knowing

**Firebase and AppMetrica, not one of them.** Firebase answers product questions and is free;
AppMetrica gives raw event and profile exports (so exact sequential funnels are possible) and
is the one that works well in the CIS. One fan-out keeps them consistent.

**The fan-out coerces for Firebase only.** Firebase drops an entire event if a parameter is a
bool, and truncates strings at 100 characters. AppMetrica receives the original map.

**Screens come from route names.** Both observers read `route.settings.name`, so naming every
route, sheet and dialog is not a style preference — an unnamed route produces no `screen_view`
at all. That is why it is a coverage category.

**Writes are human-gated.** The agent can read everything and change nothing. The only write
path is a Remote Config proposal that a person confirms with a button, validated by Firebase
first and applied with an `If-Match` ETag.
