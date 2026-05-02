<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { CandlestickChart, LineChart, BarChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  MarkPointComponent,
  AxisPointerComponent,
} from 'echarts/components';

use([
  CandlestickChart, LineChart, BarChart, ScatterChart,
  CanvasRenderer, GridComponent, TooltipComponent,
  DataZoomComponent, LegendComponent, MarkPointComponent, AxisPointerComponent,
]);

const { t } = useI18n();

const props = defineProps<{
  data: Record<string, unknown>;
}>();

const columns = computed(() => (props.data.columns as string[]) || []);
const rawData = computed(() => (props.data.data as (number | string | null)[][]) || []);
const trades = computed(() => (props.data.trades as Record<string, unknown>[]) || []);
const plotConfig = computed(() => (props.data.plot_config as Record<string, unknown>) || {});
const pair = computed(() => (props.data.pair as string) || '');

function colIndex(name: string): number {
  return columns.value.indexOf(name);
}

const dateIdx = computed(() => colIndex('date'));
const openIdx = computed(() => colIndex('open'));
const highIdx = computed(() => colIndex('high'));
const lowIdx = computed(() => colIndex('low'));
const closeIdx = computed(() => colIndex('close'));
const volumeIdx = computed(() => colIndex('volume'));

const TEXT_COLOR = '#cdd6f4';
const GRID_COLOR = '#313244';
const GREEN = '#a6e3a1';
const RED = '#f38ba8';
const BLUE = '#89b4fa';
const MAUVE = '#cba6f7';
const PEACH = '#fab387';
const YELLOW = '#f9e2af';
const TEAL = '#94e2d5';

const INDICATOR_COLORS = [BLUE, PEACH, MAUVE, TEAL, YELLOW, '#f5c2e7', '#74c7ec', '#b4befe'];

const mainPlotIndicators = computed(() => {
  const mp = plotConfig.value.main_plot;
  if (!mp || typeof mp !== 'object') return [];
  return Object.keys(mp as Record<string, unknown>).filter(k => colIndex(k) >= 0);
});

const subplots = computed(() => {
  const sp = plotConfig.value.subplots;
  if (!sp || typeof sp !== 'object') return {} as Record<string, string[]>;
  const result: Record<string, string[]> = {};
  for (const [name, conf] of Object.entries(sp as Record<string, Record<string, unknown>>)) {
    if (!conf || typeof conf !== 'object') continue;
    const cols = Object.keys(conf).filter(k => colIndex(k) >= 0);
    if (cols.length > 0) result[name] = cols;
  }
  return result;
});

const subplotNames = computed(() => Object.keys(subplots.value));
const totalRows = computed(() => 2 + subplotNames.value.length);

const chartOption = computed<EChartsOption>(() => {
  const dIdx = dateIdx.value;
  const oIdx = openIdx.value;
  const hIdx = highIdx.value;
  const lIdx = lowIdx.value;
  const cIdx = closeIdx.value;
  const vIdx = volumeIdx.value;

  if (dIdx < 0 || oIdx < 0) return {};

  const dates = rawData.value.map(r => r[dIdx] as string);
  const candleData = rawData.value.map(r => [r[oIdx], r[cIdx], r[lIdx], r[hIdx]]);
  const volumeData = vIdx >= 0 ? rawData.value.map((r, i) => {
    const o = r[oIdx] as number;
    const c = r[cIdx] as number;
    return { value: r[vIdx], itemStyle: { color: c >= o ? 'rgba(166,227,161,0.4)' : 'rgba(243,139,168,0.4)' } };
  }) : [];

  const rowHeights: number[] = [55];
  const subRowHeight = subplotNames.value.length > 0 ? Math.min(15, 30 / subplotNames.value.length) : 0;
  rowHeights.push(12);
  subplotNames.value.forEach(() => rowHeights.push(subRowHeight));

  const totalH = rowHeights.reduce((a, b) => a + b, 0);

  const grids: Record<string, unknown>[] = [];
  const xAxes: Record<string, unknown>[] = [];
  const yAxes: Record<string, unknown>[] = [];
  let topPct = 3;

  for (let i = 0; i < totalRows.value; i++) {
    const heightPct = (rowHeights[i] / totalH) * 90;
    grids.push({
      left: 60, right: 20, top: `${topPct}%`, height: `${heightPct}%`,
    });
    xAxes.push({
      type: 'category',
      data: dates,
      gridIndex: i,
      axisLabel: { show: i === totalRows.value - 1, color: TEXT_COLOR, fontSize: 9 },
      axisLine: { lineStyle: { color: GRID_COLOR } },
      splitLine: { show: false },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
    });
    const yName = i === 0 ? 'Price' : i === 1 ? 'Vol' : subplotNames.value[i - 2] || '';
    yAxes.push({
      type: 'value',
      gridIndex: i,
      name: yName,
      nameTextStyle: { color: TEXT_COLOR, fontSize: 10 },
      axisLabel: { color: TEXT_COLOR, fontSize: 9 },
      splitLine: { lineStyle: { color: GRID_COLOR, type: 'dashed' } },
      scale: i === 0,
    });
    topPct += heightPct + 1;
  }

  const series: Record<string, unknown>[] = [];

  series.push({
    type: 'candlestick',
    name: pair.value,
    data: candleData,
    xAxisIndex: 0,
    yAxisIndex: 0,
    itemStyle: {
      color: GREEN,
      color0: RED,
      borderColor: GREEN,
      borderColor0: RED,
    },
  });

  let colorIdx = 0;
  for (const indicator of mainPlotIndicators.value) {
    const idx = colIndex(indicator);
    const color = INDICATOR_COLORS[colorIdx % INDICATOR_COLORS.length];
    const mpConf = (plotConfig.value.main_plot as Record<string, Record<string, unknown>> | undefined)?.[indicator];
    series.push({
      type: 'line',
      name: indicator,
      data: rawData.value.map(r => r[idx]),
      xAxisIndex: 0,
      yAxisIndex: 0,
      lineStyle: { color: mpConf?.color || color, width: 1 },
      itemStyle: { color: mpConf?.color || color },
      symbol: 'none',
    });
    colorIdx++;
  }

  // Entry/exit signals as scatter
  const signalCols = [
    { col: 'enter_long', color: GREEN, symbol: 'triangle', symbolSize: 10, label: 'Entry Long' },
    { col: 'exit_long', color: RED, symbol: 'pin', symbolSize: 10, label: 'Exit Long' },
    { col: 'enter_short', color: BLUE, symbol: 'diamond', symbolSize: 10, label: 'Entry Short' },
    { col: 'exit_short', color: MAUVE, symbol: 'arrow', symbolSize: 10, label: 'Exit Short' },
  ];
  for (const sig of signalCols) {
    const sIdx = colIndex(sig.col);
    if (sIdx < 0) continue;
    const scatterData: (number | null)[] = rawData.value.map((r, i) => {
      const val = r[sIdx];
      if (val && val !== 0) {
        return r[lIdx] as number * 0.998;
      }
      return null;
    });
    series.push({
      type: 'scatter',
      name: sig.label,
      data: scatterData,
      xAxisIndex: 0,
      yAxisIndex: 0,
      symbol: sig.symbol,
      symbolSize: sig.symbolSize,
      itemStyle: { color: sig.color },
    });
  }

  // Trade markers
  const entryMarkers: [number, number][] = [];
  const exitMarkers: [number, number][] = [];
  for (const tr of trades.value) {
    const openDate = String(tr.open_date || '').slice(0, 19);
    const closeDate = String(tr.close_date || '').slice(0, 19);
    const openIdx = dates.findIndex(d => String(d).slice(0, 19) === openDate);
    const closeIdx = dates.findIndex(d => String(d).slice(0, 19) === closeDate);
    if (openIdx >= 0) {
      entryMarkers.push([openIdx, rawData.value[openIdx][oIdx] as number]);
    }
    if (closeIdx >= 0) {
      exitMarkers.push([closeIdx, rawData.value[closeIdx][cIdx] as number]);
    }
  }

  if (entryMarkers.length > 0) {
    series.push({
      type: 'scatter',
      name: 'Trade Entry',
      data: entryMarkers.map(([i, v]) => ({ value: [dates[i], v] })),
      xAxisIndex: 0,
      yAxisIndex: 0,
      symbol: 'triangle',
      symbolSize: 12,
      itemStyle: { color: YELLOW },
      z: 10,
    });
  }
  if (exitMarkers.length > 0) {
    series.push({
      type: 'scatter',
      name: 'Trade Exit',
      data: exitMarkers.map(([i, v]) => ({ value: [dates[i], v] })),
      xAxisIndex: 0,
      yAxisIndex: 0,
      symbol: 'pin',
      symbolSize: 12,
      itemStyle: { color: PEACH },
      z: 10,
    });
  }

  if (volumeData.length > 0) {
    series.push({
      type: 'bar',
      name: 'Volume',
      data: volumeData,
      xAxisIndex: 1,
      yAxisIndex: 1,
      barMaxWidth: 4,
    });
  }

  // Subplots
  subplotNames.value.forEach((subName, si) => {
    const subCols = subplots.value[subName];
    const axisIdx = si + 2;
    const spConf = (plotConfig.value.subplots as Record<string, Record<string, Record<string, unknown>>> | undefined)?.[subName];
    subCols.forEach((col, ci) => {
      const idx = colIndex(col);
      const conf = spConf?.[col];
      const color = conf?.color || INDICATOR_COLORS[(colorIdx + ci) % INDICATOR_COLORS.length];
      series.push({
        type: 'line',
        name: col,
        data: rawData.value.map(r => r[idx]),
        xAxisIndex: axisIdx,
        yAxisIndex: axisIdx,
        lineStyle: { color, width: 1 },
        itemStyle: { color },
        symbol: 'none',
      });
    });
    colorIdx += subCols.length;
  });

  return {
    animation: false,
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#313244',
      textStyle: { color: TEXT_COLOR, fontSize: 11 },
      axisPointer: { type: 'cross', link: [{ xAxisIndex: 'all' }] },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    legend: {
      type: 'scroll',
      bottom: 0,
      textStyle: { color: TEXT_COLOR, fontSize: 10 },
      pageTextStyle: { color: TEXT_COLOR },
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: Array.from({ length: totalRows.value }, (_, i) => i),
      },
      {
        type: 'slider',
        xAxisIndex: Array.from({ length: totalRows.value }, (_, i) => i),
        bottom: 25,
        height: 18,
        borderColor: GRID_COLOR,
        fillerColor: 'rgba(137, 180, 250, 0.15)',
        textStyle: { color: TEXT_COLOR },
      },
    ],
    series,
  };
});

const chartHeight = computed(() => {
  const base = 500;
  const subExtra = subplotNames.value.length * 120;
  return `${base + subExtra}px`;
});
</script>

<template>
  <div class="rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 overflow-hidden">
    <div class="px-3 py-2 border-b border-surface-200 dark:border-surface-700 flex items-center gap-2">
      <i-mdi-chart-timeline-variant class="w-4 h-4 text-surface-400" />
      <h4 class="text-sm font-semibold text-surface-300">{{ pair }}</h4>
      <span class="text-xs text-surface-500 ml-auto">
        {{ (data.data_length as number) || rawData.length }} candles
      </span>
    </div>
    <ECharts
      :option="chartOption"
      :style="{ width: '100%', height: chartHeight }"
      autoresize
    />
  </div>
</template>
