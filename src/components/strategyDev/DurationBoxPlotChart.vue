<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BoxplotChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';

use([BoxplotChart, ScatterChart, CanvasRenderer, GridComponent, TooltipComponent, LegendComponent]);

interface BoxData {
  q1: number;
  median: number;
  q3: number;
  min: number;
  max: number;
  whisker_low: number;
  whisker_high: number;
  outliers: number[];
  count: number;
}

interface DurationBoxPlotData {
  all: BoxData | null;
  winners: BoxData | null;
  losers: BoxData | null;
  by_exit_reason: Record<string, BoxData>;
}

const props = defineProps<{ data: DurationBoxPlotData }>();
const { t } = useI18n();

const viewMode = ref<'summary' | 'exit_reason'>('summary');

const C = {
  blue: '#89b4fa',
  green: '#a6e3a1',
  red: '#f38ba8',
  peach: '#fab387',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  surface0: '#1e1e2e',
  surface1: '#313244',
  overlay: '#45475a',
} as const;

function fmtDur(min: number): string {
  if (min < 60) return `${min.toFixed(0)}m`;
  if (min < 1440) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 1440).toFixed(1)}d`;
}

const summaryOptions = computed<EChartsOption>(() => {
  const cats: { name: string; box: BoxData | null; color: string }[] = [
    { name: t('strategyDev.durAll'), box: props.data.all, color: C.blue },
    { name: t('strategyDev.durWinners'), box: props.data.winners, color: C.green },
    { name: t('strategyDev.durLosers'), box: props.data.losers, color: C.red },
  ];
  const validCats = cats.filter(c => c.box);
  if (!validCats.length) return {};

  const labels = validCats.map(c => c.name);
  const boxData = validCats.map(c => [
    c.box!.whisker_low, c.box!.q1, c.box!.median, c.box!.q3, c.box!.whisker_high,
  ]);
  const outlierData: [number, number][] = [];
  validCats.forEach((c, i) => {
    c.box!.outliers.forEach(v => outlierData.push([i, v]));
  });

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: C.surface0,
      borderColor: C.overlay,
      textStyle: { color: C.text, fontSize: 12 },
      formatter: (p: any) => {
        if (p.seriesType === 'scatter') return `Outlier: ${fmtDur(p.value[1])}`;
        const c = validCats[p.dataIndex];
        if (!c?.box) return '';
        const b = c.box;
        return [
          `<b>${c.name}</b> (${b.count} trades)`,
          `Median: ${fmtDur(b.median)}`,
          `Q1–Q3: ${fmtDur(b.q1)} – ${fmtDur(b.q3)}`,
          `Range: ${fmtDur(b.whisker_low)} – ${fmtDur(b.whisker_high)}`,
          b.outliers.length > 0 ? `${b.outliers.length} outliers` : '',
        ].filter(Boolean).join('<br/>');
      },
    },
    grid: { left: 70, right: 30, top: 20, bottom: 30 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: C.subtext, fontSize: 11 },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    yAxis: {
      type: 'value',
      name: t('strategyDev.durMinutes'),
      nameTextStyle: { color: C.subtext, fontSize: 10 },
      axisLabel: { color: C.subtext, formatter: (v: number) => fmtDur(v) },
      splitLine: { lineStyle: { color: C.surface1 } },
    },
    series: [
      {
        type: 'boxplot',
        data: boxData,
        itemStyle: {
          color: 'transparent',
          borderWidth: 2,
        },
        encode: { tooltip: [1, 2, 3, 4, 5] },
      },
      {
        type: 'scatter',
        data: outlierData,
        symbolSize: 4,
        itemStyle: { color: C.peach, opacity: 0.6 },
      },
    ],
  };
});

const exitReasonOptions = computed<EChartsOption>(() => {
  const reasons = props.data.by_exit_reason;
  if (!reasons || !Object.keys(reasons).length) return {};

  const entries = Object.entries(reasons).sort((a, b) => b[1].count - a[1].count);
  const labels = entries.map(([r]) => r);
  const boxData = entries.map(([, b]) => [b.whisker_low, b.q1, b.median, b.q3, b.whisker_high]);

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: C.surface0,
      borderColor: C.overlay,
      textStyle: { color: C.text, fontSize: 12 },
      formatter: (p: any) => {
        if (p.seriesType !== 'boxplot') return '';
        const [r, b] = entries[p.dataIndex];
        return [
          `<b>${r}</b> (${b.count} trades)`,
          `Median: ${fmtDur(b.median)}`,
          `Q1–Q3: ${fmtDur(b.q1)} – ${fmtDur(b.q3)}`,
        ].join('<br/>');
      },
    },
    grid: { left: 100, right: 30, top: 20, bottom: 30 },
    yAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: C.subtext, fontSize: 10 },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    xAxis: {
      type: 'value',
      name: t('strategyDev.durMinutes'),
      nameTextStyle: { color: C.subtext, fontSize: 10 },
      axisLabel: { color: C.subtext, formatter: (v: number) => fmtDur(v) },
      splitLine: { lineStyle: { color: C.surface1 } },
    },
    series: [{
      type: 'boxplot',
      data: boxData,
      itemStyle: { color: 'transparent', borderColor: C.blue, borderWidth: 2 },
    }],
  };
});
</script>

<template>
  <div class="sd-chart-card">
    <div class="flex items-center gap-2 mb-2">
      <button
        class="text-xs px-2 py-1 rounded"
        :class="viewMode === 'summary' ? 'bg-blue-500/20 text-blue-300' : 'bg-surface-700 text-surface-400'"
        @click="viewMode = 'summary'"
      >
        {{ t('strategyDev.durSummary') }}
      </button>
      <button
        v-if="Object.keys(data.by_exit_reason || {}).length"
        class="text-xs px-2 py-1 rounded"
        :class="viewMode === 'exit_reason' ? 'bg-blue-500/20 text-blue-300' : 'bg-surface-700 text-surface-400'"
        @click="viewMode = 'exit_reason'"
      >
        {{ t('strategyDev.durByExitReason') }}
      </button>
    </div>
    <ECharts
      v-if="viewMode === 'summary'"
      :option="summaryOptions"
      autoresize
      style="height: 280px"
    />
    <ECharts
      v-else
      :option="exitReasonOptions"
      autoresize
      style="height: 280px"
    />
  </div>
</template>
