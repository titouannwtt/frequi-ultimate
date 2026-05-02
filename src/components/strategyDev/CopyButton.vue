<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    text: string;
    label?: string;
    size?: 'xs' | 'sm' | 'md';
    variant?: 'button' | 'icon';
  }>(),
  { size: 'sm', variant: 'button' },
);

const copied = ref(false);
let timeout: ReturnType<typeof setTimeout>;

async function doCopy() {
  try {
    await navigator.clipboard.writeText(props.text);
    copied.value = true;
    clearTimeout(timeout);
    timeout = setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = props.text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copied.value = true;
    clearTimeout(timeout);
    timeout = setTimeout(() => { copied.value = false; }, 2000);
  }
}
</script>

<template>
  <button
    class="copy-btn"
    :class="[`copy-btn--${size}`, `copy-btn--${variant}`, { 'copy-btn--copied': copied }]"
    :title="copied ? t('strategyDev.copied') : (label || t('strategyDev.copy'))"
    @click.stop="doCopy"
  >
    <Transition name="copy-icon" mode="out-in">
      <i-mdi-check v-if="copied" :key="'check'" class="copy-icon sd-copied" />
      <i-mdi-content-copy v-else :key="'copy'" class="copy-icon" />
    </Transition>
    <span v-if="variant === 'button'" class="copy-label">
      {{ copied ? t('strategyDev.copied') : (label || t('strategyDev.copy')) }}
    </span>
  </button>
</template>

<style scoped>
.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--sd-border);
  border-radius: var(--sd-radius-sm);
  background: transparent;
  color: var(--sd-subtext);
  cursor: pointer;
  transition: all var(--sd-transition-fast);
  white-space: nowrap;
}

.copy-btn:hover {
  background: var(--sd-surface0);
  color: var(--sd-text);
}

.copy-btn--copied {
  border-color: var(--sd-success) !important;
  color: var(--sd-success) !important;
}

.copy-btn--xs { padding: 2px 6px; font-size: var(--sd-text-2xs); }
.copy-btn--sm { padding: 3px 8px; font-size: var(--sd-text-xs); }
.copy-btn--md { padding: 4px 10px; font-size: var(--sd-text-sm); }

.copy-btn--icon {
  padding: 4px;
  border: none;
  border-radius: var(--sd-radius-sm);
}

.copy-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.copy-btn--xs .copy-icon { width: 12px; height: 12px; }

.copy-label {
  font-weight: 500;
}

.copy-icon-enter-active,
.copy-icon-leave-active {
  transition: opacity 100ms ease, transform 100ms ease;
}
.copy-icon-enter-from {
  opacity: 0;
  transform: scale(0.8);
}
.copy-icon-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
</style>
