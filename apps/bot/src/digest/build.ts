import { appmetrica, catalog, dates, revenuecat } from '@autopilot/analytics-core';

type Part<T> = { ok: true; data: T } | { ok: false; error: string };

async function part<T>(work: () => Promise<T>): Promise<Part<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 200) : String(error) };
  }
}

function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * The numbers behind the morning digest, gathered in parallel. Every block is
 * independent: one failing source never blanks the whole digest. The agent
 * turns this object into prose.
 */
export async function buildDigest(app: string, days = 7) {
  const date2 = dates.resolveDate('yesterday');
  const date1 = dates.addDays(date2, -(days - 1));
  const prev = dates.previousPeriod(date1, date2);

  const totals = (d1: string, d2: string) =>
    appmetrica.report({ metrics: ['ym:u:activeUsers', 'ym:u:newUsers'], date1: d1, date2: d2 }).then((t) => ({ active_users: Number(t.totals[0] ?? 0), new_users: Number(t.totals[1] ?? 0) }));
  const sessions = (d1: string, d2: string) => appmetrica.report({ metrics: ['ym:s:sessions'], date1: d1, date2: d2 }).then((t) => Number(t.totals[0] ?? 0));

  const funnels = await part(async () => {
    const c = await catalog.loadCatalog(app);
    const picked = Object.entries(c.funnels).filter(([, steps]) => steps.length >= 2).slice(0, 4);
    return Promise.all(
      picked.map(async ([name, steps]) => {
        const s = steps.slice(0, 8);
        const [now, before] = await Promise.all([
          appmetrica.funnel({ steps: s, date1, date2, mode: 'fast', by: 'device' }),
          appmetrica.funnel({ steps: s, date1: prev.date1, date2: prev.date2, mode: 'fast', by: 'device' }),
        ]);
        return {
          funnel: name,
          steps: now.steps.map((x) => ({ event: x.event, users: x.reached, from_prev: x.from_prev })),
          overall_conversion: now.overall_conversion,
          previous_overall_conversion: before.overall_conversion,
          biggest_drop: now.biggest_drop,
        };
      }),
    );
  });

  const [usersNow, usersPrev, sessionsNow, sessionsPrev, daily, topEvents, versions, revenue] = await Promise.all([
    part(() => totals(date1, date2)),
    part(() => totals(prev.date1, prev.date2)),
    part(() => sessions(date1, date2)),
    part(() => sessions(prev.date1, prev.date2)),
    part(() => appmetrica.report({ metrics: ['ym:u:activeUsers', 'ym:u:newUsers'], dimensions: ['ym:ge:date'], date1, date2, limit: 31 }).then((t) => t.rows)),
    part(() => appmetrica.report({ metrics: ['ym:ce:users', 'ym:ce:allEvents'], dimensions: ['ym:ce:eventLabel'], date1, date2, limit: 10 }).then((t) => t.rows)),
    part(() => appmetrica.report({ metrics: ['ym:u:activeUsers'], dimensions: ['ym:ge:appVersion'], date1, date2, limit: 5 }).then((t) => t.rows)),
    part(() => revenuecat.overview().then((r) => r.metrics)),
  ]);

  return {
    app,
    period: { date1, date2, days },
    previous_period: prev,
    users:
      usersNow.ok && usersPrev.ok
        ? {
            active_users: usersNow.data.active_users,
            active_users_change_pct: change(usersNow.data.active_users, usersPrev.data.active_users),
            new_users: usersNow.data.new_users,
            new_users_change_pct: change(usersNow.data.new_users, usersPrev.data.new_users),
          }
        : { error: !usersNow.ok ? usersNow.error : !usersPrev.ok ? usersPrev.error : 'unknown' },
    sessions: sessionsNow.ok && sessionsPrev.ok ? { sessions: sessionsNow.data, change_pct: change(sessionsNow.data, sessionsPrev.data) } : { error: !sessionsNow.ok ? sessionsNow.error : 'previous period failed' },
    daily_active_and_new: daily.ok ? daily.data : { error: daily.error },
    top_events_by_users: topEvents.ok ? topEvents.data : { error: topEvents.error },
    top_app_versions: versions.ok ? versions.data : { error: versions.error },
    funnels: funnels.ok ? funnels.data : { error: funnels.error },
    revenuecat: revenue.ok ? revenue.data : { error: revenue.error },
    sources: ['AppMetrica Reporting API', 'RevenueCat'],
  };
}
