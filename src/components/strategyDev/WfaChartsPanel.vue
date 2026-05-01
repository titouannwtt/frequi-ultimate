<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();

const detail = computed(() => store.wfaDetail);

const windows = computed(() => {
  const d = detail.value;
  if (!d) return [];
  return (d.windows as Record<string, unknown>[]) ?? [];
});

const wfeData = computed(() =>
  windows.value.map((w, i) => ({
    index: i + 1,
    wfe: (w.wfe as number) ?? 0,
  })),
);

const degradationData = computed(() =>
  windows.value.map((w, i) => ({
    index: i + 1,
    train: ((w.train_profit as number) ?? (w.train_metrics as any)?.profit_pct ?? 0) * (
      (w.test_metrics as any)?.profit_pct != null ? 1 : 100
    ),
    test: ((w.test_profit as number) ?? (w.test_metrics as any)?.profit_pct ?? 0) * (
      (w.test_metrics as any)?.profit_pct != null ? 1 : 100
    ),
  })),
);

const hasWfeData = computed(() => wfeData.value.some(w => w.wfe !== 0));

const holdout = computed(() => {
  const d = detail.value;
  if (!d) return null;
  const h = d.holdout as Record<string, unknown> | undefined;
  return h && h.test_metrics ? h : null;
});

const paramStability = computed(() => {
  const d = detail.value;
  if (!d) return null;
  const ps = d.param_stability as Record<string, unknown> | undefined;
  return ps && Object.keys(ps).length > 0 ? ps : null;
});

const monteCarlo = computed(() => {
  const d = detail.value;
  if (!d) return null;
  const mc = d.monte_carlo as Record<string, unknown> | undefined;
  return mc && mc.n_simulations ? mc : null;
});

const regimeAnalysis = computed(() => {
  const d = detail.value;
  if (!d) return null;
  const ra = d.regime_analysis as Record<string, unknown> | undefined;
  return ra && ra.regime_stats ? ra : null;
});

const perturbation = computed(() => {
  const d = detail.value;
  if (!d) return null;
  const p = d.perturbation as Record<string, unknown> | undefined;
  return p && p.n_perturbations ? p : null;
});

const cpcv = computed(() => {
  const d = detail.value;
  if (!d) return null;
  const c = d.cpcv as Record<string, unknown> | undefined;
  return c && c.n_combinations ? c : null;
});

const oosEquity = computed(() => {
  const d = detail.value;
  if (!d) return null;
  const e = d.oos_equity as Record<string, unknown> | undefined;
  return e && e.n_trades ? e : null;
});

const warnings = computed(() => {
  const d = detail.value;
  if (!d) return null;
  const w = d.warnings as unknown[];
  return Array.isArray(w) && w.length > 0 ? w : null;
});

const marketContextWindows = computed(() => {
  return windows.value
    .filter(w => (w.market_context as any)?.btc_change_pct != null)
    .map((w, i) => ({
      index: (w.index as number) ?? i + 1,
      market_context: w.market_context as any,
    }));
});

const degradationWindows = computed(() => {
  return windows.value
    .filter(w => w.degradation)
    .map((w, i) => ({
      index: (w.index as number) ?? i + 1,
      train_range: (w.train_range as string) ?? '',
      test_range: (w.test_range as string) ?? '',
      degradation: w.degradation as Record<string, number>,
      train_metrics: w.train_metrics as Record<string, number>,
      test_metrics: w.test_metrics as Record<string, number>,
    }));
});
</script>

<template>
  <div v-if="!detail" class="text-center text-surface-500 py-8">
    {{ t('strategyDev.wfaNoData') }}
  </div>
  <div v-else class="wfa-page">
    <!-- ═══ SECTION 1: WARNINGS ═══ -->
    <div v-if="warnings" class="section">
      <div class="section-header">
        <span class="section-num">1</span>
        <h3>{{ t('strategyDev.sectionWarnings') }}</h3>
      </div>
      <OverfitWarningsPanel :warnings="warnings as any" />
    </div>

    <!-- ═══ SECTION 2: OOS SUMMARY ═══ -->
    <div class="section">
      <div class="section-header">
        <span class="section-num">{{ warnings ? '2' : '1' }}</span>
        <h3>{{ t('strategyDev.sectionHealthChecks') }}</h3>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <WfaOosEquityCard v-if="oosEquity" :data="oosEquity as any" />
        <WfaPerturbationCard v-if="perturbation" :data="perturbation as any" />
        <WfaHoldoutCard v-if="holdout" :data="holdout as any" />
      </div>
    </div>

    <!-- ═══ SECTION 3: WINDOW PERFORMANCE ═══ -->
    <div class="section">
      <div class="section-header">
        <span class="section-num">{{ warnings ? '3' : '2' }}</span>
        <h3>{{ t('strategyDev.sectionWindowPerformance') }}</h3>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartWrapper v-if="hasWfeData" :title="t('strategyDev.wfaWfeTitle')" :hint="t('strategyDev.hintWfe')" chart-id="wfe">
          <WfeBarChart :data="wfeData" :title="t('strategyDev.wfaWfeTitle')" />
          <template #fullscreen>
            <WfeBarChart :data="wfeData" :title="t('strategyDev.wfaWfeTitle')" />
          </template>
        </ChartWrapper>
        <ChartWrapper :title="t('strategyDev.wfaTrainVsTestTitle')" :hint="t('strategyDev.hintTrainVsTest')" chart-id="degradation">
          <DegradationChart :data="degradationData" :title="t('strategyDev.wfaTrainVsTestTitle')" />
          <template #fullscreen>
            <DegradationChart :data="degradationData" :title="t('strategyDev.wfaTrainVsTestTitle')" />
          </template>
        </ChartWrapper>
      </div>
      <div v-if="degradationWindows.length || marketContextWindows.length" class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <WfaDegradationTable v-if="degradationWindows.length" :windows="degradationWindows" />
        <ChartWrapper v-if="marketContextWindows.length" :title="t('strategyDev.wfaMarketContextTitle')" :hint="t('strategyDev.hintMarketContext')" chart-id="market-context">
          <WfaMarketContextChart :windows="marketContextWindows" :title="t('strategyDev.wfaMarketContextTitle')" />
          <template #fullscreen>
            <WfaMarketContextChart :windows="marketContextWindows" :title="t('strategyDev.wfaMarketContextTitle')" />
          </template>
        </ChartWrapper>
      </div>
    </div>

    <!-- ═══ SECTION 4: ROBUSTNESS ═══ -->
    <div v-if="monteCarlo || cpcv || regimeAnalysis" class="section">
      <div class="section-header">
        <span class="section-num">{{ warnings ? '4' : '3' }}</span>
        <h3>{{ t('strategyDev.sectionRobustnessAnalysis') }}</h3>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <WfaMonteCarloCard v-if="monteCarlo" :data="monteCarlo as any" />
        <WfaRegimeCard v-if="regimeAnalysis" :data="regimeAnalysis as any" />
      </div>
      <WfaCpcvCard v-if="cpcv" :data="cpcv as any" class="mt-4" />
    </div>

    <!-- ═══ SECTION 5: PARAMETER STABILITY ═══ -->
    <div v-if="paramStability" class="section">
      <div class="section-header">
        <span class="section-num">{{ warnings ? '5' : '4' }}</span>
        <h3>{{ t('strategyDev.sectionParameterAnalysis') }}</h3>
      </div>
      <WfaParamStabilityTable :data="paramStability as any" />
    </div>
  </div>
</template>

<style scoped>
.wfa-page {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0.75rem 0;
  max-width: 1600px;
  margin: 0 auto;
}

.section {
  padding: 1.25rem 0;
}
.section + .section {
  border-top: 1px solid rgba(137, 180, 250, 0.08);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-bottom: 1rem;
}

.section-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 50%;
  background: rgba(137, 180, 250, 0.12);
  color: #89b4fa;
  font-size: var(--sd-text-xs);
  font-weight: 700;
  flex-shrink: 0;
}

.section-header h3 {
  font-size: var(--sd-text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #89b4fa;
  margin: 0;
}
</style>
