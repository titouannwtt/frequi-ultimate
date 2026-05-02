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
  data: { index: number; date: string; winrate: number }[];
}>();

const option = computed<EChartsOption>(() => {
  const dates = props.data.map((d) => d.date);
  const values = props.data.map((d) => d.winrate);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const p = (params as { data: [string, number]; axisValue: string }[])[0];
        const val = Array.isArray(p.data) ? p.data[1] : p.data;
        const dateStr = new Date(p.axisValue).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const wr = typeof val === 'number' && !isNaN(val) ? (val * 100).toFixed(1) : '—';
        return `<b>${dateStr}</b><br/>Win Rate: ${wr}%`;
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
      data: dates,
      axisLabel: { color: '#a6adc8', fontSize: 11 },
      axisLine: { lineStyle: { color: '#45475a' } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 1,
      axisLabel: {
        color: '#a6adc8',
        fontSize: 11,
        formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
      },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series: [
      {
        type: 'line',
        data: props.data.map((d) => [d.date, d.winrate]),
        symbol: 'none',
        smooth: false,
        lineStyle: { width: 2, color: '#a6e3a1' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(166,227,161,0.3)' },
              { offset: 1, color: 'rgba(166,227,161,0)' },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#6c7086', width: 1 },
          label: {
            show: true,
            position: 'insideEndTop',
            color: '#6c7086',
            fontSize: 10,
            formatter: '50%',
          },
          data: [{ yAxis: 0.5 }],
        },
      },
    ],
  };
});
</script>

<template>
  <ECharts :option="option" autoresize style="height: 280px" />
</template>
