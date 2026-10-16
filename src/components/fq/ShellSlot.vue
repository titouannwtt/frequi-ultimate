<script setup lang="ts">
/**
 * Puts a page's strip, scope bar or banner into the shell. The shell (`AppShell`) is mounted once
 * by `App.vue` and stays across navigation; a page that needs one of its three bands renders it
 * here and it lands in the right place without the shell being remounted.
 */
defineProps<{ name: 'strip' | 'scope' | 'banner' }>();
</script>

<template>
  <Teleport :to="`#fq-shell-${name}`" defer><slot /></Teleport>
</template>
