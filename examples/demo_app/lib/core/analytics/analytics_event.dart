/// Typed event taxonomy. Raw values are snake_case, at most 40 characters.
///
/// GENERATED between the markers by `scripts/gen_events.mjs` from
/// `analytics/plan.json` — edit the plan, not this block.
enum AnalyticsEvent {
  // <autopilot:events>
  // System
  /// Parameters: error_type, message.
  appError('app_error'),
  appOpened('app_opened'),
  /// Parameters: screen_name.
  screenView('screen_view'),

  // Details
  /// Parameters: item_id.
  detailsActionsOpened('details_actions_opened'),
  /// Parameters: item_id.
  detailsItemDeleted('details_item_deleted'),
  /// Parameters: item_id.
  detailsItemDuplicated('details_item_duplicated'),
  /// Parameters: item_id.
  detailsShared('details_shared'),

  // Home
  /// Parameters: value.
  homeCounterIncremented('home_counter_incremented'),
  /// Parameters: source, item_id.
  homeDetailsOpened('home_details_opened'),
  homeSettingsTapped('home_settings_tapped'),

  // Session
  /// Parameters: method.
  sessionSignedIn('session_signed_in'),
  sessionSignedOut('session_signed_out'),

  // Settings
  /// Parameters: length.
  settingsDisplayNameSubmitted('settings_display_name_submitted'),
  /// Parameters: enabled.
  settingsNotificationsToggled('settings_notifications_toggled'),
  /// Parameters: plan, previous_plan.
  settingsPlanChanged('settings_plan_changed'),
  /// Parameters: confirmed.
  settingsSignOutCompleted('settings_sign_out_completed'),
  settingsSignOutTapped('settings_sign_out_tapped');
  // </autopilot:events>

  const AnalyticsEvent(this.rawValue);

  final String rawValue;
}
