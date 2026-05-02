<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { RunListEntry } from '@/types';
import { RunType } from '@/types';
import { getVerdict, getVerdictText } from './metricThresholds';

const { t } = useI18n();
const store = useStrategyDevStore();

const currentRun = computed(() => store.selectedRun);
const compareRun = computed(() => store.compareRun);

const availableRuns = computed(() => {
  return store.allRunsFlat.filter(
    (r) => r.filename !== currentRun.value?.filename && r.run_type === currentRun.value?.run_type,
  );
});

function onSelectCompare(run: RunListEntry) {
  store.setCompareRun(run);
}

function clearCompare() {
  store.setCompareRun(null);
}

// ── Metrics extraction ──
interface MetricRow {
  key: string;
  label: string;
  format: (v: number) => string;
  valueA: number | null;
  valueB: number | null;
  delta: number | null;
  deltaGood: boolean | null;
}

function extractMetrics(run: RunListEntry | null, detail: Record<string, unknown> | null): Record<string, number | null> {
  const m: Record<string, number | null> = {};
  const rm = (detail?.best_epoch_metrics ?? {}) as Record<string, number>;
  const ss = (detail?.strategy_summary ?? {}) as Record<string, unknown>;

  m.best_loss = run?.best_loss ?? null;
  m.profit_total = rm.profit_total ?? asNum(ss.profit_total) ?? (run?.total_profit_pct != null ? run.total_profit_pct / 100 : null);
  m.total_trades = rm.total_trades ?? asNum(ss.total_trades) ?? run?.total_trades ?? null;
  m.sharpe = rm.sharpe ?? asNum(ss.sharpe) ?? run?.best_sharpe ?? null;
  m.max_drawdown_account = rm.max_drawdown_account ?? asNum(ss.max_drawdown_account) ?? asNum(ss.max_drawdown) ?? null;
  m.profit_factor = rm.profit_factor ?? asNum(ss.profit_factor) ?? null;
  m.winrate = rm.winrate ?? asNum(ss.winrate) ?? asNum(ss.win_rate) ?? null;
  m.sqn = rm.sqn ?? asNum(ss.sqn) ?? null;

  return m;
}

function asNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

const currentDetail = computed(() => {
  if (!currentRun.value) return null;
  if (currentRun.value.run_type === RunType.hyperopt) return store.hyperoptDetail;
  if (currentRun.value.run_type === RunType.wfa) return store.wfaDetail;
  if (currentRun.value.run_type === RunType.backtest) return store.backtestSnapshot as Record<string, unknown> | null;
  return null;
});

const metricDefs = computed(() => [
  { key: 'best_loss', label: t('strategyDev.metricBestLoss'), format: (v: number) => v.toFixed(5), higherBetter: false },
  { key: 'profit_total', label: t('strategyDev.metricTotalProfit'), format: (v: number) => `${(v * 100).toFixed(2)}%`, higherBetter: true },
  { key: 'total_trades', label: t('strategyDev.metricTrades'), format: (v: number) => String(Math.round(v)), higherBetter: true },
  { key: 'sharpe', label: t('strategyDev.metricSharpe'), format: (v: number) => v.toFixed(3), higherBetter: true },
  { key: 'max_drawdown_account', label: t('strategyDev.metricMaxDD'), format: (v: number) => `${(v * 100).toFixed(1)}%`, higherBetter: false },
  { key: 'profit_factor', label: t('strategyDev.metricProfitFactor'), format: (v: number) => v.toFixed(2), higherBetter: true },
  { key: 'winrate', label: t('strategyDev.metricWinRate'), format: (v: number) => `${(v * 100).toFixed(1)}%`, higherBetter: true },
  { key: 'sqn', label: t('strategyDev.metricSQN'), format: (v: number) => v.toFixed(2), higherBetter: true },
]);

const metricRows = computed<MetricRow[]>(() => {
  const metricsA = extractMetrics(currentRun.value, currentDetail.value);
  const metricsB = extractMetrics(compareRun.value, store.compareDetail);

  return metricDefs.value
    .filter((d) => metricsA[d.key] != null || metricsB[d.key] != null)
    .map((d) => {
      const va = metricsA[d.key];
      const vb = metricsB[d.key];
      let delta: number | null = null;
      let deltaGood: boolean | null = null;
      if (va != null && vb != null) {
        delta = va - vb;
        deltaGood = d.higherBetter ? delta > 0 : delta < 0;
      }
      return {
        key: d.key,
        label: d.label,
        format: d.format,
        valueA: va,
        valueB: vb,
        delta,
        deltaGood,
      };
    });
});

// ── Parameters diff ──
interface ParamDiff {
  key: string;
  space: string;
  valueA: unknown;
  valueB: unknown;
  changed: boolean;
}

const paramDiffs = computed<ParamDiff[]>(() => {
  const paramsA = (currentDetail.value?.best_params ?? currentDetail.value?.strategy_params ?? {}) as Record<string, Record<string, unknown>>;
  const paramsB = (store.compareDetail?.best_params ?? store.compareDetail?.strategy_params ?? {}) as Record<string, Record<string, unknown>>;

  const diffs: ParamDiff[] = [];
  const allSpaces = new Set([...Object.keys(paramsA), ...Object.keys(paramsB)]);

  for (const space of allSpaces) {
    const sa = paramsA[space] ?? {};
    const sb = paramsB[space] ?? {};
    if (typeof sa !== 'object' || typeof sb !== 'object') continue;

    const allKeys = new Set([...Object.keys(sa), ...Object.keys(sb)]);
    for (const key of allKeys) {
      const va = sa[key];
      const vb = sb[key];
      diffs.push({
        key,
        space,
        valueA: va ?? null,
        valueB: vb ?? null,
        changed: JSON.stringify(va) !== JSON.stringify(vb),
      });
    }
  }

  return diffs;
});

const changedParams = computed(() => paramDiffs.value.filter((d) => d.changed));
const unchangedParams = computed(() => paramDiffs.value.filter((d) => !d.changed));
const showUnchanged = ref(false);

function formatParam(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function runLabel(run: RunListEntry | null): string {
  if (!run) return '—';
  return `${run.strategy} (${new Date(run.timestamp * 1000).toLocaleDateString()})`;
}

// ── Search for compare target ──
const searchText = ref('');
const filteredCompareRuns = computed(() => {
  let runs = availableRuns.value;
  if (searchText.value) {
    const q = searchText.value.toLowerCase();
    runs = runs.filter(
      (r) => r.strategy.toLowerCase().includes(q) || r.filename.toLowerCase().includes(q),
    );
  }
  return runs.slice(0, 20);
});
</script>

<template>
  <div class="cmp sd-panel-enter">
    <!-- No compare target selected -->
    <div v-if="!compareRun" class="cmp-picker">
      <div class="cmp-picker-header">
        <i-mdi-compare-horizontal class="w-5 h-5 cmp-picker-icon" />
        <div>
          <h4 class="cmp-picker-title">
            {{ t('strategyDev.compareTitle') }}
            <span v-if="currentRun" class="cmp-type-filter">{{ currentRun.run_type }}</span>
          </h4>
          <p class="cmp-picker-desc">{{ t('strategyDev.compareDesc') }}</p>
        </div>
      </div>

      <div class="cmp-search-wrap">
        <i-mdi-magnify class="w-3.5 h-3.5 cmp-search-icon" />
        <input
          v-model="searchText"
          class="cmp-search-input"
          :placeholder="t('strategyDev.compareSearchPlaceholder')"
          spellcheck="false"
        />
      </div>

      <div class="cmp-run-list">
        <div
          v-for="run in filteredCompareRuns"
          :key="run.filename"
          class="cmp-run-item"
          @click="onSelectCompare(run)"
        >
          <div class="cmp-run-info">
            <span class="cmp-run-type">{{ run.run_type }}</span>
            <span class="cmp-run-strategy">{{ run.strategy }}</span>
          </div>
          <div class="cmp-run-meta">
            <span v-if="run.best_loss != null" class="cmp-run-metric">
              loss: {{ run.best_loss.toFixed(4) }}
            </span>
            <span v-if="run.total_profit_pct != null" class="cmp-run-metric">
              {{ run.total_profit_pct >= 0 ? '+' : '' }}{{ run.total_profit_pct.toFixed(1) }}%
            </span>
            <span class="cmp-run-date">
              {{ new Date(run.timestamp * 1000).toLocaleDateString() }}
            </span>
          </div>
        </div>
        <div v-if="filteredCompareRuns.length === 0" class="cmp-empty">
          {{ t('strategyDev.cvNoResults') }}
        </div>
      </div>
    </div>

    <!-- Compare view -->
    <div v-else class="cmp-view">
      <!-- Header with run labels -->
      <div class="cmp-header">
        <div class="cmp-header-run cmp-header-a">
          <span class="cmp-label">A</span>
          <span class="cmp-run-name">{{ runLabel(currentRun) }}</span>
        </div>
        <div class="cmp-header-vs">vs</div>
        <div class="cmp-header-run cmp-header-b">
          <span class="cmp-label">B</span>
          <span class="cmp-run-name">{{ runLabel(compareRun) }}</span>
          <button class="cmp-close-btn" @click="clearCompare">
            <i-mdi-close class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <!-- Metrics comparison table -->
      <div class="cmp-section">
        <h4 class="cmp-section-title">{{ t('strategyDev.compareMetrics') }}</h4>
        <div class="cmp-metrics-table-wrap">
          <table class="cmp-metrics-table">
            <thead>
              <tr>
                <th class="cmp-th">{{ t('strategyDev.compareMetric') }}</th>
                <th class="cmp-th cmp-th-val">A</th>
                <th class="cmp-th cmp-th-val">B</th>
                <th class="cmp-th cmp-th-val">{{ t('strategyDev.compareDelta') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in metricRows" :key="row.key" class="cmp-tr">
                <td class="cmp-td cmp-td-label">{{ row.label }}</td>
                <td class="cmp-td cmp-td-val">
                  <span
                    v-if="row.valueA != null"
                    :style="{ color: row.key !== 'total_trades' ? `var(--sd-${getVerdict(row.key, row.valueA) === 'good' ? 'success' : getVerdict(row.key, row.valueA) === 'bad' ? 'danger' : 'warning'})` : undefined }"
                  >
                    {{ row.format(row.valueA) }}
                  </span>
                  <span v-else class="cmp-na">—</span>
                </td>
                <td class="cmp-td cmp-td-val">
                  <span
                    v-if="row.valueB != null"
                    :style="{ color: row.key !== 'total_trades' ? `var(--sd-${getVerdict(row.key, row.valueB) === 'good' ? 'success' : getVerdict(row.key, row.valueB) === 'bad' ? 'danger' : 'warning'})` : undefined }"
                  >
                    {{ row.format(row.valueB) }}
                  </span>
                  <span v-else class="cmp-na">—</span>
                </td>
                <td class="cmp-td cmp-td-delta">
                  <span
                    v-if="row.delta != null"
                    class="cmp-delta"
                    :class="{ 'cmp-delta--good': row.deltaGood, 'cmp-delta--bad': row.deltaGood === false }"
                  >
                    {{ row.delta > 0 ? '+' : '' }}{{ row.format(row.delta) }}
                  </span>
                  <span v-else class="cmp-na">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Parameters diff -->
      <div v-if="paramDiffs.length > 0" class="cmp-section">
        <h4 class="cmp-section-title">
          {{ t('strategyDev.compareParams') }}
          <span v-if="changedParams.length > 0" class="cmp-changed-count">
            {{ changedParams.length }} {{ t('strategyDev.compareChanged') }}
          </span>
        </h4>

        <!-- Changed params -->
        <div v-if="changedParams.length > 0" class="cmp-params-table-wrap">
          <table class="cmp-params-table">
            <thead>
              <tr>
                <th class="cmp-th">{{ t('strategyDev.ppParameter') }}</th>
                <th class="cmp-th cmp-th-val">A</th>
                <th class="cmp-th cmp-th-val">B</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in changedParams" :key="d.key" class="cmp-tr cmp-tr--changed">
                <td class="cmp-td">
                  <span class="cmp-param-space">{{ d.space }}</span>
                  <span class="cmp-param-key">{{ d.key }}</span>
                </td>
                <td class="cmp-td cmp-td-val cmp-val-a">{{ formatParam(d.valueA) }}</td>
                <td class="cmp-td cmp-td-val cmp-val-b">{{ formatParam(d.valueB) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Toggle unchanged -->
        <button
          v-if="unchangedParams.length > 0"
          class="cmp-toggle-unchanged"
          @click="showUnchanged = !showUnchanged"
        >
          <i-mdi-chevron-down v-if="showUnchanged" class="w-3.5 h-3.5" />
          <i-mdi-chevron-right v-else class="w-3.5 h-3.5" />
          {{ unchangedParams.length }} {{ t('strategyDev.compareUnchanged') }}
        </button>

        <Transition name="cv-search">
          <div v-if="showUnchanged" class="cmp-params-table-wrap">
            <table class="cmp-params-table">
              <tbody>
                <tr v-for="d in unchangedParams" :key="d.key" class="cmp-tr">
                  <td class="cmp-td">
                    <span class="cmp-param-space">{{ d.space }}</span>
                    <span class="cmp-param-key">{{ d.key }}</span>
                  </td>
                  <td class="cmp-td cmp-td-val">{{ formatParam(d.valueA) }}</td>
                  <td class="cmp-td cmp-td-val">{{ formatParam(d.valueB) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cmp {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 0;
  max-width: 1200px;
  margin: 0 auto;
}

/* ── Picker ── */
.cmp-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cmp-picker-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.cmp-picker-icon {
  color: var(--sd-info);
  flex-shrink: 0;
  margin-top: 2px;
}

.cmp-picker-title {
  font-size: var(--sd-text-sm);
  font-weight: 700;
  color: var(--sd-text);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cmp-type-filter {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--sd-info);
  background: var(--sd-info-dim);
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.03em;
}

.cmp-picker-desc {
  font-size: var(--sd-text-xs);
  color: var(--sd-subtext);
  margin: 2px 0 0;
}

.cmp-search-wrap {
  display: flex;
  align-items: center;
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-md);
  padding: 0 10px;
  gap: 6px;
}

.cmp-search-wrap:focus-within {
  border-color: var(--sd-info);
}

.cmp-search-icon {
  color: var(--sd-overlay);
}

.cmp-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--sd-text);
  font-size: var(--sd-text-xs);
  padding: 8px 0;
}

.cmp-run-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 360px;
  overflow-y: auto;
}

.cmp-run-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: var(--sd-radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}
.cmp-run-item:hover {
  background: var(--sd-surface);
}

.cmp-run-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cmp-run-type {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--sd-overlay);
  background: var(--sd-surface);
  padding: 1px 5px;
  border-radius: 3px;
}

.cmp-run-strategy {
  font-size: var(--sd-text-xs);
  color: var(--sd-text);
  font-weight: 500;
}

.cmp-run-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cmp-run-metric {
  font-size: var(--sd-text-2xs);
  font-family: var(--sd-font-mono);
  color: var(--sd-subtext);
}

.cmp-run-date {
  font-size: var(--sd-text-2xs);
  color: var(--sd-overlay);
}

.cmp-empty {
  text-align: center;
  padding: 16px;
  font-size: var(--sd-text-xs);
  color: var(--sd-overlay);
}

/* ── Compare view ── */
.cmp-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cmp-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-md);
}

.cmp-header-run {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.cmp-header-vs {
  font-size: var(--sd-text-xs);
  font-weight: 700;
  color: var(--sd-overlay);
  text-transform: uppercase;
}

.cmp-label {
  font-size: 10px;
  font-weight: 700;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.cmp-header-a .cmp-label {
  background: var(--sd-info-dim);
  color: var(--sd-info);
}

.cmp-header-b .cmp-label {
  background: var(--sd-warning-dim);
  color: var(--sd-warning);
}

.cmp-run-name {
  font-size: var(--sd-text-xs);
  color: var(--sd-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cmp-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--sd-overlay);
  cursor: pointer;
  transition: all 0.15s;
  margin-left: auto;
  flex-shrink: 0;
}
.cmp-close-btn:hover {
  background: var(--sd-surface);
  color: var(--sd-text);
}

/* ── Sections ── */
.cmp-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cmp-section-title {
  font-size: var(--sd-text-sm);
  font-weight: 600;
  color: var(--sd-text);
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cmp-changed-count {
  font-size: var(--sd-text-2xs);
  font-weight: 500;
  color: var(--sd-warning);
  background: var(--sd-warning-dim);
  padding: 1px 6px;
  border-radius: 8px;
}

/* ── Metrics table ── */
.cmp-metrics-table-wrap, .cmp-params-table-wrap {
  border-radius: var(--sd-radius-md);
  overflow: hidden;
  border: 1px solid var(--sd-border-subtle);
}

.cmp-metrics-table, .cmp-params-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--sd-text-xs);
  font-family: var(--sd-font-mono);
}

.cmp-th {
  padding: 6px 12px;
  text-align: left;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--sd-overlay);
  background: #181825;
  border-bottom: 1px solid var(--sd-border-subtle);
}

.cmp-th-val {
  text-align: right;
  width: 120px;
}

.cmp-tr {
  background: #1e1e2e;
  transition: background 0.1s;
}
.cmp-tr:hover {
  background: #313244;
}
.cmp-tr:nth-child(even) { background: #1a1a2a; }
.cmp-tr:nth-child(even):hover { background: #313244; }

.cmp-tr--changed {
  background: rgba(249, 226, 175, 0.03) !important;
}

.cmp-td {
  padding: 5px 12px;
  border-bottom: 1px solid #313244;
}

.cmp-td-label {
  color: var(--sd-text);
  font-weight: 500;
}

.cmp-td-val {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.cmp-td-delta {
  text-align: right;
}

.cmp-na {
  color: var(--sd-overlay);
}

.cmp-delta {
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
}

.cmp-delta--good {
  color: var(--sd-success);
  background: var(--sd-success-dim);
}

.cmp-delta--bad {
  color: var(--sd-danger);
  background: var(--sd-danger-dim);
}

/* ── Params ── */
.cmp-param-space {
  font-size: 9px;
  color: var(--sd-overlay);
  margin-right: 6px;
}

.cmp-param-key {
  color: #89b4fa;
  font-weight: 500;
}

.cmp-val-a { color: var(--sd-info); }
.cmp-val-b { color: var(--sd-warning); }

.cmp-toggle-unchanged {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--sd-text-xs);
  color: var(--sd-subtext);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  transition: color 0.15s;
}
.cmp-toggle-unchanged:hover {
  color: var(--sd-text);
}

/* Transitions */
.cv-search-enter-active { transition: opacity 0.15s, transform 0.15s; }
.cv-search-leave-active { transition: opacity 0.1s; }
.cv-search-enter-from { opacity: 0; transform: translateY(-4px); }
.cv-search-leave-to { opacity: 0; }
</style>
