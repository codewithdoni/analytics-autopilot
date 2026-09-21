import { buildAgent } from './agent.js';
import { ProposalStore } from './context.js';
import { ask } from './runner.js';

/** Ask the agent from the terminal — same brain as the Telegram bot, no Telegram needed. */
const question = process.argv.slice(2).join(' ').trim();
if (!question) {
  console.error('Usage: npm run ask -- "DAU last 7 days vs the week before"');
  process.exit(1);
}
const answer = await ask(buildAgent(), 1, question, new ProposalStore());
console.log(answer);
