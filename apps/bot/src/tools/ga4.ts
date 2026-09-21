import { ga4 } from '@autopilot/analytics-core';
import { type RunContext, tool } from '@openai/agents';
import { z } from 'zod';
import type { BotContext } from '../context.js';
import { guarded } from './util.js';

export const ga4Report = tool({
  name: 'ga4_report',
  description: [
    'GA4 Data API report (the backend of Firebase Analytics). Use for Firebase-side event counts, active users, revenue, and splits by platform / appVersion / date / country.',
    'Dimensions: eventName, date, platform, appVersion, country, deviceCategory, operatingSystem, unifiedScreenName.',
    'Event parameters and user properties only work if registered as custom definitions: customEvent:<param>, customUser:<property>. If GA4 rejects one, say so — it means the definition is not registered.',
    'Revenue metrics (totalRevenue, purchaseRevenue) are only non-zero if the app calls logPurchase.',
  ].join(' '),
  parameters: z.object({
    startDate: z.string().describe("YYYY-MM-DD, 'today', 'yesterday' or 'NdaysAgo'"),
    endDate: z.string().describe("YYYY-MM-DD, 'today', 'yesterday' or 'NdaysAgo'"),
    metrics: z.array(z.enum(['eventCount', 'activeUsers', 'newUsers', 'sessions', 'totalUsers', 'totalRevenue', 'purchaseRevenue', 'eventCountPerUser'])).min(1).max(4),
    dimensions: z.array(z.string()).max(3),
    event_names: z.array(z.string()).max(20).describe('Keep only these exact event names. Empty array for no filter.'),
    limit: z.number().int().min(1).max(200).nullable(),
  }),
  timeoutMs: 40_000,
  timeoutBehavior: 'error_as_result',
  execute: async (a) =>
    guarded('GA4 Data API', () =>
      ga4.runReport({
        startDate: a.startDate,
        endDate: a.endDate,
        metrics: a.metrics,
        dimensions: a.dimensions,
        eventNames: a.event_names,
        limit: a.limit,
      }),
    ),
});

export const ga4Realtime = tool({
  name: 'ga4_realtime',
  description: 'GA4 realtime report: what is happening in the last 30 minutes. Use to check that freshly shipped instrumentation is arriving, or for "how many users right now".',
  parameters: z.object({
    dimensions: z.array(z.enum(['eventName', 'platform', 'appVersion', 'unifiedScreenName', 'country'])).min(1).max(2),
  }),
  timeoutMs: 40_000,
  timeoutBehavior: 'error_as_result',
  execute: async (a) => guarded('GA4 realtime', () => ga4.runRealtime({ dimensions: a.dimensions })),
});

export const ga4Tools = [ga4Report, ga4Realtime];
