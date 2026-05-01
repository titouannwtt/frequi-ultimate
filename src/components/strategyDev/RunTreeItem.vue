<script setup lang="ts">
import type { RunListEntry } from '@/types';
import { RunType } from '@/types';
import { formatDistanceToNow } from 'date-fns';

defineProps<{
  run: RunListEntry;
  selected: boolean;
}>();

defineEmits<{
  click: [];
}>();

const typeColors: Record<RunType, string> = {
  [RunType.backtest]: 'info',
  [RunType.hyperopt]: 'warn',
  [RunType.wfa]: 'success',
};

function metricLabel(run: RunListEntry): string {
  if (run.run_type === RunType.wfa && run.verdict_grade) {
    return run.verdict_grade;
  }
  if (run.run_type === RunType.hyperopt && run.best_loss != null) {
    return run.best_loss.toFixed(4);
  }
  if (run.total_profit_pct != null) {
    return `${run.total_profit_pct.toFixed(1)}%`;
  }
  return '';
}

function timeAgo(ts: number): string {
  if (!ts) return '';
  return formatDistanceToNow(new Date(ts * 1000), { addSuffix: true });
}
</script>

<template>
  <button
    class="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-sm cursor-pointer transition-colors"
    :class="{
      'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300': selected,
      'hover:bg-surface-100 dark:hover:bg-surface-800': !selected,
    }"
    @click="$emit('click')"
  >
    <Tag
      :value="run.run_type"
      :severity="typeColors[run.run_type]"
      class="text-[10px] px-1 py-0 shrink-0"
    />
    <div class="flex flex-col min-w-0 flex-1">
      <span class="truncate font-medium text-xs">{{ run.strategy }}</span>
      <span class="text-[10px] text-surface-400 truncate">{{ timeAgo(run.timestamp) }}</span>
    </div>
    <span v-if="metricLabel(run)" class="text-[10px] font-mono text-surface-500 shrink-0">
      {{ metricLabel(run) }}
    </span>
  </button>
</template>
