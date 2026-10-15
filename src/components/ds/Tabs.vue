<script setup lang="ts">
import { ref } from 'vue';
import { useEdgeFade } from './lib/useEdgeFade';
import type { TabItem } from './types';

const props = defineProps<{
  tabs: TabItem[];
  modelValue: string;
  /** Accessible name of the tab list. */
  label?: string;
  /** Prefix for `id` / `aria-controls`; panels use `${idPrefix}-panel-${tab.id}`. */
  idPrefix?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const root = ref<HTMLElement | null>(null);
useEdgeFade(root);

function onKeydown(event: KeyboardEvent) {
  const i = props.tabs.findIndex((t) => t.id === props.modelValue);
  let next = -1;
  if (event.key === 'ArrowRight') {
    next = (i + 1) % props.tabs.length;
  } else if (event.key === 'ArrowLeft') {
    next = (i - 1 + props.tabs.length) % props.tabs.length;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = props.tabs.length - 1;
  }
  if (next >= 0) {
    event.preventDefault();
    emit('update:modelValue', props.tabs[next].id);
    root.value?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }
}
</script>

<template>
  <div ref="root" class="tabs" role="tablist" :aria-label="label" @keydown="onKeydown">
    <button
      v-for="tab in tabs"
      :id="idPrefix ? `${idPrefix}-tab-${tab.id}` : undefined"
      :key="tab.id"
      type="button"
      role="tab"
      :aria-selected="tab.id === modelValue"
      :aria-controls="idPrefix ? `${idPrefix}-panel-${tab.id}` : undefined"
      :tabindex="tab.id === modelValue ? 0 : -1"
      @click="emit('update:modelValue', tab.id)"
    >
      {{ tab.label }}
      <span v-if="tab.count !== undefined" class="n num" :class="tab.tone">{{ tab.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 2px;
  align-self: stretch;
  overflow-x: auto;
  scrollbar-width: none;
  max-width: 100%;
}
.tabs::-webkit-scrollbar {
  display: none;
}
button {
  background: none;
  border: 0;
  padding: 0 8px;
  color: var(--fg-3);
  font-family: var(--font-ui);
  font-weight: 600;
  font-size: var(--t-sm);
  position: relative;
  white-space: nowrap;
  cursor: pointer;
  min-height: 28px;
}
button:hover {
  color: var(--fg);
}
button[aria-selected='true'] {
  color: var(--fg);
}
button[aria-selected='true']::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 0;
  height: 2px;
  background: var(--accent);
  border-radius: 2px;
}
.n {
  font-weight: 500;
  color: var(--fg-3);
  margin-left: 3px;
}
.n.crit {
  color: var(--crit);
}
.n.warn {
  color: var(--warn);
}
@media (max-width: 599px), (pointer: coarse) {
  button {
    min-height: 44px;
  }
}
</style>
