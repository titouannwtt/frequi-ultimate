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
  green: '#a6e3a1',
  red: '#f38ba8',
  surface0: '#1e1e2e',
  surface1: '#313244',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  overlay: '#6c7086',
} as const;

interface MonthlyEntry {
  year: number;
  month: number;
  profit_abs: number;
  trades: number;
}

const props = defineProps<{ data: MonthlyEntry[] }>();

const { locale } = useI18n();

const MONTHS = computed(() => {
  const loc = locale.value || 'en';
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(2000, i, 1);
    return new Intl.DateTimeFormat(loc, { month: 'short' }).format(d);
  });
});

const years = computed(() => {
  const ySet = new Set<number>();
  for (const d of props.data) ySet.add(d.year);
  return [...ySet].sort((a, b) => b - a); // latest year on top
});

const chartHeight = computed(() => Math.max(200, years.value.length * 40 + 80));

const maxAbs = computed(() => {
  let m = 0;
  for (const d of props.data) {
    const abs = Math.abs(d.profit_abs);
    if (abs > m) m = abs;
  }
  return m || 1;
});

function fmtProfit(v: number): string {
  if (Math.abs(v) >= 1000) return `${v >= 0 ? '+' : ''}${(v / 1000).toFixed(1)}K`;
  if (Math.abs(v) >= 100) return `${v >= 0 ? '+' : ''}${v.toFixed(0)}`;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

const chartOptions = computed<EChartsOption>(() => {
  const yLabels = years.value.map(String);

  // Build lookup for trades count
  const lookup = new Map<string, MonthlyEntry>();
  for (const d of props.data) {
    lookup.set(`${d.year}-${d.month}`, d);
  }

  const heatData: [number, number, number][] = [];
  for (let yi = 0; yi < years.value.length; yi++) {
    for (let mi = 0; mi < 12; mi++) {
      const entry = lookup.get(`${years.value[yi]}-${mi + 1}`);
      heatData.push([mi, yi, entry ? entry.profit_abs : 0]);
    }
  }

  return {
    tooltip: {
      formatter: (p: unknown) => {
        const item = p as { value: [number, number, number] };
        const [mi, yi, val] = item.value;
        const year = years.value[yi];
        const month = MONTHS.value[mi];
        const entry = lookup.get(`${year}-${mi + 1}`);
        const trades = entry ? entry.trades : 0;
        const color = val >= 0 ? C.green : C.red;
        return `<b>${month} ${year}</b><br/>`
          + `<span style="color:${color}">${fmtProfit(val)}</span>`
          + ` (${trades} trade${trades !== 1 ? 's' : ''})`;
      },
      backgroundColor: C.surface1,
      borderColor: C.overlay,
      textStyle: { color: C.text, fontSize: 12 },
    },
    grid: { left: 60, right: 80, top: 10, bottom: 30 },
    xAxis: {
      type: 'category',
      data: MONTHS.value,
      splitArea: { show: true, areaStyle: { color: ['transparent', 'rgba(255,255,255,0.02)'] } },
      axisLabel: { color: C.subtext, fontSize: 11 },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    yAxis: {
      type: 'category',
      data: yLabels,
      axisLabel: { color: C.subtext, fontSize: 11 },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    visualMap: {
      min: -maxAbs.value,
      max: maxAbs.value,
      calculable: true,
      orient: 'vertical',
      right: 0,
      top: 'center',
      itemHeight: 100,
      textStyle: { color: C.subtext, fontSize: 10 },
      inRange: {
        color: [C.red, '#45475a', C.green],
      },
    },
    series: [
      {
        type: 'heatmap',
        data: heatData,
        label: {
          show: true,
          formatter: (p: unknown) => {
            const item = p as { value: [number, number, number] };
            const val = item.value[2];
            if (val === 0) return '';
            return fmtProfit(val);
          },
          fontSize: 10,
          color: (p: unknown) => {
            const item = p as { value: [number, number, number] };
            const ratio = Math.abs(item.value[2]) / maxAbs.value;
            return ratio > 0.3 ? '#1e1e2e' : C.text;
          },
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
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize :style="{ height: chartHeight + 'px' }" />
  </div>
</template>
