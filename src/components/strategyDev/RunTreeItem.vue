<script setup lang="ts">
import type { RunListEntry } from '@/types';
import { RunType } from '@/types';
import { formatDistanceToNow } from 'date-fns';

const props = defineProps<{
  run: RunListEntry;
  selected: boolean;
}>();

defineEmits<{
  click: [];
}>();

const store = useStrategyDevStore();

const isCached = computed(() => store.runCache.has(props.run.filename));

const typeColors: Record<RunType, string> = {
  [RunType.backtest]: 'info',
  [RunType.hyperopt]: 'warn',
  [RunType.wfa]: 'success',
  [RunType.live]: 'danger',
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

const isLiveBot = computed(() => props.run.run_type === RunType.live);

function timeAgo(ts: number): string {
  if (!ts) return '';
  return formatDistanceToNow(new Date(ts * 1000), { addSuffix: true });
}

const isNew = computed(() => {
  if (!props.run.timestamp) return false;
  const oneDayAgo = Date.now() / 1000 - 86400;
  return props.run.timestamp > oneDayAgo;
});

const verdictDot = computed<string | null>(() => {
  const r = props.run;
  if (r.run_type === RunType.wfa && r.verdict_grade) {
    if (r.verdict_grade <= 'B') return 'var(--sd-success)';
    if (r.verdict_grade === 'C') return 'var(--sd-warning)';
    return 'var(--sd-danger)';
  }
  if (r.run_type === RunType.hyperopt && r.best_loss != null) {
    if (r.best_loss < 0) return 'var(--sd-success)';
    return 'var(--sd-warning)';
  }
  if (r.total_profit_pct != null) {
    if (r.total_profit_pct > 0) return 'var(--sd-success)';
    return 'var(--sd-danger)';
  }
  return null;
});
</script>

<template>
  <button class="run-item" :class="{ 'run-item--selected': selected }" @click="$emit('click')">
    <!-- Verdict dot -->
    <span v-if="verdictDot" class="run-verdict-dot" :style="{ backgroundColor: verdictDot }" />

    <!-- Type tag -->
    <Tag
      :value="isLiveBot ? (run.dry_run ? 'dry' : 'live') : run.run_type"
      :severity="isLiveBot ? (run.dry_run ? 'success' : 'info') : typeColors[run.run_type]"
      class="run-type-tag"
    />

    <!-- Info -->
    <div class="run-info">
      <div class="run-info-top">
        <span class="run-strategy">{{ run.strategy }}</span>
        <i-mdi-star v-if="run.favorite" class="run-fav-star" />
        <i-mdi-cached v-if="isCached" class="run-cached-icon" />
        <span
          v-if="isLiveBot"
          class="run-live-badge"
          :class="{ 'run-live-badge--dry': run.dry_run }"
        >
          <span class="run-live-dot" :class="{ 'run-live-dot--dry': run.dry_run }" />
          {{ run.dry_run ? 'dry' : 'live' }}
        </span>
        <span v-else-if="isNew" class="run-new-badge">new</span>
      </div>
      <span v-if="isLiveBot" class="run-time">
        {{ run.exchange }} · {{ run.open_trades_count ?? 0 }} open
      </span>
      <span v-else class="run-time">{{ timeAgo(run.timestamp) }}</span>
    </div>

    <!-- Metric -->
    <span v-if="metricLabel(run)" class="run-metric" :style="{ color: verdictDot || undefined }">
      {{ metricLabel(run) }}
    </span>
  </button>
</template>

<style scoped>
.run-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border-radius: var(--sd-radius-md);
  cursor: pointer;
  transition: all var(--sd-transition-fast);
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
}

.run-item:hover:not(.run-item--selected) {
  background: var(--sd-surface0);
  border-color: var(--sd-border-subtle);
}

.run-item--selected {
  background: var(--sd-info-dim);
  border-color: rgba(137, 180, 250, 0.25);
}

.run-verdict-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.run-type-tag {
  font-size: 9px !important;
  padding: 1px 4px !important;
  flex-shrink: 0;
}

.run-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.run-info-top {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.run-strategy {
  font-size: var(--sd-text-xs);
  font-weight: 500;
  color: var(--sd-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.run-item--selected .run-strategy {
  color: var(--sd-info);
}

.run-fav-star {
  width: 12px;
  height: 12px;
  color: var(--sd-yellow);
  flex-shrink: 0;
}

.run-cached-icon {
  width: 11px;
  height: 11px;
  color: var(--sd-info);
  flex-shrink: 0;
  opacity: 0.6;
}

.run-new-badge {
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--sd-info);
  background: var(--sd-info-dim);
  padding: 0 4px;
  border-radius: 3px;
  flex-shrink: 0;
  line-height: 1.4;
}

.run-live-badge {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--sd-success);
  background: var(--sd-success-dim);
  padding: 0 5px;
  border-radius: 3px;
  flex-shrink: 0;
  line-height: 1.4;
}

.run-live-badge--dry {
  color: var(--sd-warning);
  background: var(--sd-warning-dim);
}

.run-live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--sd-success);
  animation: live-pulse 2s ease-in-out infinite;
}

.run-live-dot--dry {
  background: var(--sd-warning);
}

@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.run-time {
  font-size: 9px;
  color: var(--sd-overlay);
}

.run-metric {
  font-size: var(--sd-text-2xs);
  font-family: var(--sd-font-mono);
  font-weight: 600;
  flex-shrink: 0;
}
</style>
