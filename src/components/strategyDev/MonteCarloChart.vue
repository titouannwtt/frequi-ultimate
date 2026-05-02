<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { CustomChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent } from 'echarts/components';

use([CustomChart, CanvasRenderer, GridComponent, TooltipComponent, DataZoomComponent]);

// Catppuccin Mocha palette
const C = {
  green: '#a6e3a1',
  red: '#f38ba8',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  surface0: '#1e1e2e',
  surface1: '#313244',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  overlay: '#6c7086',
} as const;

interface MCData {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  mean: number;
  n_simulations: number;
  n_trades: number;
  prob_positive: number;
}

const props = defineProps<{ data: MCData; title: string }>();

const { t } = useI18n();

/**
 * Format a percentage for display.
 * Normal range: 2 decimal places.
 * Large values: K/M/B suffixes.
 * Astronomically large: infinity symbol.
 */
function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return '\u221e';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs < 0.01) return '~0%';
  if (abs < 10000) return `${v.toFixed(1)}%`;
  if (abs < 1e6) return `${sign}${(abs / 1e3).toFixed(1)}K%`;
  if (abs < 1e9) return `${sign}${(abs / 1e6).toFixed(1)}M%`;
  if (abs < 1e12) return `${sign}${(abs / 1e9).toFixed(1)}B%`;
  if (abs < 1e15) return `${sign}${(abs / 1e12).toFixed(1)}T%`;
  return `${sign}\u221e`;
}

/**
 * Clamp value for chart axis display to keep chart readable.
 * Real values are still shown in labels/tooltips.
 */
function clampForChart(v: number): number {
  const cap = 2000;
  if (v > cap) return cap;
  if (v < -cap) return -cap;
  return v;
}

const probColor = computed(() => {
  const p = props.data.prob_positive;
  if (p >= 80) return C.green;
  if (p >= 60) return C.yellow;
  return C.red;
});

const probLabel = computed(() => {
  const p = props.data.prob_positive;
  if (p >= 80) return t('strategyDev.mcRobust');
  if (p >= 60) return t('strategyDev.mcMarginal');
  return t('strategyDev.mcNoEdge');
});

const chartOptions = computed<EChartsOption>(() => {
  const d = props.data;

  const p5c = clampForChart(d.p5);
  const p25c = clampForChart(d.p25);
  const p50c = clampForChart(d.p50);
  const p75c = clampForChart(d.p75);
  const p95c = clampForChart(d.p95);
  const meanc = clampForChart(d.mean);

  const allClamped = [p5c, p25c, p50c, p75c, p95c, meanc];
  const minVal = Math.min(...allClamped, 0);
  const maxVal = Math.max(...allClamped, 0);
  const padding = Math.max(Math.abs(maxVal - minVal) * 0.15, 10);

  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: C.surface1,
      borderColor: C.overlay,
      textStyle: { color: C.text, fontSize: 12 },
      formatter: () => {
        return [
          '<b>Distribution of final returns</b>',
          `P95 (best 5%): ${fmtPct(d.p95)}`,
          `P75 (upper quartile): ${fmtPct(d.p75)}`,
          `P50 (median): ${fmtPct(d.p50)}`,
          `P25 (lower quartile): ${fmtPct(d.p25)}`,
          `P5 (worst 5%): ${fmtPct(d.p5)}`,
          `Mean: ${fmtPct(d.mean)}`,
        ].join('<br/>');
      },
    },
    dataZoom: [
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        height: 18,
        bottom: 4,
        borderColor: '#45475a',
        backgroundColor: '#181825',
        fillerColor: 'rgba(137, 180, 250, 0.15)',
        handleStyle: { color: '#89b4fa' },
        textStyle: { color: '#a6adc8', fontSize: 10 },
        labelFormatter: (v: number) => fmtPct(v),
      },
      {
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
      },
    ],
    grid: { left: 30, right: 30, top: 20, bottom: 55 },
    xAxis: {
      type: 'value',
      min: Math.floor(minVal - padding),
      max: Math.ceil(maxVal + padding),
      axisLabel: {
        color: C.subtext,
        fontSize: 11,
        formatter: (v: number) => fmtPct(v),
      },
      axisLine: { lineStyle: { color: C.overlay } },
      splitLine: { lineStyle: { color: C.surface1, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: [''],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
    },
    series: [
      // Box-plot rendered via custom series
      {
        type: 'custom',
        renderItem: (
          _params: unknown,
          api: Record<string, (...args: unknown[]) => unknown>,
        ) => {
          const catIdx = 0;
          const yCoord = (api.coord([0, catIdx]) as number[])[1];
          const boxH = 40;
          const whiskerH = 20;

          const xP5 = (api.coord([p5c, catIdx]) as number[])[0];
          const xP25 = (api.coord([p25c, catIdx]) as number[])[0];
          const xP50 = (api.coord([p50c, catIdx]) as number[])[0];
          const xP75 = (api.coord([p75c, catIdx]) as number[])[0];
          const xP95 = (api.coord([p95c, catIdx]) as number[])[0];

          const boxColor = d.p25 >= 0 ? C.green : C.red;

          const minLabelGap = 45;
          const topLabels = [
            { x: xP25, text: `P25: ${fmtPct(d.p25)}`, fill: C.subtext, fontSize: 10, fontWeight: 'normal' as const },
            { x: xP50, text: `P50: ${fmtPct(d.p50)}`, fill: C.blue, fontSize: 11, fontWeight: 'bold' as const },
            { x: xP75, text: `P75: ${fmtPct(d.p75)}`, fill: C.subtext, fontSize: 10, fontWeight: 'normal' as const },
          ];
          const baseY = yCoord - boxH / 2 - 8;
          const topY: number[] = [baseY, baseY, baseY];
          if (Math.abs(topLabels[1].x - topLabels[0].x) < minLabelGap) {
            topY[0] = baseY - 14;
          }
          if (Math.abs(topLabels[2].x - topLabels[1].x) < minLabelGap) {
            topY[2] = baseY - 14;
          }
          if (Math.abs(topLabels[2].x - topLabels[0].x) < minLabelGap && topY[0] === topY[2]) {
            topY[0] = baseY - 26;
          }

          const bottomLabels = [
            { x: xP5, text: `P5: ${fmtPct(d.p5)}`, fill: C.subtext },
            { x: xP95, text: `P95: ${fmtPct(d.p95)}`, fill: C.subtext },
          ];
          const bottomBaseY = yCoord + boxH / 2 + 14;
          const bottomY: number[] = [bottomBaseY, bottomBaseY];
          if (Math.abs(bottomLabels[1].x - bottomLabels[0].x) < minLabelGap) {
            bottomY[1] = bottomBaseY + 14;
          }

          const children = [
            {
              type: 'line',
              shape: { x1: xP5, y1: yCoord, x2: xP25, y2: yCoord },
              style: { stroke: C.subtext, lineWidth: 2 },
            },
            {
              type: 'line',
              shape: { x1: xP75, y1: yCoord, x2: xP95, y2: yCoord },
              style: { stroke: C.subtext, lineWidth: 2 },
            },
            {
              type: 'line',
              shape: {
                x1: xP5,
                y1: yCoord - whiskerH / 2,
                x2: xP5,
                y2: yCoord + whiskerH / 2,
              },
              style: { stroke: C.subtext, lineWidth: 2 },
            },
            {
              type: 'line',
              shape: {
                x1: xP95,
                y1: yCoord - whiskerH / 2,
                x2: xP95,
                y2: yCoord + whiskerH / 2,
              },
              style: { stroke: C.subtext, lineWidth: 2 },
            },
            {
              type: 'rect',
              shape: {
                x: Math.min(xP25, xP75),
                y: yCoord - boxH / 2,
                width: Math.abs(xP75 - xP25),
                height: boxH,
              },
              style: {
                fill: `${boxColor}33`,
                stroke: boxColor,
                lineWidth: 2,
              },
            },
            {
              type: 'line',
              shape: {
                x1: xP50,
                y1: yCoord - boxH / 2,
                x2: xP50,
                y2: yCoord + boxH / 2,
              },
              style: { stroke: C.blue, lineWidth: 3 },
            },
            ...bottomLabels.map((lbl, i) => ({
              type: 'text',
              style: {
                text: lbl.text,
                x: lbl.x,
                y: bottomY[i],
                fill: lbl.fill,
                fontSize: 10,
                textAlign: 'center' as const,
              },
            })),
            ...topLabels.map((lbl, i) => ({
              type: 'text',
              style: {
                text: lbl.text,
                x: lbl.x,
                y: topY[i],
                fill: lbl.fill,
                fontSize: lbl.fontSize,
                fontWeight: lbl.fontWeight,
                textAlign: 'center' as const,
              },
            })),
          ];

          return { type: 'group', children };
        },
        data: [0],
        z: 10,
      },
      // Mean marker (diamond)
      {
        type: 'custom',
        renderItem: (
          _params: unknown,
          api: Record<string, (...args: unknown[]) => unknown>,
        ) => {
          const coord = api.coord([meanc, 0]) as number[];
          return {
            type: 'group',
            children: [
              {
                type: 'polygon',
                shape: {
                  points: [
                    [coord[0], coord[1] - 8],
                    [coord[0] + 6, coord[1]],
                    [coord[0], coord[1] + 8],
                    [coord[0] - 6, coord[1]],
                  ],
                },
                style: { fill: C.yellow, stroke: C.yellow, lineWidth: 1 },
              },
              {
                type: 'text',
                style: {
                  text: `Mean: ${fmtPct(d.mean)}`,
                  x: coord[0],
                  y: coord[1] + 38,
                  fill: C.yellow,
                  fontSize: 10,
                  fontWeight: 'bold',
                  textAlign: 'center' as const,
                },
              },
            ],
          };
        },
        data: [0],
        z: 20,
      },
    ],
  };
});

const hasClamped = computed(() => {
  const d = props.data;
  return [d.p5, d.p25, d.p50, d.p75, d.p95, d.mean].some((v) => Math.abs(v) > 2000);
});
</script>

<template>
  <div class="mc-card">
    <!-- Header with title and probability badge -->
    <div class="mc-header">
      <h3 class="mc-title">{{ title }}</h3>
      <div
        class="mc-badge"
        :style="{
          backgroundColor: probColor + '22',
          color: probColor,
          borderColor: probColor,
        }"
      >
        <span class="mc-badge-value">{{ data.prob_positive.toFixed(1) }}%</span>
        <span class="mc-badge-label">{{ t('strategyDev.mcProbPositive') }}</span>
        <span class="mc-badge-verdict">{{ probLabel }}</span>
      </div>
    </div>

    <!-- Box plot chart -->
    <div class="mc-chart-container">
      <ECharts :option="chartOptions" autoresize style="height: 200px; width: 100%" />
      <div class="mc-legend">
        <span class="mc-legend-item">
          <span
            class="mc-legend-box"
            :style="{ borderColor: C.blue, backgroundColor: C.blue }"
          ></span>
          {{ t('strategyDev.mcMedian') }}
        </span>
        <span class="mc-legend-item">
          <span class="mc-legend-diamond" :style="{ backgroundColor: C.yellow }"></span>
          {{ t('strategyDev.mcMean') }}
        </span>
        <span class="mc-legend-item">
          <span
            class="mc-legend-box"
            :style="{
              borderColor: data.p25 >= 0 ? C.green : C.red,
              backgroundColor: 'transparent',
            }"
          ></span>
          {{ t('strategyDev.mcIqr') }}
        </span>
        <span class="mc-legend-item">
          <span class="mc-legend-line" :style="{ backgroundColor: C.subtext }"></span>
          {{ t('strategyDev.mcWhiskers') }}
        </span>
      </div>
    </div>

    <!-- Clamped values warning -->
    <div v-if="hasClamped" class="mc-clamp-warning">
      {{ t('strategyDev.mcClampWarning') }}
    </div>

    <!-- Stats row -->
    <div class="mc-stats">
      <span>{{ t('strategyDev.mcSimulations', { n: data.n_simulations.toLocaleString() }) }}</span>
      <span class="mc-stats-sep">&middot;</span>
      <span>{{ t('strategyDev.mcTrades', { n: data.n_trades.toLocaleString() }) }}</span>
    </div>
  </div>
</template>

<style scoped>
.mc-card {
  background: #1e1e2e;
  border-radius: 12px;
  padding: 16px;
  border: 1px solid #313244;
}

.mc-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
  gap: 12px;
}

.mc-title {
  font-size: 14px;
  font-weight: 600;
  color: #cdd6f4;
  margin: 0;
}

.mc-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid;
  min-width: 100px;
}

.mc-badge-value {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
}

.mc-badge-label {
  font-size: 10px;
  opacity: 0.7;
  margin-top: 2px;
}

.mc-badge-verdict {
  font-size: 11px;
  font-weight: 600;
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.mc-chart-container {
  margin-bottom: 8px;
}

.mc-legend {
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
  font-size: 10px;
  color: #a6adc8;
  margin-top: 4px;
}

.mc-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mc-legend-box {
  width: 10px;
  height: 10px;
  border: 2px solid;
  border-radius: 2px;
  display: inline-block;
}

.mc-legend-diamond {
  width: 8px;
  height: 8px;
  transform: rotate(45deg);
  display: inline-block;
}

.mc-legend-line {
  width: 14px;
  height: 2px;
  display: inline-block;
}

.mc-clamp-warning {
  font-size: 10px;
  color: #f9e2af;
  text-align: center;
  padding: 4px 8px;
  background: rgba(249, 226, 175, 0.07);
  border-radius: 6px;
  margin-bottom: 8px;
}

.mc-stats {
  display: flex;
  justify-content: center;
  gap: 6px;
  font-size: 11px;
  color: #a6adc8;
  margin-bottom: 8px;
}

.mc-stats-sep {
  opacity: 0.5;
}
</style>
