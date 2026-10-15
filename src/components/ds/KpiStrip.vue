<script setup lang="ts">
import { ref } from 'vue';
import { useEdgeFade } from './lib/useEdgeFade';

defineProps<{ label?: string }>();

const root = ref<HTMLElement | null>(null);
useEdgeFade(root);
</script>

<template>
  <div ref="root" class="kpis" role="group" :aria-label="label">
    <slot />
  </div>
</template>

<style scoped>
.kpis {
  display: flex;
  flex: none;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  scrollbar-width: none;
}
.kpis::-webkit-scrollbar {
  display: none;
}
</style>
