/**
 * Direct mode: the browser polls the bots itself, with the tokens of `ftAuthLoginInfo`, and
 * computes every aggregate in TypeScript with the ports of `fg-core` (`../calc`, validated on the
 * shared vectors). It is the fallback when the gateway is unreachable and the whole offer for
 * open-source users without a gateway.
 *
 * What it does NOT do (02 section 10.4): alerts 24/7 and shared acknowledgements, the 24 h
 * sparkline, duration percentiles, MAE/MFE, a server side journal, the reconciliation and chart
 * relays. Those channels answer `unavailable` instead of an invented value.
 *
 * Real money rules implemented here: a mutation is sent once, never replayed (see `botClient`);
 * the target is checked against a fresh `/status` before an exit (`state_mismatch`); the same
 * idempotency key returns the first result instead of sending twice; the bot name must be typed for
 * destructive actions.
 */
import { ref, type Ref } from 'vue';

import type {
  Alert,
  AlertRulesConfig,
  BotKey,
  BotMode,
  BotRow,
  BotAlertContext,
  Event,
  LogLine,
  Position,
  Silence,
  TradeRow,
  WalletRow,
  WalletReport,
  Health,
  HealthReason,
  PositionCtx,
  DrawdownResult,
  ClosedPnl,
  HistorySample,
} from '@/gateway/types.gen';
import type {
  BalanceInterface,
  BotState,
  ClosedTrade,
  FleetStatusResponse,
  FleetviewOverviewResponse,
  ProfitStats,
  Trade,
  TradeResponse,
} from '@/types';
import type { FleetProfitHistoryResponse } from '@/types/fleetProfitHistory';
import type { FleetSnapshotResponse } from '@/types/fleetSnapshot';

import { AlertBook } from '../calc/alerts/book';
import { defaultAlertRulesConfig, effectiveRulesFor, evaluateBot } from '../calc/alerts/rules';
import { walletTotals, sumStartingCapital } from '../calc/capital';
import { computeDrawdown, mergeHistories } from '../calc/drawdown';
import { medianDurationMs, durationMs, parseAvgDurationMs, MIN_SAMPLES } from '../calc/duration';
import { exposure } from '../calc/exposure';
import { computeFreshness } from '../calc/freshness';
import { pnlPeriods } from '../calc/periods';
import { scopeTotalsByMode } from '../calc/scopeTotals';
import { pageTradeRows } from '../calc/tradePage';
import { normalizeTsMs } from '../calc/time';
import { botKeyFromApiUrl, parseOrigin } from '../protocol/identity';
import { StateHub } from '../hub';
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
  SourceStatus,
  TradePage,
  TradeQuery,
} from '../types';
import { axiosHttp, type HttpClient } from './http';
import type { AuthStore } from './auth';
import { BotRequestError, createBotClient, type BotClient } from './botClient';
import { createFailureStreak } from './offline';
import { mapClosedTrade, mapLogs, mapOpenTrade, positionToTradeRow, toOpenRisk } from './mappers';
import {
  buildBotRow,
  closedCountOf,
  closedHistoryOutdated,
  inferWallets,
  modeKnown,
  modeOf,
  nameOf,
  newRuntime,
  startingCapitalOf,
  statusOf,
  type BotRuntime,
  type Cadences,
  type ClosedHistory,
  type Fetched,
} from './model';

export interface DirectSourceDeps {
  auth: AuthStore;
  http?: HttpClient;
  now?: () => number;
  /** Host names that mean "this machine" in `apiUrl` (the host serving the UI). */
  localHosts?: readonly string[];
  /** Origin of the UI, for bots whose `apiUrl` is empty (same origin). */
  selfOrigin?: string;
  /** `reduced`: fleet digest + the bots in focus only (phones). */
  profile?: 'full' | 'reduced';
  getAlertRules?: () => AlertRulesConfig;
  setAlertRules?: (cfg: AlertRulesConfig) => void;
  /** Groups of the preferences, for `group:<id>` scopes. */
  getGroups?: () => ReadonlyArray<{ id: string; botKeys: BotKey[] }>;
  /** Pause the polling while the tab is hidden. */
  isVisible?: () => boolean;
  /** Timer functions, injectable for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  /** Period of the internal scheduler. */
  tickMs?: number;
  /** Requests in flight at the same time, all bots together. */
  maxConcurrent?: number;
}

const DEFAULT_CADENCES: Cadences = {
  statusMs: 30_000,
  slowMs: 180_000,
  digestMs: 10_000,
  overviewMs: 60_000,
};
const FOCUS_STATUS_MS = 10_000;
const FOCUS_SLOW_MS = 60_000;
const LOGS_FOCUS_MS = 30_000;
const LOGS_BG_MS = 120_000;
const FLEET_STATUS_MS = 20_000;
const EMIT_DEBOUNCE_MS = 200;
const EVENT_RING = 500;
/** A position older than this is fetched again before an exit is sent. */
const GUARD_MAX_AGE_MS = 10_000;
const CLOSED_PAGE = 500;
const CLOSED_CAP_PER_BOT = 2_000;
const CLOSED_TTL_MS = 10 * 60_000;
/** Background read of the closed trades: one bot at a time, spaced out, retried slowly. */
const CLOSED_WARM_GAP_MS = 3_000;
const CLOSED_RETRY_MS = 60_000;
const HISTORY_TTL_MS = 60_000;
const STALE_REFETCH_AFTER_ACTION_MS = [1_000, 4_000];

interface Task {
  next: number;
  running: boolean;
}

interface RuntimeTasks {
  status: Task;
  slow: Task;
  logs: Task;
}

interface StoredAction {
  /** Settled result, or null while the request is in flight. */
  result: ActionResult | null;
  lockKey: string;
}

/** At most `n` evenly spaced points, first one kept. */
function thin<T>(points: T[], n: number | undefined): T[] {
  if (!n || points.length <= n) return points;
  const step = points.length / n;
  return Array.from(
    { length: n },
    (_, i) => points[Math.min(points.length - 1, Math.floor(i * step))]!,
  );
}

const truncate = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n)}...` : s);

/** Short human readable text of a bot answer, never a token. */
function describe(data: unknown): string {
  if (typeof data === 'string') return truncate(data);
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const k of ['detail', 'error', 'status', 'result_msg', 'message']) {
      if (typeof d[k] === 'string') return truncate(d[k] as string);
    }
    try {
      return truncate(JSON.stringify(data));
    } catch {
      return '';
    }
  }
  return '';
}

function eventKey(e: Event): string {
  return `${e.kind}|${e.bot_key}|${e.trade_id}|${e.ts_ms}`;
}

/** Order of a trade as freqtrade's REST API writes it (`GET /trades/{id}`). */
interface RestOrder {
  ft_order_side?: string;
  ft_is_entry?: boolean;
  ft_order_tag?: string | null;
  status?: string;
  is_open?: boolean;
  filled?: number;
  amount?: number;
  safe_price?: number;
  price?: number;
  cost?: number;
  order_filled_timestamp?: number | null;
}

export class DirectSource implements DataSource {
  readonly kind = 'direct' as const;
  readonly status: Ref<SourceStatus> = ref({
    state: 'connecting',
    lastSyncMs: 0,
    clockSkewMs: 0,
    latencyMs: null,
    resyncing: false,
    reason: null,
  });

  private readonly now: () => number;
  private readonly client: BotClient;
  private readonly auth: AuthStore;
  private readonly deps: DirectSourceDeps;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (h: unknown) => void;
  private readonly rts = new Map<BotKey, BotRuntime>();
  private readonly tasks = new Map<BotKey, RuntimeTasks>();
  private readonly streaks = new Map<BotKey, ReturnType<typeof createFailureStreak>>();
  private readonly focus = new Map<BotKey, number>();
  private readonly book = new AlertBook();
  private readonly events: Event[] = [];
  private readonly eventSinks = new Set<(u: ChannelUpdate['events']) => void>();
  private readonly logSinks = new Map<BotKey | '*', Set<(u: ChannelUpdate['logs']) => void>>();
  private readonly hubs: Record<'fleet' | 'positions' | 'alerts' | 'health', StateHub>;
  private readonly actions = new Map<string, StoredAction>();
  private readonly lockedKeys = new Set<string>();
  private readonly inflight = new Set<Promise<unknown>>();
  private closedWarm: Task = { next: 0, running: false };
  private closedRetryAt = new Map<string, number>();
  private fleetTask: Record<'digest' | 'overview' | 'fleetStatus', Task> = {
    digest: { next: 0, running: false },
    overview: { next: 0, running: false },
    fleetStatus: { next: 0, running: false },
  };
  private digestAvailable = true;
  private overviewAvailable = true;
  private fleetStatusAvailable = true;
  private fleetStatus: Fetched<FleetStatusResponse> | null = null;
  private running = false;
  private timer: unknown = null;
  private emitTimer: unknown = null;
  private seqEvents = 0;
  private lastPositionKeys = new Map<BotKey, Map<number, Position>>();
  private lastReach = new Map<BotKey, string>();
  private lastEvalMs = 0;
  private firstEmit = true;
  private historyCache: { atMs: number; byName: Map<string, HistorySample[]> } | null = null;
  private seenAlertTransitions = new Set<string>();

  constructor(deps: DirectSourceDeps) {
    this.deps = deps;
    this.auth = deps.auth;
    this.now = deps.now ?? Date.now;
    this.setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.client = createBotClient({ http: deps.http ?? axiosHttp, auth: deps.auth, now: this.now });
    this.hubs = {
      fleet: new StateHub(['bots', 'wallets'], this.now),
      positions: new StateHub(['positions'], this.now),
      alerts: new StateHub(['alerts'], this.now),
      health: new StateHub(['health'], this.now),
    };
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.syncRegistry();
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.clearT(this.timer);
    if (this.emitTimer !== null) this.clearT(this.emitTimer);
    this.timer = null;
    this.emitTimer = null;
  }

  /** Wait for the requests in flight (tests and orderly shutdown). */
  async settle(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled([...this.inflight]);
    }
  }

  /** Recompute and publish at once (tests). */
  flush(): void {
    if (this.emitTimer !== null) {
      this.clearT(this.emitTimer);
      this.emitTimer = null;
    }
    this.emit();
  }

  // ---------------------------------------------------------------- registry

  private get localHosts(): readonly string[] {
    return this.deps.localHosts ?? [];
  }

  private cadencesFor(rt: BotRuntime): { statusMs: number; slowMs: number; logsMs: number } {
    const focused = (this.focus.get(rt.key) ?? 0) > 0;
    const reduced = this.deps.profile === 'reduced';
    if (focused) return { statusMs: FOCUS_STATUS_MS, slowMs: FOCUS_SLOW_MS, logsMs: LOGS_FOCUS_MS };
    if (reduced) {
      return {
        statusMs: Number.POSITIVE_INFINITY,
        slowMs: Number.POSITIVE_INFINITY,
        logsMs: Number.POSITIVE_INFINITY,
      };
    }
    return {
      statusMs: DEFAULT_CADENCES.statusMs,
      slowMs: DEFAULT_CADENCES.slowMs,
      logsMs: LOGS_BG_MS,
    };
  }

  /** Align the runtimes with `ftAuthLoginInfo` (bots added or removed in the meantime). */
  private syncRegistry(): void {
    const seen = new Set<BotKey>();
    const entries = this.auth.entries();
    entries.forEach((e, idx) => {
      const url = e.apiUrl || this.deps.selfOrigin || '';
      const key = url ? botKeyFromApiUrl(url, this.localHosts) : null;
      if (!key) return;
      seen.add(key);
      const origin = url ? parseOrigin(url) : null;
      const port = origin ? origin.port : null;
      let rt = this.rts.get(key);
      if (!rt) {
        rt = newRuntime(e.id, key, e.botName, e.botIcon ?? null, port, e.sortId ?? idx);
        this.rts.set(key, rt);
        this.tasks.set(key, {
          status: { next: 0, running: false },
          slow: { next: 0, running: false },
          logs: { next: 0, running: false },
        });
        this.streaks.set(key, createFailureStreak());
      } else {
        rt.id = e.id;
        rt.name = e.botName;
        rt.icon = e.botIcon ?? null;
        rt.port = port;
        rt.sortId = e.sortId ?? idx;
      }
    });
    for (const key of [...this.rts.keys()]) {
      if (!seen.has(key)) {
        this.rts.delete(key);
        this.tasks.delete(key);
        this.streaks.delete(key);
      }
    }
  }

  private byId(id: string): BotRuntime | undefined {
    for (const rt of this.rts.values()) if (rt.id === id) return rt;
    return undefined;
  }

  readonly registry: RegistryApi = {
    list: async () => {
      this.syncRegistry();
      return [...this.rts.values()]
        .sort((a, b) => a.sortId - b.sortId)
        .map((rt) => ({ botKey: rt.key, uiId: rt.id, name: nameOf(rt), icon: rt.icon }));
    },
    discovered: async () => [],
    botKeyOf: (uiId) => this.byId(uiId)?.key ?? null,
    uiIdOf: (key) => this.rts.get(key)?.id ?? null,
  };

  // ---------------------------------------------------------------- scheduler

  private tick = (): void => {
    if (!this.running) return;
    this.syncRegistry();
    const visible = this.deps.isVisible ? this.deps.isVisible() : true;
    if (visible) this.dispatchDue();
    this.timer = this.setT(this.tick, this.deps.tickMs ?? 1000);
  };

  private get maxConcurrent(): number {
    return this.deps.maxConcurrent ?? 4;
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p);
    const done = () => this.inflight.delete(p);
    p.then(done, done);
    return p;
  }

  private dispatchDue(): void {
    const now = this.now();
    // Fleet level requests first: one bot answers for the fleet.
    const anchor = this.anchor();
    if (anchor) {
      this.fleetJob('digest', now, DEFAULT_CADENCES.digestMs, this.digestAvailable, () =>
        this.pollDigest(anchor),
      );
      this.fleetJob('overview', now, DEFAULT_CADENCES.overviewMs, this.overviewAvailable, () =>
        this.pollOverview(anchor),
      );
      this.fleetJob('fleetStatus', now, FLEET_STATUS_MS, this.fleetStatusAvailable, () =>
        this.pollFleetStatus(anchor),
      );
    }
    const sorted = [...this.rts.values()].sort((a, b) => a.sortId - b.sortId);
    for (const rt of sorted) {
      const t = this.tasks.get(rt.key);
      if (!t) continue;
      const c = this.cadencesFor(rt);
      this.botJob(rt, t.status, now, c.statusMs, () => this.pollStatus(rt));
      this.botJob(rt, t.slow, now, c.slowMs, () => this.pollSlow(rt));
      this.botJob(rt, t.logs, now, c.logsMs, () => this.pollLogs(rt));
    }
    this.warmClosed(sorted, now);
  }

  /**
   * Keep the closed history of every reachable bot loaded (the day figure is computed from it,
   * whatever the page): read once, then again only when the bot reports another closed-trade
   * count. One bot at a time, so the fleet sees a trickle of requests.
   */
  private warmClosed(bots: BotRuntime[], now: number): void {
    const t = this.closedWarm;
    if (t.running || now < t.next || this.inflight.size >= this.maxConcurrent) return;
    const rt = bots.find(
      (b) =>
        b.reach === 'online' &&
        modeKnown(b) &&
        (!b.closed || closedHistoryOutdated(b)) &&
        now >= (this.closedRetryAt.get(b.key) ?? 0),
    );
    if (!rt) return;
    t.running = true;
    t.next = now + CLOSED_WARM_GAP_MS;
    this.closedRetryAt.set(rt.key, now + CLOSED_RETRY_MS);
    void this.track(this.ensureClosed(rt).finally(() => (t.running = false)));
  }

  /** The bot that answers for the whole fleet: the first reachable one, the UI's own first. */
  private anchor(): BotRuntime | null {
    const cands = [...this.rts.values()]
      .filter((rt) => rt.reach === 'online' || rt.reach === 'unknown')
      .sort((a, b) => a.sortId - b.sortId);
    const self = cands.find((rt) => {
      const e = this.auth.entries().find((x) => x.id === rt.id);
      return !!e && !e.apiUrl;
    });
    return self ?? cands[0] ?? null;
  }

  private fleetJob(
    name: 'digest' | 'overview' | 'fleetStatus',
    now: number,
    every: number,
    available: boolean,
    job: () => Promise<void>,
  ): void {
    const t = this.fleetTask[name];
    if (!available || t.running || now < t.next || this.inflight.size >= this.maxConcurrent) return;
    t.running = true;
    t.next = now + every;
    void this.track(job().finally(() => (t.running = false)));
  }

  private botJob(
    _rt: BotRuntime,
    t: Task,
    now: number,
    every: number,
    job: () => Promise<void>,
  ): void {
    if (!Number.isFinite(every) || t.running || now < t.next) return;
    if (this.inflight.size >= this.maxConcurrent) return;
    t.running = true;
    t.next = now + every;
    void this.track(job().finally(() => (t.running = false)));
  }

  /** Ask for a task of a bot to run again as soon as possible. */
  private due(rt: BotRuntime, which: keyof RuntimeTasks): void {
    const t = this.tasks.get(rt.key);
    if (t) t[which].next = 0;
  }

  // ---------------------------------------------------------------- polling

  private markContact(rt: BotRuntime): void {
    const now = this.now();
    rt.lastContactMs = now;
    this.streaks.get(rt.key)?.onSuccess();
    if (rt.reach !== 'online') {
      rt.reach = 'online';
      rt.reachSinceMs = now;
    }
  }

  /** Account for a request that got no usable answer. */
  private markFailure(rt: BotRuntime, err: unknown): void {
    const now = this.now();
    if (err instanceof BotRequestError) {
      if (err.failure.kind === 'auth_expired') {
        if (rt.reach !== 'auth_expired') {
          rt.reach = 'auth_expired';
          rt.reachSinceMs = now;
        }
        return;
      }
      if (err.failure.kind === 'transport') {
        const reached = this.streaks.get(rt.key)?.onFailure() ?? false;
        if (reached && rt.reach !== 'starting' && rt.reach !== 'offline') {
          rt.reach = 'offline';
          rt.reachSinceMs = now;
        }
      }
    }
  }

  /** HTTP 500 counts like a dead bot, 502 "not in the correct state" is a bot starting. */
  private classify(rt: BotRuntime, status: number, data: unknown): 'ok' | 'failed' {
    if (status === 502 && /not in the correct state/i.test(describe(data))) {
      this.streaks.get(rt.key)?.onSuccess();
      rt.lastContactMs = this.now();
      if (rt.reach !== 'starting') {
        rt.reach = 'starting';
        rt.reachSinceMs = this.now();
      }
      return 'failed';
    }
    if (status >= 500) {
      this.markFailure(rt, new BotRequestError({ kind: 'transport', transport: 'network' }));
      return 'failed';
    }
    if (status === 401) {
      return 'failed';
    }
    this.markContact(rt);
    return 'ok';
  }

  private async fetchJson<T>(
    rt: BotRuntime,
    path: string,
    params?: Record<string, unknown>,
  ): Promise<{ ok: true; data: T } | { ok: false; status: number | null }> {
    try {
      const res = await this.client.get<T>(rt.id, path, { params });
      if (res.status === 404) {
        this.markContact(rt);
        return { ok: false, status: 404 };
      }
      if (res.status >= 200 && res.status < 300) {
        if (this.classify(rt, res.status, res.data) === 'ok') return { ok: true, data: res.data };
        return { ok: false, status: res.status };
      }
      this.classify(rt, res.status, res.data);
      return { ok: false, status: res.status };
    } catch (e) {
      this.markFailure(rt, e);
      return { ok: false, status: null };
    }
  }

  private async pollStatus(rt: BotRuntime): Promise<void> {
    const r = await this.fetchJson<Trade[]>(rt, '/status');
    if (r.ok && Array.isArray(r.data)) {
      rt.status = { data: r.data, atMs: this.now() };
    }
    this.scheduleEmit();
  }

  private async pollSlow(rt: BotRuntime): Promise<void> {
    const cfg = await this.fetchJson<BotState>(rt, '/show_config');
    if (cfg.ok) rt.config = { data: cfg.data, atMs: this.now() };
    if (rt.reach === 'offline' || rt.reach === 'auth_expired') {
      this.scheduleEmit();
      return;
    }
    let profit = await this.fetchJson<{ all?: ProfitStats } & ProfitStats>(rt, '/profit_all');
    if (!profit.ok && profit.status === 404) {
      profit = await this.fetchJson<{ all?: ProfitStats } & ProfitStats>(rt, '/profit');
    }
    if (profit.ok) {
      const all = profit.data.all ?? (profit.data as ProfitStats);
      rt.profit = { data: all, atMs: this.now() };
    }
    const bal = await this.fetchJson<BalanceInterface>(rt, '/balance');
    if (bal.ok) rt.balance = { data: bal.data, atMs: this.now() };
    const wl = await this.fetchJson<{ whitelist?: string[] }>(rt, '/whitelist');
    if (wl.ok && Array.isArray(wl.data.whitelist)) {
      rt.whitelist = { data: wl.data.whitelist, atMs: this.now() };
    }
    this.scheduleEmit();
  }

  private async pollLogs(rt: BotRuntime): Promise<void> {
    const r = await this.fetchJson<{ logs?: unknown }>(rt, '/logs', { limit: 200 });
    if (r.ok) {
      const lines = mapLogs(r.data.logs);
      rt.logs = { data: lines, atMs: this.now() };
      this.publishLogs(rt, lines);
    }
    this.scheduleEmit();
  }

  private async pollDigest(anchor: BotRuntime): Promise<void> {
    const r = await this.fetchJson<FleetSnapshotResponse>(anchor, '/fleet/snapshot');
    if (!r.ok) {
      if (r.status === 404) this.digestAvailable = false;
      return;
    }
    if (r.data.error || !r.data.bots) {
      this.digestAvailable = false;
      return;
    }
    const now = this.now();
    for (const digest of Object.values(r.data.bots)) {
      const rt = this.matchDigest(digest.api_port, digest.bot_name);
      if (rt) rt.digest = { data: digest, atMs: now };
    }
    this.scheduleEmit();
  }

  private async pollOverview(anchor: BotRuntime): Promise<void> {
    const r = await this.fetchJson<FleetviewOverviewResponse>(anchor, '/fleetview/overview');
    if (!r.ok) {
      if (r.status === 404) this.overviewAvailable = false;
      return;
    }
    const now = this.now();
    for (const b of r.data.bots ?? []) {
      const rt = this.matchDigest(b.port ?? undefined, b.bot_name);
      if (rt) rt.overview = { data: b, atMs: now };
    }
    this.scheduleEmit();
  }

  private async pollFleetStatus(anchor: BotRuntime): Promise<void> {
    const r = await this.fetchJson<FleetStatusResponse>(anchor, '/fleet/status');
    if (!r.ok) {
      if (r.status === 404) this.fleetStatusAvailable = false;
      return;
    }
    if (r.data.error) return;
    this.fleetStatus = { data: r.data, atMs: this.now() };
    this.scheduleEmit();
  }

  /**
   * Join a fleet entry to a bot: by API port first (known before the bot answered), then by a
   * `bot_name` the bot itself reported. Never by a fallback name (it would attach one bot's money
   * to another).
   */
  private matchDigest(port: number | undefined, botName: string): BotRuntime | undefined {
    const all = [...this.rts.values()];
    if (port) {
      const byPort = all.filter((rt) => rt.port === port);
      if (byPort.length === 1) return byPort[0];
    }
    const byName = all.filter((rt) => rt.config?.data.bot_name === botName);
    return byName.length === 1 ? byName[0] : undefined;
  }

  // ---------------------------------------------------------------- emission

  private scheduleEmit(): void {
    if (this.emitTimer !== null || !this.running) return;
    this.emitTimer = this.setT(() => {
      this.emitTimer = null;
      this.emit();
    }, EMIT_DEBOUNCE_MS);
  }

  private pushEvent(e: Event): void {
    const key = eventKey(e);
    if (this.seenAlertTransitions.has(key)) return;
    this.seenAlertTransitions.add(key);
    if (this.seenAlertTransitions.size > 4 * EVENT_RING) this.seenAlertTransitions.clear();
    this.events.unshift(e);
    if (this.events.length > EVENT_RING) this.events.length = EVENT_RING;
    this.seqEvents += 1;
    for (const s of this.eventSinks) s({ kind: 'item', seq: this.seqEvents, item: e });
  }

  private positionsOf(rt: BotRuntime, nowMs: number): Position[] {
    if (!rt.status) return [];
    const cadence = this.cadencesFor(rt).statusMs;
    return rt.status.data.map((t) =>
      mapOpenTrade(t, {
        botKey: rt.key,
        nowMs,
        asOfMs: rt.status?.atMs ?? nowMs,
        cadenceMs: Number.isFinite(cadence) ? cadence : DEFAULT_CADENCES.statusMs,
      }),
    );
  }

  private alertContext(rt: BotRuntime, nowMs: number, positions: Position[]): BotAlertContext {
    const cadence = this.cadencesFor(rt).statusMs;
    const eff = Number.isFinite(cadence) ? cadence : DEFAULT_CADENCES.statusMs;
    const statusAge = rt.status ? nowMs - rt.status.atMs : Number.POSITIVE_INFINITY;
    const closed = rt.closed;
    const closedDurations = closed
      ? closed.rows
          .filter((r) => r.close_ms !== null)
          .map((r) => durationMs(r.open_ms, r.close_ms, nowMs))
      : [];
    const wallet = inferWallets([...this.rts.values()]).get(rt.key);
    const capital = startingCapitalOf(rt, wallet?.shared ?? false);
    const posCtx: PositionCtx[] = positions.map((p) => ({
      trade_id: p.trade_id,
      pair: p.pair,
      side: p.side,
      open_ms: p.open_ms,
      open_rate: p.open_rate,
      current_rate: p.current_rate,
      profit_ratio: p.profit_ratio,
      liquidation_price: p.liquidation_price,
      stoploss_abs: p.stoploss_abs,
      stake_amount: p.stake_amount,
    }));
    const dd =
      closed && closed.complete && rt.status
        ? computeDrawdown({
            closed: closed.rows
              .filter((r) => r.close_ms !== null && r.profit_abs !== null)
              .map((r) => ({ ts_ms: r.close_ms as number, profit_abs: r.profit_abs as number })),
            open: rt.status.data.map(toOpenRisk),
            histories: [],
            starting_capital: capital,
            now_ms: nowMs,
          })
        : null;
    return {
      now_ms: nowMs,
      status: statusOf(rt),
      is_futures: (rt.config?.data.trading_mode ?? rt.digest?.data.trading_mode) === 'futures',
      max_open_trades: rt.config?.data.max_open_trades ?? rt.digest?.data.max_open_trades ?? null,
      starting_capital: capital,
      positions: posCtx,
      positions_stale: statusAge > 3 * eff,
      // Median of the loaded closed trades; before the history is loaded, the bot's own mean
      // duration (`/profit` avg_duration) stands in so the "stuck position" alert still has a scale.
      median_closed_duration_ms:
        closed && closedDurations.length >= MIN_SAMPLES
          ? medianDurationMs(closedDurations)
          : parseAvgDurationMs(rt.profit?.data.avg_duration ?? ''),
      last_trade_ts_raw: rt.profit?.data.latest_trade_timestamp ?? null,
      drawdown_current_abs: dd ? dd.realized.current_abs : null,
      logs: rt.logs ? rt.logs.data : null,
      rate_limit_events: 0,
    };
  }

  private rowContext(
    rt: BotRuntime,
    nowMs: number,
    wallet: { walletId: string; shared: boolean } | undefined,
  ) {
    const c = this.cadencesFor(rt);
    return {
      nowMs,
      walletId: wallet?.walletId ?? null,
      walletShared: wallet?.shared ?? false,
      alerts: this.book.summary(rt.key, nowMs),
      cadences: DEFAULT_CADENCES,
      statusCadenceMs: Number.isFinite(c.statusMs) ? c.statusMs : DEFAULT_CADENCES.statusMs,
      slowCadenceMs: Number.isFinite(c.slowMs) ? c.slowMs : DEFAULT_CADENCES.slowMs,
    };
  }

  private evaluateAlerts(nowMs: number, positionsByBot: Map<BotKey, Position[]>): void {
    const cfg = this.deps.getAlertRules?.() ?? defaultAlertRulesConfig();
    for (const rt of this.rts.values()) {
      // A bot that never answered has nothing to evaluate yet.
      if (rt.reach === 'unknown') continue;
      const ctx = this.alertContext(rt, nowMs, positionsByBot.get(rt.key) ?? []);
      const ev = evaluateBot(effectiveRulesFor(cfg, rt.key), ctx);
      for (const tr of this.book.evaluateBot(nowMs, rt.key, ev)) {
        if (tr.kind === 'raised' || tr.kind === 'resolved' || tr.kind === 'escalated') {
          this.pushEvent({
            kind: tr.kind === 'resolved' ? 'alert_resolved' : 'alert_raised',
            ts_ms: nowMs,
            bot_key: rt.key,
            trade_id: null,
            pair: null,
            profit_abs: null,
            severity: tr.alert.severity,
            detail: tr.alert.type_id,
          });
        }
      }
    }
    this.book.prune(nowMs);
    this.lastEvalMs = nowMs;
  }

  private detectEvents(nowMs: number, positionsByBot: Map<BotKey, Position[]>): void {
    for (const rt of this.rts.values()) {
      // Reachability transitions.
      const prev = this.lastReach.get(rt.key);
      if (prev && prev !== rt.reach && !this.firstEmit) {
        if (rt.reach === 'offline') {
          this.pushEvent(this.botEvent('bot_offline', rt, nowMs));
        } else if (rt.reach === 'online' && prev === 'offline') {
          this.pushEvent(this.botEvent('bot_online', rt, nowMs));
        }
      }
      this.lastReach.set(rt.key, rt.reach);
      // Positions that appeared or vanished since the last answer. The first answer of a bot is a
      // baseline, not a series of entries.
      if (!rt.status) continue;
      const cur = new Map((positionsByBot.get(rt.key) ?? []).map((p) => [p.trade_id, p]));
      const before = this.lastPositionKeys.get(rt.key);
      if (before) {
        for (const [id, p] of cur) {
          if (!before.has(id)) this.pushEvent(this.fillEvent('entry_fill', rt, p, nowMs));
        }
        for (const [id, p] of before) {
          if (!cur.has(id)) this.pushEvent(this.fillEvent('exit_fill', rt, p, nowMs));
        }
      }
      this.lastPositionKeys.set(rt.key, cur);
    }
  }

  private botEvent(kind: Event['kind'], rt: BotRuntime, nowMs: number): Event {
    return {
      kind,
      ts_ms: nowMs,
      bot_key: rt.key,
      trade_id: null,
      pair: null,
      profit_abs: null,
      severity: kind === 'bot_offline' ? 'critical' : 'info',
      detail: nameOf(rt),
    };
  }

  /**
   * Direct mode does not see the fill itself, only that a position appeared or vanished: the
   * realized profit is unknown here (null), never taken from the last latent figure.
   */
  private fillEvent(
    kind: 'entry_fill' | 'exit_fill',
    rt: BotRuntime,
    p: Position,
    nowMs: number,
  ): Event {
    return {
      kind,
      ts_ms: nowMs,
      bot_key: rt.key,
      trade_id: p.trade_id,
      pair: p.pair,
      profit_abs: null,
      severity: null,
      detail: 'seen_by_polling',
    };
  }

  private buildHealth(nowMs: number, rows: BotRow[]): Health {
    const reasons: HealthReason[] = [];
    const liveRows = rows.filter((r) => r.identity.mode === 'live');
    const offline = liveRows.filter((r) => r.state.status === 'offline');
    if (offline.length > 0) {
      reasons.push({
        code: 'bots_offline',
        severity: 'critical',
        detail: offline.map((r) => r.identity.name).join(', '),
        alert_id: null,
      });
    }
    const expired = rows.filter((r) => r.state.status === 'auth_expired');
    if (expired.length > 0) {
      reasons.push({
        code: 'auth_expired',
        severity: 'warning',
        detail: expired.map((r) => r.identity.name).join(', '),
        alert_id: null,
      });
    }
    const stale = rows.filter(
      (r) =>
        r.state.status === 'online' && (r.freshness.metrics?.stale || r.freshness.positions?.stale),
    );
    if (stale.length > 0) {
      reasons.push({
        code: 'data_stale',
        severity: 'warning',
        detail: stale.map((r) => r.identity.name).join(', '),
        alert_id: null,
      });
    }
    const fs = this.fleetStatus?.data;
    let budget: number | null = null;
    let backoff = false;
    if (fs) {
      for (const lim of Object.values(fs.rate_limiters ?? {})) {
        if (lim.tokens_max > 0) {
          budget = Math.max(budget ?? 0, 100 * (1 - lim.tokens_available / lim.tokens_max));
        }
        backoff = backoff || lim.backoff_active;
      }
      if (backoff) {
        reasons.push({ code: 'rate_backoff', severity: 'warning', detail: null, alert_id: null });
      }
    }
    const ages = [...this.rts.values()]
      .map((rt) => rt.digest?.data.age_s)
      .filter((x): x is number => typeof x === 'number');
    const level = reasons.some((r) => r.severity === 'critical')
      ? 'critical'
      : reasons.length > 0
        ? 'degraded'
        : 'ok';
    return {
      level,
      reasons,
      rate_budget_pct: budget,
      backoff_active: backoff,
      hit_rate: null,
      bots_process: Array.isArray(fs?.bots)
        ? fs.bots.filter((b) => b.state === 'running').length
        : null,
      digest_age_s: ages.length > 0 ? Math.max(...ages) : null,
      freshness: computeFreshness('rest', this.fleetStatus?.atMs ?? nowMs, nowMs, FLEET_STATUS_MS),
    };
  }

  /** Recompute every entity from the raw answers and publish the difference. */
  private emit(): void {
    const nowMs = this.now();
    const all = [...this.rts.values()];
    const wallets = inferWallets(all);

    const positionsByBot = new Map<BotKey, Position[]>();
    for (const rt of all) positionsByBot.set(rt.key, this.positionsOf(rt, nowMs));

    this.detectEvents(nowMs, positionsByBot);
    this.evaluateAlerts(nowMs, positionsByBot);

    const rows: BotRow[] = all.map((rt) =>
      buildBotRow(rt, this.rowContext(rt, nowMs, wallets.get(rt.key))),
    );
    this.hubs.fleet.set('bots', Object.fromEntries(rows.map((r) => [r.bot_key, r])));
    this.hubs.fleet.set('wallets', this.buildWallets(all, rows, wallets, positionsByBot, nowMs));

    const posMap: Record<string, Position> = {};
    for (const [key, list] of positionsByBot) {
      // Positions of a bot whose mode is not read yet would land in the Live table
      if (!modeKnown(this.rts.get(key)!)) continue;
      for (const p of list) posMap[`${key}/${p.trade_id}`] = p;
    }
    this.hubs.positions.set('positions', posMap);

    const alerts: Record<string, Alert> = {};
    for (const a of this.book.alerts(nowMs)) alerts[a.id] = a;
    this.hubs.alerts.set('alerts', alerts);

    this.hubs.health.set('health', { fleet: this.buildHealth(nowMs, rows) });

    this.firstEmit = false;
    this.updateStatus(all);
  }

  private buildWallets(
    all: BotRuntime[],
    rows: BotRow[],
    wallets: Map<BotKey, { walletId: string; shared: boolean }>,
    positionsByBot: Map<BotKey, Position[]>,
    nowMs: number,
  ): Record<string, WalletRow> {
    const byWallet = new Map<string, BotRuntime[]>();
    for (const rt of all) {
      const w = wallets.get(rt.key);
      if (!w) continue;
      const list = byWallet.get(w.walletId) ?? [];
      list.push(rt);
      byWallet.set(w.walletId, list);
    }
    const out: Record<string, WalletRow> = {};
    for (const [walletId, bots] of byWallet) {
      const reports: WalletReport[] = bots.flatMap((rt) => {
        const total = rt.balance?.data.total ?? rt.digest?.data.balance_total ?? null;
        const at = rt.balance?.atMs ?? rt.digest?.atMs ?? 0;
        const row = rows.find((r) => r.bot_key === rt.key);
        return total === null
          ? []
          : [
              {
                wallet_id: walletId,
                total,
                as_of_ms: at,
                stale: !!row?.freshness.capital?.stale || nowMs - at > 3 * DEFAULT_CADENCES.slowMs,
              },
            ];
      });
      const totals = walletTotals(reports);
      const ex = exposure(
        bots.flatMap((rt) =>
          (positionsByBot.get(rt.key) ?? []).map((p) => ({
            coin: p.coin,
            side: p.side,
            notional: p.notional,
          })),
        ),
      );
      const best = reports.length > 0 ? Math.max(...reports.map((r) => r.as_of_ms)) : nowMs;
      out[walletId] = {
        wallet_id: walletId,
        // The address never reaches the browser in direct mode.
        address_short: '',
        bots: bots.map((b) => b.key),
        equity: totals.wallets > 0 ? totals.total : null,
        net_exposure: ex.net_by_coin,
        recon: null,
        freshness: computeFreshness('rest', best, nowMs, DEFAULT_CADENCES.slowMs),
      };
    }
    return out;
  }

  private updateStatus(all: BotRuntime[]): void {
    const contacts = all.map((rt) => rt.lastContactMs).filter((x): x is number => x !== null);
    const reachable = all.filter((rt) => rt.reach === 'online' || rt.reach === 'starting');
    let state: SourceStatus['state'] = 'live';
    let reason: string | null = null;
    if (all.length === 0) {
      state = 'offline';
      reason = 'no_bots';
    } else if (contacts.length === 0 && all.every((rt) => rt.reach === 'unknown')) {
      state = 'connecting';
    } else if (reachable.length === 0) {
      state = 'offline';
      reason = 'all_bots_unreachable';
    } else if (reachable.length < all.length) {
      reason = 'some_bots_unreachable';
    }
    this.status.value = {
      state,
      lastSyncMs: contacts.length > 0 ? Math.max(...contacts) : 0,
      clockSkewMs: 0,
      latencyMs: null,
      resyncing: false,
      reason,
    };
  }

  // ---------------------------------------------------------------- subscribe

  subscribe<C extends Channel>(
    ch: C,
    params: ChannelParams[C],
    sink: (u: ChannelUpdate[C]) => void,
  ): () => void {
    const emitSink = sink as (u: unknown) => void;
    switch (ch) {
      case 'fleet':
      case 'positions':
      case 'alerts':
      case 'health': {
        const unsub =
          this.hubs[ch as 'fleet' | 'positions' | 'alerts' | 'health'].subscribe(emitSink);
        // Make sure there is something to show soon after the first subscriber.
        this.scheduleEmit();
        return unsub;
      }
      case 'events': {
        const s = sink as (u: ChannelUpdate['events']) => void;
        this.eventSinks.add(s);
        // Oldest first, so the store ends up newest first like the live feed.
        [...this.events].reverse().forEach((e, i) => s({ kind: 'item', seq: i + 1, item: e }));
        return () => this.eventSinks.delete(s);
      }
      case 'bot': {
        const key = (params as ChannelParams['bot']).botKey;
        this.focus.set(key, (this.focus.get(key) ?? 0) + 1);
        const rt = this.rts.get(key);
        if (rt) {
          this.due(rt, 'status');
          this.due(rt, 'slow');
          this.due(rt, 'logs');
        }
        return () => {
          const n = (this.focus.get(key) ?? 1) - 1;
          if (n <= 0) this.focus.delete(key);
          else this.focus.set(key, n);
        };
      }
      case 'logs': {
        const key = (params as ChannelParams['logs']).botKey ?? '*';
        const s = sink as (u: ChannelUpdate['logs']) => void;
        const set = this.logSinks.get(key) ?? new Set();
        set.add(s);
        this.logSinks.set(key, set);
        const cur =
          key === '*'
            ? [...this.rts.values()].flatMap((rt) => rt.logs?.data ?? [])
            : (this.rts.get(key)?.logs?.data ?? []);
        const lines = key === '*' ? cur.filter((l) => /^(ERROR|CRITICAL)$/i.test(l.level)) : cur;
        s({ kind: 'reset' });
        lines.forEach((l, i) => s({ kind: 'item', seq: i + 1, item: l }));
        return () => set.delete(s);
      }
      default: {
        // recon and chart relays need the gateway.
        emitSink({ kind: 'unavailable', reason: 'direct_mode' });
        return () => undefined;
      }
    }
  }

  private publishLogs(rt: BotRuntime, lines: LogLine[]): void {
    const push = (key: BotKey | '*', list: LogLine[]) => {
      const sinks = this.logSinks.get(key);
      if (!sinks || sinks.size === 0) return;
      for (const s of sinks) {
        s({ kind: 'reset' });
        list.forEach((l, i) => s({ kind: 'item', seq: i + 1, item: l }));
      }
    };
    push(rt.key, lines);
    const sinks = this.logSinks.get('*');
    if (sinks && sinks.size > 0) {
      const errors = [...this.rts.values()]
        .flatMap((r) => r.logs?.data ?? [])
        .filter((l) => /^(ERROR|CRITICAL)$/i.test(l.level))
        .sort((a, b) => a.ts_ms - b.ts_ms);
      push('*', errors);
    }
  }

  // ---------------------------------------------------------------- queries

  /** Bots of a scope, in display order. */
  private scopeBots(s: ScopeRef): BotRuntime[] {
    const all = [...this.rts.values()].sort((a, b) => a.sortId - b.sortId);
    switch (s.kind) {
      case 'fleet':
        return all;
      case 'bot':
        return all.filter((rt) => rt.key === s.botKey);
      case 'group': {
        const g = this.deps.getGroups?.().find((x) => x.id === s.id);
        return g ? all.filter((rt) => g.botKeys.includes(rt.key)) : [];
      }
    }
  }

  /** Make sure the closed trades of a bot are loaded (capped, cached 10 minutes). */
  private async ensureClosed(rt: BotRuntime): Promise<ClosedHistory | null> {
    const now = this.now();
    if (rt.closed && now - rt.closed.atMs < CLOSED_TTL_MS && !closedHistoryOutdated(rt)) {
      return rt.closed;
    }
    const mode = modeOf(rt);
    const countAtLoad = closedCountOf(rt);
    const rows: TradeRow[] = [];
    let total: number | null = null;
    let offset = 0;
    while (rows.length < CLOSED_CAP_PER_BOT) {
      const r = await this.fetchJson<TradeResponse>(rt, '/trades', {
        limit: CLOSED_PAGE,
        offset,
        order_by_id: true,
      });
      if (!r.ok) {
        if (rows.length === 0) return rt.closed;
        break;
      }
      const trades = r.data.trades ?? [];
      total = r.data.total_trades ?? total;
      for (const t of trades as ClosedTrade[]) {
        if (!t.is_open && t.close_date) rows.push(mapClosedTrade(t, rt.key, mode));
      }
      offset += trades.length;
      if (trades.length < CLOSED_PAGE || (total !== null && offset >= total)) break;
    }
    rt.closed = {
      rows,
      total,
      complete: total !== null && rows.length >= total - this.openCountOf(rt, total),
      atMs: this.now(),
      countAtLoad,
    };
    this.scheduleEmit();
    return rt.closed;
  }

  /** `/trades` also counts open trades in `total_trades`. */
  private openCountOf(rt: BotRuntime, _total: number): number {
    return rt.status ? rt.status.data.length : 0;
  }

  private async loadClosedFor(bots: BotRuntime[]): Promise<void> {
    // One bot at a time keeps the load on the fleet low; the result is cached.
    for (const rt of bots) {
      await this.ensureClosed(rt);
    }
  }

  /**
   * Sampled `closed + open` profit of each bot, from one request to the fork's
   * `/fleetview/profit_history` (read only). All bots must be covered: merging a subset would
   * silently under-count, so a missing bot means no history at all (null). Cached for a minute,
   * including a failure, so a bot without the endpoint is not asked again at every call.
   */
  private async loadHistories(bots: BotRuntime[]): Promise<HistorySample[][] | null> {
    if (bots.length === 0) return null;
    const nowMs = this.now();
    if (!this.historyCache || nowMs - this.historyCache.atMs > HISTORY_TTL_MS) {
      const carrier = [...this.rts.values()].find((rt) => rt.status || rt.digest);
      const byName = new Map<string, HistorySample[]>();
      if (carrier) {
        try {
          const res = await this.client.get<FleetProfitHistoryResponse>(
            carrier.id,
            '/fleetview/profit_history',
            { timeoutMs: 15_000 },
          );
          if (res.status === 200 && Array.isArray(res.data?.bots)) {
            for (const b of res.data.bots) {
              if (b.data.length === 0) continue;
              byName.set(
                b.bot_name,
                b.data.map(([ts, closed, open]) => ({
                  ts_ms: normalizeTsMs(ts) ?? ts,
                  closed,
                  open,
                })),
              );
            }
          }
        } catch {
          // Unreachable or refused: no history, the projected curve stays.
        }
      }
      this.historyCache = { atMs: nowMs, byName };
    }
    const out: HistorySample[][] = [];
    for (const rt of bots) {
      const series = this.historyCache.byName.get(nameOf(rt));
      if (!series) return null;
      out.push(series);
    }
    return out;
  }

  private filterMode(bots: BotRuntime[], modes?: BotMode[]): BotRuntime[] {
    const want = modes ?? ['live'];
    // A bot whose mode is not read yet is in no total: live and dry are never added together
    return bots.filter((rt) => modeKnown(rt) && want.includes(modeOf(rt)));
  }

  readonly query = {
    tradeOrders: async (botKey: BotKey, tradeId: number): Promise<OrderRow[] | null> => {
      // The bot's own REST answer: `GET /trades/{id}` carries the orders of the trade
      try {
        const t = await this.proxy<{ orders?: RestOrder[] }>(botKey, 'GET', `/trades/${tradeId}`);
        return (t.orders ?? []).map((o, i) => ({
          id: i,
          side: o.ft_order_side ?? '',
          is_entry: o.ft_is_entry ?? null,
          status: o.status ?? null,
          is_open: o.is_open ?? false,
          filled: o.filled ?? null,
          amount: o.amount ?? null,
          average: o.safe_price ?? o.price ?? null,
          cost: o.cost ?? null,
          filled_ms: o.order_filled_timestamp ? normalizeTsMs(o.order_filled_timestamp) : null,
          tag: o.ft_order_tag ?? null,
        }));
      } catch {
        return null;
      }
    },
    trades: async (q: TradeQuery): Promise<TradePage> => {
      let bots = [...this.rts.values()].sort((a, b) => a.sortId - b.sortId);
      if (q.bots) bots = bots.filter((rt) => q.bots?.includes(rt.key));
      bots = this.filterMode(bots, q.mode ?? ['live', 'dry']);
      let rows: TradeRow[];
      let complete = true;
      if (q.status === 'open') {
        const nowMs = this.now();
        rows = bots.flatMap((rt) =>
          this.positionsOf(rt, nowMs).map((p) => positionToTradeRow(p, modeOf(rt))),
        );
      } else {
        await this.loadClosedFor(bots);
        rows = bots.flatMap((rt) => rt.closed?.rows ?? []);
        complete = bots.every((rt) => rt.closed?.complete === true);
      }
      return pageTradeRows(rows, q, complete);
    },

    periods: async (q: PeriodQuery): Promise<PeriodRow[]> => {
      const bots = this.filterMode(
        this.scopeBots(q.scope),
        q.tradingMode ? [q.tradingMode] : undefined,
      );
      await this.loadClosedFor(bots);
      const trades: ClosedPnl[] = bots.flatMap((rt) =>
        (rt.closed?.rows ?? [])
          .filter((r) => r.close_ms !== null && r.profit_abs !== null)
          .map((r) => ({ ts_ms: r.close_ms as number, profit_abs: r.profit_abs as number })),
      );
      return pnlPeriods(trades, q.unit, q.tz, this.now(), q.n);
    },

    equity: async (q: EquityQuery): Promise<EquitySeries> => {
      const bots = this.filterMode(
        this.scopeBots(q.scope),
        q.tradingMode ? [q.tradingMode] : undefined,
      );
      if (q.mode === 'with_open') {
        // Needs the sampled ledgers of the fork (`/fleetview/profit_history`); without them there is
        // no honest curve of the latent profit, so none is drawn.
        const histories = await this.loadHistories(bots);
        if (!histories) {
          return { mode: q.mode, points: [], unavailable: 'no_history', asOfMs: this.now() };
        }
        const merged = mergeHistories(histories).filter(
          (p) => q.fromMs === undefined || p[0] >= q.fromMs,
        );
        return {
          mode: q.mode,
          points: thin(merged, q.points),
          unavailable: null,
          asOfMs: this.now(),
        };
      }
      await this.loadClosedFor(bots);
      const closed = bots
        .flatMap((rt) => rt.closed?.rows ?? [])
        .filter((r) => r.close_ms !== null && r.profit_abs !== null)
        .sort((a, b) => (a.close_ms as number) - (b.close_ms as number));
      let cum = 0;
      let points: Array<[number, number]> = closed
        .filter((r) => q.fromMs === undefined || (r.close_ms as number) >= q.fromMs)
        .map((r) => {
          cum += r.profit_abs as number;
          return [r.close_ms as number, cum] as [number, number];
        });
      points = thin(points, q.points);
      const complete = bots.every((rt) => rt.closed?.complete === true);
      return {
        mode: q.mode,
        points,
        unavailable: complete ? null : 'partial_history',
        asOfMs: this.now(),
      };
    },

    drawdown: async (q: DrawdownQuery): Promise<DrawdownResult | null> => {
      const bots = this.filterMode(
        this.scopeBots(q.scope),
        q.tradingMode ? [q.tradingMode] : undefined,
      );
      await this.loadClosedFor(bots);
      if (bots.length === 0 || !bots.every((rt) => rt.closed?.complete === true)) return null;
      const nowMs = this.now();
      const capitals = bots.map(
        (rt) => buildBotRow(rt, this.rowContext(rt, nowMs, undefined)).metrics.starting_capital,
      );
      const cap = sumStartingCapital(capitals);
      return computeDrawdown({
        closed: bots.flatMap((rt) =>
          (rt.closed?.rows ?? [])
            .filter((r) => r.close_ms !== null && r.profit_abs !== null)
            .map((r) => ({ ts_ms: r.close_ms as number, profit_abs: r.profit_abs as number })),
        ),
        open: bots.flatMap((rt) => (rt.status?.data ?? []).map(toOpenRisk)),
        // The sampled curve when every bot has one, the projected curve otherwise.
        histories: (await this.loadHistories(bots)) ?? [],
        starting_capital: cap.unknown === 0 && cap.known > 0 ? cap.total : null,
        now_ms: nowMs,
      });
    },

    logs: async (q: LogQuery): Promise<Page<LogLine>> => {
      const bots = q.botKey
        ? [this.rts.get(q.botKey)].filter((x): x is BotRuntime => !!x)
        : [...this.rts.values()];
      if (q.botKey && bots[0]) await this.pollLogs(bots[0]);
      let lines = bots.flatMap((rt) => rt.logs?.data ?? []);
      if (q.level) {
        const lv = q.level.toUpperCase();
        lines = lines.filter((l) => l.level.toUpperCase() === lv);
      } else if (!q.botKey) {
        lines = lines.filter((l) => /^(ERROR|CRITICAL)$/i.test(l.level));
      }
      if (q.q) {
        const needle = q.q.toLowerCase();
        lines = lines.filter((l) => l.message.toLowerCase().includes(needle));
      }
      lines.sort((a, b) => b.ts_ms - a.ts_ms);
      return { items: lines.slice(0, q.limit ?? 200), nextCursor: null, complete: false };
    },

    events: async (q: EventQuery): Promise<Page<Event>> => {
      let list = [...this.events];
      if (q.sinceMs !== undefined) list = list.filter((e) => e.ts_ms >= (q.sinceMs as number));
      if (q.kinds) list = list.filter((e) => q.kinds?.includes(e.kind));
      if (q.botKey) list = list.filter((e) => e.bot_key === q.botKey);
      // Only what this tab has seen: never presented as the whole history.
      return { items: list.slice(0, q.limit ?? 100), nextCursor: null, complete: false };
    },

    scope: async (s: ScopeRef): Promise<ScopeDetail> => {
      const nowMs = this.now();
      const bots = this.scopeBots(s);
      const wallets = inferWallets([...this.rts.values()]);
      const rows = bots.map((rt) =>
        buildBotRow(rt, this.rowContext(rt, nowMs, wallets.get(rt.key))),
      );
      // A bot whose mode is not read yet is in the rows (starting, money figures empty, so named
      // among the excluded of the totals) but its positions are in no exposure
      const positions = bots.filter(modeKnown).flatMap((rt) => this.positionsOf(rt, nowMs));
      const totals = scopeTotalsByMode(rows, positions, (k) => wallets.get(k)?.walletId ?? '');
      return { scope: s, bots: rows, positions, totals, drawdown: null, asOfMs: nowMs };
    },
  };

  // ---------------------------------------------------------------- alerts

  readonly alerts: AlertsApi = {
    shared: false,
    rules: async () => this.deps.getAlertRules?.() ?? defaultAlertRulesConfig(),
    setRules: async (cfg) => {
      this.deps.setAlertRules?.(cfg);
      this.scheduleEmit();
    },
    ack: async (alertId) => {
      this.book.ack(alertId, 'local', this.now());
      this.emit();
    },
    silence: async (spec) => {
      const now = this.now();
      const id = this.book.silence(
        spec.typeId ?? null,
        spec.botKey ?? null,
        spec.subject ?? null,
        spec.untilMs,
        now,
      );
      this.emit();
      const s = this.book.getSilences().find((x) => x.id === id) as Silence;
      return { ...s };
    },
    unsilence: async (id) => {
      this.book.unsilence(id);
      this.emit();
    },
    silences: async () => [...this.book.getSilences()],
    list: () => this.book.alerts(this.now()),
  };

  // ---------------------------------------------------------------- proxy

  async proxy<T>(
    botKey: BotKey,
    method: string,
    path: string,
    body?: unknown,
    opts?: ProxyOptions,
  ): Promise<T> {
    const rt = this.rts.get(botKey);
    if (!rt) throw new Error(`unknown bot ${botKey}`);
    const m = method.toUpperCase();
    const clean = path.startsWith('/') ? path : `/${path}`;
    if (m === 'GET') {
      const res = await this.client.get<T>(rt.id, clean, { timeoutMs: opts?.timeoutMs });
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
      return res.data;
    }
    if (m !== 'POST' && m !== 'PUT' && m !== 'DELETE')
      throw new Error(`method ${method} not allowed`);
    const res = await this.client.write<T>(rt.id, m, clean, { body, timeoutMs: opts?.timeoutMs });
    if (!res.sent) throw new Error('HTTP 401');
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    return res.data;
  }

  // ---------------------------------------------------------------- actions

  async act(botKey: BotKey, action: BotAction, idempotencyKey: string): Promise<ActionResult> {
    const t0 = this.now();
    const refuse = (
      status: ActionResult['status'],
      error: ActionResult['error'],
      botResponse: string | null = null,
      httpStatus: number | null = null,
    ): ActionResult => ({
      status,
      error,
      botResponse,
      httpStatus,
      verify: null,
      latencyMs: this.now() - t0,
    });

    // A key already seen: the first outcome, or "in progress" while it is still running.
    const seen = this.actions.get(idempotencyKey);
    if (seen) {
      return seen.result ?? refuse('in_progress', 'in_progress');
    }

    const rt = this.rts.get(botKey);
    if (!rt) return refuse('rejected', 'not_found', 'unknown bot');
    if (rt.reach === 'offline' || rt.reach === 'auth_expired') {
      // Nothing is sent to a bot we cannot reach; never "restart it to close".
      return refuse(
        rt.reach === 'auth_expired' ? 'unauthorized' : 'rejected',
        rt.reach === 'auth_expired' ? 'unauthorized' : 'bot_unreachable',
      );
    }

    const lockKey = `${botKey}:${action.kind}:${'tradeId' in action ? action.tradeId : '-'}`;
    if (this.lockedKeys.has(lockKey)) return refuse('in_progress', 'in_progress');

    // The typed name of the bot is verified here too: a destructive action carries it.
    const destructive =
      (action.kind === 'forceexit' && action.tradeId === 'all') ||
      action.kind === 'stop' ||
      action.kind === 'delete_trade';
    if (destructive && modeOf(rt) === 'live') {
      const typed = 'confirm' in action ? action.confirm : undefined;
      if (typed !== nameOf(rt))
        return refuse('rejected', 'bad_request', 'confirmation name mismatch');
    }

    this.lockedKeys.add(lockKey);
    const entry: StoredAction = { result: null, lockKey };
    this.actions.set(idempotencyKey, entry);
    try {
      const result = await this.execute(rt, action, t0);
      entry.result = result;
      this.pushEvent({
        kind: 'action',
        ts_ms: this.now(),
        bot_key: botKey,
        trade_id: 'tradeId' in action && typeof action.tradeId === 'number' ? action.tradeId : null,
        pair: null,
        profit_abs: null,
        severity: null,
        detail: `${action.kind}:${result.status}`,
      });
      return result;
    } catch (e) {
      const failed = refuse('unknown', null, describe((e as Error).message));
      entry.result = failed;
      return failed;
    } finally {
      this.lockedKeys.delete(lockKey);
    }
  }

  /** Check the target against a fresh `/status` before an exit; null when it matches. */
  private async guardExit(
    rt: BotRuntime,
    tradeId: number,
    expected: { pair: string; isShort: boolean },
  ): Promise<'ok' | 'mismatch' | 'unverifiable'> {
    const fresh = rt.status && this.now() - rt.status.atMs <= GUARD_MAX_AGE_MS;
    if (!fresh) {
      const r = await this.fetchJson<Trade[]>(rt, '/status');
      if (!r.ok || !Array.isArray(r.data)) return 'unverifiable';
      rt.status = { data: r.data, atMs: this.now() };
      this.scheduleEmit();
    }
    const t = rt.status?.data.find((x) => x.trade_id === tradeId);
    if (!t || !t.is_open) return 'mismatch';
    return t.pair === expected.pair && (t.is_short === true) === expected.isShort
      ? 'ok'
      : 'mismatch';
  }

  private async execute(rt: BotRuntime, action: BotAction, t0: number): Promise<ActionResult> {
    const base = (
      status: ActionResult['status'],
      extra: Partial<ActionResult> = {},
    ): ActionResult => ({
      status,
      botResponse: null,
      httpStatus: null,
      error: null,
      verify: null,
      latencyMs: this.now() - t0,
      ...extra,
    });

    if (action.kind === 'forceexit' && action.tradeId !== 'all') {
      // An exit without the state the user saw is never sent.
      if (!action.expected)
        return base('rejected', { error: 'bad_request', botResponse: 'expected state missing' });
      const g = await this.guardExit(rt, action.tradeId, action.expected);
      if (g === 'unverifiable')
        return base('rejected', {
          error: 'bot_unreachable',
          botResponse: 'state could not be verified',
        });
      if (g === 'mismatch') return base('state_mismatch', { error: 'state_mismatch' });
    }

    const req = this.toRequest(action);
    if (!req) return base('rejected', { error: 'bad_request', botResponse: 'unsupported action' });

    let res;
    try {
      res = await this.client.write(rt.id, req.method, req.path, {
        body: req.body,
        params: req.params,
      });
    } catch (e) {
      if (e instanceof BotRequestError && e.failure.kind === 'transport') {
        // The request may have reached the bot: neither success nor failure. Read the truth soon.
        this.refetchStatusSoon(rt);
        return base('unknown', {
          botResponse: e.failure.transport,
          verify: { expectedState: req.expected, checkAfterMs: 5_000 },
        });
      }
      throw e;
    }
    if (!res.sent || res.status === 401) {
      // Nothing was executed; no replay, the user retries from the dialog.
      return base('unauthorized', { httpStatus: res.sent ? 401 : null, error: 'unauthorized' });
    }
    const text = describe(res.data);
    if (res.status === 502 && /not in the correct state/i.test(text)) {
      return base('rejected', { httpStatus: 502, error: 'bot_unreachable', botResponse: text });
    }
    if (res.status >= 200 && res.status < 300) {
      this.refetchStatusSoon(rt);
      return base('accepted', {
        httpStatus: res.status,
        botResponse: text,
        verify: { expectedState: req.expected, checkAfterMs: 3_000 },
      });
    }
    return base('rejected', {
      httpStatus: res.status,
      error: res.status >= 500 ? 'internal' : 'bad_request',
      botResponse: text,
    });
  }

  private refetchStatusSoon(rt: BotRuntime): void {
    for (const ms of STALE_REFETCH_AFTER_ACTION_MS) {
      this.setT(() => {
        if (this.running) this.due(rt, 'status');
      }, ms);
    }
  }

  private toRequest(a: BotAction): {
    method: 'POST' | 'DELETE';
    path: string;
    body?: unknown;
    params?: Record<string, unknown>;
    expected: string;
  } | null {
    switch (a.kind) {
      case 'forceexit': {
        const body: Record<string, unknown> = { tradeid: String(a.tradeId) };
        if (a.orderType) body.ordertype = a.orderType;
        if (a.amount !== undefined) body.amount = a.amount;
        if (a.price !== undefined) body.price = a.price;
        return { method: 'POST', path: '/forcesell', body, expected: 'trade_closing' };
      }
      case 'forceentry': {
        const body: Record<string, unknown> = { pair: a.pair };
        if (a.side) body.side = a.side;
        if (a.price !== undefined) body.price = a.price;
        if (a.orderType) body.ordertype = a.orderType;
        if (a.stakeAmount !== undefined) body.stakeamount = a.stakeAmount;
        if (a.entryTag) body.entry_tag = a.entryTag;
        if (a.leverage !== undefined) body.leverage = a.leverage;
        return { method: 'POST', path: '/forcebuy', body, expected: 'trade_opening' };
      }
      case 'start':
        return { method: 'POST', path: '/start', body: {}, expected: 'bot_running' };
      case 'stop':
        return { method: 'POST', path: '/stop', body: {}, expected: 'bot_stopped' };
      case 'stopbuy':
        return { method: 'POST', path: '/stopbuy', body: {}, expected: 'entries_paused' };
      case 'reload_config':
        return { method: 'POST', path: '/reload_config', body: {}, expected: 'bot_reloading' };
      case 'delete_trade':
        return { method: 'DELETE', path: `/trades/${a.tradeId}`, expected: 'trade_deleted' };
      case 'cancel_open_order':
        return {
          method: 'DELETE',
          path: `/trades/${a.tradeId}/open-order`,
          expected: 'order_cancelled',
        };
      case 'reload_trade':
        return { method: 'POST', path: `/trades/${a.tradeId}/reload`, expected: 'trade_reloaded' };
      case 'blacklist_add':
        return {
          method: 'POST',
          path: '/blacklist',
          body: { blacklist: a.pairs },
          expected: 'pairs_blacklisted',
        };
      case 'blacklist_remove':
        return {
          method: 'DELETE',
          path: '/blacklist',
          params: { pairs_to_delete: a.pairs },
          expected: 'pairs_removed',
        };
      case 'lock_delete':
        return { method: 'DELETE', path: `/locks/${a.lockId}`, expected: 'lock_removed' };
    }
  }
}
