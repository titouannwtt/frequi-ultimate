<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  MarkPointComponent,
  DataZoomComponent,
} from 'echarts/components';

use([
  LineChart,
  ScatterChart,
  CanvasRenderer,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  MarkPointComponent,
  DataZoomComponent,
]);

const props = defineProps<{
  data: number[];
  title: string;
}>();

const { t } = useI18n();

const bestSoFar = computed(() => {
  const result: number[] = [];
  let best = Infinity;
  for (const v of props.data) {
    best = Math.min(best, v);
    result.push(best);
  }
  return result;
});

const bestIdx = computed(() => {
  let minIdx = 0;
  for (let i = 1; i < props.data.length; i++) {
    if (props.data[i] < props.data[minIdx]) minIdx = i;
  }
  return minIdx;
});

const converged = computed(() => {
  const n = props.data.length;
  if (n < 10) return null;
  const lastPortion = bestSoFar.value.slice(Math.floor(n * 0.7));
  if (lastPortion.length < 2) return null;
  const improvement = (lastPortion[0] - lastPortion[lastPortion.length - 1]) / Math.abs(lastPortion[0] || 1);
  return improvement < 0.01;
});

const chartOptions = computed<EChartsOption>(() => {
  const epochs = props.data.map((_, i) => i + 1);
  return {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14, color: '#cdd6f4' } },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
    },
    legend: {
      bottom: 28,
      textStyle: { color: '#a6adc8', fontSize: 11 },
      data: ['Epoch loss', 'Best so far'],
    },
    grid: { left: 60, right: 20, top: 40, bottom: 76 },
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
      type: 'category',
      name: 'Epoch',
      data: epochs,
      axisLabel: { color: '#a6adc8', interval: Math.max(Math.floor(epochs.length / 10), 1) },
      axisLine: { lineStyle: { color: '#45475a' } },
    },
    yAxis: {
      type: 'value',
      name: 'Loss',
      axisLabel: { color: '#a6adc8' },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series: [
      {
        name: 'Epoch loss',
        type: 'scatter',
        data: props.data,
        symbolSize: 3,
        itemStyle: { color: '#6c7086', opacity: 0.4 },
      },
      {
        name: 'Best so far',
        type: 'line',
        data: bestSoFar.value,
        smooth: false,
        symbol: 'none',
        lineStyle: { width: 2, color: '#a6e3a1' },
        areaStyle: { opacity: 0.08, color: '#a6e3a1' },
        markPoint: {
          data: [
            {
              coord: [bestIdx.value, props.data[bestIdx.value]],
              symbolSize: 12,
              itemStyle: { color: '#94e2d5', borderColor: '#1e1e2e', borderWidth: 2 },
              label: {
                show: true,
                formatter: `Best: ${props.data[bestIdx.value]?.toFixed(4)}`,
                position: 'top',
                fontSize: 10,
                color: '#94e2d5',
              },
            },
          ],
        },
      },
    ],
  };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 340px" />

    <!-- Convergence advisory -->
    <div v-if="converged !== null" class="mt-2 px-3 py-1.5 rounded text-sm font-medium"
      :style="{
        background: converged ? 'rgba(166, 227, 161, 0.12)' : 'rgba(249, 226, 175, 0.12)',
        color: converged ? '#a6e3a1' : '#f9e2af',
        border: `1px solid ${converged ? 'rgba(166,227,161,0.3)' : 'rgba(249,226,175,0.3)'}`,
      }"
    >
      {{ converged
        ? t('strategyDev.convConverged')
        : t('strategyDev.convNotConverged')
      }}
    </div>
  </div>
</template>
