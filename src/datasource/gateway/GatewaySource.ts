/**
 * Gateway mode: one session, one WebSocket, snapshots and keyed deltas (docs/redesign/03 section
 * 6.2 and 9.1). The gateway polls the bots once for everybody and computes the aggregates; this
 * class only transports them into the normalised stores, honestly:
 *
 * - Every channel has its own sequence tracker. A gap, a `resync` frame or a reconnection outside
 *   the buffer reloads the snapshot of that channel and re-applies the frames received meanwhile.
 *   Nothing is shown as current that could have missed a frame.
 * - A mutation is sent once with its idempotency key and never retried; a timeout is `unknown`.
 * - Reads that get a 401 open a new session and are replayed once; mutations are not replayed.
 */
import { ref, type Ref } from 'vue';

import {
  GATEWAY_PROTOCOL_VERSION,
  type Alert,
  type AlertRulesConfig,
  type AuditEntry,
  type BotKey,
  type BotMode,
  type BotRow,
  type DrawdownResult,
  type Event,
  type LogLine,
  type Position,
  type ScopeTotals as GwScopeTotals,
  type ServerFrame,
  type Silence,
  type TradeRow,
} from '@/gateway/types.gen';

import { exposure } from '../calc/exposure';
import { scopeTotalsByMode } from '../calc/scopeTotals';
import { pageTradeRows } from '../calc/tradePage';
import { positionToTradeRow } from '../direct/mappers';
import type { PrefsRemote } from '../prefsSync';
import { applyUpsert, type Collections } from '../protocol/apply';
import { formatChannel, parseChannel, type Channel as WireChannel } from '../protocol/channel';
import { SeqTracker } from '../protocol/seq';
import type {
  ActionResult,
  AlertsApi,
  BotAction,
  Channel,
  ChannelParams,
  ChannelUpdate,
  DataSource,
  DrawdownQuery,
  EquityQuery,
  EquitySeries,
  EventQuery,
  LogQuery,
  OrderRow,
  Page,
  PeriodQuery,
  PeriodRow,
  ProxyOptions,
  RegistryApi,
  ScopeDetail,
  ScopeRef,
  ScopeTotals,
  SourceStatus,
  StateUpdate,
  TradePage,
  TradeQuery,
} from '../types';
import { GatewayError, type GatewayHttp } from './http';
import type { SessionManager } from './session';
import { isStateChannel, parseSnapshot } from './snapshot';
import { GatewaySocket, type SocketState, type SocketTimers, type WsFactory } from './socket';

export interface GatewaySourceDeps {
  http: GatewayHttp;
  session: SessionManager;
  baseUrl: () => string;
  deviceId: () => string;
  wsFactory: WsFactory;
  aliases: () => Record<string, BotKey>;
  /** Groups of the preferences: a group scope is the fleet restricted to its bots. */
  getGroups?: () => ReadonlyArray<{ id: string; botKeys: BotKey[] }>;
  now?: () => number;
  timers?: SocketTimers;
  jitter?: boolean;
  /** Called when the gateway cannot be used any more (session refused twice, protocol). */
  onUnusable?: (reason: string) => void;
}

type AnySink = (u: never) => void;

interface ChannelRuntime {
  name: string;
  wire: WireChannel;
  state: boolean;
  sinks: Set<AnySink>;
  tracker: SeqTracker;
  /** Snapshot done (state channels). */
  hasBaseline: boolean;
  resyncing: boolean;
  queue: ServerFrame[];
  /** Collections as the sinks know them, to bring a late subscriber up to date. */
  collections: Collections;
  resyncTimes: number[];
}

const ACTION_TIMEOUT_MS = 25_000;
const LATENCY_EVERY_MS = 30_000;
const RESYNC_STORM = 4;
const RESYNC_STORM_WINDOW_MS = 10_000;

/** Answer of `GET /scope/{live|dry|replay|bot:<key>}`. */
interface GwScopeResponse {
  totals: GwScopeTotals | null;
  bots: BotRow[];
  positions: Position[];
  drawdown: DrawdownResult | null;
  generated_ms: number;
}

/** Wallet of each bot (its own key when the gateway does not know one): exposure nets per wallet. */
function walletOfRows(rows: readonly BotRow[]): (botKey: string) => string {
  const byKey = new Map(rows.map((r) => [r.bot_key, r.state.wallet_id]));
  return (k) => byKey.get(k) ?? `bot:${k}`;
}

/** The totals the gateway computed for one mode, in the shape the pages read. */
function fromGatewayTotals(
  t: GwScopeTotals,
  rows: readonly BotRow[],
  positions: readonly Position[],
  drawdown: DrawdownResult | null,
  walletOf: (botKey: string) => string,
): ScopeTotals {
  const excluded = new Set(t.excluded_bots);
  // Netting per coin at wallet level, over the bots whose figures are in the sums.
  const netted = exposure(
    positions
      .filter((p) => !excluded.has(p.bot_key))
      .map((p) => ({
        coin: `${walletOf(p.bot_key)}|${p.coin}`,
        side: p.side,
        notional: p.notional,
      })),
  );
  return {
    mode: t.mode,
    bots: t.bots,
    open_trades: t.open_trades,
    max_open_trades: t.max_open_trades,
    realized_1d: t.realized_1d,
    realized_7d: t.realized_7d,
    realized_30d: t.realized_30d,
    realized_total: t.realized_total,
    open_profit_abs: t.open_profit_abs,
    starting_capital: {
      total: t.starting_capital ?? 0,
      known: Math.max(0, rows.length - t.capital_unknown_bots),
      unknown: t.capital_unknown_bots,
    },
    exposure: {
      long: t.exposure_long,
      short: t.exposure_short,
      net: t.exposure_net,
      net_by_coin: netted.net_by_coin,
      gross_netted: netted.gross_netted,
    },
    netted: true,
    excluded: [...excluded],
    drawdown,
  };
}

function sortRowsByPair(rows: TradeRow[], order?: 'asc' | 'desc'): TradeRow[] {
  const dir = order === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => a.pair.localeCompare(b.pair) * dir);
}

/** Levels of the UI (`ERROR`, `WARNING`...) to the lower-case floor of `GET /logs`. */
function gatewayLevel(level: string): string {
  switch (level.toUpperCase()) {
    case 'CRITICAL':
    case 'FATAL':
    case 'ERROR':
      return 'error';
    case 'WARNING':
    case 'WARN':
      return 'warning';
    case 'INFO':
      return 'info';
    default:
      return 'debug';
  }
}

function wireOf<C extends Channel>(ch: C, params: ChannelParams[C]): WireChannel {
  switch (ch) {
    case 'bot':
      return { kind: 'bot', bot_key: (params as ChannelParams['bot']).botKey };
    case 'logs':
      return { kind: 'logs', bot_key: (params as ChannelParams['logs']).botKey };
    case 'chart': {
      const p = params as ChannelParams['chart'];
      return { kind: 'chart', bot_key: p.botKey, pair: p.pair, timeframe: p.timeframe };
    }
    default:
      return { kind: ch } as WireChannel;
  }
}

export class GatewaySource implements DataSource {
  readonly kind = 'gateway' as const;
  readonly status: Ref<SourceStatus> = ref({
    state: 'connecting',
    lastSyncMs: 0,
    clockSkewMs: 0,
    latencyMs: null,
    resyncing: false,
    reason: null,
  });

  private readonly d: GatewaySourceDeps;
  private readonly now: () => number;
  private readonly socket: GatewaySocket;
  private readonly chans = new Map<string, ChannelRuntime>();
  private started = false;
  private snapshotScheduled = false;
  private latencyTimer: unknown = null;
  /** Why the link is up but not trustworthy (resync storm, snapshot failures), or null. */
  private degradedReason: string | null = null;
  private readonly timers: SocketTimers;

  constructor(deps: GatewaySourceDeps) {
    this.d = deps;
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    this.socket = new GatewaySocket({
      url: () => this.wsUrl(),
      token: () => this.d.session.token(),
      deviceId: deps.deviceId,
      factory: deps.wsFactory,
      timers: this.timers,
      jitter: deps.jitter,
      wanted: () => this.wanted(),
      onFrame: (f) => this.onFrame(f),
      onState: (s, info) => this.onSocketState(s, info),
      onAuthFailure: () => void this.onAuthFailure(),
    });
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.patchStatus({ state: 'connecting', reason: null });
    try {
      await this.d.session.ensure();
    } catch (e) {
      this.started = false;
      this.patchStatus({ state: 'offline', reason: 'session' });
      throw e;
    }
    this.socket.start();
    this.scheduleSnapshots();
    this.latencyTimer = this.timers.setTimeout(() => void this.measureLatency(), 2_000);
  }

  stop(): void {
    this.started = false;
    this.socket.stop();
    if (this.latencyTimer !== null) this.timers.clearTimeout(this.latencyTimer);
    this.latencyTimer = null;
  }

  private patchStatus(p: Partial<SourceStatus>): void {
    this.status.value = { ...this.status.value, ...p };
  }

  private wsUrl(): string {
    const base = this.d.baseUrl().replace(/^http/i, 'ws');
    return `${base}/gw/v1/ws`;
  }

  private async measureLatency(): Promise<void> {
    if (!this.started) return;
    const r = await this.d.http.hello(3_000);
    if (r) this.patchStatus({ latencyMs: r.rttMs });
    this.latencyTimer = this.timers.setTimeout(() => void this.measureLatency(), LATENCY_EVERY_MS);
  }

  // ---------------------------------------------------------------- subscriptions

  private wanted(): { channels: string[]; resume: Record<string, number> } {
    const channels: string[] = [];
    const resume: Record<string, number> = {};
    for (const rt of this.chans.values()) {
      // A state channel is subscribed once its snapshot gave it a baseline (snapshot first, then
      // `sub` with the resume point, so no frame is missed in between).
      if (rt.state && !rt.hasBaseline) continue;
      channels.push(rt.name);
      if (rt.tracker.last !== null) resume[rt.name] = rt.tracker.last;
    }
    return { channels, resume };
  }

  subscribe<C extends Channel>(
    ch: C,
    params: ChannelParams[C],
    sink: (u: ChannelUpdate[C]) => void,
  ): () => void {
    const wire = wireOf(ch, params);
    const name = formatChannel(wire);
    // A bad key (an `ftbot.3` alias instead of a `bot_key`, an empty pair) would be refused by the
    // server as malformed: fail here, where the mistake is.
    if (!parseChannel(name).ok) {
      throw new Error(`invalid channel ${JSON.stringify(name)}`);
    }
    let rt = this.chans.get(name);
    const created = !rt;
    if (!rt) {
      rt = {
        name,
        wire,
        state: isStateChannel(wire),
        sinks: new Set(),
        tracker: new SeqTracker(),
        hasBaseline: false,
        resyncing: false,
        queue: [],
        collections: {},
        resyncTimes: [],
      };
      this.chans.set(name, rt);
    }
    const s = sink as unknown as AnySink;
    rt.sinks.add(s);
    if (!created && rt.hasBaseline && rt.state) {
      // Late subscriber: hand it what the others already have.
      (sink as (u: StateUpdate) => void)(this.snapshotUpdate(rt, rt.tracker.last ?? 0));
    }
    if (created && this.started) {
      if (rt.state) {
        this.scheduleSnapshots();
      } else {
        this.socket.send({ t: 'sub', ch: [name], resume: {} });
      }
    }
    return () => {
      const cur = this.chans.get(name);
      if (!cur) return;
      cur.sinks.delete(s);
      if (cur.sinks.size === 0) {
        this.chans.delete(name);
        this.socket.send({ t: 'unsub', ch: [name] });
      }
    };
  }

  private emit(rt: ChannelRuntime, u: unknown): void {
    for (const s of rt.sinks) (s as (x: unknown) => void)(u);
  }

  private snapshotUpdate(rt: ChannelRuntime, seq: number): StateUpdate {
    return {
      kind: 'snapshot',
      seq,
      ts: this.now() + this.status.value.clockSkewMs,
      replace: Object.keys(rt.collections),
      upsert: structuredClone(rt.collections) as unknown as StateUpdate['upsert'],
      remove: {},
    };
  }

  // ---------------------------------------------------------------- snapshots

  /** Coalesce the snapshot requests of channels subscribed in the same tick into one. */
  private scheduleSnapshots(): void {
    if (this.snapshotScheduled) return;
    this.snapshotScheduled = true;
    queueMicrotask(() => {
      this.snapshotScheduled = false;
      const need = [...this.chans.values()].filter(
        (rt) => rt.state && !rt.hasBaseline && !rt.resyncing,
      );
      if (need.length > 0) void this.loadSnapshots(need);
    });
  }

  private async loadSnapshots(rts: ChannelRuntime[], attempt = 0): Promise<void> {
    for (const rt of rts) rt.resyncing = true;
    this.patchStatus({ resyncing: true });
    const names = rts.map((r) => r.name);
    try {
      const res = await this.readWithSession<unknown>('/snapshot', {
        params: { ch: names.join(',') },
      });
      const parsed = parseSnapshot(res.data, res.headers, names);
      for (const rt of rts) {
        const cols = parsed.byChannel[rt.name] ?? {};
        rt.collections = structuredClone(cols) as Collections;
        const seq = parsed.seq[rt.name] ?? 0;
        rt.tracker.reset(seq);
        rt.hasBaseline = true;
        this.emit(rt, this.snapshotUpdate(rt, seq));
        // Frames that arrived while the snapshot was loading.
        const queued = rt.queue;
        rt.queue = [];
        rt.resyncing = false;
        for (const f of queued) this.applyFrame(rt, f);
      }
      // A snapshot that loaded clears a previous snapshot failure (not a storm).
      if (this.degradedReason !== 'resync_storm') this.degradedReason = null;
      this.patchStatus({
        resyncing: [...this.chans.values()].some((r) => r.resyncing),
        lastSyncMs: this.now(),
        ...(this.degradedReason === null && this.socket.current === 'live'
          ? { state: 'live' as const, reason: null }
          : {}),
      });
      // Now that the baselines exist, subscribe with the resume points.
      const subscribe = rts.filter((r) => this.chans.get(r.name) === r);
      if (subscribe.length > 0) {
        const resume: Record<string, number> = {};
        for (const r of subscribe) if (r.tracker.last !== null) resume[r.name] = r.tracker.last;
        this.socket.send({ t: 'sub', ch: subscribe.map((r) => r.name), resume });
      }
    } catch (e) {
      for (const rt of rts) rt.resyncing = false;
      if (attempt < 3 && this.started) {
        // Keep the queue: the retry re-applies it.
        await new Promise((r) => this.timers.setTimeout(() => r(null), 1_000 * (attempt + 1)));
        if (this.started) return this.loadSnapshots(rts, attempt + 1);
      }
      this.degradedReason = e instanceof GatewayError ? e.code : 'snapshot';
      this.patchStatus({ resyncing: false, state: 'degraded', reason: this.degradedReason });
    }
  }

  private requestResync(rt: ChannelRuntime, _reason: string): void {
    if (rt.resyncing) return;
    const t = this.now();
    rt.resyncTimes = rt.resyncTimes.filter((x) => t - x < RESYNC_STORM_WINDOW_MS);
    rt.resyncTimes.push(t);
    if (rt.resyncTimes.length >= RESYNC_STORM) {
      // A channel that keeps losing frames is not trustworthy: say so instead of looping.
      this.degradedReason = 'resync_storm';
      this.patchStatus({ state: 'degraded', reason: 'resync_storm' });
    }
    if (!rt.state) {
      // A stream cannot be reloaded from here: consumers refetch their page.
      rt.tracker = new SeqTracker();
      this.emit(rt, { kind: 'reset' });
      return;
    }
    rt.hasBaseline = false;
    void this.loadSnapshots([rt]);
  }

  // ---------------------------------------------------------------- frames

  private onSocketState(
    s: SocketState,
    info: { code?: number; attempt: number; retryInMs?: number },
  ): void {
    switch (s) {
      case 'live':
        this.patchStatus({
          state: this.degradedReason ? 'degraded' : 'live',
          reason: this.degradedReason,
          lastSyncMs: this.now(),
        });
        break;
      case 'connecting':
      case 'authing':
      case 'subscribing':
        if (this.status.value.state !== 'live') this.patchStatus({ state: 'connecting' });
        break;
      case 'backoff':
        this.patchStatus({ state: 'offline', reason: 'ws_closed' });
        break;
      case 'closed':
        this.patchStatus({
          state: 'offline',
          reason: info.code === 4403 ? 'origin' : info.code === 4429 ? 'too_many' : 'ws_closed',
        });
        break;
    }
  }

  private async onAuthFailure(): Promise<void> {
    // The server refused the session: open a new one once; if that fails the gateway is unusable.
    try {
      this.d.session.invalidate();
      await this.d.session.ensure();
      this.socket.reconnectNow();
    } catch {
      this.patchStatus({ state: 'offline', reason: 'auth' });
      this.d.onUnusable?.('auth');
    }
  }

  private onFrame(f: ServerFrame): void {
    const t = this.now();
    switch (f.t) {
      case 'authed':
        this.patchStatus({ clockSkewMs: f.ts - t });
        if (f.protocol !== GATEWAY_PROTOCOL_VERSION) this.d.onUnusable?.('protocol');
        break;
      case 'hb':
        // Smooth the offset a little: one slow heartbeat must not move every age.
        this.patchStatus({
          clockSkewMs: Math.round(this.status.value.clockSkewMs * 0.7 + (f.ts - t) * 0.3),
          lastSyncMs: t,
        });
        break;
      case 'subscribed':
        for (const [name, seq] of Object.entries(f.seq)) {
          const rt = this.chans.get(name);
          // A stream has no snapshot: the head at subscription time is its baseline.
          if (rt && !rt.state && rt.tracker.last === null) rt.tracker.reset(seq);
        }
        break;
      case 'up':
      case 'ev': {
        const rt = this.chans.get(f.ch);
        if (!rt) return;
        this.patchStatus({ lastSyncMs: t });
        if (rt.resyncing) {
          rt.queue.push(f);
        } else {
          this.applyFrame(rt, f);
        }
        break;
      }
      case 'resync': {
        const rt = this.chans.get(f.ch);
        if (rt) this.requestResync(rt, f.reason);
        break;
      }
      case 'err':
        if (f.code === 'unauthorized') void this.onAuthFailure();
        break;
    }
  }

  private applyFrame(rt: ChannelRuntime, f: ServerFrame): void {
    if (f.t !== 'up' && f.t !== 'ev') return;
    const verdict = rt.tracker.observe(f.seq);
    if (verdict.verdict === 'duplicate') return;
    if (verdict.verdict === 'gap') {
      this.requestResync(rt, 'gap');
      return;
    }
    if (f.t === 'up') {
      applyUpsert(rt.collections, f.upsert as Record<string, Record<string, unknown>>, f.remove);
      this.emit(rt, {
        kind: 'delta',
        seq: f.seq,
        ts: f.ts,
        replace: [],
        upsert: f.upsert,
        remove: f.remove,
      } satisfies StateUpdate);
    } else {
      this.emit(rt, { kind: 'item', seq: f.seq, item: f.data });
    }
  }

  // ---------------------------------------------------------------- requests

  /** GET with the session; a 401 opens a new session and the read is replayed once. */
  private async readWithSession<T>(
    path: string,
    opts: { params?: Record<string, unknown>; timeoutMs?: number } = {},
  ) {
    await this.d.session.ensure();
    let res = await this.d.http.raw<T>('GET', path, opts);
    if (res.status === 401) {
      await this.d.session.renew();
      res = await this.d.http.raw<T>('GET', path, opts);
    }
    if (res.status < 200 || res.status >= 300) {
      const d = (res.data ?? {}) as { code?: string; message?: string };
      throw new GatewayError(
        (d.code as GatewayError['code']) ?? 'internal',
        res.status,
        d.message ?? `HTTP ${res.status}`,
      );
    }
    return res;
  }

  private async getJson<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null && v !== '') clean[k] = Array.isArray(v) ? v.join(',') : v;
    }
    return (await this.readWithSession<T>(path, { params: clean })).data;
  }

  private async sendJson<T>(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    await this.d.session.ensure();
    return this.d.http.json<T>(method, path, { body, headers });
  }

  // ---------------------------------------------------------------- queries

  /**
   * The `scope=` / `bots=` parameters of the curves. The gateway never mixes live, dry and replay
   * in a figure: the fleet is asked per mode (`tradingMode`, live by default). A group is the list
   * of its bots, `null` when it is empty.
   */
  private scopeParams(s: ScopeRef, tradingMode?: BotMode): Record<string, string> | null {
    switch (s.kind) {
      case 'fleet':
        return { scope: tradingMode ?? 'live' };
      case 'bot':
        return { scope: `bot:${s.botKey}` };
      case 'group': {
        const keys = this.d.getGroups?.().find((g) => g.id === s.id)?.botKeys ?? [];
        return keys.length > 0 ? { bots: keys.join(',') } : null;
      }
    }
  }

  private modeOfBot(botKey: BotKey): BotMode {
    const bots = this.chans.get('fleet')?.collections.bots as
      | Record<string, { identity?: { mode?: BotMode } }>
      | undefined;
    return bots?.[botKey]?.identity?.mode ?? 'live';
  }

  readonly query = {
    tradeOrders: async (botKey: BotKey, tradeId: number): Promise<OrderRow[] | null> => {
      const r = await this.getJson<{ orders?: OrderRow[]; orders_error?: boolean }>(
        `/trades/${encodeURIComponent(botKey)}/${tradeId}`,
      );
      return r.orders_error || !r.orders ? null : r.orders;
    },

    audit: async (q: { limit?: number; botKey?: BotKey } = {}): Promise<AuditEntry[]> => {
      const r = await this.getJson<{ entries: AuditEntry[] }>('/audit', {
        limit: q.limit ?? 100,
        bot: q.botKey,
      });
      return [...(r.entries ?? [])].sort((a, b) => b.ts_ms - a.ts_ms);
    },

    exportTradesCsv: async (q: TradeQuery): Promise<string> => {
      const sortOf = {
        close_ms: 'close_date',
        open_ms: 'open_date',
        profit_abs: 'profit',
      } as const;
      const params: Record<string, unknown> = {
        bots: q.bots,
        pair: q.pair,
        side: q.side,
        mode: q.mode?.length === 1 ? q.mode[0] : undefined,
        exit_reason: q.exitReason,
        from: q.fromMs,
        to: q.toMs,
        sort: q.sort && q.sort !== 'pair' ? sortOf[q.sort] : undefined,
        order: q.order,
      };
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '')
          clean[k] = Array.isArray(v) ? v.join(',') : v;
      }
      const res = await this.readWithSession<unknown>('/trades/export.csv', {
        params: clean,
        timeoutMs: 60_000,
      });
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    },

    trades: async (q: TradeQuery): Promise<TradePage> => {
      const common = {
        bots: q.bots,
        pair: q.pair,
        side: q.side,
        // One mode is asked of the gateway; several (or none) mean "every mode it follows".
        mode: q.mode?.length === 1 ? q.mode[0] : undefined,
      };
      if (q.status === 'open') {
        const r = await this.getJson<{ open: Position[] }>('/trades', {
          status: 'open',
          ...common,
        });
        const rows = r.open.map((p) => positionToTradeRow(p, this.modeOfBot(p.bot_key)));
        return pageTradeRows(rows, q, true);
      }
      const sortOf = {
        close_ms: 'close_date',
        open_ms: 'open_date',
        profit_abs: 'profit',
      } as const;
      const r = await this.getJson<{
        rows: TradeRow[];
        next_cursor?: string | null;
        totals: TradePage['totals'];
      }>('/trades', {
        status: 'closed',
        ...common,
        exit_reason: q.exitReason,
        from: q.fromMs,
        to: q.toMs,
        // The gateway cannot sort by pair: that order only applies to the rows loaded.
        sort: q.sort && q.sort !== 'pair' ? sortOf[q.sort] : undefined,
        order: q.order,
        cursor: q.cursor,
        limit: q.limit,
      });
      const items = q.sort === 'pair' ? sortRowsByPair(r.rows, q.order) : r.rows;
      return { items, nextCursor: r.next_cursor ?? null, totals: r.totals, complete: true };
    },

    periods: async (q: PeriodQuery): Promise<PeriodRow[]> => {
      const sp = this.scopeParams(q.scope, q.tradingMode);
      if (!sp) return [];
      const base = { unit: q.unit, n: q.n, ...sp };
      type Res = { buckets: PeriodRow[] };
      try {
        return (await this.getJson<Res>('/pnl/periods', { ...base, tz: q.tz })).buckets;
      } catch (e) {
        // The gateway cuts the days in its own time zone and refuses another one: take its cut.
        if (e instanceof GatewayError && e.code === 'bad_request') {
          return (await this.getJson<Res>('/pnl/periods', base)).buckets;
        }
        throw e;
      }
    },

    equity: async (q: EquityQuery): Promise<EquitySeries> => {
      const sp = this.scopeParams(q.scope, q.tradingMode);
      if (!sp) return { mode: q.mode, points: [], unavailable: 'empty_scope', asOfMs: this.now() };
      const r = await this.getJson<{ points: Array<{ ts_ms: number; value: number }> }>('/equity', {
        ...sp,
        from: q.fromMs,
        points: q.points,
        mode: q.mode,
      });
      return {
        mode: q.mode,
        points: r.points.map((p) => [p.ts_ms, p.value] as [number, number]),
        unavailable: null,
        asOfMs: this.now() + this.status.value.clockSkewMs,
      };
    },

    drawdown: async (q: DrawdownQuery): Promise<DrawdownResult | null> => {
      const sp = this.scopeParams(q.scope, q.tradingMode);
      if (!sp) return null;
      // Both definitions come together; the caller picks the one it names.
      return this.getJson<DrawdownResult>('/drawdown', sp);
    },

    logs: async (q: LogQuery): Promise<Page<LogLine>> => {
      const r = await this.getJson<{ lines: LogLine[]; next_cursor?: number | null }>('/logs', {
        bot: q.botKey,
        level: q.level ? gatewayLevel(q.level) : undefined,
        q: q.q,
        cursor: q.cursor,
        limit: q.limit,
      });
      return {
        items: r.lines,
        nextCursor: r.next_cursor == null ? null : String(r.next_cursor),
        complete: true,
      };
    },

    events: async (q: EventQuery): Promise<Page<Event>> => {
      const r = await this.getJson<{ events: Event[] }>('/events', {
        since: q.sinceMs,
        kinds: q.kinds,
        bot: q.botKey,
        limit: q.limit,
      });
      return { items: r.events, nextCursor: null, complete: true };
    },

    scope: async (s: ScopeRef): Promise<ScopeDetail> => {
      if (s.kind === 'bot') {
        const r = await this.getJson<GwScopeResponse>(`/scope/bot:${encodeURIComponent(s.botKey)}`);
        return {
          scope: s,
          bots: r.bots,
          positions: r.positions,
          totals: scopeTotalsByMode(r.bots, r.positions, walletOfRows(r.bots)),
          drawdown: r.drawdown,
          asOfMs: r.generated_ms,
        };
      }
      const fleet = await this.fleetDetail();
      if (s.kind === 'fleet') return fleet;
      // A group is the fleet restricted to its bots (a group may mix modes: one block per mode).
      const members = new Set(this.d.getGroups?.().find((g) => g.id === s.id)?.botKeys ?? []);
      const bots = fleet.bots.filter((b) => members.has(b.bot_key));
      const positions = fleet.positions.filter((p) => members.has(p.bot_key));
      let drawdown: DrawdownResult | null = null;
      if (bots.length > 0) {
        // Refused when the bots do not share a mode: a drawdown is never mixed.
        drawdown = await this.getJson<DrawdownResult>('/drawdown', {
          bots: bots.map((b) => b.bot_key).join(','),
        }).catch(() => null);
      }
      return {
        scope: s,
        bots,
        positions,
        totals: scopeTotalsByMode(bots, positions, walletOfRows(bots)),
        drawdown,
        asOfMs: fleet.asOfMs,
      };
    },
  };

  /** The fleet, one block per mode: the gateway totals each mode, never the fleet as a whole. */
  private async fleetDetail(): Promise<ScopeDetail> {
    const head = await this.getJson<{ totals: Array<{ mode: BotMode }> }>('/scope/fleet');
    const modes = [...new Set(head.totals.map((t) => t.mode))];
    const parts = await Promise.all(modes.map((m) => this.getJson<GwScopeResponse>(`/scope/${m}`)));
    const bots = parts.flatMap((p) => p.bots);
    const positions = parts.flatMap((p) => p.positions);
    const walletOf = walletOfRows(bots);
    return {
      scope: { kind: 'fleet' },
      bots,
      positions,
      totals: parts.flatMap((p) =>
        p.totals ? [fromGatewayTotals(p.totals, p.bots, p.positions, p.drawdown, walletOf)] : [],
      ),
      drawdown: parts.length === 1 ? parts[0].drawdown : null,
      asOfMs: Math.max(0, ...parts.map((p) => p.generated_ms)),
    };
  }

  // ---------------------------------------------------------------- alerts and registry

  /** Silences created from this tab: the gateway has no route to list them. */
  private readonly silenceBook = new Map<string, Silence>();

  readonly alerts: AlertsApi = {
    shared: true,
    rules: () => this.getJson<AlertRulesConfig>('/alerts/rules'),
    setRules: async (cfg) => {
      await this.sendJson('PUT', '/alerts/rules', cfg);
    },
    ack: async (id) => {
      await this.sendJson('POST', `/alerts/${encodeURIComponent(id)}/ack`, {});
    },
    silence: async (spec) => {
      const r = await this.sendJson<{ id: string; until_ms: number }>('POST', '/alerts/silence', {
        type_id: spec.typeId ?? null,
        bot_key: spec.botKey ?? null,
        subject: spec.subject ?? null,
        until_ms: spec.untilMs,
      });
      const silence: Silence = {
        id: r.id,
        type_id: spec.typeId ?? null,
        bot_key: spec.botKey ?? null,
        subject: spec.subject ?? null,
        until_ms: r.until_ms,
      };
      this.silenceBook.set(silence.id, silence);
      return silence;
    },
    unsilence: async (id) => {
      await this.sendJson('DELETE', `/alerts/silence/${encodeURIComponent(id)}`);
      this.silenceBook.delete(id);
    },
    silences: async () => {
      const t = this.now() + this.status.value.clockSkewMs;
      return [...this.silenceBook.values()].filter((x) => x.until_ms > t);
    },
    list: () => {
      // Pages read alerts from the store fed by the `alerts` channel; nothing is kept here.
      const rt = this.chans.get('alerts');
      return rt ? (Object.values(rt.collections.alerts ?? {}) as unknown as Alert[]) : [];
    },
  };

  readonly registry: RegistryApi = {
    list: async () => {
      const r = await this.getJson<{
        bots: Array<{ bot_key: BotKey; name: string; ui_ids?: string[] }>;
      }>('/bots');
      return r.bots.map((b) => ({
        botKey: b.bot_key,
        uiId: b.ui_ids?.[0] ?? this.registry.uiIdOf(b.bot_key),
        name: b.name,
        icon: null,
      }));
    },
    discovered: async () => {
      const r = await this.getJson<{
        discovered: Array<{
          bot_key: BotKey;
          name: string;
          port: number | null;
          mode: BotMode;
          registered_on_device?: boolean;
        }>;
      }>('/bots/discovered');
      return r.discovered
        .filter((b) => !b.registered_on_device)
        .map((b) => ({ botKey: b.bot_key, name: b.name, port: b.port, mode: b.mode }));
    },
    botKeyOf: (uiId) => this.d.aliases()[uiId] ?? null,
    uiIdOf: (key) => Object.entries(this.d.aliases()).find(([, k]) => k === key)?.[0] ?? null,
  };

  // ---------------------------------------------------------------- shared preferences

  /** The global preferences document (`GET/PUT /prefs`), for `PrefsSync`. */
  readonly prefsRemote: PrefsRemote = {
    get: async () => {
      await this.d.session.ensure();
      // `scope=` (empty) names the global document; without it the gateway lists every document.
      // `missing=204` asks for a 204 when none is written yet (a gateway that predates the option
      // ignores it and answers 404).
      const res = await this.d.http.raw<{ version: number; data: unknown }>('GET', '/prefs', {
        params: { scope: '', missing: '204' },
      });
      // 204: no document written yet. 404 is what a gateway before that contract answered.
      if (res.status === 204 || res.status === 404) return null;
      if (res.status < 200 || res.status >= 300) {
        throw new GatewayError('internal', res.status, `HTTP ${res.status}`);
      }
      return { version: res.data.version, data: res.data.data };
    },
    put: async (data, ifMatch) => {
      await this.d.session.ensure();
      const res = await this.d.http.json<{ version: number }>('PUT', '/prefs', {
        params: { scope: '' },
        body: data,
        headers: ifMatch === null ? {} : { 'If-Match': `"${ifMatch}"` },
      });
      return { version: res.version };
    },
  };

  // ---------------------------------------------------------------- proxy and actions

  async proxy<T>(
    botKey: BotKey,
    method: string,
    path: string,
    body?: unknown,
    opts?: ProxyOptions,
  ): Promise<T> {
    await this.d.session.ensure();
    const m = method.toUpperCase();
    const clean = path.replace(/^\/+/, '');
    if (m === 'GET') {
      // The pair lists of a bot are not in the passthrough whitelist (they would be a read of the
      // bot per viewer): the gateway keeps them in the detail of the bot and serves them itself.
      const viaPairs = await this.pairListRead<T>(botKey, clean);
      if (viaPairs !== undefined) return viaPairs;
    }
    const url = `/bots/${encodeURIComponent(botKey)}/proxy/${clean}`;
    if (m === 'GET') {
      return this.d.http.json<T>('GET', url, { timeoutMs: opts?.timeoutMs ?? 30_000 });
    }
    if (m !== 'POST' && m !== 'PUT' && m !== 'DELETE')
      throw new Error(`method ${method} not allowed`);
    return this.d.http.json<T>(m, url, {
      body,
      timeoutMs: opts?.timeoutMs ?? 30_000,
      headers: {
        'Idempotency-Key': `proxy-${this.now()}-${Math.random().toString(36).slice(2)}`,
        ...(opts?.confirmBot ? { 'X-Confirm-Bot': opts.confirmBot } : {}),
      },
    });
  }

  /**
   * `GET /whitelist`, `/blacklist` and `/locks` of a bot, answered from `GET /pairs/{key}` of the
   * gateway in the shape the bot itself uses. `undefined` for any other path. Not available from
   * the gateway, and therefore absent from the answer: the pairlist methods and the pipeline of
   * the whitelist, and the id of a lock (a lock can then be listed but not lifted from here).
   */
  private async pairListRead<T>(botKey: BotKey, path: string): Promise<T | undefined> {
    if (path !== 'whitelist' && path !== 'blacklist' && path !== 'locks') return undefined;
    const d = await this.getJson<{
      whitelist?: string[];
      blacklist?: string[];
      locks?: Array<{
        pair: string;
        reason?: string | null;
        until_ms?: number | null;
        side?: string | null;
      }>;
    }>(`/pairs/${encodeURIComponent(botKey)}`);
    if (path === 'whitelist') {
      const whitelist = d.whitelist ?? [];
      return { method: [], length: whitelist.length, whitelist } as T;
    }
    if (path === 'blacklist') {
      const blacklist = d.blacklist ?? [];
      return { method: [], length: blacklist.length, blacklist, errors: {} } as T;
    }
    return {
      locks: (d.locks ?? []).map((l) => ({
        pair: l.pair,
        reason: l.reason ?? null,
        side: l.side ?? null,
        lock_end_timestamp: l.until_ms ?? 0,
        active: true,
      })),
    } as T;
  }

  async act(botKey: BotKey, action: BotAction, idempotencyKey: string): Promise<ActionResult> {
    const t0 = this.now();
    try {
      await this.d.session.ensure();
    } catch {
      // No session means nothing was sent.
      return this.actionResult(t0, { status: 'unauthorized', error: 'unauthorized' });
    }
    if (action.kind === 'forceexit' && action.tradeId === 'all') {
      return this.exitAll(botKey, action, idempotencyKey, t0);
    }
    const calls = toGatewayActions(action);
    if (calls.length === 1) {
      return this.postAction(botKey, calls[0].name, calls[0].body, idempotencyKey, t0);
    }
    // The gateway takes one pair per call: one request each, with its own idempotency key.
    const results: ActionResult[] = [];
    for (const [i, c] of calls.entries()) {
      const r = await this.postAction(botKey, c.name, c.body, `${idempotencyKey}:${i}`, t0);
      results.push(r);
      if (r.status === 'unauthorized') break;
    }
    return this.combineResults(results, calls.length, t0);
  }

  /** Exit every open position of a bot: the gateway has no "all", so one forceexit per trade. */
  private async exitAll(
    botKey: BotKey,
    action: Extract<BotAction, { kind: 'forceexit' }>,
    idempotencyKey: string,
    t0: number,
  ): Promise<ActionResult> {
    let open: Position[];
    try {
      open = (
        await this.getJson<{ open: Position[] }>('/trades', { status: 'open', bots: botKey })
      ).open.filter((p) => !p.orphan);
    } catch {
      // The positions could not be read: nothing was sent.
      return this.actionResult(t0, {
        status: 'rejected',
        error: 'bot_unreachable',
        botResponse: 'positions could not be read',
      });
    }
    if (open.length === 0) {
      return this.actionResult(t0, { status: 'state_mismatch', error: 'state_mismatch' });
    }
    const results: ActionResult[] = [];
    for (const p of open) {
      const body: Record<string, unknown> = {
        trade_id: p.trade_id,
        expected: { pair: p.pair, is_short: p.side === 'short' },
        ...(action.orderType ? { ordertype: action.orderType } : {}),
        ...(action.confirm !== undefined ? { confirm: action.confirm } : {}),
      };
      const r = await this.postAction(
        botKey,
        'forceexit',
        body,
        `${idempotencyKey}:${p.trade_id}`,
        t0,
      );
      results.push(r);
      if (r.status === 'unauthorized') break;
    }
    return this.combineResults(results, open.length, t0);
  }

  /** One result for a batch: accepted only when every call was; a partial batch is `unknown`. */
  private combineResults(results: ActionResult[], expected: number, t0: number): ActionResult {
    const ok = results.filter((r) => r.status === 'accepted');
    if (ok.length === expected) return { ...ok[0], latencyMs: this.now() - t0 };
    if (ok.length === 0) return { ...results[0], latencyMs: this.now() - t0 };
    return this.actionResult(t0, {
      status: 'unknown',
      botResponse: `${ok.length}/${expected}`,
      verify: { expectedState: 'check_bot', checkAfterMs: 5_000 },
    });
  }

  private actionResult(
    t0: number,
    p: Partial<ActionResult> & Pick<ActionResult, 'status'>,
  ): ActionResult {
    return {
      botResponse: null,
      httpStatus: null,
      error: null,
      verify: null,
      latencyMs: this.now() - t0,
      ...p,
    };
  }

  private async postAction(
    botKey: BotKey,
    name: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
    t0: number,
  ): Promise<ActionResult> {
    const result = (p: Partial<ActionResult> & Pick<ActionResult, 'status'>) =>
      this.actionResult(t0, p);
    try {
      // One request, never retried (a 401 is NOT replayed after a new session).
      const res = await this.d.http.raw<{
        status?: 'accepted' | 'rejected' | 'unknown';
        bot_response?: string;
        reason?: string | null;
        verify?: { expected_state: string; check_after_ms: number };
        code?: string;
        message?: string;
      }>('POST', `/bots/${encodeURIComponent(botKey)}/actions/${name}`, {
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
        timeoutMs: ACTION_TIMEOUT_MS,
      });
      const d = res.data ?? {};
      if (res.status >= 200 && res.status < 300) {
        if (d.status === 'rejected' && d.reason === 'state_mismatch') {
          return result({
            status: 'state_mismatch',
            httpStatus: res.status,
            error: 'state_mismatch',
          });
        }
        return result({
          status: d.status ?? 'accepted',
          httpStatus: res.status,
          botResponse: d.bot_response ?? null,
          verify: d.verify
            ? { expectedState: d.verify.expected_state, checkAfterMs: d.verify.check_after_ms }
            : null,
        });
      }
      if (res.status === 401) {
        // The session is dead: open a new one in the background so that "Retry" works, but do not
        // replay this action.
        void this.d.session.renew().catch(() => undefined);
        return result({ status: 'unauthorized', httpStatus: 401, error: 'unauthorized' });
      }
      if (res.status === 409) {
        return d.code === 'in_progress'
          ? result({ status: 'in_progress', httpStatus: 409, error: 'in_progress' })
          : result({ status: 'state_mismatch', httpStatus: 409, error: 'state_mismatch' });
      }
      return result({
        status: 'rejected',
        httpStatus: res.status,
        error: (d.code as ActionResult['error']) ?? 'internal',
        botResponse: d.message ?? null,
      });
    } catch (e) {
      if (e instanceof GatewayError) {
        // The request may have reached the gateway: neither success nor failure.
        return result({
          status: 'unknown',
          botResponse: e.code,
          verify: { expectedState: 'check_bot', checkAfterMs: 5_000 },
        });
      }
      throw e;
    }
  }
}

type GatewayCall = { name: string; body: Record<string, unknown> };

/**
 * Typed action to the calls of `POST /bots/{key}/actions/{action}` (fields of the Rust `Params`:
 * unknown ones are refused). Most are one call; the blacklist takes one pair per call.
 * `forceexit` of `all` is expanded by `exitAll`, not here.
 */
export function toGatewayActions(a: BotAction): GatewayCall[] {
  switch (a.kind) {
    case 'forceexit':
      return [
        {
          name: 'forceexit',
          body: {
            trade_id: a.tradeId,
            ...(a.expected
              ? { expected: { pair: a.expected.pair, is_short: a.expected.isShort } }
              : {}),
            ...(a.amount !== undefined ? { amount: a.amount } : {}),
            ...(a.orderType ? { ordertype: a.orderType } : {}),
            ...(a.price !== undefined ? { price: a.price } : {}),
            ...(a.confirm !== undefined ? { confirm: a.confirm } : {}),
          },
        },
      ];
    case 'forceentry':
      return [
        {
          name: 'forceentry',
          body: {
            pair: a.pair,
            ...(a.side ? { side: a.side } : {}),
            ...(a.stakeAmount !== undefined ? { stake_amount: a.stakeAmount } : {}),
            ...(a.price !== undefined ? { price: a.price } : {}),
            ...(a.orderType ? { ordertype: a.orderType } : {}),
            ...(a.leverage !== undefined ? { leverage: a.leverage } : {}),
            ...(a.entryTag ? { enter_tag: a.entryTag } : {}),
          },
        },
      ];
    case 'stop':
      return [{ name: 'stop', body: a.confirm !== undefined ? { confirm: a.confirm } : {} }];
    case 'start':
    case 'stopbuy':
    case 'reload_config':
      return [{ name: a.kind, body: {} }];
    case 'delete_trade':
      return [
        {
          name: 'delete_trade',
          body: { trade_id: a.tradeId, ...(a.confirm !== undefined ? { confirm: a.confirm } : {}) },
        },
      ];
    case 'cancel_open_order':
    case 'reload_trade':
      return [{ name: a.kind, body: { trade_id: a.tradeId } }];
    case 'blacklist_add':
    case 'blacklist_remove':
      return a.pairs.map((pair) => ({ name: a.kind, body: { pair } }));
    case 'lock_delete':
      return [{ name: 'lock_delete', body: { lock_id: a.lockId } }];
  }
}
