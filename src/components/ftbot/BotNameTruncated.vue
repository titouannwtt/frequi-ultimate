<script setup lang="ts">
/**
 * BotNameTruncated — Truncated bot name with tooltip showing full name on hover.
 */
defineProps<{
  name: string;
  maxWidth?: string;
}>();
</script>

<template>
  <span
    v-tooltip.top="name"
    class="inline-block truncate align-bottom"
    :style="{ maxWidth: maxWidth ?? '120px' }"
    >{{ name }}</span
  >
</template>
