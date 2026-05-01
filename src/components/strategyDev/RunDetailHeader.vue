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

const runDuration = computed(() => {
  const d = detail.value;
  if (!d) return '';
  const start = (d.run_start_ts as number) || 0;
  const end = (d.run_end_ts as number) || 0;
  if (!start || !end) return '';
  return formatDistanceStrict(new Date(start * 1000), new Date(end * 1000));
});

const canEdit = computed(() => props.run.run_type !== RunType.backtest);

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
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-3 py-2 border-b border-surface-200 dark:border-surface-700"
  >
    <Tag :value="typeLabels[run.run_type]" :severity="typeColors[run.run_type]" />
    <h3 class="text-xl font-bold">{{ run.strategy }}</h3>

    <div class="flex items-center gap-2 text-sm text-surface-500 ml-auto">
      <span v-if="run.timeframe">
        <i-mdi-clock-outline class="w-3.5 h-3.5 inline" /> {{ run.timeframe }}
      </span>
      <span v-if="run.timerange">
        <i-mdi-calendar-range class="w-3.5 h-3.5 inline" /> {{ run.timerange }}
      </span>
      <span v-if="formattedDate">
        <i-mdi-calendar class="w-3.5 h-3.5 inline" /> {{ formattedDate }}
      </span>
      <span v-if="runDuration">
        <i-mdi-timer-outline class="w-3.5 h-3.5 inline" /> {{ runDuration }}
      </span>
    </div>

    <div class="flex items-center gap-1">
      <Button
        v-if="canEdit"
        :severity="detail?.favorite ? 'warn' : 'secondary'"
        variant="text"
        size="small"
        title="Favorite"
        @click="toggleFavorite"
      >
        <template #icon>
          <i-mdi-star v-if="detail?.favorite" class="text-yellow-500" />
          <i-mdi-star-outline v-else />
        </template>
      </Button>

      <Button
        v-if="canEdit"
        severity="secondary"
        variant="text"
        size="small"
        title="Notes"
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

    <!-- Notes display -->
    <div v-if="run.notes && !editingNotes" class="w-full mt-1">
      <p
        class="text-sm text-surface-500 italic cursor-pointer"
        title="Click to edit"
        @click="startEditNotes"
      >
        <i-mdi-note-text class="w-3.5 h-3.5 inline mr-1" />{{ run.notes }}
      </p>
    </div>

    <!-- Notes editor -->
    <div v-if="editingNotes" class="w-full mt-1 flex gap-2">
      <InputText
        v-model="notesText"
        class="flex-1 text-sm"
        placeholder="Add notes..."
        @keydown.enter="saveNotes"
      />
      <Button size="small" severity="primary" label="Save" @click="saveNotes" />
      <Button size="small" severity="secondary" label="Cancel" @click="editingNotes = false" />
    </div>

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

    <div v-if="!run.has_metadata" class="w-full">
      <Message severity="warn" :closable="false" class="text-xs">
        {{ t('strategyDev.noMetadata') }}
      </Message>
    </div>
  </div>
</template>
