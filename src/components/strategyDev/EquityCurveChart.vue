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
  DataZoomComponent,
  MarkLineComponent,
} from 'echarts/components';

use([LineChart, CanvasRenderer, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent]);

const props = defineProps<{
  equity: { date: string; balance: number }[];
  startingBalance: number;
}>();

const option = computed<EChartsOption>(() => {
  const dates = props.equity.map((e) => e.date);
  const balances = props.equity.map((e) => e.balance);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const p = (params as { data: number; axisValue: string }[])[0];
        const bal = p.data;
        const ret = ((bal - props.startingBalance) / props.startingBalance) * 100;
        return [
          `<b>${p.axisValue}</b>`,
          `Balance: ${bal.toFixed(2)}`,
          `Return: ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`,
        ].join('<br/>');
      },
    },
    grid: { left: 60, right: 20, top: 20, bottom: 60 },
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
      data: dates,
      axisLabel: {
        color: '#a6adc8',
        fontSize: 11,
        interval: Math.max(Math.floor(dates.length / 8), 1),
      },
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
        data: balances,
        symbol: 'none',
        smooth: false,
        lineStyle: { width: 2, color: '#89b4fa' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(137,180,250,0.3)' },
              { offset: 1, color: 'rgba(137,180,250,0)' },
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
            formatter: `Start: ${props.startingBalance}`,
          },
          data: [{ yAxis: props.startingBalance }],
        },
      },
    ],
  };
});
</script>

<template>
  <ECharts :option="option" autoresize style="height: 300px" />
</template>
