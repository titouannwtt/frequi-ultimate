<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();
const leftData = ref<Record<string, unknown> | null>(null);
const rightData = ref<Record<string, unknown> | null>(null);
const loading = ref(false);

const topEpochs = computed(() => {
  const a = store.hyperoptAnalysis;
  if (!a) return [];
  const top = a.top_epochs as Array<Record<string, unknown>> | undefined;
  return top?.slice(0, 10) ?? [];
});

const leftRank = computed({
  get: () => store.compareEpochRanks[0],
  set: (v) => { store.compareEpochRanks = [v, store.compareEpochRanks[1]]; },
});

const rightRank = computed({
  get: () => store.compareEpochRanks[1],
  set: (v) => { store.compareEpochRanks = [store.compareEpochRanks[0], v]; },
});

async function loadBoth() {
  const filename = store.selectedRun?.filename;
  if (!filename) return;
  loading.value = true;
  try {
    const [l, r] = await Promise.all([
      store.fetchEpochAdvancedAnalytics(filename, leftRank.value),
      store.fetchEpochAdvancedAnalytics(filename, rightRank.value),
    ]);
    leftData.value = l;
    rightData.value = r;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (topEpochs.value.length >= 2) loadBoth();
});

watch([leftRank, rightRank], () => loadBoth());

const leftInfo = computed(() => leftData.value?.epoch_info as Record<string, unknown> | undefined);
const rightInfo = computed(() => rightData.value?.epoch_info as Record<string, unknown> | undefined);

interface MetricRow {
  label: string;
  left: string;
  right: string;
  better: 'left' | 'right' | 'equal';
}

const metricRows = computed<MetricRow[]>(() => {
  if (!leftInfo.value || !rightInfo.value) return [];
  const li = leftInfo.value;
  const ri = rightInfo.value;

  function cmp(a: unknown, b: unknown, higherBetter = true): 'left' | 'right' | 'equal' {
    const na = Number(a), nb = Number(b);
    if (isNaN(na) || isNaN(nb) || na === nb) return 'equal';
    if (higherBetter) return na > nb ? 'left' : 'right';
    return na < nb ? 'left' : 'right';
  }

  function fmtPct(v: unknown): string {
    const n = Number(v);
    if (isNaN(n)) return '—';
    return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
  }

  function fmtNum(v: unknown, d = 2): string {
    const n = Number(v);
    return isNaN(n) ? '—' : n.toFixed(d);
  }

  return [
    { label: 'Profit', left: fmtPct(li.total_profit), right: fmtPct(ri.total_profit), better: cmp(li.total_profit, ri.total_profit) },
    { label: 'Trades', left: String(li.total_trades), right: String(ri.total_trades), better: cmp(li.total_trades, ri.total_trades) },
    { label: 'Drawdown', left: fmtPct(li.max_drawdown), right: fmtPct(ri.max_drawdown), better: cmp(li.max_drawdown, ri.max_drawdown, false) },
    { label: 'Sharpe', left: fmtNum(li.sharpe), right: fmtNum(ri.sharpe), better: cmp(li.sharpe, ri.sharpe) },
    { label: 'Sortino', left: fmtNum(li.sortino), right: fmtNum(ri.sortino), better: cmp(li.sortino, ri.sortino) },
    { label: 'Profit Factor', left: fmtNum(li.profit_factor), right: fmtNum(ri.profit_factor), better: cmp(li.profit_factor, ri.profit_factor) },
    { label: 'Win Rate', left: fmtPct(li.winrate), right: fmtPct(ri.winrate), better: cmp(li.winrate, ri.winrate) },
    { label: 'Loss', left: fmtNum(li.loss, 4), right: fmtNum(ri.loss, 4), better: cmp(li.loss, ri.loss, false) },
  ];
});

const paramDiff = computed(() => {
  if (!leftData.value || !rightData.value) return [];
  const lp = (leftData.value.params_dict ?? {}) as Record<string, unknown>;
  const rp = (rightData.value.params_dict ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(lp), ...Object.keys(rp)])].sort();
  return keys.map((k) => ({
    name: k,
    left: lp[k] ?? '—',
    right: rp[k] ?? '—',
    diff: lp[k] !== rp[k],
  }));
});
</script>

<template>
  <div class="compare-panel">
    <!-- Selectors -->
    <div class="compare-selectors">
      <div class="compare-side">
        <label>{{ t('strategyDev.compareLeft') }}</label>
        <select v-model.number="leftRank" class="compare-select">
          <option v-for="ep in topEpochs" :key="(ep.rank as number)" :value="ep.rank">
            #{{ ep.rank }} — {{ ((ep.profit_pct as number) >= 0 ? '+' : '') }}{{ (ep.profit_pct as number).toFixed(1) }}%
          </option>
        </select>
      </div>
      <div class="compare-vs">vs</div>
      <div class="compare-side">
        <label>{{ t('strategyDev.compareRight') }}</label>
        <select v-model.number="rightRank" class="compare-select">
          <option v-for="ep in topEpochs" :key="(ep.rank as number)" :value="ep.rank">
            #{{ ep.rank }} — {{ ((ep.profit_pct as number) >= 0 ? '+' : '') }}{{ (ep.profit_pct as number).toFixed(1) }}%
          </option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="py-6">
      <SkeletonPanel variant="cards" :cols="4" />
    </div>

    <template v-else-if="leftInfo && rightInfo">
      <!-- Metrics diff table -->
      <div class="diff-table-wrap">
        <table class="diff-table">
          <thead>
            <tr>
              <th>{{ t('strategyDev.compareMetric') }}</th>
              <th>{{ t('strategyDev.compareRankN', { n: leftRank }) }}</th>
              <th>{{ t('strategyDev.compareRankN', { n: rightRank }) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in metricRows" :key="row.label">
              <td class="dt-label">{{ row.label }}</td>
              <td class="dt-val" :class="{ 'dt-better': row.better === 'left' }">{{ row.left }}</td>
              <td class="dt-val" :class="{ 'dt-better': row.better === 'right' }">{{ row.right }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Params diff -->
      <div v-if="paramDiff.length" class="diff-table-wrap mt-4">
        <h4 class="diff-section-title">{{ t('strategyDev.compareParams') }}</h4>
        <table class="diff-table">
          <thead>
            <tr>
              <th>{{ t('strategyDev.compareParameter') }}</th>
              <th>{{ t('strategyDev.compareRankN', { n: leftRank }) }}</th>
              <th>{{ t('strategyDev.compareRankN', { n: rightRank }) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in paramDiff" :key="p.name" :class="{ 'dt-diff-row': p.diff }">
              <td class="dt-label">{{ p.name }}</td>
              <td class="dt-val">{{ p.left }}</td>
              <td class="dt-val">{{ p.right }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Side-by-side equity curves -->
      <div v-if="leftData?.equity_curve && rightData?.equity_curve" class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <ChartWrapper :title="`${t('strategyDev.aaEquityCurve')} — ${t('strategyDev.compareRankN', { n: leftRank })}`" chart-id="cmp-equity-l">
          <EquityCurveChart
            :equity="leftData.equity_curve as any[]"
            :starting-balance="(leftData.starting_balance as number) ?? 1000"
          />
        </ChartWrapper>
        <ChartWrapper :title="`${t('strategyDev.aaEquityCurve')} — ${t('strategyDev.compareRankN', { n: rightRank })}`" chart-id="cmp-equity-r">
          <EquityCurveChart
            :equity="rightData.equity_curve as any[]"
            :starting-balance="(rightData.starting_balance as number) ?? 1000"
          />
        </ChartWrapper>
      </div>

      <!-- Side-by-side trade PnL -->
      <div v-if="leftData?.trade_pnl_distribution && rightData?.trade_pnl_distribution" class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <ChartWrapper :title="`${t('strategyDev.aaTradePnl')} — ${t('strategyDev.compareRankN', { n: leftRank })}`" chart-id="cmp-pnl-l">
          <TradePnlChart :distribution="leftData.trade_pnl_distribution as any" />
        </ChartWrapper>
        <ChartWrapper :title="`${t('strategyDev.aaTradePnl')} — ${t('strategyDev.compareRankN', { n: rightRank })}`" chart-id="cmp-pnl-r">
          <TradePnlChart :distribution="rightData.trade_pnl_distribution as any" />
        </ChartWrapper>
      </div>
    </template>
  </div>
</template>

<style scoped>
.compare-panel {
  padding: 0.75rem 0;
}

.compare-selectors {
  display: flex;
  align-items: end;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.compare-side {
  flex: 1;
}

.compare-side label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6c7086;
  margin-bottom: 0.375rem;
}

.compare-select {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: rgba(49, 50, 68, 0.6);
  border: 1px solid rgba(69, 71, 90, 0.5);
  color: #cdd6f4;
  font-family: var(--sd-font-mono);
  font-size: 12px;
  cursor: pointer;
}

.compare-vs {
  font-size: 12px;
  font-weight: 700;
  color: #6c7086;
  padding-bottom: 0.5rem;
}

.diff-table-wrap {
  border-radius: 0.625rem;
  background: rgba(30, 30, 46, 0.6);
  border: 1px solid rgba(69, 71, 90, 0.3);
  overflow: hidden;
}

.diff-section-title {
  padding: 0.625rem 0.75rem 0;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #89b4fa;
  margin: 0;
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.diff-table th {
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6c7086;
  border-bottom: 1px solid rgba(69, 71, 90, 0.3);
}

.diff-table td {
  padding: 0.375rem 0.75rem;
  border-bottom: 1px solid rgba(69, 71, 90, 0.15);
}

.dt-label {
  color: #a6adc8;
  font-weight: 500;
}

.dt-val {
  font-family: var(--sd-font-mono);
  color: #cdd6f4;
}

.dt-better {
  color: #a6e3a1;
  font-weight: 700;
}

.dt-diff-row {
  background: rgba(250, 179, 135, 0.05);
}

.dt-diff-row .dt-val {
  color: #fab387;
}
</style>
