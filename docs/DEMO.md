# Demo script (2 minutes)

**0:00 — the problem.** Two dashboards nobody opens, and an app that is only half
instrumented. One line: "an analytics engineer that lives in Telegram, and a skill that
writes the analytics it reads."

**0:15 — ask a real question.** In Telegram, on a production app:

> Onboarding last week vs the week before?

The reply names the source and the range, shows the funnel step by step, and points at the
biggest drop. Follow up without repeating context:

> And only Android?

**0:40 — the agent knows the code.** Ask something a dashboard cannot answer:

> Why is revenue zero in GA4?

It answers from the catalog: `logPurchase` is only reachable through a method nothing calls.
That is an instrumentation bug found from a chat message.

**1:00 — the other half.** Switch to Claude Code on a three-screen app with no analytics.

```
/flutter-analytics-autopilot app_name=demo_app appmetrica_key=env
```

Time-lapse the run. Land on the coverage table (all 100%), `flutter analyze` clean, and the
diff of `user_profile_sync.dart` — the part almost every app skips.

**1:35 — the loop closes.** Back in Telegram:

```
/instrument https://github.com/<you>/demo_app
```

Show the PR link, then:

> /app demo_app — what does it track?

Answered from a catalog that did not exist two minutes ago.

**1:55 — close.** The skill is an open-standard agent skill: same folder works in Claude Code
and Codex. Repo link.

## Preparation

* Warm the Logs API exports the day before — the first sequential funnel queues an export
  that can take minutes; afterwards it is instant and cached.
* `npm run smoke` on camera-day morning: it prints one line per source.
* Have the PR from a previous `/instrument` run open in a tab as a fallback.
* `git -C examples/demo_app log --oneline` shows the before/after commits if a live run is
  too slow to film.
