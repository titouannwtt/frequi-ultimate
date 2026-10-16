<script setup lang="ts">
import DsIcon from './DsIcon.vue';
import type { DsIconRef } from './types';
import ValueState from './ValueState.vue';

withDefaults(
  defineProps<{
    icon?: DsIconRef;
    title: string;
    hint?: string;
    /** The content is being read: a spinner replaces the icon (the title says what is awaited). */
    loading?: boolean;
  }>(),
  { icon: 'info' },
);
</script>

<template>
  <div class="empty">
    <ValueState v-if="loading" class="spin" state="pending" announce />
    <DsIcon v-else :name="icon" :size="18" />
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
/* The spinner is the size of the 18 px empty-state icon */
.spin {
  font-size: 20px;
  min-width: 0;
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
