<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
import { useElementVisibility } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { useNumberTween } from '@/composables/useNumberTween';
import { COUNTER_MS, prefersReducedMotion } from '@/utils/motion';
import { signClass } from './lib/format';
import { useFormat } from './lib/useFormat';
import ValueState from './ValueState.vue';

const props = withDefaults(
  defineProps<{
    value: number | null | undefined;
    decimals?: number;
    unit?: string;
    /** Count up to the new value (420 ms). */
    tween?: boolean;
    /** Flash green or red when the value moves. */
    flash?: boolean;
    /** Stale value: shown in the neutral colour, the sign stays written. */
    muted?: boolean;
    /** The source says the value is not known (an icon, never a made up number). */
    unknown?: boolean;
    /** `pending`: not received yet (spinner); `unavailable`: no figure (icon + `reason`). */
    state?: 'ready' | 'pending' | 'unavailable';
    /** Why the figure is unavailable, already translated (tooltip). */
    reason?: string;
    /** Identity of the wait, so the 45 s timeout survives a remount. */
    pendingKey?: string;
  }>(),
  { decimals: 2, tween: false, flash: false },
);

const { t } = useI18n();
const fmt = useFormat();

const el = ref<HTMLElement | null>(null);
// Only visible cells animate (section 9). The tween props are read once (static in practice), and a
// plain cell creates no IntersectionObserver: a fleet table holds one PnlValue per cell.
const animated = props.tween || props.flash;
const visible =
  animated && typeof IntersectionObserver !== 'undefined'
    ? useElementVisibility(el, { initialValue: true })
    : ref(true);

const target = toRef(() => (Number.isFinite(props.value as number) ? (props.value as number) : 0));
const { displayed, flashClass } = useNumberTween(target, {
  // The tween props are read once: they are static in practice
  duration: props.tween ? COUNTER_MS : 0,
  flash: props.flash,
  active: visible,
  reducedMotion: () => (!props.tween && !props.flash) || prefersReducedMotion(),
});

const known = computed(() => !props.unknown && Number.isFinite(props.value as number));
// A figure that is not one is never printed: the slot shows its state instead (never "n/a")
const slotState = computed(() =>
  props.state && props.state !== 'ready' ? props.state : known.value ? 'ready' : 'unavailable',
);
const slotReason = computed(() => props.reason ?? (props.unknown ? t('fq.value.reason.profit') : undefined));
const text = computed(() => fmt.signed(displayed.value, props.decimals));
const tone = computed(() =>
  props.muted || !known.value ? 'muted' : signClass(props.value as number, props.decimals),
);
</script>

<template>
  <span ref="el" class="pnl num" :class="[tone, flashClass]" :data-tone="tone">
    <ValueState
      v-if="slotState !== 'ready'"
      :state="slotState"
      :reason="slotReason"
      :pending-key="pendingKey"
    />
    <template v-else
      >{{ text
      }}<template v-if="unit"
        >&nbsp;<small>{{ unit }}</small></template
      ></template
    >
  </span>
</template>

<style scoped>
.pnl {
  white-space: nowrap;
}
.up {
  color: var(--profit);
}
.down {
  color: var(--loss);
}
.flat {
  color: var(--fg-2);
}
.muted {
  color: var(--fg-3);
}
small {
  font-size: 0.9em;
  font-weight: 500;
  color: var(--fg-3);
  letter-spacing: 0;
}
</style>
