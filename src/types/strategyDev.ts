export enum RunType {
  backtest = 'backtest',
  hyperopt = 'hyperopt',
  wfa = 'wfa',
  live = 'live',
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
  // Live bot fields
  botId?: string;
  exchange?: string;
  dry_run?: boolean;
  open_trades_count?: number;
}

export interface AllRunsResponse {
  backtests: RunListEntry[];
  hyperopts: RunListEntry[];
  wfa_runs: RunListEntry[];
  hyperopts_total?: number;
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
  strategy_summary?: Record<string, unknown>;
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

// ── Job Launcher types ──

export enum JobType {
  backtest = 'backtest',
  hyperopt = 'hyperopt',
  wfa = 'walk-forward',
}

export enum JobStatus {
  pending = 'pending',
  running = 'running',
  completed = 'completed',
  failed = 'failed',
  aborted = 'aborted',
}

export interface JobStartRequest {
  job_type: JobType;
  config_file: string;
  strategy: string;
  timerange?: string;
  timeframe?: string;
  max_open_trades?: number;
  stake_amount?: string | number;
  enable_protections?: boolean;
  dry_run_wallet?: number;
  // Common advanced
  data_format_ohlcv?: string;
  fee?: number;
  pairs?: string[];
  enable_position_stacking?: boolean;
  timeframe_detail?: string;
  // Backtest-only
  export_type?: string;
  breakdown?: string[];
  cache?: string;
  enable_dynamic_pairlist?: boolean;
  notes?: string;
  // Hyperopt / WFA
  epochs?: number;
  spaces?: string[];
  hyperopt_loss?: string;
  sampler?: string;
  early_stop?: number;
  min_trades?: number;
  job_workers?: number;
  random_state?: number;
  // Hyperopt-only flags
  print_all?: boolean;
  disable_param_export?: boolean;
  ignore_missing_spaces?: boolean;
  analyze_per_epoch?: boolean;
  // WFA only
  wf_windows?: number;
  wf_train_ratio?: number;
  wf_embargo_days?: number;
  wf_holdout_months?: number;
  wf_min_test_trades?: number;
  wf_mode?: string;
  wf_multi_seed?: number;
  wf_cpcv_groups?: number;
  wf_cpcv_test_groups?: number;
}

export interface JobStatusResponse {
  job_id: string;
  job_type: string;
  strategy: string;
  config_file: string;
  status: JobStatus;
  pid?: number;
  started_at?: number;
  finished_at?: number;
  exit_code?: number;
  error?: string;
  log_lines: string[];
  command: string;
}

export interface JobListResponse {
  active: JobStatusResponse | null;
  history: JobStatusResponse[];
}

export interface ConfigListResponse {
  configs: string[];
  strategies: string[];
}

export interface ConfigDefaults {
  max_open_trades?: number | null;
  stake_amount?: string | null;
  dry_run_wallet?: number | null;
  stake_currency?: string | null;
  trading_mode?: string | null;
  timeframe?: string | null;
  exchange?: string | null;
  pairs_count?: number | null;
}

// ── Editor types ──

export interface EditorFileContent {
  path: string;
  content: string;
  language: string;
  is_custom: boolean;
}

export interface EditorSaveRequest {
  path: string;
  content: string;
  create_custom?: boolean;
}

export interface EditorSaveResponse {
  path: string;
  is_custom: boolean;
}

export interface EditorDiagnostic {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface EditorValidationResult {
  valid: boolean;
  errors: EditorDiagnostic[];
}

export interface EditorSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

export interface EditorConfigSchema {
  properties: Record<string, EditorSchemaProperty>;
  required: string[];
}

export interface StrategyHookHint {
  name: string;
  signature: string;
  doc: string;
}

export interface EditorStrategyHints {
  hooks: StrategyHookHint[];
  dataframe_columns: string[];
  common_indicators: string[];
  parameters: Record<string, string>;
  imports: string[];
}
