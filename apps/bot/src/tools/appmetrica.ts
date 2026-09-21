import { appmetrica } from '@autopilot/analytics-core';
import { type RunContext, tool } from '@openai/agents';
import { z } from 'zod';
import type { BotContext } from '../context.js';
import { guarded } from './util.js';

const METRICS = [
  'ym:u:activeUsers',
  'ym:u:newUsers',
  'ym:s:sessions',
  'ym:s:sessionsPerUser',
  'ym:ce:users',
  'ym:ce:devices',
  'ym:ce:allEvents',
  'ym:ge:users',
] as const;

const DIMENSIONS = [
  'ym:ge:date',
  'ym:ge:appVersion',
  'ym:ge:operatingSystemInfo',
  'ym:ge:regionCountry',
  'ym:ge:regionCity',
  'ym:ge:deviceType',
  'ym:ce:eventLabel',
  'ym:ce:paramsLevel1',
  'ym:ce:paramsLevel2',
] as const;

const dateHelp = "YYYY-MM-DD, or relative: 'today', 'yesterday', '7daysAgo'";

export const appmetricaReport = tool({
  name: 'appmetrica_report',
  description: [
    'Aggregated table from the AppMetrica Reporting API. Use for users, new users, sessions, event counts, and splits by date / app version / OS / country.',
    'Do not mix metric families in one call: ym:u:* (users), ym:s:* (sessions), ym:ce:* (client events), ym:ge:* (generic).',
    'Event questions: metrics ym:ce:users or ym:ce:allEvents with dimension ym:ce:eventLabel (the event name).',
    "Event parameter breakdown: dimensions ['ym:ce:paramsLevel1','ym:ce:paramsLevel2'] (param key, param value) with filters like",
    "\"ym:ce:eventLabel=='onboarding_step_shown' AND ym:ce:paramsLevel1=='step_id'\".",
    "Filter syntax: ==, !=, =@ (contains), AND, OR, string values in single quotes.",
  ].join(' '),
  parameters: z.object({
    metrics: z.array(z.enum(METRICS)).min(1).max(4),
    dimensions: z.array(z.enum(DIMENSIONS)).max(3),
    date1: z.string().describe(`Start date. ${dateHelp}`),
    date2: z.string().describe(`End date. ${dateHelp}`),
    filters: z.string().nullable().describe('AppMetrica filter expression, or null'),
    limit: z.number().int().min(1).max(200).nullable().describe('Max rows (default 50)'),
  }),
  timeoutMs: 40_000,
  timeoutBehavior: 'error_as_result',
  execute: async (a) => guarded('AppMetrica Reporting API', () => appmetrica.report(a)),
});

export const appmetricaFunnel = tool({
  name: 'appmetrica_funnel',
  description: [
    'Funnel across 2-8 event names, in order. Returns users reaching each step, step conversion, and the biggest drop.',
    "mode 'fast' (default choice): unique users per event from the Reporting API — instant, but steps are counted independently.",
    "mode 'sequential': exact ordered funnel from raw events (Logs API). Slow on first call (the export is queued, up to a few minutes), instant afterwards.",
    'Use fast first; use sequential when the user asks for an exact funnel or the fast numbers look inconsistent.',
    'Always take event names from event_catalog_lookup.',
  ].join(' '),
  parameters: z.object({
    steps: z.array(z.string()).min(2).max(8).describe('Event names in funnel order'),
    date1: z.string().describe(`Start date. ${dateHelp}`),
    date2: z.string().describe(`End date. ${dateHelp}`),
    mode: z.enum(['fast', 'sequential']),
    by: z.enum(['device', 'profile']).describe("Entity counted in sequential mode. 'device' is the safe default; 'profile' only counts signed-in users."),
  }),
  timeoutMs: 230_000,
  timeoutBehavior: 'error_as_result',
  execute: async (a) => guarded('AppMetrica funnel', () => appmetrica.funnel(a)),
});

export const appmetricaProfilesSummary = tool({
  name: 'appmetrica_profiles_summary',
  description:
    'Summarise AppMetrica user profiles (profiles_v2 export): OS, app versions, countries, gender, notifications enabled, sessions per user, first-session cohorts, plus any custom profile attributes you name. Slow on first call (queued export). "(not set)" values mean the app does not report that attribute.',
  parameters: z.object({
    custom_attributes: z.array(z.string()).max(10).describe('Custom profile attribute names to break down, e.g. ["plan","is_premium"]. Empty array for none.'),
    limit: z.number().int().min(100).max(200_000).nullable().describe('Max profiles to export (null = all)'),
  }),
  timeoutMs: 230_000,
  timeoutBehavior: 'error_as_result',
  execute: async (a) => guarded('AppMetrica profiles', () => appmetrica.profilesSummary({ customAttributes: a.custom_attributes, limit: a.limit })),
});

export const appmetricaTools = [appmetricaReport, appmetricaFunnel, appmetricaProfilesSummary];
