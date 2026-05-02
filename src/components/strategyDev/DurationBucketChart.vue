<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
} from 'echarts/components';

use([BarChart, LineChart, CanvasRenderer, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent]);

interface BucketData {
  label: string;
  count: number;
  avg_profit: number;
  total_profit: number;
  winrate: number;
  avg_stake: number;
  avg_duration: number;
}

const props = defineProps<{ data: BucketData[] }>();
const { t } = useI18n();

const C = {
  green: '#a6e3a1',
  yellow: '#f9e2af',
  red: '#f38ba8',
  blue: '#89b4fa',
  teal: '#94e2d5',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  surface1: '#313244',
  overlay: '#45475a',
} as const;

function wrColor(wr: number): string {
  if (wr >= 60) return C.green;
  if (wr >= 45) return C.yellow;
  return C.red;
}

const insights = computed(() => {
  const items: { text: string; color: string }[] = [];
  if (!props.data.length) return items;

  const bestBucket = [...props.data].sort((a, b) => b.avg_profit - a.avg_profit)[0];
  const worstBucket = [...props.data].sort((a, b) => a.avg_profit - b.avg_profit)[0];

  if (bestBucket.avg_profit > 0) {
    items.push({
      text: t('strategyDev.durBestBucket', { label: bestBucket.label, profit: (bestBucket.avg_profit * 100).toFixed(2) }),
      color: C.green,
    });
  }
  if (worstBucket.avg_profit < 0 && worstBucket.count >= 5) {
    items.push({
      text: t('strategyDev.durWorstBucket', { label: worstBucket.label, profit: (worstBucket.avg_profit * 100).toFixed(2) }),
      color: C.red,
    });
  }

  const longBuckets = props.data.filter(b => b.avg_duration >= 1440);
  const shortBuckets = props.data.filter(b => b.avg_duration < 1440);
  if (longBuckets.length && shortBuckets.length) {
    const longAvg = longBuckets.reduce((s, b) => s + b.avg_profit * b.count, 0) /
                    longBuckets.reduce((s, b) => s + b.count, 0);
    const shortAvg = shortBuckets.reduce((s, b) => s + b.avg_profit * b.count, 0) /
                     shortBuckets.reduce((s, b) => s + b.count, 0);
    if (longAvg < 0 && shortAvg > 0) {
      items.push({
        text: t('strategyDev.durLongNegShortPos'),
        color: C.yellow,
      });
    }
  }

  return items;
});

const chartOptions = computed<EChartsOption>(() => {
  const labels = props.data.map(b => b.label);

  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: any) => {
        const idx = params[0]?.dataIndex;
        if (idx == null) return '';
        const b = props.data[idx];
        return [
          `<b>${b.label}</b>`,
          `${t('strategyDev.durTrades')}: ${b.count}`,
          `${t('strategyDev.durAvgProfit')}: ${(b.avg_profit * 100).toFixed(2)}%`,
          `${t('strategyDev.durTotalProfit')}: ${(b.total_profit * 100).toFixed(2)}%`,
          `${t('strategyDev.durWinrate')}: ${b.winrate.toFixed(1)}%`,
          `${t('strategyDev.durAvgStake')}: ${b.avg_stake.toFixed(0)}`,
        ].join('<br/>');
      },
    },
    legend: {
      bottom: 0,
      textStyle: { color: C.subtext, fontSize: 10 },
    },
    grid: { left: 50, right: 50, top: 20, bottom: 35 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: C.subtext, fontSize: 11 },
      axisLine: { lineStyle: { color: C.overlay } },
    },
    yAxis: [
      {
        type: 'value',
        name: t('strategyDev.durTrades'),
        nameTextStyle: { color: C.subtext, fontSize: 10 },
        axisLabel: { color: C.subtext },
        splitLine: { lineStyle: { color: C.surface1 } },
      },
      {
        type: 'value',
        name: t('strategyDev.durAvgProfit'),
        nameTextStyle: { color: C.subtext, fontSize: 10 },
        axisLabel: {
          color: C.subtext,
          formatter: (v: number) => `${(v * 100).toFixed(1)}%`,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: t('strategyDev.durTrades'),
        type: 'bar',
        data: props.data.map(b => ({
          value: b.count,
          itemStyle: { color: wrColor(b.winrate), opacity: 0.8 },
        })),
        barWidth: '60%',
      },
      {
        name: t('strategyDev.durAvgProfit'),
        type: 'line',
        yAxisIndex: 1,
        data: props.data.map(b => b.avg_profit),
        lineStyle: { color: C.blue, width: 2 },
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: { color: C.blue },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: C.overlay, type: 'dashed' },
          label: { show: false },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
});
</script>

<template>
  <div class="sd-chart-card">
    <ECharts :option="chartOptions" autoresize style="height: 280px" />
    <div v-if="insights.length" class="flex flex-col gap-1 mt-2">
      <div
        v-for="(ins, idx) in insights"
        :key="idx"
        class="text-xs px-2 py-1 rounded"
        :style="{ backgroundColor: ins.color + '14', color: ins.color }"
      >
        {{ ins.text }}
      </div>
    </div>
  </div>
</template>
