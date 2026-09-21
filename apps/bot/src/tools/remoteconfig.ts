import { remoteConfig } from '@autopilot/analytics-core';
import { type RunContext, tool } from '@openai/agents';
import { z } from 'zod';
import type { BotContext } from '../context.js';
import { guarded } from './util.js';

export const remoteConfigGet = tool({
  name: 'remote_config_get',
  description: 'Read Firebase Remote Config: feature flags, kill switches and experiment groups with their default and conditional values. Pass keys to narrow, or an empty array for everything.',
  parameters: z.object({ keys: z.array(z.string()).max(30) }),
  timeoutMs: 40_000,
  timeoutBehavior: 'error_as_result',
  execute: async (a) => guarded('Firebase Remote Config', () => remoteConfig.getFlags(a.keys)),
});

export const remoteConfigProposeChange = tool({
  name: 'remote_config_propose_change',
  description:
    'Propose changing the DEFAULT value of an existing Remote Config parameter. This does NOT apply anything: the user gets Apply / Cancel buttons in Telegram and must tap Apply. Only call this when the user explicitly asks to change a flag. After calling it, tell the user what will change and that they need to confirm.',
  parameters: z.object({
    key: z.string().describe('Existing parameter key'),
    new_value: z.string().describe('New default value as a string, e.g. "true", "false", "variant_a"'),
    reason: z.string().describe('One sentence: why, with the numbers that justify it'),
  }),
  timeoutMs: 40_000,
  timeoutBehavior: 'error_as_result',
  execute: async (a, runContext?: RunContext<BotContext>) =>
    guarded('Firebase Remote Config', async () => {
      const ctx = runContext?.context;
      if (!ctx) throw new Error('No chat context available for confirmation');
      const key = a.key;
      const newValue = a.new_value;
      const current = await remoteConfig.getFlags([key]);
      const flag = current.flags[0];
      if (!flag) throw new Error(`Remote Config has no parameter "${key}" — flags the app does not read cannot be created from here`);
      if (flag.default === newValue) return { status: 'NO_CHANGE', key, value: newValue };
      // Ask Firebase to validate the new template before bothering the human.
      await remoteConfig.setDefaultValue({ key, value: newValue, etag: current.etag, validateOnly: true });
      const proposal = ctx.proposals.put({ chatId: ctx.chatId, key, oldValue: flag.default, newValue, reason: a.reason, etag: current.etag });
      return { status: 'PENDING_USER_CONFIRMATION', proposal_id: proposal.id, key, old_value: flag.default, new_value: newValue, has_conditional_values: Object.keys(flag.conditional).length > 0 };
    }),
});

export const remoteConfigTools = [remoteConfigGet, remoteConfigProposeChange];
