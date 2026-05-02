<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  summary: Record<string, unknown>;
}>();

const roiEntries = computed(() => {
  const roi = props.summary.minimal_roi;
  if (!roi || typeof roi !== 'object') return [];
  return Object.entries(roi as Record<string, number>)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([k, v]) => ({ minutes: Number(k), pct: v }));
});

const trailingConfig = computed(() => {
  const s = props.summary;
  if (!s.trailing_stop) return null;
  return {
    enabled: Boolean(s.trailing_stop),
    positive: s.trailing_stop_positive,
    offset: s.trailing_stop_positive_offset,
  };
});

function fmtPct(v: unknown): string {
  const n = Number(v);
  if (isNaN(n)) return '—';
  return `${(n * 100).toFixed(2)}%`;
}
</script>

<template>
  <div class="config-grid">
    <!-- General -->
    <div class="config-card">
      <h4 class="config-title">{{ t('strategyDev.btConfigGeneral') }}</h4>
      <div class="config-rows">
        <div class="config-row">
          <span class="config-key">{{ t('strategyDev.btConfigTimeframe') }}</span>
          <span class="config-val">{{ summary.timeframe ?? '—' }}</span>
        </div>
        <div class="config-row">
          <span class="config-key">{{ t('strategyDev.btConfigTimerange') }}</span>
          <span class="config-val">{{ summary.timerange ?? '—' }}</span>
        </div>
        <div class="config-row">
          <span class="config-key">{{ t('strategyDev.btConfigMaxOpenTrades') }}</span>
          <span class="config-val">{{ summary.max_open_trades ?? '—' }}</span>
        </div>
        <div class="config-row">
          <span class="config-key">{{ t('strategyDev.btConfigDays') }}</span>
          <span class="config-val">{{ summary.backtest_days ?? '—' }}</span>
        </div>
        <div v-if="summary.backtest_start" class="config-row">
          <span class="config-key">{{ t('strategyDev.btConfigStart') }}</span>
          <span class="config-val">{{ summary.backtest_start }}</span>
        </div>
        <div v-if="summary.backtest_end" class="config-row">
          <span class="config-key">{{ t('strategyDev.btConfigEnd') }}</span>
          <span class="config-val">{{ summary.backtest_end }}</span>
        </div>
      </div>
    </div>

    <!-- Stoploss -->
    <div class="config-card">
      <h4 class="config-title">{{ t('strategyDev.btConfigStoploss') }}</h4>
      <div class="config-rows">
        <div class="config-row">
          <span class="config-key">Stoploss</span>
          <span class="config-val sl-val">{{ fmtPct(summary.stoploss) }}</span>
        </div>
        <template v-if="trailingConfig">
          <div class="config-row">
            <span class="config-key">{{ t('strategyDev.btConfigTrailing') }}</span>
            <span class="config-val">{{ trailingConfig.enabled ? '✓' : '✗' }}</span>
          </div>
          <div v-if="trailingConfig.positive != null" class="config-row">
            <span class="config-key">{{ t('strategyDev.btConfigTrailingPositive') }}</span>
            <span class="config-val">{{ fmtPct(trailingConfig.positive) }}</span>
          </div>
          <div v-if="trailingConfig.offset != null" class="config-row">
            <span class="config-key">{{ t('strategyDev.btConfigTrailingOffset') }}</span>
            <span class="config-val">{{ fmtPct(trailingConfig.offset) }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- ROI -->
    <div v-if="roiEntries.length > 0" class="config-card">
      <h4 class="config-title">{{ t('strategyDev.btConfigRoi') }}</h4>
      <table class="roi-table">
        <thead>
          <tr>
            <th>{{ t('strategyDev.btConfigRoiMinutes') }}</th>
            <th>{{ t('strategyDev.btConfigRoiReturn') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in roiEntries" :key="entry.minutes">
            <td>{{ entry.minutes }}</td>
            <td>{{ fmtPct(entry.pct) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Market context -->
    <div class="config-card">
      <h4 class="config-title">{{ t('strategyDev.btConfigMarket') }}</h4>
      <div class="config-rows">
        <div v-if="summary.market_change != null" class="config-row">
          <span class="config-key">{{ t('strategyDev.btMarketChange') }}</span>
          <span
            class="config-val"
            :class="Number(summary.market_change) >= 0 ? 'text-green' : 'text-red'"
          >
            {{ fmtPct(summary.market_change) }}
          </span>
        </div>
        <div v-if="summary.final_balance != null" class="config-row">
          <span class="config-key">{{ t('strategyDev.btFinalBalance') }}</span>
          <span class="config-val">{{ Number(summary.final_balance).toFixed(2) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem;
}

.config-card {
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: rgba(30, 30, 46, 0.5);
  border: 1px solid rgba(69, 71, 90, 0.25);
}

.config-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #89b4fa;
  margin: 0 0 0.5rem 0;
}

.config-rows {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.config-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.25rem 0;
}

.config-key {
  font-size: 12px;
  color: #6c7086;
}

.config-val {
  font-family: var(--sd-font-mono);
  font-size: 12px;
  font-weight: 600;
  color: #cdd6f4;
}

.sl-val {
  color: #f38ba8;
}

.text-green { color: #a6e3a1; }
.text-red { color: #f38ba8; }

.roi-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.roi-table th {
  text-align: left;
  padding: 0.25rem 0.5rem;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: #6c7086;
  border-bottom: 1px solid rgba(69, 71, 90, 0.3);
}

.roi-table td {
  padding: 0.25rem 0.5rem;
  font-family: var(--sd-font-mono);
  color: #cdd6f4;
  border-bottom: 1px solid rgba(69, 71, 90, 0.15);
}
</style>
