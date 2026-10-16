/**
 * One line model for the trade tables and the cards: an open position (registry of positions) or a
 * closed trade. The key of a line is `bot_key/trade_id`: a `trade_id` is only unique per bot, two
 * bots can both hold trade 1180 (bug B1 of the old UI came from forgetting it).
 */
import type { DcaLadderHPosition } from '@/components/ds/DcaLadderH.vue';
import { isHip3Market } from '@/datasource/calc/hip3';
import type {
  BotMode,
  BotRow,
  ExitReason,
  Market,
  Position,
  Side,
  TradeRow,
} from '@/gateway/types.gen';

export interface TradeLine {
  /** `bot_key/trade_id`, unique across the fleet. */
  key: string;
  botKey: string;
  botName: string;
  mode: BotMode | null;
  tradeId: number;
  pair: string;
  market: Market;
  xyz: boolean;
  side: Side;
  leverage: number;
  /** A position on the wallet that no bot owns: no exit button, only the reconciliation. */
  orphan: boolean;
  /** The figures are older than their threshold: shown muted, never summed. */
  stale: boolean;
  entry: number;
  current: number | null;
  pnlAbs: number | null;
  /** Percent, already multiplied by 100. */
  pnlPct: number | null;
  profitUnknown: boolean;
  stake: number;
  notional: number | null;
  amount: number;
  dcaFilled: number;
  /** Maximum number of entries when the bot said so; otherwise unknown. */
  dcaMax: number | null;
  liquidationPrice: number | null;
  liqDistancePct: number | null;
  durationMs: number;
  percentile: number | null;
  openMs: number;
  closeMs: number | null;
  exitReason: ExitReason | null;
  exitPrice: number | null;
  manual: boolean;
  enterTag: string | null;
  open: boolean;
  /** Excursions of a closed trade as ratios of the stake; absent without a gateway. */
  mae?: number | null;
  mfe?: number | null;
  /** Orders filled on the entry side of a closed trade, when the source gave it. */
  dcaEntries?: number | null;
  /** Result as a ratio, to place the exit tick on the excursion bar. */
  ratio?: number | null;
}

export function tradeKey(botKey: string, tradeId: number): string {
  return `${botKey}/${tradeId}`;
}

export function lineFromPosition(
  p: Position,
  bot: BotRow | undefined,
  opts: { dcaMax?: number | null; stale?: boolean } = {},
): TradeLine {
  return {
    key: tradeKey(p.bot_key, p.trade_id),
    botKey: p.bot_key,
    botName: bot?.identity.name ?? p.bot_key,
    mode: bot?.identity.mode ?? null,
    tradeId: p.trade_id,
    pair: p.pair,
    market: p.market,
    xyz: isHip3Market(p.market),
    side: p.side,
    leverage: p.leverage,
    orphan: p.orphan,
    stale: opts.stale ?? p.freshness.stale,
    entry: p.open_rate,
    current: p.current_rate,
    pnlAbs: p.profit_abs,
    pnlPct: p.profit_ratio == null ? null : p.profit_ratio * 100,
    profitUnknown: p.profit_abs == null,
    stake: p.stake_amount,
    notional: p.notional,
    amount: p.amount,
    dcaFilled: p.dca_entries,
    dcaMax: opts.dcaMax ?? null,
    liquidationPrice: p.liquidation_price,
    liqDistancePct: p.liq_distance_pct,
    durationMs: p.duration_ms,
    percentile: p.percentile,
    openMs: p.open_ms,
    closeMs: null,
    exitReason: null,
    exitPrice: null,
    manual: false,
    enterTag: null,
    open: true,
  };
}

export function lineFromTrade(
  t: TradeRow & { mae?: number | null; mfe?: number | null; dca_entries?: number | null },
  bot: BotRow | undefined,
): TradeLine {
  const closeMs = t.close_ms;
  return {
    key: tradeKey(t.bot_key, t.trade_id),
    botKey: t.bot_key,
    botName: bot?.identity.name ?? t.bot_key,
    mode: t.mode,
    tradeId: t.trade_id,
    pair: t.pair,
    market: t.market,
    xyz: isHip3Market(t.market),
    side: t.side,
    leverage: t.leverage,
    orphan: false,
    stale: false,
    entry: t.open_rate,
    current: null,
    pnlAbs: t.profit_unknown ? null : t.profit_abs,
    pnlPct: t.profit_ratio == null ? null : t.profit_ratio * 100,
    profitUnknown: t.profit_unknown || t.profit_abs == null,
    stake: t.stake_amount,
    notional: t.amount * t.open_rate,
    amount: t.amount,
    dcaFilled: t.dca_entries ?? 0,
    dcaMax: null,
    liquidationPrice: null,
    liqDistancePct: null,
    durationMs: closeMs == null ? 0 : Math.max(0, closeMs - t.open_ms),
    percentile: null,
    openMs: t.open_ms,
    closeMs,
    exitReason: t.exit_reason,
    exitPrice: t.close_rate,
    manual: t.manual,
    enterTag: t.enter_tag,
    open: closeMs == null,
    mae: t.mae ?? null,
    mfe: t.mfe ?? null,
    dcaEntries: t.dca_entries ?? null,
    ratio: t.profit_ratio,
  };
}

export type QuickFilter = 'all' | 'loss' | 'dca3' | 'xyz' | 'orphan';

export function matchesQuickFilter(l: TradeLine, f: QuickFilter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'loss':
      return l.pnlAbs !== null && l.pnlAbs < 0;
    case 'dca3':
      return l.dcaFilled >= 3;
    case 'xyz':
      return l.xyz;
    case 'orphan':
      return l.orphan;
  }
}

/** Open positions are listed worst P&L first; an unknown P&L goes last. */
export function compareWorstFirst(a: TradeLine, b: TradeLine): number {
  const x = a.pnlAbs;
  const y = b.pnlAbs;
  if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
  return x - y || a.key.localeCompare(b.key);
}

export type DurationTone = 'ok' | 'warn' | 'crit';

/** Percentile badge of the duration: shown from p84 (amber), critical from p91. */
export function durationTone(percentile: number | null): DurationTone {
  if (percentile == null) return 'ok';
  if (percentile >= 91) return 'crit';
  if (percentile >= 84) return 'warn';
  return 'ok';
}

/**
 * The duration of an open line in plain words: nothing while it is usual, "long" from p84 and
 * "longer than usual" from p91. The percentile itself only goes in the tooltip.
 */
export function durationNote(
  percentile: number | null,
): { tone: 'warn' | 'crit'; key: 'fq.trade.dur.warn' | 'fq.trade.dur.crit'; pct: number } | null {
  const tone = durationTone(percentile);
  if (tone === 'ok' || percentile == null) return null;
  return { tone, key: `fq.trade.dur.${tone}`, pct: Math.round(percentile) };
}

/** Tone of the liquidation distance: under 15 % is critical (the rule `nearLiquidation`). */
export function liqTone(distancePct: number | null): 'ok' | 'warn' | 'crit' | 'neutral' {
  if (distancePct == null) return 'neutral';
  if (distancePct < 15) return 'crit';
  if (distancePct < 25) return 'warn';
  return 'neutral';
}

/**
 * Normalised ladder of a position: left is the liquidation, right is the take profit, whatever the
 * side (02 section 5.1). Without a take profit the right end is only an axis bound, and no TP
 * marker is drawn. Returns null when neither the liquidation nor the TP is known: there is nothing
 * honest to draw.
 */
export function ladderOf(
  l: Pick<TradeLine, 'entry' | 'current' | 'liquidationPrice' | 'dcaFilled' | 'dcaMax' | 'side'>,
  tp: number | null = null,
): DcaLadderHPosition | null {
  const liq = l.liquidationPrice;
  if (liq == null && tp == null) return null;
  const price = l.current ?? l.entry;
  const sign = l.side === 'short' ? -1 : 1;
  // Axis bounds as distances along the favourable direction
  const lo = liq ?? l.entry - sign * Math.abs((tp as number) - l.entry);
  const hi = tp ?? l.entry + sign * Math.abs(l.entry - lo) * 0.25;
  const span = hi - lo;
  const norm = (v: number) => (span === 0 ? 0.5 : Math.max(0, Math.min(1, (v - lo) / span)));
  const max = Math.max(l.dcaMax ?? l.dcaFilled, l.dcaFilled, 1);
  return {
    filled: Math.max(1, l.dcaFilled),
    max,
    avg: norm(l.entry),
    tp: tp == null ? undefined : 1,
    price: norm(price),
  };
}

/** Short label of a pair: `TAO` for `TAO/USDC:USDC`, `NVDA` for `xyz:NVDA/USDC:USDC`. */
export function pairLabel(pair: string): string {
  const head = pair.includes(':') && pair.includes('/') ? pair.split('/')[0]! : pair;
  const colon = head.indexOf(':');
  return colon >= 0 && !pair.includes('/') ? head : head.slice(colon >= 0 ? colon + 1 : 0);
}
