<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import DsIcon from './DsIcon.vue';
import type { HealthLevel } from './types';

/**
 * The bar at the foot of the desktop shell. It is quiet by default: the freshness (default slot) and
 * whatever is wrong. The health appears, in plain words, only when it is not OK; the error count
 * of the logs only when it is above zero. Rarely useful items go to `end` (right side).
 */
const props = defineProps<{
  health: HealthLevel;
  /** The health in plain words, with its reason: shown only when `health` is not `ok`. */
  healthText?: string;
  logsErrorCount: number;
}>();

const emit = defineEmits<{
  openHealth: [];
  openLogs: [];
}>();

const { t } = useI18n();
</script>

<template>
  <footer class="status" role="contentinfo">
    <slot />
    <button
      v-if="props.health !== 'ok'"
      type="button"
      class="si"
      :class="`lvl-${health}`"
      data-testid="sb-health"
      @click="emit('openHealth')"
    >
      <DsIcon name="activity" :size="13" />
      <b>{{ healthText ?? t(`fq.ds.health.${health}`) }}</b>
    </button>
    <button
      v-if="logsErrorCount > 0"
      type="button"
      class="si lvl-crit"
      data-testid="sb-logs"
      @click="emit('openLogs')"
    >
      <DsIcon name="terminal" :size="13" />
      {{ t('fq.shell.sb.logs', { n: logsErrorCount }, logsErrorCount) }}
    </button>
    <span class="sp"></span>
    <slot name="end" />
  </footer>
</template>

<style scoped>
.status {
  height: var(--sbar);
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 var(--s3);
  border-top: 1px solid var(--line);
  background: var(--bg-1);
  font-family: var(--font-ui);
  font-size: var(--t-xs);
  color: var(--fg-2);
  white-space: nowrap;
  overflow: hidden;
}
.si {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 7px;
  border-radius: var(--r-1);
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.si:hover {
  background: var(--bg-2);
  color: var(--fg);
}
.si b {
  font-weight: 600;
}
.sp {
  flex: 1;
}
.lvl-degraded {
  color: var(--warn);
}
.lvl-crit {
  color: var(--crit);
}
/* The bar is a desktop element: the phone has the tab bar instead */
@media (max-width: 1023px) {
  .status {
    display: none;
  }
}
</style>
