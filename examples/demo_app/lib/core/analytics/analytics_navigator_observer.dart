import 'package:flutter/widgets.dart';
import 'package:demo_app/core/analytics/analytics.dart';

/// Mirrors navigation to AppMetrica as `screen_view`. Works for pages AND for
/// bottom sheets / dialogs, as long as the route carries a name:
///
///  * `GoRoute(name: 'settings', ...)`
///  * `MaterialPageRoute(settings: const RouteSettings(name: 'details'), ...)`
///  * `showModalBottomSheet(routeSettings: const RouteSettings(name: 'filters_sheet'), ...)`
///
/// Routes without a name are skipped — that is why every route must have one.
class AnalyticsNavigatorObserver extends NavigatorObserver {
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPush(route, previousRoute);
    _report(route);
  }

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    super.didReplace(newRoute: newRoute, oldRoute: oldRoute);
    if (newRoute != null) _report(newRoute);
  }

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) {
    super.didPop(route, previousRoute);
    if (previousRoute != null) _report(previousRoute);
  }

  void _report(Route<dynamic> route) {
    final name = route.settings.name;
    if (name == null || name.isEmpty) return;
    Analytics.trackScreenView(name);
  }
}
