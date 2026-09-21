import { MINUTE, cached } from './cache.js';
import { requireEnv } from './env.js';

/**
 * GA4 Data API (the analytics backend behind Firebase Analytics).
 * The service account in GOOGLE_APPLICATION_CREDENTIALS must be a Viewer on the
 * GA4 property — a Firebase service account has no GA4 access by default.
 *
 * Docs: https://developers.google.com/analytics/devguides/reporting/data/v1
 */
export type Ga4Table = {
  source: 'ga4';
  range: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  row_count: number;
  cached: boolean;
};

type Ga4Row = { dimensionValues?: Array<{ value?: string | null }> | null; metricValues?: Array<{ value?: string | null }> | null };
type Ga4Response = { rows?: Ga4Row[] | null; rowCount?: number | null };

// The client is heavy (gRPC); load it only when a GA4 tool is actually called.
type DataClient = {
  runReport(request: unknown): Promise<[Ga4Response, ...unknown[]]>;
  runRealtimeReport(request: unknown): Promise<[Ga4Response, ...unknown[]]>;
};
let clientPromise: Promise<DataClient> | undefined;

function client(): Promise<DataClient> {
  requireEnv('GOOGLE_APPLICATION_CREDENTIALS');
  clientPromise ??= import('@google-analytics/data').then((m) => new m.BetaAnalyticsDataClient() as unknown as DataClient);
  return clientPromise;
}

function property(): string {
  return `properties/${requireEnv('GA4_PROPERTY_ID').GA4_PROPERTY_ID}`;
}

function toTable(response: Ga4Response, dimensions: string[], metrics: string[], range: string, wasCached: boolean): Ga4Table {
  const rows = (response.rows ?? []).map((row) => [
    ...(row.dimensionValues ?? []).map((d) => d.value ?? ''),
    ...(row.metricValues ?? []).map((m) => {
      const n = Number(m.value);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : (m.value ?? '');
    }),
  ]);
  return { source: 'ga4', range, columns: [...dimensions, ...metrics], rows, row_count: response.rowCount ?? rows.length, cached: wasCached };
}

export type Ga4ReportParams = {
  startDate: string;
  endDate: string;
  metrics: string[];
  dimensions?: string[];
  /** Exact event names to keep (uses an inListFilter on eventName). */
  eventNames?: string[] | null;
  limit?: number | null;
};

export async function runReport(params: Ga4ReportParams): Promise<Ga4Table> {
  const dimensions = params.dimensions ?? [];
  const request = {
    property: property(),
    dateRanges: [{ startDate: params.startDate, endDate: params.endDate }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: params.metrics.map((name) => ({ name })),
    limit: Math.min(Math.max(params.limit ?? 50, 1), 1000),
    orderBys: dimensions.includes('date') ? [{ dimension: { dimensionName: 'date' } }] : [{ metric: { metricName: params.metrics[0] }, desc: true }],
    ...(params.eventNames && params.eventNames.length > 0
      ? { dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: params.eventNames } } } }
      : {}),
  };
  const { value, cached: wasCached } = await cached<Ga4Response>(`ga4-report:${JSON.stringify(request)}`, 5 * MINUTE, async () => {
    const [response] = await (await client()).runReport(request);
    return { rows: response.rows ?? [], rowCount: response.rowCount ?? null };
  });
  return toTable(value, dimensions, params.metrics, `${params.startDate}..${params.endDate}`, wasCached);
}

export async function runRealtime(params: { dimensions?: string[]; metrics?: string[]; limit?: number | null }): Promise<Ga4Table> {
  const dimensions = params.dimensions ?? ['eventName'];
  const metrics = params.metrics ?? ['eventCount', 'activeUsers'];
  const [response] = await (await client()).runRealtimeReport({
    property: property(),
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
    limit: Math.min(Math.max(params.limit ?? 50, 1), 250),
  });
  return toTable(response, dimensions, metrics, 'last 30 minutes', false);
}
