<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useFormat } from '@/components/ds/lib/useFormat';

/**
 * Excursions of a closed trade as a micro-bar (02 section 3.4): the adverse excursion to the left
 * in the loss colour, the favourable one to the right in the gain colour, the tick is where the
 * trade exited. Ratios of the stake, like `profit_ratio`; the scale is 8 % by default and a bar
 * never leaves its track. Without the figures (direct mode) it says so instead of drawing.
 */
const props = withDefaults(
  defineProps<{
    mae: number | null | undefined;
    mfe: number | null | undefined;
    exit?: number | null;
    /** Half-width of the track as a ratio of the stake. */
    scale?: number;
    wide?: boolean;
  }>(),
  { scale: 0.08 },
);

const { t } = useI18n();
const fmt = useFormat();

const known = computed(() => props.mae != null && props.mfe != null);
const clamp = (v: number) => Math.max(-50, Math.min(50, v));
const left = computed(() =>
  Math.min(50, (Math.abs(Math.min(0, props.mae ?? 0)) / props.scale) * 50),
);
const right = computed(() => Math.min(50, (Math.max(0, props.mfe ?? 0) / props.scale) * 50));
const tick = computed(() =>
  props.exit == null ? null : 50 + clamp((props.exit / props.scale) * 50),
);
const title = computed(() =>
  known.value
    ? t('fq.jr.maeTitle', {
        mae: fmt.percent((props.mae as number) * 100, 1),
        mfe: fmt.percent((props.mfe as number) * 100, 1),
        exit: props.exit == null ? t('fq.ds.dash') : fmt.percent(props.exit * 100, 1),
      })
    : t('fq.jr.maeUnavailable'),
);
</script>

<template>
  <span v-if="known" class="mm" :class="{ wide }" role="img" :aria-label="title" :title="title">
    <i class="a" :style="{ width: `${left}%` }"></i>
    <i class="f" :style="{ width: `${right}%` }"></i>
    <i v-if="tick !== null" class="x" :style="{ left: `${tick}%` }"></i>
  </span>
  <span v-else class="na" :title="title">{{ t('fq.ds.notAvailable') }}</span>
</template>

<style scoped>
.mm {
  display: inline-block;
  position: relative;
  width: 96px;
  height: 10px;
  vertical-align: -1px;
}
.mm.wide {
  width: 100%;
  height: 12px;
}
.mm::before {
  content: '';
  position: absolute;
  left: 50%;
  top: -2px;
  bottom: -2px;
  width: 1px;
  background: var(--line-2);
}
.a,
.f,
.x {
  position: absolute;
}
.a {
  top: 2px;
  right: 50%;
  height: 6px;
  background: var(--loss);
  opacity: 0.75;
  border-radius: 1px 0 0 1px;
}
.f {
  top: 2px;
  left: 50%;
  height: 6px;
  background: var(--profit);
  opacity: 0.75;
  border-radius: 0 1px 1px 0;
}
.x {
  top: -1px;
  width: 2px;
  height: 12px;
  background: var(--fg);
  margin-left: -1px;
}
.na {
  color: var(--fg-3);
}
</style>
