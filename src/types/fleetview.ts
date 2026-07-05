export interface FleetviewBotCapital {
  available_capital: number | null;
  capital_withdrawal: number;
  realized_total: number;
  effective: number | null;
}

export interface FleetviewBotPnl {
  realized_1d: number;
  realized_7d: number;
  realized_30d: number;
  realized_total: number;
}

export interface FleetviewBotTrades {
  open_count: number;
  closed_count: number;
  count_30d: number;
}

export interface FleetviewBotUptime {
  process_start: number | null;
  first_trade: string | null;
  last_trade: string | null;
}

export interface FleetviewBotBadges {
  frozen: boolean;
  inert: boolean;
  leverage_values: number[];
}

export interface FleetviewOpenTrade {
  trade_id: number;
  pair: string;
  is_short: boolean;
  amount: number;
  open_rate: number;
  stake_amount: number;
  leverage: number | null;
  open_date: string;
}

export type FleetviewDirection = 'long' | 'short' | 'dual' | 'unknown';

export interface FleetviewBot {
  bot_name: string;
  config_file: string;
  dry_run: boolean;
  strategy: string | null;
  port: number | null;
  is_self: boolean;
  db_ok: boolean;
  direction: FleetviewDirection;
  capital: FleetviewBotCapital;
  pnl: FleetviewBotPnl;
  trades: FleetviewBotTrades;
  uptime: FleetviewBotUptime;
  badges: FleetviewBotBadges;
  open_trades: FleetviewOpenTrade[];
}

export interface FleetviewOverviewResponse {
  generated_at: number;
  bots: FleetviewBot[];
}

export interface FleetviewSlice {
  bot_name: string;
  port: number | null;
  trade_id: number;
  pair: string;
  signed_amount: number;
  open_rate: number;
  stake_amount: number;
}

export type FleetviewCoinStatus = 'ok' | 'phantom' | 'minority' | 'unowned' | 'ambiguous';

export interface FleetviewTradeRef {
  bot_name: string;
  trade_id: number;
}

export type FleetviewHintCode =
  | 'refresh_first'
  | 'dust'
  | 'multi_phantom'
  | 'partial_fill'
  | 'stale_db';

export interface FleetviewHintCandidate {
  bot_name: string;
  trade_id: number;
  signed_amount: number;
}

export interface FleetviewHintSuspect {
  bot_name: string;
  trade_id: number;
  db_amount: number;
  implied_fill: number;
}

export interface FleetviewHint {
  code: FleetviewHintCode;
  notional?: number;
  candidates?: FleetviewHintCandidate[];
  suspects?: FleetviewHintSuspect[];
}

export interface FleetviewCoin {
  coin: string;
  db_sum: number;
  on_chain: number;
  diff?: number;
  diff_notional?: number | null;
  mark_price: number | null;
  on_chain_leverage: number | null;
  unrealized_pnl: number;
  status: FleetviewCoinStatus;
  slices: FleetviewSlice[];
  phantom_candidate: FleetviewTradeRef | null;
  minority_slices: FleetviewTradeRef[];
  hints?: FleetviewHint[];
}

export interface FleetviewReconciliationResponse {
  generated_at: number;
  wallet: string;
  live_bots: number;
  issues: number;
  coins: FleetviewCoin[];
}

export type FleetviewResolveAction = 'delete_phantom' | 'close_minority' | 'close_unowned';

export interface FleetviewResolvePayload {
  action: FleetviewResolveAction;
  coin: string;
  bot_name?: string;
  trade_id?: number;
  confirm: boolean;
}

export interface FleetviewResolveOrder {
  order_id?: string;
  filled?: number;
  average?: number;
  notional?: number;
}

export interface FleetviewResolveResponse {
  action: string;
  coin: string;
  order?: FleetviewResolveOrder;
  delete?: string;
}

export type FleetviewRealignOp = 'close' | 'adjust';

export interface FleetviewRealignOperation {
  bot_name: string;
  trade_id: number;
  op: FleetviewRealignOp;
  new_amount?: number;
}

export interface FleetviewRealignPayload {
  coin: string;
  operations: FleetviewRealignOperation[];
  confirm: boolean;
}

export interface FleetviewRealignPlanOperation {
  bot_name: string;
  trade_id: number;
  op: FleetviewRealignOp;
  signed_amount_before: number;
  signed_amount_after: number;
  delta: number;
  delta_notional: number | null;
}

export interface FleetviewRealignResult {
  bot_name: string;
  trade_id: number;
  op: FleetviewRealignOp;
  result: string;
}

export interface FleetviewRealignPreview {
  preview: boolean;
  coin: string;
  on_chain: number;
  db_sum_before: number;
  db_sum_after: number;
  touched_notional: number;
  operations: FleetviewRealignPlanOperation[];
  results?: FleetviewRealignResult[];
}
