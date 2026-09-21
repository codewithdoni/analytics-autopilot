import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'repository/session_repository.dart';
import 'screens/details_screen.dart';
import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';

void main() => runApp(const DemoApp());

final GoRouter _router = GoRouter(
  routes: [
    GoRoute(
      path: '/',
      builder: (context, state) => const HomeScreen(),
    ),
    GoRoute(
      path: '/details/:id',
      builder: (context, state) => DetailsScreen(
        id: state.pathParameters['id'] ?? '',
      ),
    ),
    GoRoute(
      path: '/settings',
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
