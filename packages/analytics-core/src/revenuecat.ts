import { MINUTE, cached } from './cache.js';
import { requireEnv } from './env.js';

/**
 * RevenueCat REST API v2 — project overview metrics (MRR, active subscriptions,
 * trials, revenue…). The response is returned as-is: the metric list evolves, and
 * the agent reads the field names and periods literally instead of us guessing.
 * Rate limit is low (~5 req/min), hence the 5-minute cache.
 *
 * Docs: https://www.revenuecat.com/docs/api-v2
 */
export type RevenueCatOverview = { source: 'revenuecat'; cached: boolean; metrics: unknown };

export async function overview(): Promise<RevenueCatOverview> {
  const { REVENUECAT_SECRET_KEY, REVENUECAT_PROJECT_ID } = requireEnv('REVENUECAT_SECRET_KEY', 'REVENUECAT_PROJECT_ID');
  const url = `https://api.revenuecat.com/v2/projects/${encodeURIComponent(REVENUECAT_PROJECT_ID)}/metrics/overview`;
  const { value, cached: wasCached } = await cached<unknown>(`rc-overview:${url}`, 5 * MINUTE, async () => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${REVENUECAT_SECRET_KEY}`, Accept: 'application/json' }, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`RevenueCat ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as unknown;
  });
  return { source: 'revenuecat', cached: wasCached, metrics: value };
}
