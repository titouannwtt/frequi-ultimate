/**
 * Profit periods and calendar buckets in an explicit time zone. Port of `fg-core::calc::periods`.
 *
 * The daily P&L is cut at midnight of the configured zone, `Europe/Paris` by default (UTC on
 * request), never at midnight of the machine or the browser. Day, week (Monday start) and month
 * boundaries are computed on the local wall clock, so a day can be 23 or 25 hours long around a
 * daylight-saving change.
 *
 * Rolling windows (`24h`, `48h`, `7d`, `14d`, `30d`) are exact durations. Calendar windows
 * (`today`, `mtd`, `ytd`, `1m`..`1y`) follow the local wall clock: `1m` ago from 20 May 14:00 Paris
 * is 20 April 14:00 Paris, whatever the offset was in April.
 *
 * Wall-clock values are carried as "naive" milliseconds: the wall clock read as if it were UTC.
 * That keeps calendar arithmetic on `Date.UTC` and leaves the zone database to `Intl`.
 */
import type { ClosedPnl, PeriodKey, PeriodUnit, PnlBucket, Tz } from '@/gateway/types.gen';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const DEFAULT_TZ: Tz = 'Europe/Paris';

const formatters = new Map<Tz, Intl.DateTimeFormat>();

function formatter(tz: Tz): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Offset of the zone at an instant, in ms (local wall clock minus UTC). */
export function tzOffsetMs(tz: Tz, ms: number): number {
  if (tz === 'UTC') {
    return 0;
  }
  const sec = Math.floor(ms / 1000) * 1000;
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(new Date(sec))) {
    if (part.type !== 'literal') {
      p[part.type] = Number(part.value);
    }
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return wall - sec;
}

/** Wall clock of an instant, as naive milliseconds. */
export function toLocal(tz: Tz, ms: number): number {
  return ms + tzOffsetMs(tz, ms);
}

/**
 * Instant of a local wall-clock time. An ambiguous time (clocks going back) resolves to its first
 * occurrence; a time that does not exist (clocks going forward) is moved ahead to the first valid
 * instant.
 */
export function fromLocal(tz: Tz, naiveMs: number): number {
  if (tz === 'UTC') {
    return naiveMs;
  }
  let n = naiveMs;
  for (let attempt = 0; attempt < 4; attempt++) {
    const offsets = new Set([tzOffsetMs(tz, n - DAY_MS), tzOffsetMs(tz, n + DAY_MS)]);
    const valid: number[] = [];
    for (const o of offsets) {
      const t = n - o;
      if (t + tzOffsetMs(tz, t) === n) {
        valid.push(t);
      }
    }
    if (valid.length > 0) {
      return Math.min(...valid);
    }
    n += HOUR_MS;
  }
  return naiveMs;
}

interface Ymd {
  y: number;
  m: number; // 1..12
  d: number; // 1..31
}

function ymd(naiveMs: number): Ymd {
  const dt = new Date(naiveMs);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Time of day (ms since local midnight) of a naive timestamp. */
function timeOfDay(naiveMs: number): number {
  return ((naiveMs % DAY_MS) + DAY_MS) % DAY_MS;
}

/** chrono's `checked_add_months`: the day is clamped to the length of the target month. */
function addMonths(naiveMs: number, months: number): number {
  const { y, m, d } = ymd(naiveMs);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (((total % 12) + 12) % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return Date.UTC(ny, nm - 1, nd) + timeOfDay(naiveMs);
}

function midnight(tz: Tz, v: Ymd): number {
  return fromLocal(tz, Date.UTC(v.y, v.m - 1, v.d));
}

/**
 * Lower bound (ms, inclusive) of a period: a trade belongs to it when `close_ms >= cutoff`.
 * `all` returns 0.
 */
export function periodCutoffMs(key: PeriodKey, nowMs: number, tz: Tz = DEFAULT_TZ): number {
  const local = toLocal(tz, nowMs);
  const monthsBack = (n: number) => fromLocal(tz, addMonths(local, -n));
  const date = ymd(local);
  switch (key) {
    case '24h':
      return nowMs - DAY_MS;
    case '48h':
      return nowMs - 2 * DAY_MS;
    case '7d':
      return nowMs - 7 * DAY_MS;
    case '14d':
      return nowMs - 14 * DAY_MS;
    case '30d':
      return nowMs - 30 * DAY_MS;
    case 'today':
      return midnight(tz, date);
    case '1m':
      return monthsBack(1);
    case '2m':
      return monthsBack(2);
    case '3m':
      return monthsBack(3);
    case '6m':
      return monthsBack(6);
    case '1y':
      return monthsBack(12);
    case 'mtd':
      return midnight(tz, { ...date, d: 1 });
    case 'ytd':
      return midnight(tz, { y: date.y, m: 1, d: 1 });
    case 'all':
      return 0;
  }
}

/** Start (ms) of the calendar bucket containing `tsMs`. */
export function bucketStartMs(unit: PeriodUnit, tz: Tz, tsMs: number): number {
  const local = toLocal(tz, tsMs);
  const date = ymd(local);
  switch (unit) {
    case 'day':
      return midnight(tz, date);
    case 'week': {
      const dayStart = Date.UTC(date.y, date.m - 1, date.d);
      const sinceMonday = (new Date(dayStart).getUTCDay() + 6) % 7;
      return midnight(tz, ymd(dayStart - sinceMonday * DAY_MS));
    }
    case 'month':
      return midnight(tz, { ...date, d: 1 });
  }
}

/** Start (ms) of the bucket that follows the one starting at `startMs`. */
export function nextBucketStartMs(unit: PeriodUnit, tz: Tz, startMs: number): number {
  const date = ymd(toLocal(tz, startMs));
  const dayStart = Date.UTC(date.y, date.m - 1, date.d);
  switch (unit) {
    case 'day':
      return midnight(tz, ymd(dayStart + DAY_MS));
    case 'week':
      return midnight(tz, ymd(dayStart + 7 * DAY_MS));
    case 'month':
      return midnight(tz, ymd(addMonths(dayStart, 1)));
  }
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Label of a bucket in its local zone: `YYYY-MM-DD` for days and weeks, `YYYY-MM` for months. */
export function bucketLabel(unit: PeriodUnit, tz: Tz, startMs: number): string {
  const { y, m, d } = ymd(toLocal(tz, startMs));
  return unit === 'month' ? `${pad(y, 4)}-${pad(m, 2)}` : `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/**
 * The last `n` buckets ending with the one that contains `nowMs`, oldest first, empty buckets
 * included with zero profit. Trades are bucketed by close time. One currency only: the caller must
 * not mix stake currencies or live and dry bots.
 */
export function pnlPeriods(
  trades: readonly ClosedPnl[],
  unit: PeriodUnit,
  tz: Tz,
  nowMs: number,
  n: number,
): PnlBucket[] {
  const starts: number[] = [];
  let cur = bucketStartMs(unit, tz, nowMs);
  for (let i = 0; i < n; i++) {
    starts.push(cur);
    cur = bucketStartMs(unit, tz, cur - 1);
  }
  starts.reverse();
  return starts.map((startMs) => {
    const endMs = nextBucketStartMs(unit, tz, startMs);
    const b: PnlBucket = {
      start_ms: startMs,
      end_ms: endMs,
      label: bucketLabel(unit, tz, startMs),
      profit_abs: 0,
      trades: 0,
      wins: 0,
      losses: 0,
    };
    for (const t of trades) {
      if (t.ts_ms >= startMs && t.ts_ms < endMs) {
        b.profit_abs += t.profit_abs;
        b.trades += 1;
        if (t.profit_abs > 0) b.wins += 1;
        else if (t.profit_abs < 0) b.losses += 1;
      }
    }
    return b;
  });
}

/** Sum of the profits closed at or after `cutoffMs`. */
export function profitSince(trades: readonly ClosedPnl[], cutoffMs: number): number {
  return trades.reduce((acc, t) => (t.ts_ms >= cutoffMs ? acc + t.profit_abs : acc), 0);
}

/**
 * Realized profit of the calendar day of `tz`: the trades closed at or after the local midnight,
 * not those of the last 24 hours. The day is 23 or 25 hours long around a daylight-saving change.
 */
export function realizedDay(
  trades: readonly ClosedPnl[],
  nowMs: number,
  tz: Tz = DEFAULT_TZ,
): number {
  return profitSince(trades, periodCutoffMs('today', nowMs, tz));
}
