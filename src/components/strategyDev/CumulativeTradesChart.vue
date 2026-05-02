<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  MarkAreaComponent,
} from 'echarts/components';
import { useRegimeOverlay, type RegimeTimelineEntry } from '@/composables/useRegimeOverlay';

use([
  LineChart,
  ScatterChart,
  CanvasRenderer,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  LegendComponent,
  MarkAreaComponent,
]);

interface TradePoint {
  index: number;
  date: string;
  cumulative_pct: number;
  balance: number;
  profit: number;
}

const props = defineProps<{
  trades: TradePoint[];
  regimes?: RegimeTimelineEntry[];
}>();

const { t } = useI18n();

const regimeTimeline = computed(() => props.regimes);
const { showRegimes, markAreaData } = useRegimeOverlay(regimeTimeline);

const chartOptions = computed<EChartsOption>(() => {
  const dates = props.trades.map((t) => t.date);
  const cumPct = props.trades.map((t) => t.cumulative_pct);
  const balances = props.trades.map((t) => t.balance);
  const profits = props.trades.map((t) => t.profit);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number }[];
        if (!ps.length) return '';
        const idx = ps[0].dataIndex;
        const t = props.trades[idx];
        return [
          `<b>${t.date}</b>`,
          `Cumulative: <b>${t.cumulative_pct >= 0 ? '+' : ''}${t.cumulative_pct.toFixed(2)}%</b>`,
          `Balance: <b>${t.balance.toFixed(2)}</b>`,
          `Trade profit: <b>${t.profit >= 0 ? '+' : ''}${t.profit.toFixed(2)}%</b>`,
        ].join('<br/>');
      },
    },
    legend: {
      data: [t('strategyDev.seriesCumulativePct'), t('strategyDev.seriesBalance'), t('strategyDev.seriesTradePnL')],
      top: 0,
      textStyle: { color: '#a6adc8', fontSize: 11 },
    },
    grid: { left: 60, right: 60, top: 35, bottom: 60 },
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
    yAxis: [
      {
        type: 'value',
        name: t('strategyDev.seriesCumulativePct'),
        nameTextStyle: { color: '#89b4fa' },
        axisLabel: { color: '#a6adc8', fontSize: 11 },
        splitLine: { lineStyle: { color: '#313244' } },
      },
      {
        type: 'value',
        name: t('strategyDev.seriesBalance'),
        nameTextStyle: { color: '#cba6f7' },
        axisLabel: { color: '#a6adc8', fontSize: 11 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: t('strategyDev.seriesCumulativePct'),
        type: 'line',
        yAxisIndex: 0,
        data: cumPct,
        symbol: 'none',
        lineStyle: { width: 2, color: '#89b4fa' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(137,180,250,0.3)' },
              { offset: 1, color: 'rgba(137,180,250,0)' },
            ],
          },
        },
        markArea: markAreaData.value.length ? { silent: true, data: markAreaData.value as any } : undefined,
      },
      {
        name: t('strategyDev.seriesBalance'),
        type: 'line',
        yAxisIndex: 1,
        data: balances,
        symbol: 'none',
        lineStyle: { width: 2, color: '#cba6f7' },
      },
      {
        name: t('strategyDev.seriesTradePnL'),
        type: 'scatter',
        yAxisIndex: 0,
        data: profits,
        symbolSize: 4,
        itemStyle: {
          color: (p: unknown) => {
            const params = p as { data: number };
            return params.data >= 0 ? '#a6e3a1' : '#f38ba8';
          },
        },
      },
    ],
  };
});
</script>

<template>
  <div>
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
    <ECharts :option="chartOptions" autoresize style="height: 320px" />
  </div>
</template>

<style scoped>
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
