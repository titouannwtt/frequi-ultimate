<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
} from 'echarts/components';

use([LineChart, CanvasRenderer, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent]);

const props = defineProps<{
  data: { index: number; date: string; profit_factor: number }[];
}>();

const option = computed<EChartsOption>(() => {
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const p = (params as { data: number[]; axisValue: string }[])[0];
        const dateStr = new Date(p.axisValue).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const pf = typeof p.data[1] === 'number' && isFinite(p.data[1]) ? p.data[1].toFixed(2) : '—';
        return `<b>${dateStr}</b><br/>Profit Factor: ${pf}`;
      },
    },
    grid: { left: 55, right: 20, top: 20, bottom: 60 },
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
      type: 'time',
      axisLabel: { color: '#a6adc8', fontSize: 11 },
      axisLine: { lineStyle: { color: '#45475a' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#a6adc8', fontSize: 11 },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series: [
      {
        type: 'line',
        data: props.data.map((d) => [d.date, d.profit_factor]),
        symbol: 'none',
        smooth: false,
        lineStyle: { width: 2, color: '#cba6f7' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(203,166,247,0.3)' },
              { offset: 1, color: 'rgba(203,166,247,0)' },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#f9e2af', width: 1 },
          label: {
            show: true,
            position: 'insideEndTop',
            color: '#f9e2af',
            fontSize: 10,
            formatter: 'Breakeven',
          },
          data: [{ yAxis: 1.0 }],
        },
      },
    ],
  };
});
</script>

<template>
  <div class="sd-chart-card">
    <ECharts :option="option" autoresize style="height: 280px" />
  </div>
</template>
