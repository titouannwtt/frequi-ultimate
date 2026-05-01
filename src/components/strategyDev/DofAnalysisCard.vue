<script setup lang="ts">
import { computed } from 'vue';

interface DofData {
  n_trades: number;
  n_params: number;
  ratio: number;
  level: string;
  label: string;
}

const props = defineProps<{ data: DofData }>();

const levelColor = computed(() => {
  const map: Record<string, string> = {
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    orange: 'text-orange-400',
    red: 'text-red-400',
  };
  return map[props.data.level] || 'text-surface-400';
});

const barWidth = computed(() => Math.min((props.data.ratio / 30) * 100, 100));

const barColor = computed(() => {
  const map: Record<string, string> = {
    green: 'bg-green-500',
    yellow: 'bg-yellow-500',
    orange: 'bg-orange-500',
    red: 'bg-red-500',
  };
  return map[props.data.level] || 'bg-surface-500';
});
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-4">
    <h4 class="text-sm font-semibold mb-3">Degrees of Freedom</h4>
    <div class="flex items-end gap-4 mb-3">
      <div class="text-3xl font-bold tabular-nums" :class="levelColor">
        {{ data.ratio.toFixed(1) }}
      </div>
      <div class="text-sm text-surface-500 pb-1">
        {{ data.n_trades }} trades / {{ data.n_params }} params
      </div>
    </div>
    <div class="h-2 bg-surface-700 rounded-full overflow-hidden">
      <div
        class="h-full rounded-full transition-all"
        :class="barColor"
        :style="{ width: barWidth + '%' }"
      />
    </div>
    <div class="flex justify-between text-xs text-surface-500 mt-1">
      <span>Critical (5)</span>
      <span :class="levelColor">{{ data.label }}</span>
      <span>Excellent (30+)</span>
    </div>
  </div>
</template>
