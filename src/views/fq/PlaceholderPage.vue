<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { Btn, EmptyState } from '@/components/ds';
import { TOOL_PATHS } from '@/router/legacy';

/**
 * Temporary page of the redesign (steps 2 and 3 replace it): Charts and the Tools that have no
 * counterpart yet. It says so plainly and points to what works today, instead of a blank screen.
 */
const props = defineProps<{ id: string }>();

const { t, te } = useI18n();
const router = useRouter();

const title = computed(() => {
  if (props.id === 'charts') return t('fq.nav.charts');
  return te(`fq.tools.${props.id}`) ? t(`fq.tools.${props.id}`) : props.id;
});
const known = computed(() => props.id === 'charts' || props.id in TOOL_PATHS);
</script>

<template>
  <div class="ph" data-testid="placeholder-page">
    <EmptyState
      v-if="known"
      icon="wrench"
      :title="t('fq.pg.placeholder.title', { name: title })"
      :hint="t('fq.pg.placeholder.hint')"
    >
      <Btn @click="router.push({ name: 'fleet' })">{{ t('fq.nav.fleet') }}</Btn>
    </EmptyState>
    <EmptyState v-else icon="info" :title="t('fq.pg.placeholder.unknown', { name: id })">
      <Btn @click="router.push({ name: 'tools' })">{{ t('fq.nav.tools') }}</Btn>
    </EmptyState>
  </div>
</template>

<style scoped>
.ph {
  display: grid;
  place-items: center;
  min-height: 50vh;
  padding: var(--s6);
}
</style>
