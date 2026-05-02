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
  MarkAreaComponent,
  DataZoomComponent,
  LegendComponent,
} from 'echarts/components';

use([LineChart, CanvasRenderer, GridComponent, TooltipComponent, MarkAreaComponent, DataZoomComponent, LegendComponent]);

const { t } = useI18n();

interface MarketRegimeData {
  regime_labels: string[];
  daily_performance: {
    regime: string;
    days: number;
    pct_time: number;
    total_profit: number;
    avg_daily_profit: number;
    winrate: number;
  }[];
  trade_performance: {
    regime: string;
    trades: number;
    avg_profit: number;
    total_profit: number;
    winrate: number;
  }[];
  transition_matrix: number[][];
  timeline: { date: string; regime: string; volatility: number; trend: number }[];
  insights: string[];
  window: number;
}

const C = {
  surface0: '#1e1e2e',
  surface1: '#313244',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  overlay: '#45475a',
  blue: '#89b4fa',
  lavender: '#b4befe',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  peach: '#fab387',
  mauve: '#cba6f7',
  teal: '#94e2d5',
} as const;

const REGIME_COLORS: Record<string, string> = {
  bull_quiet: '#a6e3a1',
  bull_volatile: '#f9e2af',
  bear_quiet: '#89b4fa',
  bear_volatile: '#f38ba8',
};

const REGIME_LABEL_KEYS: Record<string, string> = {
  bull_quiet: 'strategyDev.regimeBullQuiet',
  bull_volatile: 'strategyDev.regimeBullVolatile',
  bear_quiet: 'strategyDev.regimeBearQuiet',
  bear_volatile: 'strategyDev.regimeBearVolatile',
};

function regimeLabel(regime: string): string {
  const key = REGIME_LABEL_KEYS[regime];
  return key ? t(key) : regime;
}

const props = defineProps<{
  data: MarketRegimeData;
  equity?: Array<{ date: string; balance: number }>;
}>();

const chartOptions = computed<EChartsOption>(() => {
  const timeline = props.data.timeline;
  if (!timeline || timeline.length === 0) {
    return {};
  }

  const dates = timeline.map((d) => d.date);
  const volatilities = timeline.map((d) => d.volatility);

  // Build equity data aligned to timeline dates
  const hasEquity = props.equity && props.equity.length > 0;
  let equityMap: Record<string, number> = {};
  if (hasEquity) {
    for (const e of props.equity!) {
      equityMap[e.date] = e.balance;
    }
  }
  const equityData = hasEquity ? dates.map((d) => equityMap[d] ?? null) : [];

  // Build markArea items from contiguous regime blocks
  const markAreaData: Array<[Record<string, unknown>, Record<string, unknown>]> = [];
  let blockStart = 0;
  for (let i = 1; i <= timeline.length; i++) {
    if (i === timeline.length || timeline[i].regime !== timeline[blockStart].regime) {
      const regime = timeline[blockStart].regime;
      const color = REGIME_COLORS[regime] ?? C.overlay;
      markAreaData.push([
        {
          xAxis: dates[blockStart],
          itemStyle: { color: color + '25' },
        },
        {
          xAxis: dates[i - 1],
        },
      ]);
      blockStart = i;
    }
  }

  const yAxes: any[] = [
    {
      type: 'value',
      name: t('strategyDev.regimeVolatility'),
      nameTextStyle: { color: C.subtext, fontSize: 11 },
      axisLabel: { color: C.subtext, fontSize: 10 },
      splitLine: { lineStyle: { color: C.surface1 } },
    },
  ];

  if (hasEquity) {
    yAxes.push({
      type: 'value',
      name: t('strategyDev.regimeEquity'),
      nameTextStyle: { color: C.subtext, fontSize: 11 },
      position: 'right',
      axisLabel: { color: C.subtext, fontSize: 10 },
      splitLine: { show: false },
    });
  }

  const series: any[] = [
    {
      type: 'line',
      name: t('strategyDev.regimeVolatility'),
      data: volatilities,
      yAxisIndex: 0,
      symbol: 'none',
      smooth: true,
      lineStyle: { color: C.lavender, width: 1.5 },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: C.lavender + '30' },
            { offset: 1, color: C.lavender + '05' },
          ],
        },
      },
      markArea: {
        silent: true,
        data: markAreaData as any,
      },
    },
  ];

  if (hasEquity) {
    series.push({
      type: 'line',
      name: t('strategyDev.regimeEquity'),
      data: equityData,
      yAxisIndex: 1,
      symbol: 'none',
      smooth: true,
      lineStyle: { color: C.green, width: 2 },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: C.green + '20' },
            { offset: 1, color: C.green + '05' },
          ],
        },
      },
    });
  }

  const legendData = [t('strategyDev.regimeVolatility')];
  if (hasEquity) legendData.push(t('strategyDev.regimeEquity'));

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: C.surface0,
      borderColor: C.overlay,
      textStyle: { color: C.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number; seriesName: string; value: number }[];
        if (!ps.length) return '';
        const idx = ps[0].dataIndex;
        const item = timeline[idx];
        const label = regimeLabel(item.regime);
        const dotColor = REGIME_COLORS[item.regime] ?? C.subtext;
        const lines = [
          `<b>${item.date}</b>`,
          `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};margin-right:4px"></span>${t('strategyDev.regimeShowOverlay')}: <b>${label}</b>`,
          `${t('strategyDev.regimeVolatility')}: <b>${item.volatility.toFixed(4)}</b>`,
          `${t('strategyDev.regimeTrend')}: <b>${item.trend >= 0 ? '+' : ''}${item.trend.toFixed(4)}</b>`,
        ];
        if (hasEquity) {
          const eqVal = equityData[idx];
          if (eqVal != null) {
            lines.push(`${t('strategyDev.regimeEquity')}: <b>${Number(eqVal).toFixed(2)}</b>`);
          }
        }
        return lines.join('<br/>');
      },
    },
    legend: {
      data: legendData,
      textStyle: { color: C.subtext, fontSize: 10 },
      top: 0,
      right: 10,
    },
    grid: { left: 55, right: hasEquity ? 65 : 20, top: 30, bottom: 60 },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      {
        type: 'slider',
        height: 20,
        bottom: 8,
        borderColor: C.overlay + '50',
        fillerColor: C.blue + '15',
        handleStyle: { color: C.blue },
        textStyle: { color: C.subtext, fontSize: 10 },
      },
    ],
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: { color: C.subtext, fontSize: 10, rotate: 30 },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    yAxis: yAxes,
    series,
  };
});

const legendItems = computed(() =>
  Object.entries(REGIME_LABEL_KEYS).map(([key, i18nKey]) => ({
    key,
    label: t(i18nKey),
    color: REGIME_COLORS[key],
  })),
);
</script>

<template>
  <div class="sd-chart-card">
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-sm font-semibold" :style="{ color: C.text }">
        {{ t('strategyDev.regimeTimeline') }}
      </h4>
      <div class="flex flex-wrap gap-3">
        <div
          v-for="item in legendItems"
          :key="item.key"
          class="flex items-center gap-1 text-xs"
          :style="{ color: C.subtext }"
        >
          <span
            class="inline-block w-2.5 h-2.5 rounded-full"
            :style="{ backgroundColor: item.color }"
          />
          {{ item.label }}
        </div>
      </div>
    </div>

    <ECharts :option="chartOptions" autoresize style="height: 280px" />
  </div>
</template>
