<script setup lang="ts">
interface HalfStats {
  trades: number;
  profit_pct: number;
  profit_abs: number;
  win_rate: number;
  avg_profit: number;
}

interface RegimeData {
  first_half: HalfStats;
  second_half: HalfStats;
  first_label: string;
  second_label: string;
  consistent: boolean;
}

defineProps<{ data: RegimeData }>();
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-sm font-semibold">Regime Analysis</h4>
      <span
        class="text-xs px-2 py-0.5 rounded-full"
        :class="
          data.consistent
            ? 'bg-green-900/30 text-green-400 border border-green-700/40'
            : 'bg-red-900/30 text-red-400 border border-red-700/40'
        "
      >
        {{ data.consistent ? 'Consistent' : 'Inconsistent' }}
      </span>
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div
        v-for="(half, label) in {
          [data.first_label]: data.first_half,
          [data.second_label]: data.second_half,
        }"
        :key="label"
        class="space-y-2"
      >
        <h5 class="text-xs font-medium text-surface-400 uppercase">{{ label }}</h5>
        <div class="space-y-1 text-sm">
          <div class="flex justify-between">
            <span class="text-surface-500">Trades</span>
            <span>{{ half.trades }}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-surface-500">Profit</span>
            <span :class="half.profit_pct >= 0 ? 'text-green-400' : 'text-red-400'">
              {{ half.profit_pct.toFixed(1) }}%
            </span>
          </div>
          <div class="flex justify-between">
            <span class="text-surface-500">Win Rate</span>
            <span>{{ half.win_rate.toFixed(1) }}%</span>
          </div>
          <div class="flex justify-between">
            <span class="text-surface-500">Avg Profit</span>
            <span :class="half.avg_profit >= 0 ? 'text-green-400' : 'text-red-400'">
              {{ half.avg_profit.toFixed(2) }}%
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
