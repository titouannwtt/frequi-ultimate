<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use, connect, disconnect } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, BarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkAreaComponent,
  LegendComponent,
} from 'echarts/components';

use([LineChart, BarChart, CanvasRenderer, GridComponent, TooltipComponent, DataZoomComponent, MarkAreaComponent, LegendComponent]);

const { t } = useI18n();
const GROUP_ID = 'plot-profit-sync';

const props = defineProps<{
  data: Record<string, unknown>;
}>();

const combinedProfit = computed(() => (props.data.combined_profit as { date: string; value: number; balance: number }[]) || []);
const drawdownMarkers = computed(() => (props.data.drawdown_markers as Record<string, unknown>) || {});
const profitPerPair = computed(() => (props.data.profit_per_pair as Record<string, { date: string; value: number }[]>) || {});
const parallelism = computed(() => (props.data.parallelism as { date: string; count: number }[]) || []);
const underwaterAbs = computed(() => (props.data.underwater_abs as { date: string; value: number }[]) || []);
const underwaterPct = computed(() => (props.data.underwater_pct as { date: string; value: number }[]) || []);
const startingBalance = computed(() => (props.data.starting_balance as number) || 1000);

const chartRefs = ref<InstanceType<typeof ECharts>[]>([]);

onMounted(() => {
  try { connect(GROUP_ID); } catch { /* group may already exist */ }
});

onUnmounted(() => {
  try { disconnect(GROUP_ID); } catch { /* ignore */ }
});

const TEXT_COLOR = '#cdd6f4';
const GRID_COLOR = '#313244';
const GREEN = '#a6e3a1';
const RED = '#f38ba8';
const BLUE = '#89b4fa';
const MAUVE = '#cba6f7';
const PEACH = '#fab387';
const YELLOW = '#f9e2af';
const TEAL = '#94e2d5';
const SAPPHIRE = '#74c7ec';

const PAIR_COLORS = [BLUE, PEACH, MAUVE, TEAL, YELLOW, RED, GREEN, SAPPHIRE, '#f5c2e7', '#eba0ac', '#a6adc8', '#b4befe'];

function baseGrid(): Record<string, unknown> {
  return { left: 60, right: 20, top: 30, bottom: 5, containLabel: false };
}

function baseXAxis(showLabel = false): Record<string, unknown> {
  return {
    type: 'time',
    axisLabel: { show: showLabel, color: TEXT_COLOR, fontSize: 10 },
    axisLine: { lineStyle: { color: GRID_COLOR } },
    splitLine: { show: false },
  };
}

function baseYAxis(name: string, formatter?: string): Record<string, unknown> {
  return {
    type: 'value',
    name,
    nameTextStyle: { color: TEXT_COLOR, fontSize: 11 },
    axisLabel: { color: TEXT_COLOR, fontSize: 10, formatter },
    splitLine: { lineStyle: { color: GRID_COLOR, type: 'dashed' } },
  };
}

function baseTooltip(): Record<string, unknown> {
  return {
    trigger: 'axis',
    backgroundColor: '#1e1e2e',
    borderColor: '#313244',
    textStyle: { color: TEXT_COLOR, fontSize: 12 },
  };
}

const combinedProfitOption = computed<EChartsOption>(() => {
  const dd = drawdownMarkers.value;
  const markArea = dd.max_dd_start && dd.max_dd_end ? {
    silent: true,
    itemStyle: { color: 'rgba(243, 139, 168, 0.12)' },
    data: [[
      { xAxis: dd.max_dd_start as string },
      { xAxis: dd.max_dd_end as string },
    ]],
  } : undefined;

  return {
    grid: baseGrid(),
    xAxis: baseXAxis(),
    yAxis: baseYAxis('Balance'),
    tooltip: baseTooltip(),
    series: [{
      type: 'line',
      name: t('strategyDev.plotCombinedProfit'),
      data: combinedProfit.value.map(p => [p.date, p.balance]),
      lineStyle: { color: GREEN, width: 1.5 },
      itemStyle: { color: GREEN },
      symbol: 'none',
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(166, 227, 161, 0.25)' },
            { offset: 1, color: 'rgba(166, 227, 161, 0.02)' },
          ],
        },
      },
      markArea,
    }],
  };
});

const profitPerPairOption = computed<EChartsOption>(() => {
  const pairs = Object.keys(profitPerPair.value);
  const series = pairs.map((pair, i) => ({
    type: 'line' as const,
    name: pair,
    data: profitPerPair.value[pair].map(p => [p.date, p.value]),
    lineStyle: { color: PAIR_COLORS[i % PAIR_COLORS.length], width: 1 },
    itemStyle: { color: PAIR_COLORS[i % PAIR_COLORS.length] },
    symbol: 'none',
  }));

  return {
    grid: baseGrid(),
    xAxis: baseXAxis(),
    yAxis: baseYAxis('Profit'),
    tooltip: baseTooltip(),
    legend: {
      show: pairs.length <= 20,
      type: 'scroll',
      bottom: 0,
      textStyle: { color: TEXT_COLOR, fontSize: 10 },
      pageTextStyle: { color: TEXT_COLOR },
    },
    series,
  };
});

const parallelismOption = computed<EChartsOption>(() => ({
  grid: { ...baseGrid(), bottom: 5 },
  xAxis: baseXAxis(),
  yAxis: { ...baseYAxis('Trades'), minInterval: 1 },
  tooltip: baseTooltip(),
  series: [{
    type: 'bar',
    name: t('strategyDev.plotParallelism'),
    data: parallelism.value.map(p => [p.date, p.count]),
    itemStyle: { color: SAPPHIRE },
    barMaxWidth: 3,
  }],
}));

const underwaterAbsOption = computed<EChartsOption>(() => ({
  grid: baseGrid(),
  xAxis: baseXAxis(),
  yAxis: baseYAxis('Drawdown'),
  tooltip: baseTooltip(),
  series: [{
    type: 'line',
    name: t('strategyDev.plotUnderwaterAbs'),
    data: underwaterAbs.value.map(p => [p.date, p.value]),
    lineStyle: { color: RED, width: 1 },
    itemStyle: { color: RED },
    symbol: 'none',
    areaStyle: { color: 'rgba(243, 139, 168, 0.2)' },
  }],
}));

const underwaterPctOption = computed<EChartsOption>(() => ({
  grid: { ...baseGrid(), bottom: 40 },
  xAxis: baseXAxis(true),
  yAxis: {
    ...baseYAxis('Drawdown %'),
    axisLabel: {
      color: TEXT_COLOR,
      fontSize: 10,
      formatter: (val: number) => `${(val * 100).toFixed(1)}%`,
    },
  },
  tooltip: {
    ...baseTooltip(),
    valueFormatter: (val: unknown) => `${(Number(val) * 100).toFixed(2)}%`,
  },
  dataZoom: [{
    type: 'slider',
    xAxisIndex: 0,
    height: 20,
    bottom: 5,
    borderColor: GRID_COLOR,
    fillerColor: 'rgba(137, 180, 250, 0.15)',
    textStyle: { color: TEXT_COLOR },
  }],
  series: [{
    type: 'line',
    name: t('strategyDev.plotUnderwaterPct'),
    data: underwaterPct.value.map(p => [p.date, p.value]),
    lineStyle: { color: PEACH, width: 1 },
    itemStyle: { color: PEACH },
    symbol: 'none',
    areaStyle: { color: 'rgba(250, 179, 135, 0.2)' },
  }],
}));

const chartSections = computed(() => [
  { title: t('strategyDev.plotCombinedProfit'), option: combinedProfitOption.value, height: '250px' },
  { title: t('strategyDev.plotProfitPerPair'), option: profitPerPairOption.value, height: '250px' },
  { title: t('strategyDev.plotParallelism'), option: parallelismOption.value, height: '150px' },
  { title: t('strategyDev.plotUnderwaterAbs'), option: underwaterAbsOption.value, height: '200px' },
  { title: t('strategyDev.plotUnderwaterPct'), option: underwaterPctOption.value, height: '220px' },
]);
</script>

<template>
  <div class="flex flex-col gap-1">
    <div
      v-for="(section, idx) in chartSections"
      :key="idx"
      class="rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 overflow-hidden"
    >
      <div class="px-3 py-1.5 border-b border-surface-200 dark:border-surface-700">
        <h4 class="text-xs font-semibold text-surface-500 uppercase tracking-wide">{{ section.title }}</h4>
      </div>
      <ECharts
        ref="chartRefs"
        :option="section.option"
        :style="{ width: '100%', height: section.height }"
        :group="GROUP_ID"
        autoresize
        :theme="undefined"
      />
    </div>
  </div>
</template>
