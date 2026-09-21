#!/usr/bin/env node
// Build the catalog for an EXISTING app and drop it where the bot looks for it.
//   node scripts/build-catalog.mjs --repo /path/to/flutter/app --app plusfit
// Funnels come from catalog/funnels.<app>.json (ordered event lists you maintain by hand).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog } from '../skills/flutter-analytics-autopilot/scripts/lib/catalog-core.mjs';
import { parseArgs, snake } from '../skills/flutter-analytics-autopilot/scripts/lib/dart.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
if (!args.repo) {
  console.error('Usage: node scripts/build-catalog.mjs --repo <flutter project> [--app name]');
  process.exit(1);
}
const root = path.resolve(String(args.repo));
const app = snake(String(args.app ?? path.basename(root)));
const catalogDir = path.resolve(here, '../catalog');
const seed = path.join(catalogDir, `funnels.${app}.json`);

const catalog = buildCatalog({ root, app, funnelsFile: existsSync(seed) ? seed : null });
mkdirSync(catalogDir, { recursive: true });
const out = path.join(catalogDir, `${app}.json`);
writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);

const by = (status) => catalog.events.filter((e) => e.status === status).length;
console.log(`${app}: ${catalog.events.length} events (${by('active')} active, ${by('dead')} dead, ${by('raw')} raw, ${by('bypasses_fanout')} bypass)`);
console.log(`${catalog.screens.length} screens · funnels: ${Object.keys(catalog.funnels).join(', ') || '(none — add catalog/funnels.' + app + '.json)'}`);
for (const g of catalog.gaps) console.log(`  gap: ${g}`);
console.log(`→ ${path.relative(process.cwd(), out)}`);
