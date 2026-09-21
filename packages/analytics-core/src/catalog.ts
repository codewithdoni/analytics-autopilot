import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optionalEnv } from './env.js';

/**
 * The event catalog is what makes the agent "know" an app: every instrumented
 * event, its parameters, where it fires, which funnel it belongs to, and the
 * instrumentation gaps. It is generated from source code — by
 * scripts/build-catalog.mjs for an existing app, or by the
 * flutter-analytics-autopilot skill for a freshly instrumented one.
 */
export type CatalogEvent = {
  name: string;
  enum?: string | null;
  domain: string;
  params: string[];
  call_sites: Array<{ file: string; line: number }>;
  funnel?: string | null;
  status: 'active' | 'dead' | 'raw' | 'bypasses_fanout';
};

export type Catalog = {
  app: string;
  generated_at: string;
  source?: { repo?: string; commit?: string | null };
  base_attributes: string[];
  user_properties?: string[];
  events: CatalogEvent[];
  funnels: Record<string, string[]>;
  screens: Array<{ path?: string | null; name: string }>;
  gaps: string[];
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function catalogDir(): string {
  return optionalEnv('CATALOG_DIR', path.join(REPO_ROOT, 'catalog'));
}

const SAFE_APP = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const loaded = new Map<string, Catalog>();

export async function listApps(): Promise<string[]> {
  try {
    const files = await readdir(catalogDir());
    return files
      .filter((f) => f.endsWith('.json') && !f.startsWith('funnels.') && f !== 'schema.json')
      .map((f) => f.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

export async function loadCatalog(app: string, options: { fresh?: boolean } = {}): Promise<Catalog> {
  if (!SAFE_APP.test(app)) throw new Error(`Invalid app name "${app}"`);
  if (!options.fresh) {
    const hit = loaded.get(app);
    if (hit) return hit;
  }
  let raw: string;
  try {
    raw = await readFile(path.join(catalogDir(), `${app}.json`), 'utf8');
  } catch {
    const apps = await listApps();
    throw new Error(`No catalog for "${app}". Available: ${apps.join(', ') || '(none — run npm run catalog)'}`);
  }
  const catalog = JSON.parse(raw) as Catalog;
  loaded.set(app, catalog);
  return catalog;
}

export type CatalogSearchResult = {
  app: string;
  query: string;
  total_events: number;
  domains?: Array<[string, number]>;
  funnels?: Record<string, string[]>;
  matches: Array<Pick<CatalogEvent, 'name' | 'domain' | 'params' | 'status' | 'funnel'> & { fired_from: string[] }>;
  note?: string;
};

function score(event: CatalogEvent, tokens: string[]): number {
  let total = 0;
  for (const t of tokens) {
    if (event.name === t) total += 10;
    else if (event.name.includes(t)) total += 5;
    if (event.domain.includes(t)) total += 3;
    if (event.funnel?.includes(t)) total += 3;
    if (event.params.some((p) => p.includes(t))) total += 2;
    if (event.status === t) total += 6;
  }
  return total;
}

export async function searchCatalog(app: string, query: string, domain?: string | null, limit = 25): Promise<CatalogSearchResult> {
  const catalog = await loadCatalog(app);
  const q = query.trim().toLowerCase();
  let pool = catalog.events;
  if (domain) pool = pool.filter((e) => e.domain === domain.toLowerCase());

  const view = (e: CatalogEvent) => ({
    name: e.name,
    domain: e.domain,
    params: e.params,
    status: e.status,
    funnel: e.funnel ?? null,
    fired_from: e.call_sites.slice(0, 3).map((s) => `${s.file}:${s.line}`),
  });

  if (q === '' && !domain) {
    const counts = new Map<string, number>();
    for (const e of catalog.events) counts.set(e.domain, (counts.get(e.domain) ?? 0) + 1);
    return {
      app,
      query,
      total_events: catalog.events.length,
      domains: [...counts.entries()].sort((a, b) => b[1] - a[1]),
      funnels: catalog.funnels,
      matches: [],
      note: 'Empty query: listing domains and funnels. Search by event name, param, domain, funnel, or status ("dead").',
    };
  }

  const tokens = q.split(/[^a-z0-9_]+/).filter(Boolean);
  const ranked = (tokens.length === 0 ? pool.map((e) => ({ e, s: 1 })) : pool.map((e) => ({ e, s: score(e, tokens) })).filter((x) => x.s > 0)).sort((a, b) => b.s - a.s);
  return { app, query, total_events: catalog.events.length, matches: ranked.slice(0, limit).map((x) => view(x.e)), ...(ranked.length > limit ? { note: `${ranked.length} matches, showing ${limit}.` } : {}) };
}

/** Compact description injected into the agent's instructions. */
export async function catalogBrief(app: string): Promise<string> {
  try {
    const c = await loadCatalog(app);
    const domains = new Map<string, number>();
    for (const e of c.events) domains.set(e.domain, (domains.get(e.domain) ?? 0) + 1);
    const lines = [
      `App "${c.app}": ${c.events.length} instrumented events, ${c.screens.length} named screens.`,
      `Domains: ${[...domains.entries()].map(([d, n]) => `${d}(${n})`).join(', ')}.`,
      `Params on every event: ${c.base_attributes.join(', ') || '(none)'}.`,
      `User properties: ${c.user_properties?.length ? c.user_properties.join(', ') : '(none set)'}.`,
      ...Object.entries(c.funnels).map(([name, steps]) => `Funnel ${name}: ${steps.join(' → ')}`),
    ];
    if (c.gaps.length > 0) lines.push('Known instrumentation gaps:', ...c.gaps.map((g) => `- ${g}`));
    return lines.join('\n');
  } catch (error) {
    return `No event catalog loaded (${(error as Error).message}). Ask the user for event names or use the reporting tools to list top events.`;
  }
}
