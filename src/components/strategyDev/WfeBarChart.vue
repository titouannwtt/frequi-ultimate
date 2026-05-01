<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import { GridComponent, TitleComponent, TooltipComponent } from 'echarts/components';

use([BarChart, CanvasRenderer, GridComponent, TitleComponent, TooltipComponent]);

const props = defineProps<{
  data: { index: number; wfe: number }[];
  title: string;
}>();

const chartOptions = computed<EChartsOption>(() => ({
  title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
  tooltip: { trigger: 'axis' },
  grid: { left: 50, right: 20, top: 40, bottom: 30 },
  xAxis: { type: 'category', name: 'Window', data: props.data.map((d) => `W${d.index}`) },
  yAxis: { type: 'value', name: 'WFE' },
  series: [
    {
      type: 'bar',
      data: props.data.map((d) => ({
        value: d.wfe,
        itemStyle: { color: d.wfe >= 0.5 ? '#10b981' : d.wfe >= 0.2 ? '#f59e0b' : '#ef4444' },
      })),
    },
  ],
}));
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 300px" />
  </div>
</template>
