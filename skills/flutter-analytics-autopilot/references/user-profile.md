# Describing the user

Events say what happened. **User properties say who it happened to** — without them no
report can be split by plan, goal, locale or cohort.

Two sinks, one call site (`UserProfileSync`):

* **Firebase user properties** — sticky key/value pairs on the user. At most 25, names ≤ 24
  chars, values ≤ 36 chars. Only usable in GA4 reports after someone registers them as
  custom user dimensions.
* **AppMetrica user profile** — native typed attributes. Predefined: name, gender, birth
  date, notifications enabled, plus custom string / number / boolean / counter attributes.
  These appear in the AppMetrica UI as segments and in the profiles export.

## Choosing traits

Good: `plan` (free/pro), `locale`, `platform`, `app_version`, `onboarding_complete`,
`goal`, `signup_method`, `notifications_enabled`, `experiment_group`, `days_since_signup`
(bucketed), `is_premium`.

Bad: anything unique per user (email, phone, device id, full name), anything that changes
every session (last screen), free text, and raw counters that grow unbounded — bucket them
(`workouts_logged: '10-49'`) or use a counter attribute.

## Where to call it

| Moment | Call |
|---|---|
| after bootstrap | `UserProfileSync.syncAnonymous(locale: ..., appVersion: ..., platform: ...)` |
| login / signup success | `UserProfileSync.sync(userId: ..., traits: {...})` |
| profile edited | `UserProfileSync.sync(...)` with the new values |
| subscription or plan changed | `UserProfileSync.sync(...)` **and** `Analytics.updateBaseAttribute('is_premium', ...)` |
| logout, account deleted | `UserProfileSync.clear()` |

`sync` also sets the user id on both SDKs, which is what links a device to a person. `clear`
resets the reported traits and the user id — without it, the next person to use the device
inherits the previous user's segments.

## Base attributes vs user properties

Base attributes (`AnalyticsService.setBaseAttributes`) are merged into **every event**, so
they are filterable in event reports immediately, with no registration step. User properties
are attached to the **user** and survive between events. Send the two or three values you
filter by constantly (is_premium, locale, app_version) as both.
