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

const { t } = useI18n();

const maxAbsCorrelation = computed(() => {
  let max = 0;
  for (const c of props.correlations) {
    const abs = Math.abs(c.correlation);
    if (abs > max) max = abs;
  }
  return max;
});

const advisory = computed<{ color: string; bgColor: string; text: string }>(() => {
  const max = maxAbsCorrelation.value;
  if (max > 0.7) {
    return {
      color: '#f9e2af',
      bgColor: 'rgba(249, 226, 175, 0.12)',
      text: t('strategyDev.corrRedundant'),
    };
  }
  if (max < 0.3) {
    return {
      color: '#a6e3a1',
      bgColor: 'rgba(166, 227, 161, 0.12)',
      text: t('strategyDev.corrIndependent'),
    };
  }
  return {
    color: '#cdd6f4',
    bgColor: 'rgba(205, 214, 244, 0.08)',
    text: t('strategyDev.corrModerate', { val: max.toFixed(2) }),
  };
});

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
        const r = item.value[2];
        const abs = Math.abs(r);
        let strength = t('strategyDev.corrWeak');
        let strengthColor = '#a6e3a1';
        if (abs > 0.7) { strength = t('strategyDev.corrStrong'); strengthColor = '#f38ba8'; }
        else if (abs > 0.3) { strength = t('strategyDev.corrMod'); strengthColor = '#f9e2af'; }
        return `<b>${params[item.value[0]]}</b> × <b>${params[item.value[1]]}</b><br/>`
          + `${t('strategyDev.corrCoeff')}: <b style="color:${strengthColor}">${r.toFixed(3)}</b><br/>`
          + `${t('strategyDev.corrStrength')}: <span style="color:${strengthColor}">${strength}</span>`;
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
      inRange: { color: ['#89b4fa', '#45475a', '#f38ba8'] },
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
    <ECharts :option="chartOptions" autoresize style="height: 380px" />

    <!-- Advisory badge -->
    <div
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
