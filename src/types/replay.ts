// Fork-specific: dry-run replay (seed a bot's dry-run DB from a historical replay).

export interface ReplayRequest {
  strategy: string;
  timerange: string; // YYYYMMDD-YYYYMMDD
  pairs: string[];
  wallet: number | null; // null -> backend uses the bot config's dry_run_wallet
  slippage: number;
  sub_step: number; // intra-candle resolution in seconds (60=1m, 300=5m, 900=15m)
  reset_db: boolean; // wipe the dry DB first (else preserve existing trades)
  priority: number;
}

export interface ReplaySummary {
  db_url: string;
  closed_trades: number;
  open_trades: number;
  wins: number;
  win_rate: number | null;
  profit_factor: number | null;
  total_profit_abs: number;
  total_profit_ratio: number;
}

export interface ReplayStatus {
  status: 'not_started' | 'queued' | 'running' | 'paused' | 'done' | 'error';
  running: boolean;
  status_msg: string;
  progress: number;
  step: string;
  db_url: string | null;
  result: ReplaySummary | null;
  elapsed_s: number | null;
  eta_s: number | null;
}

// Machine-wide coordinator view (GET /replay/queue).
export interface ReplayQueueItem {
  bot_id: string;
  state: string;
  priority: number;
  progress: number;
  eta_s: number | null;
}
export interface ReplayQueue {
  ok: boolean;
  cores: number;
  hyperopt_cores: number;
  capacity: number;
  running: ReplayQueueItem[];
  paused: ReplayQueueItem[];
  queued: ReplayQueueItem[];
}

export interface ReplaySeededInfo {
  dry_run: boolean;
  seeded: boolean;
  info: Record<string, unknown> | null;
  backup_available?: boolean;
  dry_run_wallet?: number; // wallet the replay uses when the request doesn't pin one
}

export interface ReplayCoverage {
  timeframe: string;
  earliest: string | null; // oldest first-candle date across pairs that have the tf
  latest: string | null; // newest last-candle date
  pairs_with_data: number;
  pairs_total: number;
}
