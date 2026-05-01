<script setup lang="ts">
interface DsrData {
  observed_sharpe: number;
  expected_max_sharpe: number;
  n_trials: number;
  genuine: boolean;
}

defineProps<{ data: DsrData }>();
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <div class="flex items-center justify-between mb-3">
      <h4 class="text-sm font-semibold">Deflated Sharpe Ratio</h4>
      <span
        class="text-xs px-2 py-0.5 rounded-full"
        :class="
          data.genuine
            ? 'bg-green-900/30 text-green-400 border border-green-700/40'
            : 'bg-red-900/30 text-red-400 border border-red-700/40'
        "
      >
        {{ data.genuine ? 'Genuine' : 'Likely Overfitted' }}
      </span>
    </div>
    <div class="grid grid-cols-3 gap-4 text-center">
      <div>
        <div
          class="text-xl font-bold tabular-nums"
          :class="data.genuine ? 'text-green-400' : 'text-red-400'"
        >
          {{ data.observed_sharpe.toFixed(3) }}
        </div>
        <div class="text-xs text-surface-500 mt-0.5">Observed Sharpe</div>
      </div>
      <div>
        <div class="text-xl font-bold tabular-nums text-surface-400">
          {{ data.expected_max_sharpe.toFixed(3) }}
        </div>
        <div class="text-xs text-surface-500 mt-0.5">E[max SR]</div>
      </div>
      <div>
        <div class="text-xl font-bold tabular-nums text-surface-400">
          {{ data.n_trials }}
        </div>
        <div class="text-xs text-surface-500 mt-0.5">N Trials</div>
      </div>
    </div>
  </div>
</template>
