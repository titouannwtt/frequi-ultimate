<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { Btn, EmptyState } from '@/components/ds';

/** Any address that leads nowhere: said plainly, with the way back, instead of a blank screen. */
const { t } = useI18n();
const router = useRouter();
</script>

<template>
  <div class="nf" data-testid="not-found">
    <EmptyState icon="info" :title="t('fq.pg.notFound.title')" :hint="t('fq.pg.notFound.hint')">
      <Btn @click="router.push({ name: 'fleet' })">{{ t('fq.pg.notFound.fleet') }}</Btn>
    </EmptyState>
  </div>
</template>

<style scoped>
.nf {
  display: grid;
  place-items: center;
  min-height: 50vh;
  padding: var(--s6);
}
</style>
