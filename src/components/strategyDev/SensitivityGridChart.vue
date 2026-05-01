<script setup lang="ts">
import { computed, ref } from 'vue';
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

interface GridData {
  param_a: string;
  param_b: string;
  grid: (number | null)[][];
  a_range: [number, number];
  b_range: [number, number];
  n_bins: number;
}

const props = defineProps<{ grids: GridData[]; title: string }>();

const selectedGrid = ref(0);

const chartOptions = computed<EChartsOption>(() => {
  const g = props.grids[selectedGrid.value];
  if (!g) return {};

  const data: [number, number, number | null][] = [];
  let minVal = Infinity,
    maxVal = -Infinity;
  for (let ai = 0; ai < g.n_bins; ai++) {
    for (let bi = 0; bi < g.n_bins; bi++) {
      const v = g.grid[ai]?.[bi] ?? null;
      data.push([bi, ai, v]);
      if (v !== null) {
        minVal = Math.min(minVal, v);
        maxVal = Math.max(maxVal, v);
      }
    }
  }

  const aStep = (g.a_range[1] - g.a_range[0]) / g.n_bins;
  const bStep = (g.b_range[1] - g.b_range[0]) / g.n_bins;
  const aLabels = Array.from({ length: g.n_bins }, (_, i) =>
    (g.a_range[0] + i * aStep).toFixed(2),
  );
  const bLabels = Array.from({ length: g.n_bins }, (_, i) =>
    (g.b_range[0] + i * bStep).toFixed(2),
  );

  return {
    title: {
      text: `${g.param_a} \u00d7 ${g.param_b}`,
      left: 'center',
      textStyle: { fontSize: 13 },
    },
    tooltip: {
      formatter: (p: unknown) => {
        const item = p as { value: [number, number, number | null] };
        const v = item.value[2];
        return v !== null ? `Loss: ${v.toFixed(4)}` : 'No data';
      },
    },
    grid: { left: 80, right: 80, top: 40, bottom: 60 },
    xAxis: {
      type: 'category',
      data: bLabels,
      name: g.param_b,
      axisLabel: { fontSize: 10 },
    },
    yAxis: {
      type: 'category',
      data: aLabels,
      name: g.param_a,
      axisLabel: { fontSize: 10 },
    },
    visualMap: {
      min: isFinite(minVal) ? minVal : 0,
      max: isFinite(maxVal) ? maxVal : 1,
      calculable: true,
      orient: 'vertical',
      right: 0,
      top: 'center',
      inRange: { color: ['#a6e3a1', '#f9e2af', '#f38ba8'] },
    },
    series: [
      {
        type: 'heatmap',
        data: data.filter((d) => d[2] !== null),
        label: { show: false },
      },
    ],
  };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <div v-if="grids.length > 1" class="flex gap-1 mb-2 flex-wrap">
      <button
        v-for="(g, i) in grids"
        :key="i"
        class="text-xs px-2 py-1 rounded"
        :class="
          i === selectedGrid
            ? 'bg-primary-600 text-white'
            : 'bg-surface-700 text-surface-400 hover:bg-surface-600'
        "
        @click="selectedGrid = i"
      >
        {{ g.param_a }} &times; {{ g.param_b }}
      </button>
    </div>
    <ECharts :option="chartOptions" autoresize style="height: 350px" />
  </div>
</template>
