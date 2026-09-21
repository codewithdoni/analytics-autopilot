#!/usr/bin/env node
// Step 1 of the skill: inventory everything analytics must cover.
//   node scan.mjs --root <flutter project> [--out analytics-inventory.json]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './lib/dart.mjs';
import { scanProject } from './lib/scan-core.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(String(args.root ?? '.'));
const inventory = scanProject(root);
const out = path.resolve(root, String(args.out ?? 'analytics-inventory.json'));
writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`);

const { detected: d, summary: s, setup, profile } = inventory;
const lines = [
  `Project   ${d.package ?? path.basename(root)} — ${d.dart_files} Dart files`,
  `Stack     router=${d.router}  state=${d.state}  di=${d.di}`,
  `Analytics firebase_analytics=${d.analytics.firebase_analytics}  appmetrica_plugin=${d.analytics.appmetrica_plugin}  facade=${d.analytics.facade}`,
  '',
  `Routes    ${s.routes.named}/${s.routes.total} named`,
  `Modals    ${s.modals.with_route_settings}/${s.modals.total} with routeSettings`,
  `Screens   ${s.screens.covered}/${s.screens.total} reported (named route or *_shown event)`,
  `Actions   ${s.actions.instrumented}/${s.actions.total} instrumented  (${s.actions.excluded} excluded by policy — see "excluded" in the JSON)`,
  `Logic     ${s.logic_handlers.instrumented}/${s.logic_handlers.total} bloc/cubit handlers instrumented (informational)`,
  `Profiles  user models: ${inventory.userModels.map((m) => `${m.class}(${m.fields.length})`).join(', ') || 'none found'}; UserProfileSync: ${profile.sync_file ?? 'missing'}`,
  `Setup     ${Object.entries(setup).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'complete'}${Object.values(setup).every(Boolean) ? '' : '  ← missing'}`,
  '',
  `Inventory written to ${path.relative(process.cwd(), out) || out}`,
];
console.log(lines.join('\n'));
