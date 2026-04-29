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
import type { RateMetricsResponse, RateTimelineBucket } from '@/types';

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

const props = withDefaults(
  defineProps<{
    multiBotView?: boolean;
  }>(),
  { multiBotView: false },
);

const botStore = useBotStore();
const settingsStore = useSettingsStore();

const refreshInterval = ref<number | null>(null);
const windowOptions = [
  { text: '10 min', value: 600 },
  { text: '30 min', value: 1800 },
  { text: '1h', value: 3600 },
  { text: '6h', value: 21600 },
  { text: '24h', value: 86400 },
];
const selectedWindow = ref(3600);

const metricsData = computed((): RateMetricsResponse | null => {
  if (props.multiBotView) {
    const all = botStore.allRateMetrics;
    const entries = Object.values(all);
    return entries.length > 0 ? entries[0] : null;
  }
  const m = botStore.activeBot?.rateMetrics;
  return m?.exchange ? m : null;
});

const timeline = computed((): RateTimelineBucket[] => {
  return metricsData.value?.timeline ?? [];
});

const recent429s = computed(() => metricsData.value?.recent_429s ?? []);

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
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
          const unit = s.seriesName === 'Latency' ? ' ms' : '';
          html += `<span style="color:${s.color}">●</span> ${s.seriesName}: <strong>${typeof s.value === 'number' ? s.value.toFixed(s.seriesName === 'Latency' ? 1 : 0) : s.value}</strong>${unit}<br/>`;
        }
        return html;
      },
    },
    legend: {
      data: ['Direct', 'Cached', 'Errors', 'Latency'],
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
        name: 'Requests',
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
        name: 'Direct',
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
        name: 'Cached',
        type: 'line',
        stack: 'requests',
        areaStyle: { opacity: 0.4 },
        lineStyle: { width: 1.5 },
        symbol: 'none',
        data: cachedData,
        color: '#22c55e',
      },
      {
        name: 'Errors',
        type: 'bar',
        data: errorData,
        color: '#ef4444',
        barMaxWidth: 6,
      },
      {
        name: 'Latency',
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

function fetchMetrics() {
  const bucketS = selectedWindow.value <= 1800 ? 10 : selectedWindow.value <= 7200 ? 30 : 60;
  if (props.multiBotView) {
    botStore.allBotStores.forEach((bot) => {
      if (bot.isBotOnline) {
        bot.getRateMetrics(selectedWindow.value, bucketS);
      }
    });
  } else {
    botStore.activeBot?.getRateMetrics(selectedWindow.value, bucketS);
  }
}

watch(selectedWindow, () => fetchMetrics());

onMounted(() => {
  fetchMetrics();
  refreshInterval.value = window.setInterval(fetchMetrics, 30000);
});

onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value);
  }
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Window selector -->
    <div class="flex items-center gap-2 px-2 pt-1">
      <label class="text-xs text-surface-500">Window</label>
      <Select
        v-model="selectedWindow"
        size="small"
        option-label="text"
        option-value="value"
        :options="windowOptions"
        class="text-xs"
        style="min-width: 80px"
      />
      <div v-if="metricsData?.summary" class="flex items-center gap-3 ml-auto text-xs">
        <span class="text-surface-500"> {{ metricsData.summary.total }} req </span>
        <span
          :class="(metricsData.summary.errors_429 ?? 0) > 0 ? 'text-red-400' : 'text-surface-500'"
        >
          {{ metricsData.summary.errors_429 ?? 0 }} 429s
        </span>
        <span class="text-surface-500">
          avg {{ (metricsData.summary.avg_latency_ms ?? 0).toFixed(0) }}ms
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
        <span class="text-sm">No timeline data</span>
        <span class="text-xs">Waiting for API activity</span>
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
