<script setup lang="ts">
import { computed } from 'vue';

interface PerturbData {
  n_perturbations: number;
  profit_p5: number;
  profit_p50: number;
  profit_p95: number;
  pct_profitable: number;
  sensitivity: number;
}

const props = defineProps<{ data: PerturbData }>();

const sensitivityLabel = computed(() => {
  if (props.data.sensitivity < 0.2) return { text: 'Low', color: 'text-green-400' };
  if (props.data.sensitivity < 0.5) return { text: 'Medium', color: 'text-amber-400' };
  return { text: 'High', color: 'text-red-400' };
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <h4 class="text-sm font-semibold mb-3">Parameter Perturbation</h4>
    <div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-center">
      <div>
        <div
          class="text-xl font-bold tabular-nums"
          :class="data.profit_p50 >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ data.profit_p50.toFixed(1) }}%
        </div>
        <div class="text-xs text-surface-500">Profit P50</div>
      </div>
      <div>
        <div
          class="text-xl font-bold tabular-nums"
          :class="data.pct_profitable >= 50 ? 'text-green-400' : 'text-red-400'"
        >
          {{ data.pct_profitable.toFixed(0) }}%
        </div>
        <div class="text-xs text-surface-500">% Profitable</div>
      </div>
      <div>
        <div class="text-xl font-bold tabular-nums" :class="sensitivityLabel.color">
          {{ data.sensitivity.toFixed(3) }}
        </div>
        <div class="text-xs text-surface-500">Sensitivity ({{ sensitivityLabel.text }})</div>
      </div>
    </div>
    <div class="flex gap-4 mt-3 text-sm text-center">
      <div class="flex-1">
        <div class="font-bold tabular-nums text-red-400">{{ data.profit_p5.toFixed(1) }}%</div>
        <div class="text-xs text-surface-500">P5 (worst)</div>
      </div>
      <div class="flex-1">
        <div class="font-bold tabular-nums text-green-400">{{ data.profit_p95.toFixed(1) }}%</div>
        <div class="text-xs text-surface-500">P95 (best)</div>
      </div>
    </div>
    <div class="text-xs text-surface-500 mt-2 text-right">
      {{ data.n_perturbations }} perturbations
    </div>
  </div>
</template>
