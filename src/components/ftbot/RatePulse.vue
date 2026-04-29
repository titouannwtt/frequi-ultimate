<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, BarChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import type { RateTimelineBucket } from '@/types';
import { useI18n } from 'vue-i18n';
import { useRateMetrics } from '@/composables/useRateMetrics';

use([
  LineChart,
  BarChart,
  ScatterChart,
  CanvasRenderer,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
]);

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    multiBotView?: boolean;
  }>(),
  { multiBotView: false },
);

const settingsStore = useSettingsStore();

const {
  selectedWindow,
  selectedExchange,
  windowOptions,
  exchangeOptions,
  primaryMetrics,
} = useRateMetrics({ multiBotView: props.multiBotView });

const timeline = computed((): RateTimelineBucket[] => {
  return primaryMetrics.value?.timeline ?? [];
});

const recent429s = computed(() => primaryMetrics.value?.recent_429s ?? []);

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

const chartOption = computed((): EChartsOption => {
  const data = timeline.value;
  if (data.length === 0) return {};

  const times = data.map((b) => formatTime(b.ts));
  const directData = data.map((b) => b.direct);
  const cachedData = data.map((b) => b.cached);
  const errorData = data.map((b) => b.errors);
  const latencyData = data.map((b) => b.avg_latency_ms);

  const mark429Lines =
    recent429s.value.length > 0
      ? recent429s.value.slice(0, 20).map((e) => ({
          xAxis: formatTime(e.ts),
          label: { show: false },
          lineStyle: { color: '#ef4444', type: 'dashed' as const, width: 1 },
        }))
      : [];

  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params: unknown) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        const p = params as Array<{
          axisValue: string;
          seriesName: string;
          value: number;
          color: string;
        }>;
        const idx = p[0].axisValue;
        let html = `<strong>${idx}</strong><br/>`;
        for (const s of p) {
          const isLatency = s.seriesName === t('rateMonitor.responseTime');
          const display = isLatency
            ? formatLatency(s.value)
            : typeof s.value === 'number'
              ? s.value.toFixed(0)
              : s.value;
          html += `<span style="color:${s.color}">●</span> ${s.seriesName}: <strong>${display}</strong><br/>`;
        }
        return html;
      },
    },
    legend: {
      data: [
        t('rateMonitor.direct'),
        t('rateMonitor.cached'),
        t('rateMonitor.errors'),
        t('rateMonitor.responseTime'),
      ],
      top: 0,
      right: '5%',
      textStyle: { fontSize: 11 },
      selectedMode: true,
    },
    grid: [{ left: 50, right: 50, top: 30, bottom: 55 }],
    xAxis: {
      type: 'category',
      data: times,
      boundaryGap: false,
      axisLabel: { fontSize: 10, rotate: 0 },
      axisLine: { lineStyle: { color: '#475569' } },
    },
    yAxis: [
      {
        type: 'value',
        name: t('rateMonitor.requests'),
        nameTextStyle: { fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e293b' } },
        axisLabel: { fontSize: 10 },
      },
      {
        type: 'value',
        name: 'ms',
        nameTextStyle: { fontSize: 10 },
        splitLine: { show: false },
        axisLabel: { fontSize: 10 },
      },
    ],
    dataZoom: [
      {
        type: 'inside',
        start: 0,
        end: 100,
      },
      {
        type: 'slider',
        bottom: 5,
        height: 18,
        start: 0,
        end: 100,
        borderColor: '#334155',
        fillerColor: 'rgba(59, 130, 246, 0.15)',
        handleSize: '60%',
      },
    ],
    series: [
      {
        name: t('rateMonitor.direct'),
        type: 'line',
        stack: 'requests',
        areaStyle: { opacity: 0.4 },
        lineStyle: { width: 1.5 },
        symbol: 'none',
        data: directData,
        color: '#3b82f6',
        markLine:
          mark429Lines.length > 0
            ? {
                silent: true,
                symbol: 'none',
                data: mark429Lines,
              }
            : undefined,
      },
      {
        name: t('rateMonitor.cached'),
        type: 'line',
        stack: 'requests',
        areaStyle: { opacity: 0.4 },
        lineStyle: { width: 1.5 },
        symbol: 'none',
        data: cachedData,
        color: '#22c55e',
      },
      {
        name: t('rateMonitor.errors'),
        type: 'bar',
        data: errorData,
        color: '#ef4444',
        barMaxWidth: 6,
      },
      {
        name: t('rateMonitor.responseTime'),
        type: 'line',
        yAxisIndex: 1,
        lineStyle: { width: 1, type: 'dotted' },
        symbol: 'none',
        data: latencyData,
        color: '#f59e0b',
      },
    ],
  };
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Window & exchange selector -->
    <div class="flex items-center gap-2 px-2 pt-1">
      <label class="text-xs text-surface-500">{{ t('rateMonitor.window') }}</label>
      <Select
        v-model="selectedWindow"
        size="small"
        option-label="text"
        option-value="value"
        :options="windowOptions"
        class="text-xs"
        style="min-width: 80px"
      />
      <Select
        v-if="multiBotView && exchangeOptions.length > 2"
        v-model="selectedExchange"
        size="small"
        option-label="text"
        option-value="value"
        :options="exchangeOptions"
        class="text-xs"
        style="min-width: 100px"
      />
      <div v-if="primaryMetrics?.summary" class="flex items-center gap-3 ml-auto text-xs">
        <span class="text-surface-500">
          {{ primaryMetrics.summary.total }} {{ t('rateMonitor.req') }}
        </span>
        <span
          :class="(primaryMetrics.summary.errors_429 ?? 0) > 0 ? 'text-red-400' : 'text-surface-500'"
        >
          {{ primaryMetrics.summary.errors_429 ?? 0 }} {{ t('rateMonitor.429s') }}
        </span>
        <span class="text-surface-500" :title="t('rateMonitor.avgResponseTime')">
          {{ t('rateMonitor.avgResponse') }} {{ formatLatency(primaryMetrics.summary.avg_latency_ms ?? 0) }}
        </span>
      </div>
    </div>

    <!-- Chart -->
    <div class="grow min-h-0">
      <ECharts
        v-if="timeline.length > 0"
        :option="chartOption"
        :theme="settingsStore.chartTheme"
        autoresize
      />
      <div v-else class="flex flex-col items-center justify-center h-full text-surface-500">
        <i-mdi-pulse class="w-8 h-8 mb-2" />
        <span class="text-sm">{{ t('rateMonitor.noTimeline') }}</span>
        <span class="text-xs">{{ t('rateMonitor.waitingActivity') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.echarts {
  width: 100%;
  height: 100%;
  min-height: 150px;
}
</style>
