<script setup lang="ts">
interface DistData {
  skewness: number;
  excess_kurtosis: number;
  n_trades: number;
  skew_alert: boolean;
  kurtosis_alert: boolean;
}

defineProps<{ data: DistData }>();
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <h4 class="text-sm font-semibold mb-3">Return Distribution</h4>
    <div class="grid grid-cols-3 gap-4 text-center">
      <div>
        <div
          class="text-xl font-bold tabular-nums"
          :class="data.skew_alert ? 'text-red-400' : 'text-green-400'"
        >
          {{ data.skewness.toFixed(3) }}
        </div>
        <div class="text-xs text-surface-500 mt-0.5">Skewness</div>
        <div v-if="data.skew_alert" class="text-xs text-red-400 mt-0.5">Heavy left tail</div>
      </div>
      <div>
        <div
          class="text-xl font-bold tabular-nums"
          :class="data.kurtosis_alert ? 'text-amber-400' : 'text-green-400'"
        >
          {{ data.excess_kurtosis.toFixed(3) }}
        </div>
        <div class="text-xs text-surface-500 mt-0.5">Kurtosis</div>
        <div v-if="data.kurtosis_alert" class="text-xs text-amber-400 mt-0.5">Fat tails</div>
      </div>
      <div>
        <div class="text-xl font-bold tabular-nums text-surface-300">
          {{ data.n_trades }}
        </div>
        <div class="text-xs text-surface-500 mt-0.5">Trades</div>
      </div>
    </div>
  </div>
</template>
