<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const stratDevStore = useStrategyDevStore();
const botStore = useBotStore();
const showLeftBar = ref(true);

onMounted(async () => {
  await botStore.activeBot.getState();
  await Promise.all([stratDevStore.fetchAllRuns(), stratDevStore.fetchGlossary()]);
});
</script>

<template>
  <div class="flex flex-row pt-1 me-1 relative" style="height: calc(100vh - 60px)">
    <!-- Sidebar -->
    <div
      class="flex md:flex-row h-full w-16 transition-all duration-200 shrink-0 me-1 border-r border-surface-200 dark:border-surface-900"
      :class="{ 'w-78!': showLeftBar }"
    >
      <div class="flex flex-col fixed">
        <Button
          class="self-start"
          aria-label="Toggle sidebar"
          size="small"
          severity="secondary"
          variant="outlined"
          @click="showLeftBar = !showLeftBar"
        >
          <i-mdi-chevron-right v-if="!showLeftBar" width="24" height="24" />
          <i-mdi-chevron-left v-if="showLeftBar" width="24" height="24" />
        </Button>
        <Transition name="fade">
          <StrategyDevSidebar v-if="showLeftBar" />
        </Transition>
      </div>
    </div>

    <!-- Main content -->
    <div class="flex flex-col w-full overflow-auto">
      <h2 class="ms-5 text-3xl font-bold">{{ t('strategyDev.title') }}</h2>

      <!-- Auth / connection error -->
      <StrategyDevAuthError v-if="stratDevStore.errorCode !== null" />

      <!-- Loading -->
      <div
        v-else-if="stratDevStore.loading && !stratDevStore.allRuns"
        class="flex flex-col items-center justify-center h-full text-surface-400"
      >
        <ProgressSpinner style="width: 50px; height: 50px" />
        <p class="mt-4">{{ t('strategyDev.loading') }}</p>
      </div>

      <!-- Detail view -->
      <StrategyDevDetail v-else-if="stratDevStore.selectedRun" />

      <!-- Empty state -->
      <div v-else class="flex flex-col items-center justify-center h-full text-surface-400">
        <i-mdi-flask-outline class="w-16 h-16 mb-4 opacity-30" />
        <p>{{ t('strategyDev.noRunSelected') }}</p>
      </div>
    </div>
  </div>
</template>

<style lang="css" scoped>
.fade-enter-active,
.fade-leave-active {
  transition: all 0.2s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
