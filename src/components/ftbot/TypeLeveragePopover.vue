<script setup lang="ts">
import type { Trade, ClosedTrade } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  trades: (Trade | ClosedTrade)[];
}>();

const typeStats = computed(() => {
  let shorts = 0,
    longs = 0,
    shortWins = 0,
    longWins = 0;
  let shortProfit = 0,
    longProfit = 0;
  for (const tr of props.trades) {
    if (tr.is_short) {
      shorts++;
      shortProfit += tr.profit_pct ?? 0;
      if ((tr.profit_pct ?? 0) > 0) shortWins++;
    } else {
      longs++;
      longProfit += tr.profit_pct ?? 0;
      if ((tr.profit_pct ?? 0) > 0) longWins++;
    }
  }
  return {
    shorts,
    longs,
    shortWins,
    longWins,
    shortAvgProfit: shorts ? shortProfit / shorts : 0,
    longAvgProfit: longs ? longProfit / longs : 0,
    shortWinRate: shorts ? (shortWins / shorts) * 100 : 0,
    longWinRate: longs ? (longWins / longs) * 100 : 0,
  };
});

const leverageStats = computed(() => {
  const byLev: Record<string, { count: number; totalProfit: number; wins: number }> = {};
  let totalLev = 0;
  for (const tr of props.trades) {
    const lev = tr.leverage ?? 1;
    totalLev += lev;
    const key = `${lev}x`;
    if (!byLev[key]) byLev[key] = { count: 0, totalProfit: 0, wins: 0 };
    byLev[key].count++;
    byLev[key].totalProfit += tr.profit_pct ?? 0;
    if ((tr.profit_pct ?? 0) > 0) byLev[key].wins++;
  }
  return {
    byLevel: Object.entries(byLev).sort((a, b) => b[1].count - a[1].count),
    avgLeverage: props.trades.length ? totalLev / props.trades.length : 1,
  };
});
</script>

<template>
  <div class="p-4 min-w-[320px] max-w-[400px]">
    <!-- Type Stats -->
    <div class="font-bold text-xs mb-2">{{ t('typeStats.title') }}</div>
    <div class="grid grid-cols-3 gap-x-3 gap-y-1 text-[13px] mb-3">
      <span></span>
      <span class="font-bold text-green-400 text-center">LONG</span>
      <span class="font-bold text-red-400 text-center">SHORT</span>

      <span class="text-surface-400">{{ t('typeStats.count') }}</span>
      <span class="font-mono text-center">{{ typeStats.longs }}</span>
      <span class="font-mono text-center">{{ typeStats.shorts }}</span>

      <span class="text-surface-400">{{ t('typeStats.winRate') }}</span>
      <span
        class="font-mono text-center"
        :class="typeStats.longWinRate > 50 ? 'text-green-400' : 'text-surface-300'"
        >{{ typeStats.longWinRate.toFixed(0) }}%</span
      >
      <span
        class="font-mono text-center"
        :class="typeStats.shortWinRate > 50 ? 'text-green-400' : 'text-surface-300'"
        >{{ typeStats.shortWinRate.toFixed(0) }}%</span
      >

      <span class="text-surface-400">{{ t('typeStats.avgProfit') }}</span>
      <span
        class="font-mono text-center"
        :class="typeStats.longAvgProfit >= 0 ? 'text-green-400' : 'text-red-400'"
        >{{ typeStats.longAvgProfit.toFixed(2) }}%</span
      >
      <span
        class="font-mono text-center"
        :class="typeStats.shortAvgProfit >= 0 ? 'text-green-400' : 'text-red-400'"
        >{{ typeStats.shortAvgProfit.toFixed(2) }}%</span
      >
    </div>

    <!-- Leverage Stats -->
    <div v-if="leverageStats.byLevel.length > 0" class="border-t border-surface-700 pt-2">
      <div class="font-bold text-xs mb-1">{{ t('leverageStats.title') }}</div>
      <div class="text-[13px] text-surface-400 mb-1">
        {{ t('leverageStats.avgLeverage') }}:
        <span class="font-mono font-bold text-yellow-400"
          >{{ leverageStats.avgLeverage.toFixed(1) }}x</span
        >
      </div>
      <div
        v-for="[lev, data] in leverageStats.byLevel.slice(0, 8)"
        :key="lev"
        class="flex justify-between text-[13px] py-0.5"
      >
        <span class="font-bold text-yellow-400 w-8">{{ lev }}</span>
        <span class="font-mono text-surface-300">{{ data.count }} trades</span>
        <span
          class="font-mono"
          :class="data.totalProfit / data.count >= 0 ? 'text-green-400' : 'text-red-400'"
          >{{ (data.totalProfit / data.count).toFixed(2) }}%</span
        >
        <span class="font-mono text-surface-500 text-[12px]"
          >{{ ((data.wins / data.count) * 100).toFixed(0) }}% WR</span
        >
      </div>
    </div>
  </div>
</template>
