import { appmetrica, catalog, ga4, isConfigured, optionalEnv, remoteConfig, revenuecat } from '@autopilot/analytics-core';

/**
 * One line per data source. Run this before starting the bot: it tells you which
 * credentials work without involving the LLM at all.
 */
type Check = { name: string; needs: string[]; run: () => Promise<string> };

const checks: Check[] = [
  {
    name: 'Event catalog',
    needs: [],
    run: async () => {
      const c = await catalog.loadCatalog(optionalEnv('DEFAULT_APP', 'plusfit'));
      return `${c.events.length} events, ${Object.keys(c.funnels).length} funnels, ${c.gaps.length} gaps`;
    },
  },
  {
    name: 'AppMetrica Reporting API',
    needs: ['APPMETRICA_OAUTH_TOKEN', 'APPMETRICA_APP_ID'],
    run: async () => {
      const t = await appmetrica.report({ metrics: ['ym:u:activeUsers', 'ym:u:newUsers'], date1: '7daysAgo', date2: 'yesterday' });
      return `${t.date1}..${t.date2}: ${t.totals[0]} active users, ${t.totals[1]} new`;
    },
  },
  {
    name: 'AppMetrica Management API (needs appmetrica:write for /instrument)',
    needs: ['APPMETRICA_OAUTH_TOKEN'],
    run: async () => `${(await appmetrica.listApplications()).length} applications visible`,
  },
  {
    name: 'AppMetrica Logs API (first call queues the export; re-run to see 200)',
    needs: ['APPMETRICA_OAUTH_TOKEN', 'APPMETRICA_APP_ID'],
    run: async () => {
      const f = await appmetrica.funnel({ steps: ['app_opened', 'screen_view'], date1: 'yesterday', date2: 'yesterday', mode: 'sequential', by: 'device', maxWaitMs: 15_000 });
      return `${f.steps.map((s) => `${s.event}=${s.reached}`).join(', ')}`;
    },
  },
  {
    name: 'GA4 Data API',
    needs: ['GOOGLE_APPLICATION_CREDENTIALS', 'GA4_PROPERTY_ID'],
    run: async () => {
      const t = await ga4.runReport({ startDate: '7daysAgo', endDate: 'yesterday', metrics: ['eventCount'], dimensions: ['eventName'], limit: 3 });
      return t.rows.map((r) => `${r[0]}=${r[1]}`).join(', ') || 'no rows';
    },
  },
  {
    name: 'Firebase Remote Config',
    needs: ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_PROJECT_ID'],
    run: async () => {
      const f = await remoteConfig.getFlags();
      return `${f.flags.length} parameters, template version ${f.version ?? 'n/a'}`;
    },
  },
  {
    name: 'RevenueCat',
    needs: ['REVENUECAT_SECRET_KEY', 'REVENUECAT_PROJECT_ID'],
    run: async () => JSON.stringify((await revenuecat.overview()).metrics).slice(0, 160),
  },
];

let failed = 0;
for (const check of checks) {
  if (!isConfigured(...check.needs)) {
    console.log(`–  ${check.name}: skipped (set ${check.needs.join(', ')})`);
    continue;
  }
  try {
    console.log(`✓  ${check.name}: ${await check.run()}`);
  } catch (error) {
    failed++;
    console.log(`✗  ${check.name}: ${(error as Error).message}`);
  }
}
console.log(`\nOpenAI key: ${isConfigured('OPENAI_API_KEY') ? 'set' : 'MISSING'} · Telegram token: ${isConfigured('TELEGRAM_BOT_TOKEN') ? 'set' : 'MISSING'}`);
process.exit(failed > 0 ? 1 : 0);
