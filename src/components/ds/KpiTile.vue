<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import Meter from './Meter.vue';
import type { KpiMeter } from './types';

defineOptions({ inheritAttrs: false });

defineProps<{
  label: string;
  /** Main figure; use the `value` slot for a PnlValue or a unit. */
  value?: string | number;
  /** One line under the figure, cut with an ellipsis, never over the next tile. */
  sub?: string;
  meter?: KpiMeter;
  /** Critical state: red underline. */
  alert?: boolean;
  wide?: boolean;
}>();

const attrs = useAttrs();
// A tile with a click handler becomes a button (opens the detail behind the figure)
const interactive = computed(() => typeof attrs.onClick === 'function');
</script>

<template>
  <component
    :is="interactive ? 'button' : 'div'"
    v-bind="attrs"
    class="kpi"
    :class="{ alert, wide }"
    :type="interactive ? 'button' : undefined"
  >
    <span class="k">{{ label }}</span>
    <span class="v num"
      ><slot name="value">{{ value }}</slot></span
    >
    <span v-if="sub || $slots.sub" class="s"
      ><slot name="sub">{{ sub }}</slot></span
    >
    <Meter
      v-if="meter"
      :value="meter.value"
      :max="meter.max"
      :threshold="meter.threshold"
      :tone="meter.tone"
      :label="label"
    />
    <slot />
  </component>
</template>

<style scoped>
.kpi {
  flex: 1 1 0;
  min-width: 132px;
  padding: 8px var(--s3) 9px;
  border: 0;
  border-right: 1px solid var(--line);
  background: none;
  color: inherit;
  text-align: left;
  font-family: var(--font-ui);
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: relative;
}
.kpi:last-child {
  border-right: 0;
}
button.kpi {
  cursor: pointer;
}
button.kpi:hover {
  background: var(--bg-2);
}
.k {
  font-size: var(--t-xs);
  color: var(--fg-3);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.v {
  font: 600 var(--t-xl) / 1.15 var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
  letter-spacing: -0.02em;
  white-space: nowrap;
}
.s {
  font-size: var(--t-xs);
  color: var(--fg-3);
  white-space: nowrap;
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kpi > :deep(.meter),
.kpi > :deep(.split) {
  margin-top: 4px;
}
.alert {
  box-shadow: inset 0 -2px 0 var(--crit);
}
.wide {
  flex-grow: 1.4;
  min-width: 190px;
}
/* Phone: two tiles per row, so a long figure ("15 292 / 10 203") shrinks to its tile instead of
   being cut at the screen edge */
@media (max-width: 599px) {
  .kpi {
    container-type: inline-size;
  }
  .v {
    font-size: clamp(14px, 10.5cqw, var(--t-xl));
  }
}
</style>
