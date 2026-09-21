import { optionalEnv } from './env.js';

/**
 * Date helpers. The Reporting API and GA4 both understand relative dates
 * ("7daysAgo", "yesterday", "today"); the Logs API only takes absolute
 * "YYYY-MM-DD hh:mm:ss". We resolve relative dates in the app's reporting
 * timezone so "yesterday" means the same day everywhere.
 */
export function reportingTimeZone(): string {
  return optionalEnv('ANALYTICS_TZ', 'Asia/Tashkent');
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE = /^(\d+)daysAgo$/i;

function todayIn(timeZone: string, now: Date): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Resolve "today" | "yesterday" | "NdaysAgo" | "YYYY-MM-DD" to "YYYY-MM-DD". */
export function resolveDate(input: string, now: Date = new Date(), timeZone: string = reportingTimeZone()): string {
  const value = input.trim();
  if (ISO_DATE.test(value)) return value;
  const today = todayIn(timeZone, now);
  if (/^today$/i.test(value)) return today;
  if (/^yesterday$/i.test(value)) return addDays(today, -1);
  const rel = RELATIVE.exec(value);
  if (rel) return addDays(today, -Number(rel[1]));
  throw new Error(`Unrecognised date "${input}". Use YYYY-MM-DD, today, yesterday or NdaysAgo.`);
}

export function daysBetween(date1: string, date2: string): number {
  const a = Date.parse(`${date1}T00:00:00Z`);
  const b = Date.parse(`${date2}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** The equally long period immediately before [date1, date2]. */
export function previousPeriod(date1: string, date2: string): { date1: string; date2: string } {
  const length = daysBetween(date1, date2) + 1;
  return { date1: addDays(date1, -length), date2: addDays(date1, -1) };
}

/** Logs API datetime bounds for an inclusive date range. */
export function logsRange(date1: string, date2: string): { date_since: string; date_until: string } {
  return { date_since: `${date1} 00:00:00`, date_until: `${date2} 23:59:59` };
}
