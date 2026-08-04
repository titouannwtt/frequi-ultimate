<script setup lang="ts">
/**
 * BotListCollapsible — Reusable wrapper for bot lists in popovers.
 *
 * Renders up to `threshold` items inline via a scoped slot.
 * If more items exist, shows "and N more..." toggle.
 * When expanded, items are in a scrollable container.
 * Bot names use truncation + tooltip.
 */

const props = withDefaults(
  defineProps<{
    /** Array of items to iterate over */
    items: any[];
    /** How many items to show before collapsing */
    threshold?: number;
    /** Max height of the expanded scrollable area */
    expandedMaxHeight?: string;
  }>(),
  {
    threshold: 5,
    expandedMaxHeight: '200px',
  },
);

const expanded = ref(false);

const needsCollapse = computed(() => props.items.length > props.threshold);
const visibleItems = computed(() => {
  if (!needsCollapse.value || expanded.value) return props.items;
  return props.items.slice(0, props.threshold);
});
const hiddenCount = computed(() => props.items.length - props.threshold);
</script>

<template>
  <div>
    <div
      :class="needsCollapse && expanded ? 'overflow-y-auto' : ''"
      :style="needsCollapse && expanded ? { maxHeight: expandedMaxHeight } : {}"
    >
      <template v-for="(item, index) in visibleItems" :key="index">
        <slot :item="item" :index="index" />
      </template>
    </div>

    <button
      v-if="needsCollapse"
      class="w-full text-center text-[10px] py-0.5 mt-0.5 cursor-pointer transition-colors rounded hover:bg-surface-800/50"
      :class="
        expanded ? 'text-blue-400 hover:text-blue-300' : 'text-surface-500 hover:text-surface-300'
      "
      @click.stop="expanded = !expanded"
    >
      <template v-if="!expanded">+{{ hiddenCount }} more...</template>
      <template v-else>Show less</template>
    </button>
  </div>
</template>
