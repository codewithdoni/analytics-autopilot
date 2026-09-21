import { catalog, dates, isConfigured, optionalEnv } from '@autopilot/analytics-core';
import { Agent, type RunContext } from '@openai/agents';
import type { BotContext } from './context.js';
import { appmetricaTools } from './tools/appmetrica.js';
import { catalogTools } from './tools/catalog.js';
import { digestTools } from './tools/digest.js';
import { ga4Tools } from './tools/ga4.js';
import { remoteConfigTools } from './tools/remoteconfig.js';
import { revenuecatTools } from './tools/revenuecat.js';

const PERSONA = `You are the analytics engineer for a mobile app team, and you live in their Telegram chat.
You answer like a senior colleague: the number first, then what it means, then the one thing worth doing about it.

How you work
- Call event_catalog_lookup before you name or query any event. Never invent event or parameter names.
- Every number you give carries its source and date range, e.g. "AppMetrica, 8–14 Sep".
- Default range is the last 7 full days ending yesterday (today is partial). Use realtime tools only for "right now" questions.
- When it costs one extra call, compare with the previous period and give the change in percent.
- Prefer AppMetrica for event funnels and user counts. Use GA4 for Firebase-only questions and revenue. Use RevenueCat for subscription money.
- For funnels use appmetrica_funnel in fast mode first. Fast mode counts each step independently; say so if a later step exceeds an earlier one. Use sequential mode when asked for an exact funnel.
- If one source fails or is not configured, say which one in one line and answer from the rest. Never pretend a number exists.
- If the catalog lists an instrumentation gap that explains a strange number (for example revenue missing in GA4), say it plainly.

Remote Config
- You can read flags freely. You can never change them yourself.
- Only when the user explicitly asks to change a flag, call remote_config_propose_change. The user then confirms with a button. Say exactly what will change.

Style (this is a phone screen)
- Reply in the language the user writes in (Uzbek, Russian or English).
- Keep it under about 1200 characters unless asked for detail. No raw JSON.
- Small tables only: put them in a fenced code block, at most 8 rows, short column names.
- Use plain text and **bold** for the key number. No headers, no nested lists.`;

function availability(): string {
  const lines = [
    `AppMetrica: ${isConfigured('APPMETRICA_OAUTH_TOKEN', 'APPMETRICA_APP_ID') ? 'configured' : 'NOT configured'}`,
    `GA4: ${isConfigured('GOOGLE_APPLICATION_CREDENTIALS', 'GA4_PROPERTY_ID') ? 'configured' : 'NOT configured'}`,
    `Remote Config: ${isConfigured('GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_PROJECT_ID') ? 'configured' : 'NOT configured'}`,
    `RevenueCat: ${isConfigured('REVENUECAT_SECRET_KEY', 'REVENUECAT_PROJECT_ID') ? 'configured' : 'NOT configured'}`,
  ];
  return lines.join('; ');
}

export async function buildInstructions(app: string, now: Date = new Date()): Promise<string> {
  const today = dates.resolveDate('today', now);
  return [
    PERSONA,
    '',
    `Today is ${today} (${dates.reportingTimeZone()}). Yesterday is ${dates.addDays(today, -1)}.`,
    `Data sources: ${availability()}.`,
    '',
    'What you know about the app (from its source code):',
    await catalog.catalogBrief(app),
  ].join('\n');
}

export function buildAgent(): Agent<BotContext> {
  const model = optionalEnv('OPENAI_MODEL');
  return new Agent<BotContext>({
    name: 'analytics-engineer',
    instructions: (runContext: RunContext<BotContext>) => buildInstructions(runContext.context.app),
    ...(model ? { model } : {}),
    tools: [...catalogTools, ...appmetricaTools, ...ga4Tools, ...revenuecatTools, ...remoteConfigTools, ...digestTools],
  });
}
