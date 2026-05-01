<script setup lang="ts">
import { RunType } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();

const run = computed(() => store.selectedRun);
const copied = ref(false);

const savedCommand = computed<string | null>(() => {
  if (!run.value) return null;
  if (run.value.run_type === RunType.hyperopt && store.hyperoptDetail) {
    return (store.hyperoptDetail.command as string) ?? null;
  }
  if (run.value.run_type === RunType.wfa && store.wfaDetail) {
    return (store.wfaDetail.command as string) ?? null;
  }
  return null;
});

const inferredCommand = computed<string | null>(() => {
  if (savedCommand.value) return null;
  if (!run.value) return null;

  if (run.value.run_type === RunType.hyperopt) {
    const d = store.hyperoptDetail;
    if (!d) return null;
    const parts = ['freqtrade hyperopt'];
    if (d.strategy) parts.push(`--strategy ${d.strategy}`);
    if (d.timeframe) parts.push(`--timeframe ${d.timeframe}`);
    if (d.timerange) parts.push(`--timerange ${d.timerange}`);
    if (d.hyperopt_loss) parts.push(`--hyperopt-loss ${d.hyperopt_loss}`);
    if (d.epochs_total) parts.push(`--epochs ${d.epochs_total}`);
    const spaces = d.spaces as string[] | undefined;
    if (spaces?.length) parts.push(`--spaces ${spaces.join(' ')}`);
    return parts.join(' \\\n  ');
  }

  if (run.value.run_type === RunType.wfa) {
    const d = store.wfaDetail;
    if (!d) return null;
    const parts = ['freqtrade walk-forward'];
    if (d.strategy) parts.push(`--strategy ${d.strategy}`);
    if (d.timeframe) parts.push(`--timeframe ${d.timeframe}`);
    if (d.timerange) parts.push(`--timerange ${d.timerange}`);
    if (d.hyperopt_loss) parts.push(`--hyperopt-loss ${d.hyperopt_loss}`);
    if (d.n_windows) parts.push(`--wf-windows ${d.n_windows}`);
    if (d.epochs_per_window) parts.push(`--epochs ${d.epochs_per_window}`);
    return parts.join(' \\\n  ');
  }

  return null;
});

const hasSnapshot = computed(() => savedCommand.value !== null);
const displayCommand = computed(() => savedCommand.value || inferredCommand.value);

async function copyCommand() {
  if (displayCommand.value) {
    await navigator.clipboard.writeText(displayCommand.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 py-3">
    <!-- Warning: no snapshot, showing inferred -->
    <div
      v-if="!hasSnapshot && displayCommand"
      class="flex items-start gap-2 p-3 rounded-lg bg-amber-900/20 border border-amber-700/40"
    >
      <i-mdi-alert class="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
      <div class="text-sm">
        <p class="font-semibold text-amber-300">{{ t('strategyDev.noSnapshotWarningTitle') }}</p>
        <p class="text-amber-400/80 mt-0.5">{{ t('strategyDev.noSnapshotCommandDesc') }}</p>
      </div>
    </div>

    <div v-if="displayCommand">
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-sm font-semibold">
          {{ hasSnapshot ? t('strategyDev.commandSaved') : t('strategyDev.commandInferred') }}
        </h4>
        <Button
          size="small"
          :severity="copied ? 'success' : 'secondary'"
          variant="outlined"
          @click="copyCommand"
        >
          <template #icon>
            <i-mdi-check v-if="copied" class="w-3.5 h-3.5" />
            <i-mdi-content-copy v-else class="w-3.5 h-3.5" />
          </template>
          {{ copied ? t('strategyDev.copied') : t('strategyDev.copyCommand') }}
        </Button>
      </div>
      <div class="command-block">
        <span class="command-prompt">$</span>
        <pre class="command-text">{{ displayCommand }}</pre>
      </div>
    </div>

    <div v-else class="text-surface-400 text-sm py-4 text-center">
      {{ t('strategyDev.noCommandAvailable') }}
    </div>
  </div>
</template>

<style scoped>
.command-block {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-radius: 0.5rem;
  border: 1px solid var(--p-surface-700);
  background: #1e1e2e;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.8rem;
  line-height: 1.5;
}

.command-prompt {
  color: #a6e3a1;
  font-weight: 700;
  user-select: none;
  flex-shrink: 0;
}

.command-text {
  color: #cdd6f4;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
</style>
