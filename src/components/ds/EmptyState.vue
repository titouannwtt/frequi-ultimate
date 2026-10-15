<script setup lang="ts">
import DsIcon from './DsIcon.vue';
import type { DsIconRef } from './types';

withDefaults(
  defineProps<{
    icon?: DsIconRef;
    title: string;
    hint?: string;
  }>(),
  { icon: 'info' },
);
</script>

<template>
  <div class="empty">
    <DsIcon :name="icon" :size="18" />
    <strong>{{ title }}</strong>
    <p v-if="hint">{{ hint }}</p>
    <div v-if="$slots.default" class="act"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  padding: var(--s6) var(--s4);
  text-align: center;
  color: var(--fg-3);
  display: grid;
  justify-items: center;
  gap: 6px;
}
strong {
  font-weight: 600;
  color: var(--fg-2);
  font-size: var(--t-md);
}
p {
  margin: 0;
  font-size: var(--t-sm);
  max-width: 44ch;
}
.act {
  margin-top: 4px;
}
</style>
