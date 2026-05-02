<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components';

use([BarChart, LineChart, CanvasRenderer, GridComponent, TooltipComponent, LegendComponent]);

interface DistBin {
  lo: number;
  hi: number;
  mid: number;
  count: number;
  normal_expected: number;
}

const props = defineProps<{
  data: {
    bins: DistBin[];
    mean: number;
    std: number;
    skewness: number;
    kurtosis: number;
    total: number;
    is_normal: boolean;
  };
}>();

const chartOptions = computed<EChartsOption>(() => {
  const bins = props.data.bins;
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
    },
    legend: {
      top: 4,
      textStyle: { color: '#a6adc8', fontSize: 10 },
      data: ['Actual', 'Normal fit'],
    },
    grid: { left: 50, right: 20, top: 36, bottom: 40 },
    xAxis: {
      type: 'category',
      data: bins.map((b) => b.mid.toFixed(2)),
      axisLabel: { color: '#a6adc8', fontSize: 10, rotate: 45 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#a6adc8' },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series: [
      {
        name: 'Actual',
        type: 'bar',
        data: bins.map((b) => ({
          value: b.count,
          itemStyle: { color: b.mid >= 0 ? '#a6e3a1' : '#f38ba8', opacity: 0.7 },
        })),
        barWidth: '80%',
      },
      {
        name: 'Normal fit',
        type: 'line',
        data: bins.map((b) => b.normal_expected),
        smooth: true,
        symbol: 'none',
        lineStyle: { color: '#89b4fa', width: 2, type: 'dashed' },
        itemStyle: { color: '#89b4fa' },
      },
    ],
  };
});
</script>

<template>
  <div class="sd-chart-card">
    <div class="dist-stats">
      <span>μ={{ data.mean.toFixed(3) }}%</span>
      <span>σ={{ data.std.toFixed(3) }}%</span>
      <span>Skew={{ data.skewness }}</span>
      <span>Kurt={{ data.kurtosis }}</span>
      <span :class="data.is_normal ? 'dist-normal' : 'dist-non-normal'">
        {{ data.is_normal ? '≈ Normal' : '≠ Normal' }}
      </span>
    </div>
    <ECharts :option="chartOptions" autoresize style="height: 320px" />
  </div>
</template>

<style scoped>
.dist-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  font-family: var(--sd-font-mono);
  font-size: 11px;
  color: #a6adc8;
}

.dist-normal {
  color: #a6e3a1;
  font-weight: 600;
}

.dist-non-normal {
  color: #fab387;
  font-weight: 600;
}
</style>
