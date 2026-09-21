# Platform limits that silently drop data

Exceeding a Firebase limit usually means the event, parameter or property is **dropped
without an error**. This is the single most common reason "the event is not in the console".

## Firebase Analytics (GA4)

| Thing | Limit |
|---|---|
| Event name | 40 chars, `[a-z][a-z0-9_]*`, case-sensitive |
| Distinct event names | 500 per app instance |
| Parameters per event | 25 |
| Parameter name | 40 chars |
| Parameter value | 100 chars (longer is truncated) |
| User properties | 25 per project |
| User property name | 24 chars, must start with a letter |
| User property value | 36 chars |

Reserved prefixes: `firebase_`, `google_`, `ga_`. Reserved event names include `first_open`,
`session_start`, `user_engagement`, `in_app_purchase`, `app_update`, `error`,
`notification_open` — see `scripts/lib/naming.mjs` for the list the validator enforces.

**Parameter values must be `String` or `num`.** A `bool` makes the SDK throw and the whole
event is lost; `analytics_service.dart` coerces bools to `'true'`/`'false'` for Firebase and
passes the original map to AppMetrica.

Event parameters and user properties are NOT queryable in the GA4 Data API until someone
registers them as custom definitions in the GA4 UI (`customEvent:<param>`,
`customUser:<property>`). List the ones worth registering in `docs/ANALYTICS.md`.

## AppMetrica

Event name up to 1000 bytes; parameters are sent as a JSON object, nesting allowed but the
reporting UI only breaks down the first levels, so keep the map flat. Profile attributes:
100 custom attributes per app, string values up to 200 characters. Reports are built on
devices by default — `profile_id` (the user id) is only set once you call `setUserProfileID`.

## Practical consequences

* Design event names under 40 characters from the start; renaming later splits your history.
* Keep the event vocabulary small: 500 distinct names is a hard ceiling, and a report with
  300 near-duplicate events is unreadable long before that.
* Put high-cardinality data in parameters, not in names.
