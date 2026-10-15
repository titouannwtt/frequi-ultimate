<script setup lang="ts">
import { computed } from 'vue';
import { DS_ICONS } from './icons';
import type { DsIconRef } from './types';

const props = withDefaults(
  defineProps<{
    name: DsIconRef;
    /** Pixel size: tables 13, default 15, empty states 18, mobile bar 20. */
    size?: 13 | 15 | 18 | 20;
  }>(),
  { size: 15 },
);

const component = computed(() =>
  typeof props.name === 'string' ? DS_ICONS[props.name] : props.name,
);
</script>

<template>
  <component
    :is="component"
    :class="['ico', props.size !== 15 && `ico-${props.size}`]"
    aria-hidden="true"
  />
</template>
