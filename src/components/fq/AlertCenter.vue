<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import { AdaptiveSheet } from '@/components/ds';
import { useActionNav } from '@/composables/useActionNav';

import AlertRail from './AlertRail.vue';

/**
 * Behind the bell (docs/redesign/05-friendly-plan.md, L4): everything the Fleet no longer keeps in
 * a rail of its own. The active alerts, the acknowledged and the silenced ones, the events and
 * "Since your last visit", from any page. The Fleet itself only shows the active alerts as cards.
 */
defineProps<{ open: boolean; inline?: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const nav = useActionNav();

function onAction(
  id: Parameters<typeof nav.alertAction>[0],
  alert: Parameters<typeof nav.alertAction>[1],
) {
  emit('close');
  nav.alertAction(id, alert);
}
</script>

<template>
  <AdaptiveSheet :open="open" :inline="inline" :title="t('fq.shell.alerts')" @close="emit('close')">
    <AlertRail class="center" @action="onAction" />
  </AdaptiveSheet>
</template>

<style scoped>
.center {
  border: 0;
  border-radius: 0;
}
</style>
