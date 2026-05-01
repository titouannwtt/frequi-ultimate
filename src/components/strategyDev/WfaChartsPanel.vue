<script setup lang="ts">
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
      (w.train_metrics as any)?.profit_pct != null ? 1 : 100
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
    No WFA data available.
  </div>
  <div v-else class="flex flex-col gap-6 py-3">
    <!-- Section 1: Warnings -->
    <div v-if="warnings">
      <h3 class="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-3">
        Warnings
      </h3>
      <OverfitWarningsPanel :warnings="warnings as any" />
    </div>

    <!-- Section 2: OOS Summary Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <WfaOosEquityCard v-if="oosEquity" :data="oosEquity as any" />
      <WfaPerturbationCard v-if="perturbation" :data="perturbation as any" />
      <WfaHoldoutCard v-if="holdout" :data="holdout as any" />
    </div>

    <!-- Section 3: Window Performance Charts -->
    <h3 class="text-sm font-semibold text-surface-400 uppercase tracking-wider">
      Window Performance
    </h3>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <WfeBarChart v-if="hasWfeData" :data="wfeData" title="Walk-Forward Efficiency" />
      <DegradationChart :data="degradationData" title="Train vs Test Profit" />
    </div>

    <!-- Section 4: Degradation detail + Market Context -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <WfaDegradationTable v-if="degradationWindows.length" :windows="degradationWindows" />
      <WfaMarketContextChart
        v-if="marketContextWindows.length"
        :windows="marketContextWindows"
        title="Market Context per Window"
      />
    </div>

    <!-- Section 5: Robustness -->
    <template v-if="monteCarlo || cpcv || regimeAnalysis">
      <h3 class="text-sm font-semibold text-surface-400 uppercase tracking-wider">
        Robustness Analysis
      </h3>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WfaMonteCarloCard v-if="monteCarlo" :data="monteCarlo as any" />
        <WfaRegimeCard v-if="regimeAnalysis" :data="regimeAnalysis as any" />
      </div>
      <WfaCpcvCard v-if="cpcv" :data="cpcv as any" />
    </template>

    <!-- Section 6: Parameter Stability -->
    <template v-if="paramStability">
      <h3 class="text-sm font-semibold text-surface-400 uppercase tracking-wider">
        Parameter Analysis
      </h3>
      <WfaParamStabilityTable :data="paramStability as any" />
    </template>
  </div>
</template>
