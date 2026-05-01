<script setup lang="ts">
import type { RunListEntry } from '@/types';
import { RunType } from '@/types';

const props = defineProps<{
  runs: RunListEntry[];
}>();

const store = useStrategyDevStore();

interface RunGroup {
  key: string;
  label: string;
  runs: RunListEntry[];
}

const typeOrder = [RunType.hyperopt, RunType.wfa, RunType.backtest];
const typeLabels: Record<RunType, string> = {
  [RunType.hyperopt]: 'Hyperopt',
  [RunType.wfa]: 'Walk-Forward',
  [RunType.backtest]: 'Backtest',
};

const groups = computed<RunGroup[]>(() => {
  if (store.groupBy === 'strategy') {
    const map = new Map<string, RunListEntry[]>();
    for (const r of props.runs) {
      const key = r.strategy;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, runs]) => ({ key, label: key, runs }));
  }

  return typeOrder
    .map((type) => ({
      key: type,
      label: typeLabels[type],
      runs: props.runs.filter((r) => r.run_type === type),
    }))
    .filter((g) => g.runs.length > 0);
});

const expandState = ref<Record<string, boolean>>({});

function isExpanded(key: string) {
  return expandState.value[key] ?? true;
}

function toggleGroup(key: string) {
  expandState.value[key] = !isExpanded(key);
}

function isSelected(run: RunListEntry) {
  return (
    store.selectedRun?.filename === run.filename && store.selectedRun?.run_type === run.run_type
  );
}

const flatVisibleRuns = computed<RunListEntry[]>(() => {
  const result: RunListEntry[] = [];
  for (const g of groups.value) {
    if (isExpanded(g.key)) {
      result.push(...g.runs);
    }
  }
  return result;
});

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  const runs = flatVisibleRuns.value;
  if (!runs.length) return;
  const curIdx = runs.findIndex(
    (r) => r.filename === store.selectedRun?.filename && r.run_type === store.selectedRun?.run_type,
  );
  let nextIdx: number;
  if (e.key === 'ArrowDown') {
    nextIdx = curIdx < 0 ? 0 : Math.min(curIdx + 1, runs.length - 1);
  } else {
    nextIdx = curIdx <= 0 ? 0 : curIdx - 1;
  }
  store.selectRun(runs[nextIdx]);
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="sd-tree">
    <div v-for="group in groups" :key="group.key" class="sd-tree-group">
      <button
        class="sd-tree-header"
        @click="toggleGroup(group.key)"
      >
        <i-mdi-chevron-down v-if="isExpanded(group.key)" class="sd-tree-chevron" />
        <i-mdi-chevron-right v-else class="sd-tree-chevron" />
        <span class="sd-tree-label">{{ group.label }}</span>
        <span class="sd-tree-count">{{ group.runs.length }}</span>
      </button>

      <Transition name="sd-group">
        <div v-if="isExpanded(group.key)" class="sd-tree-items">
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

<style scoped>
.sd-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sd-tree-group + .sd-tree-group {
  margin-top: 4px;
}

.sd-tree-header {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  text-align: left;
  padding: 4px 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--sd-radius-sm);
  transition: background var(--sd-transition-fast);
  color: inherit;
}

.sd-tree-header:hover {
  background: var(--sd-surface0);
}

.sd-tree-chevron {
  width: 14px;
  height: 14px;
  color: var(--sd-overlay);
  flex-shrink: 0;
  transition: transform var(--sd-transition-fast);
}

.sd-tree-label {
  font-size: var(--sd-text-xs);
  font-weight: 600;
  color: var(--sd-subtext);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sd-tree-count {
  font-size: 9px;
  font-weight: 600;
  color: var(--sd-overlay);
  background: var(--sd-surface0);
  padding: 0 6px;
  border-radius: 8px;
  flex-shrink: 0;
  min-width: 18px;
  text-align: center;
}

.sd-tree-items {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-left: 8px;
  padding-left: 8px;
  border-left: 1px solid var(--sd-border-subtle);
}

/* ── Group expand transition ── */
.sd-group-enter-active {
  transition: opacity 200ms ease, max-height 200ms ease;
  overflow: hidden;
}
.sd-group-leave-active {
  transition: opacity 150ms ease, max-height 150ms ease;
  overflow: hidden;
}
.sd-group-enter-from,
.sd-group-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
