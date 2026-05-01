<script setup lang="ts">
import { RunType } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();

const run = computed(() => store.selectedRun);

const metrics = computed(() => {
  if (!run.value) return [];
  const items: { label: string; value: string | number }[] = [];

  if (run.value.total_profit_pct != null)
    items.push({
      label: t('strategyDev.totalProfit'),
      value: `${run.value.total_profit_pct.toFixed(2)}%`,
    });
  if (run.value.total_trades != null)
    items.push({ label: t('strategyDev.totalTrades'), value: run.value.total_trades });
  if (run.value.best_sharpe != null)
    items.push({ label: t('strategyDev.bestSharpe'), value: run.value.best_sharpe.toFixed(3) });
  if (run.value.best_loss != null)
    items.push({ label: t('strategyDev.bestLoss'), value: run.value.best_loss.toFixed(5) });
  if (run.value.epochs_completed != null && run.value.epochs_total != null)
    items.push({
      label: t('strategyDev.epochsCompleted'),
      value: `${run.value.epochs_completed} / ${run.value.epochs_total}`,
    });
  if (run.value.verdict_grade)
    items.push({ label: t('strategyDev.verdictGrade'), value: run.value.verdict_grade });
  if (run.value.n_windows != null)
    items.push({ label: t('strategyDev.nWindows'), value: run.value.n_windows });

  return items;
});

const detail = computed(() => {
  if (!run.value) return null;
  if (run.value.run_type === RunType.hyperopt) return store.hyperoptDetail;
  if (run.value.run_type === RunType.wfa) return store.wfaDetail;
  return null;
});

const bestParams = computed(() => {
  const d = detail.value;
  if (!d) return null;
  return (
    (d.best_params as Record<string, unknown>) || (d.consensus as Record<string, unknown>) || null
  );
});
</script>

<template>
  <div class="flex flex-col gap-4 py-3">
    <!-- Summary metrics -->
    <div v-if="metrics.length" class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div
        v-for="m in metrics"
        :key="m.label"
        class="flex flex-col p-3 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700"
      >
        <span class="text-xs text-surface-500 uppercase tracking-wide">{{ m.label }}</span>
        <span class="text-lg font-semibold mt-1">{{ m.value }}</span>
      </div>
    </div>

    <!-- Hyperopt loss function -->
    <div v-if="run?.hyperopt_loss" class="text-sm text-surface-500">
      <strong>Loss Function:</strong> {{ run.hyperopt_loss }}
    </div>

    <!-- Best parameters preview -->
    <div v-if="bestParams">
      <h4 class="text-sm font-semibold mb-2">Best Parameters</h4>
      <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 max-h-64 overflow-auto">
        <JsonViewer :data="bestParams" />
      </div>
    </div>

    <!-- WFA full detail as raw JSON (temporary, will be replaced by richer components later) -->
    <div v-if="run?.run_type === RunType.wfa && detail">
      <h4 class="text-sm font-semibold mb-2">WFA Detail</h4>
      <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 max-h-96 overflow-auto">
        <JsonViewer :data="detail" />
      </div>
    </div>

    <!-- Hyperopt best epoch metrics -->
    <div
      v-if="
        run?.run_type === RunType.hyperopt &&
        detail &&
        (detail as Record<string, unknown>).best_epoch_metrics
      "
    >
      <h4 class="text-sm font-semibold mb-2">Best Epoch Metrics</h4>
      <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 max-h-64 overflow-auto">
        <JsonViewer
          :data="(detail as Record<string, unknown>).best_epoch_metrics as Record<string, unknown>"
        />
      </div>
    </div>
  </div>
</template>
