import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appmetrica, catalog, isConfigured, optionalEnv } from '@autopilot/analytics-core';

/**
 * /instrument <repo>: the Telegram agent hands a Flutter repo to a headless
 * coding agent (Claude Code or Codex) running the flutter-analytics-autopilot
 * skill, then opens a PR and loads the generated event catalog so the bot can
 * answer questions about the new app.
 *
 * Trust model: only allow-listed chats reach this code, and the coding agent
 * runs with edit permissions inside a throw-away clone. Do not point it at
 * repositories you do not trust.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const SKILL_DIR = path.join(REPO_ROOT, 'skills/flutter-analytics-autopilot');
const WORK_ROOT = path.join(REPO_ROOT, 'apps/bot/.work/instrument');

export type Progress = (line: string) => void | Promise<void>;

export type InstrumentResult = {
  app: string;
  workDir: string;
  coverage: string | null;
  catalogLoaded: boolean;
  appmetricaAppId: number | null;
  prUrl: string | null;
  notes: string[];
};

type Target = { cloneFrom: string; name: string; isGithub: boolean };

export function parseTarget(input: string): Target {
  const value = input.trim();
  const gh = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(value);
  if (gh) return { cloneFrom: `https://github.com/${gh[1]}/${gh[2]}.git`, name: toAppName(gh[2] as string), isGithub: true };
  if (path.isAbsolute(value) && optionalEnv('INSTRUMENT_ALLOW_LOCAL') === '1') {
    if (!existsSync(path.join(value, '.git'))) throw new Error('Local path must be a git repository');
    return { cloneFrom: value, name: toAppName(path.basename(value)), isGithub: false };
  }
  throw new Error('Give a GitHub URL like https://github.com/owner/repo (local paths need INSTRUMENT_ALLOW_LOCAL=1).');
}

export function toAppName(raw: string): string {
  const name = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(name) ? name.slice(0, 48) : `app_${name}`.slice(0, 48);
}

type ExecResult = { code: number; stdout: string; stderr: string };

function exec(cmd: string, args: string[], options: { cwd: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const cap = (s: string) => (s.length > 200_000 ? s.slice(-200_000) : s);
    child.stdout.on('data', (d: Buffer) => (stdout = cap(stdout + d.toString())));
    child.stderr.on('data', (d: Buffer) => (stderr = cap(stderr + d.toString())));
    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeoutMs ?? 120_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function must(cmd: string, args: string[], cwd: string, timeoutMs?: number): Promise<string> {
  const r = await exec(cmd, args, { cwd, timeoutMs });
  if (r.code !== 0) throw new Error(`${cmd} ${args[0] ?? ''} failed: ${(r.stderr || r.stdout).trim().slice(-300)}`);
  return r.stdout.trim();
}

/** Find the Flutter project inside the clone (root, or one level of nesting such as app/ or mobile/). */
async function findFlutterRoot(dir: string): Promise<string> {
  const isFlutter = async (d: string) => {
    try {
      return /\n\s*flutter:\s*\n\s*sdk:\s*flutter/.test(await readFile(path.join(d, 'pubspec.yaml'), 'utf8'));
    } catch {
      return false;
    }
  };
  if (await isFlutter(dir)) return dir;
  for (const level1 of await readdir(dir, { withFileTypes: true })) {
    if (!level1.isDirectory() || level1.name.startsWith('.')) continue;
    const d1 = path.join(dir, level1.name);
    if (await isFlutter(d1)) return d1;
    for (const level2 of await readdir(d1, { withFileTypes: true })) {
      if (level2.isDirectory() && !level2.name.startsWith('.') && (await isFlutter(path.join(d1, level2.name)))) return path.join(d1, level2.name);
    }
  }
  throw new Error('No Flutter project (pubspec.yaml with the flutter SDK) found in that repository');
}

function toolEnv(): NodeJS.ProcessEnv {
  // Non-interactive shells often lack Flutter on PATH (fvm, custom installs).
  const extra = [optionalEnv('FLUTTER_BIN_DIR'), path.join(os.homedir(), 'fvm/default/bin'), path.join(os.homedir(), '.pub-cache/bin')].filter((p) => p && existsSync(p));
  return { ...process.env, PATH: [...extra, process.env.PATH ?? ''].join(path.delimiter) };
}

function agentCommand(prompt: string, flutterRoot: string): { cmd: string; args: string[] } {
  const maxTurns = optionalEnv('INSTRUMENT_MAX_TURNS', '80');
  if (optionalEnv('INSTRUMENT_AGENT', 'claude') === 'codex') {
    return { cmd: 'codex', args: ['exec', '--sandbox', 'workspace-write', '-C', flutterRoot, '--skip-git-repo-check', prompt] };
  }
  return {
    cmd: 'claude',
    args: [
      '-p',
      prompt,
      '--permission-mode',
      'acceptEdits',
      '--add-dir',
      SKILL_DIR,
      '--allowedTools',
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(node:*)',
      'Bash(flutter:*)',
      'Bash(dart:*)',
      'Bash(flutterfire:*)',
      'Bash(git status:*)',
      'Bash(git diff:*)',
      '--output-format',
      'json',
      '--max-turns',
      maxTurns,
    ],
  };
}

export async function instrumentRepo(input: { repo: string; openPr: boolean }, progress: Progress): Promise<InstrumentResult> {
  const target = parseTarget(input.repo);
  const notes: string[] = [];
  const workDir = path.join(WORK_ROOT, `${target.name}-${Date.now()}`);
  await mkdir(WORK_ROOT, { recursive: true });

  await progress(`Cloning ${target.cloneFrom}`);
  await must('git', ['clone', '--depth', '1', target.cloneFrom, workDir], WORK_ROOT, 180_000);
  const flutterRoot = await findFlutterRoot(workDir);

  // The key file must be ignored BEFORE it exists, so it can never be committed.
  const gitignore = path.join(flutterRoot, '.gitignore');
  const ignoreLine = 'lib/core/secrets/.env';
  const currentIgnore = existsSync(gitignore) ? await readFile(gitignore, 'utf8') : '';
  if (!currentIgnore.split('\n').some((l) => l.trim() === ignoreLine)) await appendFile(gitignore, `\n# analytics secrets (never commit)\n${ignoreLine}\n`);

  let appmetricaAppId: number | null = null;
  if (isConfigured('APPMETRICA_OAUTH_TOKEN')) {
    await progress('Creating the AppMetrica application');
    try {
      const created = await appmetrica.createApplication(target.name);
      appmetricaAppId = created.id;
      if (created.api_key128) {
        await mkdir(path.join(flutterRoot, 'lib/core/secrets'), { recursive: true });
        await writeFile(path.join(flutterRoot, 'lib/core/secrets/.env'), `yandexMetricaApiKey=${created.api_key128}\n`, { mode: 0o600 });
      }
    } catch (error) {
      notes.push(`AppMetrica app not created: ${(error as Error).message}`);
    }
  } else notes.push('APPMETRICA_OAUTH_TOKEN is not set, so no AppMetrica application was created. Add the SDK key to lib/core/secrets/.env yourself.');

  await progress('Running the instrumentation skill (this takes several minutes)');
  const prompt = [
    `Read ${path.join(SKILL_DIR, 'SKILL.md')} and follow its workflow exactly to instrument the Flutter app in the current directory.`,
    `The skill directory is ${SKILL_DIR}; use it wherever the skill says \${CLAUDE_SKILL_DIR}.`,
    `Arguments: app_name=${target.name} appmetrica_key=env. You are running headless: do not ask questions, make the documented default choice and continue.`,
    'Do not commit, push or touch git history. Finish by printing the coverage table.',
  ].join('\n');
  const { cmd, args } = agentCommand(prompt, flutterRoot);
  const ran = await exec(cmd, args, { cwd: flutterRoot, env: toolEnv(), timeoutMs: 45 * 60_000 });
  if (ran.code !== 0) notes.push(`${cmd} exited with code ${ran.code}: ${(ran.stderr || ran.stdout).trim().slice(-200)}`);

  let coverage: string | null = null;
  try {
    const report = JSON.parse(await readFile(path.join(flutterRoot, 'coverage.json'), 'utf8')) as { table?: string };
    coverage = report.table ?? null;
  } catch {
    notes.push('The skill did not leave a coverage.json — check the run output.');
  }

  let catalogLoaded = false;
  const generated = path.join(flutterRoot, 'analytics_catalog.json');
  if (existsSync(generated)) {
    await mkdir(catalog.catalogDir(), { recursive: true });
    await copyFile(generated, path.join(catalog.catalogDir(), `${target.name}.json`));
    await catalog.loadCatalog(target.name, { fresh: true });
    catalogLoaded = true;
  }

  let prUrl: string | null = null;
  if (input.openPr && target.isGithub) {
    await progress('Opening the pull request');
    try {
      const ignored = await exec('git', ['check-ignore', '-q', 'lib/core/secrets/.env'], { cwd: flutterRoot });
      if (ignored.code !== 0) throw new Error('secrets file is not ignored — refusing to commit');
      await must('git', ['checkout', '-b', 'analytics-autopilot'], workDir);
      await must('git', ['add', '-A'], workDir);
      await must('git', ['-c', 'user.name=analytics-autopilot', '-c', 'user.email=autopilot@users.noreply.github.com', 'commit', '-m', 'feat(analytics): instrument every screen and action (analytics-autopilot)'], workDir);
      await must('git', ['push', '-u', 'origin', 'analytics-autopilot'], workDir, 180_000);
      const body = ['Instrumented by [analytics-autopilot](https://github.com/codewithdoni/analytics-autopilot).', '', coverage ? `\`\`\`\n${coverage}\n\`\`\`` : '', '', 'The AppMetrica SDK key lives in `lib/core/secrets/.env` (gitignored) and is not part of this PR.'].join('\n');
      prUrl = await must('gh', ['pr', 'create', '--title', 'Analytics: instrument every screen and action', '--body', body, '--head', 'analytics-autopilot'], workDir, 120_000);
    } catch (error) {
      notes.push(`PR not opened: ${(error as Error).message}`);
    }
  }

  return { app: target.name, workDir, coverage, catalogLoaded, appmetricaAppId, prUrl, notes };
}
