<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import {
  GridComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';

use([BarChart, CanvasRenderer, GridComponent, TitleComponent, TooltipComponent]);

const props = defineProps<{
  data: Record<string, unknown>[];
  title: string;
}>();

const chartOptions = computed<EChartsOption>(() => {
  const sorted = [...props.data].sort(
    (a, b) => ((b.profit_pct as number) ?? 0) - ((a.profit_pct as number) ?? 0),
  );
  const pairs = sorted.map((d) => (d.pair as string) ?? '');
  const profits = sorted.map((d) => (d.profit_pct as number) ?? 0);

  return {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    grid: { left: 120, right: 20, top: 40, bottom: 30 },
    yAxis: { type: 'category', data: pairs, inverse: true },
    xAxis: { type: 'value', name: 'Profit %' },
    series: [
      {
        type: 'bar',
        data: profits.map((v) => ({
          value: v,
          itemStyle: { color: v >= 0 ? '#10b981' : '#ef4444' },
        })),
      },
    ],
  };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts
      :option="chartOptions"
      autoresize
      :style="{ height: `${Math.max(200, data.length * 25 + 60)}px` }"
    />
  </div>
</template>
