import 'package:flutter/material.dart';

import '../core/analytics/analytics.dart';
import '../core/analytics/analytics_event.dart';

class DetailsScreen extends StatelessWidget {
  const DetailsScreen({required this.id, super.key});

  final String id;

  void _share(BuildContext context) {
    Analytics.track(AnalyticsEvent.detailsShared, parameters: {'item_id': id});
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('Shared item $id')),
    );
  }

  void _showMoreActions(BuildContext context) {
    Analytics.track(
      AnalyticsEvent.detailsActionsOpened,
      parameters: {'item_id': id},
    );
    showModalBottomSheet<void>(
      context: context,
      // Named so the navigator observers report a screen_view for the sheet.
      routeSettings: const RouteSettings(name: 'details_actions_sheet'),
      builder: (sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.copy_outlined),
                title: const Text('Duplicate'),
                onTap: () {
                  Analytics.track(
                    AnalyticsEvent.detailsItemDuplicated,
                    parameters: {'item_id': id},
                  );
                  Navigator.of(sheetContext).pop();
                  _notify(context, 'Duplicated item $id');
                },
              ),
              ListTile(
                leading: const Icon(Icons.delete_outline),
                title: const Text('Delete'),
                onTap: () {
                  Analytics.track(
                    AnalyticsEvent.detailsItemDeleted,
                    parameters: {'item_id': id},
                  );
                  Navigator.of(sheetContext).pop();
                  _notify(context, 'Deleted item $id');
                },
              ),
            ],
          ),
        );
      },
    );
  }

  void _notify(BuildContext context, String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Details #$id')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Item $id',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            const Text('A stand-in detail page for the demo app.'),
            const Spacer(),
            TextButton(
              onPressed: () => _share(context),
              child: const Text('Share'),
            ),
            ElevatedButton(
              onPressed: () => _showMoreActions(context),
              child: const Text('More actions'),
            ),
          ],
        ),
      ),
    );
  }
}
