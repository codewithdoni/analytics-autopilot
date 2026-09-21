#!/usr/bin/env node
// The gate. Exits 0 only when every required category is fully covered.
//   node coverage.mjs --root <flutter project> [--json coverage.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './lib/dart.mjs';
import { validateEventName } from './lib/naming.mjs';
import { scanProject } from './lib/scan-core.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(String(args.root ?? '.'));
const inv = scanProject(root);

const live = (list) => list.filter((x) => !x.ignored);
const todo = [];

// 1. routes
const routes = live(inv.routes);
for (const r of routes.filter((x) => !x.hasName)) todo.push(`route   ${r.file}:${r.line}  ${r.kind === 'go_route' ? `GoRoute ${r.path ?? ''} needs name:` : 'add settings: RouteSettings(name: ...)'}`);

// 2. modals
const modals = live(inv.modals);
for (const m of modals.filter((x) => !x.hasRouteSettings)) todo.push(`modal   ${m.file}:${m.line}  ${m.kind} needs routeSettings: RouteSettings(name: '..._sheet' | '..._dialog')`);

// 3. screens
const screens = live(inv.screens);
for (const s of screens.filter((x) => !x.covered)) todo.push(`screen  ${s.file}  ${s.class} is not behind a named route — fire AnalyticsEvent ${s.suggested} once when it appears`);

// 4. actions
for (const a of inv.actions.filter((x) => !x.instrumented)) {
  const hop = a.delegates.length > 0 ? `  (reaches ${a.delegates.join(', ')} — no Analytics.track there)` : '';
  todo.push(`action  ${a.file}:${a.line}  ${a.widget}.${a.handler} in ${a.class ?? '?'} → suggest ${a.suggested}${hop}`);
}

// 5. naming — every declared event must be valid for Firebase AND AppMetrica
const naming = { total: 0, valid: 0 };
const enumFile = inv.setup.events_enum;
if (enumFile) {
  const src = readFileSync(path.join(root, enumFile), 'utf8');
  for (const m of src.matchAll(/^\s*\w+\(\s*'([^']*)'\s*\)/gm)) {
    naming.total++;
    const problem = validateEventName(m[1]);
    if (problem) todo.push(`naming  ${enumFile}  '${m[1]}': ${problem}`);
    else naming.valid++;
  }
}

// 6. setup
const setupLabels = {
  dep_firebase_core: 'pubspec: firebase_core',
  dep_firebase_analytics: 'pubspec: firebase_analytics',
  dep_appmetrica: 'pubspec: appmetrica_plugin',
  facade: 'Analytics facade (class Analytics with static track())',
  events_enum: 'enum AnalyticsEvent',
  firebase_observer: 'FirebaseAnalyticsObserver registered on the router / MaterialApp',
  appmetrica_observer: 'AnalyticsNavigatorObserver registered on the router / MaterialApp',
  firebase_init: 'Firebase.initializeApp() in bootstrap',
  appmetrica_activate: 'AppMetrica.activate() reachable from bootstrap',
  zone_guard: 'runZonedGuarded around runApp',
  secrets_ignored: '.gitignore covers lib/core/secrets/.env',
};
const setupEntries = Object.entries(inv.setup);
for (const [key, ok] of setupEntries) if (!ok) todo.push(`setup   ${setupLabels[key] ?? key}`);

// 7. user profile
const p = inv.profile;
if (!p.sync_file) todo.push('profile class UserProfileSync is missing (assets/templates/user_profile_sync.dart.tmpl)');
else {
  if (p.sync_calls.length === 0) todo.push('profile UserProfileSync.sync()/syncAnonymous() is never called — call it at startup and on login / profile update');
  if (p.logout_detected && p.clear_calls.length === 0) todo.push('profile the app has a logout/delete-account path but never calls UserProfileSync.clear()');
}

// A committed secret defeats the point.
if (existsSync(path.join(root, 'lib/core/secrets/.env')) && !inv.setup.secrets_ignored) todo.push('setup   lib/core/secrets/.env exists but is not gitignored');

const rows = [
  ['Routes named', routes.filter((r) => r.hasName).length, routes.length],
  ['Modals with routeSettings', modals.filter((m) => m.hasRouteSettings).length, modals.length],
  ['Screens reported', screens.filter((s) => s.covered).length, screens.length],
  ['User actions instrumented', inv.actions.filter((a) => a.instrumented).length, inv.actions.length],
  ['Event names valid', naming.valid, naming.total],
  ['Scaffold / bootstrap', setupEntries.filter(([, ok]) => ok).length, setupEntries.length],
  ['User profile sync', p.covered ? 1 : 0, 1],
];
const pct = (a, b) => (b === 0 ? 100 : Math.floor((a / b) * 100));
const width = Math.max(...rows.map((r) => r[0].length));
const table = [
  `${'Category'.padEnd(width)}  Covered  Total     %`,
  ...rows.map(([name, a, b]) => `${name.padEnd(width)}  ${String(a).padStart(7)}  ${String(b).padStart(5)}  ${String(pct(a, b)).padStart(4)}`),
  '',
  `Informational: ${inv.summary.logic_handlers.instrumented}/${inv.summary.logic_handlers.total} bloc/cubit handlers carry outcome events; ${inv.excluded.length} handlers excluded by policy.`,
].join('\n');

const complete = rows.every(([, a, b]) => a === b);
const report = { complete, rows: rows.map(([category, covered, total]) => ({ category, covered, total, percent: pct(covered, total) })), todo, excluded: inv.excluded, table };
if (args.json) writeFileSync(path.resolve(root, String(args.json)), `${JSON.stringify(report, null, 2)}\n`);

console.log(table);
if (todo.length > 0) {
  console.log(`\n${todo.length} item(s) left:`);
  for (const t of todo.slice(0, 200)) console.log(`  - ${t}`);
  if (todo.length > 200) console.log(`  … and ${todo.length - 200} more (see --json)`);
}
console.log(complete ? '\nCOVERAGE COMPLETE' : '\nCOVERAGE INCOMPLETE');
process.exit(complete ? 0 : 1);
