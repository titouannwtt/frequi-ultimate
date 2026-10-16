<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { Badge, DsIcon } from '@/components/ds';

/**
 * The frame of a page of the Tools (02 section 3.5): a way back to the index, the title, one
 * sentence, and the tags that say where the work happens ("Python" for what runs in the bot's own
 * tooling, "par bot" for what needs one bot chosen). The page scrolls inside the shell.
 */
defineProps<{
  title: string;
  subtitle?: string;
  tags?: Array<'python' | 'perBot'>;
}>();

const { t } = useI18n();
const router = useRouter();
</script>

<template>
  <div class="tf" data-testid="tool-frame">
    <header>
      <button type="button" class="back" @click="router.push({ name: 'tools' })">
        <DsIcon name="chevron-left" :size="13" />
        {{ t('fq.nav.tools') }}
      </button>
      <div class="ttl">
        <h1>{{ title }}</h1>
        <Badge v-for="g in tags ?? []" :key="g" kind="neutral" :label="t(`fq.pg.tools.tag.${g}`)" />
        <span class="grow"></span>
        <slot name="actions" />
      </div>
      <p v-if="subtitle" class="sub">{{ subtitle }}</p>
    </header>
    <div class="body"><slot /></div>
  </div>
</template>

<style scoped>
.tf {
  display: grid;
  gap: var(--s3);
  padding: var(--s4);
  align-content: start;
  min-width: 0;
  text-align: left;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--fg-3);
  font: inherit;
  font-size: var(--t-sm);
  cursor: pointer;
}
.back:hover {
  color: var(--fg);
}
.ttl {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s2);
  margin-top: 2px;
}
h1 {
  margin: 0;
  font-size: var(--t-lg);
  font-weight: 600;
}
.grow {
  flex: 1 1 auto;
}
.sub {
  margin: 4px 0 0;
  color: var(--fg-2);
  font-size: var(--t-sm);
  max-width: 80ch;
}
.body {
  display: grid;
  gap: var(--s3);
  min-width: 0;
}
@media (max-width: 599px) {
  .tf {
    padding: var(--s3);
  }
}
</style>
