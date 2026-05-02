<script setup lang="ts">
import { LineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import VChart from 'vue-echarts';

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent]);

const props = defineProps<{
  data: {
    strategy_equity: Array<{ date: string; value: number }>;
    buyhold_equity: Array<{ date: string; value: number }>;
    alpha: number;
  };
}>();

const chartOptions = computed(() => {
  const stratDates = props.data.strategy_equity.map((d) => d.date);
  const stratVals = props.data.strategy_equity.map((d) => d.value);
  const bhVals = props.data.buyhold_equity.map((d) => d.value);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(30, 30, 46, 0.95)',
      borderColor: 'rgba(69, 71, 90, 0.5)',
      textStyle: { color: '#cdd6f4', fontSize: 11 },
    },
    legend: {
      data: ['Strategy', 'Buy & Hold'],
      textStyle: { color: '#6c7086', fontSize: 10 },
      top: 0,
    },
    grid: { left: 60, right: 20, top: 35, bottom: 60 },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      {
        type: 'slider',
        height: 20,
        bottom: 8,
        borderColor: 'rgba(69,71,90,0.3)',
        fillerColor: 'rgba(137,180,250,0.08)',
        handleStyle: { color: '#89b4fa' },
        textStyle: { color: '#6c7086', fontSize: 10 },
      },
    ],
    xAxis: {
      type: 'category',
      data: stratDates,
      axisLabel: { color: '#6c7086', fontSize: 10, rotate: 45 },
      axisLine: { lineStyle: { color: 'rgba(69,71,90,0.3)' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#6c7086', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(69,71,90,0.2)' } },
    },
    series: [
      {
        name: 'Strategy',
        type: 'line',
        data: stratVals,
        smooth: true,
        lineStyle: { color: '#a6e3a1', width: 2 },
        itemStyle: { color: '#a6e3a1' },
        symbol: 'none',
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(166,227,161,0.15)' },
              { offset: 1, color: 'rgba(166,227,161,0)' },
            ],
          },
        },
      },
      {
        name: 'Buy & Hold',
        type: 'line',
        data: bhVals,
        smooth: true,
        lineStyle: { color: '#6c7086', width: 1.5, type: 'dashed' },
        itemStyle: { color: '#6c7086' },
        symbol: 'none',
      },
    ],
  };
});

function fmtAlpha(v: number): string {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
}
</script>

<template>
  <div>
    <div class="alpha-badge" :class="props.data.alpha >= 0 ? 'alpha-pos' : 'alpha-neg'">
      Alpha: {{ fmtAlpha(props.data.alpha) }}
    </div>
    <VChart :option="chartOptions" autoresize style="height: 300px" />
  </div>
</template>

<style scoped>
.alpha-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.625rem;
  border-radius: 0.375rem;
  font-family: var(--sd-font-mono);
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 0.5rem;
}

.alpha-pos {
  color: #a6e3a1;
  background: rgba(166, 227, 161, 0.1);
}

.alpha-neg {
  color: #f38ba8;
  background: rgba(243, 139, 168, 0.1);
}
</style>
