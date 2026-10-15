<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import DsIcon from './DsIcon.vue';
import type { Density, HealthLevel } from './types';

const props = defineProps<{
  health: HealthLevel;
  logsErrorCount: number;
  density: Density;
}>();

const emit = defineEmits<{
  openHealth: [];
  openLogs: [];
  'update:density': [value: Density];
}>();

const { t } = useI18n();

const healthLabel = computed(() => t(`fq.ds.health.${props.health}`));
</script>

<template>
  <footer class="status" role="contentinfo">
    <button type="button" class="si" :class="`lvl-${health}`" @click="emit('openHealth')">
      <DsIcon name="activity" :size="13" />
      {{ t('fq.ds.health.title') }}
      <b>{{ healthLabel }}</b>
    </button>
    <button type="button" class="si" @click="emit('openLogs')">
      <DsIcon name="terminal" :size="13" />
      {{ t('fq.ds.logs') }}
      <span class="num" :class="{ 'lvl-crit': logsErrorCount > 0 }">{{ logsErrorCount }}</span>
    </button>
    <slot />
    <span class="sp"></span>
    <button
      type="button"
      class="si"
      :aria-pressed="density === 'comfortable'"
      @click="emit('update:density', density === 'compact' ? 'comfortable' : 'compact')"
    >
      <DsIcon name="layout-grid" :size="13" />
      {{ density === 'compact' ? t('fq.ds.density.compact') : t('fq.ds.density.comfortable') }}
    </button>
  </footer>
</template>

<style scoped>
.status {
  height: 26px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 var(--s2);
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
.num {
  color: var(--fg);
}
.sp {
  flex: 1;
}
.lvl-ok {
  color: var(--profit);
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
