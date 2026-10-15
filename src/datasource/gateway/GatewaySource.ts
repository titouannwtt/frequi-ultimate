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
  type BotKey,
  type DrawdownResult,
  type Event,
  type LogLine,
  type ServerFrame,
  type Silence,
} from '@/gateway/types.gen';
import type { AlertRulesConfig } from '@/gateway/types.gen';

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
  DiscoveredBot,
  DrawdownQuery,
  EquityQuery,
  EquitySeries,
  EventQuery,
  LogQuery,
  Page,
  PeriodQuery,
  PeriodRow,
  ProxyOptions,
  RegistryApi,
  RegistryBot,
  ScopeDetail,
  ScopeRef,
  SourceStatus,
  StateUpdate,
  TradePage,
  TradeQuery,
} from '../types';
import { scopeKey } from '../types';
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
  private async readWithSession<T>(path: string, opts: { params?: Record<string, unknown> } = {}) {
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

  readonly query = {
    trades: async (q: TradeQuery): Promise<TradePage> => {
      const r = await this.getJson<{
        items: TradePage['items'];
        next_cursor?: string | null;
        totals: TradePage['totals'];
        complete?: boolean;
      }>('/trades', {
        status: q.status,
        bots: q.bots,
        pair: q.pair,
        side: q.side,
        exit_reason: q.exitReason,
        mode: q.mode,
        from: q.fromMs,
        to: q.toMs,
        sort: q.sort,
        order: q.order,
        cursor: q.cursor,
        limit: q.limit,
      });
      return {
        items: r.items,
        nextCursor: r.next_cursor ?? null,
        totals: r.totals,
        complete: r.complete ?? true,
      };
    },
    periods: async (q: PeriodQuery): Promise<PeriodRow[]> => {
      const r = await this.getJson<PeriodRow[] | { items: PeriodRow[] }>('/pnl/periods', {
        unit: q.unit,
        scope: scopeKey(q.scope),
        tz: q.tz,
        n: q.n,
        mode: q.tradingMode,
      });
      return Array.isArray(r) ? r : r.items;
    },
    equity: async (q: EquityQuery): Promise<EquitySeries> => {
      const r = await this.getJson<{ points: Array<[number, number]>; as_of_ms?: number }>(
        '/equity',
        {
          scope: scopeKey(q.scope),
          from: q.fromMs,
          points: q.points,
          mode: q.mode,
          trading_mode: q.tradingMode,
        },
      );
      return {
        mode: q.mode,
        points: r.points,
        unavailable: null,
        asOfMs: r.as_of_ms ?? this.now(),
      };
    },
    drawdown: async (q: DrawdownQuery): Promise<DrawdownResult | null> =>
      this.getJson<DrawdownResult>('/drawdown', {
        scope: scopeKey(q.scope),
        def: q.def,
        mode: q.tradingMode,
      }),
    logs: async (q: LogQuery): Promise<Page<LogLine>> => {
      const r = await this.getJson<{ items: LogLine[]; next_cursor?: string | null }>('/logs', {
        bot: q.botKey,
        level: q.level,
        q: q.q,
        cursor: q.cursor,
        limit: q.limit,
      });
      return { items: r.items, nextCursor: r.next_cursor ?? null, complete: true };
    },
    events: async (q: EventQuery): Promise<Page<Event>> => {
      const r = await this.getJson<{ items: Event[]; next_cursor?: string | null }>('/events', {
        since: q.sinceMs,
        kinds: q.kinds,
        bot: q.botKey,
        limit: q.limit,
      });
      return { items: r.items, nextCursor: r.next_cursor ?? null, complete: true };
    },
    scope: async (s: ScopeRef): Promise<ScopeDetail> =>
      this.getJson<ScopeDetail>(`/scope/${encodeURIComponent(scopeKey(s))}`),
  };

  // ---------------------------------------------------------------- alerts and registry

  readonly alerts: AlertsApi = {
    shared: true,
    rules: () => this.getJson<AlertRulesConfig>('/alerts/rules'),
    setRules: async (cfg) => {
      await this.sendJson('PUT', '/alerts/rules', cfg);
    },
    ack: async (id) => {
      await this.sendJson('POST', `/alerts/${encodeURIComponent(id)}/ack`, {});
    },
    silence: (spec) =>
      this.sendJson<Silence>('POST', '/alerts/silence', {
        type_id: spec.typeId ?? null,
        bot_key: spec.botKey ?? null,
        subject: spec.subject ?? null,
        until_ms: spec.untilMs,
      }),
    unsilence: async (id) => {
      await this.sendJson('DELETE', `/alerts/silence/${encodeURIComponent(id)}`);
    },
    silences: () => this.getJson<Silence[]>('/alerts/silence'),
    list: () => {
      // Pages read alerts from the store fed by the `alerts` channel; nothing is kept here.
      const rt = this.chans.get('alerts');
      return rt ? (Object.values(rt.collections.alerts ?? {}) as unknown as Alert[]) : [];
    },
  };

  readonly registry: RegistryApi = {
    list: () => this.getJson<RegistryBot[]>('/bots'),
    discovered: () => this.getJson<DiscoveredBot[]>('/bots/discovered'),
    botKeyOf: (uiId) => this.d.aliases()[uiId] ?? null,
    uiIdOf: (key) => Object.entries(this.d.aliases()).find(([, k]) => k === key)?.[0] ?? null,
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
    const url = `/bots/${encodeURIComponent(botKey)}/proxy/${clean}`;
    if (m === 'GET') {
      return this.d.http.json<T>('GET', url, { timeoutMs: opts?.timeoutMs ?? 30_000 });
    }
    if (m !== 'POST' && m !== 'PUT' && m !== 'DELETE')
      throw new Error(`method ${method} not allowed`);
    return this.d.http.json<T>(m, url, {
      body,
      timeoutMs: opts?.timeoutMs ?? 30_000,
      headers: { 'Idempotency-Key': `proxy-${this.now()}-${Math.random().toString(36).slice(2)}` },
    });
  }

  async act(botKey: BotKey, action: BotAction, idempotencyKey: string): Promise<ActionResult> {
    const t0 = this.now();
    const result = (p: Partial<ActionResult> & Pick<ActionResult, 'status'>): ActionResult => ({
      botResponse: null,
      httpStatus: null,
      error: null,
      verify: null,
      latencyMs: this.now() - t0,
      ...p,
    });
    const { name, body } = toGatewayAction(action);
    try {
      await this.d.session.ensure();
    } catch {
      // No session means nothing was sent.
      return result({ status: 'unauthorized', error: 'unauthorized' });
    }
    try {
      // One request, never retried (a 401 is NOT replayed after a new session).
      const res = await this.d.http.raw<{
        status?: 'accepted' | 'rejected' | 'unknown';
        bot_response?: string;
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

/** Typed action to the path segment and body of `POST /bots/{key}/actions/{action}`. */
export function toGatewayAction(a: BotAction): { name: string; body: Record<string, unknown> } {
  switch (a.kind) {
    case 'forceexit':
      return {
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
      };
    case 'forceentry':
      return {
        name: 'forceentry',
        body: {
          pair: a.pair,
          ...(a.side ? { side: a.side } : {}),
          ...(a.stakeAmount !== undefined ? { stake_amount: a.stakeAmount } : {}),
          ...(a.price !== undefined ? { price: a.price } : {}),
          ...(a.orderType ? { ordertype: a.orderType } : {}),
          ...(a.leverage !== undefined ? { leverage: a.leverage } : {}),
          ...(a.entryTag ? { entry_tag: a.entryTag } : {}),
        },
      };
    case 'stop':
      return { name: 'stop', body: a.confirm !== undefined ? { confirm: a.confirm } : {} };
    case 'start':
    case 'stopbuy':
    case 'reload_config':
      return { name: a.kind, body: {} };
    case 'delete_trade':
      return {
        name: 'delete_trade',
        body: { trade_id: a.tradeId, ...(a.confirm !== undefined ? { confirm: a.confirm } : {}) },
      };
    case 'cancel_open_order':
    case 'reload_trade':
      return { name: a.kind, body: { trade_id: a.tradeId } };
    case 'blacklist_add':
    case 'blacklist_remove':
      return { name: a.kind, body: { pairs: a.pairs } };
    case 'lock_delete':
      return { name: 'lock_delete', body: { lock_id: a.lockId } };
  }
}
