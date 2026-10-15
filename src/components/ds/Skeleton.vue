<script setup lang="ts">
import type { SkeletonShape } from './types';

withDefaults(
  defineProps<{
    shape?: SkeletonShape;
    /** Number of lines or rows. */
    count?: number;
  }>(),
  { shape: 'line', count: 3 },
);
</script>

<template>
  <div class="skeleton" :class="shape" aria-hidden="true">
    <template v-if="shape === 'kpi'">
      <span class="sk k"></span>
      <span class="sk v"></span>
      <span class="sk s"></span>
    </template>
    <template v-else-if="shape === 'row'">
      <div v-for="n in count" :key="n" class="r">
        <span class="sk a"></span>
        <span class="sk b"></span>
        <span class="sk c"></span>
        <span class="sk d"></span>
      </div>
    </template>
    <template v-else>
      <span
        v-for="n in count"
        :key="n"
        class="sk"
        :style="{ width: n === count ? '60%' : '100%' }"
      ></span>
    </template>
  </div>
</template>

<style scoped>
.skeleton {
  display: grid;
  gap: 8px;
}
.skeleton.kpi {
  gap: 6px;
  padding: 8px var(--s3) 9px;
}
.k {
  width: 52%;
  height: 11px;
}
.v {
  width: 74%;
  height: 20px;
}
.s {
  width: 40%;
  height: 11px;
}
.skeleton.row {
  gap: 0;
}
.r {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  align-items: center;
  gap: 16px;
  height: var(--row);
  padding: 0 var(--s2);
  border-bottom: 1px solid var(--line);
}
.a {
  width: 70%;
}
.b,
.c,
.d {
  width: 80%;
  justify-self: end;
}
</style>
