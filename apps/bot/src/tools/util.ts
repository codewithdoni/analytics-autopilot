import { LogsPendingError, MissingConfigError } from '@autopilot/analytics-core';

const MAX_RESULT_CHARS = 6_000;

export type ToolFailure = { error: string; hint: string };

/**
 * Tools never throw into the agent loop: a failing source becomes a small
 * `{ error, hint }` object, so the agent can say which source failed and still
 * answer from the others.
 */
export async function guarded<T>(source: string, work: () => Promise<T>): Promise<T | ToolFailure> {
  try {
    return clip(await work());
  } catch (error) {
    if (error instanceof MissingConfigError) return { error: `${source} is not configured`, hint: error.message };
    if (error instanceof LogsPendingError) return { error: error.message, hint: 'Answer from the fast (Reporting API) numbers now and offer to retry the exact funnel in a few minutes.' };
    const message = error instanceof Error ? error.message : String(error);
    return { error: `${source} failed: ${message.slice(0, 400)}`, hint: 'Tell the user this source failed and continue with the other sources.' };
  }
}

/** Keep tool output small: long tables cost tokens and rarely change the answer. */
export function clip<T>(value: T): T {
  const json = JSON.stringify(value);
  if (json === undefined || json.length <= MAX_RESULT_CHARS) return value;
  if (value && typeof value === 'object' && 'rows' in value && Array.isArray((value as { rows: unknown[] }).rows)) {
    const v = value as unknown as { rows: unknown[]; truncated?: string };
    const original = v.rows.length;
    let rows = v.rows;
    while (rows.length > 5 && JSON.stringify({ ...v, rows }).length > MAX_RESULT_CHARS) rows = rows.slice(0, Math.floor(rows.length * 0.7));
    return { ...v, rows, truncated: `showing ${rows.length} of ${original} rows` } as unknown as T;
  }
  return { truncated: 'result too large, showing the first part', preview: json.slice(0, MAX_RESULT_CHARS) } as unknown as T;
}
