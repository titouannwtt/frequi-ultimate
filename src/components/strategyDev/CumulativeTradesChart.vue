<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
} from 'echarts/components';

use([
  LineChart,
  ScatterChart,
  CanvasRenderer,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
]);

interface TradePoint {
  index: number;
  date: string;
  cumulative_pct: number;
  balance: number;
  profit: number;
}

const props = defineProps<{
  trades: TradePoint[];
}>();

const chartOptions = computed<EChartsOption>(() => {
  const dates = props.trades.map((t) => t.date);
  const cumPct = props.trades.map((t) => t.cumulative_pct);
  const balances = props.trades.map((t) => t.balance);
  const profits = props.trades.map((t) => t.profit);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number }[];
        if (!ps.length) return '';
        const idx = ps[0].dataIndex;
        const t = props.trades[idx];
        return [
          `<b>${t.date}</b>`,
          `Cumulative: <b>${t.cumulative_pct >= 0 ? '+' : ''}${t.cumulative_pct.toFixed(2)}%</b>`,
          `Balance: <b>${t.balance.toFixed(2)}</b>`,
          `Trade profit: <b>${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}%</b>`,
        ].join('<br/>');
      },
    },
    legend: {
      data: ['Cumulative %', 'Balance', 'Trade P&L'],
      top: 0,
      textStyle: { color: '#a6adc8', fontSize: 11 },
    },
    grid: { left: 60, right: 60, top: 35, bottom: 60 },
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
    yAxis: [
      {
        type: 'value',
        name: 'Cumulative %',
        nameTextStyle: { color: '#89b4fa' },
        axisLabel: { color: '#a6adc8', fontSize: 11 },
        splitLine: { lineStyle: { color: '#313244' } },
      },
      {
        type: 'value',
        name: 'Balance',
        nameTextStyle: { color: '#cba6f7' },
        axisLabel: { color: '#a6adc8', fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Cumulative %',
        type: 'line',
        yAxisIndex: 0,
        data: cumPct,
        symbol: 'none',
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
      },
      {
        name: 'Balance',
        type: 'line',
        yAxisIndex: 1,
        data: balances,
        symbol: 'none',
        lineStyle: { width: 2, color: '#cba6f7' },
      },
      {
        name: 'Trade P&L',
        type: 'scatter',
        yAxisIndex: 0,
        data: profits,
        symbolSize: 4,
        itemStyle: {
          color: (p: unknown) => {
            const params = p as { data: number };
            return params.data >= 0 ? '#a6e3a1' : '#f38ba8';
          },
        },
      },
    ],
  };
});
</script>

<template>
  <ECharts :option="chartOptions" autoresize style="height: 320px" />
</template>
