export enum RunType {
  backtest = 'backtest',
  hyperopt = 'hyperopt',
  wfa = 'wfa',
}

export interface RunListEntry {
  run_type: RunType;
  filename: string;
  strategy: string;
  timestamp: number;
  timeframe?: string;
  timerange?: string;
  notes?: string;
  has_metadata: boolean;
  total_profit_pct?: number;
  total_trades?: number;
  best_sharpe?: number;
  hyperopt_loss?: string;
  epochs_total?: number;
  epochs_completed?: number;
  best_loss?: number;
  verdict_grade?: string;
  n_windows?: number;
  run_id?: string;
  tags?: string[];
  favorite?: boolean;
}

export interface AllRunsResponse {
  backtests: RunListEntry[];
  hyperopts: RunListEntry[];
  wfa_runs: RunListEntry[];
}

export interface SnapshotDiffRequest {
  run_type: RunType;
  filename: string;
  diff_type: string;
}

export interface SnapshotDiffResponse {
  snapshot: string;
  current: string | null;
  has_changes: boolean;
}

export interface BacktestSnapshotResponse {
  strategy_source?: string;
  config?: Record<string, unknown>;
  strategy_params?: Record<string, unknown>;
}

export interface MetadataUpdateRequest {
  notes?: string;
  tags?: string[];
  favorite?: boolean;
}

export interface GlossaryResponse {
  metrics: Record<string, GlossaryEntry>;
  samplers: Record<string, GlossaryEntry>;
  losses: Record<string, GlossaryEntry>;
}

export interface GlossaryEntry {
  slug: string;
  label: string;
  one_liner: string;
  explanation?: string;
  range?: string;
  good?: string;
}
