<script setup lang="ts">
import { ref, computed } from 'vue';
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
} from 'echarts/components';

use([BarChart, CanvasRenderer, GridComponent, TitleComponent, TooltipComponent]);

interface PairProfit {
  pair: string;
  profit_abs: number;
  trade_count: number;
  win_rate: number;
  avg_profit: number;
  [key: string]: unknown;
}

const props = defineProps<{
  data: Record<string, unknown>[];
  title: string;
}>();

const { t } = useI18n();
const showAll = ref(false);

const warnings = computed<string[]>(() => {
  const msgs: string[] = [];
  const traded = (props.data as unknown as PairProfit[]).filter((d) => d.trade_count > 0);
  if (traded.length === 0) return msgs;

  const totalProfit = traded.reduce((s, d) => s + (d.profit_abs ?? 0), 0);
  const profitable = traded.filter((d) => (d.profit_abs ?? 0) > 0);

  if (profitable.length === 1) {
    msgs.push(
      t('strategyDev.pairProfitSingleInstrument', { pair: profitable[0].pair }),
    );
  } else if (totalProfit > 0 && profitable.length > 0) {
    const topPair = profitable.reduce((a, b) =>
      (a.profit_abs ?? 0) > (b.profit_abs ?? 0) ? a : b,
    );
    const topPct = ((topPair.profit_abs ?? 0) / totalProfit) * 100;
    if (topPct > 50) {
      msgs.push(
        t('strategyDev.pairProfitConcentration', { pair: topPair.pair, pct: topPct.toFixed(0) }),
      );
    }
  }
  return msgs;
});

const chartOptions = computed<EChartsOption>(() => {
  const typed = props.data as unknown as PairProfit[];
  const filtered = showAll.value ? typed : typed.filter((d) => d.trade_count > 0);
  const sorted = [...filtered].sort((a, b) => (b.profit_abs ?? 0) - (a.profit_abs ?? 0));
  const pairs = sorted.map((d) => `${d.pair} (${d.trade_count})`);
  const profits = sorted.map((d) => d.profit_abs ?? 0);

  return {
    title: { text: props.title, left: 'center', textStyle: { fontSize: 14, color: '#cdd6f4' } },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#45475a',
      textStyle: { color: '#cdd6f4', fontSize: 12 },
      formatter: (params: unknown) => {
        const p = (params as { dataIndex: number }[])[0];
        if (!p) return '';
        const d = sorted[p.dataIndex];
        return [
          `<b>${d.pair}</b>`,
          `Profit: <b>${d.profit_abs >= 0 ? '+' : ''}${d.profit_abs.toFixed(2)}</b>`,
          `Trades: <b>${d.trade_count}</b>`,
          `Win rate: <b>${(d.win_rate * 100).toFixed(1)}%</b>`,
          `Avg profit: <b>${d.avg_profit >= 0 ? '+' : ''}${d.avg_profit.toFixed(2)}%</b>`,
        ].join('<br/>');
      },
    },
    grid: { left: 160, right: 20, top: 40, bottom: 30 },
    yAxis: {
      type: 'category',
      data: pairs,
      inverse: true,
      axisLabel: { fontSize: 11, color: '#bac2de' },
    },
    xAxis: {
      type: 'value',
      name: t('strategyDev.metricProfitAbs'),
      nameTextStyle: { color: '#a6adc8' },
      axisLabel: { color: '#a6adc8' },
      splitLine: { lineStyle: { color: '#313244' } },
    },
    series: [
      {
        type: 'bar',
        data: profits.map((v) => ({
          value: v,
          itemStyle: { color: v >= 0 ? '#a6e3a1' : '#f38ba8' },
        })),
      },
    ],
  };
});

const tradedCount = computed(() => {
  return (props.data as unknown as PairProfit[]).filter((d) => d.trade_count > 0).length;
});

const totalCount = computed(() => props.data.length);

const displayCount = computed(() => {
  return showAll.value ? totalCount.value : tradedCount.value;
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3">
    <!-- Toggle & info -->
    <div class="flex items-center justify-between flex-wrap gap-2 mb-2 px-1">
      <span class="text-sm text-surface-500">
        {{ t('strategyDev.pairProfitPairsWithTrades', { traded: tradedCount, total: totalCount }) }}
      </span>
      <label class="flex items-center gap-1.5 text-sm text-surface-500 cursor-pointer select-none whitespace-nowrap">
        <input v-model="showAll" type="checkbox" class="accent-green-400 w-3.5 h-3.5" />
        {{ t('strategyDev.pairProfitShowAll') }}
      </label>
    </div>

    <!-- Warnings -->
    <div v-for="(w, i) in warnings" :key="i" class="mb-2 px-2">
      <div
        class="text-sm px-2.5 py-1.5 rounded border"
        :class="
          w.includes('single instrument')
            ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
        "
      >
        {{ w.includes('single instrument') ? '🚨' : '⚠️' }} {{ w }}
      </div>
    </div>

    <ECharts
      :option="chartOptions"
      autoresize
      :style="{ height: `${Math.max(200, displayCount * 25 + 60)}px` }"
    />
  </div>
</template>
