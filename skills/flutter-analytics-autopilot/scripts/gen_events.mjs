#!/usr/bin/env node
// Rewrite the AnalyticsEvent enum from the plan. Idempotent: run it as often as
// you like, it only ever replaces the block between the markers.
//
//   node gen_events.mjs --root <flutter project> [--plan analytics/plan.json]
//
// analytics/plan.json:
//   { "events": [ { "name": "home_save_tapped", "domain": "Home", "params": ["item_count"] } ] }
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { camel, parseArgs } from './lib/dart.mjs';
import { LIMITS, validateEventName, validateParamName } from './lib/naming.mjs';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(String(args.root ?? '.'));
const planPath = path.resolve(root, String(args.plan ?? 'analytics/plan.json'));
const enumPath = path.resolve(root, String(args.events ?? 'lib/core/analytics/analytics_event.dart'));
const START = '  // <autopilot:events>';
const END = '  // </autopilot:events>';

if (!existsSync(planPath)) {
  console.error(`No plan at ${path.relative(root, planPath)}. Write it first (step 2 of the skill).`);
  process.exit(1);
}
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const planned = Array.isArray(plan) ? plan : (plan.events ?? []);

// Always present: the navigator observer and the bootstrap need them.
const REQUIRED = [
  { name: 'app_opened', domain: 'System', params: [] },
  { name: 'app_error', domain: 'System', params: ['error_type', 'message'] },
  { name: 'screen_view', domain: 'System', params: ['screen_name'] },
];

const byName = new Map();
for (const raw of [...REQUIRED, ...planned]) {
  const name = String(raw.name ?? '').trim();
  const existing = byName.get(name);
  const params = [...new Set([...(existing?.params ?? []), ...(raw.params ?? []).map(String)])];
  byName.set(name, { name, domain: String(raw.domain ?? existing?.domain ?? 'General').trim() || 'General', params });
}

const problems = [];
const usedEnums = new Map();
for (const event of byName.values()) {
  const bad = validateEventName(event.name);
  if (bad) problems.push(`event "${event.name}": ${bad}`);
  if (event.params.length > LIMITS.paramsPerEvent) problems.push(`event "${event.name}": ${event.params.length} parameters, Firebase allows ${LIMITS.paramsPerEvent}`);
  for (const p of event.params) {
    const badParam = validateParamName(p);
    if (badParam) problems.push(`event "${event.name}" parameter "${p}": ${badParam}`);
  }
  const identifier = camel(event.name);
  if (usedEnums.has(identifier)) problems.push(`events "${usedEnums.get(identifier)}" and "${event.name}" both map to the Dart name "${identifier}"`);
  else usedEnums.set(identifier, event.name);
}
if (byName.size > LIMITS.distinctEvents) problems.push(`${byName.size} distinct events; Firebase counts only the first ${LIMITS.distinctEvents} per app instance`);
if (problems.length > 0) {
  console.error('Plan is not valid:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const domains = [...new Set([...byName.values()].map((e) => e.domain))].sort((a, b) => (a === 'System' ? -1 : b === 'System' ? 1 : a.localeCompare(b)));
const lines = [START];
const all = [...byName.values()];
domains.forEach((domain, i) => {
  const events = all.filter((e) => e.domain === domain).sort((a, b) => a.name.localeCompare(b.name));
  if (events.length === 0) return;
  if (i > 0) lines.push('');
  lines.push(`  // ${domain}`);
  events.forEach((event, j) => {
    const last = i === domains.length - 1 && j === events.length - 1;
    if (event.params.length > 0) lines.push(`  /// Parameters: ${event.params.join(', ')}.`);
    lines.push(`  ${camel(event.name)}('${event.name}')${last ? ';' : ','}`);
  });
});
lines.push(END);

mkdirSync(path.dirname(enumPath), { recursive: true });
const source = existsSync(enumPath) ? readFileSync(enumPath, 'utf8') : '';
const startAt = source.indexOf(START);
const endAt = source.indexOf(END);
if (startAt === -1 || endAt === -1) {
  console.error(`${path.relative(root, enumPath)} has no generated block. Copy assets/templates/analytics_event.dart.tmpl first (it contains the markers).`);
  process.exit(1);
}
writeFileSync(enumPath, source.slice(0, startAt) + lines.join('\n') + source.slice(endAt + END.length));
console.log(`${byName.size} events in ${domains.length} domains → ${path.relative(root, enumPath)}`);
