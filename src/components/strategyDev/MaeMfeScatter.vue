<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
  LegendComponent,
} from 'echarts/components';

use([ScatterChart, CanvasRenderer, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, LegendComponent]);

interface MaeMfePoint {
  mae: number;
  mfe: number;
  profit: number;
  pair: string;
}

const props = defineProps<{
  points: MaeMfePoint[];
  mode?: 'mae' | 'mfe';
}>();

const { t } = useI18n();

const selectedMode = ref(props.mode ?? 'mae');

const chartOptions = computed<EChartsOption>(() => {
  const wins = props.points.filter((p) => p.profit > 0);
  const losses = props.points.filter((p) => p.profit <= 0);

  const xKey = selectedMode.value === 'mae' ? 'mae' : 'mfe';
  const xLabel = selectedMode.value === 'mae' ? 'MAE %' : 'MFE %';

  const makeFmt = (meta: MaeMfePoint[]) => (p: unknown) => {
    const params = p as { dataIndex: number; value: number[] };
    const d = meta[params.dataIndex];
    return [
      `<b>${d.pair}</b>`,
      `MAE: <b>${d.mae.toFixed(2)}%</b>`,
      `MFE: <b>${d.mfe.toFixed(2)}%</b>`,
      `Profit: <b>${d.profit.toFixed(2)}%</b>`,
    ].join('<br/>');
  };

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
    },
    legend: {
      top: 4,
      textStyle: { color: '#a6adc8', fontSize: 10 },
    },
    grid: { left: 60, right: 20, top: 36, bottom: 60 },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        height: 18,
        bottom: 4,
        borderColor: '#45475a',
        backgroundColor: '#181825',
        fillerColor: 'rgba(137,180,250,0.15)',
        handleStyle: { color: '#89b4fa', borderColor: '#89b4fa' },
        textStyle: { color: '#a6adc8', fontSize: 10 },
        dataBackground: { lineStyle: { color: '#45475a' }, areaStyle: { color: '#313244' } },
      },
    ],
    xAxis: {
      type: 'value',
      name: xLabel,
      nameLocation: 'center',
      nameGap: 30,
      axisLabel: { color: '#a6adc8' },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    yAxis: {
      type: 'value',
      name: t('strategyDev.axisProfit'),
      axisLabel: { color: '#a6adc8' },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series: [
      {
        name: t('strategyDev.seriesWinners'),
        type: 'scatter',
        data: wins.map((p) => [p[xKey], p.profit]),
        symbolSize: 6,
        itemStyle: { color: '#a6e3a1', opacity: 0.6 },
        tooltip: { formatter: makeFmt(wins) },
      },
      {
        name: t('strategyDev.seriesLosers'),
        type: 'scatter',
        data: losses.map((p) => [p[xKey], p.profit]),
        symbolSize: 6,
        itemStyle: { color: '#f38ba8', opacity: 0.6 },
        tooltip: { formatter: makeFmt(losses) },
      },
      {
        type: 'scatter',
        data: [],
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#6c7086', width: 1 },
          label: { show: false },
          data: [{ yAxis: 0 }, { xAxis: 0 }],
        },
      },
    ],
  };
});
</script>

<template>
  <div class="sd-chart-card">
    <div class="mae-mfe-toggle">
      <button
        class="mae-mfe-btn"
        :class="{ active: selectedMode === 'mae' }"
        @click="selectedMode = 'mae'"
      >
        MAE vs PnL
      </button>
      <button
        class="mae-mfe-btn"
        :class="{ active: selectedMode === 'mfe' }"
        @click="selectedMode = 'mfe'"
      >
        MFE vs PnL
      </button>
    </div>
    <ECharts :option="chartOptions" autoresize style="height: 320px" />
  </div>
</template>

<style scoped>
.mae-mfe-toggle {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  background: rgba(49, 50, 68, 0.5);
  border-radius: 0.5rem;
  margin-bottom: 0.5rem;
  width: fit-content;
}

.mae-mfe-btn {
  padding: 0.25rem 0.75rem;
  border-radius: 0.375rem;
  font-size: 11px;
  font-weight: 500;
  color: #6c7086;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mae-mfe-btn:hover {
  color: #a6adc8;
}

.mae-mfe-btn.active {
  color: #cdd6f4;
  background: rgba(137, 180, 250, 0.12);
}
</style>
