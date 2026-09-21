import 'package:appmetrica_plugin/appmetrica_plugin.dart';
import 'package:demo_app/core/analytics/analytics.dart';
import 'package:demo_app/core/analytics/appmetrica_service.dart';

/// Describes the USER, not just the event stream: Firebase user properties plus
/// the native AppMetrica user profile. Without this nothing can be segmented by
/// plan, goal or locale — those values would only exist inside single events.
///
/// Rules: never put PII in [traits] (no email, phone, user-typed name, free
/// text). Prefer low-cardinality values — they become segments.
class UserProfileSync {
  UserProfileSync._();

  /// Trait keys reported so far, so [clear] resets exactly those.
  static final Set<String> _reportedTraits = {};

  /// Device-level attributes that need no login. Call once after bootstrap.
  static Future<void> syncAnonymous({
    String? locale,
    String? appVersion,
    String? platform,
    bool? notificationsEnabled,
    Map<String, Object?> traits = const {},
  }) {
    return _report(
      notificationsEnabled: notificationsEnabled,
      traits: {
        'locale': locale,
        'app_version': appVersion,
        'platform': platform,
        ...traits,
      },
    );
  }

  /// Call on login, on profile update, and whenever a subscription changes.
  ///
  /// [gender] accepts 'male' / 'female'; anything else maps to other.
  static Future<void> sync({
    required String userId,
    String? name,
    String? gender,
    DateTime? birthDate,
    bool? notificationsEnabled,
    Map<String, Object?> traits = const {},
  }) async {
    await Analytics.setUserId(userId);
    await _report(
      name: name,
      gender: gender,
      birthDate: birthDate,
      notificationsEnabled: notificationsEnabled,
      traits: traits,
    );
  }

  /// Call on logout and on account deletion.
  static Future<void> clear() async {
    final traits = _reportedTraits.toList();
    await AppMetricaService.instance.reportUserProfile(
      AppMetricaUserProfile([
        AppMetricaNameAttribute.withValueReset(),
        AppMetricaGenderAttribute.withValueReset(),
        AppMetricaBirthDateAttribute.withValueReset(),
        for (final key in traits) AppMetricaStringAttribute.withValueReset(key),
      ]),
    );
    await Analytics.setUserProperties({for (final key in traits) key: null});
    _reportedTraits.clear();
    await Analytics.clearAllUserIdentifiers();
  }

  static Future<void> _report({
    String? name,
    String? gender,
    DateTime? birthDate,
    bool? notificationsEnabled,
    Map<String, Object?> traits = const {},
  }) async {
    final present = <String, Object>{};
    traits.forEach((key, value) {
      if (value != null) present[key] = value;
    });
    _reportedTraits.addAll(present.keys);

    final hasPredefined =
        name != null ||
        gender != null ||
        birthDate != null ||
        notificationsEnabled != null;
    if (hasPredefined || present.isNotEmpty) {
      // Written inline on purpose: the element type is inferred from
      // AppMetricaUserProfile, whose attribute supertype the plugin keeps private.
      await AppMetricaService.instance.reportUserProfile(
        AppMetricaUserProfile([
          if (name != null && name.isNotEmpty)
            AppMetricaNameAttribute.withValue(name),
          if (gender != null)
            AppMetricaGenderAttribute.withValue(_gender(gender)),
          if (birthDate != null)
            AppMetricaBirthDateAttribute.withDate(birthDate),
          if (notificationsEnabled != null)
            AppMetricaNotificationEnabledAttribute.withValue(
              notificationsEnabled,
            ),
          for (final entry in present.entries)
            _traitAttribute(entry.key, entry.value),
        ]),
      );
    }
    if (present.isNotEmpty) await Analytics.setUserProperties(present);
  }

  /// Returns the attribute for one trait. Declared `dynamic` because the plugin
  /// does not export the shared attribute supertype; the list literal above
  /// gives it the right context type.
  static dynamic _traitAttribute(String key, Object value) {
    if (value is bool) return AppMetricaBooleanAttribute.withValue(key, value);
    if (value is num) {
      return AppMetricaNumberAttribute.withValue(key, value.toDouble());
    }
    return AppMetricaStringAttribute.withValue(
      key,
      value is Enum ? value.name : value.toString(),
    );
  }

  static AppMetricaGender _gender(String value) {
    switch (value.toLowerCase()) {
      case 'male':
      case 'm':
        return AppMetricaGender.male;
      case 'female':
      case 'f':
        return AppMetricaGender.female;
      default:
        return AppMetricaGender.other;
    }
  }
}
