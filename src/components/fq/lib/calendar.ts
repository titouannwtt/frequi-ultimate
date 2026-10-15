/**
 * Month grid of the P&L calendar (02 section 3.1, "Calendrier"). Days are the buckets of the
 * source, cut at local midnight of the chosen zone (Europe/Paris by default), so a day around a
 * daylight-saving change is 23 or 25 hours long and is shown as such; the grid never divides a
 * month into 24 hour slices itself.
 */
import { bucketLabel, bucketStartMs, nextBucketStartMs, toLocal } from '@/datasource/calc/periods';
import type { PnlBucket, Tz } from '@/gateway/types.gen';

export type MonthKey = string; // YYYY-MM

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export function parseMonth(m: MonthKey): { y: number; m: number } {
  const [y, mm] = m.split('-').map(Number);
  return { y: y as number, m: mm as number };
}

export function monthKey(y: number, m: number): MonthKey {
  const norm = y * 12 + (m - 1);
  const ny = Math.floor(norm / 12);
  const nm = (((norm % 12) + 12) % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}`;
}

/** Month containing an instant, in the zone. */
export function monthOf(ms: number, tz: Tz): MonthKey {
  return bucketLabel('month', tz, bucketStartMs('month', tz, ms));
}

export function shiftMonth(m: MonthKey, delta: number): MonthKey {
  const { y, m: mm } = parseMonth(m);
  return monthKey(y, mm + delta);
}

export interface CalCell {
  /** `YYYY-MM-DD`; null for the padding before the 1st and after the last day. */
  label: string | null;
  day: number | null;
  bucket: PnlBucket | null;
  /** After today: no figure, faded. */
  future: boolean;
  today: boolean;
  /** Length of the day in hours when it is not 24 (daylight-saving change), else null. */
  dstHours: number | null;
  /** No bucket came back for a past day: unknown, not zero. */
  missing: boolean;
}

export interface MonthGrid {
  month: MonthKey;
  cells: CalCell[];
  weeks: number;
  /** Sum of the days with a figure. */
  total: number;
  trades: number;
  winningDays: number;
  losingDays: number;
  best: PnlBucket | null;
  worst: PnlBucket | null;
  /** Largest absolute daily result, the scale of the tints. */
  maxAbs: number;
  monthStartMs: number;
  monthEndMs: number;
}

/** Number of day buckets to ask for so that they reach back to the 1st of `month`. */
export function bucketsNeeded(month: MonthKey, nowMs: number, tz: Tz, cap = 800): number {
  const { y, m } = parseMonth(month);
  const first = Date.UTC(y, m - 1, 1);
  const local = toLocal(tz, nowMs);
  const days = Math.floor((local - first) / DAY_MS) + 1;
  return Math.max(1, Math.min(cap, days));
}

export function monthGrid(
  month: MonthKey,
  buckets: readonly PnlBucket[],
  nowMs: number,
  tz: Tz,
): MonthGrid {
  const { y, m } = parseMonth(month);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const byLabel = new Map(buckets.map((b) => [b.label, b]));
  const todayLabel = bucketLabel('day', tz, bucketStartMs('day', tz, nowMs));
  const cells: CalCell[] = [];
  for (let i = 0; i < lead; i++) {
    cells.push({
      label: null,
      day: null,
      bucket: null,
      future: false,
      today: false,
      dstHours: null,
      missing: false,
    });
  }
  let total = 0;
  let trades = 0;
  let winningDays = 0;
  let losingDays = 0;
  let best: PnlBucket | null = null;
  let worst: PnlBucket | null = null;
  let maxAbs = 0;
  for (let d = 1; d <= dim; d++) {
    const label = `${monthKey(y, m)}-${String(d).padStart(2, '0')}`;
    const bucket = byLabel.get(label) ?? null;
    const future = label > todayLabel;
    const hours = bucket ? (bucket.end_ms - bucket.start_ms) / HOUR_MS : null;
    cells.push({
      label,
      day: d,
      bucket,
      future,
      today: label === todayLabel,
      dstHours: hours !== null && Math.abs(hours - 24) > 1e-6 ? hours : null,
      missing: !future && bucket === null,
    });
    if (bucket && !future) {
      total += bucket.profit_abs;
      trades += bucket.trades;
      if (bucket.profit_abs > 0) winningDays += 1;
      else if (bucket.profit_abs < 0) losingDays += 1;
      maxAbs = Math.max(maxAbs, Math.abs(bucket.profit_abs));
      if (!best || bucket.profit_abs > best.profit_abs) best = bucket;
      if (!worst || bucket.profit_abs < worst.profit_abs) worst = bucket;
    }
  }
  while (cells.length % 7 !== 0) {
    cells.push({
      label: null,
      day: null,
      bucket: null,
      future: false,
      today: false,
      dstHours: null,
      missing: false,
    });
  }
  const monthStartMs = bucketStartMs('month', tz, Date.UTC(y, m - 1, 15));
  return {
    month,
    cells,
    weeks: cells.length / 7,
    total,
    trades,
    winningDays,
    losingDays,
    best,
    worst,
    maxAbs,
    monthStartMs,
    monthEndMs: nextBucketStartMs('month', tz, monthStartMs),
  };
}

/** Share of the tint (0 to 28 %) of a day: proportional to the biggest day of the month. */
export function dayTint(profit: number, maxAbs: number): number {
  if (!(maxAbs > 0) || profit === 0) return 0;
  return Math.round(Math.min(1, Math.abs(profit) / maxAbs) * 28);
}
