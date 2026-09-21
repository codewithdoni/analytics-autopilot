#!/usr/bin/env node
// Last step of the skill: emit the event catalog the Telegram agent reads.
//   node catalog.mjs --root <flutter project> [--app name] [--funnels analytics/funnels.json] [--out analytics_catalog.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildCatalog } from './lib/catalog-core.mjs';
import { parseArgs, snake } from './lib/dart.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(String(args.root ?? '.'));
const pubspec = existsSync(path.join(root, 'pubspec.yaml')) ? readFileSync(path.join(root, 'pubspec.yaml'), 'utf8') : '';
const app = snake(String(args.app ?? /^name:\s*(\S+)/m.exec(pubspec)?.[1] ?? path.basename(root)));
const defaultFunnels = path.join(root, 'analytics/funnels.json');
const funnelsFile = args.funnels ? path.resolve(String(args.funnels)) : existsSync(defaultFunnels) ? defaultFunnels : null;

const catalog = buildCatalog({ root, app, enumName: String(args.enum ?? 'AnalyticsEvent'), funnelsFile });
const out = path.resolve(root, String(args.out ?? 'analytics_catalog.json'));
writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);

const by = (status) => catalog.events.filter((e) => e.status === status).length;
console.log(`${catalog.app}: ${catalog.events.length} events (${by('active')} active, ${by('dead')} dead, ${by('raw')} raw, ${by('bypasses_fanout')} bypass), ${catalog.screens.length} screens, ${Object.keys(catalog.funnels).length} funnels, ${catalog.gaps.length} gaps`);
for (const g of catalog.gaps) console.log(`  gap: ${g}`);
console.log(`Catalog written to ${path.relative(process.cwd(), out) || out}`);
