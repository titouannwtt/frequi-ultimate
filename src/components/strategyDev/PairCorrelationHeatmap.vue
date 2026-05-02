<script setup lang="ts">
import { computed } from 'vue';
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

const C = {
  surface0: '#1e1e2e',
  surface1: '#313244',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  overlay: '#45475a',
  blue: '#89b4fa',
  lavender: '#b4befe',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  peach: '#fab387',
  mauve: '#cba6f7',
} as const;

interface PairCorrelationData {
  pairs: string[];
  matrix: number[][];
  avg_correlation: number;
  highly_correlated: { pair_a: string; pair_b: string; correlation: number }[];
  hhi: number;
  hhi_label: string;
  top_pair_pct: number;
  top_pair: string;
  max_simultaneous_loss: {
    max_loss_abs: number;
    max_loss_date: string;
    max_loss_count: number;
    max_loss_pairs: string[];
  };
  pair_stats: { pair: string; trades: number; volume_pct: number }[];
}

const props = defineProps<{ data: PairCorrelationData }>();

const { t } = useI18n();

const chartHeight = computed(() => {
  const n = props.data.pairs.length;
  return Math.min(500, Math.max(200, n * 40 + 80));
});

const shortPairNames = computed(() =>
  props.data.pairs.map((p) => p.replace(/\/USDC:USDC$/, '').replace(/\/USDT:USDT$/, '')),
);

const chartOptions = computed<EChartsOption>(() => {
  const { pairs, matrix } = props.data;
  const n = pairs.length;

  const heatData: [number, number, number][] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      heatData.push([col, row, matrix[row][col]]);
    }
  }

  const showLabels = n <= 10;

  return {
    tooltip: {
      formatter: (p: unknown) => {
        const item = p as { value: [number, number, number] };
        const [col, row, val] = item.value;
        const abs = Math.abs(val);
        let strength = t('strategyDev.corrWeak');
        let strengthColor = C.green;
        if (abs > 0.7) {
          strength = t('strategyDev.corrStrong');
          strengthColor = C.red;
        } else if (abs > 0.3) {
          strength = t('strategyDev.corrMod');
          strengthColor = C.yellow;
        }
        return (
          `<b>${shortPairNames.value[row]}</b> × <b>${shortPairNames.value[col]}</b><br/>`
          + `${t('strategyDev.corrCoeff')}: <b style="color:${strengthColor}">${val.toFixed(3)}</b><br/>`
          + `${t('strategyDev.corrStrength')}: <span style="color:${strengthColor}">${strength}</span>`
        );
      },
      backgroundColor: C.surface0,
      borderColor: C.overlay,
      textStyle: { color: C.text, fontSize: 12 },
    },
    grid: { left: 100, right: 80, top: 10, bottom: 80 },
    xAxis: {
      type: 'category',
      data: shortPairNames.value,
      axisLabel: { rotate: 45, fontSize: 10, color: C.subtext },
      axisLine: { lineStyle: { color: C.overlay } },
      splitArea: { show: true, areaStyle: { color: ['transparent', 'rgba(255,255,255,0.02)'] } },
    },
    yAxis: {
      type: 'category',
      data: shortPairNames.value,
      axisLabel: { fontSize: 10, color: C.subtext },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    visualMap: {
      min: -1,
      max: 1,
      calculable: true,
      orient: 'vertical',
      right: 0,
      top: 'center',
      itemHeight: 120,
      textStyle: { color: C.subtext, fontSize: 10 },
      inRange: { color: [C.blue, C.overlay, C.red] },
    },
    series: [
      {
        type: 'heatmap',
        data: heatData,
        label: {
          show: showLabels,
          formatter: (p: unknown) => {
            const item = p as { value: [number, number, number] };
            return item.value[2].toFixed(2);
          },
          fontSize: 9,
          color: C.text,
        },
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' },
        },
        itemStyle: {
          borderWidth: 1,
          borderColor: C.surface0,
        },
      },
    ],
  };
});

const highlyCorrelatedPairs = computed(() =>
  props.data.highly_correlated.filter((p) => p.correlation > 0.6),
);

function corrBadgeColor(corr: number): string {
  if (corr > 0.8) return C.red;
  if (corr > 0.7) return C.peach;
  return C.yellow;
}
</script>

<template>
  <div class="sd-chart-card">
    <ECharts :option="chartOptions" autoresize :style="{ height: chartHeight + 'px' }" />

    <!-- Highly correlated pairs badges -->
    <div v-if="highlyCorrelatedPairs.length" class="mt-3">
      <div class="text-xs font-semibold uppercase tracking-wide mb-2" :style="{ color: C.subtext }">
        {{ t('strategyDev.corrHighlyCorrelated') }}
      </div>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="(pair, i) in highlyCorrelatedPairs"
          :key="i"
          class="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
          :style="{
            color: corrBadgeColor(pair.correlation),
            backgroundColor: corrBadgeColor(pair.correlation) + '18',
            border: '1px solid ' + corrBadgeColor(pair.correlation) + '40',
          }"
        >
          {{ pair.pair_a.replace(/\/USDC:USDC$/, '') }} &times;
          {{ pair.pair_b.replace(/\/USDC:USDC$/, '') }}
          <span class="tabular-nums font-bold">{{ pair.correlation.toFixed(2) }}</span>
        </span>
      </div>
    </div>
  </div>
</template>
