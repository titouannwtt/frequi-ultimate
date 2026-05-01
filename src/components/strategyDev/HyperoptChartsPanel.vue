<script setup lang="ts">
const store = useStrategyDevStore();
const analysisLoading = ref(false);

onMounted(async () => {
  if (!store.hyperoptAnalysis && store.selectedRun) {
    analysisLoading.value = true;
    await store.fetchHyperoptAnalysis(store.selectedRun.filename);
    analysisLoading.value = false;
  }
});

const analysis = computed(() => store.hyperoptAnalysis);

const overfitWarnings = computed(() => {
  const w = analysis.value?.overfit_warnings;
  return Array.isArray(w) && w.length > 0 ? w : null;
});

const dsrAnalysis = computed(() => {
  const d = analysis.value?.dsr_analysis;
  return d && typeof d === 'object' ? d : null;
});

const dofAnalysis = computed(() => {
  const d = analysis.value?.dof_analysis;
  return d && typeof d === 'object' ? d : null;
});

const benchmarkComparison = computed(() => {
  const d = analysis.value?.benchmark_comparison;
  return d && typeof d === 'object' ? d : null;
});

const monteCarlo = computed(() => {
  const d = analysis.value?.monte_carlo;
  return d && typeof d === 'object' ? d : null;
});

const distributionAnalysis = computed(() => {
  const d = analysis.value?.distribution_analysis;
  return d && typeof d === 'object' ? d : null;
});

const sansTopTrade = computed(() => {
  const d = analysis.value?.sans_top_trade;
  return d && typeof d === 'object' ? d : null;
});

const regimeAnalysis = computed(() => {
  const d = analysis.value?.regime_analysis;
  return d && typeof d === 'object' ? d : null;
});

const paramCorrelation = computed(() => {
  const d = analysis.value?.param_correlation;
  return Array.isArray(d) && d.length > 0 ? d : null;
});

const parallelCoords = computed(() => {
  const d = analysis.value?.parallel_coords;
  if (!d || typeof d !== 'object') return null;
  const pc = d as { params: string[]; lines: unknown[] };
  return pc.params?.length > 0 && pc.lines?.length > 0 ? pc : null;
});

const sensitivityGrid = computed(() => {
  const d = analysis.value?.sensitivity_grid;
  return Array.isArray(d) && d.length > 0 ? d : null;
});

const dispersionBands = computed(() => {
  const d = analysis.value?.dispersion_bands;
  return d && typeof d === 'object' && Object.keys(d).length > 0 ? d : null;
});
</script>

<template>
  <div class="flex flex-col gap-6 py-3">
    <div v-if="analysisLoading" class="flex justify-center py-8">
      <ProgressSpinner style="width: 40px; height: 40px" />
    </div>

    <template v-else-if="analysis">
      <!-- Section 1: Warnings & Health -->
      <div v-if="overfitWarnings">
        <h3 class="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-3">
          Overfit Warnings
        </h3>
        <OverfitWarningsPanel :warnings="overfitWarnings" />
      </div>

      <!-- Section 2: Key Metrics Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <DsrAnalysisCard v-if="dsrAnalysis" :data="dsrAnalysis as any" />
        <DofAnalysisCard v-if="dofAnalysis" :data="dofAnalysis as any" />
        <BenchmarkCard v-if="benchmarkComparison" :data="benchmarkComparison as any" />
      </div>

      <!-- Section 3: Profit Robustness -->
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <DistributionAnalysisCard v-if="distributionAnalysis" :data="distributionAnalysis as any" />
        <SansTopTradeCard v-if="sansTopTrade" :data="sansTopTrade as any" />
        <RegimeAnalysisCard v-if="regimeAnalysis" :data="regimeAnalysis as any" />
      </div>

      <!-- Section 4: Monte Carlo -->
      <MonteCarloChart
        v-if="monteCarlo"
        :data="monteCarlo as any"
        title="Monte Carlo Simulation"
      />

      <!-- Section 5: Dispersion Bands -->
      <DispersionBandsCard v-if="dispersionBands" :data="dispersionBands as any" />

      <!-- Section 6: Charts -->
      <h3 class="text-sm font-semibold text-surface-400 uppercase tracking-wider">
        Convergence & Distribution
      </h3>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ConvergenceChart
          v-if="analysis.convergence"
          :data="analysis.convergence as number[]"
          title="Loss Convergence"
        />
        <LossHistogramChart
          v-if="analysis.loss_histogram"
          :histogram="analysis.loss_histogram as Record<string, unknown>"
          title="Loss Distribution"
        />
        <ReturnVsDdScatter
          v-if="analysis.return_vs_dd"
          :data="analysis.return_vs_dd as Record<string, unknown>[]"
          title="Return vs Drawdown"
        />
        <PairProfitBarChart
          v-if="
            analysis.pair_profit_distribution &&
            (analysis.pair_profit_distribution as unknown[]).length
          "
          :data="analysis.pair_profit_distribution as Record<string, unknown>[]"
          title="Pair Profit Distribution"
        />
      </div>

      <!-- Section 7: Parameter Analysis -->
      <h3 class="text-sm font-semibold text-surface-400 uppercase tracking-wider">
        Parameter Analysis
      </h3>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ParallelCoordsChart
          v-if="parallelCoords"
          :data="parallelCoords as any"
          title="Parallel Coordinates (Top 10)"
        />
        <ParamCorrelationHeatmap
          v-if="paramCorrelation"
          :correlations="paramCorrelation as any"
          title="Parameter Correlation"
        />
      </div>

      <!-- Section 8: Sensitivity -->
      <SensitivityGridChart
        v-if="sensitivityGrid"
        :grids="sensitivityGrid as any"
        title="Parameter Sensitivity"
      />
    </template>

    <div v-else class="text-surface-400 text-sm text-center py-8">
      No analysis data available. The .fthypt file may not exist.
    </div>
  </div>
</template>
