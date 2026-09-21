import { RemoteConfigConflictError, optionalEnv, remoteConfig, requireEnv } from '@autopilot/analytics-core';
import { Bot, type Context, GrammyError, InlineKeyboard } from 'grammy';
import { buildAgent } from './agent.js';
import { ProposalStore } from './context.js';
import { startDigestCron } from './digest/cron.js';
import { ask } from './runner.js';
import { tryLock } from './sessions.js';
import { registerCommands } from './telegram/commands.js';
import { escapeHtml, stripHtml, toTelegramHtmlChunks } from './telegram/format.js';

const { TELEGRAM_BOT_TOKEN } = requireEnv('TELEGRAM_BOT_TOKEN', 'OPENAI_API_KEY');
const allowed = new Set(
  optionalEnv('ALLOWED_CHAT_IDS')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0),
);

const bot = new Bot(TELEGRAM_BOT_TOKEN);
const agent = buildAgent();
const proposals = new ProposalStore();

/** Send Markdown as Telegram HTML; if Telegram rejects the markup, fall back to plain text. */
export async function sendMarkdown(chatId: number, markdown: string): Promise<void> {
  for (const chunk of toTelegramHtmlChunks(markdown)) {
    try {
      await bot.api.sendMessage(chatId, chunk, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    } catch (error) {
      if (error instanceof GrammyError && error.error_code === 400) await bot.api.sendMessage(chatId, stripHtml(chunk));
      else throw error;
    }
  }
}

async function announceProposals(chatId: number): Promise<void> {
  for (const p of proposals.unannounced(chatId)) {
    const keyboard = new InlineKeyboard().text('✅ Apply', `rc:${p.id}:y`).text('✖️ Cancel', `rc:${p.id}:n`);
    const text = [`<b>Remote Config change — needs your confirmation</b>`, `<code>${escapeHtml(p.key)}</code>: <code>${escapeHtml(p.oldValue ?? '(unset)')}</code> → <code>${escapeHtml(p.newValue)}</code>`, escapeHtml(p.reason), 'This changes the default value for all users. Expires in 10 minutes.'].join('\n');
    await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
}

async function askAgent(ctx: Context, prompt: string): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const release = tryLock(chatId);
  if (!release) return void (await ctx.reply('Still working on your previous question — one moment.'));
  const typing = setInterval(() => void ctx.replyWithChatAction('typing').catch(() => undefined), 4_000);
  await ctx.replyWithChatAction('typing').catch(() => undefined);
  try {
    await sendMarkdown(chatId, (await ask(agent, chatId, prompt, proposals)) || 'I have nothing to report.');
    await announceProposals(chatId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[chat ${chatId}]`, error);
    await ctx.reply(`That failed: ${message.slice(0, 300)}`);
  } finally {
    clearInterval(typing);
    release();
  }
}

// /id works for everyone so a new user can find the id to put in ALLOWED_CHAT_IDS.
bot.command('id', (ctx) => ctx.reply(`Chat id: ${ctx.chat.id}`));

bot.use(async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (chatId === undefined || !allowed.has(chatId)) {
    if (ctx.message?.text) console.warn(`Ignored message from non-allow-listed chat ${chatId ?? '?'}`);
    return;
  }
  await next();
});

registerCommands(bot, askAgent);

bot.callbackQuery(/^rc:([0-9a-f]+):(y|n)$/, async (ctx) => {
  const [, id, answer] = ctx.match as unknown as [string, string, string];
  const proposal = proposals.take(id);
  if (!proposal || proposal.chatId !== ctx.chat?.id) {
    await ctx.answerCallbackQuery({ text: 'This proposal expired.' });
    return void (await ctx.editMessageReplyMarkup().catch(() => undefined));
  }
  await ctx.editMessageReplyMarkup().catch(() => undefined);
  if (answer === 'n') {
    await ctx.answerCallbackQuery({ text: 'Cancelled' });
    return void (await ctx.reply(`Cancelled. ${proposal.key} stays ${proposal.oldValue ?? '(unset)'}.`));
  }
  await ctx.answerCallbackQuery({ text: 'Applying…' });
  try {
    const applied = await remoteConfig.setDefaultValue({ key: proposal.key, value: proposal.newValue, etag: proposal.etag, validateOnly: false });
    await ctx.reply(`Applied. ${proposal.key} = ${proposal.newValue} (template version ${applied.version ?? 'n/a'}). Clients pick it up on their next fetch.`);
  } catch (error) {
    await ctx.reply(error instanceof RemoteConfigConflictError ? 'Not applied: Remote Config was edited by someone else in the meantime. Ask me again and I will re-read it.' : `Not applied: ${(error as Error).message.slice(0, 300)}`);
  }
});

bot.on('message:text', (ctx) => askAgent(ctx, ctx.msg.text));

bot.catch((err) => console.error('Bot error:', err.error));

if (allowed.size === 0) console.warn('ALLOWED_CHAT_IDS is empty: the bot will ignore everyone. Send /id to the bot, then add the id to .env.');
startDigestCron(agent, proposals, sendMarkdown);
await bot.api.setMyCommands([
  { command: 'digest', description: 'Numbers that matter vs last period' },
  { command: 'funnel', description: 'Show a funnel from the catalog' },
  { command: 'flags', description: 'Remote Config flags' },
  { command: 'apps', description: 'Apps I know' },
  { command: 'app', description: 'Switch app' },
  { command: 'instrument', description: 'Wire analytics into a Flutter repo' },
  { command: 'reset', description: 'Forget this conversation' },
  { command: 'help', description: 'What I can do' },
]);
console.log(`Analytics engineer online. Allow-listed chats: ${[...allowed].join(', ') || '(none)'}`);
await bot.start();
