/**
 * Deterministic fixture data of the composites (the `/__ds` showcase and the component tests).
 * Everything is fake: names, keys, prices and wallets. The fleet covers the edge cases the design
 * asks for: 40 bots, stale, offline, starting, expired session and stopped bots, live and dry
 * (seeded or not), a replay bot, a shared wallet, long names, zero, negative and unknown values,
 * a position id held by two bots, an orphan position and a stale position.
 */
import { ref } from 'vue';

import { useFqAlertsStore } from '@/datasource/stores/alerts';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqEventsStore } from '@/datasource/stores/events';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqHealthStore } from '@/datasource/stores/health';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type {
  ActionResult,
  BotAction,
  DataSource,
  ScopeDetail,
  ScopeRef,
  ScopeTotals,
  SourceStatus,
  StateUpdate,
} from '@/datasource/types';
import type {
  Alert,
  BotKey,
  BotMode,
  BotRow,
  BotStatus,
  Event,
  Freshness,
  Health,
  Market,
  Position,
  Severity,
  WalletRow,
} from '@/gateway/types.gen';

/** Fixed "now": ages and screenshots never move. 2026-10-15 12:00:00 UTC. */
export const FIXTURE_NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const MIN = 60_000;
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

const fresh = (ageMs = 5_000, source: Freshness['source'] = 'digest'): Freshness => ({
  as_of_ms: FIXTURE_NOW - ageMs,
  source,
  stale: false,
});
const staleF = (ageMs: number): Freshness => ({
  as_of_ms: FIXTURE_NOW - ageMs,
  source: 'digest',
  stale: true,
});

export interface FixtureBotSpec {
  name: string;
  mode: BotMode;
  status?: BotStatus;
  market?: Market;
  wallet?: string | null;
  slots?: number;
  maxSlots?: number | null;
  latent?: number | null;
  d1?: number | null;
  d30?: number | null;
  long?: number | null;
  short?: number | null;
  stale?: boolean;
  alert?: Severity | null;
  alerts?: number;
  seeded?: boolean;
  capital?: number | null;
  dd?: { abs: number; pct: number | null } | null;
}

const NAMES = [
  'hippo_multi',
  'hippo_dynv1_long',
  'hippo_stocks',
  'hippo_short_sharpe',
  'hippo_long_op200',
  'hippo_mat',
  'dynv1_short',
  'dyn_funding_skew',
  'cci_ao_scalper',
  'kelt_dpo_long',
  'regime_btc_trend',
  'ladder_out_v2',
];

/** One fixture bot. `seq` makes ports, keys and the 24 h curve deterministic. */
export function makeBot(seq: number, spec: FixtureBotSpec): BotRow {
  const r = rng(seq * 7919 + 17);
  const key = `local:${9400 + seq}`;
  const status = spec.status ?? 'online';
  const latent = spec.latent === undefined ? (r() - 0.55) * 300 : spec.latent;
  const walk: number[] = [];
  let v = (latent ?? 0) - (r() - 0.5) * 60;
  for (let k = 0; k < 24; k++) {
    walk.push(Math.round(v * 100) / 100);
    v += (r() - 0.5) * 14;
  }
  const f = spec.stale ? staleF(6 * MIN) : fresh(4_000 + Math.floor(r() * 9_000));
  const offline = status === 'offline' || status === 'stopped' || status === 'auth_expired';
  const stateF = offline ? staleF(14 * MIN) : fresh();
  const ddAbs = spec.dd === undefined ? Math.round(r() * 120) : (spec.dd?.abs ?? 0);
  const capital = spec.capital === undefined ? 1500 + Math.round(r() * 1500) : spec.capital;
  return {
    bot_key: key,
    identity: {
      name: spec.name,
      icon: null,
      mode: spec.mode,
      strategy: spec.mode === 'replay' ? 'ReplaySeed' : `Strategy${seq % 7}`,
      exchange: 'hyperliquid',
      market: spec.market ?? 'crypto',
      stake_currency: 'USDC',
      port: 9400 + seq,
      ui_ids: [`ftbot.${seq}`],
      incarnation: `inc-${seq}`,
    },
    state: {
      status,
      since_ms: FIXTURE_NOW - (status === 'starting' ? 4 : status === 'offline' ? 14 : 3000) * MIN,
      wallet_id: spec.wallet === undefined ? `w${seq}` : spec.wallet,
      open_trades: spec.slots ?? Math.floor(r() * 5),
      max_open_trades: spec.maxSlots === undefined ? 6 : spec.maxSlots,
      first_real_trade_ms: spec.seeded ? FIXTURE_NOW - 12 * DAY : null,
      started_ms: FIXTURE_NOW - (2 + Math.floor(r() * 30)) * HOUR,
    },
    metrics: {
      realized_1d: spec.d1 === undefined ? Math.round((r() - 0.4) * 5000) / 100 : spec.d1,
      realized_7d: Math.round((r() - 0.3) * 20000) / 100,
      realized_30d: spec.d30 === undefined ? Math.round((r() - 0.3) * 40000) / 100 : spec.d30,
      realized_total: Math.round((r() - 0.2) * 90000) / 100,
      open_profit_abs: latent === null ? null : Math.round(latent * 100) / 100,
      starting_capital: capital,
      exposure_long: spec.long === undefined ? Math.round(r() * 4000) : spec.long,
      exposure_short:
        spec.short === undefined ? (r() > 0.6 ? Math.round(r() * 3000) : 0) : spec.short,
      drawdown_realized: null,
      drawdown_with_open:
        spec.dd === null
          ? null
          : {
              abs: ddAbs,
              pct:
                spec.dd?.pct === undefined
                  ? capital
                    ? (ddAbs / capital) * 100
                    : null
                  : spec.dd.pct,
              peak_ms: null,
              trough_ms: null,
              current_abs: ddAbs,
            },
      last_trade_ms: FIXTURE_NOW - Math.floor(r() * 30) * HOUR,
      trades_closed: 40 + Math.floor(r() * 400),
      winrate: 0.55 + r() * 0.3,
      spark24h: walk,
    },
    alerts: {
      count: spec.alerts ?? (spec.alert ? 1 : 0),
      max_severity: spec.alert ?? null,
    },
    freshness: { state: stateF, metrics: f, positions: f, capital: f, alerts: fresh() },
  };
}

/** The fleet: 40 bots by default, with the edge cases in the first ones. */
export function makeFleet(n = 40): BotRow[] {
  const specs: FixtureBotSpec[] = [
    {
      name: NAMES[0]!,
      mode: 'live',
      wallet: 'w-shared',
      slots: 4,
      latent: -94.23,
      alert: 'warning',
      market: 'mixed',
      dd: { abs: 61, pct: 2.2 },
    },
    { name: NAMES[1]!, mode: 'live', wallet: 'w-shared', slots: 2, latent: 12.4, d1: 0, d30: 28 },
    {
      name: NAMES[2]!,
      mode: 'live',
      market: 'xyz_stocks',
      slots: 3,
      latent: -35.23,
      alert: 'critical',
      dd: { abs: 46, pct: 7.7 },
    },
    {
      name: NAMES[3]!,
      mode: 'live',
      status: 'offline',
      slots: 2,
      latent: -22.53,
      alert: 'critical',
    },
    { name: NAMES[4]!, mode: 'live', status: 'starting', slots: 0, latent: 0, d1: 0, d30: 0 },
    {
      name: NAMES[5]!,
      mode: 'live',
      status: 'auth_expired',
      market: 'xyz_commodities',
      slots: 1,
      latent: -0.73,
    },
    {
      name: NAMES[6]!,
      mode: 'live',
      stale: true,
      slots: 4,
      latent: -72.4,
      alert: 'warning',
      dd: { abs: 110, pct: 18.4 },
    },
    {
      name: NAMES[7]!,
      mode: 'live',
      slots: 4,
      latent: -56.41,
      d1: -3.45,
      d30: -21,
      dd: { abs: 43, pct: 7.7 },
    },
    {
      name: 'hippo_original_multi_hyperliquid_stocks_and_materials_long_name_variant_v2',
      mode: 'live',
      slots: 1,
      latent: 4.2,
    },
    {
      name: NAMES[8]!,
      mode: 'live',
      slots: 0,
      latent: 0,
      d1: 0,
      d30: 0,
      long: 0,
      short: 0,
      dd: null,
    },
    { name: NAMES[9]!, mode: 'live', slots: 2, latent: null, d1: null, d30: null, capital: null },
    { name: NAMES[10]!, mode: 'live', status: 'stopped', slots: 0, latent: 0 },
    { name: 'dry_scalper_03', mode: 'dry', slots: 3, latent: 8.8, seeded: true },
    { name: 'dry_casino', mode: 'dry', slots: 1, latent: -3.1, alert: 'info' },
    { name: 'replay_seed_hippo', mode: 'replay', slots: 2, latent: 1840.2 },
  ];
  const rows: BotRow[] = [];
  for (let i = 0; i < n; i++) {
    const spec: FixtureBotSpec =
      specs[i] ??
      ({
        name: `${NAMES[i % NAMES.length]}_${String(Math.floor(i / NAMES.length) + 2).padStart(2, '0')}`,
        mode: i % 3 === 0 ? 'dry' : 'live',
        slots: i % 5,
        alert: i % 11 === 0 ? 'warning' : null,
      } as FixtureBotSpec);
    rows.push(makeBot(i + 1, spec));
  }
  return rows;
}

const ANCHOR_BY_PAIR: Record<string, number> = {
  'NEAR/USDC:USDC': 4.91,
  'AVAX/USDC:USDC': 24.61,
  'SEI/USDC:USDC': 0.4012,
  'TAO/USDC:USDC': 342.5,
  'HYPE/USDC:USDC': 38.9,
  'WIF/USDC:USDC': 1.531,
  'SOL/USDC:USDC': 152.4,
  'xyz:NVDA/USDC:USDC': 251.8,
  'PENGU/USDC:USDC': 0.0118,
};
const PAIRS = Object.keys(ANCHOR_BY_PAIR);

export interface PositionFixtureOptions {
  /** Add the same trade id (1180) on two different bots, the case of bug B1. */
  duplicateTradeId?: boolean;
  orphan?: boolean;
}

/** Open positions of the fleet: `open_trades` of each bot that answers, plus the special cases. */
export function makePositions(bots: BotRow[], opts: PositionFixtureOptions = {}): Position[] {
  const out: Position[] = [];
  const r = rng(4242);
  let nextId = 1000;
  for (const b of bots) {
    if (b.state.status !== 'online' && b.state.status !== 'auth_expired') continue;
    for (let k = 0; k < b.state.open_trades; k++) {
      const pair = PAIRS[(out.length + k) % PAIRS.length]!;
      const side = (out.length + k) % 4 === 3 ? 'short' : 'long';
      out.push(makePosition(b, pair, nextId++, side, r()));
    }
  }
  if (opts.duplicateTradeId !== false) {
    // The same trade id on two bots: every key, lookup and action must keep them apart
    const [a, c] = bots.filter((x) => x.state.status === 'online' && x.identity.mode === 'live');
    if (a && c) {
      out.push(makePosition(a, 'TAO/USDC:USDC', 1180, 'short', 0.3));
      out.push(makePosition(c, 'TAO/USDC:USDC', 1180, 'long', 0.8));
    }
  }
  if (opts.orphan !== false) {
    const o = makePosition(bots[0]!, 'PENGU/USDC:USDC', 9001, 'short', 0.5);
    out.push({ ...o, bot_key: 'orphan:wallet1', orphan: true, percentile: null });
  }
  return out;
}

export function makePosition(
  bot: BotRow,
  pair: string,
  tradeId: number,
  side: 'long' | 'short',
  seed: number,
): Position {
  const entry = ANCHOR_BY_PAIR[pair] ?? 10;
  const lev = 2 + (tradeId % 2);
  const dca = 1 + Math.floor(seed * 5.5);
  const drift = (seed - 0.6) * 0.12 * (side === 'long' ? 1 : -1);
  const current = entry * (1 + drift);
  const stake = 140 + Math.round(seed * 1200);
  const notional = stake * lev;
  const ratio = ((side === 'long' ? current - entry : entry - current) / entry) * lev;
  const liq = side === 'long' ? entry * (1 - 0.9 / lev) : entry * (1 + 0.9 / lev);
  const liqDist = (Math.abs(current - liq) / current) * 100;
  const stale = bot.freshness.positions?.stale ?? false;
  return {
    bot_key: bot.bot_key,
    trade_id: tradeId,
    pair,
    coin: pair.startsWith('xyz:') ? pair.split('/')[0]! : pair.split('/')[0]!,
    market: pair.startsWith('xyz:') ? 'xyz_stocks' : 'crypto',
    side,
    leverage: lev,
    amount: notional / entry,
    stake_amount: stake,
    notional,
    open_rate: entry,
    current_rate: current,
    profit_abs: Math.round(ratio * stake * 100) / 100,
    profit_ratio: ratio,
    stoploss_abs: null,
    liquidation_price: liq,
    liq_distance_pct: Math.round(liqDist * 10) / 10,
    dca_entries: dca,
    open_ms: FIXTURE_NOW - Math.floor(2 + seed * 60) * HOUR,
    duration_ms: Math.floor(2 + seed * 60) * HOUR,
    percentile: seed > 0.85 ? 91 : seed > 0.6 ? 84 : 40,
    orphan: false,
    freshness: stale ? staleF(6 * MIN) : fresh(),
  };
}

export function makeAlerts(bots: BotRow[]): Alert[] {
  const [b0, , b2, b3, , , b6] = bots;
  const base = {
    state: 'firing' as const,
    acked_at_ms: null,
    acked_by_session: null,
    silenced_until_ms: null,
    detail: null,
  };
  const alerts: Alert[] = [];
  if (b2)
    alerts.push({
      ...base,
      id: 'a1',
      type_id: 'nearLiquidation',
      bot_key: b2.bot_key,
      subject: 'NVDA',
      severity: 'critical',
      value: 11,
      threshold: 15,
      since_ms: FIXTURE_NOW - 40 * MIN,
      last_seen_ms: FIXTURE_NOW - 20_000,
    });
  if (b3)
    alerts.push({
      ...base,
      id: 'a2',
      type_id: 'botOffline',
      bot_key: b3.bot_key,
      subject: null,
      severity: 'critical',
      value: 14,
      threshold: null,
      since_ms: FIXTURE_NOW - 14 * MIN,
      last_seen_ms: FIXTURE_NOW - 5_000,
    });
  if (b6)
    alerts.push({
      ...base,
      id: 'a3',
      type_id: 'highDrawdown',
      bot_key: b6.bot_key,
      subject: null,
      severity: 'warning',
      value: -18.4,
      threshold: -15,
      since_ms: FIXTURE_NOW - 3 * HOUR,
      last_seen_ms: FIXTURE_NOW - 30_000,
    });
  if (b0)
    alerts.push({
      ...base,
      id: 'a4',
      type_id: 'positionLoss',
      bot_key: b0.bot_key,
      subject: 'NEAR',
      severity: 'warning',
      value: -12.6,
      threshold: -10,
      since_ms: FIXTURE_NOW - 95 * MIN,
      last_seen_ms: FIXTURE_NOW - 12_000,
    });
  alerts.push({
    ...base,
    id: 'a5',
    type_id: 'walletMismatch',
    bot_key: null,
    subject: 'PENGU',
    severity: 'critical',
    value: null,
    threshold: null,
    since_ms: FIXTURE_NOW - 2 * HOUR,
    last_seen_ms: FIXTURE_NOW - 8_000,
    detail: 'PENGU short 212,40 USDC with no owner',
  });
  if (b0)
    alerts.push({
      ...base,
      id: 'a6',
      type_id: 'capacityFull',
      bot_key: b0.bot_key,
      subject: null,
      severity: 'info',
      value: null,
      threshold: null,
      since_ms: FIXTURE_NOW - 5 * HOUR,
      last_seen_ms: FIXTURE_NOW - 9_000,
      acked_at_ms: FIXTURE_NOW - 4 * HOUR,
      acked_by_session: 's1',
    });
  if (b6)
    alerts.push({
      ...base,
      id: 'a7',
      type_id: 'logErrors',
      bot_key: b6.bot_key,
      subject: null,
      severity: 'critical',
      value: 8,
      threshold: null,
      since_ms: FIXTURE_NOW - 6 * HOUR,
      last_seen_ms: FIXTURE_NOW - 7_000,
      silenced_until_ms: FIXTURE_NOW + 3 * HOUR,
    });
  return alerts;
}

export function makeEvents(bots: BotRow[]): Event[] {
  const [b0, b1, b2] = bots;
  const e = (
    kind: Event['kind'],
    minAgo: number,
    bot: BotRow | undefined,
    extra: Partial<Event> = {},
  ): Event => ({
    kind,
    ts_ms: FIXTURE_NOW - minAgo * MIN,
    bot_key: bot?.bot_key ?? null,
    trade_id: null,
    pair: null,
    profit_abs: null,
    severity: null,
    detail: null,
    ...extra,
  });
  // Newest first
  return [
    e('exit_fill', 3, b0, { trade_id: 1175, pair: 'SOL/USDC:USDC', profit_abs: 4.18 }),
    e('entry_fill', 11, b1, { trade_id: 1190, pair: 'HYPE/USDC:USDC' }),
    e('alert_raised', 40, b2, { severity: 'critical', detail: 'nearLiquidation' }),
    e('exit_fill', 75, b0, { trade_id: 1170, pair: 'WIF/USDC:USDC', profit_abs: -18.6 }),
    e('startup', 130, b1),
    e('action', 160, b0, { detail: 'forceexit trade 1169 (you, phone)' }),
    e('exit_fill', 190, b2, { trade_id: 1160, pair: 'xyz:NVDA/USDC:USDC', profit_abs: 9.9 }),
    e('alert_resolved', 240, b1),
    e('bot_offline', 300, bots[3], { severity: 'critical' }),
  ];
}

export function makeWallets(bots: BotRow[]): WalletRow[] {
  const ids = new Set(bots.map((b) => b.state.wallet_id).filter((x): x is string => !!x));
  return [...ids].map((id) => {
    const members = bots.filter((b) => b.state.wallet_id === id);
    const net: Record<string, number> = {};
    members.forEach((b, i) => {
      net[`COIN${i}`] = (b.metrics.exposure_long ?? 0) - (b.metrics.exposure_short ?? 0);
    });
    return {
      wallet_id: id,
      address_short: `0x${id.slice(0, 4)}...abcd`,
      bots: members.map((m) => m.bot_key),
      equity: 3000,
      net_exposure: net,
      recon: null,
      freshness: fresh(),
    };
  });
}

export function makeHealth(): Health {
  return {
    level: 'degraded',
    reasons: [{ code: 'rate_budget', severity: 'warning', detail: '61 %', alert_id: null }],
    rate_budget_pct: 61,
    backoff_active: true,
    hit_rate: 0.97,
    bots_process: 17,
    digest_age_s: 2,
    freshness: fresh(),
  };
}

export interface FleetFixture {
  bots: BotRow[];
  positions: Position[];
  alerts: Alert[];
  events: Event[];
  wallets: WalletRow[];
  health: Health;
}

export function makeFixture(n = 40, opts: PositionFixtureOptions = {}): FleetFixture {
  const bots = makeFleet(n);
  return {
    bots,
    positions: makePositions(bots, opts),
    alerts: makeAlerts(bots),
    events: makeEvents(bots),
    wallets: makeWallets(bots),
    health: makeHealth(),
  };
}

function snapshot(name: string, entities: Record<string, unknown>): StateUpdate {
  return {
    kind: 'snapshot',
    seq: 1,
    ts: FIXTURE_NOW,
    replace: [name],
    upsert: { [name]: entities } as unknown as StateUpdate['upsert'],
    remove: {},
  };
}

/** Fill the normalised stores with a fixture, as a source would. */
export function seedStores(f: FleetFixture): void {
  const keyed = <T>(items: T[], key: (t: T) => string) =>
    Object.fromEntries(items.map((i) => [key(i), i]));
  const fleet = useFqFleetStore();
  fleet.apply(
    snapshot(
      'bots',
      keyed(f.bots, (b) => b.bot_key),
    ),
  );
  fleet.apply(
    snapshot(
      'wallets',
      keyed(f.wallets, (w) => w.wallet_id),
    ),
  );
  useFqPositionsStore().apply(
    snapshot(
      'positions',
      keyed(f.positions, (p) => `${p.bot_key}/${p.trade_id}`),
    ),
  );
  const alerts = useFqAlertsStore();
  alerts.apply(
    snapshot(
      'alerts',
      keyed(f.alerts, (a) => a.id),
    ),
  );
  alerts.shared = true;
  const events = useFqEventsStore();
  events.reset();
  [...f.events].reverse().forEach((e) => events.add(e));
  useFqHealthStore().apply(snapshot('health', { fleet: f.health }));
  const conn = useFqConnectionStore();
  conn.kind = 'gateway';
  conn.setStatus({
    state: 'live',
    lastSyncMs: FIXTURE_NOW,
    clockSkewMs: 0,
    latencyMs: 38,
    resyncing: false,
    reason: null,
  });
}

export function resetStores(): void {
  useFqFleetStore().reset();
  useFqPositionsStore().reset();
  useFqAlertsStore().reset();
  useFqEventsStore().reset();
  useFqHealthStore().reset();
}

// ---- a data source that never touches the network ----

export interface FakeSource {
  source: DataSource;
  /** Every `act` call, in order: `(botKey, action, idempotencyKey)`. */
  acts: Array<{ botKey: BotKey; action: BotAction; key: string }>;
  ack: Array<string>;
  silences: Array<{ untilMs: number; typeId?: string; botKey?: string }>;
  /** The next `act` answer; accepted by default. */
  next: { result: Partial<ActionResult>; delayMs: number; throws: boolean };
}

/** Totals of a scope computed from fixture rows, enough for the ScopePanel previews. */
export function scopeDetailOf(f: FleetFixture, scope: ScopeRef): ScopeDetail {
  const bots = f.bots.filter((b) => {
    if (scope.kind === 'bot') return b.bot_key === scope.botKey;
    return b.identity.mode !== 'replay';
  });
  const keys = new Set(bots.map((b) => b.bot_key));
  const totals: ScopeTotals[] = (['live', 'dry'] as BotMode[])
    .map((mode) => {
      const mine = bots.filter((b) => b.identity.mode === mode);
      if (mine.length === 0) return null;
      const sum = (pick: (b: BotRow) => number | null) =>
        mine.reduce((acc, b) => acc + (pick(b) ?? 0), 0);
      const long = sum((b) => b.metrics.exposure_long);
      const short = sum((b) => b.metrics.exposure_short);
      return {
        mode,
        bots: mine.length,
        open_trades: sum((b) => b.state.open_trades),
        max_open_trades: sum((b) => b.state.max_open_trades),
        realized_1d: sum((b) => b.metrics.realized_1d),
        realized_7d: sum((b) => b.metrics.realized_7d),
        realized_30d: sum((b) => b.metrics.realized_30d),
        realized_total: sum((b) => b.metrics.realized_total),
        open_profit_abs: sum((b) => b.metrics.open_profit_abs),
        starting_capital: {
          total: sum((b) => b.metrics.starting_capital),
          known: mine.filter((b) => b.metrics.starting_capital != null).length,
          unknown: mine.filter((b) => b.metrics.starting_capital == null).length,
        },
        exposure: { long, short, net: long - short, net_by_coin: {}, gross_netted: long + short },
        netted: false,
        excluded: mine.filter((b) => b.freshness.metrics?.stale).map((b) => b.bot_key),
      } as ScopeTotals;
    })
    .filter((x): x is ScopeTotals => x !== null);
  return {
    scope,
    bots,
    positions: f.positions.filter((p) => keys.has(p.bot_key)),
    totals,
    drawdown: {
      realized: { abs: 80, pct: 2.9, peak_ms: null, trough_ms: null, current_abs: 40 },
      with_open: { abs: 412, pct: 4.5, peak_ms: null, trough_ms: null, current_abs: 300 },
      open_worst_sum: -320,
      has_open: true,
      base: 9000,
    },
    asOfMs: FIXTURE_NOW,
  };
}

/**
 * A DataSource double. `act` records the call and answers without any network; the other methods
 * cover what the composites call. Real bots are never reachable through it.
 */
export function fakeSource(fixture?: FleetFixture): FakeSource {
  const acts: FakeSource['acts'] = [];
  const ack: string[] = [];
  const silences: FakeSource['silences'] = [];
  const next: FakeSource['next'] = { result: {}, delayMs: 0, throws: false };
  const status = ref<SourceStatus>({
    state: 'live',
    lastSyncMs: FIXTURE_NOW,
    clockSkewMs: 0,
    latencyMs: 38,
    resyncing: false,
    reason: null,
  });
  const source = {
    kind: 'gateway',
    status,
    start: async () => undefined,
    stop: () => undefined,
    subscribe: () => () => undefined,
    query: {
      scope: async (s: ScopeRef) => scopeDetailOf(fixture ?? makeFixture(), s),
    },
    async act(botKey: BotKey, action: BotAction, key: string): Promise<ActionResult> {
      acts.push({ botKey, action, key });
      if (next.delayMs > 0) await new Promise((res) => setTimeout(res, next.delayMs));
      if (next.throws) throw new Error('socket hang up');
      return {
        status: 'accepted',
        botResponse: 'ok',
        httpStatus: 200,
        error: null,
        verify: null,
        latencyMs: 8,
        ...next.result,
      };
    },
    alerts: {
      shared: true,
      ack: async (id: string) => void ack.push(id),
      silence: async (spec: { untilMs: number; typeId?: string; botKey?: string }) => {
        silences.push(spec);
        return { id: 's', type_id: null, bot_key: null, subject: null, until_ms: spec.untilMs };
      },
      list: () => [],
    },
  } as unknown as DataSource;
  return { source, acts, ack, silences, next };
}
