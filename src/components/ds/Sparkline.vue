<script setup lang="ts">
import { computed } from 'vue';
import { buildSparkline } from './lib/sparkline';

const props = withDefaults(
  defineProps<{
    values: number[];
    width?: number;
    height?: number;
    /** Accessible description; the chart is decorative without it. */
    label?: string;
  }>(),
  { width: 64, height: 18 },
);

const geo = computed(() => buildSparkline(props.values, props.width, props.height));
</script>

<template>
  <svg
    class="spark"
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="none"
    :style="{ width: width + 'px', height: height + 'px' }"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
  >
    <path class="z" :d="`M0,${geo.zeroY.toFixed(1)} L${width},${geo.zeroY.toFixed(1)}`" />
    <path class="line" :d="geo.path" :class="geo.up ? 'up' : 'down'" />
  </svg>
</template>

<style scoped>
.spark {
  display: block;
}
path {
  fill: none;
  stroke-width: 1.4;
  vector-effect: non-scaling-stroke;
}
.z {
  stroke: var(--line-2);
  stroke-dasharray: 2 2;
  stroke-width: 1;
}
.up {
  stroke: var(--profit);
}
.down {
  stroke: var(--loss);
}
</style>
