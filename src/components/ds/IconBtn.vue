<script setup lang="ts">
import { computed } from 'vue';
import DsIcon from './DsIcon.vue';
import type { DsIconRef } from './types';

const props = withDefaults(
  defineProps<{
    icon: DsIconRef;
    /** Accessible name and tooltip; icon-only buttons always need one. */
    label: string;
    shortcut?: string;
    size?: 'sm' | 'md';
    /** Notification count shown in a badge (critical alerts). */
    count?: number;
    disabled?: boolean;
    pressed?: boolean;
  }>(),
  { size: 'md', pressed: undefined },
);

const emit = defineEmits<{ click: [event: MouseEvent] }>();

const tooltip = computed(() =>
  props.shortcut ? `${props.label} (${props.shortcut})` : props.label,
);

function onClick(event: MouseEvent) {
  if (!props.disabled) {
    emit('click', event);
  }
}
</script>

<template>
  <button
    type="button"
    class="ibtn"
    :class="size"
    :aria-label="label"
    :title="tooltip"
    :aria-disabled="disabled || undefined"
    :aria-pressed="pressed === undefined ? undefined : pressed"
    @click="onClick"
  >
    <DsIcon :name="icon" :size="size === 'sm' ? 13 : 15" />
    <span v-if="count" class="count num" aria-hidden="true">{{ count > 99 ? '99+' : count }}</span>
    <span v-if="count" class="sr">{{ count }}</span>
  </button>
</template>

<style scoped>
.ibtn {
  width: 32px;
  height: 32px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--r-2);
  border: 1px solid transparent;
  background: none;
  color: var(--fg-2);
  position: relative;
  cursor: pointer;
  transition:
    background var(--d-instant) var(--e-out),
    color var(--d-instant);
}
.ibtn.sm {
  width: 24px;
  height: 24px;
}
.ibtn:hover {
  background: var(--bg-2);
  color: var(--fg);
}
.ibtn[aria-pressed='true'] {
  background: var(--bg-3);
  color: var(--fg);
}
.ibtn[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
}
.count {
  position: absolute;
  top: 1px;
  right: 0;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: var(--crit);
  color: #fff;
  font: 700 11px/17px var(--font-num);
  text-align: center;
}
@media (max-width: 599px), (pointer: coarse) {
  .ibtn,
  .ibtn.sm {
    width: 44px;
    height: 44px;
  }
}
</style>
