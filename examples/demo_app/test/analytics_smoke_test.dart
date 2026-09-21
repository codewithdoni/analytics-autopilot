import 'package:demo_app/core/analytics/analytics.dart';
import 'package:demo_app/core/analytics/analytics_event.dart';
import 'package:demo_app/core/analytics/analytics_service.dart';
import 'package:demo_app/repository/session_repository.dart';
import 'package:demo_app/screens/home_screen.dart';
import 'package:demo_app/screens/settings_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Proves the instrumentation actually runs: taps reach the facade, events carry
/// their parameters and the base attributes, personal data stays out of them,
/// and nothing throws when neither SDK is configured.
///
/// The facade logs one line per event, so capturing debugPrint is enough — no
/// credentials and no platform channels involved.
void main() {
  /// debugPrint must be restored before the test body ends, or the Flutter test
  /// framework fails the test for leaving a foundation variable changed.
  Future<List<String>> capture(Future<void> Function() body) async {
    final lines = <String>[];
    final original = debugPrint;
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message != null) lines.add(message);
    };
    try {
      await body();
    } finally {
      debugPrint = original;
    }
    return lines;
  }

  setUp(() => AnalyticsService.instance.setBaseAttributes({'platform': 'test'}));

  Future<void> pump(WidgetTester tester, Widget child) {
    return tester.pumpWidget(
      SessionScope(
        notifier: SessionRepository(),
        child: MaterialApp(home: child),
      ),
    );
  }

  testWidgets('a tap fires its event with parameters and base attributes', (
    tester,
  ) async {
    final logged = await capture(() async {
      await pump(tester, const HomeScreen());
      await tester.tap(find.byTooltip('Increment'));
      await tester.pump();
    });

    expect(
      logged,
      contains(
        allOf(
          contains('home_counter_incremented'),
          contains('value: 1'),
          contains('platform: test'),
        ),
      ),
    );
  });

  testWidgets('the display name is never logged, only its length', (
    tester,
  ) async {
    final logged = await capture(() async {
      await pump(tester, const SettingsScreen());
      await tester.enterText(find.byType(TextField), 'Doni');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
    });

    expect(
      logged,
      contains(
        allOf(
          contains('settings_display_name_submitted'),
          contains('length: 4'),
        ),
      ),
    );
    expect(logged.where((line) => line.contains('Doni')), isEmpty);
  });

  testWidgets('a toggle reports the new value', (tester) async {
    final logged = await capture(() async {
      await pump(tester, const SettingsScreen());
      await tester.tap(find.byType(SwitchListTile));
      await tester.pump();
    });

    expect(
      logged,
      contains(
        allOf(
          contains('settings_notifications_toggled'),
          contains('enabled: false'),
        ),
      ),
    );
  });

  test('every declared event survives a round trip with no SDK configured', () async {
    final logged = await capture(() async {
      for (final event in AnalyticsEvent.values) {
        await Analytics.track(event, parameters: {'probe': 1});
      }
    });

    final fired = logged.where(
      (line) => RegExp(r'^Analytics: [a-z0-9_]+ →').hasMatch(line),
    );
    expect(fired.length, AnalyticsEvent.values.length);
    expect(logged.where((line) => line.contains('failed to track')), isEmpty);
  });
}
