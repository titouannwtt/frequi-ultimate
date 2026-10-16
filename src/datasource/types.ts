/**
 * The contract between the pages and their data (docs/redesign/03-gateway-architecture.md,
 * section 9.1). Pages and components only talk to the normalised stores and to this interface; no
 * axios call lives in a component. `GatewaySource` and `DirectSource` implement it.
 */
import type { Ref } from 'vue';

import type {
  Alert,
  AlertRulesConfig,
  AlertTypeId,
  ApiError,
  AuditEntry,
  BotKey,
  BotMode,
  BotRow,
  CapitalSum,
  DrawdownDef,
  DrawdownResult,
  Event,
  Exposure,
  LogLine as GwLogLine,
  PeriodUnit,
  PnlBucket,
  Position,
  Silence,
  Tz,
  TradeRow,
  TradeTotals,
  Upsert,
} from '@/gateway/types.gen';

export type SourceKind = 'gateway' | 'direct';

/** Connection state shown by the pill (02 section 10.3). */
export type ConnectionState = 'connecting' | 'live' | 'degraded' | 'offline';

export interface SourceStatus {
  state: ConnectionState;
  /** Client time of the last applied update or successful poll, 0 before the first one. */
  lastSyncMs: number;
  /** `serverNow - clientNow`, learnt from the heartbeat; 0 in direct mode (the bots have no clock to read). */
  clockSkewMs: number;
  /** Round trip of the last heartbeat or poll, when known. */
  latencyMs: number | null;
  /** A channel snapshot is being reloaded (a small ring in the pill, nothing else). */
  resyncing: boolean;
  /** Why the source is not `live`, for the banner (short machine code). */
  reason: string | null;
}

// ---- channels ----

export interface ChannelParams {
  fleet: undefined;
  positions: undefined;
  alerts: undefined;
  events: undefined;
  health: undefined;
  recon: undefined;
  bot: { botKey: BotKey };
  /** `botKey` null: the errors of all bots, merged. */
  logs: { botKey: BotKey | null };
  chart: { botKey: BotKey; pair: string; timeframe: string };
}

export type Channel = keyof ChannelParams;

/** Collections carried by state channels, keyed by entity key. */
export type CollectionName = 'bots' | 'wallets' | 'positions' | 'alerts' | 'events' | 'health';

/**
 * An update of a state channel. A `snapshot` first replaces the listed collections wholesale, then
 * applies `upsert`/`remove` like a `delta` does.
 */
export interface StateUpdate {
  kind: 'snapshot' | 'delta';
  seq: number;
  /** Server time of the update, ms. */
  ts: number;
  /** Collections replaced wholesale before the upsert is applied (snapshots only). */
  replace: string[];
  upsert: Upsert;
  remove: Record<string, string[]>;
}

export type StreamUpdate<T> = { kind: 'item'; seq: number; item: T } | { kind: 'reset' };

/** The channel cannot be served by this source (for example `recon` in direct mode). */
export interface UnavailableUpdate {
  kind: 'unavailable';
  reason: string;
}

export interface ChannelUpdate {
  fleet: StateUpdate | UnavailableUpdate;
  positions: StateUpdate | UnavailableUpdate;
  alerts: StateUpdate | UnavailableUpdate;
  health: StateUpdate | UnavailableUpdate;
  recon: StateUpdate | UnavailableUpdate;
  events: StreamUpdate<Event> | UnavailableUpdate;
  bot: StateUpdate | UnavailableUpdate;
  logs: StreamUpdate<GwLogLine> | UnavailableUpdate;
  chart: StreamUpdate<unknown> | UnavailableUpdate;
}

// ---- scopes and queries ----

export type ScopeRef =
  | { kind: 'fleet' }
  | { kind: 'group'; id: string }
  | { kind: 'bot'; botKey: BotKey };

export interface Page<T> {
  items: T[];
  /** Opaque cursor of the next page, null on the last one. */
  nextCursor: string | null;
  /**
   * `false` when the figures only cover the history loaded so far (direct mode): the UI says so
   * instead of presenting a partial total as the whole.
   */
  complete: boolean;
}

export interface TradeQuery {
  status: 'open' | 'closed';
  bots?: BotKey[];
  pair?: string;
  side?: 'long' | 'short';
  exitReason?: string;
  mode?: BotMode[];
  fromMs?: number;
  toMs?: number;
  sort?: 'close_ms' | 'open_ms' | 'profit_abs' | 'pair';
  order?: 'asc' | 'desc';
  cursor?: string | null;
  limit?: number;
}

export interface TradePage extends Page<TradeRow> {
  /** Totals of the whole filtered set (gateway) or of the loaded part of it (direct). */
  totals: TradeTotals;
}

/** One order of a trade (entry, DCA, exit), as the gateway reads it from the bot's ledger. */
export interface OrderRow {
  id: number;
  /** `buy`, `sell` or `stoploss`. */
  side: string;
  /** Whether the order opens or adds to the position; null when the trade is unknown. */
  is_entry: boolean | null;
  status: string | null;
  is_open: boolean;
  filled: number | null;
  amount: number | null;
  average: number | null;
  cost: number | null;
  filled_ms: number | null;
  tag: string | null;
}

export interface PeriodQuery {
  unit: PeriodUnit;
  scope: ScopeRef;
  tz: Tz;
  n: number;
  /** Trading mode of the bots counted; live by default, modes are never added together. */
  tradingMode?: BotMode;
}

export type PeriodRow = PnlBucket;

export interface EquityQuery {
  scope: ScopeRef;
  fromMs?: number;
  points?: number;
  /** The named definition of the curve. */
  mode: 'realized' | 'with_open';
  tradingMode?: BotMode;
}

export interface EquitySeries {
  mode: 'realized' | 'with_open';
  /** `[ts_ms, cumulative profit]`, oldest first. */
  points: Array<[number, number]>;
  /** Why the series is missing or partial (direct mode), null when complete. */
  unavailable: string | null;
  asOfMs: number;
}

export interface DrawdownQuery {
  scope: ScopeRef;
  def: DrawdownDef;
  tradingMode?: BotMode;
}

export interface LogQuery {
  botKey?: BotKey;
  level?: string;
  q?: string;
  cursor?: string | null;
  limit?: number;
}

export interface EventQuery {
  sinceMs?: number;
  kinds?: Event['kind'][];
  botKey?: BotKey;
  limit?: number;
}

/**
 * Figures of one trading mode inside a scope. Live, dry and replay are never added together
 * (02 section 12): the scope detail carries one block per mode that has bots.
 */
export interface ScopeTotals {
  mode: BotMode;
  bots: number;
  open_trades: number;
  max_open_trades: number | null;
  realized_1d: number | null;
  realized_7d: number | null;
  realized_30d: number | null;
  realized_total: number | null;
  open_profit_abs: number | null;
  starting_capital: CapitalSum;
  /** Netted at wallet level when wallets are known, gross per bot otherwise (`netted: false`). */
  exposure: Exposure;
  netted: boolean;
  /** Bots left out of the sums because their figures are stale or missing. */
  excluded: BotKey[];
  /** Drawdown of the bots of this mode; undefined when the source gives one for the scope only. */
  drawdown?: DrawdownResult | null;
}

export interface ScopeDetail {
  scope: ScopeRef;
  bots: BotRow[];
  positions: Position[];
  totals: ScopeTotals[];
  drawdown: DrawdownResult | null;
  asOfMs: number;
}

// ---- actions ----

/** Typed mutations (03 section 8.1). Every one names its bot in `act()` and its trade here. */
export type BotAction =
  | {
      kind: 'forceexit';
      /** A trade id, or `all` to exit every position of the bot with a single request. */
      tradeId: number | 'all';
      /** State the user saw: the target is checked again before anything is sent. */
      expected?: { pair: string; isShort: boolean };
      amount?: number;
      orderType?: 'market' | 'limit';
      price?: number;
      /** The bot name typed by the user, for `all`. */
      confirm?: string;
    }
  | {
      kind: 'forceentry';
      pair: string;
      side?: 'long' | 'short';
      stakeAmount?: number;
      price?: number;
      orderType?: 'market' | 'limit';
      leverage?: number;
      entryTag?: string;
    }
  | { kind: 'start' }
  | { kind: 'stop'; confirm?: string }
  | { kind: 'stopbuy' }
  | { kind: 'reload_config' }
  | { kind: 'delete_trade'; tradeId: number; confirm?: string }
  | { kind: 'cancel_open_order'; tradeId: number }
  | { kind: 'reload_trade'; tradeId: number }
  | { kind: 'blacklist_add'; pairs: string[] }
  | { kind: 'blacklist_remove'; pairs: string[] }
  | { kind: 'lock_delete'; lockId: number };

export type BotActionKind = BotAction['kind'];

/**
 * Outcome of the first step of an action (02 section 11.5):
 * - `accepted`: the order was handed to the bot (not "the position is closed");
 * - `rejected`: the bot refused, nothing was executed;
 * - `unknown`: no answer in time, neither success nor failure;
 * - `state_mismatch`: the trade changed since it was displayed, nothing was sent;
 * - `in_progress`: the same action is already in flight (other tab or device);
 * - `unauthorized`: the session expired, nothing was executed, never replayed.
 */
export type ActionStatus =
  | 'accepted'
  | 'rejected'
  | 'unknown'
  | 'state_mismatch'
  | 'in_progress'
  | 'unauthorized';

export interface ActionResult {
  status: ActionStatus;
  /** Truncated answer of the bot (a few hundred characters), never a token. */
  botResponse: string | null;
  httpStatus: number | null;
  /** Machine code of the refusal when the gateway or DirectSource produced it. */
  error: ApiError['code'] | null;
  /** What to look for to confirm the result, and when. */
  verify: { expectedState: string; checkAfterMs: number } | null;
  /** Round trip of the request. */
  latencyMs: number;
}

// ---- alerts and registry ----

export interface AlertsApi {
  rules(): Promise<AlertRulesConfig>;
  setRules(cfg: AlertRulesConfig): Promise<void>;
  ack(alertId: string): Promise<void>;
  silence(spec: {
    typeId?: AlertTypeId;
    botKey?: BotKey;
    subject?: string;
    untilMs: number;
  }): Promise<Silence>;
  unsilence(id: string): Promise<void>;
  silences(): Promise<Silence[]>;
  /** `true` when acknowledgements and silences are shared between devices (gateway). */
  shared: boolean;
  /** Current alerts, for pages that do not subscribe. */
  list(): Alert[];
}

export interface RegistryBot {
  botKey: BotKey;
  /** `ftbot.N` alias on this device. */
  uiId: string | null;
  name: string;
  icon: string | null;
}

export interface DiscoveredBot {
  botKey: BotKey;
  name: string;
  port: number | null;
  mode: BotMode;
}

export interface RegistryApi {
  list(): Promise<RegistryBot[]>;
  /** Bots running on the host that the browser does not know yet (gateway only). */
  discovered(): Promise<DiscoveredBot[]>;
  /** `ftbot.N` of this device to canonical `bot_key`. */
  botKeyOf(uiId: string): BotKey | null;
  uiIdOf(botKey: BotKey): string | null;
}

export interface ProxyOptions {
  timeoutMs?: number;
  /**
   * Name of the bot, typed back by the user: the gateway refuses the most dangerous writes
   * (reconciliation, replay with `reset_db`) without it (`X-Confirm-Bot`). Ignored in direct mode.
   */
  confirmBot?: string;
}

// ---- the contract ----

export interface DataSource {
  kind: SourceKind;
  status: Ref<SourceStatus>;
  /** Begin pulling data. Idempotent. */
  start(): Promise<void>;
  /** Stop every timer, request and socket. Idempotent. */
  stop(): void;
  subscribe<C extends Channel>(
    ch: C,
    params: ChannelParams[C],
    sink: (u: ChannelUpdate[C]) => void,
  ): () => void;
  query: {
    trades(q: TradeQuery): Promise<TradePage>;
    periods(q: PeriodQuery): Promise<PeriodRow[]>;
    equity(q: EquityQuery): Promise<EquitySeries>;
    drawdown(q: DrawdownQuery): Promise<DrawdownResult | null>;
    logs(q: LogQuery): Promise<Page<GwLogLine>>;
    events(q: EventQuery): Promise<Page<Event>>;
    scope(s: ScopeRef): Promise<ScopeDetail>;
    /**
     * Orders of one trade, for the DCA ladder and the fills on the chart. `null`: the orders could
     * not be read (the ladder then says so instead of inventing levels).
     */
    tradeOrders?(botKey: BotKey, tradeId: number): Promise<OrderRow[] | null>;
    /**
     * CSV of the whole filtered set, produced by the gateway (`GET /trades/export.csv`). Absent in
     * direct mode, where the Journal can only export the rows it holds.
     */
    exportTradesCsv?(q: TradeQuery): Promise<string>;
    /**
     * The audit trail of the writes made through the gateway (`GET /audit`), newest first. Absent
     * in direct mode, where nothing is recorded.
     */
    audit?(q?: { limit?: number; botKey?: BotKey }): Promise<AuditEntry[]>;
  };
  /** One request, never retried. The idempotency key makes a duplicate return the first result. */
  act(botKey: BotKey, action: BotAction, idempotencyKey: string): Promise<ActionResult>;
  proxy<T>(
    botKey: BotKey,
    method: string,
    path: string,
    body?: unknown,
    opts?: ProxyOptions,
  ): Promise<T>;
  registry: RegistryApi;
  alerts: AlertsApi;
}

export function scopeKey(s: ScopeRef): string {
  switch (s.kind) {
    case 'fleet':
      return 'fleet';
    case 'group':
      return `group:${s.id}`;
    case 'bot':
      return `bot:${s.botKey}`;
  }
}
