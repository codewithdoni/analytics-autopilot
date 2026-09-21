// Basic smoke test for the demo app.

import 'package:demo_app/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('home screen increments the counter', (tester) async {
    await tester.pumpWidget(const DemoApp());
    // Let the simulated sign-in delay elapse.
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.text('Counter: 0'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.add));
    await tester.pump();

    expect(find.text('Counter: 1'), findsOneWidget);
  });
}
