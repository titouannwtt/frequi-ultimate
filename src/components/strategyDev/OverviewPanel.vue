<script setup lang="ts">
import { RunType } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();

const run = computed(() => store.selectedRun);

const metrics = computed(() => {
  if (!run.value) return [];
  const items: { label: string; value: string | number; hint?: string }[] = [];

  if (run.value.total_profit_pct != null)
    items.push({
      label: t('strategyDev.totalProfit'),
      value: `${run.value.total_profit_pct.toFixed(2)}%`,
      hint: t('strategyDev.hintTotalProfit'),
    });
  if (run.value.total_trades != null)
    items.push({ label: t('strategyDev.totalTrades'), value: run.value.total_trades, hint: t('strategyDev.hintTotalTrades') });
  if (run.value.best_sharpe != null)
    items.push({ label: t('strategyDev.bestSharpe'), value: run.value.best_sharpe.toFixed(3), hint: t('strategyDev.hintBestSharpe') });
  if (run.value.best_loss != null)
    items.push({ label: t('strategyDev.bestLoss'), value: run.value.best_loss.toFixed(5), hint: t('strategyDev.hintBestLoss') });
  if (run.value.epochs_completed != null && run.value.epochs_total != null)
    items.push({
      label: t('strategyDev.epochsCompleted'),
      value: `${run.value.epochs_completed} / ${run.value.epochs_total}`,
    });
  if (run.value.verdict_grade)
    items.push({ label: t('strategyDev.verdictGrade'), value: run.value.verdict_grade });
  if (run.value.n_windows != null)
    items.push({ label: t('strategyDev.nWindows'), value: run.value.n_windows });

  return items;
});

const detail = computed(() => {
  if (!run.value) return null;
  if (run.value.run_type === RunType.hyperopt) return store.hyperoptDetail;
  if (run.value.run_type === RunType.wfa) return store.wfaDetail;
  if (run.value.run_type === RunType.backtest) return store.backtestSnapshot as Record<string, unknown> | null;
  return null;
});

const bestParams = computed(() => {
  const d = detail.value;
  if (!d) return null;
  return (
    (d.best_params as Record<string, unknown>) || (d.consensus as Record<string, unknown>) || null
  );
});

// --- Backtest data ---
const s = computed<Record<string, unknown> | null>(() => {
  if (run.value?.run_type !== RunType.backtest || !detail.value) return null;
  return (detail.value as Record<string, unknown>).strategy_summary as Record<string, unknown> | null;
});

type ResultLine = {
  key: string | string[];
  trades: number;
  profit_mean_pct: number;
  profit_total_abs: number;
  profit_total_pct: number;
  duration_avg: string;
  wins: number;
  draws: number;
  losses: number;
  winrate: number;
};

function asResultLines(val: unknown): ResultLine[] {
  if (!Array.isArray(val)) return [];
  return val as ResultLine[];
}

function fmtPct(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

function fmtAbs(v: number | null | undefined, decimals = 3): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}

function fmtWinrate(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}`;
}

function fmtDuration(v: string | null | undefined): string {
  return v ?? '—';
}

function fmtTimedelta(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return '—';
  const totalMin = Math.floor(seconds / 60);
  const totalH = Math.floor(totalMin / 60);
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${h}:${String(m).padStart(2, '0')}:00`;
}

function profitClass(v: number | null | undefined): string {
  if (v == null || v === 0) return '';
  return v > 0 ? 'ov-positive' : 'ov-negative';
}

function keyDisplay(key: string | string[]): string {
  if (Array.isArray(key)) return key.join(' / ');
  return key;
}

const currency = computed(() => (s.value?.stake_currency as string) ?? 'USDC');

const resultsPerPair = computed(() => asResultLines(s.value?.results_per_pair));
const enterTagStats = computed(() => asResultLines(s.value?.results_per_enter_tag));
const exitReasonSummary = computed(() => asResultLines(s.value?.exit_reason_summary));
const mixTagStats = computed(() => asResultLines(s.value?.mix_tag_stats));

// Sections collapsed state
const showPairResults = ref(true);
const showEnterTag = ref(false);
const showExitReason = ref(false);
const showMixTag = ref(false);

// Summary metrics
interface MetricRow { label: string; value: string; separator?: boolean }

const summaryMetrics = computed<MetricRow[]>(() => {
  const d = s.value;
  if (!d) return [];
  const c = currency.value;
  const rows: MetricRow[] = [];

  rows.push({ label: 'Backtesting from', value: (d.backtest_start as string) ?? '—' });
  rows.push({ label: 'Backtesting to', value: (d.backtest_end as string) ?? '—' });
  if (d.trading_mode) rows.push({ label: 'Trading Mode', value: `${capitalize(d.margin_mode as string ?? '')} ${capitalize(d.trading_mode as string)}`.trim() });
  rows.push({ label: 'Max open trades', value: String(d.max_open_trades ?? '—') });
  rows.push({ label: '', value: '', separator: true });

  rows.push({ label: 'Total/Daily Avg Trades', value: `${d.total_trades ?? 0} / ${fmtAbs(d.trades_per_day as number, 2)}` });
  rows.push({ label: 'Starting balance', value: `${fmtAbs(d.starting_balance as number, 2)} ${c}` });
  rows.push({ label: 'Final balance', value: `${fmtAbs(d.final_balance as number, 2)} ${c}` });
  rows.push({ label: 'Absolute profit', value: `${fmtAbs(d.profit_total_abs as number, 3)} ${c}` });
  rows.push({ label: 'Total profit %', value: `${((d.profit_total as number ?? 0) * 100).toFixed(2)}%` });
  if (d.cagr != null) rows.push({ label: 'CAGR %', value: `${((d.cagr as number) * 100).toFixed(2)}%` });
  rows.push({ label: 'Sharpe', value: fmtAbs(d.sharpe as number, 2) });
  rows.push({ label: 'Sortino', value: fmtAbs(d.sortino as number, 2) });
  rows.push({ label: 'Calmar', value: fmtAbs(d.calmar as number, 2) });
  rows.push({ label: 'SQN', value: fmtAbs(d.sqn as number, 2) });
  rows.push({ label: 'Profit factor', value: fmtAbs(d.profit_factor as number, 2) });
  if (d.expectancy != null) rows.push({ label: 'Expectancy (Ratio)', value: `${fmtAbs(d.expectancy as number, 2)} (${fmtAbs(d.expectancy_ratio as number, 2)})` });
  if (d.backtest_days) rows.push({ label: 'Avg. daily profit', value: `${fmtAbs((d.profit_total_abs as number) / (d.backtest_days as number), 3)} ${c}` });
  rows.push({ label: 'Avg. stake amount', value: `${fmtAbs(d.avg_stake_amount as number, 2)} ${c}` });
  if (d.market_change != null) rows.push({ label: 'Market change', value: `${((d.market_change as number) * 100).toFixed(2)}%` });
  if (d.total_volume != null) rows.push({ label: 'Total trade volume', value: `${fmtAbs(d.total_volume as number, 3)} ${c}` });
  rows.push({ label: '', value: '', separator: true });

  const bp = d.best_pair as Record<string, unknown> | null;
  const wp = d.worst_pair as Record<string, unknown> | null;
  if (bp) rows.push({ label: 'Best Pair', value: `${bp.key} ${fmtPct(bp.profit_total_pct as number)}` });
  if (wp) rows.push({ label: 'Worst Pair', value: `${wp.key} ${fmtPct(wp.profit_total_pct as number)}` });

  // Best/worst trade from trades list
  const trades = d.trades as Record<string, unknown>[] | undefined;
  if (trades?.length) {
    const sorted = [...trades].sort((a, b) => (b.profit_ratio as number) - (a.profit_ratio as number));
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    rows.push({ label: 'Best trade', value: `${best.pair} ${fmtPct((best.profit_ratio as number) * 100)}` });
    rows.push({ label: 'Worst trade', value: `${worst.pair} ${fmtPct((worst.profit_ratio as number) * 100)}` });
  }

  rows.push({ label: 'Best day', value: `${fmtAbs(d.backtest_best_day_abs as number, 3)} ${c}` });
  rows.push({ label: 'Worst day', value: `${fmtAbs(d.backtest_worst_day_abs as number, 3)} ${c}` });
  rows.push({ label: 'Days win/draw/lose', value: `${d.winning_days ?? 0} / ${d.draw_days ?? 0} / ${d.losing_days ?? 0}` });
  rows.push({ label: 'Min/Max/Avg. Duration Winners', value: `${d.winner_holding_min ?? '—'} / ${d.winner_holding_max ?? '—'} / ${d.winner_holding_avg ?? '—'}` });
  rows.push({ label: 'Min/Max/Avg. Duration Losers', value: `${d.loser_holding_min ?? '—'} / ${d.loser_holding_max ?? '—'} / ${d.loser_holding_avg ?? '—'}` });
  rows.push({ label: 'Max Consecutive Wins / Loss', value: `${d.max_consecutive_wins ?? 0} / ${d.max_consecutive_losses ?? 0}` });
  rows.push({ label: 'Rejected Entry signals', value: String(d.rejected_signals ?? 0) });
  rows.push({ label: 'Entry/Exit Timeouts', value: `${d.timedout_entry_orders ?? 0} / ${d.timedout_exit_orders ?? 0}` });
  rows.push({ label: '', value: '', separator: true });

  // Drawdown section
  rows.push({ label: 'Max % of account underwater', value: `${((d.max_drawdown_account as number ?? 0) * 100).toFixed(2)}%` });
  rows.push({ label: 'Absolute drawdown', value: `${fmtAbs(d.max_drawdown_abs as number, 3)} ${c} (${((d.max_drawdown_account as number ?? 0) * 100).toFixed(2)}%)` });
  if (d.drawdown_duration_s) rows.push({ label: 'Drawdown duration', value: fmtTimedelta(d.drawdown_duration_s as number) });
  rows.push({ label: 'Profit at drawdown start', value: `${fmtAbs(d.max_drawdown_high as number, 3)} ${c}` });
  rows.push({ label: 'Profit at drawdown end', value: `${fmtAbs(d.max_drawdown_low as number, 3)} ${c}` });
  if (d.drawdown_start) rows.push({ label: 'Drawdown start', value: (d.drawdown_start as string) ?? '—' });
  if (d.drawdown_end) rows.push({ label: 'Drawdown end', value: (d.drawdown_end as string) ?? '—' });

  // Wallet-based metrics
  const ws = d.wallet_stats as Record<string, unknown> | undefined;
  if (ws && Object.keys(ws).length > 0) {
    rows.push({ label: '', value: '', separator: true });
    rows.push({ label: 'Wallet based Metrics', value: '' });
    rows.push({ label: 'Min/Max balance (wallet)', value: `${fmtAbs(ws.low_balance as number, 3)} ${c} / ${fmtAbs(ws.high_balance as number, 3)} ${c}` });
    if (ws.low_date && ws.high_date) rows.push({ label: 'Min/Max balance dates', value: `${ws.low_date} / ${ws.high_date}` });
    rows.push({ label: 'Max % underwater (balance)', value: `${((ws.max_drawdown_account as number ?? 0) * 100).toFixed(2)}%` });
    rows.push({ label: 'Absolute drawdown (wallet)', value: `${fmtAbs(ws.max_drawdown_abs as number, 3)} ${c} (${((ws.max_drawdown_account as number ?? 0) * 100).toFixed(2)}%)` });
    if (ws.drawdown_duration_s) rows.push({ label: 'Drawdown duration', value: fmtTimedelta(ws.drawdown_duration_s as number) });
    if (ws.max_drawdown_high != null) rows.push({ label: 'Profit at drawdown start', value: `${fmtAbs(ws.max_drawdown_high as number, 3)} ${c}` });
    if (ws.max_drawdown_low != null) rows.push({ label: 'Profit at drawdown end', value: `${fmtAbs(ws.max_drawdown_low as number, 3)} ${c}` });
    if (ws.drawdown_start) rows.push({ label: 'Drawdown start', value: String(ws.drawdown_start) });
    if (ws.drawdown_end) rows.push({ label: 'Drawdown end', value: String(ws.drawdown_end) });
    if (ws.sharpe != null) rows.push({ label: 'Sharpe (daily wallet balance)', value: fmtAbs(ws.sharpe as number, 2) });
    if (ws.sortino != null) rows.push({ label: 'Sortino (daily wallet balance)', value: fmtAbs(ws.sortino as number, 2) });
    if (ws.calmar != null) rows.push({ label: 'Calmar (daily wallet balance)', value: fmtAbs(ws.calmar as number, 2) });
  }

  return rows;
});

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
</script>

<template>
  <div class="flex flex-col gap-4 py-3" style="max-width: 1600px; margin: 0 auto">
    <!-- Summary metrics cards (hyperopt/wfa/quick glance) -->
    <div v-if="metrics.length && run?.run_type !== RunType.backtest" class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div
        v-for="m in metrics"
        :key="m.label"
        class="flex flex-col p-3 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700"
      >
        <span class="text-sm text-surface-500 uppercase tracking-wide flex items-center gap-1">
          {{ m.label }}
          <InfoTip v-if="m.hint" :text="m.hint" width="280px" />
        </span>
        <span class="text-lg font-semibold mt-1">{{ m.value }}</span>
      </div>
    </div>

    <!-- Hyperopt loss function -->
    <div v-if="run?.hyperopt_loss" class="text-sm text-surface-500">
      <strong>Loss Function:</strong> {{ run.hyperopt_loss }}
    </div>

    <!-- Best parameters preview -->
    <div v-if="bestParams">
      <h4 class="text-sm font-semibold mb-2">Best Parameters</h4>
      <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 max-h-64 overflow-auto">
        <JsonViewer :data="bestParams" />
      </div>
    </div>

    <!-- WFA detail -->
    <div v-if="run?.run_type === RunType.wfa && detail">
      <h4 class="text-sm font-semibold mb-2">WFA Detail</h4>
      <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 max-h-96 overflow-auto">
        <JsonViewer :data="detail" />
      </div>
    </div>

    <!-- Hyperopt best epoch metrics -->
    <div
      v-if="
        run?.run_type === RunType.hyperopt &&
        detail &&
        (detail as Record<string, unknown>).best_epoch_metrics
      "
    >
      <h4 class="text-sm font-semibold mb-2">Best Epoch Metrics</h4>
      <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 max-h-64 overflow-auto">
        <JsonViewer
          :data="(detail as Record<string, unknown>).best_epoch_metrics as Record<string, unknown>"
        />
      </div>
    </div>

    <!-- ═══════ BACKTEST FULL RESULTS ═══════ -->
    <template v-if="s">
      <!-- Results per Pair -->
      <div v-if="resultsPerPair.length" class="ov-section">
        <button class="ov-section-toggle" @click="showPairResults = !showPairResults">
          <i-mdi-chevron-down v-if="showPairResults" class="w-4 h-4" />
          <i-mdi-chevron-right v-else class="w-4 h-4" />
          <span class="ov-section-title">Results per Pair</span>
          <span class="ov-section-count">{{ resultsPerPair.length }}</span>
        </button>
        <div v-if="showPairResults" class="ov-table-wrap">
          <table class="ov-table">
            <thead>
              <tr>
                <th class="ov-th ov-th-left">Pair</th>
                <th class="ov-th">Trades</th>
                <th class="ov-th">Avg Profit %</th>
                <th class="ov-th">Tot Profit {{ currency }}</th>
                <th class="ov-th">Tot Profit %</th>
                <th class="ov-th">Avg Duration</th>
                <th class="ov-th">Win</th>
                <th class="ov-th">Draw</th>
                <th class="ov-th">Loss</th>
                <th class="ov-th">Win%</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in resultsPerPair"
                :key="keyDisplay(r.key)"
                :class="{ 'ov-row-total': keyDisplay(r.key) === 'TOTAL' }"
              >
                <td class="ov-td ov-td-left ov-td-pair">{{ keyDisplay(r.key) }}</td>
                <td class="ov-td">{{ r.trades }}</td>
                <td class="ov-td" :class="profitClass(r.profit_mean_pct)">{{ r.profit_mean_pct.toFixed(2) }}</td>
                <td class="ov-td" :class="profitClass(r.profit_total_abs)">{{ fmtAbs(r.profit_total_abs, 3) }}</td>
                <td class="ov-td" :class="profitClass(r.profit_total_pct)">{{ r.profit_total_pct.toFixed(2) }}</td>
                <td class="ov-td">{{ fmtDuration(r.duration_avg) }}</td>
                <td class="ov-td ov-positive">{{ r.wins }}</td>
                <td class="ov-td">{{ r.draws }}</td>
                <td class="ov-td ov-negative">{{ r.losses }}</td>
                <td class="ov-td">{{ fmtWinrate(r.winrate) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Enter Tag Stats -->
      <div v-if="enterTagStats.length > 1" class="ov-section">
        <button class="ov-section-toggle" @click="showEnterTag = !showEnterTag">
          <i-mdi-chevron-down v-if="showEnterTag" class="w-4 h-4" />
          <i-mdi-chevron-right v-else class="w-4 h-4" />
          <span class="ov-section-title">Enter Tag Stats</span>
          <span class="ov-section-count">{{ enterTagStats.length }}</span>
        </button>
        <div v-if="showEnterTag" class="ov-table-wrap">
          <table class="ov-table">
            <thead>
              <tr>
                <th class="ov-th ov-th-left">Enter Tag</th>
                <th class="ov-th">Entries</th>
                <th class="ov-th">Avg Profit %</th>
                <th class="ov-th">Tot Profit {{ currency }}</th>
                <th class="ov-th">Tot Profit %</th>
                <th class="ov-th">Avg Duration</th>
                <th class="ov-th">Win</th>
                <th class="ov-th">Draw</th>
                <th class="ov-th">Loss</th>
                <th class="ov-th">Win%</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in enterTagStats" :key="keyDisplay(r.key)" :class="{ 'ov-row-total': keyDisplay(r.key) === 'TOTAL' }">
                <td class="ov-td ov-td-left ov-td-pair">{{ keyDisplay(r.key) || 'OTHER' }}</td>
                <td class="ov-td">{{ r.trades }}</td>
                <td class="ov-td" :class="profitClass(r.profit_mean_pct)">{{ r.profit_mean_pct.toFixed(2) }}</td>
                <td class="ov-td" :class="profitClass(r.profit_total_abs)">{{ fmtAbs(r.profit_total_abs, 3) }}</td>
                <td class="ov-td" :class="profitClass(r.profit_total_pct)">{{ r.profit_total_pct.toFixed(2) }}</td>
                <td class="ov-td">{{ fmtDuration(r.duration_avg) }}</td>
                <td class="ov-td ov-positive">{{ r.wins }}</td>
                <td class="ov-td">{{ r.draws }}</td>
                <td class="ov-td ov-negative">{{ r.losses }}</td>
                <td class="ov-td">{{ fmtWinrate(r.winrate) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Exit Reason Stats -->
      <div v-if="exitReasonSummary.length" class="ov-section">
        <button class="ov-section-toggle" @click="showExitReason = !showExitReason">
          <i-mdi-chevron-down v-if="showExitReason" class="w-4 h-4" />
          <i-mdi-chevron-right v-else class="w-4 h-4" />
          <span class="ov-section-title">Exit Reason Stats</span>
          <span class="ov-section-count">{{ exitReasonSummary.length }}</span>
        </button>
        <div v-if="showExitReason" class="ov-table-wrap">
          <table class="ov-table">
            <thead>
              <tr>
                <th class="ov-th ov-th-left">Exit Reason</th>
                <th class="ov-th">Exits</th>
                <th class="ov-th">Avg Profit %</th>
                <th class="ov-th">Tot Profit {{ currency }}</th>
                <th class="ov-th">Tot Profit %</th>
                <th class="ov-th">Avg Duration</th>
                <th class="ov-th">Win</th>
                <th class="ov-th">Draw</th>
                <th class="ov-th">Loss</th>
                <th class="ov-th">Win%</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in exitReasonSummary" :key="keyDisplay(r.key)" :class="{ 'ov-row-total': keyDisplay(r.key) === 'TOTAL' }">
                <td class="ov-td ov-td-left ov-td-pair">{{ keyDisplay(r.key) }}</td>
                <td class="ov-td">{{ r.trades }}</td>
                <td class="ov-td" :class="profitClass(r.profit_mean_pct)">{{ r.profit_mean_pct.toFixed(2) }}</td>
                <td class="ov-td" :class="profitClass(r.profit_total_abs)">{{ fmtAbs(r.profit_total_abs, 3) }}</td>
                <td class="ov-td" :class="profitClass(r.profit_total_pct)">{{ r.profit_total_pct.toFixed(2) }}</td>
                <td class="ov-td">{{ fmtDuration(r.duration_avg) }}</td>
                <td class="ov-td ov-positive">{{ r.wins }}</td>
                <td class="ov-td">{{ r.draws }}</td>
                <td class="ov-td ov-negative">{{ r.losses }}</td>
                <td class="ov-td">{{ fmtWinrate(r.winrate) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Mixed Tag Stats -->
      <div v-if="mixTagStats.length > 1" class="ov-section">
        <button class="ov-section-toggle" @click="showMixTag = !showMixTag">
          <i-mdi-chevron-down v-if="showMixTag" class="w-4 h-4" />
          <i-mdi-chevron-right v-else class="w-4 h-4" />
          <span class="ov-section-title">Mixed Tag Stats</span>
          <span class="ov-section-count">{{ mixTagStats.length }}</span>
        </button>
        <div v-if="showMixTag" class="ov-table-wrap">
          <table class="ov-table">
            <thead>
              <tr>
                <th class="ov-th ov-th-left">Enter / Exit</th>
                <th class="ov-th">Trades</th>
                <th class="ov-th">Avg Profit %</th>
                <th class="ov-th">Tot Profit {{ currency }}</th>
                <th class="ov-th">Tot Profit %</th>
                <th class="ov-th">Avg Duration</th>
                <th class="ov-th">Win</th>
                <th class="ov-th">Draw</th>
                <th class="ov-th">Loss</th>
                <th class="ov-th">Win%</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in mixTagStats" :key="keyDisplay(r.key)" :class="{ 'ov-row-total': keyDisplay(r.key) === 'TOTAL' }">
                <td class="ov-td ov-td-left ov-td-pair">{{ keyDisplay(r.key) || '—' }}</td>
                <td class="ov-td">{{ r.trades }}</td>
                <td class="ov-td" :class="profitClass(r.profit_mean_pct)">{{ r.profit_mean_pct.toFixed(2) }}</td>
                <td class="ov-td" :class="profitClass(r.profit_total_abs)">{{ fmtAbs(r.profit_total_abs, 3) }}</td>
                <td class="ov-td" :class="profitClass(r.profit_total_pct)">{{ r.profit_total_pct.toFixed(2) }}</td>
                <td class="ov-td">{{ fmtDuration(r.duration_avg) }}</td>
                <td class="ov-td ov-positive">{{ r.wins }}</td>
                <td class="ov-td">{{ r.draws }}</td>
                <td class="ov-td ov-negative">{{ r.losses }}</td>
                <td class="ov-td">{{ fmtWinrate(r.winrate) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Summary Metrics (like terminal output) -->
      <div class="ov-section">
        <div class="ov-section-toggle" style="cursor: default">
          <span class="ov-section-title">Summary Metrics</span>
        </div>
        <div class="ov-metrics-wrap">
          <table class="ov-metrics-table">
            <tbody>
              <template v-for="(row, i) in summaryMetrics" :key="i">
                <tr v-if="row.separator" class="ov-metrics-sep">
                  <td colspan="2"></td>
                </tr>
                <tr v-else-if="row.value === '' && row.label" class="ov-metrics-heading">
                  <td colspan="2">{{ row.label }}</td>
                </tr>
                <tr v-else class="ov-metrics-row">
                  <td class="ov-metrics-label">{{ row.label }}</td>
                  <td class="ov-metrics-value">{{ row.value }}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ── Section toggles ── */
.ov-section {
  margin-bottom: 4px;
}

.ov-section-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  background: none;
  border: none;
  color: var(--p-surface-200);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  width: 100%;
  text-align: left;
}
.ov-section-toggle:hover {
  color: var(--p-surface-50);
}

.ov-section-title {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ov-section-count {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--p-surface-400);
  background: var(--p-surface-700);
  padding: 1px 6px;
  border-radius: 8px;
}

/* ── Result tables ── */
.ov-table-wrap {
  border-radius: 6px;
  overflow-x: auto;
  border: 1px solid var(--p-surface-700);
}

.ov-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.78rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  white-space: nowrap;
}

.ov-th {
  padding: 5px 10px;
  text-align: right;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--p-surface-400);
  background: #181825;
  border-bottom: 1px solid var(--p-surface-700);
}
.ov-th-left { text-align: left; }

.ov-td {
  padding: 4px 10px;
  text-align: right;
  border-bottom: 1px solid #313244;
  font-variant-numeric: tabular-nums;
}
.ov-td-left { text-align: left; }

.ov-td-pair {
  color: #89b4fa;
  font-weight: 500;
}

.ov-table tbody tr {
  background: #1e1e2e;
  transition: background 0.1s;
}
.ov-table tbody tr:hover { background: #313244; }
.ov-table tbody tr:nth-child(even) { background: #1a1a2a; }
.ov-table tbody tr:nth-child(even):hover { background: #313244; }

.ov-row-total {
  background: #181825 !important;
  font-weight: 700;
  border-top: 2px solid var(--p-surface-600);
}
.ov-row-total .ov-td-pair { color: var(--p-surface-200); }

.ov-positive { color: #a6e3a1; }
.ov-negative { color: #f38ba8; }

/* ── Summary Metrics table ── */
.ov-metrics-wrap {
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--p-surface-700);
}

.ov-metrics-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.ov-metrics-row {
  background: #1e1e2e;
}
.ov-metrics-row:hover { background: #252535; }

.ov-metrics-label {
  padding: 3px 14px;
  color: var(--p-surface-300);
  width: 50%;
  border-right: 1px solid #313244;
}

.ov-metrics-value {
  padding: 3px 14px;
  color: var(--p-surface-100);
  font-variant-numeric: tabular-nums;
}

.ov-metrics-sep td {
  padding: 0;
  height: 6px;
  background: #181825;
}

.ov-metrics-heading td {
  padding: 5px 14px;
  font-weight: 700;
  color: var(--p-surface-200);
  background: #181825;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
