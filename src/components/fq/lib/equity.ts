/**
 * Equity curve helpers (02 section 12). The curve is the cumulative realised profit, with or
 * without the open positions ("with_open", the open-inclusive definition); the drawdown below it is
 * the distance to the running high-water mark, in absolute terms (USDC), never alone as a percent.
 */
import type { EChartsOption } from 'echarts';

import { periodCutoffMs } from '@/datasource/calc/periods';
import type { PeriodKey, Tz } from '@/gateway/types.gen';
import type { ChartTokens } from '@/components/ds/lib/chartTheme';

export type EquityPeriod = '24h' | '7d' | '30d' | 'all';
export type EquityDefinition = 'realized' | 'with_open';

export const EQUITY_PERIODS: EquityPeriod[] = ['24h', '7d', '30d', 'all'];

/** Start of a period, or undefined for the whole history. */
export function periodStartMs(period: EquityPeriod, nowMs: number, tz: Tz): number | undefined {
  if (period === 'all') return undefined;
  return periodCutoffMs(period as PeriodKey, nowMs, tz);
}

export type Point = [number, number];

/** Last value minus first value; null with fewer than two points. */
export function variation(points: readonly Point[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1]![1] - points[0]![1];
}

/** Distance below the running high-water mark at each point (<= 0). */
export function drawdownSeries(points: readonly Point[]): Point[] {
  let peak = -Infinity;
  return points.map(([ts, v]) => {
    peak = Math.max(peak, v);
    return [ts, v - peak] as Point;
  });
}

/** Deepest decline of a series, absolute (>= 0). */
export function maxDrawdownAbs(points: readonly Point[]): number {
  let worst = 0;
  for (const [, d] of drawdownSeries(points)) worst = Math.min(worst, d);
  return worst === 0 ? 0 : -worst;
}

/**
 * At most `max` points, keeping the first, the last and the extremes of each slice, so a spike or
 * a trough is never smoothed away by the reduction.
 */
export function downsample(points: readonly Point[], max = 600): Point[] {
  if (points.length <= max || max < 4) return points.slice();
  const slices = Math.floor((max - 2) / 2);
  const size = (points.length - 2) / slices;
  const out: Point[] = [points[0]!];
  for (let i = 0; i < slices; i++) {
    const from = 1 + Math.floor(i * size);
    const to = 1 + Math.floor((i + 1) * size);
    let lo = points[from]!;
    let hi = points[from]!;
    for (let k = from; k < to && k < points.length - 1; k++) {
      const p = points[k]!;
      if (p[1] < lo[1]) lo = p;
      if (p[1] > hi[1]) hi = p;
    }
    if (lo[0] <= hi[0]) out.push(lo, hi);
    else out.push(hi, lo);
  }
  out.push(points[points.length - 1]!);
  // Dedupe consecutive identical timestamps (lo === hi)
  return out.filter((p, i) => i === 0 || p !== out[i - 1]);
}

export interface EquityOptionInput {
  points: readonly Point[];
  tokens: ChartTokens;
  /**
   * Formats the axis values (numbers) and the dates; the caller owns the language. `decimals` is
   * given for the axis labels: every tick of an axis has the same, so "5 000" and "-300,00" never
   * share an axis; without it the value is formatted for a tooltip.
   */
  fmtValue: (v: number, decimals?: number) => string;
  fmtDate: (ts: number) => string;
  /** Labels of the two series, already translated. */
  labels: { equity: string; drawdown: string };
  /** Draw the drawdown grid under the curve (default); the Fleet shows the curve alone. */
  withDrawdown?: boolean;
}

/** Decimals of the ticks of an axis spanning `span`: whole numbers from 20 up, never mixed. */
export function tickDecimals(span: number): number {
  if (!Number.isFinite(span) || span >= 20) return 0;
  return span >= 2 ? 1 : 2;
}

/**
 * One ECharts instance, two grids: the curve above, the drawdown (absolute) below. Without the
 * drawdown (`withDrawdown: false`) the curve takes the whole panel and carries the dates.
 */
export function buildEquityOption(input: EquityOptionInput): EChartsOption {
  const { tokens: c, fmtValue, fmtDate } = input;
  if (input.withDrawdown === false) return buildCurveOption(input);
  const pts = downsample(input.points);
  const dd = drawdownSeries(pts);
  const values = pts.map((p) => p[1]);
  const mainDecimals = tickDecimals(values.length ? Math.max(...values) - Math.min(...values) : 0);
  const ddDecimals = tickDecimals(dd.length ? -Math.min(...dd.map((p) => p[1])) : 0);
  return {
    grid: [
      { left: 8, right: 12, top: 10, bottom: '36%', containLabel: true },
      { left: 8, right: 12, top: '73%', bottom: 22, containLabel: true },
    ],
    xAxis: [
      { type: 'time', gridIndex: 0, show: false },
      {
        type: 'time',
        gridIndex: 1,
        axisLabel: { color: c.fg3, fontSize: 11, formatter: (v: number) => fmtDate(v) },
        axisLine: { lineStyle: { color: c.line2 } },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        type: 'value',
        scale: true,
        gridIndex: 0,
        splitNumber: 3,
        axisLabel: {
          color: c.fg3,
          fontSize: 11,
          formatter: (v: number) => fmtValue(v, mainDecimals),
        },
        splitLine: { lineStyle: { color: c.line } },
      },
      {
        type: 'value',
        gridIndex: 1,
        splitNumber: 1,
        max: 0,
        // The lower grid has its own scale (the distance to the high-water mark, 0 and below): its
        // ticks sit under the curve's and read as one axis ("5 600, 5 200, -300") unless named
        name: input.labels.drawdown,
        nameLocation: 'end',
        nameGap: 4,
        nameTextStyle: { color: c.fg3, fontSize: 10, align: 'left' },
        axisLabel: {
          color: c.fg3,
          fontSize: 11,
          formatter: (v: number) => fmtValue(v, ddDecimals),
        },
        splitLine: { show: false },
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: c.fg3 } },
      valueFormatter: (v) => (typeof v === 'number' ? fmtValue(v) : String(v)),
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    series: [
      {
        id: 'equity',
        name: input.labels.equity,
        type: 'line',
        data: pts,
        showSymbol: false,
        xAxisIndex: 0,
        yAxisIndex: 0,
        lineStyle: { width: 1.6, color: c.accent },
        areaStyle: { color: c.accent, opacity: 0.12 },
      },
      {
        id: 'drawdown',
        name: input.labels.drawdown,
        type: 'line',
        data: dd,
        showSymbol: false,
        xAxisIndex: 1,
        yAxisIndex: 1,
        lineStyle: { width: 1, color: c.loss },
        areaStyle: { color: c.loss, opacity: 0.15 },
      },
    ],
  };
}

/** The curve alone: one grid, the dates on the x axis. */
function buildCurveOption(input: EquityOptionInput): EChartsOption {
  const { tokens: c, fmtValue, fmtDate } = input;
  const pts = downsample(input.points);
  const values = pts.map((p) => p[1]);
  const decimals = tickDecimals(values.length ? Math.max(...values) - Math.min(...values) : 0);
  return {
    grid: { left: 8, right: 12, top: 10, bottom: 22, containLabel: true },
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
      axisLabel: {
        color: c.fg3,
        fontSize: 11,
        formatter: (v: number) => fmtValue(v, decimals),
      },
      splitLine: { lineStyle: { color: c.line } },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: c.fg3 } },
      valueFormatter: (v) => (typeof v === 'number' ? fmtValue(v) : String(v)),
    },
    series: [
      {
        id: 'equity',
        name: input.labels.equity,
        type: 'line',
        data: pts,
        showSymbol: false,
        lineStyle: { width: 1.6, color: c.accent },
        areaStyle: { color: c.accent, opacity: 0.12 },
      },
    ],
  };
}
