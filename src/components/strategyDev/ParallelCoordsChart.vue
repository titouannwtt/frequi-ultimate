<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { ParallelChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  ParallelComponent,
} from 'echarts/components';

use([
  ParallelChart,
  CanvasRenderer,
  TitleComponent,
  TooltipComponent,
  ParallelComponent,
]);

interface PCLine {
  values: Record<string, number>;
  loss: number;
}

interface PCData {
  params: string[];
  lines: PCLine[];
  actual_ranges?: Record<string, { min: number; max: number }>;
}

const props = defineProps<{ data: PCData; title: string }>();

const { t } = useI18n();

const N_BINS = 10;

function shortenNames(params: string[]): string[] {
  if (params.length <= 1) return params;
  const split = params.map((p) => p.split('_'));
  const minLen = Math.min(...split.map((s) => s.length));
  let commonPrefixLen = 0;
  for (let i = 0; i < minLen - 1; i++) {
    if (split.every((s) => s[i] === split[0][i])) {
      commonPrefixLen = i + 1;
    } else {
      break;
    }
  }
  return split.map((parts) => parts.slice(commonPrefixLen).join('_'));
}

function lossColor(t: number): string {
  const r = Math.round(166 + (243 - 166) * t);
  const g = Math.round(227 + (139 - 227) * t);
  const b = Math.round(161 + (168 - 161) * t);
  return `rgb(${r},${g},${b})`;
}

function fmtVal(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 10000) return String(v);
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

function denormalize(norm: number, min: number, max: number): number {
  return min + norm * (max - min);
}

const shortNames = computed(() => shortenNames(props.data.params));

const chartOptions = computed<EChartsOption>(() => {
  const { params, lines, actual_ranges } = props.data;
  if (!params.length || !lines.length) return {};

  const hasRanges = actual_ranges && Object.keys(actual_ranges).length > 0;

  const sortedLines = [...lines].sort((a, b) => b.loss - a.loss);
  const losses = lines.map((l) => l.loss);
  const minLoss = Math.min(...losses);
  const maxLoss = Math.max(...losses);
  const lossRange = maxLoss - minLoss || 1;
  const bestLine = lines.reduce((a, b) => (a.loss < b.loss ? a : b));

  const parallelAxis = params.map((p, i) => {
    const range = hasRanges && actual_ranges![p];
    if (range) {
      return {
        dim: i,
        name: shortNames.value[i],
        min: range.min,
        max: range.max,
        nameTextStyle: { fontSize: 10, color: '#a6adc8' },
        axisLabel: {
          show: true,
          color: '#6c7086',
          fontSize: 9,
          formatter: (val: number) => fmtVal(val),
        },
        axisTick: { show: true },
      };
    }
    return {
      dim: i,
      name: shortNames.value[i],
      min: 0,
      max: 1,
      nameTextStyle: { fontSize: 10, color: '#a6adc8' },
      axisLabel: { show: true, color: '#6c7086', fontSize: 9 },
      axisTick: { show: true },
    };
  });

  function lineValues(line: PCLine): number[] {
    return params.map((p) => {
      const norm = line.values[p] ?? 0.5;
      const range = hasRanges && actual_ranges![p];
      if (range) return denormalize(norm, range.min, range.max);
      return norm;
    });
  }

  const seriesData = sortedLines
    .filter((line) => line !== bestLine)
    .map((line) => {
      const t = (line.loss - minLoss) / lossRange;
      return {
        value: lineValues(line),
        lineStyle: {
          color: lossColor(t),
          width: 1.2,
          opacity: 0.35 + 0.25 * (1 - t),
        },
      };
    });

  const bestData = [
    {
      value: lineValues(bestLine),
      lineStyle: {
        color: '#a6e3a1',
        width: 3.5,
        opacity: 1,
      },
    },
  ];

  return {
    title: { text: props.title, left: 'center', top: 4, textStyle: { fontSize: 14, color: '#cdd6f4' } },
    parallelAxis,
    parallel: { left: 60, right: 60, top: 80, bottom: 50 },
    series: [
      {
        type: 'parallel',
        lineStyle: { width: 1.2 },
        data: seriesData,
        smooth: false,
        z: 1,
      },
      {
        type: 'parallel',
        lineStyle: { width: 3.5 },
        data: bestData,
        smooth: false,
        z: 10,
      },
    ],
  };
});

interface QualityBin {
  color: string;
  opacity: number;
  count: number;
}

interface ParamStrip {
  name: string;
  bins: QualityBin[];
  bestBinIndex: number;
  minLabel: string;
  maxLabel: string;
}

const qualityStrips = computed<ParamStrip[]>(() => {
  const { params, lines, actual_ranges } = props.data;
  if (!params.length || !lines.length) return [];

  const losses = lines.map((l) => l.loss);
  const minLoss = Math.min(...losses);
  const maxLoss = Math.max(...losses);
  const lossRange = maxLoss - minLoss || 1;
  const best = lines.reduce((a, b) => (a.loss < b.loss ? a : b));
  const hasRanges = actual_ranges && Object.keys(actual_ranges).length > 0;

  return params.map((p, pi) => {
    const range = hasRanges && actual_ranges![p];
    const pMin = range ? range.min : 0;
    const pMax = range ? range.max : 1;
    const pRange = pMax - pMin || 1;
    const binSize = pRange / N_BINS;

    const binLosses: number[][] = Array.from({ length: N_BINS }, () => []);

    for (const line of lines) {
      const norm = line.values[p] ?? 0.5;
      const actual = range ? denormalize(norm, pMin, pMax) : norm;
      const bi = Math.min(Math.floor((actual - pMin) / binSize), N_BINS - 1);
      binLosses[bi].push((line.loss - minLoss) / lossRange);
    }

    const bestNorm = best.values[p] ?? 0.5;
    const bestActual = range ? denormalize(bestNorm, pMin, pMax) : bestNorm;
    const bestBi = Math.min(Math.floor((bestActual - pMin) / binSize), N_BINS - 1);

    const bins: QualityBin[] = binLosses.map((bl) => {
      if (bl.length === 0) {
        return { color: '#313244', opacity: 0.3, count: 0 };
      }
      const avgLoss = bl.reduce((s, v) => s + v, 0) / bl.length;
      return {
        color: lossColor(avgLoss),
        opacity: 0.4 + 0.5 * (bl.length / lines.length),
        count: bl.length,
      };
    });

    return {
      name: shortNames.value[pi],
      bins,
      bestBinIndex: bestBi,
      minLabel: fmtVal(pMin),
      maxLabel: fmtVal(pMax),
    };
  });
});

const bestEpochInfo = computed(() => {
  const { params, lines, actual_ranges } = props.data;
  if (!lines.length) return [];
  const best = lines.reduce((a, b) => (a.loss < b.loss ? a : b));
  const hasRanges = actual_ranges && Object.keys(actual_ranges).length > 0;
  return params.map((p, i) => {
    const norm = best.values[p] ?? 0.5;
    const range = hasRanges && actual_ranges![p];
    const actual = range ? denormalize(norm, range.min, range.max) : norm;
    return {
      name: shortNames.value[i],
      formatted: fmtVal(actual),
    };
  });
});

const bestLoss = computed(() => {
  if (!props.data.lines.length) return 0;
  return props.data.lines.reduce((a, b) => (a.loss < b.loss ? a : b)).loss;
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <ECharts :option="chartOptions" autoresize style="height: 420px" />

    <!-- Parameter Quality Strips -->
    <div v-if="qualityStrips.length" class="quality-section">
      <div class="quality-title">{{ t('strategyDev.pcQualityMap') }}</div>
      <div class="quality-grid">
        <div v-for="strip in qualityStrips" :key="strip.name" class="quality-row">
          <span class="quality-label">{{ strip.name }}</span>
          <span class="quality-range-label">{{ strip.minLabel }}</span>
          <div class="quality-bins">
            <div
              v-for="(bin, j) in strip.bins"
              :key="j"
              class="quality-bin"
              :style="{
                backgroundColor: bin.color,
                opacity: bin.opacity,
              }"
              :title="`${strip.name} bin ${j + 1}: ${bin.count} epochs`"
            >
              <div v-if="j === strip.bestBinIndex" class="quality-best-marker" />
            </div>
          </div>
          <span class="quality-range-label">{{ strip.maxLabel }}</span>
        </div>
      </div>
      <div class="quality-legend">
        <span class="quality-legend-item">
          <span class="quality-legend-swatch" style="background: #a6e3a1" />
          {{ t('strategyDev.pcQualityGood') }}
        </span>
        <span class="quality-legend-item">
          <span class="quality-legend-swatch" style="background: #f9e2af" />
          {{ t('strategyDev.pcQualityMedium') }}
        </span>
        <span class="quality-legend-item">
          <span class="quality-legend-swatch" style="background: #f38ba8" />
          {{ t('strategyDev.pcQualityBad') }}
        </span>
        <span class="quality-legend-item">
          <span class="quality-legend-swatch quality-legend-empty" />
          {{ t('strategyDev.pcQualityNoData') }}
        </span>
        <span class="quality-legend-item">
          <span class="quality-best-marker-legend" />
          {{ t('strategyDev.pcQualityBest') }}
        </span>
      </div>
    </div>

    <!-- Best epoch values -->
    <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-2 px-2 justify-center">
      <span class="text-green-400 font-medium">
        {{ t('strategyDev.pcBestEpoch', { loss: bestLoss.toFixed(4) }) }}
      </span>
      <span
        v-for="info in bestEpochInfo"
        :key="info.name"
        class="text-surface-400"
      >
        {{ info.name }}=<span class="text-green-300 font-mono">{{ info.formatted }}</span>
      </span>
    </div>

    <!-- Legend -->
    <div class="flex gap-4 text-sm text-surface-500 mt-2 px-2 justify-center">
      <span class="flex items-center gap-1">
        <span class="w-6 h-0.5 inline-block rounded" style="background: #a6e3a1"></span>
        {{ t('strategyDev.pcBestLowLoss') }}
      </span>
      <span class="flex items-center gap-1">
        <span class="w-6 h-0.5 inline-block rounded" style="background: #f38ba8"></span>
        {{ t('strategyDev.pcWorstHighLoss') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.quality-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #313244;
}

.quality-title {
  font-size: 11px;
  font-weight: 600;
  color: #a6adc8;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.quality-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.quality-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.quality-label {
  font-size: 10px;
  color: #a6adc8;
  min-width: 90px;
  text-align: right;
  font-family: monospace;
  flex-shrink: 0;
}

.quality-range-label {
  font-size: 9px;
  color: #6c7086;
  min-width: 40px;
  font-family: monospace;
  flex-shrink: 0;
}

.quality-range-label:first-of-type {
  text-align: right;
}

.quality-range-label:last-of-type {
  text-align: left;
}

.quality-bins {
  display: flex;
  flex: 1;
  gap: 1px;
  height: 18px;
  border-radius: 3px;
  overflow: hidden;
}

.quality-bin {
  flex: 1;
  position: relative;
  transition: opacity 0.15s ease;
}

.quality-bin:hover {
  opacity: 1 !important;
}

.quality-best-marker {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cdd6f4;
  border: 2px solid #1e1e2e;
  box-shadow: 0 0 4px rgba(205, 214, 244, 0.6);
}

.quality-legend {
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 8px;
  flex-wrap: wrap;
}

.quality-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #6c7086;
}

.quality-legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.quality-legend-empty {
  background: #313244 !important;
  opacity: 0.3;
}

.quality-best-marker-legend {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cdd6f4;
  border: 2px solid #6c7086;
  flex-shrink: 0;
}
</style>
