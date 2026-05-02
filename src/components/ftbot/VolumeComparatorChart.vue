<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  MarkAreaComponent,
} from 'echarts/components';

use([
  BarChart,
  LineChart,
  CanvasRenderer,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  MarkAreaComponent,
]);

const { t } = useI18n();
const settingsStore = useSettingsStore();

const props = defineProps<{
  multiBotView?: boolean;
}>();

const {
  selectedDays,
  selectedBucket,
  daysOptions,
  bucketOptions,
  loading,
  mergedData,
  anomalyDates,
  correlation,
  avgVolumeRatio,
  avgProfitPerVolume,
  secondsSinceRefresh,
  hasData,
  fetchData,
} = useVolumeComparator({
  multiBotView: props.multiBotView ?? false,
  defaultDays: 90,
  defaultBucket: '1d',
  refreshMs: 300000,
});

const showTradeCount = ref(false);
const showProfit = ref(false);
const showAnomalies = ref(true);
const showVolumeRatio = ref(false);

const BLUE = '#89b4fa';
const GREEN = '#a6e3a1';
const YELLOW = '#f9e2af';
const MAUVE = '#cba6f7';
const RED = '#f38ba8';
const PEACH = '#fab387';
const TEXT = '#cdd6f4';
const SUBTEXT = '#bac2de';
const GRID_COLOR = '#313244';
const SURFACE = '#1e1e2e';

function formatVolume(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function formatDateLabel(d: string, bucket: string): string {
  const date = new Date(d);
  if (bucket === '1Q') {
    const q = Math.floor(date.getMonth() / 3) + 1;
    return `Q${q} ${date.getFullYear()}`;
  }
  if (bucket === '1M') {
    return date.toLocaleDateString('en', { month: 'short', year: '2-digit' });
  }
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

const chartOptions = computed((): EChartsOption => {
  const data = mergedData.value;
  if (!data || data.buckets.length === 0) return {};

  const bucket = selectedBucket.value;
  const dates = data.buckets.map((b) => formatDateLabel(b.date, bucket));
  const rawDates = data.buckets.map((b) => b.date);
  const exchangeVol = data.buckets.map((b) => b.exchange_volume);
  const botVol = data.buckets.map((b) => b.bot_volume);
  const tradeCounts = data.buckets.map((b) => b.trade_count);
  const profits = data.buckets.map((b) => b.abs_profit);
  const volRatios = data.buckets.map((b) =>
    b.exchange_volume > 0 ? (b.bot_volume / b.exchange_volume) * 100 : 0,
  );

  const anomalyAreas: [{ xAxis: string }, { xAxis: string }][] = [];
  if (showAnomalies.value) {
    for (let i = 0; i < rawDates.length; i++) {
      if (anomalyDates.value.has(rawDates[i])) {
        anomalyAreas.push([{ xAxis: dates[i] }, { xAxis: dates[i] }]);
      }
    }
  }

  const needsExtraAxis = showTradeCount.value || showProfit.value || showVolumeRatio.value;

  const yAxes: Record<string, unknown>[] = [
    {
      type: 'value',
      name: `${t('volumeComparator.exchangeVolume')} (${data.stake_currency})`,
      nameTextStyle: { color: BLUE, fontSize: 10 },
      position: 'left',
      axisLabel: { color: BLUE, fontSize: 9, formatter: formatVolume },
      splitLine: { lineStyle: { color: GRID_COLOR, type: 'dashed' } },
    },
    {
      type: 'value',
      name: `${t('volumeComparator.botVolume')} (${data.stake_currency})`,
      nameTextStyle: { color: GREEN, fontSize: 10 },
      position: 'right',
      axisLabel: { color: GREEN, fontSize: 9, formatter: formatVolume },
      splitLine: { show: false },
    },
  ];

  if (needsExtraAxis) {
    yAxes.push({
      type: 'value',
      position: 'right',
      offset: 55,
      axisLabel: { color: YELLOW, fontSize: 9 },
      splitLine: { show: false },
    });
  }

  const series: Record<string, unknown>[] = [
    {
      name: t('volumeComparator.exchangeVolume'),
      type: 'bar',
      yAxisIndex: 0,
      data: exchangeVol,
      itemStyle: { color: 'rgba(137, 180, 250, 0.5)' },
      barWidth: '45%',
      barGap: '-100%',
      z: 1,
      markArea:
        anomalyAreas.length > 0
          ? {
              silent: true,
              itemStyle: { color: 'rgba(243, 139, 168, 0.12)' },
              data: anomalyAreas,
            }
          : undefined,
    },
    {
      name: t('volumeComparator.botVolume'),
      type: 'bar',
      yAxisIndex: 1,
      data: botVol,
      itemStyle: { color: 'rgba(166, 227, 161, 0.7)' },
      barWidth: '22%',
      barGap: '-100%',
      z: 2,
    },
  ];

  if (showTradeCount.value) {
    series.push({
      name: t('volumeComparator.tradeCount'),
      type: 'line',
      yAxisIndex: 2,
      data: tradeCounts,
      lineStyle: { color: YELLOW, width: 2 },
      itemStyle: { color: YELLOW },
      symbol: 'circle',
      symbolSize: 3,
      z: 3,
    });
  }

  if (showProfit.value) {
    series.push({
      name: t('volumeComparator.profit'),
      type: 'line',
      yAxisIndex: needsExtraAxis ? 2 : 1,
      data: profits,
      lineStyle: { color: MAUVE, width: 2 },
      itemStyle: { color: MAUVE },
      areaStyle: { color: 'rgba(203, 166, 247, 0.08)' },
      symbol: 'circle',
      symbolSize: 3,
      z: 3,
    });
  }

  if (showVolumeRatio.value) {
    series.push({
      name: t('volumeComparator.volumeRatio'),
      type: 'line',
      yAxisIndex: needsExtraAxis ? 2 : 1,
      data: volRatios,
      lineStyle: { color: PEACH, width: 2, type: 'dashed' },
      itemStyle: { color: PEACH },
      symbol: 'none',
      z: 3,
    });
  }

  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    animation: true,
    animationDuration: 500,
    tooltip: {
      trigger: 'axis',
      backgroundColor: SURFACE,
      borderColor: GRID_COLOR,
      textStyle: { color: TEXT, fontSize: 11 },
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const items = params as { seriesName: string; value: number; marker: string }[];
        if (!items || !items.length) return '';
        const idx = (params as { dataIndex: number }[])[0]?.dataIndex;
        const isAnomaly = idx !== undefined && anomalyDates.value.has(rawDates[idx]);
        let html = `<div style="font-weight:600;margin-bottom:4px">${dates[idx ?? 0]}${isAnomaly ? ' <span style="color:#f38ba8">⚠ anomaly</span>' : ''}</div>`;
        for (const item of items) {
          const val =
            item.seriesName.includes('Volume') || item.seriesName.includes('Profit')
              ? formatVolume(item.value)
              : item.value?.toFixed?.(2) ?? item.value;
          html += `<div>${item.marker} ${item.seriesName}: <b>${val}</b></div>`;
        }
        return html;
      },
    },
    legend: {
      type: 'scroll',
      bottom: 25,
      textStyle: { color: SUBTEXT, fontSize: 10 },
      pageTextStyle: { color: SUBTEXT },
    },
    grid: {
      left: 70,
      right: needsExtraAxis ? 120 : 65,
      top: 35,
      bottom: 70,
    },
    xAxis: [
      {
        type: 'category',
        data: dates,
        axisLabel: {
          color: SUBTEXT,
          fontSize: 9,
          rotate: dates.length > 30 ? 45 : 0,
        },
        axisLine: { lineStyle: { color: GRID_COLOR } },
        splitLine: { show: false },
      },
    ],
    yAxis: yAxes,
    dataZoom: [
      { type: 'inside', xAxisIndex: 0 },
      {
        type: 'slider',
        xAxisIndex: 0,
        bottom: 2,
        height: 18,
        borderColor: GRID_COLOR,
        backgroundColor: 'rgba(30, 30, 46, 0.8)',
        fillerColor: 'rgba(137, 180, 250, 0.15)',
        textStyle: { color: SUBTEXT, fontSize: 9 },
      },
    ],
    series,
  };
});

const refreshLabel = computed(() => {
  const s = secondsSinceRefresh.value;
  if (s === Infinity) return '';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
});
</script>

<template>
  <div class="vc-container">
    <!-- Controls -->
    <div class="vc-controls">
      <div class="vc-controls-left">
        <!-- Days selector -->
        <div class="vc-btn-group">
          <button
            v-for="opt in daysOptions"
            :key="opt.value"
            class="vc-btn"
            :class="{ 'vc-btn--active': selectedDays === opt.value }"
            @click="selectedDays = opt.value"
          >
            {{ opt.text }}
          </button>
        </div>

        <!-- Bucket selector -->
        <div class="vc-btn-group">
          <button
            v-for="opt in bucketOptions"
            :key="opt.value"
            class="vc-btn"
            :class="{ 'vc-btn--active': selectedBucket === opt.value }"
            @click="selectedBucket = opt.value"
          >
            {{ opt.text }}
          </button>
        </div>

        <!-- Toggles -->
        <div class="vc-toggles">
          <label class="vc-toggle">
            <input v-model="showTradeCount" type="checkbox" />
            <span>{{ t('volumeComparator.tradeCount') }}</span>
          </label>
          <label class="vc-toggle">
            <input v-model="showProfit" type="checkbox" />
            <span>{{ t('volumeComparator.profit') }}</span>
          </label>
          <label class="vc-toggle">
            <input v-model="showAnomalies" type="checkbox" />
            <span>{{ t('volumeComparator.anomalies') }}</span>
          </label>
          <label class="vc-toggle">
            <input v-model="showVolumeRatio" type="checkbox" />
            <span>{{ t('volumeComparator.volumeRatio') }}</span>
          </label>
        </div>
      </div>

      <div class="vc-controls-right">
        <span v-if="mergedData" class="vc-coverage">
          {{ mergedData.data_coverage_pct.toFixed(0) }}% {{ t('volumeComparator.coverage') }}
        </span>
        <span v-if="refreshLabel" class="vc-refresh">{{ refreshLabel }}</span>
      </div>
    </div>

    <!-- Chart -->
    <div class="vc-chart-area">
      <div v-if="loading && !hasData" class="vc-empty">
        <div class="vc-spinner" />
        <span>{{ t('volumeComparator.loading') }}</span>
      </div>
      <div v-else-if="!hasData" class="vc-empty">
        <i-mdi-chart-bar class="vc-empty-icon" />
        <span>{{ t('volumeComparator.noData') }}</span>
        <button class="vc-retry-btn" @click="fetchData">
          <i-mdi-refresh class="w-3.5 h-3.5" /> Retry
        </button>
      </div>
      <ECharts
        v-else
        :option="chartOptions"
        :theme="settingsStore.chartTheme"
        style="width: 100%; height: 100%"
        autoresize
      />
    </div>

    <!-- Footer stats -->
    <div v-if="hasData" class="vc-footer">
      <span v-if="correlation !== null" class="vc-stat">
        <b>ρ</b> = {{ correlation.toFixed(2) }}
      </span>
      <span v-if="avgVolumeRatio !== null" class="vc-stat">
        Avg ratio: {{ avgVolumeRatio.toFixed(3) }}%
      </span>
      <span v-if="avgProfitPerVolume !== null" class="vc-stat">
        {{ t('volumeComparator.profitPerVol') }}: {{ avgProfitPerVolume.toFixed(2) }}%
      </span>
      <span v-if="mergedData" class="vc-stat">
        {{ mergedData.whitelist_count }} pairs · {{ mergedData.exchange_name }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.vc-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* ── Controls ── */
.vc-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.vc-controls-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.vc-controls-right {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--bs-body-color, #a6adc8);
  opacity: 0.7;
}

.vc-btn-group {
  display: flex;
  gap: 1px;
  background: rgba(49, 50, 68, 0.6);
  border-radius: 4px;
  padding: 1px;
}

.vc-btn {
  padding: 2px 6px;
  font-size: 9px;
  font-weight: 500;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--bs-body-color, #a6adc8);
  cursor: pointer;
  transition: all 150ms ease;
  white-space: nowrap;
}

.vc-btn:hover {
  color: #cdd6f4;
}

.vc-btn--active {
  background: rgba(137, 180, 250, 0.2);
  color: #89b4fa;
  font-weight: 600;
}

.vc-toggles {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.vc-toggle {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 9px;
  color: var(--bs-body-color, #a6adc8);
  cursor: pointer;
  user-select: none;
}

.vc-toggle input {
  width: 12px;
  height: 12px;
  accent-color: #89b4fa;
}

.vc-coverage {
  padding: 1px 5px;
  background: rgba(166, 227, 161, 0.15);
  color: #a6e3a1;
  border-radius: 3px;
  font-weight: 600;
}

/* ── Chart ── */
.vc-chart-area {
  flex: 1;
  min-height: 0;
  position: relative;
}

.vc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 8px;
  color: var(--bs-body-color, #a6adc8);
  opacity: 0.6;
  font-size: 12px;
}

.vc-empty-icon {
  width: 32px;
  height: 32px;
  opacity: 0.3;
}

.vc-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(69, 71, 90, 0.5);
  border-top-color: #89b4fa;
  border-radius: 50%;
  animation: vc-spin 800ms linear infinite;
}

@keyframes vc-spin {
  to {
    transform: rotate(360deg);
  }
}

.vc-retry-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 10px;
  border: 1px solid rgba(137, 180, 250, 0.3);
  background: transparent;
  color: #89b4fa;
  border-radius: 4px;
  cursor: pointer;
  transition: background 150ms;
}

.vc-retry-btn:hover {
  background: rgba(137, 180, 250, 0.1);
}

/* ── Footer ── */
.vc-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 3px 8px;
  font-size: 9px;
  color: var(--bs-body-color, #a6adc8);
  opacity: 0.7;
  border-top: 1px solid rgba(49, 50, 68, 0.5);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.vc-stat b {
  color: #cdd6f4;
}
</style>
