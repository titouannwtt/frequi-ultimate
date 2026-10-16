<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import Meter from './Meter.vue';
import ValueState from './ValueState.vue';
import type { KpiMeter } from './types';

defineOptions({ inheritAttrs: false });

defineProps<{
  label: string;
  /** Plain-words definition of the technical term behind the label, shown as a tooltip. */
  hint?: string;
  /** Shorter label shown when the tile is narrow (a phone, a crowded strip). */
  shortLabel?: string;
  /** Main figure; use the `value` slot for a PnlValue or a unit. */
  value?: string | number;
  /** One line under the figure, cut with an ellipsis, never over the next tile. */
  sub?: string;
  meter?: KpiMeter;
  /** Critical state: red underline. */
  alert?: boolean;
  wide?: boolean;
  /** `pending` (spinner) or `unavailable` (icon + `reason`) replaces the figure; default `ready`. */
  state?: 'ready' | 'pending' | 'unavailable';
  /** Why the figure is unavailable, already translated (tooltip). */
  reason?: string;
  pendingKey?: string;
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
    <span class="k" :title="hint"
      ><span :class="{ 'k-full': shortLabel }">{{ label }}</span
      ><span v-if="shortLabel" class="k-short" aria-hidden="true" :data-short="shortLabel"></span
      ><span v-if="hint" class="q" aria-hidden="true">?</span></span
    >
    <span class="v num"
      ><ValueState :state="state" :reason="reason" :pending-key="pendingKey" announce
        ><slot name="value">{{ value }}</slot></ValueState
      ></span
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
  container-type: inline-size;
  flex: 1 1 0;
  min-width: 132px;
  padding: var(--kpi-pad-y) var(--kpi-pad-x) calc(var(--kpi-pad-y) + 1px);
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
  font-size: var(--t-label);
  color: var(--fg-3);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.k-short {
  display: none;
}
.k-short::before {
  content: attr(data-short);
}
/* A narrow tile swaps its label for the short one rather than cutting it with an ellipsis */
@container (max-width: 190px) {
  .k-full {
    display: none;
  }
  .k-short {
    display: inline;
  }
}
.q {
  display: inline-grid;
  place-items: center;
  width: 14px;
  height: 14px;
  margin-left: 5px;
  border: 1px solid var(--fg-4);
  border-radius: 50%;
  font-size: 9.5px;
  line-height: 1;
  color: var(--fg-3);
  vertical-align: 1px;
}
.v {
  font: 600 var(--t-xl) / 1.15 var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
  letter-spacing: -0.02em;
  white-space: nowrap;
}
.s {
  font-size: var(--t-label);
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
  .v {
    font-size: clamp(14px, 10.5cqw, var(--t-xl));
  }
}
</style>
