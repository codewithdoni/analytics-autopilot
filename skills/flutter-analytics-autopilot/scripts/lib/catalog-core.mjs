// Builds the event catalog from source: every declared event, where it fires,
// with which parameters, plus funnels and instrumentation gaps. The Telegram
// agent loads this file to "know" the app.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findFunctionBody, lineOf, matchBracket, readDart, snake, walkDart } from './dart.mjs';
import { validateEventName } from './naming.mjs';
import { scanProject } from './scan-core.mjs';

const domainSlug = (comment) =>
  snake(
    comment
      .replace(/^\/+\s*/, '')
      .split(/\.\s|\s[—–-]\s|\(|:/)[0]
      .trim()
      .toLowerCase(),
  ) || 'general';

function parseEnum(file, enumName) {
  const m = new RegExp(`\\benum\\s+${enumName}\\s*\\{`).exec(file.mask);
  if (!m) return [];
  const open = m.index + m[0].length - 1;
  const close = matchBracket(file.mask, open);
  const lines = file.src.slice(open + 1, close === -1 ? undefined : close).split('\n');
  const events = [];
  let domain = 'general';
  let inComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) {
      // Only the first line of a comment block names the domain.
      if (!inComment && !trimmed.startsWith('///')) domain = domainSlug(trimmed);
      inComment = true;
      continue;
    }
    inComment = false;
    const entry = /^(\w+)\(\s*(['"])([^'"]+)\2\s*\)/.exec(trimmed);
    if (entry) events.push({ enum: entry[1], name: entry[3], domain });
    if (trimmed.startsWith('final ') || trimmed.startsWith('const ')) break;
  }
  return events;
}

function paramKeys(file, open, close) {
  const args = file.mask.slice(open, close);
  const at = args.search(/\bparameters\s*:/);
  if (at === -1) return [];
  const brace = file.mask.indexOf('{', open + at);
  if (brace === -1 || brace > close) return [];
  const end = matchBracket(file.mask, brace);
  const text = file.code.slice(brace, end === -1 ? close : end);
  return [...new Set([...text.matchAll(/(['"])([a-z][a-z0-9_]*)\1\s*:/g)].map((k) => k[2]))];
}

function gitCommit(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function buildCatalog({ root, app, enumName = 'AnalyticsEvent', funnelsFile = null }) {
  const files = walkDart(root).map((rel) => readDart(root, rel));
  const enumFile = files.find((f) => new RegExp(`\\benum\\s+${enumName}\\b`).test(f.mask));
  const declared = enumFile ? parseEnum(enumFile, enumName) : [];
  const byEnum = new Map(declared.map((e) => [e.enum, { ...e, params: new Set(), call_sites: [], internal: [] }]));

  // Files that implement the analytics layer itself: references inside them are plumbing, not call sites.
  const serviceFiles = new Set(files.filter((f) => /\bclass\s+Analytics(?:Service)?\b/.test(f.mask) || f === enumFile).map((f) => f.rel));
  const raw = new Map(); // raw-string events: name → { params, call_sites, bypass }

  for (const file of files) {
    const isService = serviceFiles.has(file.rel);

    // Typed events: <anything>.track(AnalyticsEvent.x, parameters: {...})
    for (const m of file.mask.matchAll(new RegExp(`(?<![\\w])track\\s*\\(\\s*${enumName}\\s*\\.\\s*(\\w+)`, 'g'))) {
      const open = file.mask.indexOf('(', m.index);
      const close = matchBracket(file.mask, open);
      const event = byEnum.get(m[1]);
      if (!event) continue;
      const site = { file: file.rel, line: lineOf(file.src, m.index) };
      for (const k of paramKeys(file, open, close === -1 ? open : close)) event.params.add(k);
      if (isService) event.internal.push({ ...site, index: m.index, fileRef: file });
      else event.call_sites.push(site);
    }

    // Other references (ternaries, variables, `.rawValue`) keep an event alive even without a literal track() call.
    if (file !== enumFile) {
      for (const m of file.mask.matchAll(new RegExp(`\\b${enumName}\\s*\\.\\s*(\\w+)`, 'g'))) {
        const event = byEnum.get(m[1]);
        if (!event) continue;
        const line = lineOf(file.src, m.index);
        if (isService) {
          if (!event.internal.some((s) => s.file === file.rel && Math.abs(s.line - line) <= 1)) event.internal.push({ file: file.rel, line, index: m.index, fileRef: file });
        } else if (!event.call_sites.some((s) => s.file === file.rel && Math.abs(s.line - line) <= 1)) event.call_sites.push({ file: file.rel, line });
      }
    }

    // Raw-string events through the facade / service.
    for (const m of file.code.matchAll(/\.\s*logEvent\s*\(\s*(?:name\s*:\s*)?(['"])([^'"]+)\1/g)) {
      const direct = /FirebaseAnalytics\s*\.\s*instance\s*$|_analytics\s*$|\banalytics\s*$/.test(file.mask.slice(Math.max(0, m.index - 40), m.index)) && !isService;
      if (isService && !/Analytics\s*$/.test(file.mask.slice(Math.max(0, m.index - 12), m.index))) continue;
      const name = m[2].replace(/\$\{[^}]*\}|\$\w+/g, '*');
      const open = file.mask.indexOf('(', m.index);
      const close = matchBracket(file.mask, open);
      const entry = raw.get(name) ?? { params: new Set(), call_sites: [], bypass: false };
      for (const k of paramKeys(file, open, close === -1 ? open : close)) entry.params.add(k);
      entry.call_sites.push({ file: file.rel, line: lineOf(file.src, m.index) });
      entry.bypass ||= direct;
      raw.set(name, entry);
    }
    if (!isService) {
      for (const m of file.code.matchAll(/\bAppMetrica\s*\.\s*reportEvent(?:WithMap|WithJson)?\s*\(\s*(['"])([^'"]+)\1/g)) {
        const name = m[2].replace(/\$\{[^}]*\}|\$\w+/g, '*');
        const entry = raw.get(name) ?? { params: new Set(), call_sites: [], bypass: true };
        entry.bypass = true;
        entry.call_sites.push({ file: file.rel, line: lineOf(file.src, m.index) });
        raw.set(name, entry);
      }
    }
  }

  // An event referenced only inside the service lives or dies with the method that wraps it.
  const callersOf = (method, definedIn = null) => files.some((f) => f.rel !== definedIn && f !== enumFile && new RegExp(`\\.\\s*${method}\\s*\\(`).test(f.mask));
  const enclosingMethod = (file, index) => {
    const before = file.mask.slice(0, index);
    const all = [...before.matchAll(/(?:Future(?:<[^>]*>)?|void)\s+(\w+)\s*\(/g)];
    return all.at(-1)?.[1] ?? null;
  };
  const events = [];
  for (const e of byEnum.values()) {
    let status = 'active';
    let note = null;
    if (e.call_sites.length === 0) {
      const wrappers = [...new Set(e.internal.map((i) => enclosingMethod(i.fileRef, i.index)).filter(Boolean))];
      const definedIn = e.internal[0]?.file ?? null;
      const alive = wrappers.filter((w) => w !== 'track' && callersOf(w, definedIn));
      if (alive.length > 0) e.call_sites.push(...e.internal.filter((i) => alive.includes(enclosingMethod(i.fileRef, i.index))).map(({ file, line }) => ({ file, line })));
      else {
        // Last resort: the raw name used as a string literal (e.g. reportEvent('app_error')).
        const literalRe = new RegExp(`(?:reportEvent\\w*|logEvent)\\s*\\(\\s*(?:name\\s*:\\s*)?(['"])${e.name}\\1`);
        const literal = files.find((f) => f !== enumFile && literalRe.test(f.code));
        if (literal) {
          e.call_sites.push({ file: literal.rel, line: lineOf(literal.src, literal.code.search(literalRe)) });
          note = 'fired by its raw string name, not through the enum';
        }
      }
      if (e.call_sites.length === 0) {
        status = 'dead';
        note = wrappers.length > 0 ? `only reachable through ${wrappers.map((w) => `${w}()`).join(', ')}, which nothing calls` : 'declared but never fired';
      }
    }
    events.push({ name: e.name, enum: e.enum, domain: e.domain, params: [...e.params].sort(), call_sites: e.call_sites.slice(0, 12), status, ...(note ? { note } : {}) });
  }
  const declaredNames = new Set(events.map((e) => e.name));
  for (const [name, r] of raw) {
    if (declaredNames.has(name)) continue;
    events.push({ name, enum: null, domain: snake(name.split('_')[0] ?? 'raw') || 'raw', params: [...r.params].sort(), call_sites: r.call_sites.slice(0, 12), status: r.bypass ? 'bypasses_fanout' : 'raw' });
  }

  // Base attributes: keys of the map built by initializeBaseAttributes()/setBaseAttributes().
  const baseAttributes = [];
  const userProperties = new Set();
  for (const file of files) {
    for (const fn of ['initializeBaseAttributes', 'setBaseAttributes']) {
      const body = serviceFiles.has(file.rel) ? findFunctionBody(file.mask, fn) : null;
      if (body) for (const k of file.code.slice(body.start, body.end).matchAll(/(['"])([a-z][a-z0-9_]*)\1\s*:/g)) if (!baseAttributes.includes(k[2])) baseAttributes.push(k[2]);
    }
    for (const m of file.code.matchAll(/setUserProperty\s*\(\s*name\s*:\s*(['"])([^'"]+)\1/g)) if (!serviceFiles.has(file.rel)) userProperties.add(m[2]);
    for (const m of file.code.matchAll(/AppMetrica(?:String|Number|Boolean|Counter)Attribute\s*\.\s*with\w+\(\s*(['"])([^'"]+)\1/g)) userProperties.add(m[2]);
    const sync = /\bsetUserProperties\s*\(\s*\{/.exec(file.mask);
    if (sync && !serviceFiles.has(file.rel)) {
      const open = file.mask.indexOf('{', sync.index);
      const close = matchBracket(file.mask, open);
      for (const k of file.code.slice(open, close === -1 ? open : close).matchAll(/(['"])([a-z][a-z0-9_]*)\1\s*:/g)) userProperties.add(k[2]);
    }
  }

  // Funnels: explicit ordered lists from the seed file; unknown steps are reported, not silently kept.
  const funnels = {};
  const gaps = [];
  const names = new Set(events.map((e) => e.name));
  if (funnelsFile && existsSync(funnelsFile)) {
    const seed = JSON.parse(readFileSync(funnelsFile, 'utf8'));
    for (const [name, steps] of Object.entries(seed)) {
      if (name.startsWith('_')) continue;
      const known = steps.filter((s) => names.has(s));
      const unknown = steps.filter((s) => !names.has(s));
      if (unknown.length > 0) gaps.push(`Funnel "${name}" references events that no longer exist: ${unknown.join(', ')}`);
      if (known.length >= 2) funnels[name] = known;
    }
  }
  for (const e of events) {
    const hit = Object.entries(funnels).find(([, steps]) => steps.includes(e.name));
    if (hit) e.funnel = hit[0];
  }

  // Gaps the agent should be able to explain when a number looks wrong.
  const inventory = scanProject(root);
  const dead = events.filter((e) => e.status === 'dead');
  if (dead.length > 0) gaps.push(`${dead.length} declared events are never fired: ${dead.slice(0, 14).map((e) => e.name).join(', ')}${dead.length > 14 ? ', …' : ''}`);
  const purchaseSite = files.find((f) => /\.\s*logPurchase\s*\(/.test(f.mask));
  if (purchaseSite) {
    const idx = purchaseSite.mask.search(/\.\s*logPurchase\s*\(/);
    const wrapper = enclosingMethod(purchaseSite, idx);
    if (serviceFiles.has(purchaseSite.rel) && wrapper && !callersOf(wrapper, purchaseSite.rel)) gaps.push(`Revenue never reaches GA4: logPurchase is only called from ${wrapper}(), and nothing calls ${wrapper}(). GA4 revenue metrics will read 0 — use RevenueCat for money.`);
  } else if (events.some((e) => /purchase|subscri/.test(e.name))) gaps.push('The app tracks purchase events but never calls FirebaseAnalytics.logPurchase, so GA4 revenue metrics read 0.');
  const bypass = events.filter((e) => e.status === 'bypasses_fanout');
  if (bypass.length > 0) gaps.push(`Events sent to one SDK only (they bypass the Firebase+AppMetrica fan-out and carry no base attributes): ${bypass.map((e) => e.name).join(', ')}`);
  if (userProperties.size === 0) gaps.push('No user properties / AppMetrica profile attributes are set anywhere, so users cannot be segmented by plan, goal, gender, etc. Demographics only exist as event parameters.');
  const rawCount = events.filter((e) => e.status === 'raw').length;
  if (rawCount > 0) gaps.push(`${rawCount} events use raw string names instead of the typed enum (typo-prone, invisible to the enum).`);
  const unnamed = inventory.routes.filter((r) => !r.hasName && !r.ignored);
  if (unnamed.length > 0) gaps.push(`${unnamed.length} routes have no name, so their screen_view is silently dropped: ${unnamed.slice(0, 5).map((r) => `${r.file}:${r.line}`).join(', ')}`);
  const bareModals = inventory.modals.filter((m) => !m.hasRouteSettings && !m.ignored);
  if (bareModals.length > 0) gaps.push(`${bareModals.length} bottom sheets / dialogs open without routeSettings, so they never produce a screen_view.`);
  const invalid = events.map((e) => [e.name, validateEventName(e.name.replace(/\*/g, 'x'))]).filter(([, p]) => p);
  if (invalid.length > 0) gaps.push(`Event names Firebase will reject: ${invalid.map(([n, p]) => `${n} (${p})`).join('; ')}`);
  if (!inventory.setup.secrets_ignored) gaps.push('lib/core/secrets/.env is not gitignored: SDK keys can end up in git history.');

  const seenScreens = new Set();
  const screens = inventory.routes
    .filter((r) => r.hasName && !seenScreens.has(r.name) && seenScreens.add(r.name))
    .map((r) => ({ path: r.path, name: r.name }));
  for (const m of inventory.modals) if (m.hasRouteSettings && m.name && !seenScreens.has(m.name) && seenScreens.add(m.name)) screens.push({ path: null, name: m.name });

  return {
    app,
    generated_at: new Date().toISOString(),
    source: { repo: path.basename(path.resolve(root)), commit: gitCommit(root) },
    base_attributes: baseAttributes,
    user_properties: [...userProperties].sort(),
    events: events.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name)),
    funnels,
    screens,
    gaps,
    coverage: inventory.summary,
  };
}
