<script setup lang="ts">
defineProps<{
  modelValue: boolean;
  /** Visible label, also the accessible name. */
  label?: string;
  /** Keep the label for assistive technology only (the row around the switch already says it). */
  hideLabel?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <label class="sw" :class="{ disabled }">
    <button
      type="button"
      role="switch"
      class="track"
      :aria-checked="modelValue"
      :aria-label="label"
      :aria-disabled="disabled || undefined"
      @click="!disabled && emit('update:modelValue', !modelValue)"
    ></button>
    <span v-if="label || $slots.default" class="text" :class="{ sr: hideLabel }"
      ><slot>{{ label }}</slot></span
    >
  </label>
</template>

<style scoped>
.sw {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: var(--t-sm);
}
.sw.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.track {
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  position: relative;
  flex: none;
  padding: 0;
  cursor: inherit;
  transition:
    background var(--d-fast) var(--e-out),
    border-color var(--d-fast);
}
.track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--fg-3);
  transition:
    transform var(--d-fast) var(--e-out),
    background var(--d-fast);
}
.track[aria-checked='true'] {
  background: var(--accent-w);
  border-color: var(--accent);
}
.track[aria-checked='true']::after {
  transform: translateX(14px);
  background: var(--accent);
}
@media (max-width: 599px), (pointer: coarse) {
  .sw {
    min-height: 44px;
  }
}
</style>
