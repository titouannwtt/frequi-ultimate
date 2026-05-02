<script setup lang="ts">
import { BarChart, LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import VChart from 'vue-echarts';

use([CanvasRenderer, BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent]);

const props = defineProps<{
  data: {
    hours: number[];
    avg_profit: number[];
    winrate: number[];
    trade_count: number[];
  };
}>();

const chartOptions = computed(() => {
  const hours = props.data.hours ?? [];
  const avgProfit = props.data.avg_profit ?? [];
  const winrate = props.data.winrate ?? [];
  const tradeCount = props.data.trade_count ?? [];

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30, 30, 46, 0.95)',
      borderColor: 'rgba(69, 71, 90, 0.5)',
      textStyle: { color: '#cdd6f4', fontSize: 11 },
      formatter: (params: any[]) => {
        const h = params[0]?.name ?? '';
        let html = `<div style="font-weight:600;margin-bottom:4px">${h}:00</div>`;
        for (const p of params) {
          const val = p.seriesName === 'Win Rate'
            ? `${(p.value * 100).toFixed(1)}%`
            : p.seriesName === 'Trades'
              ? p.value
              : `${p.value >= 0 ? '+' : ''}${(p.value * 100).toFixed(2)}%`;
          html += `<div>${p.marker} ${p.seriesName}: <b>${val}</b></div>`;
        }
        return html;
      },
    },
    legend: {
      data: ['Avg Profit', 'Win Rate', 'Trades'],
      textStyle: { color: '#6c7086', fontSize: 10 },
      top: 0,
    },
    grid: { left: 50, right: 50, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: hours.map(String),
      axisLabel: { color: '#6c7086', fontSize: 10 },
      axisLine: { lineStyle: { color: 'rgba(69,71,90,0.3)' } },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Profit',
        position: 'left',
        axisLabel: {
          color: '#6c7086',
          fontSize: 10,
          formatter: (v: number) => `${(v * 100).toFixed(1)}%`,
        },
        splitLine: { lineStyle: { color: 'rgba(69,71,90,0.2)' } },
      },
      {
        type: 'value',
        name: 'Win Rate',
        position: 'right',
        min: 0,
        max: 1,
        axisLabel: {
          color: '#6c7086',
          fontSize: 10,
          formatter: (v: number) => `${(v * 100).toFixed(0)}%`,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Avg Profit',
        type: 'bar',
        data: avgProfit,
        yAxisIndex: 0,
        itemStyle: {
          color: (params: any) => params.value >= 0
            ? 'rgba(166, 227, 161, 0.7)'
            : 'rgba(243, 139, 168, 0.7)',
          borderRadius: [2, 2, 0, 0],
        },
      },
      {
        name: 'Win Rate',
        type: 'line',
        data: winrate,
        yAxisIndex: 1,
        smooth: true,
        lineStyle: { color: '#89b4fa', width: 2 },
        itemStyle: { color: '#89b4fa' },
        symbol: 'circle',
        symbolSize: 4,
      },
      {
        name: 'Trades',
        type: 'bar',
        data: tradeCount,
        yAxisIndex: 0,
        itemStyle: {
          color: 'rgba(137, 180, 250, 0.15)',
          borderRadius: [2, 2, 0, 0],
        },
        barMaxWidth: 8,
        show: false,
      },
    ],
  };
});
</script>

<template>
  <VChart :option="chartOptions" autoresize style="height: 300px" />
</template>
