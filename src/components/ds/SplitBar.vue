<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormat } from './lib/useFormat';

const props = defineProps<{
  /** Long exposure (any positive unit; only the ratio matters). */
  long: number;
  short: number;
}>();

const { t } = useI18n();
const fmt = useFormat();

const total = computed(() => Math.max(0, props.long) + Math.max(0, props.short));
const longPct = computed(() =>
  total.value > 0 ? (Math.max(0, props.long) / total.value) * 100 : 0,
);
const shortPct = computed(() => (total.value > 0 ? 100 - longPct.value : 0));
const label = computed(
  () =>
    `${t('fq.side.long')} ${fmt.percent(longPct.value, 0, false)}, ${t('fq.side.short')} ${fmt.percent(shortPct.value, 0, false)}`,
);
</script>

<template>
  <div class="split" role="img" :aria-label="label">
    <span v-if="longPct > 0" class="l" :style="{ flexGrow: longPct }"></span>
    <!-- The short side is hatched so the two sides differ without colour -->
    <span v-if="shortPct > 0" class="s" :style="{ flexGrow: shortPct }"></span>
  </div>
</template>

<style scoped>
.split {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  gap: 2px;
  background: var(--bg-3);
}
.l {
  background: var(--long);
  flex-basis: 0;
}
.s {
  background: var(--short);
  background-image: var(--short-hatch);
  flex-basis: 0;
}
</style>
