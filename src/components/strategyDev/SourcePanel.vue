<script setup lang="ts">
import { RunType } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();
const botStore = useBotStore();

const run = computed(() => store.selectedRun);

const savedSource = computed<string | null>(() => {
  if (!run.value) return null;
  if (run.value.run_type === RunType.hyperopt && store.hyperoptDetail) {
    return (store.hyperoptDetail.strategy_source as string) ?? null;
  }
  if (run.value.run_type === RunType.wfa && store.wfaDetail) {
    return (store.wfaDetail.strategy_source as string) ?? null;
  }
  if (run.value.run_type === RunType.backtest && store.backtestSnapshot) {
    return store.backtestSnapshot.strategy_source ?? null;
  }
  return null;
});

const currentSource = ref<string | null>(null);
const loadingCurrent = ref(false);

const hasSnapshot = computed(() => savedSource.value !== null && savedSource.value !== '');
const displaySource = computed(() => savedSource.value || currentSource.value);

async function loadCurrentStrategy() {
  if (!run.value?.strategy || currentSource.value) return;
  loadingCurrent.value = true;
  try {
    const activeBot = botStore.activeBot;
    if (activeBot?.isBotOnline) {
      const resp = await activeBot.api.get(`/api/v1/strategy/${run.value.strategy}`);
      if (resp.data?.code) {
        currentSource.value = resp.data.code;
      }
    }
  } catch {
    // Strategy endpoint may not be available
  } finally {
    loadingCurrent.value = false;
  }
}

watch(
  () => [savedSource.value, run.value?.strategy],
  () => {
    if (!hasSnapshot.value && run.value?.strategy) {
      loadCurrentStrategy();
    }
  },
  { immediate: true },
);

const showDiff = ref(false);
const diffLoading = ref(false);

async function loadDiff() {
  if (!run.value) return;
  diffLoading.value = true;
  await store.fetchDiff(run.value.run_type, run.value.filename, 'strategy');
  showDiff.value = true;
  diffLoading.value = false;
}

const copied = ref(false);
async function copySource() {
  const src = displaySource.value;
  if (src) {
    await navigator.clipboard.writeText(src);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 py-3">
    <!-- Warning: no snapshot, showing current -->
    <div
      v-if="!hasSnapshot && displaySource"
      class="flex items-start gap-2 p-3 rounded-lg bg-amber-900/20 border border-amber-700/40"
    >
      <i-mdi-alert class="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
      <div class="text-sm">
        <p class="font-semibold text-amber-300">{{ t('strategyDev.noSnapshotWarningTitle') }}</p>
        <p class="text-amber-400/80 mt-0.5">{{ t('strategyDev.noSnapshotSourceDesc') }}</p>
      </div>
    </div>

    <div v-if="loadingCurrent" class="text-center text-surface-500 py-8">
      <i-mdi-loading class="w-5 h-5 animate-spin inline-block mr-2" />
      {{ t('strategyDev.loading') }}
    </div>

    <div v-else-if="displaySource">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-sm font-semibold">
          {{ hasSnapshot ? t('strategyDev.sourceSaved') : t('strategyDev.sourceCurrent') }}
        </h4>
        <div class="flex gap-2">
          <Button
            size="small"
            severity="secondary"
            variant="outlined"
            @click="copySource"
          >
            <template #icon>
              <i-mdi-check v-if="copied" class="w-3.5 h-3.5 text-green-400" />
              <i-mdi-content-copy v-else class="w-3.5 h-3.5" />
            </template>
            {{ copied ? t('strategyDev.copied') : t('strategyDev.copyAll') }}
          </Button>
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
      <CodeViewer :code="displaySource" language="python" />
    </div>

    <div v-else class="text-surface-400 text-sm py-4 text-center">
      {{ t('strategyDev.noSourceAvailable') }}
    </div>

    <!-- Diff view -->
    <div v-if="showDiff && store.diffResult" class="mt-4">
      <DiffViewer
        :saved="store.diffResult.snapshot"
        :current="store.diffResult.current"
        :has-changes="store.diffResult.has_changes"
        :saved-label="t('strategyDev.sourceSaved')"
        :current-label="t('strategyDev.sourceCurrent')"
      />
    </div>
  </div>
</template>
