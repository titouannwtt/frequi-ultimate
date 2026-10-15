/** Clock helpers in the user's time zone (Europe/Paris by default, UTC optional). */
import { fromLocal, toLocal } from '@/datasource/calc/periods';
import type { Tz } from '@/gateway/types.gen';

const pad = (n: number) => String(n).padStart(2, '0');

/** `HH:mm` of an instant in the zone. */
export function formatClock(ms: number, tz: Tz): string {
  const d = new Date(toLocal(tz, ms));
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** `HH:mm:ss`, for "values frozen at". */
export function formatClockSeconds(ms: number, tz: Tz): string {
  const d = new Date(toLocal(tz, ms));
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** `DD/MM HH:mm` (FR) or `MM/DD HH:mm` (EN). */
export function formatDateTime(ms: number, tz: Tz, lang: string): string {
  const d = new Date(toLocal(tz, ms));
  const day = pad(d.getUTCDate());
  const month = pad(d.getUTCMonth() + 1);
  return `${lang === 'fr' ? `${day}/${month}` : `${month}/${day}`} ${formatClock(ms, tz)}`;
}

/** Tomorrow at `hour`:00 in the zone: the "until tomorrow 08:00" silence. */
export function tomorrowAtMs(nowMs: number, tz: Tz, hour = 8): number {
  const d = new Date(toLocal(tz, nowMs));
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, hour, 0, 0);
  return fromLocal(tz, target);
}
