<script setup lang="ts" generic="T extends string | number">
import { ref } from 'vue';
import DsIcon from './DsIcon.vue';
import { useEdgeFade } from './lib/useEdgeFade';
import type { SegmentOption } from './types';

const props = withDefaults(
  defineProps<{
    options: SegmentOption<T>[];
    modelValue: T;
    size?: 'sm' | 'md';
    /** Accessible name of the group. */
    label?: string;
  }>(),
  { size: 'md' },
);

const emit = defineEmits<{ 'update:modelValue': [value: T] }>();

const root = ref<HTMLElement | null>(null);
useEdgeFade(root);

function select(opt: SegmentOption<T>) {
  if (!opt.disabled && opt.value !== props.modelValue) {
    emit('update:modelValue', opt.value);
  }
}

function onKeydown(event: KeyboardEvent) {
  const enabled = props.options.filter((o) => !o.disabled);
  const index = enabled.findIndex((o) => o.value === props.modelValue);
  let next = -1;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    next = (index + 1) % enabled.length;
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = (index - 1 + enabled.length) % enabled.length;
  } else if (event.key === 'Home') {
    next = 0;
  } else if (event.key === 'End') {
    next = enabled.length - 1;
  }
  if (next >= 0 && enabled[next]) {
    event.preventDefault();
    select(enabled[next]);
    const buttons = root.value?.querySelectorAll<HTMLElement>(
      '[role="radio"]:not([aria-disabled="true"])',
    );
    buttons?.[next]?.focus();
  }
}
</script>

<template>
  <div
    ref="root"
    class="seg"
    :class="size"
    role="radiogroup"
    :aria-label="label"
    @keydown="onKeydown"
  >
    <button
      v-for="opt in options"
      :key="String(opt.value)"
      type="button"
      role="radio"
      :aria-checked="opt.value === modelValue"
      :aria-disabled="opt.disabled || undefined"
      :tabindex="opt.value === modelValue ? 0 : -1"
      @click="select(opt)"
    >
      <DsIcon v-if="opt.icon" :name="opt.icon" :size="13" />
      <span>{{ opt.label }}</span>
      <span v-if="opt.count !== undefined" class="n num">{{ opt.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: var(--r-2);
  background: var(--bg);
  border: 1px solid var(--line-2);
  flex: none;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.seg::-webkit-scrollbar {
  display: none;
}
button {
  height: calc(var(--ctl) - 6px);
  padding: 0 9px;
  border: 0;
  border-radius: var(--r-1);
  background: none;
  color: var(--fg-3);
  font-family: var(--font-ui);
  font-size: var(--t-sm);
  font-weight: 500;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}
button:hover {
  color: var(--fg);
}
button[aria-checked='true'] {
  background: var(--bg-3);
  color: var(--fg);
  box-shadow: 0 0 0 1px var(--line-2);
}
button[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
}
.n {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.sm button {
  height: 20px;
  padding: 0 7px;
  font-size: var(--t-xs);
}
@media (max-width: 599px), (pointer: coarse) {
  button,
  .sm button {
    height: 44px;
    padding: 0 12px;
    font-size: var(--t-sm);
  }
}
</style>
