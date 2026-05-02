<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
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

const { t } = useI18n();
const selectedGrid = ref(0);

const advisory = computed<{ color: string; bgColor: string; text: string }>(() => {
  const g = props.grids[selectedGrid.value];
  if (!g) return { color: '#cdd6f4', bgColor: 'transparent', text: '' };

  const values: number[] = [];
  for (let ai = 0; ai < g.n_bins; ai++) {
    for (let bi = 0; bi < g.n_bins; bi++) {
      const v = g.grid[ai]?.[bi] ?? null;
      if (v !== null) values.push(v);
    }
  }
  if (values.length < 2) {
    return {
      color: '#cdd6f4',
      bgColor: 'rgba(205, 214, 244, 0.08)',
      text: t('strategyDev.sensNotEnoughData'),
    };
  }

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const cv = mean !== 0 ? Math.sqrt(variance) / Math.abs(mean) : 0;

  if (cv < 0.05) {
    return {
      color: '#a6e3a1',
      bgColor: 'rgba(166, 227, 161, 0.12)',
      text: t('strategyDev.sensWeakInteraction'),
    };
  }
  if (cv > 0.15) {
    return {
      color: '#f9e2af',
      bgColor: 'rgba(249, 226, 175, 0.12)',
      text: t('strategyDev.sensStrongInteraction'),
    };
  }
  return {
    color: '#cdd6f4',
    bgColor: 'rgba(205, 214, 244, 0.08)',
    text: t('strategyDev.sensModerateInteraction', { cv: (cv * 100).toFixed(1) }),
  };
});

const chartOptions = computed<EChartsOption>(() => {
  const g = props.grids[selectedGrid.value];
  if (!g) return {};

  const aStep = (g.a_range[1] - g.a_range[0]) / g.n_bins;
  const bStep = (g.b_range[1] - g.b_range[0]) / g.n_bins;

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
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (p: unknown) => {
        const item = p as { value: [number, number, number | null] };
        const bi = item.value[0];
        const ai = item.value[1];
        const v = item.value[2];

        const aLo = (g.a_range[0] + ai * aStep).toFixed(3);
        const aHi = (g.a_range[0] + (ai + 1) * aStep).toFixed(3);
        const bLo = (g.b_range[0] + bi * bStep).toFixed(3);
        const bHi = (g.b_range[0] + (bi + 1) * bStep).toFixed(3);

        const lossStr = v !== null ? v.toFixed(4) : 'No data';
        return [
          `<strong>${g.param_a}</strong>: ${aLo} \u2013 ${aHi}`,
          `<strong>${g.param_b}</strong>: ${bLo} \u2013 ${bHi}`,
          `<strong>Loss</strong>: ${lossStr}`,
        ].join('<br/>');
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
        class="text-sm px-2 py-1 rounded"
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
    <ECharts :option="chartOptions" autoresize style="height: 380px" />

    <!-- Advisory badge -->
    <div
      v-if="advisory.text"
      class="mt-3 px-3 py-2 rounded-md text-sm font-medium flex items-center gap-2"
      :style="{ backgroundColor: advisory.bgColor, color: advisory.color }"
    >
      <span
        class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
        :style="{ backgroundColor: advisory.color }"
      />
      {{ advisory.text }}
    </div>
  </div>
</template>
