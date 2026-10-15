<script setup lang="ts">
import DsIcon from './DsIcon.vue';
import type { TabBarItem } from './types';

defineProps<{
  items: TabBarItem[];
  modelValue: string;
  label?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [id: string]; select: [id: string] }>();

function pick(id: string) {
  emit('update:modelValue', id);
  emit('select', id);
}
</script>

<template>
  <nav class="tabbar" :aria-label="label">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="it"
      :aria-current="item.id === modelValue ? 'page' : undefined"
      @click="pick(item.id)"
    >
      <span class="ic">
        <DsIcon :name="item.icon" :size="20" />
        <span v-if="item.count" class="count num" aria-hidden="true">{{
          item.count > 9 ? '9+' : item.count
        }}</span>
      </span>
      <span class="tx">{{ item.label }}</span>
      <span v-if="item.count" class="sr">{{ item.count }}</span>
    </button>
  </nav>
</template>

<style scoped>
/* backdrop-filter is allowed here only (section 6.3) */
.tabbar {
  display: flex;
  height: calc(56px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: color-mix(in srgb, var(--bg-1) 88%, transparent);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  border-top: 1px solid var(--line);
  flex: none;
}
.it {
  flex: 1;
  min-width: 44px;
  min-height: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: 0;
  background: none;
  color: var(--fg-3);
  font-family: var(--font-ui);
  font-size: var(--t-xs);
  font-weight: 500;
  cursor: pointer;
  position: relative;
}
.it[aria-current='page'] {
  color: var(--fg);
}
.it[aria-current='page']::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 28%;
  right: 28%;
  height: 2px;
  background: var(--accent);
  border-radius: 0 0 2px 2px;
}
.ic {
  position: relative;
  display: inline-flex;
}
.count {
  position: absolute;
  top: -5px;
  right: -9px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--crit);
  color: #fff;
  font: 700 11px / 16px var(--font-num);
  text-align: center;
}
@media (min-width: 1024px) {
  .tabbar {
    display: none;
  }
}
</style>
