<script setup lang="ts">
import { computed, ref } from 'vue';
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
  raw_losses?: number[];
}

const props = defineProps<{
  histogram: HistogramData;
  title: string;
}>();

const { t } = useI18n();

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

const nBinsOverride = ref(0);

function fmtNum(v: number): string {
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  if (abs >= 1e6 || abs < 0.001) return v.toExponential(1);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(3);
}

function rebinLosses(losses: number[], nBins: number): BinData[] {
  if (!losses.length || nBins < 1) return [];
  const lo = Math.min(...losses);
  const hi = Math.max(...losses);
  const bw = hi > lo ? (hi - lo) / nBins : 1.0;
  const bins: BinData[] = [];
  for (let i = 0; i < nBins; i++) {
    const edgeLo = lo + i * bw;
    const edgeHi = lo + (i + 1) * bw;
    const count = i === nBins - 1
      ? losses.filter(v => v >= edgeLo && v <= edgeHi).length
      : losses.filter(v => v >= edgeLo && v < edgeHi).length;
    bins.push({ lo: +edgeLo.toFixed(4), hi: +edgeHi.toFixed(4), count });
  }
  return bins;
}

const activeBins = computed(() => {
  if (nBinsOverride.value > 0 && props.histogram.raw_losses?.length) {
    return rebinLosses(props.histogram.raw_losses, nBinsOverride.value);
  }
  return props.histogram.bins;
});

function getAssessment(pct: number): { label: string; color: string } {
  if (pct >= 90)
    return { label: t('strategyDev.lhExceptional', { pct: (100 - pct).toFixed(0) }), color: cat.green };
  if (pct >= 50)
    return { label: t('strategyDev.lhDecent'), color: cat.yellow };
  return { label: t('strategyDev.lhStruggled'), color: cat.red };
}

const assessment = computed(() => getAssessment(props.histogram.best_percentile));

const insights = computed(() => {
  const bins = activeBins.value;
  const bestPct = props.histogram.best_percentile;
  const totalEpochs = bins.reduce((s, b) => s + b.count, 0);
  const items: { text: string; color: string; icon: 'check' | 'warn' | 'danger' }[] = [];

  const topQuartileBins = bins.slice(0, Math.max(1, Math.ceil(bins.length * 0.25)));
  const topQuartileCount = topQuartileBins.reduce((s, b) => s + b.count, 0);
  const topQuartilePct = totalEpochs > 0 ? (topQuartileCount / totalEpochs) * 100 : 0;

  if (topQuartilePct > 40) {
    items.push({
      text: t('strategyDev.lhInsightConcentrated', { pct: topQuartilePct.toFixed(0) }),
      color: cat.green,
      icon: 'check',
    });
  } else if (topQuartilePct < 15) {
    items.push({
      text: t('strategyDev.lhInsightSparse'),
      color: cat.red,
      icon: 'danger',
    });
  }

  const bestBin = bins[0];
  if (bestBin && bestBin.count <= 2 && totalEpochs > 50) {
    items.push({
      text: t('strategyDev.lhInsightOverfit'),
      color: cat.red,
      icon: 'danger',
    });
  }

  if (bestPct >= 95 && topQuartilePct > 30) {
    items.push({
      text: t('strategyDev.lhInsightExcellent'),
      color: cat.green,
      icon: 'check',
    });
  }

  const peak = Math.max(...bins.map(b => b.count));
  const peakBins = bins.filter(b => b.count === peak);
  if (peakBins.length > 0) {
    const peakIdx = bins.indexOf(peakBins[0]);
    const halfIdx = Math.floor(bins.length / 2);
    if (peakIdx <= Math.ceil(bins.length * 0.25)) {
      items.push({
        text: t('strategyDev.lhInsightPeakLow'),
        color: cat.green,
        icon: 'check',
      });
    } else if (peakIdx >= halfIdx) {
      items.push({
        text: t('strategyDev.lhInsightPeakHigh'),
        color: cat.yellow,
        icon: 'warn',
      });
    }
  }

  return items;
});

const chartOptions = computed<EChartsOption>(() => {
  const maxReasonable = (() => {
    const nonEmpty = activeBins.value.filter(b => b.count > 0);
    if (nonEmpty.length <= 2) return Infinity;
    const sorted = [...nonEmpty].sort((a, b) => b.count - a.count);
    const peakHi = sorted[0].hi;
    return peakHi + (Math.abs(peakHi) + 1) * 3;
  })();
  const filteredBins = activeBins.value.filter(b => b.lo < maxReasonable);
  const bins = filteredBins;
  const bestLoss = props.histogram.best_loss;
  const bestPct = props.histogram.best_percentile;
  const nBins = bins.length;

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
      subtext: t('strategyDev.lhSubtitle', { loss: fmtNum(bestLoss), pct: bestPct.toFixed(0) }),
      left: 'center',
      textStyle: { fontSize: 14, color: cat.text },
      subtextStyle: { fontSize: 11, color: assessInfo.color },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const p = (params as { name: string; value: number }[])[0];
        if (!p) return '';
        const total = activeBins.value.reduce((s, b) => s + b.count, 0);
        const pct = total > 0 ? ((p.value / total) * 100).toFixed(1) : '0';
        return `<b>${p.name}</b><br/>${t('strategyDev.metricEpochs')}: ${p.value} (${pct}%)`;
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
      name: t('strategyDev.metricEpochs'),
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

    <!-- Bin slider -->
    <div v-if="histogram.raw_losses?.length" class="flex items-center gap-3 mt-2 px-1">
      <label class="text-xs text-surface-400 whitespace-nowrap">Bins:</label>
      <input
        v-model.number="nBinsOverride"
        type="range"
        :min="0"
        :max="40"
        :step="1"
        class="flex-1 h-1 accent-blue-400"
      />
      <span class="text-xs text-surface-400 tabular-nums w-8 text-right">
        {{ nBinsOverride || histogram.bins.length }}
      </span>
    </div>

    <!-- Insights -->
    <div v-if="insights.length" class="flex flex-col gap-1.5 mt-3">
      <div
        v-for="(ins, idx) in insights"
        :key="idx"
        class="flex items-start gap-2 px-3 py-1.5 rounded text-xs"
        :style="{ backgroundColor: ins.color + '14', color: ins.color }"
      >
        <i-mdi-check-circle v-if="ins.icon === 'check'" class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <i-mdi-alert v-else-if="ins.icon === 'warn'" class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <i-mdi-close-circle v-else class="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{{ ins.text }}</span>
      </div>
    </div>

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
