// Fixture-based tests for the Dart scanner. Each test writes a tiny project to a
// temp dir, so the expectations are readable next to the code they describe.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { matchBracket, views } from './lib/dart.mjs';
import { fitName, scanProject } from './lib/scan-core.mjs';
import { buildCatalog } from './lib/catalog-core.mjs';
import { validateEventName } from './lib/naming.mjs';

const temps = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** files: { 'lib/main.dart': '...' }. pubspec deps default to go_router + bloc. */
function project(files, { pubspec = null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'scan-fixture-'));
  temps.push(root);
  writeFileSync(
    path.join(root, 'pubspec.yaml'),
    pubspec ?? ['name: fixture_app', 'dependencies:', '  flutter:', '    sdk: flutter', '  go_router: ^17.0.0', '  flutter_bloc: ^9.0.0', ''].join('\n'),
  );
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe('source views', () => {
  it('blanks comments and string contents but keeps offsets', () => {
    const src = `const a = 'he//llo'; // trailing\nconst b = "x";`;
    const { code, mask } = views(src);
    assert.equal(code.length, src.length);
    assert.equal(mask.length, src.length);
    assert.match(code, /'he\/\/llo'/); // strings survive in `code`
    assert.doesNotMatch(mask, /he\/\/llo/); // and are blanked in `mask`
    assert.doesNotMatch(code, /trailing/); // comments are gone from both
    assert.equal(src.indexOf('const b'), code.indexOf('const b'));
  });

  it('does not end a string at a quote inside an interpolation', () => {
    // Dart source: final s = 'a ${map['key']} b'; final t = 1;
    const dart = "final s = 'a " + '${map[' + "'key'" + ']}' + " b'; final t = 1;";
    assert.match(views(dart).mask, /final t = 1;/);
  });

  it('matches brackets across nested calls', () => {
    const src = 'f(a, g(b, c), d)';
    assert.equal(matchBracket(views(src).mask, 1), src.length - 1);
  });
});

describe('event name fitting', () => {
  it('keeps the verb and never exceeds the Firebase limit', () => {
    const name = fitName('unauthorized_bottom_sheet', 'login_again_now', 'tapped');
    assert.ok(name.length <= 40, name);
    assert.ok(name.endsWith('tapped'), name);
    assert.equal(validateEventName(name), null);
  });

  it('leaves short names untouched', () => {
    assert.equal(fitName('home', 'save', 'tapped'), 'home_save_tapped');
  });
});

describe('routes and modals', () => {
  const root = project({
    'lib/router.dart': `
import 'package:go_router/go_router.dart';
class Routes { static const String details = '/details/:id'; }
final router = GoRouter(routes: [
  GoRoute(path: '/', name: 'home', builder: (c, s) => const HomeScreen()),
  GoRoute(path: Routes.details, builder: (c, s) => const DetailsScreen()),
]);
void openLegacy(BuildContext context) {
  Navigator.push(context, MaterialPageRoute(builder: (_) => const LegacyScreen()));
  Navigator.push(context, MaterialPageRoute(settings: const RouteSettings(name: 'legacy'), builder: (_) => const LegacyScreen()));
}
void openSheets(BuildContext context) {
  showModalBottomSheet<void>(context: context, builder: (_) => const FiltersSheet());
  showDialog<void>(context: context, routeSettings: const RouteSettings(name: 'confirm_dialog'), builder: (_) => const ConfirmDialog());
}
`,
  });
  const inv = scanProject(root);

  it('resolves a path stored in a constant', () => {
    assert.equal(inv.routes.find((r) => r.path === '/details/:id')?.hasName, false);
  });

  it('counts named and unnamed routes', () => {
    assert.equal(inv.summary.routes.total, 4);
    assert.equal(inv.summary.routes.named, 2);
  });

  it('separates sheets with and without routeSettings', () => {
    assert.equal(inv.summary.modals.total, 2);
    assert.equal(inv.summary.modals.with_route_settings, 1);
    assert.equal(inv.modals.find((m) => m.kind === 'showDialog')?.name, 'confirm_dialog');
  });

  it('detects the router and state management from pubspec', () => {
    assert.equal(inv.detected.router, 'go_router');
    assert.equal(inv.detected.state, 'bloc');
  });
});

describe('actions', () => {
  const root = project({
    'lib/home.dart': `
class HomeScreen extends StatefulWidget { const HomeScreen({super.key}); }
class _HomeScreenState extends State<HomeScreen> {
  Widget build(BuildContext context) {
    return Scaffold(body: Column(children: [
      ElevatedButton(onPressed: _save, child: const Text('Save')),
      TextButton(onPressed: () { Analytics.track(AnalyticsEvent.homeShareTapped); }, child: const Text('Share')),
      IconButton(onPressed: () => context.read<HomeBloc>().add(const RefreshEvent()), icon: const Icon(Icons.refresh)),
      TextField(onChanged: (v) => setState(() => _query = v)),
      Switch(value: _on, onChanged: (v) => _toggle(v)),
      ItemTile(onTap: widget.onTap),
      // analytics:ignore decorative
      GestureDetector(onTap: () {}, child: const SizedBox()),
    ]));
  }
  void _save() { repository.save(); }
  void _toggle(bool v) { Analytics.track(AnalyticsEvent.homeAlertsToggled, parameters: {'enabled': v}); }
}
`,
    'lib/home_bloc.dart': `
class HomeBloc extends Bloc<HomeEvent, HomeState> {
  HomeBloc() : super(const HomeState()) {
    on<RefreshEvent>((event, emit) async { Analytics.track(AnalyticsEvent.homeRefreshed); });
  }
}
`,
  });
  const inv = scanProject(root);
  const at = (line) => inv.actions.find((a) => a.line === line);
  const find = (widget) => inv.actions.find((a) => a.widget === widget);

  it('follows a tear-off into a method in the same class', () => {
    assert.equal(find('ElevatedButton').instrumented, false);
    assert.deepEqual(find('ElevatedButton').delegates, ['_save']);
  });

  it('accepts an inline track call', () => {
    assert.equal(find('TextButton').instrumented, true);
    assert.equal(find('TextButton').via, 'inline');
  });

  it('follows a bloc event to its handler', () => {
    assert.equal(find('IconButton').instrumented, true);
    assert.equal(find('IconButton').via, 'HomeBloc.RefreshEvent');
  });

  it('follows a closure that calls an instrumented method', () => {
    assert.equal(find('Switch').instrumented, true);
    assert.equal(find('Switch').via, '_toggle()');
  });

  it('excludes text onChanged and pass-through callbacks, and honours analytics:ignore', () => {
    const reasons = inv.excluded.map((e) => `${e.widget}:${e.why.split(' ')[0]}`);
    assert.ok(reasons.includes('TextField:per-keystroke'), reasons.join());
    assert.ok(reasons.includes('ItemTile:pass-through'), reasons.join());
    assert.ok(reasons.includes('GestureDetector:analytics:ignore'), reasons.join());
    assert.equal(at(9), undefined); // the excluded TextField is not also an action
  });

  it('suggests a screen-prefixed event name', () => {
    assert.equal(find('ElevatedButton').suggested, 'home_save_tapped');
  });
});

describe('screens and user profile', () => {
  const root = project({
    'lib/screens.dart': `
class HomeScreen extends StatelessWidget {
  Widget build(BuildContext context) => Scaffold(body: const Text('home'));
}
class ReportsTab extends StatelessWidget {
  Widget build(BuildContext context) => Scaffold(body: const Text('reports'));
}
class AppShell extends StatelessWidget {
  Widget build(BuildContext context) => Scaffold(body: const Text('shell'));
}
class OneScreen extends StatelessWidget { Widget build(BuildContext c) => const AppShell(); }
class TwoScreen extends StatelessWidget { Widget build(BuildContext c) => const AppShell(); }
class FiltersSheet extends StatelessWidget { Widget build(BuildContext c) => Scaffold(body: const Text('x')); }
`,
    'lib/router.dart': `
final router = GoRouter(routes: [GoRoute(path: '/', name: 'home', builder: (c, s) => const HomeScreen())]);
`,
    'lib/user.dart': `
class UserProfile { final String id; final String plan; final bool isPremium; }
class ProfileScreen extends StatelessWidget { Widget build(BuildContext c) => const SizedBox(); }
`,
  });
  const inv = scanProject(root);
  const names = inv.screens.map((s) => s.class);

  it('counts a routed screen as covered', () => {
    assert.equal(inv.screens.find((s) => s.class === 'HomeScreen').covered, true);
  });

  it('reports a screen that no named route reaches', () => {
    assert.equal(inv.screens.find((s) => s.class === 'ReportsTab').covered, false);
    assert.equal(inv.screens.find((s) => s.class === 'ReportsTab').suggested, 'reports_tab_shown');
  });

  it('ignores shared layout wrappers and sheets', () => {
    assert.ok(!names.includes('AppShell'), names.join());
    assert.ok(!names.includes('FiltersSheet'), names.join());
  });

  it('finds the user model but not screens named like one', () => {
    assert.deepEqual(inv.userModels.map((m) => m.class), ['UserProfile']);
    assert.equal(inv.userModels[0].fields.length, 3);
  });

  it('reports the missing profile sync', () => {
    assert.equal(inv.profile.covered, false);
    assert.equal(inv.profile.sync_file, null);
  });
});

describe('catalog', () => {
  const root = project({
    'lib/core/analytics/analytics_event.dart': `
enum AnalyticsEvent {
  // System
  appOpened('app_opened'),
  screenView('screen_view'),

  // Checkout
  checkoutStarted('checkout_started'),
  checkoutCompleted('checkout_completed'),
  legacyUnused('legacy_unused');

  const AnalyticsEvent(this.rawValue);
  final String rawValue;
}
`,
    'lib/core/analytics/analytics_service.dart': `
class AnalyticsService {
  Future<void> track(AnalyticsEvent event, {Map<String, Object?>? parameters}) async {}
  Future<void> logLegacy() async { track(AnalyticsEvent.legacyUnused); }
}
`,
    'lib/checkout.dart': `
void start() {
  Analytics.track(AnalyticsEvent.checkoutStarted, parameters: {'source': 'home', 'item_count': 2});
}
void done(String id) {
  Analytics.track(AnalyticsEvent.checkoutCompleted, parameters: {'transaction_id': id, 'value': 9.99});
  AppMetrica.reportEvent('legacy_native_only');
}
`,
    'lib/boot.dart': `
void boot() { Analytics.track(AnalyticsEvent.appOpened); }
final router = GoRouter(routes: [GoRoute(path: '/', name: 'home', builder: (c, s) => const HomeScreen())]);
`,
  });
  const funnels = path.join(root, 'funnels.json');
  writeFileSync(funnels, JSON.stringify({ checkout: ['checkout_started', 'checkout_completed'], stale: ['checkout_started', 'nope_gone'] }));
  const catalog = buildCatalog({ root, app: 'fixture', funnelsFile: funnels });
  const byName = Object.fromEntries(catalog.events.map((e) => [e.name, e]));

  it('collects parameters and call sites per event', () => {
    assert.deepEqual(byName.checkout_started.params, ['item_count', 'source']);
    assert.equal(byName.checkout_started.call_sites[0].file, 'lib/checkout.dart');
    assert.equal(byName.checkout_started.domain, 'checkout');
  });

  it('marks an event only reachable through an uncalled wrapper as dead', () => {
    assert.equal(byName.legacy_unused.status, 'dead');
    assert.match(byName.legacy_unused.note, /logLegacy/);
  });

  it('flags an event sent straight to one SDK', () => {
    assert.equal(byName.legacy_native_only.status, 'bypasses_fanout');
  });

  it('keeps funnels whose steps exist and reports stale ones', () => {
    assert.deepEqual(catalog.funnels.checkout, ['checkout_started', 'checkout_completed']);
    assert.ok(!('stale' in catalog.funnels));
    assert.ok(catalog.gaps.some((g) => g.includes('nope_gone')), catalog.gaps.join('\n'));
  });

  it('reports the absence of user properties', () => {
    assert.deepEqual(catalog.user_properties, []);
    assert.ok(catalog.gaps.some((g) => g.includes('No user properties')), catalog.gaps.join('\n'));
  });
});
