<script setup lang="ts">
import { RunType } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();
const botStore = useBotStore();

const run = computed(() => store.selectedRun);

const savedConfig = computed<Record<string, unknown> | null>(() => {
  if (!run.value) return null;
  if (run.value.run_type === RunType.hyperopt && store.hyperoptDetail) {
    return (store.hyperoptDetail.config as Record<string, unknown>) ?? null;
  }
  if (run.value.run_type === RunType.wfa && store.wfaDetail) {
    return (store.wfaDetail.config as Record<string, unknown>) ?? null;
  }
  if (run.value.run_type === RunType.backtest && store.backtestSnapshot) {
    return store.backtestSnapshot.config ?? null;
  }
  return null;
});

const currentConfig = ref<Record<string, unknown> | null>(null);
const loadingCurrent = ref(false);

const hasSnapshot = computed(() => savedConfig.value !== null);
const displayConfig = computed(() => savedConfig.value || currentConfig.value);

const configJson = computed(() => {
  if (!displayConfig.value) return '';
  return JSON.stringify(displayConfig.value, null, 2);
});

async function loadCurrentConfig() {
  if (currentConfig.value) return;
  loadingCurrent.value = true;
  try {
    const activeBot = botStore.activeBot;
    if (activeBot?.isBotOnline) {
      const resp = await activeBot.api.get('/api/v1/show_config');
      if (resp.data) {
        currentConfig.value = resp.data as Record<string, unknown>;
      }
    }
  } catch {
    // show_config may not be available
  } finally {
    loadingCurrent.value = false;
  }
}

watch(
  () => [savedConfig.value, run.value],
  () => {
    if (!hasSnapshot.value && run.value) {
      loadCurrentConfig();
    }
  },
  { immediate: true },
);

const showDiff = ref(false);
const diffLoading = ref(false);

async function loadDiff() {
  if (!run.value) return;
  diffLoading.value = true;
  await store.fetchDiff(run.value.run_type, run.value.filename, 'config');
  showDiff.value = true;
  diffLoading.value = false;
}

const viewMode = ref<'tree' | 'raw'>('tree');
</script>

<template>
  <div class="flex flex-col gap-4 py-3" style="max-width: 1600px; margin: 0 auto">
    <!-- Warning: no snapshot, showing current -->
    <div
      v-if="!hasSnapshot && displayConfig"
      class="flex items-start gap-2 p-3 rounded-lg bg-amber-900/20 border border-amber-700/40"
    >
      <i-mdi-alert class="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
      <div class="text-sm">
        <p class="font-semibold text-amber-300">{{ t('strategyDev.noSnapshotWarningTitle') }}</p>
        <p class="text-amber-400/80 mt-0.5">{{ t('strategyDev.noSnapshotConfigDesc') }}</p>
      </div>
    </div>

    <div v-if="loadingCurrent" class="py-4">
      <SkeletonPanel variant="text" :rows="10" />
    </div>

    <div v-else-if="displayConfig">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-sm font-semibold">
          {{ hasSnapshot ? t('strategyDev.configSaved') : t('strategyDev.configCurrent') }}
        </h4>
        <div class="flex items-center gap-2">
          <SelectButton
            v-model="viewMode"
            :options="[
              { label: 'Tree', value: 'tree' },
              { label: 'Raw', value: 'raw' },
            ]"
            optionLabel="label"
            optionValue="value"
            :allowEmpty="false"
            class="text-xs"
          />
          <Button
            v-if="hasSnapshot"
            :label="t('strategyDev.showDiff')"
            severity="secondary"
            size="small"
            variant="outlined"
            :loading="diffLoading"
            @click="loadDiff"
          />
        </div>
      </div>

      <!-- Tree view -->
      <div v-if="viewMode === 'tree'" class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 max-h-[60vh] overflow-auto">
        <JsonViewer :data="displayConfig" />
      </div>

      <!-- Raw JSON view -->
      <div v-else>
        <CodeViewer :code="configJson" language="json" />
      </div>
    </div>

    <div v-else class="text-surface-400 text-sm py-4 text-center">
      {{ t('strategyDev.noConfigAvailable') }}
    </div>

    <!-- Diff view -->
    <div v-if="showDiff && store.diffResult" class="mt-4">
      <DiffViewer
        :saved="store.diffResult.snapshot"
        :current="store.diffResult.current"
        :has-changes="store.diffResult.has_changes"
        :saved-label="t('strategyDev.configSaved')"
        :current-label="t('strategyDev.configCurrent')"
      />
    </div>
  </div>
</template>
