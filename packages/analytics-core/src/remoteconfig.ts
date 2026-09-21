import { requireEnv } from './env.js';

/**
 * Firebase Remote Config REST API.
 * Reads need roles/firebaseremoteconfig.viewer; applying a change needs .admin.
 * Writes are optimistic: PUT with If-Match: <etag>, so a template edited by
 * someone else in the meantime is never overwritten (HTTP 412).
 *
 * Docs: https://firebase.google.com/docs/remote-config/automate-rc
 */
const SCOPE = 'https://www.googleapis.com/auth/firebase.remoteconfig';

export type RcValue = { value?: string; useInAppDefault?: boolean };
export type RcParameter = { defaultValue?: RcValue; conditionalValues?: Record<string, RcValue>; description?: string; valueType?: string };
export type RcTemplate = {
  parameters?: Record<string, RcParameter>;
  parameterGroups?: Record<string, { description?: string; parameters?: Record<string, RcParameter> }>;
  conditions?: Array<{ name: string; expression: string }>;
  version?: { versionNumber?: string; updateTime?: string; updateUser?: { email?: string } };
};

export class RemoteConfigConflictError extends Error {
  constructor() {
    super('Remote Config changed since it was read (HTTP 412). Re-read and propose again.');
    this.name = 'RemoteConfigConflictError';
  }
}

async function accessToken(): Promise<string> {
  requireEnv('GOOGLE_APPLICATION_CREDENTIALS');
  const { GoogleAuth } = await import('google-auth-library');
  const token = await new GoogleAuth({ scopes: [SCOPE] }).getAccessToken();
  if (!token) throw new Error('Could not obtain a Google access token for Remote Config');
  return token;
}

function endpoint(): string {
  return `https://firebaseremoteconfig.googleapis.com/v1/projects/${requireEnv('FIREBASE_PROJECT_ID').FIREBASE_PROJECT_ID}/remoteConfig`;
}

export async function getTemplate(): Promise<{ etag: string; template: RcTemplate }> {
  const res = await fetch(endpoint(), {
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Accept-Encoding': 'gzip' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Remote Config GET ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { etag: res.headers.get('etag') ?? '*', template: (await res.json()) as RcTemplate };
}

export type RcFlag = { key: string; group: string | null; default: string | null; conditional: Record<string, string | null>; type: string | null; description: string | null };

/** Flatten top-level parameters and parameter groups into one list. */
export function flattenParameters(template: RcTemplate): RcFlag[] {
  const out: RcFlag[] = [];
  const push = (key: string, p: RcParameter, group: string | null) =>
    out.push({
      key,
      group,
      default: p.defaultValue?.useInAppDefault ? '(in-app default)' : (p.defaultValue?.value ?? null),
      conditional: Object.fromEntries(Object.entries(p.conditionalValues ?? {}).map(([c, v]) => [c, v.useInAppDefault ? '(in-app default)' : (v.value ?? null)])),
      type: p.valueType ?? null,
      description: p.description ?? null,
    });
  for (const [key, p] of Object.entries(template.parameters ?? {})) push(key, p, null);
  for (const [group, g] of Object.entries(template.parameterGroups ?? {})) for (const [key, p] of Object.entries(g.parameters ?? {})) push(key, p, group);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export async function getFlags(keys?: string[] | null): Promise<{ source: 'firebase_remote_config'; etag: string; version: string | null; updated: string | null; flags: RcFlag[]; conditions: string[] }> {
  const { etag, template } = await getTemplate();
  const all = flattenParameters(template);
  const wanted = keys && keys.length > 0 ? new Set(keys) : null;
  return {
    source: 'firebase_remote_config',
    etag,
    version: template.version?.versionNumber ?? null,
    updated: template.version?.updateTime ?? null,
    flags: wanted ? all.filter((f) => wanted.has(f.key)) : all,
    conditions: (template.conditions ?? []).map((c) => c.name),
  };
}

function setDefault(template: RcTemplate, key: string, value: string): boolean {
  const top = template.parameters?.[key];
  if (top) {
    top.defaultValue = { value };
    return true;
  }
  for (const group of Object.values(template.parameterGroups ?? {})) {
    const p = group.parameters?.[key];
    if (p) {
      p.defaultValue = { value };
      return true;
    }
  }
  return false;
}

/**
 * Change one parameter's default value. `validateOnly` asks Firebase to check the
 * template without publishing it. Only existing parameters can be changed — the
 * agent must not invent new flags the app does not read.
 */
export async function setDefaultValue(params: { key: string; value: string; etag: string; validateOnly: boolean }): Promise<{ etag: string; version: string | null }> {
  const { template } = await getTemplate();
  if (!setDefault(template, params.key, params.value)) throw new Error(`Remote Config has no parameter "${params.key}"`);
  // `version` is output-only; Firebase rejects templates that echo it back.
  const { version: _version, ...body } = template;
  const res = await fetch(`${endpoint()}${params.validateOnly ? '?validate_only=true' : ''}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json; UTF8', 'If-Match': params.etag },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 412) throw new RemoteConfigConflictError();
  if (!res.ok) throw new Error(`Remote Config PUT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const updated = (await res.json()) as RcTemplate;
  return { etag: res.headers.get('etag') ?? params.etag, version: updated.version?.versionNumber ?? null };
}
