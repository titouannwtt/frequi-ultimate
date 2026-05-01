<script setup lang="ts">
import { computed } from 'vue';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { ParallelChart } from 'echarts/charts';
import { TitleComponent, TooltipComponent, ParallelComponent } from 'echarts/components';

use([ParallelChart, CanvasRenderer, TitleComponent, TooltipComponent, ParallelComponent]);

interface PCData {
  params: string[];
  lines: { values: Record<string, number>; loss: number }[];
}

const props = defineProps<{ data: PCData; title: string }>();

const chartOptions = computed<EChartsOption>(() => {
  const shortNames = props.data.params.map((p) => {
    const parts = p.split('_');
    return parts.length > 2 ? parts.slice(-2).join('_') : p;
  });

  return {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
    parallelAxis: props.data.params.map((_, i) => ({
      dim: i,
      name: shortNames[i],
      min: 0,
      max: 1,
      nameTextStyle: { fontSize: 10 },
    })),
    parallel: { left: 60, right: 60, top: 50, bottom: 30 },
    series: [
      {
        type: 'parallel',
        lineStyle: { width: 2, opacity: 0.6 },
        data: props.data.lines.map((line, i) => ({
          value: props.data.params.map((p) => line.values[p] ?? 0.5),
          lineStyle: {
            color: i === 0 ? '#a6e3a1' : i < 3 ? '#89b4fa' : '#6c7086',
            opacity: i === 0 ? 1 : 0.5,
          },
        })),
      },
    ],
  };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 350px" />
    <div class="flex gap-4 text-xs text-surface-500 mt-1 px-2 justify-center">
      <span class="flex items-center gap-1"
        ><span class="w-3 h-0.5 bg-green-400 inline-block"></span> Best</span
      >
      <span class="flex items-center gap-1"
        ><span class="w-3 h-0.5 bg-blue-400 inline-block"></span> Top 3</span
      >
      <span class="flex items-center gap-1"
        ><span class="w-3 h-0.5 bg-surface-500 inline-block"></span> Top 10</span
      >
    </div>
  </div>
</template>
