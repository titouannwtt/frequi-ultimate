<script setup lang="ts">
defineOptions({ inheritAttrs: false });
</script>

<template>
  <Popover
    v-bind="$attrs"
    :pt="{
      root: {
        class: 'unified-popover',
      },
    }"
  >
    <slot />
  </Popover>
</template>

<style scoped>
:deep(.unified-popover) {
  background: rgba(245, 242, 238, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(16px);
  animation: ft-scale-in 200ms ease-out;
}

:global(.ft-dark-theme) :deep(.unified-popover) {
  background: rgba(20, 20, 35, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
}
</style>
