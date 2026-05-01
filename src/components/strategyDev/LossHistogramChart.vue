<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
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

interface BinData {
  lo: number;
  hi: number;
  count: number;
}

interface HistogramData {
  bins: BinData[];
  best_loss: number;
  best_percentile: number;
}

const props = defineProps<{
  histogram: HistogramData;
  title: string;
}>();

const { t } = useI18n();

/** Catppuccin Mocha palette */
const cat = {
  green: '#a6e3a1',
  yellow: '#f9e2af',
  red: '#f38ba8',
  teal: '#94e2d5',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  surface: '#313244',
  overlay: '#45475a',
};

function fmtNum(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1e6 || abs < 0.001) return v.toExponential(1);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(3);
}

function getAssessment(pct: number): { label: string; color: string } {
  if (pct >= 90)
    return { label: t('strategyDev.lhExceptional', { pct: (100 - pct).toFixed(0) }), color: cat.green };
  if (pct >= 50)
    return { label: t('strategyDev.lhDecent'), color: cat.yellow };
  return { label: t('strategyDev.lhStruggled'), color: cat.red };
}

const assessment = computed(() => getAssessment(props.histogram.best_percentile));

const chartOptions = computed<EChartsOption>(() => {
  const bins = props.histogram.bins;
  const bestLoss = props.histogram.best_loss;
  const bestPct = props.histogram.best_percentile;
  const nBins = bins.length;

  // Quartile boundaries: top 25% (lowest loss) = green, middle 50% = yellow, bottom 25% = red
  const greenEnd = Math.ceil(nBins * 0.25);
  const redStart = Math.floor(nBins * 0.75);

  const labels = bins.map((b) => `${fmtNum(b.lo)} \u2013 ${fmtNum(b.hi)}`);
  const barData = bins.map((b, i) => {
    let color: string;
    if (i < greenEnd) color = cat.green;
    else if (i >= redStart) color = cat.red;
    else color = cat.yellow;
    return { value: b.count, itemStyle: { color, opacity: 0.85 } };
  });

  // Find bin containing best_loss for the mark line
  let bestBinIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < bins.length; i++) {
    const mid = (bins[i].lo + bins[i].hi) / 2;
    const d = Math.abs(mid - bestLoss);
    if (d < bestDist) {
      bestDist = d;
      bestBinIdx = i;
    }
  }

  const assessInfo = getAssessment(bestPct);

  return {
    title: {
      text: props.title,
      subtext: `Best loss: ${fmtNum(bestLoss)} \u2014 beats ${bestPct.toFixed(0)}% of epochs`,
      left: 'center',
      textStyle: { fontSize: 14, color: cat.text },
      subtextStyle: { fontSize: 11, color: assessInfo.color },
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = (params as { name: string; value: number }[])[0];
        if (!p) return '';
        return `<b>${p.name}</b><br/>Epochs: ${p.value}`;
      },
    },
    grid: { left: 60, right: 30, top: 55, bottom: 70 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        rotate: 40,
        fontSize: 9,
        color: cat.subtext,
        interval: nBins > 20 ? Math.floor(nBins / 10) : 0,
      },
      axisLine: { lineStyle: { color: cat.overlay } },
    },
    yAxis: {
      type: 'value',
      name: 'Epochs',
      nameTextStyle: { fontSize: 11, color: cat.subtext },
      axisLabel: { color: cat.subtext },
      splitLine: { lineStyle: { color: cat.surface } },
    },
    series: [
      {
        type: 'bar',
        data: barData,
        barWidth: '90%',
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: cat.teal, type: 'dashed', width: 2 },
          label: {
            formatter: `Best: ${fmtNum(bestLoss)}`,
            fontSize: 10,
            color: cat.teal,
          },
          data: [{ xAxis: bestBinIdx }],
        },
      },
    ],
  };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 340px" />

    <!-- Assessment badge -->
    <div class="flex items-center justify-center mt-2">
      <span
        class="text-sm font-semibold px-2 py-1 rounded"
        :style="{ color: '#1e1e2e', backgroundColor: assessment.color }"
      >
        {{ assessment.label }}
      </span>
    </div>

  </div>
</template>
