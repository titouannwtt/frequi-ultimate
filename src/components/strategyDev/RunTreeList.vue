<script setup lang="ts">
import type { RunListEntry } from '@/types';
import { RunType } from '@/types';

const props = defineProps<{
  runs: RunListEntry[];
}>();

const store = useStrategyDevStore();

interface RunGroup {
  type: RunType;
  label: string;
  runs: RunListEntry[];
  expanded: boolean;
}

const groups = computed<RunGroup[]>(() => {
  const typeOrder = [RunType.hyperopt, RunType.wfa, RunType.backtest];
  const labels: Record<RunType, string> = {
    [RunType.hyperopt]: 'Hyperopt',
    [RunType.wfa]: 'Walk-Forward',
    [RunType.backtest]: 'Backtest',
  };

  return typeOrder
    .map((type) => ({
      type,
      label: labels[type],
      runs: props.runs.filter((r) => r.run_type === type),
      expanded: true,
    }))
    .filter((g) => g.runs.length > 0);
});

const expandState = ref<Record<string, boolean>>({});

function isExpanded(type: RunType) {
  return expandState.value[type] ?? true;
}

function toggleGroup(type: RunType) {
  expandState.value[type] = !isExpanded(type);
}

function isSelected(run: RunListEntry) {
  return (
    store.selectedRun?.filename === run.filename && store.selectedRun?.run_type === run.run_type
  );
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div v-for="group in groups" :key="group.type">
      <button
        class="flex items-center gap-1 w-full text-left px-1 py-1 text-sm font-semibold text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 cursor-pointer"
        @click="toggleGroup(group.type)"
      >
        <i-mdi-chevron-down v-if="isExpanded(group.type)" class="w-4 h-4" />
        <i-mdi-chevron-right v-else class="w-4 h-4" />
        {{ group.label }}
        <Tag :value="String(group.runs.length)" severity="secondary" class="ml-auto text-xs" />
      </button>

      <Transition name="fade">
        <div v-if="isExpanded(group.type)" class="flex flex-col gap-0.5 ml-2">
          <RunTreeItem
            v-for="run in group.runs"
            :key="run.filename"
            :run="run"
            :selected="isSelected(run)"
            @click="store.selectRun(run)"
          />
        </div>
      </Transition>
    </div>
  </div>
</template>
