/**
 * Configuration access. Nothing here reads the environment at import time, so a
 * missing credential only fails the one tool that needs it — the agent can still
 * answer from the other sources.
 */
export class MissingConfigError extends Error {
  constructor(public readonly keys: string[]) {
    super(`Not configured: set ${keys.join(', ')} in .env`);
    this.name = 'MissingConfigError';
  }
}

export function optionalEnv(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
}

export function requireEnv<K extends string>(...keys: K[]): Record<K, string> {
  const missing = keys.filter((k) => optionalEnv(k) === '');
  if (missing.length > 0) throw new MissingConfigError(missing);
  const out = {} as Record<K, string>;
  for (const k of keys) out[k] = optionalEnv(k);
  return out;
}

export function isConfigured(...keys: string[]): boolean {
  return keys.every((k) => optionalEnv(k) !== '');
}
