// Naming rules that satisfy BOTH sinks. Firebase is the strict one:
// https://support.google.com/analytics/answer/9267744
const RESERVED_PREFIXES = ['firebase_', 'google_', 'ga_'];
const RESERVED_EVENTS = new Set([
  'ad_activeview', 'ad_click', 'ad_exposure', 'ad_impression', 'ad_query', 'ad_reward', 'adunit_exposure', 'app_background', 'app_clear_data', 'app_exception',
  'app_remove', 'app_store_refund', 'app_store_subscription_cancel', 'app_store_subscription_convert', 'app_store_subscription_renew', 'app_update', 'app_upgrade',
  'dynamic_link_app_open', 'dynamic_link_app_update', 'dynamic_link_first_open', 'error', 'first_open', 'first_visit', 'in_app_purchase', 'notification_dismiss',
  'notification_foreground', 'notification_open', 'notification_receive', 'os_update', 'session_start', 'session_start_with_rollout', 'user_engagement',
]);

export const LIMITS = { eventName: 40, paramName: 40, paramsPerEvent: 25, paramValue: 100, userProperties: 25, userPropertyName: 24, userPropertyValue: 36, distinctEvents: 500 };

/** Returns a problem description, or null when the name is fine. */
export function validateEventName(name) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return 'must be snake_case ASCII starting with a letter';
  if (name.length > LIMITS.eventName) return `longer than ${LIMITS.eventName} characters (Firebase drops it)`;
  if (RESERVED_PREFIXES.some((p) => name.startsWith(p))) return 'uses a prefix reserved by Firebase';
  if (RESERVED_EVENTS.has(name)) return 'is a Firebase reserved event name';
  return null;
}

export function validateParamName(name) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return 'must be snake_case ASCII starting with a letter';
  if (name.length > LIMITS.paramName) return `longer than ${LIMITS.paramName} characters`;
  if (RESERVED_PREFIXES.some((p) => name.startsWith(p))) return 'uses a prefix reserved by Firebase';
  return null;
}
