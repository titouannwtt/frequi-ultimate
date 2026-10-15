<script setup lang="ts">
import { computed } from 'vue';
import type { MeterTone } from './types';

const props = withDefaults(
  defineProps<{
    value: number;
    max?: number;
    /** Position of a threshold mark, in the same unit as `value`. */
    threshold?: number;
    tone?: MeterTone;
    /** Accessible name. */
    label?: string;
  }>(),
  { max: 100, tone: 'neutral' },
);

const pct = computed(() => Math.max(0, Math.min(100, (props.value / (props.max || 1)) * 100)));
const thresholdPct = computed(() =>
  props.threshold === undefined
    ? undefined
    : Math.max(0, Math.min(100, (props.threshold / (props.max || 1)) * 100)),
);
</script>

<template>
  <div
    class="meter"
    role="meter"
    :aria-valuenow="value"
    aria-valuemin="0"
    :aria-valuemax="max"
    :aria-label="label"
  >
    <i :class="tone" :style="{ width: pct + '%' }"></i>
    <b v-if="thresholdPct !== undefined" :style="{ left: `calc(${thresholdPct}% - 1px)` }"></b>
  </div>
</template>

<style scoped>
.meter {
  height: 4px;
  border-radius: 2px;
  background: var(--bg-3);
  position: relative;
  min-width: 30px;
}
i {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: var(--fg-2);
  transition: width var(--d-slow) var(--e-out);
}
i.ok {
  background: var(--profit);
}
i.warn {
  background: var(--warn);
}
i.crit {
  background: var(--crit);
}
i.info {
  background: var(--info);
}
i.neutral {
  background: var(--fg-3);
}
b {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  background: var(--fg);
  border-radius: 1px;
}
</style>
