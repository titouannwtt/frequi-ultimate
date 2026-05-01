<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { RunListEntry } from '@/types';
import { RunType } from '@/types';
import { getVerdict } from './metricThresholds';

const { t } = useI18n();
const store = useStrategyDevStore();

const runs = computed(() => store.allRunsFlat);

// ── Grouping by day ──
interface DayGroup {
  date: string;
  dateLabel: string;
  runs: RunListEntry[];
}

const dayGroups = computed<DayGroup[]>(() => {
  const groups = new Map<string, RunListEntry[]>();
  for (const run of runs.value) {
    const d = new Date(run.timestamp * 1000);
    const key = d.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(run);
  }
  const result: DayGroup[] = [];
  for (const [date, dayRuns] of groups) {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    let dateLabel: string;
    if (date === today.toISOString().slice(0, 10)) dateLabel = t('strategyDev.timelineToday');
    else if (date === yesterday.toISOString().slice(0, 10)) dateLabel = t('strategyDev.timelineYesterday');
    else dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

    result.push({ date, dateLabel, runs: dayRuns });
  }
  return result;
});

function runTypeColor(type: RunType): string {
  switch (type) {
    case RunType.hyperopt: return 'var(--sd-info)';
    case RunType.wfa: return 'var(--sd-warning)';
    case RunType.backtest: return 'var(--sd-success)';
    default: return 'var(--sd-subtext)';
  }
}

function runVerdictColor(run: RunListEntry): string {
  if (run.best_loss != null) {
    const v = getVerdict('best_loss', run.best_loss);
    if (v === 'good') return 'var(--sd-success)';
    if (v === 'bad') return 'var(--sd-danger)';
    return 'var(--sd-warning)';
  }
  if (run.total_profit_pct != null) {
    return run.total_profit_pct > 0 ? 'var(--sd-success)' : 'var(--sd-danger)';
  }
  return 'var(--sd-overlay)';
}

function timeStr(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function selectRun(run: RunListEntry) {
  store.selectRun(run);
}

const isSelected = (run: RunListEntry) => store.selectedRun?.filename === run.filename;
</script>

<template>
  <div class="tl sd-panel-enter">
    <div class="tl-header">
      <i-mdi-timeline-clock-outline class="w-4 h-4" />
      <h4 class="tl-title">{{ t('strategyDev.timelineTitle') }}</h4>
      <span class="tl-count">{{ runs.length }} runs</span>
    </div>

    <div class="tl-body">
      <div v-for="group in dayGroups" :key="group.date" class="tl-day">
        <div class="tl-day-label">{{ group.dateLabel }}</div>
        <div class="tl-day-line">
          <div
            v-for="run in group.runs"
            :key="run.filename"
            class="tl-item"
            :class="{ 'tl-item--selected': isSelected(run) }"
            @click="selectRun(run)"
          >
            <!-- Dot -->
            <div class="tl-dot-wrap">
              <span class="tl-dot" :style="{ backgroundColor: runVerdictColor(run) }" />
              <span class="tl-line" />
            </div>

            <!-- Content -->
            <div class="tl-content">
              <div class="tl-content-top">
                <span class="tl-time">{{ timeStr(run.timestamp) }}</span>
                <span class="tl-type" :style="{ color: runTypeColor(run.run_type) }">
                  {{ run.run_type }}
                </span>
              </div>
              <div class="tl-strategy">{{ run.strategy }}</div>
              <div class="tl-metrics">
                <span v-if="run.best_loss != null" class="tl-metric">
                  loss: {{ run.best_loss.toFixed(4) }}
                </span>
                <span v-if="run.total_profit_pct != null" class="tl-metric">
                  {{ run.total_profit_pct >= 0 ? '+' : '' }}{{ run.total_profit_pct.toFixed(1) }}%
                </span>
                <span v-if="run.verdict_grade" class="tl-grade" :style="{ color: runVerdictColor(run) }">
                  {{ run.verdict_grade }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="runs.length === 0" class="tl-empty">
        {{ t('strategyDev.timelineEmpty') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.tl {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 0;
  max-width: 800px;
  margin: 0 auto;
}

.tl-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--sd-info);
}

.tl-title {
  font-size: var(--sd-text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0;
}

.tl-count {
  font-size: var(--sd-text-2xs);
  color: var(--sd-overlay);
  margin-left: auto;
  font-family: var(--sd-font-mono);
}

.tl-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 600px;
  overflow-y: auto;
}

/* ── Day groups ── */
.tl-day {
  display: flex;
  flex-direction: column;
}

.tl-day-label {
  font-size: var(--sd-text-2xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--sd-overlay);
  padding: 8px 0 4px 28px;
}

.tl-day-line {
  display: flex;
  flex-direction: column;
}

/* ── Timeline item ── */
.tl-item {
  display: flex;
  gap: 10px;
  padding: 6px 8px;
  border-radius: var(--sd-radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}
.tl-item:hover {
  background: var(--sd-surface);
}
.tl-item--selected {
  background: var(--sd-info-dim) !important;
}

.tl-dot-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 14px;
  flex-shrink: 0;
  padding-top: 5px;
}

.tl-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  z-index: 1;
}

.tl-line {
  width: 1px;
  flex: 1;
  background: var(--sd-border-subtle);
  min-height: 12px;
}

.tl-item:last-child .tl-line {
  display: none;
}

.tl-content {
  flex: 1;
  min-width: 0;
}

.tl-content-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tl-time {
  font-size: var(--sd-text-2xs);
  font-family: var(--sd-font-mono);
  color: var(--sd-overlay);
}

.tl-type {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
}

.tl-strategy {
  font-size: var(--sd-text-xs);
  font-weight: 500;
  color: var(--sd-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tl-metrics {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.tl-metric {
  font-size: var(--sd-text-2xs);
  font-family: var(--sd-font-mono);
  color: var(--sd-subtext);
}

.tl-grade {
  font-size: var(--sd-text-2xs);
  font-weight: 700;
}

.tl-empty {
  text-align: center;
  padding: 24px;
  font-size: var(--sd-text-sm);
  color: var(--sd-overlay);
}
</style>
