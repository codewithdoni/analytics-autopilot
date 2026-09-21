import { HOUR, MINUTE, cacheGet, cacheSet, cached } from './cache.js';
import { logsRange, resolveDate } from './dates.js';
import { optionalEnv, requireEnv } from './env.js';
import { type FunnelEvent, type FunnelStepResult, computeSequentialFunnel, funnelFromCounts } from './funnel.js';

/**
 * AppMetrica clients.
 *  - Reporting API  /stat/v1/data            aggregated tables, fast
 *  - Logs API       /logs/v1/export/*.json   raw events & profiles, queued (202 → poll → 200)
 *  - Management API /management/v1/*         list/create applications (needs appmetrica:write)
 *
 * Docs: https://appmetrica.yandex.com/docs/en/mobile-api/
 */

function host(): string {
  return optionalEnv('APPMETRICA_HOST', 'https://api.appmetrica.yandex.com').replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  const { APPMETRICA_OAUTH_TOKEN } = requireEnv('APPMETRICA_OAUTH_TOKEN');
  return { Authorization: `OAuth ${APPMETRICA_OAUTH_TOKEN}` };
}

function appId(explicit?: string | null): string {
  return explicit && explicit.trim() !== '' ? explicit.trim() : requireEnv('APPMETRICA_APP_ID').APPMETRICA_APP_ID;
}

export class AppMetricaError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AppMetricaError';
  }
}

/** Thrown when a Logs API export is still being prepared after we stopped waiting. */
export class LogsPendingError extends Error {
  constructor(public readonly what: string) {
    super(`AppMetrica is still preparing the ${what} export (HTTP 202). It will be ready in a few minutes; the same request then returns instantly.`);
    this.name = 'LogsPendingError';
  }
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { message?: string; errors?: Array<{ message?: string }> };
    return json.message ?? json.errors?.map((e) => e.message).join('; ') ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

// ---------------------------------------------------------------------------
// Reporting API
// ---------------------------------------------------------------------------

export type ReportParams = {
  metrics: string[];
  dimensions?: string[];
  date1: string;
  date2: string;
  filters?: string | null;
  sort?: string | null;
  limit?: number | null;
  applicationId?: string | null;
};

export type ReportTable = {
  source: 'appmetrica_reporting';
  date1: string;
  date2: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
  totals: number[];
  total_rows: number;
  sampled: boolean;
  cached: boolean;
};

type RawReport = {
  data?: Array<{ dimensions?: Array<{ name?: string | null; id?: string | null }>; metrics?: number[] }>;
  totals?: number[];
  total_rows?: number;
  sampled?: boolean;
};

export async function report(params: ReportParams): Promise<ReportTable> {
  const dimensions = params.dimensions ?? [];
  const date1 = resolveDate(params.date1);
  const date2 = resolveDate(params.date2);
  const query = new URLSearchParams({
    ids: appId(params.applicationId),
    metrics: params.metrics.join(','),
    date1,
    date2,
    limit: String(Math.min(Math.max(params.limit ?? 50, 1), 1000)),
    accuracy: 'full',
  });
  if (dimensions.length > 0) query.set('dimensions', dimensions.join(','));
  if (params.filters) query.set('filters', params.filters);
  query.set('sort', params.sort ?? (dimensions.includes('ym:ge:date') ? 'ym:ge:date' : `-${params.metrics[0]}`));

  const url = `${host()}/stat/v1/data?${query.toString()}`;
  const { value, cached: wasCached } = await cached<RawReport>(`am-report:${url}`, 5 * MINUTE, async () => {
    const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new AppMetricaError(`AppMetrica Reporting API ${res.status}: ${await readError(res)}`, res.status);
    return (await res.json()) as RawReport;
  });

  return {
    source: 'appmetrica_reporting',
    date1,
    date2,
    columns: [...dimensions, ...params.metrics],
    rows: (value.data ?? []).map((row) => [
      ...(row.dimensions ?? []).map((d) => d.name ?? d.id ?? null),
      ...(row.metrics ?? []).map((m) => (typeof m === 'number' ? Math.round(m * 100) / 100 : m)),
    ]),
    totals: value.totals ?? [],
    total_rows: value.total_rows ?? 0,
    sampled: value.sampled ?? false,
    cached: wasCached,
  };
}

const SAFE_EVENT_NAME = /^[A-Za-z0-9_.:\- ]{1,128}$/;

function assertEventNames(names: string[]): void {
  for (const n of names) {
    if (!SAFE_EVENT_NAME.test(n)) throw new Error(`Unsupported event name "${n}"`);
  }
}

/** Unique users per event name, one Reporting API call. */
export async function usersByEvent(events: string[], date1: string, date2: string, applicationId?: string | null): Promise<{ table: ReportTable; counts: Map<string, number> }> {
  assertEventNames(events);
  const filters = events.map((e) => `ym:ce:eventLabel=='${e}'`).join(' OR ');
  const table = await report({
    metrics: ['ym:ce:users', 'ym:ce:allEvents'],
    dimensions: ['ym:ce:eventLabel'],
    date1,
    date2,
    filters,
    limit: Math.max(events.length * 2, 20),
    applicationId,
  });
  const counts = new Map<string, number>();
  for (const row of table.rows) counts.set(String(row[0]), Number(row[1] ?? 0));
  return { table, counts };
}

// ---------------------------------------------------------------------------
// Logs API
// ---------------------------------------------------------------------------

type LogsKind = 'events' | 'profiles_v2' | 'installations' | 'sessions_starts';

export type LogsOptions = { maxWaitMs?: number; pollMs?: number };

/**
 * Export raw rows. The first identical request queues the export (202); repeating
 * it returns 200 once ready, and AppMetrica keeps the prepared file for 24 h.
 * We also cache the parsed rows on disk so a demo never waits twice.
 */
export async function logsExport(kind: LogsKind, params: Record<string, string>, options: LogsOptions = {}): Promise<{ rows: Array<Record<string, string>>; cached: boolean }> {
  const maxWaitMs = options.maxWaitMs ?? 200_000;
  const pollMs = options.pollMs ?? 10_000;
  const query = new URLSearchParams(params);
  const url = `${host()}/logs/v1/export/${kind}.json?${query.toString()}`;
  const key = `am-logs:${url}`;

  const hit = await cacheGet<Array<Record<string, string>>>(key, 12 * HOUR);
  if (hit) return { rows: hit, cached: true };

  const started = Date.now();
  for (;;) {
    const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(120_000) });
    if (res.status === 200) {
      const json = (await res.json()) as { data?: Array<Record<string, string>> };
      const rows = json.data ?? [];
      await cacheSet(key, rows);
      return { rows, cached: false };
    }
    if (res.status !== 202) throw new AppMetricaError(`AppMetrica Logs API ${res.status}: ${await readError(res)}`, res.status);
    await res.body?.cancel().catch(() => undefined);
    if (Date.now() - started + pollMs > maxWaitMs) throw new LogsPendingError(kind);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export type FunnelParams = {
  steps: string[];
  date1: string;
  date2: string;
  mode: 'fast' | 'sequential';
  by: 'device' | 'profile';
  applicationId?: string | null;
  maxWaitMs?: number;
};

export type FunnelResult = {
  source: 'appmetrica_logs' | 'appmetrica_reporting';
  mode: 'fast' | 'sequential';
  counted: 'devices' | 'profiles' | 'users';
  date1: string;
  date2: string;
  steps: FunnelStepResult[];
  overall_conversion: number;
  biggest_drop: { from: string; to: string; lost: number; from_prev: number } | null;
  note: string;
};

function summarise(steps: FunnelStepResult[]): Pick<FunnelResult, 'overall_conversion' | 'biggest_drop'> {
  let biggest: FunnelResult['biggest_drop'] = null;
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i] as FunnelStepResult;
    const prev = steps[i - 1] as FunnelStepResult;
    if (!biggest || s.dropped > biggest.lost) biggest = { from: prev.event, to: s.event, lost: s.dropped, from_prev: s.from_prev };
  }
  return { overall_conversion: steps.at(-1)?.from_first ?? 0, biggest_drop: biggest };
}

export async function funnel(params: FunnelParams): Promise<FunnelResult> {
  assertEventNames(params.steps);
  const date1 = resolveDate(params.date1);
  const date2 = resolveDate(params.date2);

  if (params.mode === 'fast') {
    const { counts } = await usersByEvent(params.steps, date1, date2, params.applicationId);
    const steps = funnelFromCounts(params.steps, counts);
    return {
      source: 'appmetrica_reporting',
      mode: 'fast',
      counted: 'users',
      date1,
      date2,
      steps,
      ...summarise(steps),
      note: 'Fast mode: unique users per event, counted independently (not ordered). A later step can exceed an earlier one when users enter mid-funnel.',
    };
  }

  const range = logsRange(date1, date2);
  const idField = params.by === 'profile' ? 'profile_id' : 'appmetrica_device_id';
  const exports = await Promise.all(
    params.steps.map((event_name) =>
      logsExport(
        'events',
        { application_id: appId(params.applicationId), ...range, fields: `event_name,event_timestamp,${idField}`, event_name },
        { maxWaitMs: params.maxWaitMs ?? 200_000 },
      ),
    ),
  );
  const eventsByStep: FunnelEvent[][] = exports.map((e) => e.rows.map((r) => ({ id: r[idField] ?? '', ts: Number(r.event_timestamp ?? 0) })));
  const steps = computeSequentialFunnel(params.steps, eventsByStep);
  return {
    source: 'appmetrica_logs',
    mode: 'sequential',
    counted: params.by === 'profile' ? 'profiles' : 'devices',
    date1,
    date2,
    steps,
    ...summarise(steps),
    note: `Sequential: a ${params.by} counts for step N only if the event happened at or after it reached step N-1, within the range.${exports.every((e) => e.cached) ? ' Served from cache.' : ''}`,
  };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export type ProfilesSummary = {
  source: 'appmetrica_logs';
  profiles: number;
  by_os: Array<[string, number]>;
  by_app_version: Array<[string, number]>;
  by_country: Array<[string, number]>;
  by_gender: Array<[string, number]>;
  notifications_enabled_share: number | null;
  sessions: { median: number; p90: number; one_session_share: number } | null;
  first_session_by_day: Array<[string, number]>;
  custom_attributes: Record<string, Array<[string, number]>>;
  note: string;
};

function topCounts(values: Array<string | undefined>, limit = 8): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v === undefined || v === '' ? '(not set)' : v;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

const BASE_PROFILE_FIELDS = [
  'profile_id',
  'appmetrica_gender',
  'appmetrica_notifications_enabled',
  'appmetrica_first_session_date',
  'appmetrica_sessions',
  'os_name',
  'app_version_name',
  'country_iso_code',
];

export async function profilesSummary(params: { customAttributes?: string[]; limit?: number | null; applicationId?: string | null; maxWaitMs?: number }): Promise<ProfilesSummary> {
  const custom = (params.customAttributes ?? []).filter((a) => /^[A-Za-z0-9_]{1,64}$/.test(a));
  const query: Record<string, string> = {
    application_id: appId(params.applicationId),
    fields: [...BASE_PROFILE_FIELDS, ...custom].join(','),
  };
  if (params.limit) query.limit = String(params.limit);
  const { rows, cached: wasCached } = await logsExport('profiles_v2', query, { maxWaitMs: params.maxWaitMs ?? 200_000 });

  const sessions = rows.map((r) => Number(r.appmetrica_sessions ?? 0)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  const notif = rows.map((r) => r.appmetrica_notifications_enabled).filter((v) => v !== undefined && v !== '');
  const customAttributes: Record<string, Array<[string, number]>> = {};
  for (const attr of custom) customAttributes[attr] = topCounts(rows.map((r) => r[attr]));

  return {
    source: 'appmetrica_logs',
    profiles: rows.length,
    by_os: topCounts(rows.map((r) => r.os_name)),
    by_app_version: topCounts(rows.map((r) => r.app_version_name)),
    by_country: topCounts(rows.map((r) => r.country_iso_code)),
    by_gender: topCounts(rows.map((r) => r.appmetrica_gender)),
    notifications_enabled_share: notif.length === 0 ? null : Math.round((notif.filter((v) => v === 'true' || v === '1').length / notif.length) * 1000) / 1000,
    sessions: sessions.length === 0 ? null : { median: quantile(sessions, 0.5), p90: quantile(sessions, 0.9), one_session_share: Math.round((sessions.filter((n) => n === 1).length / sessions.length) * 1000) / 1000 },
    first_session_by_day: topCounts(rows.map((r) => (r.appmetrica_first_session_date ?? '').slice(0, 10)), 14).sort((a, b) => a[0].localeCompare(b[0])),
    custom_attributes: customAttributes,
    note: `profiles_v2 export${wasCached ? ' (cached)' : ''}. "(not set)" means the app never reported that attribute — a sign user-profile sync is missing.`,
  };
}

// ---------------------------------------------------------------------------
// Management API
// ---------------------------------------------------------------------------

export type AppMetricaApplication = { id: number; name: string; api_key128?: string; time_zone_name?: string };

export async function listApplications(): Promise<AppMetricaApplication[]> {
  const res = await fetch(`${host()}/management/v1/applications`, { headers: authHeaders(), signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new AppMetricaError(`AppMetrica Management API ${res.status}: ${await readError(res)}`, res.status);
  const json = (await res.json()) as { applications?: AppMetricaApplication[] };
  return json.applications ?? [];
}

/** Creates an application and returns its SDK key (`api_key128`). Needs the appmetrica:write scope. */
export async function createApplication(name: string, timeZone = 'Asia/Tashkent'): Promise<AppMetricaApplication> {
  const res = await fetch(`${host()}/management/v1/applications`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ application: { name, time_zone_name: timeZone, gdpr_agreement_accepted: true } }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new AppMetricaError(`AppMetrica create application ${res.status}: ${await readError(res)}`, res.status);
  const json = (await res.json()) as { application?: AppMetricaApplication };
  if (!json.application) throw new AppMetricaError('AppMetrica create application: empty response', res.status);
  return json.application;
}
