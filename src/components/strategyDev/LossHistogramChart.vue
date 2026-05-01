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
  MarkLineComponent,
} from 'echarts/components';

use([BarChart, CanvasRenderer, GridComponent, TitleComponent, TooltipComponent, MarkLineComponent]);

const props = defineProps<{
  histogram: Record<string, unknown>;
  title: string;
}>();

const chartOptions = computed<EChartsOption>(() => {
  const raw = props.histogram.bins;
  let labels: string[];
  let counts: number[];
  let bestLoss: number | null = null;

  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object') {
    const bins = raw as { lo: number; hi: number; count: number }[];
    labels = bins.map(b => `${b.lo.toFixed(3)}–${b.hi.toFixed(3)}`);
    counts = bins.map(b => b.count);
    bestLoss = (props.histogram.best_loss as number) ?? null;
  } else {
    const binEdges = (raw ?? []) as number[];
    counts = (props.histogram.counts ?? []) as number[];
    labels = binEdges.slice(0, -1).map((b, i) => `${b.toFixed(3)}–${binEdges[i + 1].toFixed(3)}`);
  }

  return {
    title: {
      text: props.title,
      subtext: bestLoss != null ? `Best: ${bestLoss.toFixed(4)}` : undefined,
      left: 'center',
      textStyle: { fontSize: 14 },
    },
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 20, top: bestLoss != null ? 55 : 40, bottom: 60 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { rotate: 45, fontSize: 9 },
    },
    yAxis: { type: 'value', name: 'Count' },
    series: [
      {
        type: 'bar',
        data: counts,
        itemStyle: { color: '#cba6f7' },
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
