/**
 * Freqtrade REST payloads to the entities of the data layer (`types.gen.ts`). Pure functions: the
 * numbers they derive come from `../calc`, validated on the shared vectors.
 *
 * Unknown stays unknown: a missing profit is `null` (and `profit_unknown` on closed trades), never
 * 0, and a missing exit reason is "inconnu", never a guess.
 */
import type { BotMode, BotKey, LogLine, OpenRisk, Position, TradeRow } from '@/gateway/types.gen';
import type { ClosedTrade, Trade } from '@/types';

import { adversePct } from '../calc/alerts/rules';
import { durationMs } from '../calc/duration';
import { normalizeExitReason } from '../calc/exitReason';
import { computeFreshness } from '../calc/freshness';
import { parsePair } from '../calc/hip3';
import { normalizeTsMs, parseDateMs } from '../calc/time';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const positiveOrNull = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

/** Open timestamp in ms from the trade (`open_timestamp` is ms; the date string is the fallback). */
function openMsOf(t: { open_timestamp?: number; open_date?: string }): number {
  return (
    (t.open_timestamp != null ? normalizeTsMs(t.open_timestamp) : null) ??
    (t.open_date ? parseDateMs(t.open_date) : null) ??
    0
  );
}

export interface PositionContext {
  botKey: BotKey;
  nowMs: number;
  /** When the `/status` answer was obtained (client clock). */
  asOfMs: number;
  /** Polling period of `/status` for this bot, for the staleness threshold. */
  cadenceMs: number;
}

export function mapOpenTrade(t: Trade, ctx: PositionContext): Position {
  const side = t.is_short ? 'short' : 'long';
  const info = parsePair(t.pair);
  const rate = num(t.current_rate);
  const liq = positiveOrNull(t.liquidation_price);
  const stop = positiveOrNull(t.stop_loss_abs);
  const openMs = openMsOf(t);
  return {
    bot_key: ctx.botKey,
    trade_id: t.trade_id,
    pair: t.pair,
    coin: info.coin_key,
    market: info.market,
    side,
    leverage: num(t.leverage) ?? 1,
    amount: t.amount,
    stake_amount: t.stake_amount,
    notional: Math.abs(t.amount * (rate ?? t.open_rate)),
    open_rate: t.open_rate,
    current_rate: rate,
    profit_abs: num(t.profit_abs),
    profit_ratio: num(t.profit_ratio),
    stoploss_abs: stop,
    liquidation_price: liq,
    liq_distance_pct:
      rate !== null && rate > 0 && liq !== null ? Math.max(adversePct(side, rate, liq), 0) : null,
    dca_entries: num(t.nr_of_successful_entries) ?? 1,
    open_ms: openMs,
    duration_ms: durationMs(openMs, null, ctx.nowMs),
    // The percentile needs the closed history of the bot: gateway only (02 section 10.4).
    percentile: null,
    orphan: false,
    freshness: computeFreshness('rest', ctx.asOfMs, ctx.nowMs, ctx.cadenceMs, true),
  };
}

/** What the worst-point projection of the drawdown needs from an open trade. */
export function toOpenRisk(t: Trade): OpenRisk {
  return {
    profit_abs: num(t.profit_abs) ?? 0,
    amount: t.amount,
    open_rate: t.open_rate,
    current_rate: num(t.current_rate),
    is_short: t.is_short === true,
    min_rate: num(t.min_rate),
    max_rate: num(t.max_rate),
  };
}

export function mapClosedTrade(t: ClosedTrade, botKey: BotKey, mode: BotMode): TradeRow {
  const info = parsePair(t.pair);
  const profit = num(t.profit_abs);
  const closeMs =
    (t.close_timestamp != null ? normalizeTsMs(t.close_timestamp) : null) ??
    (t.close_date ? parseDateMs(t.close_date) : null);
  return {
    bot_key: botKey,
    trade_id: t.trade_id,
    pair: t.pair,
    market: info.market,
    side: t.is_short ? 'short' : 'long',
    mode,
    leverage: num(t.leverage) ?? 1,
    open_ms: openMsOf(t),
    close_ms: closeMs,
    open_rate: t.open_rate,
    close_rate: num(t.close_rate),
    amount: t.amount,
    stake_amount: t.stake_amount,
    profit_abs: profit,
    profit_ratio: num(t.profit_ratio),
    profit_unknown: profit === null,
    exit_reason: normalizeExitReason(t.exit_reason),
    enter_tag: t.enter_tag ?? null,
    manual: false,
  };
}

/** A position seen as a row of the trade tables (open preset). */
export function positionToTradeRow(p: Position, mode: BotMode): TradeRow {
  return {
    bot_key: p.bot_key,
    trade_id: p.trade_id,
    pair: p.pair,
    market: p.market,
    side: p.side,
    mode,
    leverage: p.leverage,
    open_ms: p.open_ms,
    close_ms: null,
    open_rate: p.open_rate,
    close_rate: null,
    amount: p.amount,
    stake_amount: p.stake_amount,
    profit_abs: p.profit_abs,
    profit_ratio: p.profit_ratio,
    profit_unknown: p.profit_abs === null,
    exit_reason: normalizeExitReason(null),
    enter_tag: null,
    manual: false,
  };
}

/** `[formatted date, timestamp, module, level, message]` tuples of `GET /logs`. */
export function mapLogs(lines: unknown): LogLine[] {
  if (!Array.isArray(lines)) return [];
  const out: LogLine[] = [];
  for (const l of lines) {
    if (!Array.isArray(l) || l.length < 5) continue;
    const ts = typeof l[1] === 'number' ? normalizeTsMs(l[1]) : parseDateMs(String(l[0] ?? ''));
    if (ts === null) continue;
    out.push({ ts_ms: ts, level: String(l[3]), message: String(l[4]) });
  }
  return out;
}
