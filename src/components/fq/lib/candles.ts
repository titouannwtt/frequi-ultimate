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

import { markWin, visibleClosed } from './chartTrades';
import { rankRange, refillRank } from './orders';

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
  /** Rank of the safety order (1 for the first one), for the "R1" tag. */
  n?: number;
  amount?: number | null;
  cost?: number | null;
}

export type PendingKind = 'entry' | 'dca' | 'tp' | 'exit' | 'stop';

/** An order that waits on the exchange, drawn as a line. */
export interface PendingOrder {
  id: string;
  price: number;
  kind: PendingKind;
  /** Rank of a safety order (R1, R2...). */
  n?: number;
  amount?: number | null;
}

/** Gain of the open position at the current price (band and label). Null fields are not drawn. */
export interface GainMark {
  /** Current price; the last close when null. */
  price: number | null;
  /** Average entry, the other end of the band. */
  entry: number | null;
  /** The band starts at the open date of the position. */
  sinceTs: number | null;
  profitAbs: number | null;
  /** In percent, signed. */
  profitPct: number | null;
}

/** A closed trade of the pair: entry and exit joined by a segment. */
export interface ClosedMark {
  id: string;
  side: Side;
  openTs: number;
  openPrice: number;
  closeTs: number;
  closePrice: number;
  profitAbs: number | null;
  profitPct: number | null;
  /** Already translated; empty when the bot gave none. */
  exitReason: string;
}

export interface Overlays {
  average?: number | null;
  tp?: number | null;
  liquidation?: number | null;
  safetyOrders?: SafetyLevel[];
  fills?: FillMark[];
  pending?: PendingOrder[];
  gain?: GainMark | null;
  closed?: ClosedMark[];
  /** Open date of the position: the chart frames it. */
  openTs?: number | null;
}

export interface OverlayToggles {
  average: boolean;
  tp: boolean;
  safetyOrders: boolean;
  fills: boolean;
  liquidation: boolean;
  pending: boolean;
  gain: boolean;
  closed: boolean;
}

export const ALL_OVERLAYS: OverlayToggles = {
  average: true,
  tp: true,
  safetyOrders: true,
  fills: true,
  liquidation: true,
  pending: true,
  gain: true,
  closed: true,
};

export interface OverlayLabels {
  average: string;
  tp: string;
  liquidation: string;
  /** Names of the orders that wait; the kind itself when omitted. */
  pending?: Partial<Record<PendingKind, string>>;
  /** Tag of a safety order: `R` gives R1, R2... */
  dcaTag?: string;
  /** Plain names of the top-ups: "Renfort" gives "Renfort 2", "Renforts" gives "Renforts 1-2". */
  refill?: string;
  refills?: string;
}

export interface LevelLine {
  id: string;
  price: number;
  label: string;
  color: string;
  dash: 'solid' | 'dashed' | 'dotted';
  width: number;
  opacity: number;
  /** Where the label sits on the line. */
  side: 'start' | 'end';
  /** The line is kept in the price range up to PRIORITY_REACH of the last close. */
  priority: boolean;
  /** The line is kept in the price range whatever its distance (the average entry). */
  always?: boolean;
  /** Rank of the top-up this line is (1 for the first one), when it is one. */
  rank?: number;
}

/** The horizontal levels to draw, in drawing order. Levels that are not finite are dropped. */
export function levelLines(
  o: Overlays,
  on: OverlayToggles,
  tokens: FqChartTokens,
  labels: OverlayLabels,
): LevelLine[] {
  const out: LevelLine[] = [];
  const add = (l: Omit<LevelLine, 'side' | 'priority'> & Partial<LevelLine>) => {
    if (Number.isFinite(l.price) && l.price > 0) {
      out.push({ side: 'end', priority: false, ...l });
    }
  };
  if (on.safetyOrders) {
    for (const so of o.safetyOrders ?? []) {
      const rank = refillRank(so.label);
      add({
        id: `so:${so.label}`,
        price: so.price,
        // "Renfort 2", not the identifier "SO2": the owner reads words
        label: rank !== null && labels.refill ? `${labels.refill} ${rank}` : so.label,
        ...(rank !== null ? { rank } : {}),
        color: so.state === 'next' ? tokens.warn : tokens.fg3,
        dash: so.state === 'filled' ? 'solid' : so.state === 'next' ? 'dashed' : 'dotted',
        width: so.state === 'next' ? 1.4 : 1,
        opacity: so.state === 'filled' ? 0.55 : 0.9,
        // The ladder sits on the left, the position's own levels on the right: two labels at
        // nearly the same price do not write over each other
        side: 'start',
      });
    }
  }
  if (on.pending) {
    const tag = labels.dcaTag ?? 'R';
    const colorOf: Record<PendingKind, string> = {
      entry: tokens.accent,
      dca: tokens.warn,
      tp: tokens.profit,
      exit: tokens.fg2,
      stop: tokens.crit,
    };
    for (const p of o.pending ?? []) {
      const name = labels.pending?.[p.kind] ?? p.kind;
      add({
        id: `pend:${p.id}`,
        price: p.price,
        label: p.kind === 'dca' && p.n ? `${name} ${tag}${p.n}` : name,
        color: colorOf[p.kind],
        dash: 'dashed',
        width: 1.3,
        opacity: 1,
        side: 'start',
        priority: true,
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
      priority: true,
      always: true,
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

// ---- labels of the levels: no two written over each other ----

/** What to write for one level line: its own text (merged lines), hidden, and a vertical nudge. */
export interface LabelPlan {
  /** Replaces the default "name price" text (several lines at one price share one label). */
  text?: string;
  /** The line is drawn, its label is carried by another line of the group. */
  hide?: boolean;
  /** Pixels to move the label down (positive) from its place just above its line. */
  dy: number;
}

/** The price pane as it is on screen: the price range and where it sits in the chart, in pixels. */
export interface LabelGeometry {
  lo: number;
  hi: number;
  top: number;
  height: number;
}

/** Height a label takes, with a little air. */
export const LABEL_H = 14;

/**
 * Where each level label goes. Two steps, both pure:
 * 1. lines of one side that print the same price share one label ("Renforts 1-2 12,456"): the
 *    first line carries the text, the others hide theirs;
 * 2. once the price range on screen is known (`geo`), labels that would still overlap are stacked:
 *    each one tries the place above its line, then under it, then further away, and takes the
 *    first one that no other label occupies. The ladder labels are on the left, the position's own
 *    levels on the right, so only labels of one side compete.
 */
export function planLevelLabels(
  lines: ReadonlyArray<
    Pick<LevelLine, 'id' | 'price' | 'label' | 'side'> & Partial<Pick<LevelLine, 'rank'>>
  >,
  fmtPrice: (v: number) => string,
  names: { refills?: string } = {},
  geo: LabelGeometry | null = null,
): Record<string, LabelPlan> {
  const plan: Record<string, LabelPlan> = {};
  for (const side of ['start', 'end'] as const) {
    // One entry per printed price: the lines that say the same number are one label
    const groups = new Map<string, (typeof lines)[number][]>();
    for (const l of lines.filter((x) => x.side === side)) {
      const k = fmtPrice(l.price);
      groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    const heads: Array<{ line: (typeof lines)[number]; y: number | null }> = [];
    for (const [priceText, group] of groups) {
      const head = group[0]!;
      plan[head.id] = { dy: 0 };
      for (const other of group.slice(1)) plan[other.id] = { dy: 0, hide: true };
      if (group.length > 1) {
        const ranks = group.map((g) => g.rank);
        const allRefills = ranks.every((r): r is number => r !== undefined);
        const names_ =
          allRefills && names.refills
            ? `${names.refills} ${rankRange(ranks as number[])}`
            : group.map((g) => g.label).join(' · ');
        plan[head.id]!.text = `${names_} ${priceText}`;
      }
      const y =
        geo && geo.hi > geo.lo
          ? geo.top + ((geo.hi - head.price) / (geo.hi - geo.lo)) * geo.height
          : null;
      heads.push({ line: head, y });
    }
    if (!geo) continue;
    const bottom = geo.top + geo.height;
    const placed: Array<[number, number]> = [];
    const free = (t: number) => placed.every(([a, b]) => t + LABEL_H <= a || t >= b);
    for (const h of heads
      .filter((x) => x.y !== null && x.y >= geo.top && x.y <= bottom)
      .sort((a, b) => a.y! - b.y!)) {
      const y = h.y!;
      const above = y - LABEL_H - 1;
      const tries = [above, y + 2];
      for (let k = 1; k <= 4; k++) tries.push(y + 2 + k * LABEL_H, above - k * LABEL_H);
      const inside = (t: number) => t >= geo.top - 2 && t + LABEL_H <= bottom + 2;
      const at = tries.find((t) => inside(t) && free(t)) ?? above;
      placed.push([at, at + LABEL_H]);
      plan[h.line.id]!.dy = Math.round(at - above);
    }
  }
  return plan;
}

/**
 * The tag each execution marker writes. Top-ups of one candle or a few next to each other, at about
 * the same price, would write "R1" over "R2": the first marker carries one merged tag ("R1-2") and
 * the others write nothing (each keeps its own tooltip). `null` is "write nothing".
 */
export function fillTags(
  fills: ReadonlyArray<Pick<FillMark, 'ts' | 'price' | 'kind' | 'label' | 'n'>>,
  tag: string,
  timeframeMs: number,
  candles = 4,
): Array<string | null> {
  const own = fills.map((f) =>
    f.kind === 'entry' ? 'E' : f.kind === 'dca' ? (f.n ? `${tag}${f.n}` : f.label) : 'S',
  );
  const out: Array<string | null> = [...own];
  const near = (a: (typeof fills)[number], b: (typeof fills)[number]) =>
    a.kind === b.kind &&
    a.kind === 'dca' &&
    a.n !== undefined &&
    b.n !== undefined &&
    Math.abs(a.ts - b.ts) <= (timeframeMs > 0 ? timeframeMs * candles : 0) &&
    Math.abs(a.price - b.price) <= Math.max(a.price, b.price) * 0.01;
  const done = new Set<number>();
  fills.forEach((f, i) => {
    if (done.has(i) || f.kind !== 'dca' || f.n === undefined) return;
    const group = [i];
    fills.forEach((g, j) => {
      if (j > i && !done.has(j) && near(f, g)) group.push(j);
    });
    if (group.length < 2) return;
    group.forEach((j) => done.add(j));
    out[i] = `${tag}${rankRange(group.map((j) => fills[j]!.n!))}`;
    for (const j of group.slice(1)) out[j] = null;
  });
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
    /** Words of the tooltips of the fills and of the closed trades; English when omitted. */
    tip?: Partial<TipLabels>;
    /** Title of the tooltip of a closed trade. */
    closedTrade?: string;
  };
  fmtPrice: (v: number) => string;
  /** Number, signed number, percent, time and duration formatters of the active language. */
  fmt?: Partial<ChartFmt>;
  /** Candles shown at first (the end of the zoom window). */
  visibleCandles: number;
  /**
   * First render of this pair: the zoom window is set. Later updates leave it out, so the user's
   * zoom survives a new candle (the update merges the zoom component instead of replacing it).
   */
  initialZoom: boolean;
  labelSide: 'left' | 'right';
  /** Height of the chart in pixels, to size the panes; unknown (0) gives a default. */
  heightPx?: number;
  /** Draw the sub-charts that fit under the price pane (volume stays). Default true. */
  showSubplots?: boolean;
  /** The sub-charts to draw, by id (see `subplotCandidates`); all of them when omitted. */
  subplotIds?: readonly string[] | null;
  /** Band above each sub-chart for its title, and height of a sub-chart (see `paneLayout`). */
  subTitleH?: number;
  subH?: number;
  mainMinShare?: number;
  /** Levels farther than this share of the last close do not stretch the price axis. */
  axisReach?: number;
  /** Leave the volume pane out (a small chart where the chosen sub-chart would not fit). */
  hideVolume?: boolean;
  /** Where the level labels go (see `planLevelLabels`); written as they come when omitted. */
  labelPlan?: Record<string, LabelPlan>;
}

export interface TipLabels {
  amount: string;
  price: string;
  cost: string;
  time: string;
  duration: string;
  reason: string;
  result: string;
  opened: string;
  closed: string;
  unit: string;
}

export interface ChartFmt {
  number: (v: number, decimals?: number) => string;
  signed: (v: number, decimals?: number) => string;
  /** A percentage that is already in percent, with its sign. */
  percent: (v: number) => string;
  time: (ts: number) => string;
  duration: (ms: number) => string;
}

const TIP_EN: TipLabels = {
  amount: 'Amount',
  price: 'Price',
  cost: 'Cost',
  time: 'Time',
  duration: 'Duration',
  reason: 'Exit',
  result: 'Result',
  opened: 'Opened',
  closed: 'Closed',
  unit: 'USDC',
};

const FMT_DEFAULT: ChartFmt = {
  number: (v, d = 2) => v.toFixed(d),
  signed: (v, d = 2) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`,
  percent: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`,
  time: (ts) => new Date(ts).toISOString().slice(0, 16).replace('T', ' '),
  duration: (ms) => `${Math.round(ms / 60_000)} min`,
};

const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The HTML of a marker tooltip: a title and `label value` rows. Values are escaped. */
export function tipHtml(title: string, rows: Array<[string, string]>): string {
  const body = rows
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `<div><span style="opacity:.7">${esc(k)}</span> ${esc(v)}</div>`)
    .join('');
  return `<div><b>${esc(title)}</b></div>${body}`;
}

/** Share of the price range kept free above and below the lines, so that a label never clips. */
const Y_PAD_MIN = 0.06;
const Y_PAD_PX = 30;
/** Lines that matter (average, orders that wait) are kept in range up to this distance. */
const PRIORITY_REACH = 0.4;

/**
 * Bounds of the price axis: the visible candles plus the lines that count, with a margin. Pure:
 * the same function serves the axis (min and max callbacks) and the tests.
 */
export function priceBounds(
  extent: { min: number; max: number },
  include: readonly number[],
  mainHeightPx: number,
): [number, number] {
  const lo = Math.min(extent.min, ...include);
  const hi = Math.max(extent.max, ...include);
  const span = hi - lo > 0 ? hi - lo : Math.abs(hi) * 0.02 || 1;
  const pad = Math.max(Y_PAD_MIN, mainHeightPx > 0 ? Y_PAD_PX / mainHeightPx : 0);
  return [lo - span * pad, hi + span * pad];
}

/**
 * The prices that stretch the price axis, on top of the candles. One rule for every level: the
 * average entry is always in range (it is where the position stands), the orders that wait are
 * kept in range up to PRIORITY_REACH of the last close, the others (take profit, liquidation,
 * safety orders) up to `reach`. A level farther than that does not squash the candles: it is
 * announced at the edge of the chart instead (`offscreenLevels`).
 */
export function axisLevels(
  lines: ReadonlyArray<Pick<LevelLine, 'price' | 'priority' | 'always'>>,
  lastClose: number | null,
  reach = 0.25,
): number[] {
  return lines
    .filter((l) => {
      if (l.always) return true;
      if (lastClose === null || !(lastClose > 0)) return false;
      return (
        Math.abs(l.price - lastClose) / lastClose <=
        (l.priority ? Math.max(reach, PRIORITY_REACH) : reach)
      );
    })
    .map((l) => l.price);
}

export interface OffscreenLevel {
  id: string;
  label: string;
  price: number;
  /** Where it lies: above the top of the chart or under its bottom. */
  dir: 'up' | 'down';
  /** Distance from the last close, in percent, signed. Null when there is no close. */
  pct: number | null;
}

/**
 * The levels the price axis leaves out, nearest first: announced at the edge with their distance.
 * `range` is the price range really on screen (read back from the chart after a pan or a zoom).
 */
export function offscreenLevels(
  lines: ReadonlyArray<Pick<LevelLine, 'id' | 'label' | 'price'>>,
  range: { lo: number; hi: number },
  lastClose: number | null,
): OffscreenLevel[] {
  const out: OffscreenLevel[] = [];
  for (const l of lines) {
    if (!Number.isFinite(l.price) || (l.price >= range.lo && l.price <= range.hi)) continue;
    out.push({
      id: l.id,
      label: l.label,
      price: l.price,
      dir: l.price > range.hi ? 'up' : 'down',
      pct: lastClose !== null && lastClose > 0 ? ((l.price - lastClose) / lastClose) * 100 : null,
    });
  }
  const dist = (o: OffscreenLevel) => (o.dir === 'up' ? o.price - range.hi : range.lo - o.price);
  return out.sort((a, b) => dist(a) - dist(b));
}

// ---- pane layout ----

export interface Pane {
  top: number;
  height: number;
}

export interface PaneLayout {
  main: Pane;
  volume: Pane | null;
  subs: Pane[];
}

const PANE_TOP = 6;
/** Room under the last pane for the time labels. */
const PANE_BOTTOM = 24;
const PANE_GAP = 6;
const VOLUME_H = 44;
const SUB_H = 64;
/** The price pane keeps at least this share of the chart, and never less than MAIN_MIN_PX. */
const MAIN_MIN_SHARE = 0.55;
const MAIN_MIN_PX = 160;
/** In a chart too small for anything: never a negative or invisible price pane. */
const MAIN_FLOOR_PX = 80;
const HEIGHT_FALLBACK = 360;

/**
 * Pixel layout of the panes: the price pane first and as large as the chart allows, then the
 * volume, then the sub-charts that still leave the price pane its minimum height (the others are
 * dropped, not squeezed: a price pane of 60 px is useless). Percent layouts gave exactly that
 * squeeze with four sub-charts.
 */
export function paneLayout(o: {
  heightPx: number;
  hasVolume: boolean;
  subCount: number;
  showSubplots: boolean;
  /** A band above each sub-chart for its title (HTML, drawn over the chart); default none. */
  subTitleH?: number;
  /** Height of a sub-chart; default SUB_H. */
  subH?: number;
  /** Share of the chart the price pane keeps at least; default MAIN_MIN_SHARE. */
  mainMinShare?: number;
}): PaneLayout {
  const height = o.heightPx > 0 ? o.heightPx : HEIGHT_FALLBACK;
  const titleH = o.subTitleH ?? 0;
  const subH = o.subH ?? SUB_H;
  const step = titleH + subH + PANE_GAP;
  const inner = height - PANE_TOP - PANE_BOTTOM;
  const minMain = Math.max(MAIN_MIN_PX, height * (o.mainMinShare ?? MAIN_MIN_SHARE));
  const volumeH = o.hasVolume ? VOLUME_H + PANE_GAP : 0;
  const room = inner - volumeH - minMain;
  // The epsilon: 800 * 0.55 is 440.00000000000006, which made 4.0 sub-charts fit as 3
  const fit = o.showSubplots ? Math.max(0, Math.floor(room / step + 1e-9)) : 0;
  const n = Math.min(o.subCount, fit);
  const mainH = Math.max(MAIN_FLOOR_PX, inner - volumeH - n * step);
  const main = { top: PANE_TOP, height: mainH };
  let cursor = PANE_TOP + mainH + PANE_GAP;
  const volume = o.hasVolume ? { top: cursor, height: VOLUME_H } : null;
  if (volume) cursor += VOLUME_H + PANE_GAP;
  const subs: Pane[] = [];
  for (let i = 0; i < n; i++) {
    subs.push({ top: cursor + titleH, height: subH });
    cursor += step;
  }
  return { main, volume, subs };
}

/** Triangles for the orders: apex up for a buy, apex down for a sell. */
const SYM_UP = 'path://M0,-8 L7,6 L-7,6 Z';
const SYM_DOWN = 'path://M0,8 L7,-6 L-7,-6 Z';

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

/** Id of the sub-chart the app adds for the `rsi` column when the plot config has none. */
export const BUILTIN_RSI = 'builtin:rsi';

export interface SubplotCandidate {
  /** Name of the sub-chart in the plot config, or BUILTIN_RSI. */
  id: string;
  /** The series drawn in it, by column name. */
  series: Record<string, PlotConfig['main_plot'][string]>;
}

/**
 * The sub-charts a strategy can show: the ones its plot config names, then an RSI of the app when
 * asked, the column exists and no sub-chart already draws it. Sub-charts whose columns are all
 * missing from the candles are left out (nothing to draw).
 */
export function subplotCandidates(
  plot: PlotConfig,
  withRsi: boolean,
  columns: string[],
  rsiColor = '#888',
): SubplotCandidate[] {
  const out: SubplotCandidate[] = Object.entries(plot.subplots ?? {})
    .map(([id, series]) => ({ id, series }))
    .filter((c) => Object.keys(c.series).some((k) => columns.includes(k)));
  const hasRsi = out.some((s) => 'rsi' in s.series);
  if (withRsi && columns.includes('rsi') && !hasRsi) {
    out.push({ id: BUILTIN_RSI, series: { rsi: { color: rsiColor, type: 'line' } as never } });
  }
  return out;
}

/** What a parent needs to know of a sub-chart: to list it, to tick it. */
export interface SubplotInfo {
  id: string;
  /** Plain title, "RSI 14, élan du prix". */
  label: string;
  /** One line that says how to read it. */
  explain: string | null;
  /** Column names, kept for the tooltip. */
  raw: string[];
  shown: boolean;
}

/**
 * The sub-charts to draw among the candidates, given what the user kept for this strategy. Nothing
 * kept yet (or nothing of it exists any more): ONE sub-chart, the RSI when there is one, else the
 * first. An empty choice is a choice: no sub-chart.
 */
export function resolveSubplots(
  candidates: ReadonlyArray<Pick<SubplotCandidate, 'id' | 'series'>>,
  stored: readonly string[] | null | undefined,
): string[] {
  if (stored && stored.length === 0) return [];
  const kept = stored ? candidates.filter((c) => stored.includes(c.id)).map((c) => c.id) : [];
  if (kept.length > 0) return kept;
  const rsi = candidates.find(
    (c) =>
      c.id === BUILTIN_RSI ||
      /rsi/i.test(c.id) ||
      Object.keys(c.series).some((k) => /rsi/i.test(k)),
  );
  const one = rsi ?? candidates[0];
  return one ? [one.id] : [];
}

/** Number of sub-charts the plot config asks for (RSI included when it is added). */
export function subplotCount(plot: PlotConfig, withRsi: boolean, columns: string[]): number {
  const subs = Object.values(plot.subplots ?? {});
  const hasRsi = subs.some((s) => 'rsi' in s);
  return subs.length + (withRsi && columns.includes('rsi') && !hasRsi ? 1 : 0);
}

/** Start of the zoom window, in percent of the loaded candles, to show the last `visible`. */
export function zoomStartPct(total: number, visible: number): number {
  return total > 0 ? Math.max(0, (1 - Math.min(total, visible) / total) * 100) : 0;
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

  // Sub-charts: the plot config ones, then RSI when asked and not already there; the caller may
  // keep only some of them
  const wanted = input.subplotIds ? new Set(input.subplotIds) : null;
  const subplots: Array<{ name: string; series: Record<string, PlotConfig['main_plot'][string]> }> =
    subplotCandidates(input.plotConfig, input.rsi, columns, c.fg2)
      .filter((s) => !wanted || wanted.has(s.id))
      .map((s) => ({ name: s.id, series: s.series }));

  const hasVolume = vi >= 0 && !input.hideVolume;
  const layout = paneLayout({
    heightPx: input.heightPx ?? 0,
    hasVolume,
    subCount: subplots.length,
    showSubplots: input.showSubplots ?? true,
    subTitleH: input.subTitleH,
    subH: input.subH,
    mainMinShare: input.mainMinShare,
  });
  // Sub-charts that do not fit are left out: the price pane keeps its room
  subplots.splice(layout.subs.length);
  const left = input.labelSide === 'left' ? 46 : 8;
  const right = input.labelSide === 'right' ? 52 : 8;
  const grids: Array<Record<string, unknown>> = [layout.main, layout.volume, ...layout.subs]
    .filter((g): g is Pane => g !== null)
    .map((g) => ({ left, right, top: g.top, height: g.height }));

  const lastClose = (() => {
    for (let i = set.rows.length - 1; i >= 0; i--) {
      const v = set.rows[i]![ci];
      if (v != null) return v;
    }
    return null;
  })();
  const lines = levelLines(input.overlays, input.toggles, c, input.labels);
  const near = axisLevels(lines, lastClose, input.axisReach ?? 0.25);
  const gain = input.toggles.gain ? (input.overlays.gain ?? null) : null;
  const gainPrice = gain ? (gain.price ?? lastClose) : null;
  if (gainPrice !== null && Number.isFinite(gainPrice)) near.push(gainPrice);
  const fmt: ChartFmt = { ...FMT_DEFAULT, ...(input.fmt ?? {}) };
  const tip: TipLabels = { ...TIP_EN, ...(input.labels.tip ?? {}) };
  const dcaTag = input.labels.dcaTag ?? 'R';
  const firstTs = set.rows.length > 0 ? (set.rows[0]![di] as number) : null;
  const lastTs = set.rows.length > 0 ? (set.rows[set.rows.length - 1]![di] as number) : null;

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
            // The bounds are the candles plus a margin, never round numbers: written, they sit
            // on top of the nearest round tick ("131,51" over "120,00")
            axisLabel: {
              color: c.fg3,
              fontSize: 11,
              showMinLabel: false,
              showMaxLabel: false,
              formatter: (v: number) => input.fmtPrice(v),
            },
            splitLine: { lineStyle: { color: c.line, type: 'dashed' } },
            min: (v: { min: number; max: number }) => priceBounds(v, near, layout.main.height)[0],
            max: (v: { min: number; max: number }) => priceBounds(v, near, layout.main.height)[1],
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

  // The gain: a light band from the average entry to the price now, and its figure at the last price
  let gainBand: { from: number; to: number; entry: number; price: number; color: string } | null =
    null;
  let gainLabel: { ts: number; price: number; text: string; color: string } | null = null;
  if (gain && gainPrice !== null && Number.isFinite(gainPrice) && lastTs !== null) {
    const up = gain.profitAbs !== null ? gain.profitAbs >= 0 : (gain.profitPct ?? 0) >= 0;
    const color = up ? c.profit : c.loss;
    const parts: string[] = [];
    if (gain.profitAbs !== null) parts.push(`${fmt.signed(gain.profitAbs, 2)} ${tip.unit}`);
    if (gain.profitPct !== null) parts.push(fmt.percent(gain.profitPct));
    if (parts.length > 0) {
      gainLabel = { ts: lastTs, price: gainPrice, text: parts.join(' · '), color };
    }
    if (gain.entry !== null && gain.entry > 0 && firstTs !== null) {
      gainBand = {
        from: Math.max(firstTs, gain.sinceTs ?? firstTs),
        to: lastTs,
        entry: gain.entry,
        price: gainPrice,
        color,
      };
    }
  }

  const series: SeriesOption[] = [
    {
      id: 'candles',
      name: input.labels.candles,
      type: 'candlestick',
      xAxisIndex: 0,
      yAxisIndex: 0,
      // Silent: the candles show their figures in the legend, not in a tooltip over the markers
      silent: true,
      barMaxWidth: 18,
      itemStyle: { color: c.profit, color0: c.loss, borderColor: c.profit, borderColor0: c.loss },
      encode: { x: di, y: [oi, ci, li, hi] },
      markLine: lines.length
        ? {
            silent: true,
            symbol: 'none',
            animation: false,
            data: lines.map((l) => {
              const lp = input.labelPlan?.[l.id];
              return {
                yAxis: l.price,
                name: l.id,
                lineStyle: { color: l.color, type: l.dash, width: l.width, opacity: l.opacity },
                label: {
                  show: !lp?.hide,
                  position: l.side === 'start' ? 'insideStartTop' : 'insideEndTop',
                  color: l.color,
                  fontSize: 11,
                  ...(lp?.dy ? { offset: [0, lp.dy] } : {}),
                  formatter: lp?.text ?? `${l.label} ${input.fmtPrice(l.price)}`,
                },
              };
            }),
          }
        : undefined,
      markArea: gainBand
        ? {
            silent: true,
            animation: false,
            data: [
              [
                {
                  xAxis: gainBand.from,
                  yAxis: gainBand.entry,
                  itemStyle: { color: gainBand.color, opacity: 0.12 },
                },
                { xAxis: gainBand.to, yAxis: gainBand.price },
              ],
            ],
          }
        : undefined,
      markPoint: gainLabel
        ? {
            silent: true,
            animation: false,
            symbol: 'circle',
            symbolSize: 8,
            data: [
              {
                coord: [gainLabel.ts, gainLabel.price],
                itemStyle: { color: gainLabel.color, borderColor: c.bg1, borderWidth: 1 },
                label: {
                  show: true,
                  position: 'left',
                  distance: 8,
                  formatter: gainLabel.text,
                  color: c.bg1,
                  backgroundColor: gainLabel.color,
                  borderRadius: 3,
                  padding: [3, 6],
                  fontSize: 11,
                  fontWeight: 600,
                },
              },
            ],
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
      silent: true,
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
      silent: true,
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
        silent: true,
      } as SeriesOption);
    }
  });

  // Fills: a triangle up for a buy, down for a sell, so a short is mirrored by its own orders
  const fillWords = fillTags(input.overlays.fills ?? [], dcaTag, set.timeframeMs);
  if (input.toggles.fills && (input.overlays.fills?.length ?? 0) > 0) {
    series.push({
      id: 'fills',
      name: 'fills',
      type: 'scatter',
      xAxisIndex: 0,
      yAxisIndex: 0,
      z: 5,
      animation: false,
      data: (input.overlays.fills ?? []).map((f, fi) => {
        const buy = f.kind === 'exit' ? f.side === 'short' : f.side !== 'short';
        const tag =
          f.kind === 'entry' ? 'E' : f.kind === 'dca' ? (f.n ? `${dcaTag}${f.n}` : f.label) : 'S';
        const written = fillWords[fi] ?? tag;
        const kindName =
          f.kind === 'entry'
            ? input.labels.entry
            : f.kind === 'dca'
              ? input.labels.dca
              : input.labels.exit;
        return {
          value: [f.ts, f.price],
          name: tag,
          symbol: buy ? SYM_UP : SYM_DOWN,
          symbolSize: f.kind === 'entry' ? 13 : 11,
          // E, R1... under a buy (above a sell)
          label: {
            show: written !== null,
            formatter: written ?? '',
            position: buy ? 'bottom' : 'top',
            color: c.fg2,
            fontSize: 10,
          },
          itemStyle: {
            color:
              f.kind === 'exit'
                ? f.win === undefined
                  ? c.fg2
                  : f.win
                    ? c.profit
                    : c.loss
                : f.kind === 'dca'
                  ? c.warn
                  : c.accent,
            borderColor: c.bg1,
            borderWidth: 1,
          },
          tip: tipHtml(`${tag} · ${kindName}`, [
            [tip.amount, f.amount != null ? fmt.number(f.amount, 4) : ''],
            [tip.price, input.fmtPrice(f.price)],
            [tip.cost, f.cost != null ? `${fmt.number(f.cost, 2)} ${tip.unit}` : ''],
            [tip.time, fmt.time(f.ts)],
          ]),
        };
      }),
      tooltip: { formatter: (p: { data?: { tip?: string } }) => p.data?.tip ?? '' },
    } as SeriesOption);
  }

  // Closed trades of the pair: entry and exit joined by a dashed segment, coloured by result
  // A closed trade priced outside every loaded candle is not of this chart (another price scale,
  // a renamed market): it would stretch the price axis for nothing, so it is left out
  let dataLow = Infinity;
  let dataHigh = -Infinity;
  for (const r of set.rows) {
    const lo = r[li];
    const hiV = r[hi];
    if (lo != null && lo < dataLow) dataLow = lo;
    if (hiV != null && hiV > dataHigh) dataHigh = hiV;
  }
  const onScale = (p: number) => p >= dataLow * 0.9 && p <= dataHigh * 1.1;
  const closedMarks = input.toggles.closed
    ? (input.overlays.closed ?? []).filter((m) => onScale(m.openPrice) && onScale(m.closePrice))
    : [];
  if (closedMarks.length > 0 && firstTs !== null && lastTs !== null) {
    const dots: unknown[] = [];
    const segments: unknown[] = [];
    for (const m of closedMarks) {
      const seen = visibleClosed(m, firstTs, lastTs);
      if (!seen) continue;
      const win = markWin(m);
      const color = win === null ? c.fg3 : win ? c.profit : c.loss;
      const long = m.side !== 'short';
      const gainWord =
        m.profitAbs === null
          ? ''
          : `${fmt.signed(m.profitAbs, 2)} ${tip.unit}${
              m.profitPct !== null ? ` (${fmt.percent(m.profitPct)})` : ''
            }`;
      const title = `${input.labels.closedTrade ?? 'Closed trade'} #${m.id.split('/').pop()}`;
      const rows: Array<[string, string]> = [
        [tip.result, gainWord],
        [tip.reason, m.exitReason],
        [tip.duration, fmt.duration(m.closeTs - m.openTs)],
        [tip.opened, `${fmt.time(m.openTs)} · ${input.fmtPrice(m.openPrice)}`],
        [tip.closed, `${fmt.time(m.closeTs)} · ${input.fmtPrice(m.closePrice)}`],
      ];
      const html = tipHtml(title, rows);
      if (seen.showOpen) {
        dots.push({
          value: [m.openTs, m.openPrice],
          symbol: long ? SYM_UP : SYM_DOWN,
          symbolSize: 8,
          itemStyle: { color: c.bg1, borderColor: color, borderWidth: 1.5 },
          tip: html,
        });
      }
      if (seen.showClose) {
        dots.push({
          value: [m.closeTs, m.closePrice],
          symbol: long ? SYM_DOWN : SYM_UP,
          symbolSize: 9,
          itemStyle: { color, borderColor: c.bg1, borderWidth: 1 },
          label:
            m.profitAbs === null
              ? { show: false }
              : {
                  show: true,
                  formatter: fmt.signed(m.profitAbs, 2),
                  position: m.closePrice >= m.openPrice ? 'top' : 'bottom',
                  color,
                  fontSize: 10,
                },
          tip: html,
        });
      }
      const style = { color, type: 'dashed', width: 1, opacity: 0.75 };
      segments.push([
        { coord: seen.a, lineStyle: style },
        { coord: seen.b, lineStyle: style },
      ]);
    }
    series.push({
      id: 'closed',
      name: 'closed',
      type: 'scatter',
      xAxisIndex: 0,
      yAxisIndex: 0,
      z: 4,
      animation: false,
      data: dots,
      markLine: {
        silent: true,
        symbol: 'none',
        animation: false,
        label: { show: false },
        data: segments,
      },
      tooltip: { formatter: (p: { data?: { tip?: string } }) => p.data?.tip ?? '' },
    } as SeriesOption);
  }

  const total = source.length;
  const startPct = zoomStartPct(total, input.visibleCandles);
  const xIdx = Array.from({ length: nGrid }, (_, i) => i);

  return {
    dataset: { source: source as never },
    grid: grids as never,
    xAxis: xAxes as never,
    yAxis: yAxes as never,
    series,
    // Only the markers (fills, closed trades) carry a tooltip; the candles have their legend
    tooltip: { show: true, trigger: 'item', confine: true },
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
  /**
   * The orders that wait, with their price. `null` while they are not known: the ladder levels that
   * are not filled then stay drawn as they were; once known they replace them (same orders).
   */
  pending?: PendingOrder[] | null;
  gain?: GainMark | null;
  /** Closed trades of this bot and pair: drawn with or without an open position. */
  closed?: ClosedMark[];
}

/**
 * Overlays of the open position on a pair: its average entry, its liquidation, the ladder levels
 * that are not yet filled (filled ones are drawn as fills), the executions, the orders that wait
 * and the gain. A position that is not on this pair gives nothing but the closed trades: an overlay
 * of a position must never be drawn on the wrong chart.
 */
export function overlaysFromPosition(
  position:
    | Pick<Position, 'pair' | 'open_rate' | 'liquidation_price'>
    | (Pick<Position, 'pair' | 'open_rate' | 'liquidation_price'> &
        Partial<Pick<Position, 'side' | 'open_ms'>>)
    | null
    | undefined,
  pair: string,
  extras: OverlayExtras = {},
): Overlays {
  const closed = extras.closed ?? [];
  if (!position || position.pair !== pair) return closed.length > 0 ? { closed } : {};
  const side = (position as { side?: Side }).side;
  const openMs = (position as { open_ms?: number }).open_ms;
  const average = position.open_rate;
  const ladder = (extras.orders ?? []).slice(1);
  return {
    average,
    tp: extras.tp ?? null,
    liquidation: position.liquidation_price,
    // The first order is the entry: it is the average line, not a safety level
    safetyOrders: (extras.pending ? ladder.filter((o) => o.state === 'filled') : ladder).map(
      (o) => ({ price: o.price, state: o.state, label: o.label }),
    ),
    // A partial exit past the average entry made money, short or long
    fills: (extras.fills ?? []).map((f) =>
      f.kind === 'exit' && f.win === undefined && average > 0
        ? { ...f, win: (side ?? f.side) === 'short' ? f.price < average : f.price > average }
        : f,
    ),
    pending: extras.pending ?? [],
    gain: extras.gain ?? null,
    closed,
    openTs: openMs != null && Number.isFinite(openMs) && openMs > 0 ? openMs : null,
  };
}
