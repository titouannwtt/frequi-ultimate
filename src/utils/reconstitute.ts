import { JobType, RunType } from '@/types';
import type { JobStartRequest, RunListEntry, BacktestSnapshotResponse } from '@/types';

export function parseTimerangeToDates(timerange: string): { from: string; to: string } | null {
  const parts = timerange.split('-');
  if (parts.length !== 2) return null;
  const parse = (s: string) => {
    if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return s;
  };
  return { from: parse(parts[0]), to: parse(parts[1]) };
}

export function formatDateToTimerange(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function runTypeToJobType(runType: RunType): JobType | null {
  if (runType === RunType.backtest) return JobType.backtest;
  if (runType === RunType.hyperopt) return JobType.hyperopt;
  if (runType === RunType.wfa) return JobType.wfa;
  return null;
}

export function buildPrefillFromBacktest(
  run: RunListEntry,
  snapshot: BacktestSnapshotResponse | null,
): Partial<JobStartRequest> {
  const prefill: Partial<JobStartRequest> = { job_type: JobType.backtest };

  if (run.strategy) prefill.strategy = run.strategy;
  if (run.timeframe) prefill.timeframe = run.timeframe;
  if (run.timerange) prefill.timerange = run.timerange;

  const cfg = (snapshot?.config as Record<string, unknown>) ?? null;
  if (cfg) {
    const configFiles = cfg.config_files as string[] | undefined;
    if (configFiles?.length) prefill.config_file = configFiles[0];
    if (cfg.max_open_trades != null) prefill.max_open_trades = Number(cfg.max_open_trades);
    if (cfg.dry_run_wallet != null) prefill.dry_run_wallet = Number(cfg.dry_run_wallet);
    if (cfg.stake_amount != null) prefill.stake_amount = String(cfg.stake_amount);
  }

  return prefill;
}

export function buildPrefillFromHyperopt(
  run: RunListEntry,
  detail: Record<string, unknown> | null,
): Partial<JobStartRequest> {
  const prefill: Partial<JobStartRequest> = { job_type: JobType.hyperopt };

  if (run.strategy) prefill.strategy = run.strategy;
  if (run.timeframe) prefill.timeframe = run.timeframe;
  if (run.timerange) prefill.timerange = run.timerange;

  if (detail) {
    if (detail.config_file) prefill.config_file = String(detail.config_file);
    if (detail.hyperopt_loss) prefill.hyperopt_loss = String(detail.hyperopt_loss);
    if (detail.max_open_trades != null) prefill.max_open_trades = Number(detail.max_open_trades);
    if (detail.dry_run_wallet != null) prefill.dry_run_wallet = Number(detail.dry_run_wallet);
    if (detail.stake_amount != null) prefill.stake_amount = String(detail.stake_amount);
    if (detail.epochs_total) prefill.epochs = Number(detail.epochs_total);
    const sp = detail.spaces as string[] | undefined;
    if (sp?.length) prefill.spaces = sp;
  }

  return prefill;
}

export function buildPrefillFromWfa(
  run: RunListEntry,
  detail: Record<string, unknown> | null,
): Partial<JobStartRequest> {
  const prefill: Partial<JobStartRequest> = { job_type: JobType.wfa };

  if (run.strategy) prefill.strategy = run.strategy;
  if (run.timeframe) prefill.timeframe = run.timeframe;
  if (run.timerange) prefill.timerange = run.timerange;

  if (detail) {
    if (detail.config_file) prefill.config_file = String(detail.config_file);
    if (detail.hyperopt_loss) prefill.hyperopt_loss = String(detail.hyperopt_loss);
    if (detail.max_open_trades != null) prefill.max_open_trades = Number(detail.max_open_trades);
    if (detail.dry_run_wallet != null) prefill.dry_run_wallet = Number(detail.dry_run_wallet);
    if (detail.stake_amount != null) prefill.stake_amount = String(detail.stake_amount);
    if ((detail as any).epochs_per_window) prefill.epochs = Number((detail as any).epochs_per_window);
    if ((detail as any).n_windows) prefill.wf_windows = Number((detail as any).n_windows);
    const sp = detail.spaces as string[] | undefined;
    if (sp?.length) prefill.spaces = sp;
  }

  return prefill;
}

export interface LiveBotPrefillInput {
  strategy: string;
  timeframe: string;
  maxOpenTrades: number;
  stakeAmount: string;
  dryRunWallet?: number | null;
  firstTradeTimestamp?: number | null;
  pairs?: string[];
}

export function buildPrefillFromLiveBot(input: LiveBotPrefillInput): Partial<JobStartRequest> {
  const prefill: Partial<JobStartRequest> = {
    job_type: JobType.backtest,
    strategy: input.strategy,
    timeframe: input.timeframe,
    max_open_trades: input.maxOpenTrades,
    stake_amount: input.stakeAmount,
  };

  if (input.dryRunWallet != null) prefill.dry_run_wallet = input.dryRunWallet;
  if (input.pairs?.length) prefill.pairs = input.pairs;

  if (input.firstTradeTimestamp) {
    const from = new Date(input.firstTradeTimestamp);
    const to = new Date();
    prefill.timerange = `${formatDateToTimerange(from)}-${formatDateToTimerange(to)}`;
  }

  return prefill;
}
