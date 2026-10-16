/**
 * What the direct mode knows about a bot (raw answers with their age) and the pure functions that
 * turn it into the entities of the data layer. Everything numeric goes through `../calc`.
 *
 * Direct mode never invents a figure: when the source of a number is missing it is `null`, and the
 * freshness of each group says where it came from and how old it is.
 */
import type {
  AlertSummary,
  BotMode,
  BotRow,
  BotStatus,
  Freshness,
  FreshnessGroup,
  LogLine,
  TradeRow,
} from '@/gateway/types.gen';
import type { BalanceInterface, BotState, FleetviewBot, ProfitStats, Trade } from '@/types';
import type { FleetBotDigest } from '@/types/fleetSnapshot';

import { computeDrawdown } from '../calc/drawdown';
import { computeFreshness } from '../calc/freshness';
import { startingCapital } from '../calc/capital';
import { whitelistMarket } from '../calc/hip3';
import { normalizeTsMs } from '../calc/time';
import { periodCutoffMs, profitSince } from '../calc/periods';
import type { ClosedPnl } from '@/gateway/types.gen';

import { toOpenRisk } from './mappers';

export interface Fetched<T> {
  data: T;
  /** Client time the answer was obtained. */
  atMs: number;
}

/** Closed trades loaded so far for a bot (newest first as the API returns them). */
export interface ClosedHistory {
  rows: TradeRow[];
  /** `total_trades` reported by the bot. */
  total: number | null;
  /** Everything the bot has is loaded: totals over `rows` are totals of the bot. */
  complete: boolean;
  atMs: number;
}

export type Reachability = 'unknown' | 'online' | 'starting' | 'offline' | 'auth_expired';

export interface BotRuntime {
  /** `ftbot.N`, the key of `ftAuthLoginInfo`. */
  id: string;
  key: string;
  name: string;
  icon: string | null;
  port: number | null;
  sortId: number;
  reach: Reachability;
  /** Since when `reach` has been what it is (client clock). */
  reachSinceMs: number | null;
  /** Last time any request got a usable answer. */
  lastContactMs: number | null;
  config: Fetched<BotState> | null;
  profit: Fetched<ProfitStats> | null;
  balance: Fetched<BalanceInterface> | null;
  status: Fetched<Trade[]> | null;
  whitelist: Fetched<string[]> | null;
  logs: Fetched<LogLine[]> | null;
  closed: ClosedHistory | null;
  overview: Fetched<FleetviewBot> | null;
  digest: Fetched<FleetBotDigest> | null;
}

export function newRuntime(
  id: string,
  key: string,
  name: string,
  icon: string | null,
  port: number | null,
  sortId: number,
): BotRuntime {
  return {
    id,
    key,
    name,
    icon,
    port,
    sortId,
    reach: 'unknown',
    reachSinceMs: null,
    lastContactMs: null,
    config: null,
    profit: null,
    balance: null,
    status: null,
    whitelist: null,
    logs: null,
    closed: null,
    overview: null,
    digest: null,
  };
}

export interface Cadences {
  statusMs: number;
  slowMs: number;
  digestMs: number;
  overviewMs: number;
}

/** Display name: what the bot reported, then the digest, then the label given in the login. */
export function nameOf(rt: BotRuntime): string {
  return (
    rt.config?.data.bot_name || rt.overview?.data.bot_name || rt.digest?.data.bot_name || rt.name
  );
}

function dryFlag(rt: BotRuntime): boolean | undefined {
  return rt.config?.data.dry_run ?? rt.overview?.data.dry_run ?? rt.digest?.data.dry_run;
}

/**
 * Whether the bot told us if it is live or dry yet. Until it does (`/show_config` is read at the
 * slow cadence, behind the status of the whole fleet), its figures belong to neither total.
 */
export function modeKnown(rt: BotRuntime): boolean {
  return dryFlag(rt) !== undefined;
}

export function modeOf(rt: BotRuntime): BotMode {
  // Unknown is treated as live for what is confirmed (the stricter confirmation applies), but
  // `modeKnown` keeps such a bot out of every sum and out of the wallet inference.
  return dryFlag(rt) === true ? 'dry' : 'live';
}

export function statusOf(rt: BotRuntime): BotStatus {
  // A bot answering whose mode is not read yet is still starting for the UI: not counted online,
  // and no action can be sent to it before its mode (live confirmation level) is known
  if (rt.reach === 'online' && !modeKnown(rt)) return 'starting';
  switch (rt.reach) {
    case 'offline':
      return 'offline';
    case 'auth_expired':
      return 'auth_expired';
    case 'starting':
    case 'unknown':
      return 'starting';
    default:
      return 'online';
  }
}

export function exchangeOf(rt: BotRuntime): string | null {
  return rt.config?.data.exchange ?? rt.digest?.data.exchange ?? null;
}

export function isFutures(rt: BotRuntime): boolean {
  const mode = rt.config?.data.trading_mode ?? rt.digest?.data.trading_mode;
  return mode === 'futures';
}

/**
 * Wallet of each bot. The REST API never exposes the wallet address, so it is inferred: live bots
 * on the same exchange are taken to share a wallet (true on this fleet), a lone live bot has its
 * own, and a dry bot has a virtual one. If two "shared" bots disagree on the balance, the wallet
 * totals report it as conflicting instead of hiding it.
 */
export function inferWallets(
  rts: readonly BotRuntime[],
): Map<string, { walletId: string; shared: boolean }> {
  const liveByExchange = new Map<string, BotRuntime[]>();
  for (const rt of rts) {
    if (modeOf(rt) !== 'live' || !modeKnown(rt)) continue;
    const ex = exchangeOf(rt) ?? '?';
    const list = liveByExchange.get(ex) ?? [];
    list.push(rt);
    liveByExchange.set(ex, list);
  }
  const out = new Map<string, { walletId: string; shared: boolean }>();
  for (const rt of rts) {
    if (modeOf(rt) !== 'live' || !modeKnown(rt)) {
      out.set(rt.key, { walletId: `dry:${rt.key}`, shared: false });
      continue;
    }
    const group = liveByExchange.get(exchangeOf(rt) ?? '?') ?? [];
    out.set(
      rt.key,
      group.length > 1
        ? { walletId: `shared:${exchangeOf(rt) ?? '?'}`, shared: true }
        : { walletId: `solo:${rt.key}`, shared: false },
    );
  }
  return out;
}

export interface RowContext {
  nowMs: number;
  walletId: string | null;
  walletShared: boolean;
  alerts: AlertSummary;
  cadences: Cadences;
  /** Cadence in force for this bot (focus makes it faster). */
  statusCadenceMs: number;
  slowCadenceMs: number;
}

function closedPnl(h: ClosedHistory): ClosedPnl[] {
  return h.rows
    .filter((r) => r.close_ms !== null && r.profit_abs !== null)
    .map((r) => ({ ts_ms: r.close_ms as number, profit_abs: r.profit_abs as number }));
}

/** Sum of the open profit of the polled positions, null when they were never fetched. */
function latentOf(rt: BotRuntime): number | null {
  if (!rt.status) return null;
  let sum = 0;
  for (const t of rt.status.data) {
    if (typeof t.profit_abs === 'number' && Number.isFinite(t.profit_abs)) sum += t.profit_abs;
  }
  return sum;
}

export function startingCapitalOf(rt: BotRuntime, walletShared: boolean): number | null {
  const ov = rt.overview?.data.capital;
  return startingCapital({
    available_capital: rt.config?.data.available_capital ?? ov?.available_capital ?? null,
    capital_withdrawal: rt.profit?.data.capital_withdrawal ?? ov?.capital_withdrawal ?? null,
    wallet_shared: walletShared,
    bot_managed_balance: rt.balance?.data.total_bot ?? null,
    balance_total: rt.balance?.data.total ?? rt.digest?.data.balance_total ?? null,
    profit_all_coin: rt.profit?.data.profit_all_coin ?? null,
  }).value;
}

export function buildBotRow(rt: BotRuntime, ctx: RowContext): BotRow {
  const { nowMs } = ctx;
  const mode = modeOf(rt);
  const cfg = rt.config?.data;
  const profit = rt.profit?.data;
  const ov = rt.overview?.data;
  const dg = rt.digest?.data;
  const closed = rt.closed && rt.closed.complete ? rt.closed : null;

  // ---- identity ----
  const wl = rt.whitelist?.data ?? [];
  const identity: BotRow['identity'] = {
    name: nameOf(rt),
    icon: rt.icon,
    mode,
    strategy: cfg?.strategy ?? ov?.strategy ?? dg?.strategy ?? null,
    exchange: exchangeOf(rt),
    market: wl.length > 0 ? (whitelistMarket(wl) ?? 'crypto') : 'crypto',
    stake_currency: cfg?.stake_currency ?? dg?.stake_currency ?? 'USDC',
    port: rt.port,
    timeframe: cfg?.timeframe || null,
    ui_ids: [rt.id],
    incarnation: `${nameOf(rt)}|${cfg?.strategy ?? ''}`,
  };

  // ---- metrics ----
  const digestFresh = rt.digest ? rt.digest.data.age_s * 1000 <= 120_000 : false;
  const latent = latentOf(rt);
  const sinceCut = (key: '24h' | '7d' | '30d'): number | null => {
    if (!closed) return null;
    return profitSince(closedPnl(closed), periodCutoffMs(key, nowMs));
  };
  const realizedTotal =
    ov?.pnl.realized_total ??
    (closed ? closedPnl(closed).reduce((a, p) => a + p.profit_abs, 0) : null) ??
    profit?.profit_closed_coin ??
    (digestFresh ? (dg?.closed_profit_abs ?? null) : null);
  const capital = startingCapitalOf(rt, ctx.walletShared);
  const positions = rt.status?.data ?? [];

  let exposureLong: number | null = null;
  let exposureShort: number | null = null;
  if (rt.status) {
    exposureLong = 0;
    exposureShort = 0;
    for (const t of positions) {
      const notional = Math.abs(t.amount * (t.current_rate ?? t.open_rate));
      if (t.is_short) exposureShort += notional;
      else exposureLong += notional;
    }
  }

  let drawdownRealized: BotRow['metrics']['drawdown_realized'] = null;
  let drawdownWithOpen: BotRow['metrics']['drawdown_with_open'] = null;
  if (closed && rt.status) {
    const dd = computeDrawdown({
      closed: closedPnl(closed),
      open: positions.map(toOpenRisk),
      histories: [],
      starting_capital: capital,
      now_ms: nowMs,
    });
    drawdownRealized = dd.realized;
    drawdownWithOpen = dd.with_open;
  }

  const wins = profit?.winning_trades;
  const losses = profit?.losing_trades;
  const lastTradeMs =
    profit && profit.latest_trade_timestamp ? normalizeTsMs(profit.latest_trade_timestamp) : null;

  const metrics: BotRow['metrics'] = {
    realized_1d: ov?.pnl.realized_1d ?? sinceCut('24h'),
    realized_7d: ov?.pnl.realized_7d ?? sinceCut('7d'),
    realized_30d: ov?.pnl.realized_30d ?? sinceCut('30d'),
    realized_total: realizedTotal,
    open_profit_abs: latent ?? (digestFresh ? (dg?.open_profit_abs ?? null) : null),
    starting_capital: capital,
    exposure_long: exposureLong,
    exposure_short: exposureShort,
    drawdown_realized: drawdownRealized,
    drawdown_with_open: drawdownWithOpen,
    last_trade_ms: lastTradeMs,
    trades_closed: profit?.closed_trade_count ?? ov?.trades.closed_count ?? null,
    winrate:
      typeof wins === 'number' && typeof losses === 'number' && wins + losses > 0
        ? wins / (wins + losses)
        : null,
    // The 24 h sparkline needs the server's hourly samples: gateway only.
    spark24h: [],
  };
  if (!modeKnown(rt)) {
    // Live or dry, we do not know yet: no money figure that a total could pick up
    metrics.realized_1d = null;
    metrics.realized_7d = null;
    metrics.realized_30d = null;
    metrics.realized_total = null;
    metrics.open_profit_abs = null;
    metrics.exposure_long = null;
    metrics.exposure_short = null;
    metrics.drawdown_realized = null;
    metrics.drawdown_with_open = null;
  }

  // ---- state ----
  const openCount = rt.status
    ? positions.length
    : (ov?.trades.open_count ?? (digestFresh ? (dg?.open_trade_count ?? 0) : 0));
  const state: BotRow['state'] = {
    status: statusOf(rt),
    since_ms: rt.reachSinceMs,
    wallet_id: ctx.walletId,
    open_trades: openCount,
    max_open_trades: cfg?.max_open_trades ?? dg?.max_open_trades ?? null,
    first_real_trade_ms: profit?.first_trade_timestamp
      ? normalizeTsMs(profit.first_trade_timestamp)
      : null,
    started_ms: profit?.bot_start_timestamp
      ? normalizeTsMs(profit.bot_start_timestamp)
      : ov?.uptime.process_start
        ? normalizeTsMs(ov.uptime.process_start)
        : null,
  };

  // ---- freshness, group by group ----
  const freshness: Partial<Record<FreshnessGroup, Freshness>> = {};
  if (rt.lastContactMs !== null) {
    freshness.state = computeFreshness('rest', rt.lastContactMs, nowMs, ctx.statusCadenceMs);
  }
  const metricAges: Array<[Freshness['source'], number, number]> = [];
  if (rt.overview) metricAges.push(['python', rt.overview.atMs, ctx.cadences.overviewMs]);
  if (rt.profit) metricAges.push(['rest', rt.profit.atMs, ctx.slowCadenceMs]);
  if (rt.status) metricAges.push(['rest', rt.status.atMs, ctx.statusCadenceMs]);
  if (metricAges.length > 0) {
    // The group is as old as the OLDEST figure it is made of: a mix is never shown fresher.
    const [source, atMs, cadence] = metricAges.reduce((a, b) => (b[1] < a[1] ? b : a));
    freshness.metrics = computeFreshness(source, atMs, nowMs, cadence);
  } else if (rt.digest) {
    freshness.metrics = computeFreshness(
      'digest',
      rt.digest.atMs - rt.digest.data.age_s * 1000,
      nowMs,
    );
  }
  if (rt.status) {
    freshness.positions = computeFreshness(
      'rest',
      rt.status.atMs,
      nowMs,
      ctx.statusCadenceMs,
      true,
    );
  }
  const capAges = [rt.config?.atMs, rt.balance?.atMs, rt.overview?.atMs].filter(
    (x): x is number => typeof x === 'number',
  );
  if (capAges.length > 0) {
    freshness.capital = computeFreshness('rest', Math.min(...capAges), nowMs, ctx.slowCadenceMs);
  }

  return {
    bot_key: rt.key,
    identity,
    state,
    metrics,
    alerts: ctx.alerts,
    freshness,
  };
}
