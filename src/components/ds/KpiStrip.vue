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
/* Tablet: four columns on two rows */
@media (min-width: 600px) and (max-width: 1023px) {
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    overflow: visible;
  }
  .kpis > :deep(.kpi) {
    min-width: 0;
    border-bottom: 1px solid var(--line);
  }
  .kpis > :deep(.kpi:nth-child(4n)) {
    border-right: 0;
  }
}
/* Phone: two columns, every figure visible without scrolling sideways */
@media (max-width: 599px) {
  .kpis {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow: visible;
  }
  .kpis > :deep(.kpi) {
    min-width: 0;
    border-bottom: 1px solid var(--line);
  }
  .kpis > :deep(.kpi:nth-child(even)) {
    border-right: 0;
  }
  .kpis > :deep(.kpi:last-child:nth-child(odd)) {
    grid-column: 1 / -1;
    border-right: 0;
  }
}
</style>
