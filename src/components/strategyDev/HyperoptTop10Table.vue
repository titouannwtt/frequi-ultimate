<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps<{
  epochs: Record<string, unknown>[];
}>();

const expandedRows = ref<Record<string, boolean>>({});
const visibleMetrics = ref<Set<number>>(new Set());

function toggleMetrics(rank: number) {
  const copy = new Set(visibleMetrics.value);
  if (copy.has(rank)) {
    copy.delete(rank);
  } else {
    copy.add(rank);
  }
  visibleMetrics.value = copy;
}

const epochMetricKeys = computed(() => [
  { key: 'profit_total_abs', label: t('strategyDev.metricProfitAbs'), fmt: (v: number) => v.toFixed(2) },
  { key: 'profit_total', label: t('strategyDev.metricProfitPct'), fmt: (v: number) => `${(v * 100).toFixed(2)}%` },
  { key: 'total_trades', label: t('strategyDev.metricTrades'), fmt: (v: number) => String(Math.round(v)) },
  { key: 'sharpe', label: t('strategyDev.metricSharpe'), fmt: (v: number) => v.toFixed(3) },
  { key: 'sortino', label: t('strategyDev.metricSortino'), fmt: (v: number) => v.toFixed(3) },
  { key: 'calmar', label: t('strategyDev.metricCalmar'), fmt: (v: number) => v.toFixed(3) },
  { key: 'max_drawdown_account', label: t('strategyDev.metricMaxDD'), fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
  { key: 'profit_factor', label: t('strategyDev.metricProfitFactor'), fmt: (v: number) => v.toFixed(2) },
  { key: 'winrate', label: t('strategyDev.metricWinRate'), fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
  { key: 'expectancy_ratio', label: t('strategyDev.metricExpectancy'), fmt: (v: number) => v.toFixed(3) },
  { key: 'sqn', label: t('strategyDev.metricSQN'), fmt: (v: number) => v.toFixed(2) },
  { key: 'avg_profit', label: t('strategyDev.metricAvgProfit'), fmt: (v: number) => `${v.toFixed(2)}%` },
  { key: 'holding_avg', label: t('strategyDev.metricAvgDuration'), fmt: (v: number) => `${v.toFixed(0)}m` },
]);

function getMetrics(epoch: Record<string, unknown>): Record<string, number> {
  const rm = (epoch.results_metrics as Record<string, number>) ?? {};
  // Fallback: build from top-level epoch fields if results_metrics is empty
  if (Object.keys(rm).length === 0) {
    return {
      profit_total: ((epoch.profit_pct as number) ?? 0) / 100,
      profit_total_abs: 0,
      total_trades: (epoch.trades as number) ?? 0,
      sharpe: (epoch.sharpe as number) ?? 0,
      max_drawdown_account: ((epoch.dd_pct as number) ?? 0) / 100,
      winrate: ((epoch.winrate as number) ?? 0) / 100,
      loss: (epoch.loss as number) ?? 0,
    };
  }
  return rm;
}
</script>

<template>
  <div>
    <h4 class="text-sm font-semibold mb-2">{{ t('strategyDev.t10Title') }}</h4>
    <DataTable
      v-model:expanded-rows="expandedRows"
      :value="epochs"
      size="small"
      show-gridlines
      bordered
      data-key="rank"
    >
      <Column expander style="width: 2rem" />
      <Column field="rank" :header="t('strategyDev.columnRank')" style="width: 3rem" />
      <Column field="loss" :header="t('strategyDev.metricLoss')" sortable>
        <template #body="{ data }">
          {{ (data as Record<string, unknown>).loss }}
        </template>
      </Column>
      <Column field="profit_pct" :header="t('strategyDev.metricProfitPct')" sortable>
        <template #body="{ data }">
          <span
            :class="{
              'text-green-500': ((data as Record<string, unknown>).profit_pct as number) > 0,
              'text-red-500': ((data as Record<string, unknown>).profit_pct as number) < 0,
            }"
          >
            {{ (data as Record<string, unknown>).profit_pct }}%
          </span>
        </template>
      </Column>
      <Column field="trades" :header="t('strategyDev.metricTrades')" sortable />
      <Column field="sharpe" :header="t('strategyDev.metricSharpe')" sortable />
      <Column field="dd_pct" :header="t('strategyDev.metricMaxDD')" sortable>
        <template #body="{ data }">
          {{ (data as Record<string, unknown>).dd_pct }}%
        </template>
      </Column>
      <Column field="winrate" :header="t('strategyDev.metricWinRate')" sortable>
        <template #body="{ data }">
          {{ (data as Record<string, unknown>).winrate }}%
        </template>
      </Column>
      <template #expansion="{ data }">
        <div class="t10-expansion">
          <h5 class="text-sm font-semibold mb-1">{{ t('strategyDev.t10Parameters') }}</h5>
          <JsonViewer :data="(data as Record<string, unknown>).params as Record<string, unknown>" />

          <div class="t10-epoch-detail">
            <button
              v-if="!visibleMetrics.has((data as Record<string, unknown>).rank as number)"
              class="t10-load-btn"
              @click="toggleMetrics((data as Record<string, unknown>).rank as number)"
            >
              <i-mdi-chart-box-outline class="w-4 h-4" />
              {{ t('strategyDev.t10ViewMetrics') }}
              <i-mdi-chevron-right class="w-4 h-4" />
            </button>
            <template v-else>
              <div class="t10-metrics-header">
                <h5 class="text-sm font-semibold">{{ t('strategyDev.t10EpochMetrics') }}</h5>
                <button class="t10-collapse-btn" @click="toggleMetrics((data as Record<string, unknown>).rank as number)">
                  <i-mdi-chevron-up class="w-4 h-4" />
                </button>
              </div>
              <div class="t10-metrics-grid">
                <div
                  v-for="mk in epochMetricKeys"
                  :key="mk.key"
                  class="t10-metric-card"
                >
                  <span class="t10-metric-label">{{ mk.label }}</span>
                  <span class="t10-metric-value">
                    {{ getMetrics(data as Record<string, unknown>)[mk.key] != null
                      ? mk.fmt(getMetrics(data as Record<string, unknown>)[mk.key])
                      : '—' }}
                  </span>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>
    </DataTable>
  </div>
</template>

<style scoped>
.t10-expansion {
  padding: 12px;
}

.t10-epoch-detail {
  margin-top: 12px;
}

.t10-load-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-md);
  color: var(--sd-subtext);
  font-size: var(--sd-text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--sd-transition-fast);
}
.t10-load-btn:hover {
  background: var(--sd-surface0);
  border-color: var(--sd-border);
  color: var(--sd-text);
}

.t10-metrics-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.t10-collapse-btn {
  background: none;
  border: none;
  color: var(--sd-subtext);
  cursor: pointer;
  padding: 2px;
  border-radius: var(--sd-radius-sm);
}
.t10-collapse-btn:hover {
  color: var(--sd-text);
  background: var(--sd-surface0);
}

.t10-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.t10-metric-card {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-md);
}

.t10-metric-label {
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sd-overlay);
}

.t10-metric-value {
  font-size: var(--sd-text-base);
  font-weight: 700;
  font-family: var(--sd-font-mono);
  margin-top: 2px;
  color: var(--sd-text);
}
</style>
