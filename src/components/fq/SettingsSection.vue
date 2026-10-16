<script setup lang="ts">
import { DsIcon } from '@/components/ds';
import type { DsIconRef } from '@/components/ds';

/**
 * One section of the Settings page (02 section 3.6): a title with its icon, one sentence, and the
 * content in a panel. The id is the anchor of the section navigation.
 */
defineProps<{
  id: string;
  title: string;
  subtitle?: string;
  icon: DsIconRef;
}>();
</script>

<template>
  <section :id="`set-${id}`" class="ss" :data-section="id">
    <header>
      <h2><DsIcon :name="icon" :size="15" /> {{ title }}</h2>
      <p v-if="subtitle" class="sub">{{ subtitle }}</p>
    </header>
    <div class="panel"><slot /></div>
  </section>
</template>

<style scoped>
.ss {
  display: grid;
  gap: var(--s2);
  min-width: 0;
  scroll-margin-top: var(--s4);
  text-align: left;
}
h2 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--t-lg);
  font-weight: 600;
}
.sub {
  margin: 4px 0 0;
  color: var(--fg-2);
  font-size: var(--t-sm);
  max-width: 80ch;
}
.panel {
  display: grid;
  gap: var(--s3);
  padding: var(--s3) var(--s4);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--bg-1);
  min-width: 0;
}
.panel :deep(.frow:last-child) {
  border-bottom: 0;
}
</style>
