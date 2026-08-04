<script setup lang="ts">
import { useI18n } from 'vue-i18n';

export interface ColumnItem {
  id: string;
  labelKey: string;
  removable?: boolean;
}

const props = defineProps<{
  columns: ColumnItem[];
  visibleIds: string[];
}>();

const emit = defineEmits<{
  toggle: [id: string];
  reorder: [newOrder: string[]];
  reset: [];
}>();

const { t } = useI18n();

let draggedId = '';
const dragOverId = ref<string | null>(null);

function onDragStart(event: DragEvent, id: string) {
  draggedId = id;
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragOver(event: DragEvent, id: string) {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  if (draggedId && id !== draggedId) dragOverId.value = id;
}

function onDragLeave() {
  dragOverId.value = null;
}

function onDrop(_event: DragEvent, targetId: string) {
  dragOverId.value = null;
  if (!draggedId || draggedId === targetId) return;
  const order = props.columns.map((c) => c.id);
  const fromIdx = order.indexOf(draggedId);
  const toIdx = order.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  order.splice(fromIdx, 1);
  order.splice(toIdx, 0, draggedId);
  emit('reorder', order);
  draggedId = '';
}
</script>

<template>
  <div class="col-editor">
    <div class="flex justify-between items-center mb-2">
      <span class="text-xs font-semibold text-surface-300 uppercase tracking-wide">
        {{ t('columnEditor.title') }}
      </span>
      <button
        class="p-1 rounded-md hover:bg-white/8 cursor-pointer transition-colors"
        :title="t('columnEditor.reset')"
        @click="emit('reset')"
      >
        <i-mdi-refresh class="w-3.5 h-3.5 text-surface-400 hover:text-surface-200" />
      </button>
    </div>
    <div class="space-y-px max-h-[340px] overflow-y-auto pe-1">
      <div
        v-for="col in columns"
        :key="col.id"
        class="col-editor-row flex items-center gap-2 px-2 py-1.5 rounded-md text-xs relative select-none transition-colors"
        :class="
          col.removable !== false
            ? 'cursor-grab hover:bg-black/5 dark:hover:bg-white/5'
            : 'opacity-50'
        "
        :draggable="col.removable !== false"
        @dragstart="onDragStart($event, col.id)"
        @dragover.prevent="onDragOver($event, col.id)"
        @dragleave="onDragLeave()"
        @drop="onDrop($event, col.id)"
      >
        <div
          v-if="dragOverId === col.id"
          class="absolute left-1 right-1 -top-px h-0.5 bg-indigo-500 rounded-full z-10"
        />
        <i-mdi-drag-vertical
          v-if="col.removable !== false"
          class="w-3.5 h-3.5 text-surface-500 opacity-40 flex-shrink-0"
        />
        <div v-else class="w-3.5 flex-shrink-0" />
        <label class="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
          <input
            type="checkbox"
            :checked="visibleIds.includes(col.id)"
            :disabled="col.removable === false"
            class="w-3.5 h-3.5 accent-indigo-500 rounded cursor-pointer flex-shrink-0"
            @change="emit('toggle', col.id)"
          />
          <span class="text-surface-300 truncate">{{ t(col.labelKey) }}</span>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.col-editor-row:active {
  cursor: grabbing;
}
</style>
