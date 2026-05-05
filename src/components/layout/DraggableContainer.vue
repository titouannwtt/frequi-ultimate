<script setup lang="ts">
defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    header?: string;
    widgetId?: number;
    canHide?: boolean;
  }>(),
  {
    header: '',
    widgetId: -1,
    canHide: true,
  },
);

const layoutStore = useLayoutStore();

const isHidden = computed(() =>
  props.widgetId >= 0 && !layoutStore.isWidgetVisible(props.widgetId),
);
</script>

<template>
  <div
    class="ft-widget flex flex-col h-full w-full rounded-lg overflow-hidden border border-black/[0.06] dark:border-white/[0.06]"
    :class="{
      'ft-widget-hidden-border': isHidden && layoutStore.editMode,
    }"
    :style="{ opacity: layoutStore.editMode ? layoutStore.widgetOpacity : 1 }"
  >
    <div
      class="drag-header py-1.5 px-2.5 rounded-t-lg bg-[#e0dbd3] dark:bg-[rgba(15,15,25,0.6)] dark:backdrop-blur-xl border-b border-[#cdc6bc] dark:border-transparent"
      style="border-image: linear-gradient(to right, transparent, rgba(99, 102, 241, 0.15), transparent) 1"
    >
      <div class="flex items-center justify-between w-full">
        <div class="flex-1 min-w-0 text-[#4a4540] dark:text-surface-200 text-sm">
          <slot name="header">
            {{ header }}
          </slot>
        </div>
        <button
          v-if="layoutStore.editMode && canHide && widgetId >= 0"
          class="ms-2 p-1 rounded transition-colors cursor-pointer flex-shrink-0"
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
    <div
      class="p-0 h-full w-full overflow-auto bg-surface-50 dark:bg-transparent"
      :class="{ 'ft-widget-hidden-content': isHidden && layoutStore.editMode }"
      v-bind="$attrs"
    >
      <slot></slot>
    </div>
  </div>
</template>

<style scoped>
.ft-widget {
  animation: ft-fade-in 300ms ease-out;
}
</style>
