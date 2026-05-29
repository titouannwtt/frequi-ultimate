<script setup lang="ts">
const settingsStore = useSettingsStore();
const colorStore = useColorStore();
onMounted(() => {
  setTimezone(settingsStore.timezone);
  colorStore.updateProfitLossColor();
});
watch(
  () => settingsStore.timezone,
  (tz) => {
    console.log('timezone changed', tz);
    setTimezone(tz);
  },
);
</script>

<template>
  <div id="app" class="flex flex-col h-dvh" :style="colorStore.cssVars">
    <NavBar />
    <Toast />
    <BodyLayout class="grow overflow-auto" />
    <NavFooter />
  </div>
  <!-- Boot splash: covers the brief gap between page navigation and first bot data. -->
  <BootSplash />
</template>

<style scoped>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
}
</style>

<style>
/* Toast container must not intercept clicks on elements below it (navbar).
   PrimeVue sets position:fixed + high z-index on .p-toast, which can cover
   the navbar and swallow click events even when no messages are visible. */
.p-toast {
  pointer-events: none !important;
}
.p-toast-message {
  pointer-events: auto;
}
</style>
