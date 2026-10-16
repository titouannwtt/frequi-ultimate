<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

export interface DcaLadderHPosition {
  /** Orders filled, entry included. */
  filled: number;
  max: number;
  /** Normalised 0..1: 0 is the liquidation side, 1 the take-profit side, for a long or a short. */
  avg: number;
  /** Normalised take profit; absent when the bot's take profit is not known (no marker drawn). */
  tp?: number;
  price: number;
  /** Optional normalised position of each level; evenly spread from the entry by default. */
  levels?: number[];
  /** Text of the liquidation end, for example "liq. 18 %". */
  liqText?: string;
}

const props = defineProps<{ position: DcaLadderHPosition }>();

const { t } = useI18n();

const pct = (v: number) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(2)}%`;

const levels = computed(() => {
  const { max, filled } = props.position;
  const step = 0.64 / Math.max(1, max);
  return Array.from({ length: max }, (_, k) => ({
    x: props.position.levels?.[k] ?? 0.84 - k * step,
    done: k < filled,
    next: k === filled,
  }));
});
const label = computed(() =>
  t(
    'fq.ds.dcaFilled',
    { filled: props.position.filled, max: props.position.max },
    props.position.filled,
  ),
);
</script>

<template>
  <div class="lad-h" role="img" :aria-label="label">
    <span class="rail"></span>
    <span class="liq" :title="t('fq.ds.ladder.liquidation')"></span>
    <span
      v-if="position.tp !== undefined"
      class="gain"
      :style="{
        left: pct(position.avg),
        width: `calc(${pct(position.tp)} - ${pct(position.avg)})`,
      }"
    ></span>
    <span
      v-for="(lv, k) in levels"
      :key="k"
      class="lv"
      :class="{ pend: !lv.done, next: lv.next }"
      :style="{ left: pct(lv.x) }"
    ></span>
    <span class="avg" :style="{ left: pct(position.avg) }"></span>
    <span v-if="position.tp !== undefined" class="tp" :style="{ left: pct(position.tp) }"></span>
    <span class="px" :style="{ left: pct(position.price) }"></span>
    <span class="t l0" style="left: 0">{{
      position.liqText ?? t('fq.ds.ladder.liquidation')
    }}</span>
    <span class="t mid" :style="{ left: `${Math.max(30, Math.min(70, position.avg * 100))}%` }">{{
      label
    }}</span>
    <span v-if="position.tp !== undefined" class="t r0" style="left: 100%">{{
      t('fq.ds.ladder.tp')
    }}</span>
  </div>
</template>

<style scoped>
.lad-h {
  position: relative;
  height: 34px;
  margin: 4px 2px 0;
}
.rail {
  position: absolute;
  left: 0;
  right: 0;
  top: 14px;
  height: 2px;
  background: var(--line-2);
}
.liq {
  position: absolute;
  left: 0;
  top: 8px;
  width: 14%;
  height: 14px;
  background: var(--off-hatch);
  border-left: 2px solid var(--crit);
}
.gain {
  position: absolute;
  top: 13px;
  height: 4px;
  background: var(--profit-w);
}
.lv {
  position: absolute;
  top: 9px;
  width: 8px;
  height: 12px;
  margin-left: -4px;
  border-radius: 2px;
  background: var(--fg-2);
}
.lv.pend {
  background: none;
  border: 1px dashed var(--fg-3);
}
.lv.next {
  border-color: var(--warn);
}
.avg,
.tp {
  position: absolute;
  top: 6px;
  width: 2px;
  height: 18px;
}
.avg {
  background: var(--accent);
}
.tp {
  background: var(--profit);
}
.px {
  position: absolute;
  top: 3px;
  width: 0;
  height: 0;
  margin-left: -5px;
  border: 5px solid transparent;
  border-top: 7px solid var(--fg);
  transition: left var(--d-slow) var(--e-out);
}
.t {
  position: absolute;
  top: 24px;
  font: 500 var(--t-xs) var(--font-num);
  color: var(--fg-3);
  white-space: nowrap;
  transform: translateX(-50%);
}
.t.l0 {
  transform: none;
}
.t.r0 {
  transform: translateX(-100%);
}
</style>
