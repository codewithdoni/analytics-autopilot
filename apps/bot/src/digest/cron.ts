import { optionalEnv } from '@autopilot/analytics-core';
import type { Agent } from '@openai/agents';
import cron from 'node-cron';
import type { BotContext, ProposalStore } from '../context.js';
import { ask } from '../runner.js';

const DIGEST_SESSION_ID = 0;

/**
 * The proactive half of the agent: a morning digest pushed to the team chat,
 * so nobody has to remember to ask. Disabled unless DIGEST_CHAT_ID is set.
 */
export function startDigestCron(agent: Agent<BotContext>, proposals: ProposalStore, send: (chatId: number, markdown: string) => Promise<void>): void {
  const chatId = Number(optionalEnv('DIGEST_CHAT_ID'));
  if (!Number.isFinite(chatId) || chatId === 0) return;
  const expression = optionalEnv('DIGEST_CRON', '0 9 * * *');
  const timezone = optionalEnv('DIGEST_TZ', 'Asia/Tashkent');
  if (!cron.validate(expression)) {
    console.warn(`DIGEST_CRON "${expression}" is not a valid cron expression; digest disabled.`);
    return;
  }
  cron.schedule(
    expression,
    async () => {
      try {
        // Session id 0 is never a real Telegram chat, so the scheduled run keeps its own memory.
        const text = await ask(agent, DIGEST_SESSION_ID, 'Morning digest: use daily_digest for the last 7 days. Lead with what changed most, keep it short, end with one suggestion.', proposals);
        await send(chatId, `☀️ **Morning digest**\n\n${text}`);
      } catch (error) {
        console.error('Digest failed:', error);
      }
    },
    { timezone },
  );
  console.log(`Morning digest scheduled: "${expression}" ${timezone} → chat ${chatId}`);
}
