# Naming events and parameters

## Shape

`<subject>_<verb>` in snake_case ASCII, lower case, at most 40 characters:
`home_save_tapped`, `paywall_purchase_confirmed`, `settings_plan_changed`.

* The **subject** is the screen or feature, not the widget class: `checkout_`, not `_ElevatedButtonState`.
* The **verb** is what happened, in the past tense: `tapped`, `submitted`, `changed`, `shown`, `completed`, `failed`, `dismissed`.
* One event per user intent. Two buttons that do the same thing from different places are
  one event with a `source` parameter, not two events.
* Track the **outcome** where one exists. `checkout_submitted` plus `success: false,
  error_type: 'network'` answers more questions than a pile of tap events.

Avoid: `button_clicked`, `click_1`, `screen_a_event`, names that carry a value
(`plan_pro_selected` — use `plan_selected` with `plan: 'pro'`), and names that will change
when the UI is redesigned.

## Parameters

Values are `String`, `num` or `bool` only — no lists, no nested maps, no objects. Convert
`DateTime` with `toIso8601String()`, enums with `.name`.

Reuse these names across the whole app so reports can compare events:

| Parameter | Meaning |
|---|---|
| `source` | where the action started: `home`, `deeplink`, `push`, `widget` |
| `method` | how: `google`, `apple`, `email`, `card` |
| `success` | did it work (bool) |
| `error_type` | short machine-readable class of failure, never the raw message |
| `duration_seconds` | how long it took (num) |
| `value`, `currency` | money |
| `transaction_id`, `product_id` | purchases; `transaction_id` also deduplicates revenue |
| `screen_name` | set by the navigator observer, do not send it yourself |
| `step_id`, `index`, `total_steps` | position inside a flow |
| `item_count` | how many things the action affected |

Keep cardinality low: a parameter with thousands of distinct values is unusable in reports
and expensive to store. Ids are fine (you filter by them), free text is not.

## Never log

Email, phone number, full name, address, password, token, message or note bodies, search
queries, photo paths, precise location. If a product question really needs text, log a
category or a hash decided with the team, and write down why.

## Events you always want

| Event | When |
|---|---|
| `app_opened` | after the first frame |
| `screen_view` | automatic, from the navigator observers |
| `app_error` | from the zone guard |
| `<flow>_started` / `_completed` / `_failed` | any multi-step flow |
| `<feature>_enabled` / `_disabled` | settings toggles |
