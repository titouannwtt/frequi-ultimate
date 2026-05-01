<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();

const detail = computed(() => store.hyperoptDetail);

const metrics = computed(() => {
  const d = detail.value;
  const run = store.selectedRun;
  if (!d && !run) return [];
  const rm = (d?.best_epoch_metrics ?? {}) as Record<string, number>;
  const items: { label: string; value: string; severity?: string }[] = [];

  if (run?.best_loss != null)
    items.push({ label: t('strategyDev.bestLoss'), value: run.best_loss.toFixed(5) });
  if (rm.profit_total != null)
    items.push({
      label: t('strategyDev.totalProfit'),
      value: `${(rm.profit_total * 100).toFixed(2)}%`,
      severity: rm.profit_total > 0 ? 'success' : 'danger',
    });
  if (rm.total_trades != null)
    items.push({ label: t('strategyDev.totalTrades'), value: String(rm.total_trades) });
  if (rm.sharpe != null) items.push({ label: 'Sharpe', value: rm.sharpe.toFixed(3) });
  if (rm.max_drawdown_account != null)
    items.push({
      label: 'Max DD',
      value: `${(rm.max_drawdown_account * 100).toFixed(1)}%`,
      severity: rm.max_drawdown_account > 0.25 ? 'danger' : 'success',
    });
  if (rm.profit_factor != null)
    items.push({ label: 'Profit Factor', value: rm.profit_factor.toFixed(2) });
  if (rm.winrate != null) items.push({ label: 'Win Rate', value: `${(rm.winrate * 100).toFixed(1)}%` });
  if (rm.sqn != null) items.push({ label: 'SQN', value: rm.sqn.toFixed(2) });
  if (run?.epochs_completed != null && run?.epochs_total != null)
    items.push({
      label: t('strategyDev.epochsCompleted'),
      value: `${run.epochs_completed} / ${run.epochs_total}`,
    });

  return items;
});

const bestParams = computed(() => {
  const d = detail.value;
  if (!d) return null;
  return (d.best_params as Record<string, unknown>) ?? null;
});

const topEpochs = computed(() => {
  const a = store.hyperoptAnalysis;
  if (!a) return null;
  return (a.top_epochs as Record<string, unknown>[]) ?? null;
});

const healthBadges = computed(() => {
  const a = store.hyperoptAnalysis;
  if (!a) return [];
  const badges: { label: string; severity: string }[] = [];
  const dsr = a.dsr_analysis as { genuine?: boolean } | undefined;
  if (dsr) {
    badges.push({
      label: dsr.genuine ? 'DSR: Genuine' : 'DSR: Overfitted',
      severity: dsr.genuine ? 'success' : 'danger',
    });
  }
  const dof = a.dof_analysis as { label?: string; level?: string } | undefined;
  if (dof) {
    const sev = dof.level === 'green' ? 'success' : dof.level === 'yellow' ? 'warn' : 'danger';
    badges.push({ label: `DoF: ${dof.label}`, severity: sev });
  }
  const warnings = a.overfit_warnings as unknown[];
  if (Array.isArray(warnings)) {
    const high = warnings.filter((w: any) => w.severity === 'high').length;
    if (high > 0) badges.push({ label: `${high} high warnings`, severity: 'danger' });
    else if (warnings.length > 0) badges.push({ label: `${warnings.length} warnings`, severity: 'warn' });
    else badges.push({ label: 'No warnings', severity: 'success' });
  }
  return badges;
});
</script>

<template>
  <div class="flex flex-col gap-4 py-3">
    <!-- Metric cards -->
    <div v-if="metrics.length" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
      <div
        v-for="m in metrics"
        :key="m.label"
        class="flex flex-col p-3 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700"
      >
        <span class="text-xs text-surface-500 uppercase tracking-wide">{{ m.label }}</span>
        <span
          class="text-lg font-semibold mt-1"
          :class="{
            'text-green-500': m.severity === 'success',
            'text-red-500': m.severity === 'danger',
          }"
        >
          {{ m.value }}
        </span>
      </div>
    </div>

    <!-- Health badges -->
    <div v-if="healthBadges.length" class="flex flex-wrap gap-2">
      <Tag v-for="b in healthBadges" :key="b.label" :value="b.label" :severity="b.severity as any" class="text-xs" />
    </div>

    <!-- Loss function & hyperopt loss -->
    <div v-if="store.selectedRun?.hyperopt_loss" class="text-sm text-surface-500">
      <strong>Loss Function:</strong> {{ store.selectedRun.hyperopt_loss }}
    </div>

    <!-- Best Parameters -->
    <div v-if="bestParams">
      <h4 class="text-sm font-semibold mb-2">Best Parameters</h4>
      <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 max-h-64 overflow-auto">
        <JsonViewer :data="bestParams" />
      </div>
    </div>

    <!-- Top 10 Epochs Table -->
    <div v-if="topEpochs">
      <HyperoptTop10Table :epochs="topEpochs" />
    </div>

    <!-- Best epoch detailed metrics -->
    <div v-if="detail?.best_epoch_metrics">
      <h4 class="text-sm font-semibold mb-2">Best Epoch — All Metrics</h4>
      <div class="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 max-h-64 overflow-auto">
        <JsonViewer :data="detail.best_epoch_metrics as Record<string, unknown>" />
      </div>
    </div>
  </div>
</template>
