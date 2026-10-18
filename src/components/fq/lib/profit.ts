/**
 * The "Profit" block of the Fleet: the periods offered, the range of dates, and the two curves
 * ("realised" and "with the open positions") read as the profit gained since the start of the
 * period. Pure: the component only draws them, the tests pin the rules down.
 *
 * Both curves come from the source as cumulative profit since the beginning of the history; they
 * are shifted so that they start at 0 where the period starts. The curve with the open positions
 * only exists since the gateway samples the profit (`profit_history`): when it starts after the
 * period, it begins where its first point is, on the realised curve, and `trackedSince` says so.
 */
import type { EChartsOption } from 'echarts';

import type { ChartTokens } from '@/components/ds/lib/chartTheme';
import { bucketStartMs, fromLocal, nextBucketStartMs, toLocal } from '@/datasource/calc/periods';
import type { EquitySeries } from '@/datasource/types';
import type { Tz } from '@/gateway/types.gen';

import { periodStartMs, tickDecimals, type EquityPeriod, type Point } from './equity';

export type ProfitPeriod = EquityPeriod | 'custom';

/** The periods of the selector, shortest first; "Dates…" is a seventh choice beside them. */
export const PROFIT_PERIODS: readonly EquityPeriod[] = ['24h', '7d', '30d', '90d', '1y', 'all'];

/** Range of dates in ms; a missing bound means "no limit". `toMs` is included. */
export interface ProfitRange {
  fromMs?: number;
  toMs?: number;
}

/** A custom range picked by the user: both bounds known. */
export interface CustomRange {
  fromMs: number;
  toMs: number;
}

/** The range a period stands for, `now` being the instant the relative periods are cut from. */
export function profitRange(
  period: ProfitPeriod,
  custom: CustomRange | null,
  nowMs: number,
  tz: Tz,
): ProfitRange {
  if (period === 'custom') return custom ? { fromMs: custom.fromMs, toMs: custom.toMs } : {};
  const fromMs = periodStartMs(period, nowMs, tz);
  return fromMs === undefined ? {} : { fromMs };
}

/**
 * The picker returns calendar days (in the browser): they are read as days of the user's time zone,
 * from the start of the first to the last millisecond of the last. A single day is a range of one
 * day; bounds given the wrong way round are put right.
 */
export function customRange(start: Date, end: Date | null, tz: Tz): CustomRange {
  const dayStart = (d: Date) =>
    bucketStartMs('day', tz, fromLocal(tz, Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
  const a = dayStart(start);
  const b = dayStart(end ?? start);
  const first = Math.min(a, b);
  const last = Math.max(a, b);
  return { fromMs: first, toMs: nextBucketStartMs('day', tz, last) - 1 };
}

/** The picker's value for a range (browser days, the same calendar days), to reopen it on them. */
export function rangeDates(range: CustomRange | null, tz: Tz): Date[] | null {
  if (!range) return null;
  const day = (ms: number) => {
    const d = new Date(toLocal(tz, ms));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  return [day(range.fromMs), day(range.toMs)];
}

/** Value of a curve at `ts`, carried forward from its last point; null before the first. */
export function valueAt(points: readonly Point[], ts: number): number | null {
  let lo = 0;
  let hi = points.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]![0] <= ts) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found < 0 ? null : points[found]![1];
}

export interface ProfitCurves {
  /** Profit of the closed trades since the start of the period, from 0. */
  realized: Point[];
  /** The same with the open positions; empty when the source has no sampled history. */
  withOpen: Point[];
  /** Profit of the period at its end, the open positions included when they are tracked. */
  profit: number | null;
  /** Profit of the closed trades alone at the end of the period. */
  realizedProfit: number | null;
  /** When the open positions begin to be tracked, if that is after the start of the period. */
  trackedSince: number | null;
}

/** Tracking that starts less than this after the period began is not worth a note. */
const TRACKED_TOLERANCE_MS = 3_600_000;

/**
 * The two curves of a period, both starting at 0.
 *
 * @param fromMs start of the period, undefined for the whole history
 * @param endMs the end of the drawn range (the realised curve is extended to it: no trade between
 *   the last one and the end means a flat profit, not a missing one)
 */
export function buildProfitCurves(
  realized: EquitySeries | null,
  withOpen: EquitySeries | null,
  fromMs: number | undefined,
  endMs: number,
): ProfitCurves {
  const rawR = realized?.points ?? [];
  const rBase = realized?.base ?? 0;
  const r: Point[] = rawR.map(([t, v]) => [t, v - rBase]);
  // Trades before the period exist: the curve is 0 from the very start of the period
  if (fromMs !== undefined && realized?.base != null) {
    if (r.length === 0 || r[0]![0] > fromMs) r.unshift([fromMs, 0]);
  }
  if (r.length > 0 && r[r.length - 1]![0] < endMs) r.push([endMs, r[r.length - 1]![1]]);

  const rawO = withOpen?.points ?? [];
  let o: Point[] = [];
  let trackedSince: number | null = null;
  if (rawO.length > 0) {
    const [t0, v0] = rawO[0]!;
    if (withOpen?.base != null) {
      o = rawO.map(([t, v]) => [t, v - withOpen.base!]);
      if (fromMs !== undefined && t0 > fromMs) o.unshift([fromMs, 0]);
    } else {
      // Starts inside the period: it begins on the realised curve, where its first point is
      const shift = v0 - (valueAt(r, t0) ?? 0);
      o = rawO.map(([t, v]) => [t, v - shift]);
      const periodStart = fromMs ?? r[0]?.[0] ?? t0;
      if (t0 > periodStart + TRACKED_TOLERANCE_MS) trackedSince = t0;
    }
  }

  const lastOf = (pts: Point[]) => (pts.length > 0 ? pts[pts.length - 1]![1] : null);
  return {
    realized: r,
    withOpen: o,
    profit: lastOf(o) ?? lastOf(r),
    realizedProfit: lastOf(r),
    trackedSince,
  };
}

export interface ProfitOptionInput {
  curves: ProfitCurves;
  tokens: ChartTokens;
  fmtValue: (v: number, decimals?: number) => string;
  fmtDate: (ts: number) => string;
  /** Date and time for the tooltip. */
  fmtFull: (ts: number) => string;
  labels: { realized: string; withOpen: string; gap: string };
}

/** Two lines on one grid and a tooltip that reads both at the same instant. */
export function buildProfitOption(input: ProfitOptionInput): EChartsOption {
  const { curves, tokens: c, fmtValue, fmtDate, fmtFull, labels } = input;
  const all = [...curves.realized, ...curves.withOpen].map((p) => p[1]);
  const decimals = tickDecimals(all.length ? Math.max(...all) - Math.min(...all) : 0);
  const hasOpen = curves.withOpen.length > 0;
  const sign = (v: number) => (v > 0 ? '+' : '') + fmtValue(v);
  const colorOf = (v: number | null) => (v === null || v === 0 ? c.fg2 : v > 0 ? c.profit : c.loss);
  const row = (name: string, color: string, v: number | null) =>
    `<div style="display:flex;justify-content:space-between;gap:16px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>${name}</span><b style="color:${colorOf(v)}">${v === null ? '-' : sign(v)}</b></div>`;
  return {
    grid: { left: 8, right: 12, top: 12, bottom: 22, containLabel: true },
    xAxis: {
      type: 'time',
      axisLabel: { color: c.fg3, fontSize: 11, formatter: (v: number) => fmtDate(v) },
      axisLine: { lineStyle: { color: c.line2 } },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitNumber: 3,
      axisLabel: { color: c.fg3, fontSize: 11, formatter: (v: number) => fmtValue(v, decimals) },
      splitLine: { lineStyle: { color: c.line } },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: c.fg3 } },
      formatter: (raw) => {
        const params = Array.isArray(raw) ? raw : [raw];
        const ts = Number((params[0] as { axisValue?: number | string } | undefined)?.axisValue);
        if (!Number.isFinite(ts)) return '';
        const r = valueAt(curves.realized, ts);
        const o = hasOpen ? valueAt(curves.withOpen, ts) : null;
        const gap = r !== null && o !== null ? o - r : null;
        return [
          `<div style="margin-bottom:4px;color:${c.fg3}">${fmtFull(ts)}</div>`,
          row(labels.realized, c.accent, r),
          ...(hasOpen ? [row(labels.withOpen, c.info, o), row(labels.gap, c.fg3, gap)] : []),
        ].join('');
      },
    },
    series: [
      {
        id: 'realized',
        name: labels.realized,
        type: 'line',
        // Cumulated closed profit changes when a trade closes, not between two trades
        step: 'end',
        data: curves.realized,
        showSymbol: false,
        lineStyle: { width: 1.8, color: c.accent },
        areaStyle: { color: c.accent, opacity: 0.1 },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: c.line2, type: 'dashed' },
          data: [{ yAxis: 0 }],
        },
      },
      {
        id: 'with_open',
        name: labels.withOpen,
        type: 'line',
        data: curves.withOpen,
        showSymbol: false,
        // Amber and dashed against the blue of the first curve: the two stay apart in both themes
        // (the blue and the teal of the info token ran together on the light one)
        lineStyle: { width: 1.6, color: c.warn, type: 'dashed' },
      },
    ],
  };
}
