<script setup lang="ts">
import { computed } from 'vue';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import {
  GridComponent,
  TitleComponent,
  TooltipComponent,
  MarkLineComponent,
} from 'echarts/components';

use([BarChart, CanvasRenderer, GridComponent, TitleComponent, TooltipComponent, MarkLineComponent]);

interface MCData {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  mean: number;
  n_simulations: number;
  n_trades: number;
  prob_positive: number;
}

const props = defineProps<{ data: MCData; title: string }>();

const chartOptions = computed<EChartsOption>(() => {
  const d = props.data;
  const labels = ['P5', 'P25', 'P50 (Median)', 'Mean', 'P75', 'P95'];
  const values = [d.p5, d.p25, d.p50, d.mean, d.p75, d.p95];
  const colors = values.map((v) => (v >= 0 ? '#a6e3a1' : '#f38ba8'));

  return {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = Array.isArray(params) ? params[0] : params;
        const item = p as { name: string; value: number };
        return `${item.name}: ${item.value.toFixed(2)}%`;
      },
    },
    grid: { left: 120, right: 40, top: 50, bottom: 40 },
    xAxis: {
      type: 'value',
      name: 'Return %',
      axisLabel: { formatter: '{value}%' },
    },
    yAxis: {
      type: 'category',
      data: labels,
    },
    series: [
      {
        type: 'bar',
        data: values.map((v, i) => ({
          value: v,
          itemStyle: { color: colors[i] },
        })),
        label: {
          show: true,
          position: 'right',
          formatter: (p: unknown) => {
            const item = p as { value: number };
            return `${item.value.toFixed(1)}%`;
          },
          fontSize: 11,
        },
      },
    ],
  };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 300px" />
    <div class="flex justify-between text-xs text-surface-500 mt-2 px-2">
      <span>{{ data.n_simulations }} simulations &middot; {{ data.n_trades }} trades</span>
      <span :class="data.prob_positive >= 50 ? 'text-green-400' : 'text-red-400'">
        P(profit &gt; 0) = {{ data.prob_positive }}%
      </span>
    </div>
  </div>
</template>
