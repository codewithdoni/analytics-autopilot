import { revenuecat } from '@autopilot/analytics-core';
import { type RunContext, tool } from '@openai/agents';
import { z } from 'zod';
import type { BotContext } from '../context.js';
import { guarded } from './util.js';

export const revenuecatOverview = tool({
  name: 'revenuecat_overview',
  description:
    'RevenueCat project overview: MRR, active subscriptions, active trials, revenue, new customers. Returns the raw metric list — read each metric name, unit and period literally and quote the period. Store subscriptions only; external payment rails are not included.',
  parameters: z.object({}),
  timeoutMs: 40_000,
  timeoutBehavior: 'error_as_result',
  execute: async () => guarded('RevenueCat', () => revenuecat.overview()),
});

export const revenuecatTools = [revenuecatOverview];
