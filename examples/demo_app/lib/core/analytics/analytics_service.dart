import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/widgets.dart';
import 'package:demo_app/core/analytics/analytics_event.dart';
import 'package:demo_app/core/analytics/analytics_navigator_observer.dart';
import 'package:demo_app/core/analytics/appmetrica_service.dart';

/// Single fan-out path: every event is merged with the base attributes and
/// forwarded to BOTH Firebase Analytics and AppMetrica.
///
/// Call sites never touch this class — they use the `Analytics` facade.
class AnalyticsService {
  AnalyticsService._();

  static final AnalyticsService instance = AnalyticsService._();

  final AppMetricaService _appMetrica = AppMetricaService.instance;
  final Map<String, Object> _baseAttributes = {};
  final Set<String> _seenTransactions = {};

  /// Firebase is optional at runtime: until `Firebase.initializeApp` has run
  /// (or when the project is not configured yet) events still reach AppMetrica.
  FirebaseAnalytics? get _firebase =>
      Firebase.apps.isEmpty ? null : FirebaseAnalytics.instance;

  /// Register these on the router / MaterialApp. Firebase records `screen_view`
  /// through its own observer; ours mirrors it to AppMetrica.
  List<NavigatorObserver> get navigatorObservers => [
    if (_firebase != null) FirebaseAnalyticsObserver(analytics: _firebase!),
    AnalyticsNavigatorObserver(),
  ];

  // ---------------------------------------------------------------- base attributes

  /// Values attached to every event. Seed once after bootstrap; refresh single
  /// keys with [updateBaseAttribute] when long-lived state flips.
  void setBaseAttributes(Map<String, Object?> attributes) {
    _baseAttributes.clear();
    attributes.forEach((key, value) {
      if (value != null) _baseAttributes[key] = value;
    });
    debugPrint('Analytics: base attributes → $_baseAttributes');
  }

  void updateBaseAttribute(String key, Object? value) {
    if (value == null) {
      _baseAttributes.remove(key);
    } else {
      _baseAttributes[key] = value;
    }
  }

  // ---------------------------------------------------------------- events

  Future<void> track(
    AnalyticsEvent event, {
    Map<String, Object?>? parameters,
  }) async {
    final params = parameters ?? const <String, Object?>{};

    // Revenue events must never double-count: dedupe on transaction_id.
    final txId = params['transaction_id'];
    if (txId is String && txId.isNotEmpty) {
      final key = '${event.rawValue}_$txId';
      if (!_seenTransactions.add(key)) {
        debugPrint('Analytics: duplicate ${event.rawValue} ($txId) skipped');
        return;
      }
    }

    final merged = _mergeWithBase(params);
    try {
      await _firebase?.logEvent(
        name: event.rawValue,
        parameters: _firebaseSafe(merged),
      );
    } catch (e) {
      debugPrint('Analytics: Firebase logEvent failed (${event.rawValue}): $e');
    }
    await _appMetrica.reportEvent(event.rawValue, merged);
    debugPrint(
      'Analytics: ${event.rawValue}${merged.isEmpty ? '' : ' → $merged'}',
    );
  }

  Future<void> trackScreenView(String screenName) async {
    final merged = _mergeWithBase({'screen_name': screenName});
    await _appMetrica.reportEvent(AnalyticsEvent.screenView.rawValue, merged);
    debugPrint('Analytics: screen_view → $screenName');
  }

  Map<String, Object> _mergeWithBase(Map<String, Object?> params) {
    final merged = <String, Object>{..._baseAttributes};
    params.forEach((key, value) {
      if (value != null) merged[key] = value;
    });
    return merged;
  }

  /// Firebase only accepts String / num values: a bool makes it drop the whole
  /// event, and strings are capped at 100 characters. AppMetrica takes the raw map.
  Map<String, Object> _firebaseSafe(Map<String, Object> params) {
    final safe = <String, Object>{};
    for (final entry in params.entries.take(25)) {
      final value = entry.value;
      if (value is num) {
        safe[entry.key] = value;
      } else {
        final text = value is Enum ? value.name : value.toString();
        safe[entry.key] = text.length > 100 ? text.substring(0, 100) : text;
      }
    }
    return safe;
  }

  // ---------------------------------------------------------------- identity

  Future<void> setUserId(String? userId) async {
    try {
      await _firebase?.setUserId(id: userId);
    } catch (e) {
      debugPrint('Analytics: Firebase setUserId failed: $e');
    }
    await _appMetrica.setUserProfileId(userId);
    updateBaseAttribute('user_id', userId);
  }

  /// Sticky Firebase user properties, sanitised to Firebase limits:
  /// at most 25, names `[a-z][a-z0-9_]{0,23}`, values at most 36 characters.
  Future<void> setUserProperties(Map<String, Object?> properties) async {
    final firebase = _firebase;
    if (firebase == null) return;
    for (final entry in properties.entries.take(25)) {
      final name = _propertyName(entry.key);
      if (name == null) continue;
      final raw = entry.value;
      final text = raw == null
          ? null
          : (raw is Enum ? raw.name : raw.toString());
      try {
        await firebase.setUserProperty(
          name: name,
          value: text == null || text.length <= 36
              ? text
              : text.substring(0, 36),
        );
      } catch (e) {
        debugPrint('Analytics: setUserProperty($name) failed: $e');
      }
    }
  }

  String? _propertyName(String key) {
    final cleaned = key.toLowerCase().replaceAll(RegExp('[^a-z0-9_]'), '_');
    if (cleaned.isEmpty || !RegExp('^[a-z]').hasMatch(cleaned)) return null;
    if (cleaned.startsWith('firebase_') ||
        cleaned.startsWith('google_') ||
        cleaned.startsWith('ga_')) {
      return null;
    }
    return cleaned.length > 24 ? cleaned.substring(0, 24) : cleaned;
  }

  Future<void> clearAllUserIdentifiers() async {
    await setUserId(null);
    _seenTransactions.clear();
  }
}
