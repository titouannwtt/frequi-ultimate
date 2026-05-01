<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';

use([LineChart, CanvasRenderer, GridComponent, TitleComponent, TooltipComponent]);

const props = defineProps<{
  data: number[];
  title: string;
}>();

const chartOptions = computed<EChartsOption>(() => ({
  title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
  tooltip: { trigger: 'axis' },
  grid: { left: 60, right: 20, top: 40, bottom: 30 },
  xAxis: { type: 'category', name: 'Epoch', data: props.data.map((_, i) => i + 1) },
  yAxis: { type: 'value', name: 'Loss' },
  series: [
    {
      type: 'line',
      data: props.data,
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 1.5 },
      areaStyle: { opacity: 0.15 },
    },
  ],
}));
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 300px" />
  </div>
</template>
