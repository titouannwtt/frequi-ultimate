<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkAreaComponent,
  LegendComponent,
} from 'echarts/components';
import { useRegimeOverlay, type RegimeTimelineEntry } from '@/composables/useRegimeOverlay';

use([LineChart, CanvasRenderer, GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, LegendComponent]);

const { t } = useI18n();

const props = withDefaults(defineProps<{
  equity: { date: string; balance: number }[];
  startingBalance: number;
  benchmark?: { date: string; balance: number }[];
  benchmarkLabel?: string;
  showBenchmarkToggle?: boolean;
  regimes?: RegimeTimelineEntry[];
}>(), {
  benchmark: undefined,
  benchmarkLabel: 'BTC',
  showBenchmarkToggle: false,
  regimes: undefined,
});

const regimeTimeline = computed(() => props.regimes);
const { showRegimes, markAreaData } = useRegimeOverlay(regimeTimeline);

const hasBenchmark = computed(() => props.benchmark && props.benchmark.length > 0);

const alpha = computed(() => {
  if (!hasBenchmark.value || !props.equity.length || !props.benchmark!.length) return null;
  const stratBal = props.equity[props.equity.length - 1].balance;
  const btcBal = props.benchmark![props.benchmark!.length - 1].balance;
  const stratRet = ((stratBal - props.startingBalance) / props.startingBalance) * 100;
  const btcRet = ((btcBal - props.startingBalance) / props.startingBalance) * 100;
  return Math.round((stratRet - btcRet) * 100) / 100;
});

const option = computed<EChartsOption>(() => {
  const dates = props.equity.map((e) => e.date);
  const balances = props.equity.map((e) => e.balance);

  const benchmarkMap = new Map<string, number>();
  if (hasBenchmark.value) {
    for (const p of props.benchmark!) {
      benchmarkMap.set(p.date, p.balance);
    }
  }
  const benchmarkBalances = hasBenchmark.value
    ? dates.map((d) => benchmarkMap.get(d) ?? null)
    : [];

  const series: EChartsOption['series'] = [
    {
      name: t('strategyDev.eqStrategy'),
      type: 'line',
      data: balances,
      symbol: 'none',
      smooth: false,
      lineStyle: { width: 2, color: '#89b4fa' },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(137,180,250,0.25)' },
            { offset: 1, color: 'rgba(137,180,250,0)' },
          ],
        },
      },
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', color: '#6c7086', width: 1 },
        label: {
          show: true,
          position: 'insideEndTop',
          color: '#6c7086',
          fontSize: 10,
          formatter: `Start: ${props.startingBalance}`,
        },
        data: [{ yAxis: props.startingBalance }],
      },
      markArea: markAreaData.value.length ? { silent: true, data: markAreaData.value as any } : undefined,
      z: 2,
    },
  ];

  if (hasBenchmark.value) {
    series.push({
      name: props.benchmarkLabel,
      type: 'line',
      data: benchmarkBalances,
      symbol: 'none',
      smooth: false,
      lineStyle: { width: 1.8, color: '#fab387', type: 'dashed' },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(250,179,135,0.08)' },
            { offset: 1, color: 'rgba(250,179,135,0)' },
          ],
        },
      },
      z: 1,
    });
  }

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const items = params as { seriesName: string; data: number | null; axisValue: string; color: string }[];
        if (!items?.length) return '';
        const lines = [`<b>${items[0].axisValue}</b>`];
        for (const item of items) {
          if (item.data == null) continue;
          const bal = item.data;
          const ret = ((bal - props.startingBalance) / props.startingBalance) * 100;
          const sign = ret >= 0 ? '+' : '';
          lines.push(
            `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color};margin-right:4px"></span>`
            + `${item.seriesName}: <b>${bal.toFixed(2)}</b> (${sign}${ret.toFixed(2)}%)`,
          );
        }
        return lines.join('<br/>');
      },
    },
    legend: hasBenchmark.value ? {
      show: true,
      top: 4,
      right: 20,
      textStyle: { color: '#a6adc8', fontSize: 11 },
      itemWidth: 16,
      itemHeight: 2,
      data: [
        { name: t('strategyDev.eqStrategy'), icon: 'roundRect', itemStyle: { color: '#89b4fa' } },
        { name: props.benchmarkLabel, icon: 'roundRect', itemStyle: { color: '#fab387' } },
      ],
    } : undefined,
    grid: { left: 60, right: 20, top: hasBenchmark.value ? 36 : 20, bottom: 60 },
    dataZoom: [
      { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'none',
        height: 18,
        bottom: 4,
        borderColor: '#45475a',
        backgroundColor: '#181825',
        fillerColor: 'rgba(137,180,250,0.15)',
        handleStyle: { color: '#89b4fa', borderColor: '#89b4fa' },
        textStyle: { color: '#a6adc8', fontSize: 10 },
        dataBackground: { lineStyle: { color: '#45475a' }, areaStyle: { color: '#313244' } },
      },
    ],
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: {
        color: '#a6adc8',
        fontSize: 11,
        interval: Math.max(Math.floor(dates.length / 8), 1),
      },
      axisLine: { lineStyle: { color: '#45475a' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#a6adc8', fontSize: 11 },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series,
  };
});
</script>

<template>
  <div class="eq-chart-wrap">
    <div v-if="hasBenchmark && alpha != null" class="eq-alpha-badge" :class="alpha >= 0 ? 'eq-alpha-pos' : 'eq-alpha-neg'">
      <span class="eq-alpha-label">Alpha</span>
      <span class="eq-alpha-value">{{ alpha >= 0 ? '+' : '' }}{{ alpha.toFixed(2) }}%</span>
    </div>
    <div v-if="regimes?.length" class="regime-toggle">
      <button
        class="regime-toggle-btn"
        :class="{ active: showRegimes }"
        @click="showRegimes = !showRegimes"
      >
        <span class="regime-dot" />
        {{ t('strategyDev.regimeShowOverlay') }}
      </button>
    </div>
    <ECharts :option="option" autoresize style="height: 300px" />
  </div>
</template>

<style scoped>
.eq-chart-wrap {
  position: relative;
}

.eq-alpha-badge {
  position: absolute;
  top: 6px;
  left: 12px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--sd-font-mono, monospace);
  border: 1px solid;
  backdrop-filter: blur(6px);
}

.eq-alpha-pos {
  background: rgba(166, 227, 161, 0.12);
  border-color: rgba(166, 227, 161, 0.3);
  color: #a6e3a1;
}

.eq-alpha-neg {
  background: rgba(243, 139, 168, 0.12);
  border-color: rgba(243, 139, 168, 0.3);
  color: #f38ba8;
}

.eq-alpha-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.7;
}

.regime-toggle {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 4px;
}
.regime-toggle-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid rgba(69, 71, 90, 0.4);
  background: transparent;
  color: #a6adc8;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.regime-toggle-btn:hover {
  border-color: rgba(69, 71, 90, 0.7);
  color: #cdd6f4;
}
.regime-toggle-btn.active {
  background: rgba(137, 180, 250, 0.12);
  border-color: rgba(137, 180, 250, 0.4);
  color: #89b4fa;
}
.regime-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: linear-gradient(135deg, #a6e3a1, #f9e2af, #89b4fa, #f38ba8);
}
</style>
