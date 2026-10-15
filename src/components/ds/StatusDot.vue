<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BotState } from './types';

const props = defineProps<{ state: BotState }>();

const { t } = useI18n();

const LABELS: Record<BotState, string> = {
  online: 'fq.ds.state.online',
  starting: 'fq.status.starting',
  offline: 'fq.status.offline',
  stopped: 'fq.status.stopped',
  auth_expired: 'fq.status.sessionExpired',
  stale: 'fq.status.stale',
};

const label = computed(() => t(LABELS[props.state]));
</script>

<template>
  <span class="dot" :class="state" role="img" :aria-label="label" :title="label"></span>
</template>

<style scoped>
/* The shape also changes with the state (circle, ring, square) so colour is never alone */
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  display: inline-block;
  background: var(--profit);
}
.starting {
  background: var(--info);
  animation: fq-pulse 1.6s var(--e-inout) infinite;
}
.offline {
  background: var(--crit);
}
.stopped {
  background: transparent;
  border: 1.5px solid var(--fg-3);
}
.auth_expired {
  background: var(--warn);
  border-radius: 2px;
}
.stale {
  background: var(--warn);
}
</style>
