import 'package:appmetrica_plugin/appmetrica_plugin.dart';
import 'package:flutter/foundation.dart';
import 'package:demo_app/core/secrets/env.dart';

const _isFlutterTest = bool.fromEnvironment('FLUTTER_TEST');

/// Thin wrapper around `appmetrica_plugin`. Everything is a no-op until
/// [activate] succeeds, so tests and unconfigured builds never touch the
/// platform channel.
class AppMetricaService {
  AppMetricaService._();

  static final AppMetricaService instance = AppMetricaService._();

  bool _activated = false;

  bool get isActivated => _activated;

  Future<void> activate() async {
    if (_isFlutterTest || _activated) return;
    final apiKey = Env.yandexMetricaApiKey;
    if (apiKey.isEmpty || apiKey.startsWith('REPLACE_')) {
      debugPrint('AppMetrica: no API key in lib/core/secrets/.env — skipped');
      return;
    }
    try {
      // logs MUST stay false: on iOS verbose logging re-prints the whole pending
      // event buffer on every report — an O(n²) console flood during bursts.
      await AppMetrica.activate(AppMetricaConfig(apiKey, logs: false));
      _activated = true;
      debugPrint('AppMetrica: activated');
    } catch (e) {
      debugPrint('AppMetrica: failed to activate: $e');
    }
  }

  Future<void> reportEvent(String name, [Map<String, Object>? params]) async {
    if (!_activated) return;
    try {
      if (params == null || params.isEmpty) {
        await AppMetrica.reportEvent(name);
      } else {
        await AppMetrica.reportEventWithMap(name, params);
      }
    } catch (e) {
      debugPrint('AppMetrica: failed to report $name: $e');
    }
  }

  Future<void> reportError(Object error, StackTrace stackTrace) async {
    final message = error.toString();
    await reportEvent('app_error', {
      'error_type': error.runtimeType.toString(),
      'message': message.length > 200 ? message.substring(0, 200) : message,
    });
  }

  Future<void> setUserProfileId(String? userId) async {
    if (!_activated) return;
    try {
      await AppMetrica.setUserProfileID(userId);
    } catch (e) {
      debugPrint('AppMetrica: failed to set user profile id: $e');
    }
  }

  /// Native AppMetrica user profile: these attributes become segments and
  /// profile columns in the AppMetrica UI and in the profiles export.
  Future<void> reportUserProfile(AppMetricaUserProfile profile) async {
    if (!_activated) return;
    try {
      await AppMetrica.reportUserProfile(profile);
    } catch (e) {
      debugPrint('AppMetrica: failed to report user profile: $e');
    }
  }
}
