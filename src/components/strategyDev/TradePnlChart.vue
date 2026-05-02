<script setup lang="ts">
import { computed } from 'vue';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
} from 'echarts/components';

use([BarChart, CanvasRenderer, GridComponent, TooltipComponent, MarkLineComponent]);

interface Distribution {
  bins: number[];
  counts: number[];
  total: number;
  mean: number;
  median: number;
  std: number;
  avg_win: number;
  avg_loss: number;
  best_trade: number;
  worst_trade: number;
}

const props = defineProps<{
  distribution: Distribution;
}>();

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function binLabel(bins: number[], i: number): string {
  return `${bins[i].toFixed(1)}% .. ${bins[i + 1].toFixed(1)}%`;
}

const chartOptions = computed<EChartsOption>(() => {
  const { bins, counts, mean, median } = props.distribution;
  // bins has N+1 edges, counts has N values
  const labels = counts.map((_, i) => binLabel(bins, i));
  const midpoints = counts.map((_, i) => (bins[i] + bins[i + 1]) / 2);

  const barData = counts.map((count, i) => ({
    value: count,
    itemStyle: {
      color: midpoints[i] >= 0 ? '#a6e3a1' : '#f38ba8',
      opacity: 0.85,
    },
  }));

  // Find bin indices closest to mean and median for markLine
  const findClosestBin = (target: number): number => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < midpoints.length; i++) {
      const d = Math.abs(midpoints[i] - target);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  };

  const meanIdx = findClosestBin(mean);
  const medianIdx = findClosestBin(median);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#313244',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const p = (params as { name: string; value: number }[])[0];
        if (!p) return '';
        return `<b>${p.name}</b><br/>Count: ${p.value}`;
      },
    },
    grid: { left: 50, right: 20, top: 20, bottom: 60 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        rotate: 40,
        fontSize: 9,
        color: '#a6adc8',
        interval: labels.length > 20 ? Math.floor(labels.length / 10) : 0,
      },
      axisLine: { lineStyle: { color: '#45475a' } },
    },
    yAxis: {
      type: 'value',
      name: 'Count',
      nameTextStyle: { fontSize: 11, color: '#a6adc8' },
      axisLabel: { color: '#a6adc8' },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series: [
      {
        type: 'bar',
        data: barData,
        barWidth: '90%',
        markLine: {
          silent: true,
          symbol: 'none',
          data: [
            {
              xAxis: meanIdx,
              lineStyle: { color: '#89b4fa', type: 'dashed', width: 2 },
              label: {
                formatter: `Mean: ${fmtPct(mean)}`,
                fontSize: 10,
                color: '#89b4fa',
              },
            },
            {
              xAxis: medianIdx,
              lineStyle: { color: '#f9e2af', type: 'dashed', width: 2 },
              label: {
                formatter: `Median: ${fmtPct(median)}`,
                fontSize: 10,
                color: '#f9e2af',
                position: 'insideEndBottom',
              },
            },
          ],
        },
      },
    ],
  };
});

const stats = computed(() => [
  { label: 'Total Trades', value: props.distribution.total.toString() },
  { label: 'Mean', value: fmtPct(props.distribution.mean) },
  { label: 'Median', value: fmtPct(props.distribution.median) },
  { label: 'Std Dev', value: `${props.distribution.std.toFixed(2)}%` },
  { label: 'Avg Win', value: fmtPct(props.distribution.avg_win) },
  { label: 'Avg Loss', value: fmtPct(props.distribution.avg_loss) },
  { label: 'Best Trade', value: fmtPct(props.distribution.best_trade) },
  { label: 'Worst Trade', value: fmtPct(props.distribution.worst_trade) },
]);
</script>

<template>
  <div class="trade-pnl-chart">
    <ECharts :option="chartOptions" autoresize style="height: 280px" />

    <div class="pnl-stats-grid">
      <div v-for="s in stats" :key="s.label" class="pnl-stat-card">
        <span class="pnl-stat-label">{{ s.label }}</span>
        <span class="pnl-stat-value">{{ s.value }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trade-pnl-chart {
  background: var(--sd-surface0, #313244);
  border: 1px solid var(--sd-border-subtle, #45475a);
  border-radius: var(--sd-radius-md, 8px);
  padding: 12px;
}

.pnl-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-top: 12px;
}

.pnl-stat-card {
  background: var(--sd-base, #1e1e2e);
  border: 1px solid var(--sd-border-subtle, #45475a);
  border-radius: var(--sd-radius-sm, 4px);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pnl-stat-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--sd-overlay, #45475a);
}

.pnl-stat-value {
  font-family: var(--sd-font-mono, monospace);
  font-size: var(--sd-text-sm, 13px);
  font-weight: 700;
  color: var(--sd-text, #cdd6f4);
}
</style>
