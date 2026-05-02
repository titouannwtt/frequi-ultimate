<script setup lang="ts">
import type { RunListEntry } from '@/types';
import { RunType } from '@/types';
import { useI18n } from 'vue-i18n';
import { format, formatDistanceStrict } from 'date-fns';

const props = defineProps<{
  run: RunListEntry;
}>();

const { t } = useI18n();
const store = useStrategyDevStore();
const settingsStore = useSettingsStore();
const confirmDelete = ref(false);
const editingNotes = ref(false);
const notesText = ref('');

const typeColors: Record<RunType, string> = {
  [RunType.backtest]: 'info',
  [RunType.hyperopt]: 'warn',
  [RunType.wfa]: 'success',
};

const typeLabels: Record<RunType, string> = {
  [RunType.backtest]: 'Backtest',
  [RunType.hyperopt]: 'Hyperopt',
  [RunType.wfa]: 'Walk-Forward',
};

const formattedDate = computed(() => {
  if (!props.run.timestamp) return '';
  return format(new Date(props.run.timestamp * 1000), 'yyyy-MM-dd HH:mm');
});

const detail = computed(() => {
  if (props.run.run_type === RunType.hyperopt) return store.hyperoptDetail;
  if (props.run.run_type === RunType.wfa) return store.wfaDetail;
  return null;
});

const bestEpochTrades = computed<number | null>(() => {
  if (props.run.run_type !== RunType.hyperopt) return null;
  const rm = (detail.value?.best_epoch_metrics ?? {}) as Record<string, number>;
  return rm.total_trades ?? null;
});

const runDuration = computed(() => {
  const d = detail.value;
  if (!d) return '';
  const start = (d.run_start_ts as number) || 0;
  const end = (d.run_end_ts as number) || 0;
  if (!start || !end) return '';
  return formatDistanceStrict(new Date(start * 1000), new Date(end * 1000));
});

const canEdit = computed(() => props.run.run_type !== RunType.backtest);

// ── Quick stats ──
const quickStats = computed<{ label: string; value: string; color: string }[]>(() => {
  const stats: { label: string; value: string; color: string }[] = [];
  const r = props.run;

  if (r.total_profit_pct != null) {
    const v = r.total_profit_pct;
    stats.push({
      label: 'Profit',
      value: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`,
      color: v >= 0 ? 'var(--sd-success)' : 'var(--sd-danger)',
    });
  }

  if (r.best_loss != null) {
    stats.push({
      label: 'Loss',
      value: r.best_loss.toFixed(4),
      color: r.best_loss < 0 ? 'var(--sd-success)' : 'var(--sd-warning)',
    });
  }

  const tradesCount = bestEpochTrades.value ?? r.total_trades;
  if (tradesCount != null) {
    stats.push({
      label: 'Trades',
      value: String(tradesCount),
      color: tradesCount >= 60 ? 'var(--sd-text)' : 'var(--sd-warning)',
    });
  }

  if (r.verdict_grade) {
    const gradeColors: Record<string, string> = {
      A: 'var(--sd-success)', B: 'var(--sd-success)',
      C: 'var(--sd-warning)', D: 'var(--sd-danger)', F: 'var(--sd-danger)',
    };
    stats.push({
      label: 'Grade',
      value: r.verdict_grade,
      color: gradeColors[r.verdict_grade] || 'var(--sd-text)',
    });
  }

  if (r.epochs_completed != null && r.epochs_total != null) {
    stats.push({
      label: 'Epochs',
      value: `${r.epochs_completed}/${r.epochs_total}`,
      color: 'var(--sd-text)',
    });
  }

  if (r.best_sharpe != null) {
    stats.push({
      label: 'Sharpe',
      value: r.best_sharpe.toFixed(3),
      color: r.best_sharpe >= 0 ? 'var(--sd-success)' : 'var(--sd-danger)',
    });
  }

  if (r.best_max_dd != null) {
    stats.push({
      label: 'Max DD',
      value: `${(r.best_max_dd * 100).toFixed(1)}%`,
      color: 'var(--sd-danger)',
    });
  }

  if (r.best_profit_factor != null) {
    stats.push({
      label: 'PF',
      value: r.best_profit_factor.toFixed(2),
      color: r.best_profit_factor >= 1 ? 'var(--sd-success)' : 'var(--sd-warning)',
    });
  }

  if (r.best_winrate != null) {
    stats.push({
      label: 'Win Rate',
      value: `${(r.best_winrate * 100).toFixed(1)}%`,
      color: r.best_winrate >= 0.5 ? 'var(--sd-success)' : 'var(--sd-warning)',
    });
  }

  if (r.best_sqn != null) {
    stats.push({
      label: 'SQN',
      value: r.best_sqn.toFixed(2),
      color: r.best_sqn >= 2 ? 'var(--sd-success)' : r.best_sqn >= 1 ? 'var(--sd-warning)' : 'var(--sd-danger)',
    });
  }

  return stats;
});

// ── Overall verdict badge ──
const verdictBadge = computed<{ label: string; color: string; bg: string } | null>(() => {
  const r = props.run;
  if (r.run_type === RunType.wfa && r.verdict_grade) {
    if (r.verdict_grade <= 'B')
      return { label: t('strategyDev.verdictGood'), color: 'var(--sd-success)', bg: 'var(--sd-success-dim)' };
    if (r.verdict_grade === 'C')
      return { label: t('strategyDev.verdictCaution'), color: 'var(--sd-warning)', bg: 'var(--sd-warning-dim)' };
    return { label: t('strategyDev.verdictDanger'), color: 'var(--sd-danger)', bg: 'var(--sd-danger-dim)' };
  }
  if (r.run_type === RunType.hyperopt && r.best_loss != null) {
    if (r.best_loss < -0.05)
      return { label: t('strategyDev.verdictGood'), color: 'var(--sd-success)', bg: 'var(--sd-success-dim)' };
    if (r.best_loss < 0)
      return { label: t('strategyDev.verdictCaution'), color: 'var(--sd-warning)', bg: 'var(--sd-warning-dim)' };
    return { label: t('strategyDev.verdictDanger'), color: 'var(--sd-danger)', bg: 'var(--sd-danger-dim)' };
  }
  return null;
});

function startEditNotes() {
  notesText.value = props.run.notes ?? '';
  editingNotes.value = true;
}

async function saveNotes() {
  editingNotes.value = false;
  await store.updateMetadata(props.run.run_type, props.run.filename, {
    notes: notesText.value || null,
  });
  if (store.selectedRun) store.selectedRun.notes = notesText.value || null;
}

async function toggleFavorite() {
  const d = detail.value;
  const isFav = d ? !!(d.favorite as boolean) : false;
  await store.updateMetadata(props.run.run_type, props.run.filename, { favorite: !isFav });
  if (d) d.favorite = !isFav;
}

async function onDelete() {
  if (settingsStore.confirmDialog) {
    confirmDelete.value = true;
  } else {
    await doDelete();
  }
}

async function doDelete() {
  confirmDelete.value = false;
  await store.deleteRun(props.run.run_type, props.run.filename);
}

function filterByStrategy() {
  store.filterStrategy = props.run.strategy;
  store.filterType = null;
}

function filterByType() {
  store.filterType = props.run.run_type;
  store.filterStrategy = null;
}
</script>

<template>
  <div class="rdh">
    <!-- Row 1: Breadcrumb + actions -->
    <div class="rdh-top">
      <div class="rdh-breadcrumb">
        <button class="rdh-crumb" @click="filterByStrategy" :title="t('strategyDev.filterByStrategy')">
          {{ run.strategy }}
        </button>
        <span class="rdh-crumb-sep">/</span>
        <button class="rdh-crumb" @click="filterByType">
          <Tag :value="typeLabels[run.run_type]" :severity="typeColors[run.run_type]" class="rdh-type-tag" />
        </button>
      </div>

      <!-- Verdict badge -->
      <span
        v-if="verdictBadge"
        class="rdh-verdict"
        :style="{ color: verdictBadge.color, background: verdictBadge.bg, borderColor: verdictBadge.color }"
      >
        {{ verdictBadge.label }}
      </span>

      <!-- Actions -->
      <div class="rdh-actions">
        <Button
          v-if="canEdit"
          :severity="detail?.favorite ? 'warn' : 'secondary'"
          variant="text"
          size="small"
          :title="t('strategyDev.favorite')"
          @click="toggleFavorite"
        >
          <template #icon>
            <i-mdi-star v-if="detail?.favorite" class="rdh-fav-icon" />
            <i-mdi-star-outline v-else />
          </template>
        </Button>

        <Button
          v-if="canEdit"
          severity="secondary"
          variant="text"
          size="small"
          :title="t('strategyDev.notes')"
          @click="startEditNotes"
        >
          <template #icon>
            <i-mdi-note-edit-outline />
          </template>
        </Button>

        <Button
          v-if="canEdit"
          severity="danger"
          variant="text"
          size="small"
          :title="t('strategyDev.deleteRun')"
          @click="onDelete"
        >
          <template #icon>
            <i-mdi-delete-outline />
          </template>
        </Button>
      </div>
    </div>

    <!-- Row 2: Quick stats + metadata -->
    <div class="rdh-stats-row">
      <!-- Quick stats -->
      <div v-if="quickStats.length" class="rdh-quick-stats-wrapper">
        <span class="rdh-stats-label">{{ t('strategyDev.bestEpochResults') }}</span>
        <div class="rdh-quick-stats">
          <div v-for="stat in quickStats" :key="stat.label" class="rdh-stat">
            <span class="rdh-stat-label">{{ stat.label }}</span>
            <span class="rdh-stat-value" :style="{ color: stat.color }">{{ stat.value }}</span>
          </div>
        </div>
      </div>

      <!-- Metadata -->
      <div class="rdh-meta">
        <span v-if="run.timeframe" class="rdh-meta-item">
          <i-mdi-clock-outline class="rdh-meta-icon" /> {{ run.timeframe }}
        </span>
        <span v-if="run.timerange" class="rdh-meta-item">
          <i-mdi-calendar-range class="rdh-meta-icon" /> {{ run.timerange }}
        </span>
        <span v-if="formattedDate" class="rdh-meta-item">
          <i-mdi-calendar class="rdh-meta-icon" /> {{ formattedDate }}
        </span>
        <span v-if="runDuration" class="rdh-meta-item">
          <i-mdi-timer-outline class="rdh-meta-icon" /> {{ runDuration }}
        </span>
      </div>
    </div>

    <!-- Notes display -->
    <div v-if="run.notes && !editingNotes" class="rdh-notes" @click="startEditNotes">
      <i-mdi-note-text class="rdh-notes-icon" />
      <span>{{ run.notes }}</span>
    </div>

    <!-- Notes editor -->
    <div v-if="editingNotes" class="rdh-notes-editor">
      <input
        v-model="notesText"
        class="rdh-notes-input"
        placeholder="Add notes..."
        @keydown.enter="saveNotes"
        @keydown.escape="editingNotes = false"
      />
      <button class="rdh-notes-btn rdh-notes-btn--save" @click="saveNotes">Save</button>
      <button class="rdh-notes-btn" @click="editingNotes = false">Cancel</button>
    </div>

    <!-- Delete dialog -->
    <Dialog
      v-model:visible="confirmDelete"
      :header="t('strategyDev.deleteRun')"
      modal
      :style="{ width: '400px' }"
    >
      <p>{{ t('strategyDev.deleteConfirm') }}</p>
      <template #footer>
        <Button severity="secondary" :label="t('general.cancel')" @click="confirmDelete = false" />
        <Button severity="danger" :label="t('strategyDev.deleteRun')" @click="doDelete" />
      </template>
    </Dialog>

    <!-- No metadata warning -->
    <div v-if="!run.has_metadata" class="rdh-no-meta">
      <i-mdi-alert-outline class="w-3.5 h-3.5" />
      {{ t('strategyDev.noMetadata') }}
    </div>
  </div>
</template>

<style scoped>
.rdh {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0 12px;
  border-bottom: 1px solid var(--sd-border-subtle);
  animation: sd-slide-up 200ms ease-out;
}

/* ── Row 1: breadcrumb + actions ── */
.rdh-top {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.rdh-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.rdh-crumb {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--sd-text-lg);
  font-weight: 700;
  color: var(--sd-text);
  padding: 0;
  transition: color var(--sd-transition-fast);
}

.rdh-crumb:hover {
  color: var(--sd-info);
}

.rdh-crumb-sep {
  color: var(--sd-overlay);
  font-size: var(--sd-text-lg);
  font-weight: 300;
}

.rdh-type-tag {
  font-size: 10px !important;
  cursor: pointer;
}

.rdh-verdict {
  font-size: var(--sd-text-2xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid;
  animation: sd-scale-in 300ms ease-out;
}

.rdh-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.rdh-fav-icon {
  color: var(--sd-yellow);
}

/* ── Row 2: quick stats + meta ── */
.rdh-stats-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.rdh-quick-stats-wrapper {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.rdh-stats-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sd-overlay);
}

.rdh-quick-stats {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.rdh-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 12px;
  background: var(--sd-surface0);
  border-radius: var(--sd-radius-sm);
  min-width: 56px;
}

.rdh-stat-label {
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sd-overlay);
}

.rdh-stat-value {
  font-size: var(--sd-text-sm);
  font-weight: 700;
  font-family: var(--sd-font-mono);
}

.rdh-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.rdh-meta-item {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: var(--sd-text-xs);
  color: var(--sd-overlay);
}

.rdh-meta-icon {
  width: 13px;
  height: 13px;
}

/* ── Notes ── */
.rdh-notes {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--sd-text-xs);
  color: var(--sd-subtext);
  font-style: italic;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--sd-radius-sm);
  transition: background var(--sd-transition-fast);
}

.rdh-notes:hover {
  background: var(--sd-surface0);
}

.rdh-notes-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 1px;
}

.rdh-notes-editor {
  display: flex;
  gap: 6px;
}

.rdh-notes-input {
  flex: 1;
  padding: 5px 10px;
  font-size: var(--sd-text-xs);
  background: var(--sd-surface0);
  border: 1px solid var(--sd-border);
  border-radius: var(--sd-radius-sm);
  color: var(--sd-text);
  outline: none;
}

.rdh-notes-input:focus {
  border-color: var(--sd-info);
}

.rdh-notes-btn {
  padding: 4px 10px;
  font-size: var(--sd-text-xs);
  font-weight: 500;
  border: 1px solid var(--sd-border);
  border-radius: var(--sd-radius-sm);
  background: transparent;
  color: var(--sd-subtext);
  cursor: pointer;
  transition: all var(--sd-transition-fast);
}

.rdh-notes-btn:hover {
  background: var(--sd-surface0);
  color: var(--sd-text);
}

.rdh-notes-btn--save {
  background: var(--sd-info-dim);
  color: var(--sd-info);
  border-color: rgba(137, 180, 250, 0.3);
}

/* ── No metadata warning ── */
.rdh-no-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--sd-text-base);
  font-weight: 500;
  color: var(--sd-warning);
  padding: 4px 10px;
  background: var(--sd-warning-dim);
  border-radius: var(--sd-radius-sm);
  border: 1px solid rgba(249, 226, 175, 0.2);
}
</style>
