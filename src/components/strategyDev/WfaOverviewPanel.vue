<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();

const detail = computed(() => store.wfaDetail);

const verdict = computed(() => {
  const d = detail.value;
  if (!d) return null;
  return (d.verdict as Record<string, unknown>) ?? null;
});

const windows = computed(() => {
  const d = detail.value;
  if (!d) return [];
  return (d.windows as Record<string, unknown>[]) ?? [];
});

const metrics = computed(() => {
  const d = detail.value;
  const run = store.selectedRun;
  if (!d && !run) return [];
  const items: { label: string; value: string; severity?: string }[] = [];

  if (run?.verdict_grade) {
    items.push({
      label: t('strategyDev.verdictGrade'),
      value: run.verdict_grade,
      severity: run.verdict_grade <= 'B' ? 'success' : run.verdict_grade >= 'D' ? 'danger' : undefined,
    });
  }
  if (run?.n_windows != null) items.push({ label: t('strategyDev.nWindows'), value: String(run.n_windows) });
  if (run?.hyperopt_loss) items.push({ label: t('strategyDev.hoLossFunction'), value: run.hyperopt_loss });

  const dsr = d?.deflated_sharpe_ratio as number | undefined;
  if (dsr != null) {
    items.push({
      label: 'DSR',
      value: dsr.toFixed(3),
      severity: dsr >= 1.0 ? 'success' : 'danger',
    });
  }

  const oos = d?.oos_aggregate as Record<string, number> | undefined;
  if (oos) {
    if (oos.total_trades != null) items.push({ label: 'OOS Trades', value: String(oos.total_trades) });
    if (oos.sqn != null) items.push({ label: 'OOS SQN', value: oos.sqn.toFixed(2) });
    if (oos.expectancy != null) items.push({ label: 'OOS Expectancy', value: oos.expectancy.toFixed(4) });
    if (oos.profit_total != null) {
      items.push({
        label: 'OOS Profit',
        value: `${(oos.profit_total * 100).toFixed(2)}%`,
        severity: oos.profit_total > 0 ? 'success' : 'danger',
      });
    }
  }

  const oosEquity = d?.oos_equity as Record<string, number> | undefined;
  if (oosEquity) {
    if (oosEquity.k_ratio != null) items.push({
      label: 'K-Ratio',
      value: oosEquity.k_ratio.toFixed(3),
      severity: oosEquity.k_ratio >= 0 ? 'success' : 'danger',
    });
  }

  const mc = d?.monte_carlo as Record<string, number> | undefined;
  if (mc) {
    if (mc.carver_discount != null) items.push({
      label: 'Carver Discount',
      value: `${(mc.carver_discount * 100).toFixed(0)}%`,
      severity: mc.carver_discount >= 0.5 ? 'success' : 'danger',
    });
  }

  return items;
});

const healthBadges = computed(() => {
  const d = detail.value;
  if (!d) return [];
  const badges: { label: string; severity: string }[] = [];

  const dsr = d.deflated_sharpe_ratio as number | undefined;
  if (dsr != null) {
    badges.push({
      label: dsr >= 1.0 ? 'DSR: Genuine' : 'DSR: Weak',
      severity: dsr >= 1.0 ? 'success' : 'danger',
    });
  }

  const ps = d.param_stability as Record<string, any> | undefined;
  if (ps) {
    const total = Object.keys(ps).length;
    const stable = Object.values(ps).filter(s => s.stable).length;
    const pct = total > 0 ? Math.round(stable / total * 100) : 0;
    badges.push({
      label: `Params: ${stable}/${total} stable (${pct}%)`,
      severity: pct >= 70 ? 'success' : pct >= 40 ? 'warn' : 'danger',
    });
  }

  const warns = d.warnings as unknown[];
  if (Array.isArray(warns) && warns.length > 0) {
    badges.push({ label: `${warns.length} warnings`, severity: 'warn' });
  }

  const cpcv = d.cpcv as Record<string, number> | undefined;
  if (cpcv && cpcv.prob_of_loss != null) {
    badges.push({
      label: `CPCV P(loss): ${(cpcv.prob_of_loss * 100).toFixed(0)}%`,
      severity: cpcv.prob_of_loss < 0.5 ? 'success' : 'danger',
    });
  }

  return badges;
});
</script>

<template>
  <div class="flex flex-col gap-4 py-3" style="max-width: 1600px; margin: 0 auto">
    <!-- Verdict Badge -->
    <div v-if="verdict" class="flex items-center gap-4">
      <div
        class="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold"
        :class="{
          'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300':
            (verdict.grade as string) <= 'B',
          'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300':
            (verdict.grade as string) === 'C',
          'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300':
            (verdict.grade as string) >= 'D',
        }"
      >
        {{ verdict.grade }}
      </div>
      <div>
        <p class="font-semibold text-lg">{{ t('strategyDev.wfaVerdict') }}</p>
        <p v-if="verdict.summary" class="text-sm text-surface-500">{{ verdict.summary }}</p>
      </div>
    </div>

    <!-- Health badges -->
    <div v-if="healthBadges.length" class="flex flex-wrap gap-2">
      <Tag v-for="b in healthBadges" :key="b.label" :value="b.label" :severity="b.severity as any" class="text-sm" />
    </div>

    <!-- Metric cards -->
    <div v-if="metrics.length" class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div
        v-for="m in metrics"
        :key="m.label"
        class="flex flex-col p-3 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700"
      >
        <span class="text-sm text-surface-500 uppercase tracking-wide">{{ m.label }}</span>
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

    <!-- Verdict checks -->
    <div v-if="verdict?.checks" class="mt-2">
      <h4 class="text-sm font-semibold mb-2">{{ t('strategyDev.wfaVerdictChecks') }}</h4>
      <div class="flex flex-col gap-1">
        <div
          v-for="(check, idx) in (verdict.checks as Record<string, unknown>[])"
          :key="idx"
          class="flex items-center gap-2 text-sm"
        >
          <i-mdi-check-circle
            v-if="check.pass"
            class="w-4 h-4 text-green-500 shrink-0"
          />
          <i-mdi-close-circle v-else class="w-4 h-4 text-red-500 shrink-0" />
          <span class="text-surface-200">{{ check.label || check.name }}</span>
        </div>
      </div>
    </div>

    <!-- Windows Table -->
    <WfaWindowTable v-if="windows.length" :windows="windows" />
  </div>
</template>
