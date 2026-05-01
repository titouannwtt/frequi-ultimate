export type VerdictLevel = 'good' | 'ok' | 'warn' | 'bad' | 'neutral';

export interface MetricThreshold {
  key: string;
  label: string;
  unit?: string;
  good: (v: number) => boolean;
  warn: (v: number) => boolean;
  verdictText: (v: number) => string;
}

export const metricThresholds: Record<string, MetricThreshold> = {
  profit_total: {
    key: 'profit_total',
    label: 'Total Profit',
    unit: '%',
    good: (v) => v > 0.05,
    warn: (v) => v > 0,
    verdictText: (v) =>
      v > 0.1 ? 'Strong positive' : v > 0.05 ? 'Positive' : v > 0 ? 'Marginal' : 'Negative',
  },
  max_drawdown_account: {
    key: 'max_drawdown_account',
    label: 'Max Drawdown',
    unit: '%',
    good: (v) => v < 0.2,
    warn: (v) => v < 0.35,
    verdictText: (v) =>
      v < 0.15 ? 'Low risk' : v < 0.25 ? 'Acceptable' : v < 0.35 ? 'Elevated' : 'Dangerous (>35%)',
  },
  total_trades: {
    key: 'total_trades',
    label: 'Total Trades',
    good: (v) => v >= 60,
    warn: (v) => v >= 30,
    verdictText: (v) =>
      v >= 100 ? 'High confidence' : v >= 60 ? 'Sufficient' : v >= 30 ? 'Low — results may not be stable' : 'Too few (<30)',
  },
  winrate: {
    key: 'winrate',
    label: 'Win Rate',
    unit: '%',
    good: (v) => v >= 0.55 && v < 0.95,
    warn: (v) => v >= 0.45,
    verdictText: (v) =>
      v >= 0.95 ? 'Suspiciously high — likely overfit' : v >= 0.65 ? 'Strong' : v >= 0.55 ? 'Good' : v >= 0.45 ? 'Marginal' : 'Low (<45%)',
  },
  sharpe: {
    key: 'sharpe',
    label: 'Sharpe Ratio',
    good: (v) => v > 1.5,
    warn: (v) => v > 0.5,
    verdictText: (v) =>
      v > 3 ? 'Excellent — verify not overfit' : v > 1.5 ? 'Good' : v > 0.5 ? 'Marginal' : 'Poor (<0.5)',
  },
  profit_factor: {
    key: 'profit_factor',
    label: 'Profit Factor',
    good: (v) => v > 1.5,
    warn: (v) => v > 1.1,
    verdictText: (v) =>
      v > 2.5 ? 'Strong' : v > 1.5 ? 'Good' : v > 1.1 ? 'Marginal' : 'Poor (<1.1)',
  },
  sqn: {
    key: 'sqn',
    label: 'SQN',
    good: (v) => v > 2,
    warn: (v) => v > 1,
    verdictText: (v) =>
      v > 3 ? 'Excellent system' : v > 2 ? 'Good' : v > 1 ? 'Below average' : 'Poor',
  },
  best_loss: {
    key: 'best_loss',
    label: 'Best Loss',
    good: (v) => v < -0.05,
    warn: (v) => v < 0,
    verdictText: (v) =>
      v < -0.1 ? 'Strong optimization' : v < -0.05 ? 'Good' : v < 0 ? 'Marginal' : 'No improvement found',
  },
};

export function getVerdict(key: string, value: number): VerdictLevel {
  const t = metricThresholds[key];
  if (!t) return 'neutral';
  if (t.good(value)) return 'good';
  if (t.warn(value)) return 'warn';
  return 'bad';
}

export function getVerdictText(key: string, value: number): string {
  const t = metricThresholds[key];
  if (!t) return '';
  return t.verdictText(value);
}

export interface ChecklistItem {
  key: string;
  label: string;
  check: (metrics: Record<string, number>, run: Record<string, unknown>) => 'pass' | 'warn' | 'fail' | 'skip';
  reason: (metrics: Record<string, number>) => string;
}

export const validationChecklist: ChecklistItem[] = [
  {
    key: 'trades_count',
    label: 'Trades > 60',
    check: (m) => m.total_trades == null ? 'skip' : m.total_trades >= 60 ? 'pass' : m.total_trades >= 30 ? 'warn' : 'fail',
    reason: (m) => m.total_trades != null ? `${m.total_trades} trades` : 'No data',
  },
  {
    key: 'drawdown',
    label: 'Drawdown < 45%',
    check: (m) => m.max_drawdown_account == null ? 'skip' : m.max_drawdown_account < 0.35 ? 'pass' : m.max_drawdown_account < 0.45 ? 'warn' : 'fail',
    reason: (m) => m.max_drawdown_account != null ? `${(m.max_drawdown_account * 100).toFixed(1)}%` : 'No data',
  },
  {
    key: 'winrate_check',
    label: 'Win rate 45-95%',
    check: (m) => m.winrate == null ? 'skip' : (m.winrate >= 0.45 && m.winrate < 0.95) ? 'pass' : m.winrate >= 0.95 ? 'fail' : 'warn',
    reason: (m) => m.winrate != null ? `${(m.winrate * 100).toFixed(1)}%` : 'No data',
  },
  {
    key: 'no_100_winrate',
    label: 'No 100% win rate',
    check: (m) => m.winrate == null ? 'skip' : m.winrate >= 1.0 ? 'fail' : 'pass',
    reason: (m) => m.winrate != null ? (m.winrate >= 1.0 ? 'All trades winning — extreme overfit' : 'OK') : 'No data',
  },
  {
    key: 'profit_positive',
    label: 'Profit > 0%',
    check: (m) => m.profit_total == null ? 'skip' : m.profit_total > 0.05 ? 'pass' : m.profit_total > 0 ? 'warn' : 'fail',
    reason: (m) => m.profit_total != null ? `${(m.profit_total * 100).toFixed(2)}%` : 'No data',
  },
  {
    key: 'sharpe_check',
    label: 'Sharpe > 0.5',
    check: (m) => m.sharpe == null ? 'skip' : m.sharpe > 1.5 ? 'pass' : m.sharpe > 0.5 ? 'warn' : 'fail',
    reason: (m) => m.sharpe != null ? m.sharpe.toFixed(2) : 'No data',
  },
  {
    key: 'profit_factor_check',
    label: 'Profit Factor > 1.1',
    check: (m) => m.profit_factor == null ? 'skip' : m.profit_factor > 1.5 ? 'pass' : m.profit_factor > 1.1 ? 'warn' : 'fail',
    reason: (m) => m.profit_factor != null ? m.profit_factor.toFixed(2) : 'No data',
  },
  {
    key: 'loss_negative',
    label: 'Loss value < 0',
    check: (_m, run) => {
      const loss = run.best_loss as number | undefined;
      if (loss == null) return 'skip';
      return loss < -0.05 ? 'pass' : loss < 0 ? 'warn' : 'fail';
    },
    reason: (_m, run) => {
      const loss = run.best_loss as number | undefined;
      return loss != null ? loss.toFixed(5) : 'No data';
    },
  },
];
