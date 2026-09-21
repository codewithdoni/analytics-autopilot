import { type Agent, run } from '@openai/agents';
import type { BotContext, ProposalStore } from './context.js';
import { appFor, sessionFor } from './sessions.js';

const RUN_TIMEOUT_MS = 280_000;

/** One agent turn for one chat. Shared by Telegram, the CLI and the cron digest. */
export async function ask(agent: Agent<BotContext>, chatId: number, text: string, proposals: ProposalStore): Promise<string> {
  const result = await run(agent, text, {
    session: sessionFor(chatId),
    context: { chatId, app: appFor(chatId), proposals },
    maxTurns: 14,
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
  });
  const output = result.finalOutput;
  return typeof output === 'string' ? output : JSON.stringify(output ?? '');
}
