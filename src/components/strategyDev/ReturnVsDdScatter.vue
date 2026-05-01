<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';

use([ScatterChart, CanvasRenderer, GridComponent, TitleComponent, TooltipComponent]);

const props = defineProps<{
  data: Record<string, unknown>[];
  title: string;
}>();

const chartOptions = computed<EChartsOption>(() => {
  const points = props.data.map((d) => [(d.dd as number) ?? 0, (d.profit as number) ?? 0]);

  return {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: {
      trigger: 'item',
      formatter: (p: unknown) => {
        const params = p as { value: number[] };
        return `DD: ${params.value[0].toFixed(1)}%<br/>Profit: ${params.value[1].toFixed(1)}%`;
      },
    },
    grid: { left: 60, right: 20, top: 40, bottom: 40 },
    xAxis: { type: 'value', name: 'Max DD %', nameLocation: 'center', nameGap: 25 },
    yAxis: { type: 'value', name: 'Profit %' },
    series: [
      {
        type: 'scatter',
        data: points,
        symbolSize: 6,
        itemStyle: { color: '#10b981', opacity: 0.6 },
      },
    ],
  };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 300px" />
  </div>
</template>
