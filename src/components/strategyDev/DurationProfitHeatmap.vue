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
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';

use([HeatmapChart, CanvasRenderer, GridComponent, TooltipComponent, VisualMapComponent]);

interface HeatmapData {
  duration_bins: string[];
  profit_bins: string[];
  matrix: number[][];
  per_pair: Record<string, number[][]>;
}

const props = defineProps<{ data: HeatmapData }>();
const { t } = useI18n();

const selectedPair = ref<string | null>(null);
const pairs = computed(() => Object.keys(props.data.per_pair || {}));

const C = {
  surface0: '#1e1e2e',
  surface1: '#313244',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  overlay: '#45475a',
  blue: '#89b4fa',
  lavender: '#b4befe',
  red: '#f38ba8',
} as const;

const activeMatrix = computed(() => {
  if (selectedPair.value && props.data.per_pair[selectedPair.value]) {
    return props.data.per_pair[selectedPair.value];
  }
  return props.data.matrix;
});

const dangerZone = computed(() => {
  const m = activeMatrix.value;
  const nDur = props.data.duration_bins.length;
  const nPnl = props.data.profit_bins.length;
  let total = 0;
  let dangerCount = 0;
  for (let di = 0; di < nDur; di++) {
    for (let pi = 0; pi < nPnl; pi++) {
      const v = m[di]?.[pi] ?? 0;
      total += v;
      if (di >= nDur - 2 && pi <= 1 && v > 0) dangerCount += v;
    }
  }
  return { count: dangerCount, pct: total > 0 ? (dangerCount / total * 100) : 0 };
});

const chartOptions = computed<EChartsOption>(() => {
  const m = activeMatrix.value;
  const durBins = props.data.duration_bins;
  const pnlBins = props.data.profit_bins;

  const data: [number, number, number][] = [];
  let maxVal = 0;
  for (let di = 0; di < durBins.length; di++) {
    for (let pi = 0; pi < pnlBins.length; pi++) {
      const v = m[di]?.[pi] ?? 0;
      if (v > 0) data.push([pi, di, v]);
      if (v > maxVal) maxVal = v;
    }
  }

  return {
    tooltip: {
      backgroundColor: C.surface0,
      borderColor: C.overlay,
      textStyle: { color: C.text, fontSize: 12 },
      formatter: (p: any) => {
        const pi = p.value[0];
        const di = p.value[1];
        const count = p.value[2];
        const isDanger = di >= durBins.length - 2 && pi <= 1;
        return [
          `<b>${durBins[di]} × ${pnlBins[pi]}</b>`,
          `Trades: ${count}`,
          isDanger ? `<span style="color:${C.red}">⚠ Danger zone</span>` : '',
        ].filter(Boolean).join('<br/>');
      },
    },
    grid: { left: 70, right: 90, top: 10, bottom: 40 },
    xAxis: {
      type: 'category',
      data: pnlBins,
      axisLabel: { color: C.subtext, fontSize: 10, rotate: 30 },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    yAxis: {
      type: 'category',
      data: durBins,
      axisLabel: { color: C.subtext, fontSize: 10 },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    visualMap: {
      min: 0,
      max: Math.max(maxVal, 1),
      calculable: false,
      orient: 'vertical',
      right: 0,
      top: 'center',
      textStyle: { color: C.subtext, fontSize: 10 },
      inRange: { color: [C.surface1, C.blue, C.lavender] },
      itemWidth: 12,
      itemHeight: 100,
    },
    series: [{
      type: 'heatmap',
      data,
      label: {
        show: true,
        color: C.text,
        fontSize: 10,
        formatter: (p: any) => p.value[2] > 0 ? String(p.value[2]) : '',
      },
      itemStyle: { borderWidth: 1, borderColor: C.surface0 },
    }],
  };
});
</script>

<template>
  <div class="sd-chart-card">
    <!-- Pair selector -->
    <div v-if="pairs.length" class="flex items-center gap-2 mb-2 flex-wrap">
      <button
        class="text-xs px-2 py-1 rounded"
        :class="!selectedPair ? 'bg-blue-500/20 text-blue-300' : 'bg-surface-700 text-surface-400'"
        @click="selectedPair = null"
      >
        {{ t('strategyDev.durAllPairs') }}
      </button>
      <button
        v-for="p in pairs"
        :key="p"
        class="text-xs px-2 py-1 rounded"
        :class="selectedPair === p ? 'bg-blue-500/20 text-blue-300' : 'bg-surface-700 text-surface-400'"
        @click="selectedPair = p"
      >
        {{ p }}
      </button>
    </div>

    <ECharts :option="chartOptions" autoresize style="height: 280px" />

    <!-- Danger zone warning -->
    <div
      v-if="dangerZone.pct > 10"
      class="mt-2 text-xs px-2 py-1 rounded"
      :style="{ backgroundColor: '#f38ba814', color: '#f38ba8' }"
    >
      {{ t('strategyDev.durDangerZone', { count: dangerZone.count, pct: dangerZone.pct.toFixed(0) }) }}
    </div>
  </div>
</template>
