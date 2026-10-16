<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { DsIcon } from '@/components/ds';
import { TOOL_PATHS, type ToolId } from '@/router/legacy';

/** Tools index (02 section 3.5): a grid of cards, the discreet home of the lab pages. */
const { t } = useI18n();
const router = useRouter();

const PRIMARY: ToolId[] = ['diagnostic', 'reconciliation', 'risk', 'logs'];
const LAB: ToolId[] = [
  'strategyDev',
  'backtest',
  'downloadData',
  'pairlistConfig',
  'replay',
  'volume',
];
</script>

<template>
  <div class="tools" data-testid="tools-index">
    <h1>{{ t('fq.nav.tools') }}</h1>
    <section v-for="(group, gi) in [PRIMARY, LAB]" :key="gi" class="grid">
      <button
        v-for="id in group"
        :key="id"
        type="button"
        class="card"
        :data-tool="id"
        @click="router.push(TOOL_PATHS[id])"
      >
        <DsIcon name="wrench" :size="15" />
        <b>{{ t(`fq.tools.${id}`) }}</b>
        <span>{{ t(`fq.pg.toolsHint.${id}`) }}</span>
      </button>
    </section>
  </div>
</template>

<style scoped>
.tools {
  padding: var(--s4);
  display: grid;
  gap: var(--s4);
  align-content: start;
  text-align: left;
}
h1 {
  margin: 0;
  font-size: var(--t-lg);
  font-weight: 600;
}
.grid {
  display: grid;
  gap: var(--s3);
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
}
.card {
  display: grid;
  gap: 4px;
  text-align: left;
  padding: var(--s3);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--bg-1);
  color: var(--fg);
  font: inherit;
  cursor: pointer;
}
.card:hover {
  background: var(--bg-2);
}
.card span {
  color: var(--fg-3);
  font-size: var(--t-sm);
}
</style>
