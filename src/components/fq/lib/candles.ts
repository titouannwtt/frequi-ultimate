/**
 * Candle chart model (02 section 3.3 and 5.2). A pure builder from the data of `pair_candles` and
 * `plot_config` to an ECharts option, so the legend, the delta merge and the overlays are tested
 * without a canvas. The transforms that were sound in the legacy chart (Heikin-Ashi, one series per
 * indicator driven by the `encode` of a shared dataset) are reused from `@/utils/charts`.
 *
 * Overlays are read-only drawings on top of the candles: average entry, take profit, safety orders,
 * fills and liquidation. Nothing here talks to a bot.
 */
import type { EChartsOption, SeriesOption } from 'echarts';

import type { FqChartTokens } from './chartTokens';
import type { LadderOrder } from '@/components/ds';
import type { Position, Side } from '@/gateway/types.gen';
import type { PairHistory, PlotConfig } from '@/types';
import { generateCandleSeries } from '@/utils/charts/candleChartSeries';
import { heikinAshiDataset } from '@/utils/charts/heikinAshiDataset';

export const DATE_COL = '__date_ts';

/** Columns and rows of a candle response, with a numeric timestamp column guaranteed. */
export interface CandleSet {
  columns: string[];
  rows: Array<Array<number | null>>;
  timeframeMs: number;
}

/**
 * Make sure the set has the numeric `__date_ts` column the chart reads. The API gives it; when only
 * an ISO `date` column exists it is parsed (UTC), never read in the browser's zone.
 */
export function toCandleSet(h: Pick<PairHistory, 'columns' | 'data' | 'timeframe_ms'>): CandleSet {
  // A bot that answers with something else than candles (an error object, an empty body) gives an
  // empty set: the chart says "no candle" instead of failing on `undefined.slice`
  if (!Array.isArray(h?.columns) || !Array.isArray(h?.data)) {
    return { columns: [], rows: [], timeframeMs: Number(h?.timeframe_ms) || 0 };
  }
  const columns = h.columns.slice();
  const rows = h.data.map((r) => r.slice()) as Array<Array<number | null>>;
  if (!columns.includes(DATE_COL)) {
    const di = columns.indexOf('date');
    if (di < 0) return { columns, rows: [], timeframeMs: h.timeframe_ms };
    columns.push(DATE_COL);
    for (const r of rows) {
      const v = r[di] as unknown;
      const ts = typeof v === 'number' ? v : Date.parse(String(v));
      r.push(Number.isFinite(ts) ? ts : null);
    }
  }
  return { columns, rows, timeframeMs: h.timeframe_ms };
}

/**
 * Merge a tail of recent candles into a set, by timestamp: a candle with the same timestamp is
 * replaced (the open candle moves), a newer one is appended, an older one is ignored. Returns null
 * when the columns differ: the caller must then reload the whole history.
 */
export function mergeTail(base: CandleSet, tail: CandleSet): CandleSet | null {
  if (base.columns.length !== tail.columns.length) return null;
  if (base.columns.some((c, i) => c !== tail.columns[i])) return null;
  const di = base.columns.indexOf(DATE_COL);
  if (di < 0) return null;
  const rows = base.rows.slice();
  let lastTs = rows.length > 0 ? (rows[rows.length - 1]![di] as number) : -Infinity;
  for (const r of tail.rows) {
    const ts = r[di] as number | null;
    if (ts === null || !Number.isFinite(ts)) continue;
    if (ts === lastTs) {
      rows[rows.length - 1] = r;
    } else if (ts > lastTs) {
      rows.push(r);
      lastTs = ts;
    }
  }
  return { columns: base.columns, rows, timeframeMs: base.timeframeMs };
}

export interface CandleLegend {
  ts: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  /** Value of each plotted indicator at that candle. */
  values: Record<string, number | null>;
}

/** Index of the candle at or just before `ts` (rows are sorted by time); -1 before the first. */
export function indexAt(set: CandleSet, ts: number): number {
  const di = set.columns.indexOf(DATE_COL);
  if (di < 0 || set.rows.length === 0) return -1;
  let lo = 0;
  let hi = set.rows.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = set.rows[mid]![di] as number;
    if (v <= ts) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Legend values of one candle (the last one when `idx` is omitted). */
export function legendAt(set: CandleSet, idx?: number, names: string[] = []): CandleLegend | null {
  if (set.rows.length === 0) return null;
  const i =
    idx === undefined ? set.rows.length - 1 : Math.min(set.rows.length - 1, Math.max(0, idx));
  const row = set.rows[i]!;
  const col = (n: string) => {
    const ci = set.columns.indexOf(n);
    return ci < 0 ? null : (row[ci] ?? null);
  };
  const values: Record<string, number | null> = {};
  for (const n of names) values[n] = col(n);
  return {
    ts: row[set.columns.indexOf(DATE_COL)] as number,
    open: col('open'),
    high: col('high'),
    low: col('low'),
    close: col('close'),
    volume: col('volume'),
    values,
  };
}

// ---- overlays ----

export type SoState = 'filled' | 'next' | 'pending';

export interface SafetyLevel {
  price: number;
  state: SoState;
  label: string;
}

export interface FillMark {
  ts: number;
  price: number;
  kind: 'entry' | 'dca' | 'exit';
  /** An exit that made money, for the colour of the marker. */
  win?: boolean;
  side: Side;
  label: string;
}

export interface Overlays {
  average?: number | null;
  tp?: number | null;
  liquidation?: number | null;
  safetyOrders?: SafetyLevel[];
  fills?: FillMark[];
}

export interface OverlayToggles {
  average: boolean;
  tp: boolean;
  safetyOrders: boolean;
  fills: boolean;
  liquidation: boolean;
}

export const ALL_OVERLAYS: OverlayToggles = {
  average: true,
  tp: true,
  safetyOrders: true,
  fills: true,
  liquidation: true,
};

export interface OverlayLabels {
  average: string;
  tp: string;
  liquidation: string;
}

interface LevelLine {
  id: string;
  price: number;
  label: string;
  color: string;
  dash: 'solid' | 'dashed' | 'dotted';
  width: number;
  opacity: number;
}

/** The horizontal levels to draw, in drawing order. Levels that are not finite are dropped. */
export function levelLines(
  o: Overlays,
  on: OverlayToggles,
  tokens: FqChartTokens,
  labels: OverlayLabels,
): LevelLine[] {
  const out: LevelLine[] = [];
  const add = (l: LevelLine) => {
    if (Number.isFinite(l.price) && l.price > 0) out.push(l);
  };
  if (on.safetyOrders) {
    for (const so of o.safetyOrders ?? []) {
      add({
        id: `so:${so.label}`,
        price: so.price,
        label: so.label,
        color: so.state === 'next' ? tokens.warn : tokens.fg3,
        dash: so.state === 'filled' ? 'solid' : so.state === 'next' ? 'dashed' : 'dotted',
        width: so.state === 'next' ? 1.4 : 1,
        opacity: so.state === 'filled' ? 0.55 : 0.9,
      });
    }
  }
  if (on.average && o.average != null) {
    add({
      id: 'avg',
      price: o.average,
      label: labels.average,
      color: tokens.accent,
      dash: 'solid',
      width: 1.5,
      opacity: 1,
    });
  }
  if (on.tp && o.tp != null) {
    add({
      id: 'tp',
      price: o.tp,
      label: labels.tp,
      color: tokens.profit,
      dash: 'dashed',
      width: 1.4,
      opacity: 1,
    });
  }
  if (on.liquidation && o.liquidation != null) {
    add({
      id: 'liq',
      price: o.liquidation,
      label: labels.liquidation,
      color: tokens.crit,
      dash: 'solid',
      width: 1.6,
      opacity: 1,
    });
  }
  return out;
}

// ---- option ----

export interface CandleOptionInput {
  set: CandleSet;
  heikinAshi: boolean;
  plotConfig: PlotConfig;
  /** Add an RSI sub-chart when the column exists and the plot config has no sub-chart for it. */
  rsi: boolean;
  overlays: Overlays;
  toggles: OverlayToggles;
  tokens: FqChartTokens;
  labels: OverlayLabels & {
    candles: string;
    volume: string;
    entry: string;
    dca: string;
    exit: string;
  };
  fmtPrice: (v: number) => string;
  /** Candles shown at first (the end of the zoom window). */
  visibleCandles: number;
  /**
   * First render of this pair: the zoom window is set. Later updates leave it out, so the user's
   * zoom survives a new candle (the update merges the zoom component instead of replacing it).
   */
  initialZoom: boolean;
  labelSide: 'left' | 'right';
  /** Levels farther than this share of the last close do not stretch the price axis. */
  axisReach?: number;
}

const SYM_TRIANGLE = 'path://M0,-8 L7,6 L-7,6 Z';

/** Names of the plotted indicator columns, main plot first then sub-charts. */
export function indicatorNames(plot: PlotConfig, withRsi: boolean, columns: string[]): string[] {
  const names: string[] = [];
  for (const k of Object.keys(plot.main_plot ?? {})) if (columns.includes(k)) names.push(k);
  for (const sp of Object.values(plot.subplots ?? {})) {
    for (const k of Object.keys(sp)) if (columns.includes(k) && !names.includes(k)) names.push(k);
  }
  if (withRsi && columns.includes('rsi') && !names.includes('rsi')) names.push('rsi');
  return names;
}

export function buildCandleOption(input: CandleOptionInput): EChartsOption {
  const { set, tokens: c } = input;
  const columns = set.columns.slice();
  const di = columns.indexOf(DATE_COL);
  const oi = columns.indexOf('open');
  const hi = columns.indexOf('high');
  const li = columns.indexOf('low');
  const ci = columns.indexOf('close');
  const vi = columns.indexOf('volume');
  const source = input.heikinAshi
    ? heikinAshiDataset(columns, set.rows as number[][])
    : (set.rows as Array<Array<number | null>>);

  // Sub-charts: the plot config ones, then RSI when asked and not already there
  const subplots: Array<{ name: string; series: Record<string, PlotConfig['main_plot'][string]> }> =
    Object.entries(input.plotConfig.subplots ?? {}).map(([name, series]) => ({ name, series }));
  const hasRsi = subplots.some((s) => 'rsi' in s.series);
  if (input.rsi && columns.includes('rsi') && !hasRsi) {
    subplots.push({ name: 'rsi', series: { rsi: { color: c.fg2, type: 'line' } as never } });
  }

  const SUB_H = 13;
  const VOL_H = 10;
  const GAP = 1.2;
  const top = 2;
  const bottomPad = 5;
  const hasVolume = vi >= 0;
  const subTotal = subplots.length * (SUB_H + GAP);
  const volTotal = hasVolume ? VOL_H + GAP : 0;
  const mainH = 100 - top - bottomPad - subTotal - volTotal;
  const grids: Array<Record<string, unknown>> = [
    {
      left: input.labelSide === 'left' ? 46 : 8,
      right: input.labelSide === 'right' ? 52 : 8,
      top: `${top}%`,
      height: `${mainH}%`,
    },
  ];
  let cursor = top + mainH + GAP;
  if (hasVolume) {
    grids.push({
      left: grids[0]!.left,
      right: grids[0]!.right,
      top: `${cursor}%`,
      height: `${VOL_H}%`,
    });
    cursor += VOL_H + GAP;
  }
  for (let i = 0; i < subplots.length; i++) {
    grids.push({
      left: grids[0]!.left,
      right: grids[0]!.right,
      top: `${cursor}%`,
      height: `${SUB_H}%`,
    });
    cursor += SUB_H + GAP;
  }

  const lastClose = (() => {
    for (let i = set.rows.length - 1; i >= 0; i--) {
      const v = set.rows[i]![ci];
      if (v != null) return v;
    }
    return null;
  })();
  const lines = levelLines(input.overlays, input.toggles, c, input.labels);
  const reach = input.axisReach ?? 0.25;
  const near = lines
    .map((l) => l.price)
    .filter((p) => lastClose !== null && Math.abs(p - lastClose) / lastClose <= reach);

  const nGrid = grids.length;
  const xAxes: unknown[] = [];
  const yAxes: unknown[] = [];
  for (let g = 0; g < nGrid; g++) {
    xAxes.push({
      type: 'time',
      gridIndex: g,
      min: 'dataMin',
      max: 'dataMax',
      axisLabel: { show: g === nGrid - 1, color: c.fg3, fontSize: 11 },
      axisLine: { onZero: false, lineStyle: { color: c.line2 } },
      axisTick: { show: false },
      splitLine: { show: g === 0, lineStyle: { color: c.line, type: 'dashed' } },
      axisPointer: { label: { show: false } },
    });
    yAxes.push(
      g === 0
        ? {
            scale: true,
            gridIndex: 0,
            position: input.labelSide,
            axisLine: { show: false },
            axisLabel: { color: c.fg3, fontSize: 11, formatter: (v: number) => input.fmtPrice(v) },
            splitLine: { lineStyle: { color: c.line, type: 'dashed' } },
            min: (v: { min: number }) => Math.min(v.min, ...near),
            max: (v: { max: number }) => Math.max(v.max, ...near),
          }
        : {
            scale: true,
            gridIndex: g,
            position: input.labelSide,
            splitNumber: 2,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { show: g > (hasVolume ? 1 : 0), color: c.fg3, fontSize: 11 },
            splitLine: { show: false },
          },
    );
  }

  const series: SeriesOption[] = [
    {
      id: 'candles',
      name: input.labels.candles,
      type: 'candlestick',
      xAxisIndex: 0,
      yAxisIndex: 0,
      barMaxWidth: 18,
      itemStyle: { color: c.profit, color0: c.loss, borderColor: c.profit, borderColor0: c.loss },
      encode: { x: di, y: [oi, ci, li, hi] },
      markLine: lines.length
        ? {
            silent: true,
            symbol: 'none',
            animation: false,
            data: lines.map((l) => ({
              yAxis: l.price,
              name: l.id,
              lineStyle: { color: l.color, type: l.dash, width: l.width, opacity: l.opacity },
              label: {
                show: true,
                position: 'insideEndTop',
                color: l.color,
                fontSize: 11,
                formatter: `${l.label} ${input.fmtPrice(l.price)}`,
              },
            })),
          }
        : undefined,
    } as SeriesOption,
  ];
  let g = 1;
  if (hasVolume) {
    series.push({
      id: 'volume',
      name: input.labels.volume,
      type: 'bar',
      xAxisIndex: 1,
      yAxisIndex: 1,
      large: true,
      itemStyle: {
        opacity: 0.35,
        color: (p: { data?: unknown }) => {
          const d = p.data as Array<number | null> | undefined;
          return d && d[ci] != null && d[oi] != null && (d[ci] as number) >= (d[oi] as number)
            ? c.profit
            : c.loss;
        },
      },
      encode: { x: di, y: vi },
    } as SeriesOption);
    g = 2;
  }
  // Main plot indicators on the price grid
  for (const [name, cfg] of Object.entries(input.plotConfig.main_plot ?? {})) {
    const idx = columns.indexOf(name);
    if (idx < 0) continue;
    series.push({
      id: `ind:${name}`,
      ...(generateCandleSeries(
        di,
        idx,
        name,
        { ...cfg, color: cfg.color ?? c.accent },
        0,
      ) as object),
    } as SeriesOption);
  }
  // Sub-charts
  subplots.forEach((sp, k) => {
    const gi = g + k;
    for (const [name, cfg] of Object.entries(sp.series)) {
      const idx = columns.indexOf(name);
      if (idx < 0) continue;
      series.push({
        id: `sub:${sp.name}:${name}`,
        ...(generateCandleSeries(
          di,
          idx,
          name,
          { ...cfg, color: cfg.color ?? c.fg2 },
          gi,
        ) as object),
      } as SeriesOption);
    }
  });

  // Fills
  if (input.toggles.fills && (input.overlays.fills?.length ?? 0) > 0) {
    series.push({
      id: 'fills',
      name: 'fills',
      type: 'scatter',
      xAxisIndex: 0,
      yAxisIndex: 0,
      z: 5,
      animation: false,
      data: (input.overlays.fills ?? []).map((f) => ({
        value: [f.ts, f.price],
        name: f.label,
        symbol: f.kind === 'dca' ? 'rect' : f.side === 'short' ? SYM_TRIANGLE : 'circle',
        symbolSize: 10,
        itemStyle: {
          color:
            f.kind === 'exit' ? (f.win ? c.profit : c.loss) : f.kind === 'dca' ? c.warn : c.accent,
          borderColor: c.bg1,
          borderWidth: 1,
        },
      })),
      tooltip: { formatter: (p: { name?: string }) => p.name ?? '' },
    } as SeriesOption);
  }

  const total = source.length;
  const startPct =
    total > 0 ? Math.max(0, (1 - Math.min(total, input.visibleCandles) / total) * 100) : 0;
  const xIdx = Array.from({ length: nGrid }, (_, i) => i);

  return {
    dataset: { source: source as never },
    grid: grids as never,
    xAxis: xAxes as never,
    yAxis: yAxes as never,
    series,
    tooltip: { show: false },
    axisPointer: { link: [{ xAxisIndex: 'all' }], snap: true },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: xIdx,
        filterMode: 'weakFilter',
        ...(input.initialZoom ? { start: startPct, end: 100 } : {}),
      },
    ],
  };
}

// ---- overlays from a position ----

export interface OverlayExtras {
  tp?: number | null;
  /** Orders of the ladder (entry first), as the drawer gets them. */
  orders?: LadderOrder[];
  /** Executions with their time, when the bot gave them. */
  fills?: FillMark[];
}

/**
 * Overlays of the open position on a pair: its average entry, its liquidation, the ladder levels
 * that are not yet filled (filled ones are drawn as fills) and the executions. A position that is
 * not on this pair gives nothing: an overlay must never be drawn on the wrong chart.
 */
export function overlaysFromPosition(
  position: Pick<Position, 'pair' | 'open_rate' | 'liquidation_price'> | null | undefined,
  pair: string,
  extras: OverlayExtras = {},
): Overlays {
  if (!position || position.pair !== pair) return {};
  return {
    average: position.open_rate,
    tp: extras.tp ?? null,
    liquidation: position.liquidation_price,
    // The first order is the entry: it is the average line, not a safety level
    safetyOrders: (extras.orders ?? [])
      .slice(1)
      .map((o) => ({ price: o.price, state: o.state, label: o.label })),
    fills: extras.fills ?? [],
  };
}
