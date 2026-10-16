/**
 * Deterministic fixtures of the batch B composites (curves, calendar, Journal analysis, logs,
 * candles, pair navigator, registry, reconciliation), with the edge cases the design asks for:
 * trades with an unknown profit, an unknown, a custom and a manual exit reason, a heavy left tail,
 * a DCA ladder of 7 orders, lines of log that repeat or carry a traceback, a pair held by two bots,
 * an orphan coin and an ambiguous one. Everything is fake. The data source double only answers
 * reads: any other method on the proxy throws, so a test proves nothing was written.
 */
import { ref } from 'vue';

import { normalizeExitReason } from '@/datasource/calc/exitReason';
import { computeDrawdown } from '@/datasource/calc/drawdown';
import { pnlPeriods } from '@/datasource/calc/periods';
import { tradeTotals } from '@/datasource/calc/stats';
import type {
  ChannelParams,
  ChannelUpdate,
  DataSource,
  DiscoveredBot,
  EquitySeries,
  Page,
  PeriodQuery,
  RegistryBot,
  SourceStatus,
  TradePage,
  TradeQuery,
} from '@/datasource/types';
import type { BotRow, ClosedPnl, DrawdownResult, LogLine } from '@/gateway/types.gen';
import type { MigrationRecord } from '@/migration/schema';
import type { FleetviewCoin } from '@/types/fleetview';

import type { JournalTrade } from '../lib/journal';
import { FIXTURE_NOW, type FleetFixture } from './index';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const PAIRS = [
  'NEAR/USDC:USDC',
  'AVAX/USDC:USDC',
  'SEI/USDC:USDC',
  'TAO/USDC:USDC',
  'HYPE/USDC:USDC',
  'WIF/USDC:USDC',
  'SOL/USDC:USDC',
  'xyz:NVDA/USDC:USDC',
];
const REASONS = [
  'roi',
  'roi',
  'roi',
  'exit_signal',
  'exit_signal',
  'trailing_stop_loss',
  'stop_loss',
];

// ---- closed trades ----

/**
 * `n` closed trades of the live bots of the fixture over the last `days` days, newest first. Most
 * are small gains, with a heavy left tail on the deep DCA ladders; the first ones carry the edge
 * cases (unknown profit, unknown reason, custom reason, human exit, no excursion).
 */
export function makeClosedTrades(bots: BotRow[], n = 96, days = 14): JournalTrade[] {
  const r = rng(777);
  const live = bots.filter((b) => b.identity.mode === 'live' && b.state.status !== 'starting');
  const out: JournalTrade[] = [];
  for (let k = 0; k < n; k++) {
    const bot = live[Math.floor(r() * live.length)]!;
    const dca = 1 + Math.floor(Math.pow(r(), 1.7) * 7);
    const deep = dca >= 5;
    let pct = deep
      ? r() < 0.3
        ? -(4 + r() * 10)
        : 0.8 + r() * 2.2
      : r() < 0.12
        ? -(0.5 + r() * 4)
        : 0.6 + r() * 2.6;
    const stake = 20 + (r() * 120 * dca) / 2;
    let reason: string | null =
      pct < -3 ? (r() < 0.6 ? 'stop_loss' : 'force_exit') : REASONS[Math.floor(r() * 6)]!;
    const unknownProfit = k === 5;
    if (k === 7 || k === 41) reason = null;
    if (k === 11) reason = 'custom_exit_rsi_overbought';
    if (k === 13) pct = -8.5;
    const closeMs = FIXTURE_NOW - ((k * (days * 24 * 0.9)) / n + r()) * HOUR;
    const durH = dca * (2 + r() * 9);
    const profit = unknownProfit ? null : (stake * pct) / 100;
    const noExcursion = k % 17 === 3;
    out.push({
      bot_key: bot.bot_key,
      trade_id: 1000 + k,
      pair: PAIRS[Math.floor(r() * PAIRS.length)]!,
      market: 'crypto',
      side: bot.metrics.exposure_short && r() < 0.5 ? 'short' : 'long',
      mode: 'live',
      leverage: 2,
      open_ms: closeMs - durH * HOUR,
      close_ms: closeMs,
      open_rate: 100 + k,
      close_rate: 100 + k + pct,
      amount: stake / 100,
      stake_amount: stake,
      profit_abs: profit,
      profit_ratio: unknownProfit ? null : pct / 100,
      profit_unknown: unknownProfit,
      exit_reason: normalizeExitReason(reason),
      enter_tag: null,
      manual: reason === 'force_exit',
      dca_entries: dca,
      mae: noExcursion ? null : Math.min(pct, -(0.3 + r() * dca * 1.8)) / 100,
      mfe: noExcursion ? null : Math.max(pct, r() * 2.6) / 100,
    });
  }
  return out;
}

export function closedPnlOf(trades: readonly JournalTrade[]): ClosedPnl[] {
  return trades
    .filter((t) => t.close_ms !== null && t.profit_abs !== null && !t.profit_unknown)
    .map((t) => ({ ts_ms: t.close_ms as number, profit_abs: t.profit_abs as number }));
}

/** A longer history for the calendar: one small result a day for 400 days, with a few big days. */
export function makeDailyPnl(days = 400): ClosedPnl[] {
  const r = rng(31);
  const out: ClosedPnl[] = [];
  for (let d = 0; d < days; d++) {
    const trades = Math.floor(r() * 5);
    for (let k = 0; k < trades; k++) {
      const big = r() < 0.05;
      out.push({
        ts_ms: FIXTURE_NOW - d * DAY - Math.floor(r() * 20) * HOUR,
        profit_abs: (r() - 0.38) * (big ? 160 : 40),
      });
    }
  }
  return out;
}

// ---- equity ----

/** Cumulative profit sampled every `stepMs`, from `fromMs` (default 7 days) to the fixture now. */
export function makeEquity(
  def: 'realized' | 'with_open',
  fromMs: number = FIXTURE_NOW - 7 * DAY,
  stepMs: number = HOUR,
): EquitySeries {
  const r = rng(def === 'realized' ? 5 : 6);
  const points: Array<[number, number]> = [];
  let v = 0;
  for (let ts = fromMs; ts <= FIXTURE_NOW; ts += stepMs) {
    v += (r() - 0.46) * 9;
    // The open-inclusive curve wanders around the realized one
    const wander = def === 'with_open' ? Math.sin(ts / (6 * HOUR)) * 22 : 0;
    points.push([ts, Math.round((v + wander) * 100) / 100]);
  }
  return { mode: def, points, unavailable: null, asOfMs: FIXTURE_NOW };
}

export function makeDrawdown(closed: readonly ClosedPnl[]): DrawdownResult {
  return computeDrawdown({
    closed: [...closed],
    open: [],
    histories: [],
    history_trades: [],
    starting_capital: 9000,
    now_ms: FIXTURE_NOW,
  });
}

// ---- logs ----

export function makeLogLines(): LogLine[] {
  const base = FIXTURE_NOW;
  const trace =
    'Traceback (most recent call last):\n  File "exchange.py", line 112, in fetch\n    raise DDosProtection("429")\nDDosProtection: 429 Too Many Requests';
  return [
    { ts_ms: base - 5_000, level: 'ERROR', message: `Could not fetch balance.\n${trace}` },
    { ts_ms: base - 9_000, level: 'WARNING', message: 'Order for NEAR not filled after 60 s' },
    // The same text twice in the same millisecond: both are real lines
    { ts_ms: base - 20_000, level: 'ERROR', message: 'Rate limit hit on /info' },
    { ts_ms: base - 20_000, level: 'ERROR', message: 'Rate limit hit on /info' },
    // Two different lines that start alike (the old 40-character key merged them)
    {
      ts_ms: base - 30_000,
      level: 'ERROR',
      message: 'Unable to place order for TAO/USDC:USDC because of insufficient margin on wallet A',
    },
    {
      ts_ms: base - 30_000,
      level: 'ERROR',
      message: 'Unable to place order for TAO/USDC:USDC because of insufficient margin on wallet B',
    },
    { ts_ms: base - 45_000, level: 'CRITICAL', message: 'Bot heartbeat lost' },
    { ts_ms: base - 60_000, level: 'INFO', message: 'Found no signals for whitelisted pairs' },
    { ts_ms: base - 80_000, level: 'DEBUG', message: 'Dataframe analysed for SOL/USDC:USDC' },
  ];
}

// ---- candles ----

export interface CandleFixture {
  columns: string[];
  data: number[][];
  timeframe_ms: number;
}

/** A 15 m series of `n` candles ending at the fixture now, with an EMA and an RSI column. */
export function makeCandles(n = 400, startPrice = 4.91, seed = 12): CandleFixture {
  const r = rng(seed);
  const tf = 15 * 60_000;
  const rows: number[][] = [];
  let close = startPrice;
  let ema = close;
  let up = 0;
  let down = 0;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = open * (1 + (r() - 0.495) * 0.012);
    const high = Math.max(open, close) * (1 + r() * 0.004);
    const low = Math.min(open, close) * (1 - r() * 0.004);
    const ts = FIXTURE_NOW - (n - 1 - i) * tf;
    ema = ema + (close - ema) * (2 / 51);
    const d = close - open;
    up = up * 0.93 + Math.max(0, d);
    down = down * 0.93 + Math.max(0, -d);
    const rsi = down === 0 ? 100 : 100 - 100 / (1 + up / down);
    rows.push([ts, open, high, low, close, 800 + r() * 4000, ts, ema, rsi]);
  }
  return {
    columns: ['date', 'open', 'high', 'low', 'close', 'volume', '__date_ts', 'ema_50', 'rsi'],
    data: rows,
    timeframe_ms: tf,
  };
}

// ---- registry ----

export function makeRegistry(fixture: FleetFixture): {
  bots: RegistryBot[];
  discovered: DiscoveredBot[];
  migration: MigrationRecord;
} {
  const bots: RegistryBot[] = fixture.bots.slice(0, 14).map((b, i) => ({
    botKey: b.bot_key,
    uiId: i === 13 ? null : `ftbot.${i + 1}`,
    name: b.identity.name,
    icon: null,
  }));
  return {
    bots,
    discovered: [
      { botKey: 'local:9496', name: 'kelt_dpo_long', port: 9496, mode: 'dry' },
      { botKey: 'local:9508', name: 'zscore_pairs', port: 9508, mode: 'live' },
    ],
    migration: {
      v: 1,
      at: FIXTURE_NOW - 19 * HOUR,
      sourceHashes: {},
      report: {
        imported: ['ftAuthLoginInfo', 'ftBotComparison'],
        skipped: [],
        unmappedBots: ['ftbot.31'],
        droppedColumns: [],
        forcedConfirmation: true,
        localeFallback: false,
      },
    },
  };
}

// ---- reconciliation ----

export function makeRecon(): FleetviewCoin[] {
  const slice = (bot: string, id: number, amount: number) => ({
    bot_name: bot,
    port: 9400,
    trade_id: id,
    pair: 'X/USDC:USDC',
    signed_amount: amount,
    open_rate: 1,
    stake_amount: 100,
  });
  return [
    {
      coin: 'HYPE',
      db_sum: 230,
      on_chain: 230,
      mark_price: 38.9,
      on_chain_leverage: 2,
      unrealized_pnl: 12.4,
      status: 'ok',
      slices: [
        slice('hippo_multi', 1, 100),
        slice('dynv1_long', 2, 80),
        slice('hippo_stocks', 3, 50),
      ],
      phantom_candidate: null,
      minority_slices: [],
    },
    {
      coin: 'PENGU',
      db_sum: 0,
      on_chain: -18_000,
      mark_price: 0.0118,
      on_chain_leverage: 2,
      unrealized_pnl: -26.12,
      status: 'unowned',
      slices: [],
      phantom_candidate: null,
      minority_slices: [],
    },
    {
      coin: 'WIF',
      db_sum: -312.1,
      on_chain: -312.1,
      mark_price: 1.531,
      on_chain_leverage: 2,
      unrealized_pnl: 4.3,
      status: 'ok',
      slices: [
        slice('hippo_multi', 4, -100),
        slice('dynv1_short', 5, -112.1),
        slice('hippo_mat', 6, -100),
      ],
      phantom_candidate: null,
      minority_slices: [],
    },
    {
      coin: 'SEI',
      db_sum: 5200,
      on_chain: 0,
      mark_price: 0.4012,
      on_chain_leverage: null,
      unrealized_pnl: 0,
      status: 'phantom',
      slices: [slice('hippo_short_sharpe', 1162, 5200)],
      phantom_candidate: { bot_name: 'hippo_short_sharpe', trade_id: 1162 },
      minority_slices: [],
    },
    {
      coin: 'TAO',
      db_sum: 3,
      on_chain: 2,
      mark_price: 342.5,
      on_chain_leverage: 2,
      unrealized_pnl: 8.1,
      status: 'ambiguous',
      slices: [slice('hippo_multi', 7, 2), slice('dynv1_long', 8, 1)],
      phantom_candidate: null,
      minority_slices: [],
      hints: [{ code: 'refresh_first' }, { code: 'partial_fill' }],
    },
  ];
}

// ---- a data source that only reads ----

export interface SourceBOptions {
  trades?: JournalTrade[];
  daily?: ClosedPnl[];
  logs?: LogLine[];
  candles?: CandleFixture;
  /** Hold every answer until `release()` (races). */
  manual?: boolean;
}

export interface SourceB {
  source: DataSource;
  /** Proxy calls, in order. Only GET exists: any other method throws and is recorded in `refused`. */
  proxyCalls: Array<{ botKey: string; method: string; path: string }>;
  refused: string[];
  queries: { trades: TradeQuery[]; periods: PeriodQuery[]; logs: Array<Record<string, unknown>> };
  /** Push an update to the subscribers of a channel. */
  push: <C extends keyof ChannelParams>(ch: C, update: ChannelUpdate[C]) => void;
  subscriptions: () => string[];
  /** Replace the next answers. */
  failNext: { trades: boolean; logs: boolean; proxy: boolean };
  hold: { logs: Array<() => void> };
  slowLogs: boolean;
}

export function sourceB(fixture: FleetFixture, opts: SourceBOptions = {}): SourceB {
  const trades = opts.trades ?? makeClosedTrades(fixture.bots);
  const daily = opts.daily ?? makeDailyPnl();
  const candles = opts.candles ?? makeCandles();
  const logs = opts.logs ?? makeLogLines();
  const sinks = new Map<string, Set<(u: never) => void>>();
  const proxyCalls: SourceB['proxyCalls'] = [];
  const refused: string[] = [];
  const queries: SourceB['queries'] = { trades: [], periods: [], logs: [] };
  const failNext = { trades: false, logs: false, proxy: false };
  const hold: SourceB['hold'] = { logs: [] };
  const status = ref<SourceStatus>({
    state: 'live',
    lastSyncMs: FIXTURE_NOW,
    clockSkewMs: 0,
    latencyMs: 38,
    resyncing: false,
    reason: null,
  });

  const chKey = <C extends keyof ChannelParams>(ch: C, p: ChannelParams[C]) =>
    ch === 'logs'
      ? `logs:${(p as ChannelParams['logs']).botKey ?? '*'}`
      : ch === 'chart'
        ? `chart:${(p as ChannelParams['chart']).botKey}:${(p as ChannelParams['chart']).pair}:${(p as ChannelParams['chart']).timeframe}`
        : String(ch);

  const self: SourceB = {
    proxyCalls,
    refused,
    queries,
    failNext,
    hold,
    slowLogs: false,
    subscriptions: () => [...sinks.entries()].filter(([, s]) => s.size > 0).map(([k]) => k),
    push: (ch, update) => {
      for (const [k, set] of sinks) {
        if (k === ch || k.startsWith(`${ch}:`))
          for (const s of set) (s as (u: unknown) => void)(update);
      }
    },
    source: {
      kind: 'gateway',
      status,
      start: async () => undefined,
      stop: () => undefined,
      subscribe: ((
        ch: keyof ChannelParams,
        params: ChannelParams[keyof ChannelParams],
        sink: (u: never) => void,
      ) => {
        const key = chKey(ch, params as never);
        const set = sinks.get(key) ?? new Set();
        set.add(sink);
        sinks.set(key, set);
        return () => set.delete(sink);
      }) as DataSource['subscribe'],
      query: {
        trades: async (q: TradeQuery): Promise<TradePage> => {
          queries.trades.push(q);
          if (failNext.trades) {
            failNext.trades = false;
            throw new Error('gateway 503');
          }
          let list = trades.filter((t) => t.close_ms !== null);
          if (q.bots) list = list.filter((t) => q.bots?.includes(t.bot_key));
          if (q.mode) list = list.filter((t) => q.mode?.includes(t.mode));
          if (q.fromMs !== undefined)
            list = list.filter((t) => (t.close_ms as number) >= (q.fromMs as number));
          list = list.slice().sort((a, b) => (b.close_ms as number) - (a.close_ms as number));
          const start = q.cursor ? Number(q.cursor) : 0;
          const limit = q.limit ?? 50;
          const items = list.slice(start, start + limit);
          const next = start + limit < list.length ? String(start + limit) : null;
          return {
            items,
            nextCursor: next,
            complete: true,
            totals: tradeTotals(list.map((t) => (t.profit_unknown ? null : t.profit_abs))),
          };
        },
        periods: async (q: PeriodQuery) => {
          queries.periods.push(q);
          return pnlPeriods(daily, q.unit, q.tz, FIXTURE_NOW, q.n);
        },
        equity: async (q) => makeEquity(q.mode, q.fromMs ?? FIXTURE_NOW - 30 * DAY),
        drawdown: async () => makeDrawdown(closedPnlOf(trades)),
        logs: async (q): Promise<Page<LogLine>> => {
          queries.logs.push({ ...q });
          if (failNext.logs) {
            failNext.logs = false;
            throw new Error('gateway 503');
          }
          if (self.slowLogs) await new Promise<void>((res) => hold.logs.push(res));
          let items = logs.slice();
          if (q.q)
            items = items.filter((l) => l.message.toLowerCase().includes(q.q!.toLowerCase()));
          return { items, nextCursor: q.cursor ? null : 'older', complete: true };
        },
      } as unknown as DataSource['query'],
      act: async () => {
        refused.push('act');
        throw new Error('batch B never writes');
      },
      proxy: (async (botKey: string, method: string, path: string) => {
        proxyCalls.push({ botKey, method, path });
        if (method.toUpperCase() !== 'GET') {
          refused.push(`${method} ${path}`);
          throw new Error(`method ${method} refused by the test source`);
        }
        if (failNext.proxy) {
          failNext.proxy = false;
          throw new Error('bot timed out');
        }
        if (path.startsWith('/pair_candles')) {
          const limit = Number(/limit=(\d+)/.exec(path)?.[1] ?? candles.data.length);
          return { ...candles, data: candles.data.slice(-limit), pair: 'X', timeframe: '15m' };
        }
        if (path.startsWith('/plot_config')) {
          return {
            main_plot: { ema_50: { color: '#4cbbe9' } },
            subplots: {},
          };
        }
        if (path.startsWith('/signal_summary')) {
          return {
            pairs: {
              'TAO/USDC:USDC': { enter_short: 1 },
              'OP/USDC:USDC': { exit_long: 2 },
              'INJ/USDC:USDC': { enter_long: 1 },
              'SOL/USDC:USDC': {},
            },
          };
        }
        if (path.startsWith('/locks')) {
          return {
            locks: [
              {
                id: 7,
                pair: 'WIF/USDC:USDC',
                lock_end_timestamp: FIXTURE_NOW + 3 * HOUR,
                reason: 'StoplossGuard',
                active: true,
              },
              {
                id: 8,
                pair: 'OLD/USDC:USDC',
                lock_end_timestamp: FIXTURE_NOW - HOUR,
                reason: 'x',
                active: false,
              },
            ],
          };
        }
        if (path.startsWith('/whitelist')) {
          return {
            whitelist: ['SOL/USDC:USDC', 'NEAR/USDC:USDC', 'NEAR/USDC:USDC', 'HYPE/USDC:USDC'],
          };
        }
        const m = /^\/trade\/(\d+)/.exec(path);
        if (m) {
          const t = trades.find((x) => x.trade_id === Number(m[1]) && x.bot_key === botKey);
          if (!t) throw new Error('HTTP 404');
          return {
            trade_id: t.trade_id,
            pair: t.pair,
            is_short: t.side === 'short',
            leverage: t.leverage,
            open_timestamp: t.open_ms,
            close_timestamp: t.close_ms,
            open_rate: t.open_rate,
            close_rate: t.close_rate,
            amount: t.amount,
            stake_amount: t.stake_amount,
            profit_abs: t.profit_abs,
            profit_ratio: t.profit_ratio,
            exit_reason: t.exit_reason.raw,
            orders: [
              {
                order_id: 'a',
                ft_is_entry: true,
                safe_price: t.open_rate,
                amount: t.amount,
                filled: t.amount,
                order_filled_timestamp: t.open_ms,
              },
              {
                order_id: 'b',
                ft_is_entry: false,
                safe_price: t.close_rate ?? 0,
                amount: t.amount,
                filled: t.amount,
                order_filled_timestamp: t.close_ms,
              },
            ],
          };
        }
        throw new Error(`unexpected proxy path ${path}`);
      }) as DataSource['proxy'],
      registry: {
        list: async () => [],
        discovered: async () => [],
        botKeyOf: () => null,
        uiIdOf: () => null,
      },
      alerts: {} as DataSource['alerts'],
    } as DataSource,
  };
  return self;
}
