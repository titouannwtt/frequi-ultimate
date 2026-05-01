<script setup lang="ts">
import { computed } from 'vue';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { HeatmapChart } from 'echarts/charts';
import {
  GridComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';

use([
  HeatmapChart,
  CanvasRenderer,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
]);

interface CorrEntry {
  param_a: string;
  param_b: string;
  correlation: number;
}

const props = defineProps<{ correlations: CorrEntry[]; title: string }>();

const chartOptions = computed<EChartsOption>(() => {
  const paramSet = new Set<string>();
  for (const c of props.correlations) {
    paramSet.add(c.param_a);
    paramSet.add(c.param_b);
  }
  const params = [...paramSet].sort();
  const idxMap = new Map(params.map((p, i) => [p, i]));

  const data: [number, number, number][] = [];
  for (const c of props.correlations) {
    const ai = idxMap.get(c.param_a)!;
    const bi = idxMap.get(c.param_b)!;
    data.push([ai, bi, c.correlation]);
    data.push([bi, ai, c.correlation]);
  }
  for (let i = 0; i < params.length; i++) data.push([i, i, 1]);

  const shortNames = params.map((p) => {
    const parts = p.split('_');
    return parts.length > 2 ? parts.slice(-2).join('_') : p;
  });

  return {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: {
      formatter: (p: unknown) => {
        const item = p as { value: [number, number, number] };
        return `${params[item.value[0]]} \u00d7 ${params[item.value[1]]}: ${item.value[2].toFixed(3)}`;
      },
    },
    grid: { left: 100, right: 60, top: 40, bottom: 100 },
    xAxis: {
      type: 'category',
      data: shortNames,
      axisLabel: { rotate: 45, fontSize: 10 },
    },
    yAxis: { type: 'category', data: shortNames, axisLabel: { fontSize: 10 } },
    visualMap: {
      min: -1,
      max: 1,
      calculable: true,
      orient: 'vertical',
      right: 0,
      top: 'center',
      inRange: { color: ['#f38ba8', '#45475a', '#89b4fa'] },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: params.length <= 8,
          formatter: (p: unknown) => {
            const item = p as { value: [number, number, number] };
            return item.value[2].toFixed(2);
          },
          fontSize: 9,
        },
      },
    ],
  };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 400px" />
  </div>
</template>
