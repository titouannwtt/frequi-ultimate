<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { getVerdict, getVerdictText } from './metricThresholds';

const { t } = useI18n();
const store = useStrategyDevStore();

onMounted(async () => {
  if (!store.hyperoptAnalysis && store.selectedRun) {
    await store.fetchHyperoptAnalysis(store.selectedRun.filename);
  }
});

const detail = computed(() => store.hyperoptDetail);

interface MetricItem {
  label: string;
  value: string;
  rawValue?: number;
  metricKey?: string;
  severity?: string;
}

const metrics = computed<MetricItem[]>(() => {
  const d = detail.value;
  const run = store.selectedRun;
  if (!d && !run) return [];
  const rm = (d?.best_epoch_metrics ?? {}) as Record<string, number>;
  const items: MetricItem[] = [];

  if (run?.best_loss != null)
    items.push({
      label: t('strategyDev.bestLoss'),
      value: run.best_loss.toFixed(5),
      rawValue: run.best_loss,
      metricKey: 'best_loss',
    });
  if (rm.profit_total != null)
    items.push({
      label: t('strategyDev.totalProfit'),
      value: `${(rm.profit_total * 100).toFixed(2)}%`,
      rawValue: rm.profit_total,
      metricKey: 'profit_total',
    });
  if (rm.total_trades != null)
    items.push({
      label: t('strategyDev.totalTrades'),
      value: String(rm.total_trades),
      rawValue: rm.total_trades,
      metricKey: 'total_trades',
    });
  if (rm.sharpe != null)
    items.push({
      label: t('strategyDev.metricSharpe'),
      value: rm.sharpe.toFixed(3),
      rawValue: rm.sharpe,
      metricKey: 'sharpe',
    });
  if (rm.max_drawdown_account != null)
    items.push({
      label: t('strategyDev.metricMaxDD'),
      value: `${(rm.max_drawdown_account * 100).toFixed(1)}%`,
      rawValue: rm.max_drawdown_account,
      metricKey: 'max_drawdown_account',
    });
  if (rm.profit_factor != null)
    items.push({
      label: t('strategyDev.metricProfitFactor'),
      value: rm.profit_factor.toFixed(2),
      rawValue: rm.profit_factor,
      metricKey: 'profit_factor',
    });
  if (rm.winrate != null)
    items.push({
      label: t('strategyDev.metricWinRate'),
      value: `${(rm.winrate * 100).toFixed(1)}%`,
      rawValue: rm.winrate,
      metricKey: 'winrate',
    });
  if (rm.sqn != null)
    items.push({
      label: t('strategyDev.metricSQN'),
      value: rm.sqn.toFixed(2),
      rawValue: rm.sqn,
      metricKey: 'sqn',
    });
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
    else badges.push({ label: t('strategyDev.noWarnings'), severity: 'success' });
  }
  return badges;
});

const showAllMetrics = ref(false);

watch(() => store.selectedRun?.filename, () => {
  showAllMetrics.value = false;
});

const verdictColorMap: Record<string, string> = {
  good: 'var(--sd-success)',
  ok: 'var(--sd-info)',
  warn: 'var(--sd-warning)',
  bad: 'var(--sd-danger)',
  neutral: 'var(--sd-text)',
};
</script>

<template>
  <div class="hop sd-panel-enter">
    <!-- Executive Summary -->
    <RunSummaryCard />

    <!-- Metric cards with verdicts -->
    <div v-if="metrics.length" class="hop-metrics">
      <div
        v-for="(m, i) in metrics"
        :key="m.label"
        class="hop-metric-card sd-stagger-enter"
        :style="{ animationDelay: `${i * 40}ms` }"
      >
        <MetricPopover
          v-if="m.metricKey && m.rawValue != null"
          :metric-key="m.metricKey"
          :value="m.value"
          :verdict="getVerdict(m.metricKey, m.rawValue)"
          :verdict-text="getVerdictText(m.metricKey, m.rawValue)"
          position="bottom"
        >
          <div class="hop-metric-inner">
            <span class="hop-metric-label">{{ m.label }}</span>
            <span
              class="hop-metric-value"
              :style="{ color: m.metricKey && m.rawValue != null ? verdictColorMap[getVerdict(m.metricKey, m.rawValue)] : 'var(--sd-text)' }"
            >
              {{ m.value }}
            </span>
            <!-- Verdict dot -->
            <span
              v-if="m.metricKey && m.rawValue != null"
              class="hop-verdict-dot"
              :style="{ backgroundColor: verdictColorMap[getVerdict(m.metricKey, m.rawValue)] }"
            />
          </div>
        </MetricPopover>

        <!-- No popover for metrics without thresholds -->
        <div v-else class="hop-metric-inner">
          <span class="hop-metric-label">{{ m.label }}</span>
          <span class="hop-metric-value">{{ m.value }}</span>
        </div>
      </div>
    </div>

    <!-- Health badges -->
    <div v-if="healthBadges.length" class="hop-badges">
      <Tag v-for="b in healthBadges" :key="b.label" :value="b.label" :severity="b.severity as any" class="text-sm" />
    </div>

    <!-- Loss function -->
    <div v-if="store.selectedRun?.hyperopt_loss" class="hop-loss-fn">
      <span class="hop-loss-fn-label">{{ t('strategyDev.hoLossFunction') }}</span>
      {{ store.selectedRun.hyperopt_loss }}
    </div>

    <!-- Best Parameters -->
    <div v-if="bestParams" class="hop-section">
      <h4 class="hop-section-title">{{ t('strategyDev.hoBestParameters') }}</h4>
      <CodeViewer :code="JSON.stringify(bestParams, null, 2)" language="json" />
    </div>

    <!-- Top 10 Epochs Table -->
    <div v-if="topEpochs" class="hop-section">
      <HyperoptTop10Table :epochs="topEpochs" />
    </div>

    <!-- Best epoch detailed metrics (lazy) -->
    <div v-if="detail?.best_epoch_metrics" class="hop-section">
      <button
        v-if="!showAllMetrics"
        class="hop-lazy-btn"
        @click="showAllMetrics = true"
      >
        <i-mdi-code-json class="w-4 h-4" />
        {{ t('strategyDev.hoBestEpochMetrics') }}
        <i-mdi-chevron-right class="w-4 h-4" />
      </button>
      <template v-else>
        <h4 class="hop-section-title">{{ t('strategyDev.hoBestEpochMetrics') }}</h4>
        <CodeViewer :code="JSON.stringify(detail.best_epoch_metrics, null, 2)" language="json" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.hop {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 0;
  max-width: 1600px;
  margin: 0 auto;
}

/* ── Metric cards ── */
.hop-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
}

.hop-metric-card {
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-md);
  overflow: hidden;
}

.hop-metric-inner {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  position: relative;
}

.hop-metric-label {
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sd-overlay);
}

.hop-metric-value {
  font-size: var(--sd-text-lg);
  font-weight: 700;
  font-family: var(--sd-font-mono);
  margin-top: 2px;
}

.hop-verdict-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

/* ── Badges ── */
.hop-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* ── Loss function ── */
.hop-loss-fn {
  font-size: var(--sd-text-sm);
  color: var(--sd-subtext);
}

.hop-loss-fn-label {
  font-weight: 600;
  color: var(--sd-text);
  margin-right: 4px;
}

/* ── Sections ── */
.hop-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hop-section-title {
  font-size: var(--sd-text-sm);
  font-weight: 600;
  color: var(--sd-text);
  margin: 0;
}

.hop-lazy-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-md);
  color: var(--sd-subtext);
  font-size: var(--sd-text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--sd-transition-fast);
  width: 100%;
}
.hop-lazy-btn:hover {
  background: var(--sd-surface0);
  border-color: var(--sd-border);
  color: var(--sd-text);
}
</style>
