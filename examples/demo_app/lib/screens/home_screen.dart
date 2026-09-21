import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/analytics/analytics.dart';
import '../core/analytics/analytics_event.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const int _itemCount = 3;

  int _counter = 0;

  void _increment() {
    setState(() => _counter++);
    Analytics.track(
      AnalyticsEvent.homeCounterIncremented,
      parameters: {'value': _counter},
    );
  }

  /// [source] tells the two entry points apart: the list and the main button.
  void _openItem(String id, {required String source}) {
    Analytics.track(
      AnalyticsEvent.homeDetailsOpened,
      parameters: {'source': source, 'item_id': id},
    );
    context.go('/details/$id');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Home'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            tooltip: 'Settings',
            onPressed: () {
              Analytics.track(AnalyticsEvent.homeSettingsTapped);
              context.go('/settings');
            },
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'Counter: $_counter',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: ElevatedButton(
              onPressed: () => _openItem('42', source: 'cta'),
              child: const Text('Open details'),
            ),
          ),
          const SizedBox(height: 8),
          const Divider(height: 1),
          Expanded(
            child: ListView.builder(
              itemCount: _itemCount,
              itemBuilder: (context, index) {
                return ListTile(
                  leading: const Icon(Icons.article_outlined),
                  title: Text('Item $index'),
                  subtitle: Text('Opens /details/$index'),
                  onTap: () => _openItem('$index', source: 'list'),
                );
              },
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _increment,
        tooltip: 'Increment',
        child: const Icon(Icons.add),
      ),
    );
  }
}
