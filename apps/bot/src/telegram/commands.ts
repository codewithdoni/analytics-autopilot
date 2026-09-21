import { catalog } from '@autopilot/analytics-core';
import type { Bot, Context } from 'grammy';
import { instrumentRepo } from '../instrument/orchestrator.js';
import { appFor, resetSession, setApp, tryLock } from '../sessions.js';
import { escapeHtml } from './format.js';

export type AskFn = (ctx: Context, prompt: string) => Promise<void>;

const HELP = [
  '<b>Analytics engineer, at your service.</b>',
  '',
  'Just ask: "DAU last week vs the week before", "where do people drop in onboarding?", "MRR and trials", "which events are dead?"',
  '',
  '/digest — the numbers that matter, vs the previous period',
  '/funnel &lt;name&gt; — a funnel from the catalog (no name lists them)',
  '/flags — Remote Config flags and kill switches',
  '/apps — apps I know · /app &lt;name&gt; — switch app',
  '/instrument &lt;github-url&gt; — wire analytics into a Flutter repo and open a PR',
  '/reset — forget this conversation · /id — show this chat id',
].join('\n');

export function registerCommands(bot: Bot, askAgent: AskFn): void {
  bot.command(['start', 'help'], (ctx) => ctx.reply(HELP, { parse_mode: 'HTML' }));

  bot.command('reset', async (ctx) => {
    resetSession(ctx.chat.id);
    await ctx.reply('Conversation memory cleared.');
  });

  bot.command('apps', async (ctx) => {
    const apps = await catalog.listApps();
    const active = appFor(ctx.chat.id);
    await ctx.reply(apps.length === 0 ? 'No catalogs yet. Run `npm run catalog`.' : apps.map((a) => `${a === active ? '▶︎' : '•'} ${a}`).join('\n'));
  });

  bot.command('app', async (ctx) => {
    const name = ctx.match.trim().toLowerCase();
    if (!name) return void (await ctx.reply(`Active app: ${appFor(ctx.chat.id)}. Use /app <name> to switch.`));
    try {
      const c = await catalog.loadCatalog(name, { fresh: true });
      setApp(ctx.chat.id, name);
      await ctx.reply(`Switched to ${name}: ${c.events.length} events, ${c.screens.length} screens, ${Object.keys(c.funnels).length} funnels.`);
    } catch (error) {
      await ctx.reply((error as Error).message);
    }
  });

  bot.command('digest', (ctx) => askAgent(ctx, 'Give me the digest for the last 7 days. Use daily_digest, then tell me what moved and the one thing worth looking at.'));

  bot.command('flags', (ctx) => askAgent(ctx, 'List the Remote Config flags and kill switches with their current default values, grouped sensibly. Point out any that look risky or inconsistent with each other.'));

  bot.command('funnel', async (ctx) => {
    const name = ctx.match.trim().toLowerCase();
    if (!name) {
      try {
        const c = await catalog.loadCatalog(appFor(ctx.chat.id));
        const list = Object.entries(c.funnels).map(([n, steps]) => `• <b>${escapeHtml(n)}</b>: ${escapeHtml(steps.join(' → '))}`);
        await ctx.reply(list.length > 0 ? list.join('\n') : 'The catalog defines no funnels.', { parse_mode: 'HTML' });
      } catch (error) {
        await ctx.reply((error as Error).message);
      }
      return;
    }
    await askAgent(ctx, `Show the "${name}" funnel for the last 7 days against the 7 days before. Where is the biggest drop, and is it getting better or worse?`);
  });

  bot.command('instrument', async (ctx) => {
    const repo = ctx.match.trim();
    if (!repo) return void (await ctx.reply('Usage: /instrument https://github.com/owner/flutter-repo'));
    const release = tryLock(ctx.chat.id);
    if (!release) return void (await ctx.reply('Still working on your previous request.'));
    const status = await ctx.reply('Starting…');
    const lines: string[] = [];
    const progress = async (line: string) => {
      lines.push(`• ${line}`);
      await ctx.api.editMessageText(ctx.chat.id, status.message_id, lines.join('\n')).catch(() => undefined);
    };
    try {
      const result = await instrumentRepo({ repo, openPr: true }, progress);
      if (result.catalogLoaded) setApp(ctx.chat.id, result.app);
      const parts = [
        `<b>${escapeHtml(result.app)}</b> instrumented.`,
        result.prUrl ? `PR: ${escapeHtml(result.prUrl)}` : 'No PR was opened.',
        result.appmetricaAppId ? `AppMetrica application id: ${result.appmetricaAppId}` : '',
        result.coverage ? `<pre>${escapeHtml(result.coverage)}</pre>` : '',
        result.catalogLoaded ? `I loaded its event catalog and switched this chat to <b>${escapeHtml(result.app)}</b>. Ask me what it tracks.` : '',
        ...result.notes.map((n) => `⚠️ ${escapeHtml(n)}`),
      ].filter(Boolean);
      await ctx.reply(parts.join('\n'), { parse_mode: 'HTML' });
    } catch (error) {
      await ctx.reply(`Instrumentation failed: ${(error as Error).message.slice(0, 500)}`);
    } finally {
      release();
    }
  });
}
