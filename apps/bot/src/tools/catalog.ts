import { catalog } from '@autopilot/analytics-core';
import { type RunContext, tool } from '@openai/agents';
import { z } from 'zod';
import type { BotContext } from '../context.js';
import { guarded } from './util.js';

export const eventCatalogLookup = tool({
  name: 'event_catalog_lookup',
  description:
    'Search the app\'s event catalog (generated from its source code): event names, parameters, domain, funnel membership, where each event fires, and status ("dead" = declared but never fired, "bypasses_fanout" = sent to one SDK only). Call this BEFORE querying any event so you use real names. Empty query lists domains and funnels. Query "dead" lists dead events.',
  parameters: z.object({
    query: z.string().describe('Event name fragment, parameter, domain, funnel name, or status. Empty string for an overview.'),
    domain: z.string().nullable().describe('Restrict to one domain, or null'),
  }),
  execute: async (a, runContext?: RunContext<BotContext>) => guarded('Event catalog', () => catalog.searchCatalog(runContext?.context?.app ?? 'plusfit', a.query, a.domain)),
});

export const catalogTools = [eventCatalogLookup];
