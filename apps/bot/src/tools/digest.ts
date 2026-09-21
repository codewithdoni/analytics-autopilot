import { tool } from '@openai/agents';
import { z } from 'zod';
import { buildDigest } from '../digest/build.js';
import { guarded } from './util.js';
import type { BotContext } from '../context.js';
import type { RunContext } from '@openai/agents';

export const dailyDigest = tool({
  name: 'daily_digest',
  description:
    'One call that gathers the standard digest: active/new users and sessions vs the previous period, daily trend, top events, top app versions, the catalog funnels with their biggest drop, and RevenueCat overview. Use for "digest", "how are we doing", "weekly summary". Then write a short narrative: what moved, by how much, and the one thing worth looking at.',
  parameters: z.object({ days: z.number().int().min(1).max(30).nullable().describe('Period length ending yesterday (default 7)') }),
  timeoutMs: 120_000,
  timeoutBehavior: 'error_as_result',
  execute: async (a, runContext?: RunContext<BotContext>) => guarded('Digest', () => buildDigest(runContext?.context?.app ?? 'plusfit', a.days ?? 7)),
});

export const digestTools = [dailyDigest];
