<script setup lang="ts">
import { computed } from 'vue';
import { useInflightLock } from '@/composables/useInflightLock';
import DsIcon from './DsIcon.vue';
import type { BtnSize, BtnVariant, DsIconRef } from './types';

const props = withDefaults(
  defineProps<{
    variant?: BtnVariant;
    size?: BtnSize;
    icon?: DsIconRef;
    busy?: boolean;
    disabled?: boolean;
    /** Why the button is disabled (offline, session expired, connecting); shown as a tooltip. */
    disabledReason?: string;
    /**
     * In-flight lock key (`bot_key:action:trade_id`): shared by every surface of the action.
     * By default the button only observes the lock (aria-busy, `locked` event); it does not take it.
     */
    lockKey?: string;
    /**
     * Take the lock on click. Off by default: a button that opens a confirmation dialog must not
     * hold the key its HoldButton needs. Turn it on for an action that fires without a dialog.
     */
    acquireLock?: boolean;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  { variant: 'secondary', size: 'md', type: 'button', acquireLock: false },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
  /** A second trigger while the lock key is held: show "Already running". */
  locked: [key: string];
}>();

const lock = useInflightLock();
const locked = computed(() => lock.isLocked(props.lockKey));
const isBusy = computed(() => props.busy || locked.value);

function onClick(event: MouseEvent) {
  if (props.disabled) {
    event.preventDefault();
    return;
  }
  if (isBusy.value) {
    event.preventDefault();
    if (props.lockKey && locked.value) {
      emit('locked', props.lockKey);
    }
    return;
  }
  if (props.lockKey && props.acquireLock && !lock.acquire(props.lockKey)) {
    emit('locked', props.lockKey);
    return;
  }
  emit('click', event);
}
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="[variant, size]"
    :aria-disabled="disabled || undefined"
    :aria-busy="isBusy || undefined"
    :title="disabled ? disabledReason : undefined"
    @click="onClick"
  >
    <DsIcon v-if="icon" :name="icon" :size="size === 'xs' || size === 'sm' ? 13 : 15" />
    <slot />
  </button>
</template>

<style scoped>
.btn {
  --h: var(--ctl);
  height: var(--h);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: var(--r-2);
  border: 1px solid var(--line-2);
  background: var(--bg-2);
  color: var(--fg);
  font-family: var(--font-ui);
  font-size: var(--t-sm);
  font-weight: 500;
  white-space: nowrap;
  position: relative;
  user-select: none;
  cursor: pointer;
  transition:
    background var(--d-instant) var(--e-out),
    border-color var(--d-instant),
    transform var(--d-instant),
    opacity var(--d-fast);
}
.btn:hover {
  background: var(--bg-3);
  border-color: var(--fg-4);
}
.btn:active {
  transform: translateY(1px);
}
.btn.xs {
  --h: 24px;
  padding: 0 7px;
  font-size: var(--t-xs);
  gap: 4px;
}
.btn.sm {
  --h: 26px;
  padding: 0 8px;
}
.btn.lg {
  --h: 38px;
  padding: 0 14px;
  font-size: var(--t-md);
  font-weight: 600;
}
.btn.ghost {
  background: none;
  border-color: transparent;
  color: var(--fg-2);
}
.btn.ghost:hover {
  background: var(--bg-2);
  color: var(--fg);
}
.btn.primary {
  background: var(--fg);
  color: var(--bg);
  border-color: var(--fg);
}
.btn.primary:hover {
  opacity: 0.9;
}
.btn.danger-outline {
  color: var(--loss);
  border-color: color-mix(in srgb, var(--loss) 45%, var(--line-2));
  background: none;
}
.btn.danger-outline:hover {
  background: var(--loss-w);
}
.btn.danger {
  background: var(--loss);
  border-color: var(--loss);
  /* --bg on --loss keeps AA contrast in both themes (white on the dark-mode red was 2.7:1) */
  color: var(--bg);
}
.btn[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn[aria-disabled='true']:active {
  transform: none;
}
.btn[aria-busy='true'] {
  cursor: progress;
  color: transparent;
}
.btn[aria-busy='true'] > * {
  visibility: hidden;
}
.btn[aria-busy='true']::after {
  content: '';
  position: absolute;
  left: calc(50% - 7px);
  top: calc(50% - 7px);
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--fg-2);
  border-right-color: transparent;
  animation: fq-spin 700ms linear infinite;
}
.btn.primary[aria-busy='true']::after {
  border-color: var(--bg);
  border-right-color: transparent;
}
@media (max-width: 599px), (pointer: coarse) {
  .btn.xs,
  .btn.sm {
    --h: 36px;
    padding: 0 10px;
    font-size: var(--t-sm);
  }
  /* 44 px touch target around the 36 px button */
  .btn.xs::before,
  .btn.sm::before {
    content: '';
    position: absolute;
    inset: -4px;
  }
  .btn.lg {
    --h: 48px;
  }
}
</style>
