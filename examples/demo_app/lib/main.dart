import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'core/analytics/analytics.dart';
import 'core/analytics/analytics_event.dart';
import 'core/analytics/analytics_service.dart';
import 'core/analytics/appmetrica_service.dart';
import 'core/analytics/user_profile_sync.dart';
import 'repository/session_repository.dart';
import 'screens/details_screen.dart';
import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';

/// True once `flutterfire configure` has produced firebase_options.dart.
/// Build with --dart-define=FIREBASE_CONFIGURED=true to switch Firebase on.
const kFirebaseConfigured = bool.fromEnvironment('FIREBASE_CONFIGURED');

void main() {
  runZonedGuarded(
    () async {
      WidgetsFlutterBinding.ensureInitialized();
      runApp(const DemoApp());
      unawaited(_deferredBootstrap());
    },
    (error, stackTrace) {
      if (kDebugMode) debugPrint('Uncaught: $error\n$stackTrace');
      AppMetricaService.instance.reportError(error, stackTrace);
    },
  );
}

/// Runs after the first frame: analytics must never delay startup, and one
/// failing SDK must never block the others.
Future<void> _deferredBootstrap() async {
  if (kFirebaseConfigured) {
    // After `flutterfire configure`, pass
    // options: DefaultFirebaseOptions.currentPlatform.
    await _safe('Firebase', () => Firebase.initializeApp(), timeout: 8);
  }
  await _safe('AppMetrica', AppMetricaService.instance.activate, timeout: 5);

  AnalyticsService.instance.setBaseAttributes({
    'platform': defaultTargetPlatform.name,
    'app_version': _appVersion,
  });
  await UserProfileSync.syncAnonymous(
    platform: defaultTargetPlatform.name,
    appVersion: _appVersion,
  );
  await Analytics.track(AnalyticsEvent.appOpened);
}

const String _appVersion = String.fromEnvironment(
  'APP_VERSION',
  defaultValue: '1.0.0',
);

/// Run one bootstrap task with a timeout; log instead of throwing.
Future<void> _safe(
  String name,
  Future<void> Function() task, {
  required int timeout,
}) async {
  try {
    await task().timeout(Duration(seconds: timeout));
  } catch (e) {
    debugPrint('Bootstrap: $name failed: $e');
  }
}

final GoRouter _router = GoRouter(
  // Firebase records screen_view through its own observer; ours mirrors it to
  // AppMetrica. Both read route.settings.name, so every route below is named.
  observers: AnalyticsService.instance.navigatorObservers,
  routes: [
    GoRoute(
      path: '/',
      name: 'home',
      builder: (context, state) => const HomeScreen(),
    ),
    GoRoute(
      path: '/details/:id',
      name: 'details',
      builder: (context, state) => DetailsScreen(
        id: state.pathParameters['id'] ?? '',
      ),
    ),
    GoRoute(
      path: '/settings',
      name: 'settings',
      builder: (context, state) => const SettingsScreen(),
    ),
  ],
);

class DemoApp extends StatefulWidget {
  const DemoApp({super.key});

  @override
  State<DemoApp> createState() => _DemoAppState();
}

class _DemoAppState extends State<DemoApp> {
  final SessionRepository _session = SessionRepository();

  @override
  void initState() {
    super.initState();
    unawaited(_session.signIn('demo@autopilot.com'));
  }

  @override
  void dispose() {
    _session.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SessionScope(
      notifier: _session,
      child: MaterialApp.router(
        title: 'Demo App',
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
        ),
        routerConfig: _router,
      ),
    );
  }
}
