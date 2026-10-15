<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import DsIcon from './DsIcon.vue';
import type { Side } from './types';

const props = defineProps<{
  side: Side;
  leverage?: number;
}>();

const { t } = useI18n();

const letter = computed(() =>
  props.side === 'long'
    ? t('fq.side.longLetter')
    : props.side === 'short'
      ? t('fq.side.shortLetter')
      : `${t('fq.side.longLetter')}·${t('fq.side.shortLetter')}`,
);
const name = computed(() =>
  props.side === 'long'
    ? t('fq.side.long')
    : props.side === 'short'
      ? t('fq.side.short')
      : `${t('fq.side.long')} / ${t('fq.side.short')}`,
);
const label = computed(() => (props.leverage ? `${name.value} x${props.leverage}` : name.value));
</script>

<template>
  <span class="dir" :class="side" :title="name" role="img" :aria-label="label">
    <!-- Green/red alone would read as a P&L: the arrow and the L/S letter always come with it -->
    <DsIcon v-if="side === 'long'" name="arrow-up-right" :size="13" />
    <DsIcon v-else-if="side === 'short'" name="arrow-down-right" :size="13" />
    <span aria-hidden="true">{{ letter }}</span>
    <span v-if="leverage" class="lev" aria-hidden="true">&times;{{ leverage }}</span>
  </span>
</template>

<style scoped>
.dir {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font: 600 var(--t-xs) / 1 var(--font-num);
  white-space: nowrap;
}
.long {
  color: var(--long);
}
.short {
  color: var(--short);
}
.both {
  color: var(--fg-2);
}
.lev {
  color: var(--fg-3);
  font-weight: 500;
}
</style>
