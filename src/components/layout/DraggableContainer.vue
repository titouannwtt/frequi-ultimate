<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useWindowSize } from '@vueuse/core';

defineOptions({
  inheritAttrs: false,
});

const { t } = useI18n();
const REFERENCE_WIDTH = 1920;
const { width: viewportWidth } = useWindowSize();

const props = withDefaults(
  defineProps<{
    header?: string;
    widgetId?: number;
    canHide?: boolean;
    hasColumnSettings?: boolean;
    hasFilterDefaults?: boolean;
    filtersChanged?: boolean;
  }>(),
  {
    header: '',
    widgetId: -1,
    canHide: true,
    hasColumnSettings: false,
    hasFilterDefaults: false,
    filtersChanged: false,
  },
);

const emit = defineEmits<{
  'column-settings-click': [event: Event];
  'save-filter-defaults': [];
}>();

const layoutStore = useLayoutStore();

const isHidden = computed(() =>
  props.widgetId >= 0 && !layoutStore.isWidgetVisible(props.widgetId),
);

const currentZoom = computed(() =>
  props.widgetId >= 0 ? layoutStore.getWidgetZoom(props.widgetId) : 100,
);

const viewportScale = computed(() =>
  layoutStore.adaptiveZoom
    ? Math.max(0.6, Math.min(1.5, viewportWidth.value / REFERENCE_WIDTH))
    : 1,
);

const effectiveZoom = computed(() => {
  if (props.widgetId < 0) return 100;
  return Math.round(currentZoom.value * viewportScale.value);
});

const zoomStyle = computed(() =>
  effectiveZoom.value !== 100 ? { zoom: `${effectiveZoom.value}%` } : undefined,
);
</script>

<template>
  <div
    class="ft-widget flex flex-col h-full w-full rounded-lg overflow-hidden"
    :class="{
      'ft-widget-edit': layoutStore.editMode && !isHidden,
      'ft-widget-hidden-border': isHidden && layoutStore.editMode,
      'border border-black/[0.06] dark:border-white/[0.06]': !layoutStore.editMode,
    }"
    :style="{ opacity: layoutStore.editMode ? layoutStore.widgetOpacity : 1 }"
  >
    <div
      class="drag-header py-1.5 px-2.5 rounded-t-lg bg-[#e0dbd3] dark:bg-[rgba(15,15,25,0.6)] dark:backdrop-blur-xl border-b border-[#cdc6bc] dark:border-transparent"
      :class="{ 'ft-drag-handle': layoutStore.editMode && !isHidden }"
      style="border-image: linear-gradient(to right, transparent, rgba(99, 102, 241, 0.15), transparent) 1"
    >
      <div class="flex items-center w-full gap-2">
        <!-- Left: drag icon + title -->
        <div class="flex items-center gap-1.5 shrink-0 text-[#4a4540] dark:text-surface-200 text-sm whitespace-nowrap">
          <i-mdi-drag
            v-if="layoutStore.editMode && !isHidden"
            class="w-4 h-4 text-indigo-400/70 flex-shrink-0"
          />
          <slot name="header">
            {{ header }}
          </slot>
        </div>

        <!-- Left spacer -->
        <div v-if="layoutStore.editMode && widgetId >= 0 && !isHidden" class="flex-1 min-w-0" />

        <!-- Center: edit controls (zoom + columns) — centered via equal spacers -->
        <div
          v-if="layoutStore.editMode && widgetId >= 0 && !isHidden"
          class="ft-edit-controls ft-no-drag flex items-center gap-3 shrink-0"
          @mousedown.stop
          @touchstart.stop
          @pointerdown.stop
        >
          <div class="flex items-center gap-1.5">
            <i-mdi-magnify class="w-4 h-4 text-surface-400" />
            <input
              type="range"
              :value="currentZoom"
              min="60"
              max="120"
              step="5"
              class="w-20 h-1.5 accent-indigo-500 cursor-pointer"
              @input="layoutStore.setWidgetZoom(widgetId, parseInt(($event.target as HTMLInputElement).value))"
            />
            <span class="text-[11px] text-surface-400 w-7 text-right font-mono">{{ currentZoom }}%</span>
            <button
              v-if="currentZoom !== 100"
              class="text-indigo-400 hover:text-indigo-300 cursor-pointer"
              @click.stop="layoutStore.setWidgetZoom(widgetId, 100)"
            >
              <i-mdi-refresh class="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            v-if="hasColumnSettings"
            class="flex items-center gap-1 px-2 py-1 rounded-md transition-colors cursor-pointer hover:bg-black/10 dark:hover:bg-white/10"
            :title="t('columnEditor.title')"
            @click.stop="emit('column-settings-click', $event)"
          >
            <i-mdi-view-column class="w-4 h-4 text-surface-400" />
            <span class="text-[11px] text-surface-400">{{ t('columnEditor.title') }}</span>
          </button>
          <button
            v-if="hasFilterDefaults"
            class="flex items-center gap-1 px-2 py-1 rounded-md transition-colors"
            :class="filtersChanged
              ? 'cursor-pointer hover:bg-indigo-500/15 text-indigo-400'
              : 'opacity-40 cursor-default text-surface-500'"
            :title="t('widgetDefaults.saveAsDefault')"
            :disabled="!filtersChanged"
            @click.stop="filtersChanged && emit('save-filter-defaults')"
          >
            <i-mdi-content-save-check class="w-4 h-4" />
            <span class="text-[11px]">{{ t('widgetDefaults.saveAsDefault') }}</span>
          </button>
        </div>

        <!-- Right spacer -->
        <div v-if="layoutStore.editMode && widgetId >= 0 && !isHidden" class="flex-1 min-w-0" />

        <!-- Right: visibility toggle -->
        <div v-if="layoutStore.editMode && widgetId >= 0" class="flex-shrink-0 ms-auto">
          <button
            v-if="canHide"
            class="p-1 rounded transition-colors cursor-pointer"
            :class="isHidden
              ? 'bg-blue-500/20 hover:bg-blue-500/30 ring-1 ring-blue-400/40'
              : 'hover:bg-black/10 dark:hover:bg-white/10'"
            :title="isHidden ? 'Show widget' : 'Hide widget'"
            @click.stop="layoutStore.toggleWidgetVisibility(widgetId)"
          >
            <i-mdi-eye v-if="!isHidden" class="w-4 h-4 text-surface-500 dark:text-surface-400" />
            <i-mdi-eye-off v-else class="w-4 h-4 text-blue-400" />
          </button>
        </div>
      </div>
    </div>
    <div
      class="p-0 h-full w-full overflow-auto bg-surface-50 dark:bg-transparent"
      :class="{ 'ft-widget-hidden-content': isHidden && layoutStore.editMode }"
      :style="zoomStyle"
      v-bind="$attrs"
    >
      <slot></slot>
    </div>
  </div>
</template>

<style scoped>
.ft-widget {
  animation: ft-fade-in 300ms ease-out;
  transition: border 300ms ease, box-shadow 300ms ease;
}

.ft-widget-edit {
  border: 1.5px dashed rgba(99, 102, 241, 0.4) !important;
  border-radius: 0.5rem;
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.08);
}
.ft-widget-edit:hover {
  border-color: rgba(99, 102, 241, 0.65) !important;
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.12);
}

.ft-drag-handle {
  cursor: grab;
}
.ft-drag-handle:active {
  cursor: grabbing;
}
</style>
