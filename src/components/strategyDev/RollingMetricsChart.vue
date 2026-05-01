<script setup lang="ts">
import { computed } from 'vue';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
} from 'echarts/components';

use([
  LineChart,
  CanvasRenderer,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
]);

const C = {
  green: '#a6e3a1',
  blue: '#89b4fa',
  yellow: '#f9e2af',
  surface0: '#1e1e2e',
  surface1: '#313244',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  overlay: '#6c7086',
} as const;

interface MetricSeries {
  date: string;
  value: number;
}

const props = defineProps<{
  metrics: {
    sharpe: MetricSeries[];
    sortino: MetricSeries[];
    volatility: MetricSeries[];
    window: number;
  };
}>();

const chartOptions = computed<EChartsOption>(() => {
  const { sharpe, sortino, volatility, window } = props.metrics;

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: C.surface1,
      borderColor: C.overlay,
      textStyle: { color: C.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const items = params as { seriesName: string; value: [string, number]; color: string }[];
        if (!items.length) return '';
        const date = items[0].value[0];
        let html = `<b>${date}</b>`;
        for (const item of items) {
          const val = item.value[1];
          const fmt = item.seriesName.includes('Volatility')
            ? `${(val * 100).toFixed(2)}%`
            : val.toFixed(3);
          html += `<br/><span style="color:${item.color}">\u25CF</span> ${item.seriesName}: ${fmt}`;
        }
        return html;
      },
    },
    legend: {
      top: 0,
      textStyle: { color: C.subtext, fontSize: 11 },
      data: [
        `Rolling Sharpe (${window}d)`,
        `Rolling Sortino (${window}d)`,
        `Rolling Volatility (${window}d)`,
      ],
    },
    grid: { left: 60, right: 60, top: 36, bottom: 60 },
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
        handleStyle: { color: C.blue, borderColor: C.blue },
        textStyle: { color: C.subtext, fontSize: 10 },
        dataBackground: {
          lineStyle: { color: '#45475a' },
          areaStyle: { color: C.surface1 },
        },
      },
    ],
    xAxis: {
      type: 'time',
      axisLabel: { color: C.subtext, fontSize: 10 },
      axisLine: { lineStyle: { color: C.overlay } },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Ratio',
        nameTextStyle: { color: C.subtext, fontSize: 10 },
        axisLabel: { color: C.subtext, fontSize: 10 },
        splitLine: { lineStyle: { color: C.surface1, type: 'dashed' } },
      },
      {
        type: 'value',
        name: 'Volatility',
        nameTextStyle: { color: C.subtext, fontSize: 10 },
        axisLabel: {
          color: C.subtext,
          fontSize: 10,
          formatter: (v: number) => `${(v * 100).toFixed(1)}%`,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: `Rolling Sharpe (${window}d)`,
        type: 'line',
        data: sharpe.map((s) => [s.date, s.value]),
        symbol: 'none',
        lineStyle: { width: 1.5, color: C.blue },
        itemStyle: { color: C.blue },
        yAxisIndex: 0,
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: C.overlay, type: 'dashed', width: 1 },
          data: [{ yAxis: 0 }],
          label: { show: false },
        },
      },
      {
        name: `Rolling Sortino (${window}d)`,
        type: 'line',
        data: sortino.map((s) => [s.date, s.value]),
        symbol: 'none',
        lineStyle: { width: 1.5, color: C.green },
        itemStyle: { color: C.green },
        yAxisIndex: 0,
      },
      {
        name: `Rolling Volatility (${window}d)`,
        type: 'line',
        data: volatility.map((s) => [s.date, s.value]),
        symbol: 'none',
        lineStyle: { width: 1.5, color: C.yellow },
        itemStyle: { color: C.yellow },
        yAxisIndex: 1,
      },
    ],
  };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 350px" />
  </div>
</template>
