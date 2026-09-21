import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optionalEnv } from './env.js';

/**
 * Tiny JSON cache: memory first, disk second. Analytics APIs are slow and
 * rate-limited (RevenueCat ~5 req/min, AppMetrica Logs API exports take minutes),
 * and an agent happily asks the same question twice in one turn.
 *
 * Keys must never contain credentials — callers pass URLs/params only.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function cacheDir(): string {
  return optionalEnv('AUTOPILOT_CACHE_DIR', path.join(REPO_ROOT, 'apps/bot/.work/cache'));
}

type Entry<T> = { at: number; value: T };
const memory = new Map<string, Entry<unknown>>();

function fileFor(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 32);
  return path.join(cacheDir(), `${hash}.json`);
}

export async function cacheGet<T>(key: string, maxAgeMs: number): Promise<T | undefined> {
  const now = Date.now();
  const mem = memory.get(key) as Entry<T> | undefined;
  if (mem && now - mem.at <= maxAgeMs) return mem.value;
  try {
    const entry = JSON.parse(await readFile(fileFor(key), 'utf8')) as Entry<T>;
    if (now - entry.at <= maxAgeMs) {
      memory.set(key, entry);
      return entry.value;
    }
  } catch {
    // miss or unreadable file — treat as a miss
  }
  return undefined;
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  const entry: Entry<T> = { at: Date.now(), value };
  memory.set(key, entry);
  try {
    await mkdir(cacheDir(), { recursive: true });
    await writeFile(fileFor(key), JSON.stringify(entry));
  } catch {
    // disk cache is best-effort; memory still holds the value
  }
}

export async function cached<T>(key: string, maxAgeMs: number, load: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
  const hit = await cacheGet<T>(key, maxAgeMs);
  if (hit !== undefined) return { value: hit, cached: true };
  const value = await load();
  await cacheSet(key, value);
  return { value, cached: false };
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
