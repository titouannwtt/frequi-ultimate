<script setup lang="ts">
interface OosEquityData {
  total_return_pct: number;
  max_dd_pct: number;
  k_ratio: number;
  n_trades: number;
}

defineProps<{ data: OosEquityData }>();
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <h4 class="text-sm font-semibold mb-3">OOS Equity Curve</h4>
    <div class="grid grid-cols-4 gap-4 text-center">
      <div>
        <div
          class="text-xl font-bold tabular-nums"
          :class="data.total_return_pct >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ data.total_return_pct.toFixed(2) }}%
        </div>
        <div class="text-xs text-surface-500">Total Return</div>
      </div>
      <div>
        <div class="text-xl font-bold tabular-nums text-red-400">
          {{ data.max_dd_pct.toFixed(2) }}%
        </div>
        <div class="text-xs text-surface-500">Max DD</div>
      </div>
      <div>
        <div
          class="text-xl font-bold tabular-nums"
          :class="data.k_ratio >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ data.k_ratio.toFixed(3) }}
        </div>
        <div class="text-xs text-surface-500">K-Ratio</div>
      </div>
      <div>
        <div class="text-xl font-bold tabular-nums text-surface-300">{{ data.n_trades }}</div>
        <div class="text-xs text-surface-500">Trades</div>
      </div>
    </div>
  </div>
</template>
