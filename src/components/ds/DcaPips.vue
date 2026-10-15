<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  /** Orders filled, entry included. */
  filled: number;
  max: number;
  /** Show the "filled/max" figure after the pips. */
  showCount?: boolean;
}>();

const { t } = useI18n();

const pips = computed(() =>
  Array.from({ length: props.max }, (_, k) => ({
    filled: k < props.filled,
    // The last safety order is amber from the 4th fill on
    last: k === props.filled - 1 && props.filled > 3,
  })),
);
</script>

<template>
  <span class="pips" role="img" :aria-label="t('fq.ds.dcaFilled', { filled, max })">
    <i v-for="(p, k) in pips" :key="k" :class="{ e: !p.filled, last: p.last }"></i>
    <span v-if="showCount" class="n num" aria-hidden="true">{{ filled }}/{{ max }}</span>
  </span>
</template>

<style scoped>
.pips {
  display: inline-flex;
  gap: 2px;
  align-items: center;
}
i {
  width: 4px;
  height: 11px;
  border-radius: 1px;
  background: var(--fg-2);
}
i.e {
  background: none;
  box-shadow: inset 0 0 0 1px var(--line-2);
}
i.last {
  background: var(--warn);
}
.n {
  margin-left: 5px;
  font-size: var(--t-xs);
  color: var(--fg-3);
}
</style>
