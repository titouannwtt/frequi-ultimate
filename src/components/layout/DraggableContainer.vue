<script setup lang="ts">
import { useI18n } from 'vue-i18n';

defineOptions({
  inheritAttrs: false,
});

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    header?: string;
    widgetId?: number;
    canHide?: boolean;
    hasColumnSettings?: boolean;
    hasFilterDefaults?: boolean;
    filtersChanged?: boolean;
    /**
     * Lazy-mount the content: only render the default slot while the widget is
     * in (or near) the viewport, and unmount it when scrolled away. Opt-in so
     * other views keep their eager behaviour. On a dense dashboard this keeps
     * the live DOM / canvas count / reactive recompute proportional to what's
     * actually on screen instead of all widgets at once.
     */
    lazy?: boolean;
  }>(),
  {
    header: '',
    widgetId: -1,
    canHide: true,
    hasColumnSettings: false,
    hasFilterDefaults: false,
    filtersChanged: false,
    lazy: false,
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

// --- Lazy viewport mounting (opt-in via `lazy`) ---
const rootEl = ref<HTMLElement | null>(null);
const isNearViewport = ref(!props.lazy);
if (props.lazy) {
  // rootMargin pre-mounts ~400px before the widget scrolls into view (and keeps
  // it mounted ~400px after it leaves) to avoid blank flashes during scroll.
  useIntersectionObserver(
    rootEl,
    (entries) => {
      isNearViewport.value = entries[entries.length - 1]?.isIntersecting ?? false;
    },
    { rootMargin: '400px 0px' },
  );
}

const renderContent = computed(() => {
  if (!props.lazy) return true;
  // In edit mode the user is arranging widgets — render everything so the
  // layout looks complete. Hidden widgets never mount their content.
  if (layoutStore.editMode) return true;
  if (isHidden.value) return false;
  return isNearViewport.value;
});
</script>

<template>
  <div
    ref="rootEl"
    class="ft-widget flex flex-col h-full w-full rounded-lg"
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
      v-bind="$attrs"
    >
      <slot v-if="renderContent"></slot>
      <div v-else class="ft-lazy-placeholder w-full h-full" aria-hidden="true"></div>
    </div>
  </div>
</template>

<style scoped>
.ft-widget {
  clip-path: inset(0 round 0.5rem);
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
