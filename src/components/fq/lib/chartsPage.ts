/**
 * Model of the Charts page (02 section 3.3): what the URL carries (`/charts?bot=&pair=&tf=`), which
 * bot computes the indicators for a pair, which pair the second cell shows, and the plot presets.
 * Pure functions, so the page stays a thin wiring and the rules are tested without a component.
 */
import { usePlotTemplates } from '@/composables/plotTemplates';
import { deepMerge } from '@/utils/deepMerge';
import type { BotKey, BotRow, Position } from '@/gateway/types.gen';
import type { PlotConfig } from '@/types';

/**
 * The usual freqtrade timeframes. A bot only serves the candles of its strategy timeframe (the
 * others come back empty), so this list is a menu, not a promise: see `timeframeOptions`.
 */
export const CHART_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1d'] as const;
export type ChartTf = string;

/** Two cells in v1 (decision 6 of the owner); the render budget allows three. */
export const MAX_CELLS = 2;
export type CellCount = 1 | 2;

/** Used only when the bot's own timeframe is not known (yet). */
export const DEFAULT_TF: ChartTf = '15m';

export interface ChartsState {
  bot: BotKey | null;
  pair: string | null;
  pair2: string | null;
  /** The timeframe the URL asks for; null: the one of the context bot's strategy. */
  tf: ChartTf | null;
  cells: CellCount;
  /** Heikin-Ashi candles; null: the user's preference decides. */
  ha: boolean | null;
}

const first = (v: unknown): string | null => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === 'string' && x.trim() !== '' ? x.trim() : null;
};

const TF_RE = /^[1-9]\d{0,2}[mhdwM]$/;
const TF_UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, M: 2_592_000_000 };

/** A freqtrade timeframe (`5m`, `1h`, `1d`...), whether or not it is in the standard menu. */
export function isChartTf(v: unknown): v is ChartTf {
  return typeof v === 'string' && TF_RE.test(v);
}

const tfMs = (tf: string): number =>
  Number(tf.slice(0, -1)) * TF_UNIT_MS[tf.slice(-1) as keyof typeof TF_UNIT_MS];

/** The timeframe shown: the one asked for, else the bot's own, else the default. */
export function effectiveTf(requested: ChartTf | null, own: string | null | undefined): ChartTf {
  return requested ?? (isChartTf(own) ? own : DEFAULT_TF);
}

/** The menu of timeframes: the standard ones plus the bot's own when it is an unusual one. */
export function timeframeOptions(own: string | null | undefined): ChartTf[] {
  const all: ChartTf[] = [...CHART_TIMEFRAMES];
  if (isChartTf(own) && !all.includes(own)) all.push(own);
  return all.sort((a, b) => tfMs(a) - tfMs(b));
}

/** The state a URL describes; anything unknown or malformed falls back to the default. */
export function parseChartsQuery(query: Record<string, unknown>): ChartsState {
  const tf = first(query.tf);
  const cells = Number(first(query.cells));
  return {
    bot: first(query.bot),
    pair: first(query.pair),
    pair2: first(query.pair2),
    tf: isChartTf(tf) ? tf : null,
    cells: cells === 2 ? 2 : 1,
    ha: first(query.ha) === '1' ? true : first(query.ha) === '0' ? false : null,
  };
}

/** The URL of a state: defaults (including the bot's own timeframe) are left out. */
export function chartsQuery(s: ChartsState): Record<string, string> {
  const q: Record<string, string> = {};
  if (s.bot) q.bot = s.bot;
  if (s.pair) q.pair = s.pair;
  if (s.cells === 2) {
    q.cells = '2';
    if (s.pair2) q.pair2 = s.pair2;
  }
  if (s.tf !== null) q.tf = s.tf;
  if (s.ha !== null) q.ha = s.ha ? '1' : '0';
  return q;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Worst P&L first, unknown last: the position that needs a look is the one shown. */
function worstFirst(a: Position, b: Position): number {
  const x = a.profit_abs ?? Infinity;
  const y = b.profit_abs ?? Infinity;
  return x - y || collator.compare(a.pair, b.pair);
}

/**
 * The bot whose strategy computes the indicators for `pair`: the requested one when the fleet
 * knows it, else a bot holding a position on the pair (live first, by name), else the bot last
 * selected on the Bot page, else the first live bot, else the first bot.
 */
export function contextBotFor(opts: {
  pair: string | null;
  requested: BotKey | null;
  selected: BotKey | null;
  positions: readonly Position[];
  bots: readonly BotRow[];
}): BotKey | null {
  const byKey = new Map(opts.bots.map((b) => [b.bot_key, b]));
  if (opts.requested && byKey.has(opts.requested)) return opts.requested;
  const sorted = opts.bots
    .slice()
    .sort(
      (a, b) =>
        Number(b.identity.mode === 'live') - Number(a.identity.mode === 'live') ||
        collator.compare(a.identity.name, b.identity.name),
    );
  if (opts.pair) {
    const holders = new Set(
      opts.positions.filter((p) => p.pair === opts.pair && !p.orphan).map((p) => p.bot_key),
    );
    const holder = sorted.find((b) => holders.has(b.bot_key));
    if (holder) return holder.bot_key;
  }
  if (opts.selected && byKey.has(opts.selected)) return opts.selected;
  return sorted[0]?.bot_key ?? null;
}

/** The pair shown when the URL names none: the worst open position of the bot, else of the fleet. */
export function defaultPair(positions: readonly Position[], bot: BotKey | null): string | null {
  const owned = positions.filter((p) => !p.orphan);
  const mine = bot ? owned.filter((p) => p.bot_key === bot) : [];
  return (mine.length > 0 ? mine : owned).slice().sort(worstFirst)[0]?.pair ?? null;
}

/**
 * The default pair, kept while it is still a candidate. "The worst position" moves with every price
 * tick: recomputed each time it would make the chart jump from pair to pair, and reload, under the
 * user's eyes. The default is chosen once and changes only when its position is gone (or the
 * context bot changes: pass `null` as `current` then).
 */
export function stickyDefaultPair(
  current: string | null,
  positions: readonly Position[],
  bot: BotKey | null,
): string | null {
  const owned = positions.filter((p) => !p.orphan);
  const mine = bot ? owned.filter((p) => p.bot_key === bot) : [];
  const candidates = mine.length > 0 ? mine : owned;
  if (current && candidates.some((p) => p.pair === current)) return current;
  return defaultPair(positions, bot);
}

/** The pair of the second cell: the next worst position on another pair. */
export function secondPair(positions: readonly Position[], not: string | null): string | null {
  return (
    positions
      .filter((p) => !p.orphan && p.pair !== not)
      .slice()
      .sort(worstFirst)[0]?.pair ?? null
  );
}

// ---- indicator presets ----

export const STRATEGY_PRESET = 'default';
export const TEMPLATE_PREFIX = 'tpl:';

export type PlotChoice =
  | { kind: 'strategy' }
  | { kind: 'custom'; name: string; config: PlotConfig }
  | { kind: 'template'; name: string };

/** What a stored preset name designates. An unknown name falls back to the strategy's own plot. */
export function resolvePlotChoice(
  name: string | null | undefined,
  custom: Record<string, unknown> | null | undefined,
): PlotChoice {
  if (!name || name === STRATEGY_PRESET) return { kind: 'strategy' };
  if (name.startsWith(TEMPLATE_PREFIX)) {
    const tpl = name.slice(TEMPLATE_PREFIX.length);
    return plotTemplateNames().includes(tpl)
      ? { kind: 'template', name: tpl }
      : { kind: 'strategy' };
  }
  const config = custom?.[name];
  if (config && typeof config === 'object') {
    return { kind: 'custom', name, config: config as PlotConfig };
  }
  return { kind: 'strategy' };
}

/** `plotConfig` replaces the strategy's plot; `plotExtra` is layered on top of it. */
export function plotProps(choice: PlotChoice): {
  plotConfig: PlotConfig | undefined;
  plotExtra: Partial<PlotConfig> | undefined;
} {
  switch (choice.kind) {
    case 'custom':
      return { plotConfig: choice.config, plotExtra: undefined };
    case 'template':
      return {
        plotConfig: undefined,
        plotExtra: usePlotTemplates().getTemplateContent(choice.name),
      };
    default:
      return { plotConfig: undefined, plotExtra: undefined };
  }
}

/** The strategy's plot with the extra layered on top; the extra's series win on a name clash. */
export function mergePlot(base: PlotConfig, extra: Partial<PlotConfig> | undefined): PlotConfig {
  if (!extra) return base;
  return deepMerge(base, extra) as PlotConfig;
}

/** Names of the built-in indicator templates (Bollinger bands, RSI, MACD). */
export function plotTemplateNames(): string[] {
  return usePlotTemplates().plotTemplateNames.value;
}
