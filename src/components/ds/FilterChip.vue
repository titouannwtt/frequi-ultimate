<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import DsIcon from './DsIcon.vue';
import type { DsIconRef } from './types';

defineProps<{
  label: string;
  count?: number;
  active?: boolean;
  removable?: boolean;
  icon?: DsIconRef;
}>();

const emit = defineEmits<{ toggle: []; remove: [] }>();

const { t } = useI18n();
</script>

<template>
  <span class="chip" :class="{ on: active }">
    <button
      type="button"
      class="main"
      :aria-pressed="active ? true : false"
      @click="emit('toggle')"
    >
      <DsIcon v-if="icon" :name="icon" :size="13" />
      <span>{{ label }}</span>
      <span v-if="count !== undefined" class="n num">{{ count }}</span>
    </button>
    <button
      v-if="removable"
      type="button"
      class="x"
      :aria-label="t('fq.ds.remove', { name: label })"
      @click="emit('remove')"
    >
      <DsIcon name="x" :size="13" />
    </button>
  </span>
</template>

<style scoped>
.chip {
  height: var(--ctl);
  display: inline-flex;
  align-items: center;
  border-radius: var(--r-pill);
  white-space: nowrap;
  flex: none;
  border: 1px dashed var(--line-2);
  color: var(--fg-2);
  font-size: var(--t-sm);
}
.chip:hover {
  border-color: var(--fg-4);
  color: var(--fg);
}
.chip.on {
  border-style: solid;
  background: var(--accent-w);
  border-color: color-mix(in srgb, var(--accent) 45%, transparent);
  color: var(--fg);
}
button {
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  height: 100%;
}
.main {
  padding: 0 9px;
  border-radius: var(--r-pill);
}
.chip:has(.x) .main {
  padding-right: 4px;
}
.x {
  padding: 0 7px 0 2px;
  opacity: 0.7;
  border-radius: var(--r-pill);
}
.x:hover {
  opacity: 1;
}
.n {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
@media (max-width: 599px), (pointer: coarse) {
  .chip {
    min-height: 44px;
  }
}
</style>
