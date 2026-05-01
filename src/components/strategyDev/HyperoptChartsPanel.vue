<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
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

const paramDeepDive = computed(() => {
  const d = analysis.value?.param_deep_dive;
  return d && typeof d === 'object' && Object.keys(d).length > 0 ? d as Record<string, Record<string, unknown>> : null;
});

const paramStats = computed(() => {
  if (!store.hyperoptAnalysis) return null;
  const a = store.hyperoptAnalysis as Record<string, unknown>;
  const ps = a.param_stats;
  return ps && typeof ps === 'object' && Object.keys(ps as object).length > 0 ? ps as Record<string, Record<string, unknown>> : null;
});

const paramStabilityData = computed(() => {
  const d = analysis.value?.param_stability;
  return d && typeof d === 'object' ? d as Record<string, Record<string, unknown>> : undefined;
});

const sensitivityGrid = computed(() => {
  const d = analysis.value?.sensitivity_grid;
  return Array.isArray(d) && d.length > 0 ? d : null;
});

const dispersionBands = computed(() => {
  const d = analysis.value?.dispersion_bands;
  return d && typeof d === 'object' && Object.keys(d).length > 0 ? d : null;
});

const bestVsMedian = computed(() => {
  const d = analysis.value?.best_vs_median_gap;
  return d && typeof d === 'object' ? d : null;
});

const pairProfitData = computed(() => {
  const d = analysis.value?.pair_profit_distribution;
  return Array.isArray(d) && d.length > 0 ? d : null;
});

const noNegativeTrades = computed(() => {
  const d = store.hyperoptDetail;
  if (!d) return false;
  const rm = (d.best_epoch_metrics ?? {}) as Record<string, number>;
  if (rm.losses != null && rm.losses === 0) return true;
  if (rm.winrate != null && rm.winrate >= 1.0) return true;
  if (rm.win_rate != null && (rm.win_rate as number) >= 100) return true;
  if (rm.total_trades != null && rm.total_trades > 0) {
    if (rm.losing_trades != null && rm.losing_trades === 0) return true;
  }
  return false;
});

const paramTabIndex = ref(0);
</script>

<template>
  <div class="charts-page">
    <div v-if="analysisLoading" class="py-6">
      <SkeletonPanel variant="cards" :cols="4" />
      <SkeletonPanel variant="chart" class="mt-4" />
      <SkeletonPanel variant="chart" class="mt-4" />
    </div>

    <template v-else-if="analysis">
      <!-- ═══ CRITICAL ALERT ═══ -->
      <div
        v-if="noNegativeTrades"
        class="alert-critical"
      >
        <div class="alert-critical-icon">
          <i-mdi-alert-octagon class="w-5 h-5" />
        </div>
        <div class="flex-1">
          <p class="font-bold text-sm">{{ t('strategyDev.noLosingTradesTitle') }}</p>
          <p class="text-xs opacity-80 mt-1 leading-relaxed">{{ t('strategyDev.noLosingTradesDesc') }}</p>
          <div class="alert-actions">
            <span v-for="i in 4" :key="i" class="alert-action">
              <i-mdi-arrow-right class="w-3 h-3 shrink-0" />
              {{ t(`strategyDev.noLosingTradesAction${i}`) }}
            </span>
          </div>
        </div>
      </div>

      <!-- ═══ SECTION 1: OVERFIT WARNINGS ═══ -->
      <div v-if="overfitWarnings" class="section">
        <div class="section-header">
          <span class="section-num">1</span>
          <h3>{{ t('strategyDev.sectionOverfitWarnings') }}</h3>
        </div>
        <OverfitWarningsPanel :warnings="overfitWarnings" />
      </div>

      <!-- ═══ SECTION 2: HEALTH CHECKS ═══ -->
      <div class="section">
        <div class="section-header">
          <span class="section-num">{{ overfitWarnings ? '2' : '1' }}</span>
          <h3>{{ t('strategyDev.sectionHealthChecks') }}</h3>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <DsrAnalysisCard v-if="dsrAnalysis" :data="dsrAnalysis as any" class="card-eq" />
          <DofAnalysisCard v-if="dofAnalysis" :data="dofAnalysis as any" class="card-eq" />
          <BenchmarkCard v-if="benchmarkComparison" :data="benchmarkComparison as any" class="card-eq" />
          <DistributionAnalysisCard v-if="distributionAnalysis" :data="distributionAnalysis as any" class="card-eq" />
        </div>
      </div>

      <!-- ═══ SECTION 3: PROFIT ROBUSTNESS ═══ -->
      <div class="section">
        <div class="section-header">
          <span class="section-num">{{ overfitWarnings ? '3' : '2' }}</span>
          <h3>{{ t('strategyDev.sectionProfitRobustness') }}</h3>
        </div>

        <!-- 2-col layout on large screens: Monte Carlo left, robustness cards right -->
        <div class="two-col-layout">
          <div class="two-col-main">
            <ChartWrapper v-if="monteCarlo" :title="t('strategyDev.chartMonteCarloTitle')" :hint="t('strategyDev.hintMonteCarlo')" chart-id="monte-carlo">
              <MonteCarloChart
                :data="monteCarlo as any"
                :title="t('strategyDev.chartMonteCarloTitle')"
              />
              <template #fullscreen>
                <MonteCarloChart
                  :data="monteCarlo as any"
                  :title="t('strategyDev.chartMonteCarloTitle')"
                />
              </template>
            </ChartWrapper>
          </div>
          <div class="two-col-side">
            <div class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-1 gap-3">
              <BestVsMedianCard v-if="bestVsMedian" :data="bestVsMedian as any" class="card-eq" />
              <SansTopTradeCard v-if="sansTopTrade" :data="sansTopTrade as any" class="card-eq" />
              <RegimeAnalysisCard v-if="regimeAnalysis" :data="regimeAnalysis as any" class="card-eq" />
              <DispersionBandsCard v-if="dispersionBands" :data="dispersionBands as any" class="card-eq" />
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ SECTION 4: OPTIMIZATION LANDSCAPE ═══ -->
      <div class="section">
        <div class="section-header">
          <span class="section-num">{{ overfitWarnings ? '4' : '3' }}</span>
          <h3>{{ t('strategyDev.sectionConvergenceDistribution') }}</h3>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper v-if="analysis.convergence" :title="t('strategyDev.chartLossConvergence')" :hint="t('strategyDev.hintConvergence')" chart-id="convergence">
            <ConvergenceChart :data="analysis.convergence as number[]" :title="t('strategyDev.chartLossConvergence')" />
            <template #fullscreen>
              <ConvergenceChart :data="analysis.convergence as number[]" :title="t('strategyDev.chartLossConvergence')" />
            </template>
          </ChartWrapper>
          <ChartWrapper v-if="analysis.loss_histogram" :title="t('strategyDev.chartLossDistribution')" :hint="t('strategyDev.hintLossHistogram')" chart-id="loss-histogram">
            <LossHistogramChart :histogram="analysis.loss_histogram as Record<string, unknown>" :title="t('strategyDev.chartLossDistribution')" />
            <template #fullscreen>
              <LossHistogramChart :histogram="analysis.loss_histogram as Record<string, unknown>" :title="t('strategyDev.chartLossDistribution')" />
            </template>
          </ChartWrapper>
          <ChartWrapper v-if="analysis.return_vs_dd" :title="t('strategyDev.chartReturnVsDrawdown')" :hint="t('strategyDev.hintReturnVsDd')" chart-id="return-vs-dd">
            <ReturnVsDdScatter :data="analysis.return_vs_dd as Record<string, unknown>[]" :title="t('strategyDev.chartReturnVsDrawdown')" />
            <template #fullscreen>
              <ReturnVsDdScatter :data="analysis.return_vs_dd as Record<string, unknown>[]" :title="t('strategyDev.chartReturnVsDrawdown')" />
            </template>
          </ChartWrapper>
          <ChartWrapper v-if="pairProfitData" :title="t('strategyDev.chartPairProfitDistribution')" :hint="t('strategyDev.hintPairProfit')" chart-id="pair-profit">
            <PairProfitBarChart :data="pairProfitData as Record<string, unknown>[]" :title="t('strategyDev.chartPairProfitDistribution')" />
            <template #fullscreen>
              <PairProfitBarChart :data="pairProfitData as Record<string, unknown>[]" :title="t('strategyDev.chartPairProfitDistribution')" />
            </template>
          </ChartWrapper>
        </div>
      </div>

      <!-- ═══ SECTION 5: PARAMETER ANALYSIS ═══ -->
      <div class="section">
        <div class="section-header">
          <span class="section-num">{{ overfitWarnings ? '5' : '4' }}</span>
          <h3>{{ t('strategyDev.sectionParameterAnalysis') }}</h3>
        </div>

        <!-- Parameter sub-tabs -->
        <div class="param-tabs">
          <button
            v-if="parallelCoords"
            class="param-tab"
            :class="{ active: paramTabIndex === 0 }"
            @click="paramTabIndex = 0"
          >
            <i-mdi-chart-timeline-variant class="w-3.5 h-3.5" />
            {{ t('strategyDev.chartParallelCoords') }}
          </button>
          <button
            v-if="paramCorrelation"
            class="param-tab"
            :class="{ active: paramTabIndex === 1 }"
            @click="paramTabIndex = 1"
          >
            <i-mdi-grid class="w-3.5 h-3.5" />
            {{ t('strategyDev.chartParameterCorrelation') }}
          </button>
          <button
            v-if="sensitivityGrid"
            class="param-tab"
            :class="{ active: paramTabIndex === 2 }"
            @click="paramTabIndex = 2"
          >
            <i-mdi-tune-vertical class="w-3.5 h-3.5" />
            {{ t('strategyDev.sectionParameterSensitivity') }}
          </button>
        </div>

        <div class="param-tab-content">
          <ChartWrapper v-if="parallelCoords && paramTabIndex === 0" :title="t('strategyDev.chartParallelCoords')" :hint="t('strategyDev.hintParallelCoords')" chart-id="parallel-coords">
            <ParallelCoordsChart :data="parallelCoords as any" :title="t('strategyDev.chartParallelCoords')" />
            <template #fullscreen>
              <ParallelCoordsChart :data="parallelCoords as any" :title="t('strategyDev.chartParallelCoords')" />
            </template>
          </ChartWrapper>
          <ChartWrapper v-if="paramCorrelation && paramTabIndex === 1" :title="t('strategyDev.chartParameterCorrelation')" :hint="t('strategyDev.hintCorrelation')" chart-id="param-correlation">
            <ParamCorrelationHeatmap :correlations="paramCorrelation as any" :title="t('strategyDev.chartParameterCorrelation')" />
            <template #fullscreen>
              <ParamCorrelationHeatmap :correlations="paramCorrelation as any" :title="t('strategyDev.chartParameterCorrelation')" />
            </template>
          </ChartWrapper>
          <ChartWrapper v-if="sensitivityGrid && paramTabIndex === 2" :title="t('strategyDev.sectionParameterSensitivity')" :hint="t('strategyDev.hintSensitivity')" chart-id="sensitivity-grid">
            <SensitivityGridChart :grids="sensitivityGrid as any" :title="t('strategyDev.sectionParameterSensitivity')" />
            <template #fullscreen>
              <SensitivityGridChart :grids="sensitivityGrid as any" :title="t('strategyDev.sectionParameterSensitivity')" />
            </template>
          </ChartWrapper>
        </div>

        <!-- Parameter Recommendation Table — always visible -->
        <ParamRecommendationTable
          v-if="paramDeepDive && paramStats"
          :deepDive="paramDeepDive as any"
          :paramStats="paramStats as any"
          :paramStability="paramStabilityData as any"
          class="mt-4"
        />
      </div>
    </template>

    <div v-else class="text-surface-400 text-sm text-center py-16">
      {{ t('strategyDev.noAnalysisData') }}
    </div>
  </div>
</template>

<style scoped>
.charts-page {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0.75rem 0;
  max-width: 1600px;
  margin: 0 auto;
}

/* ── Sections ── */
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

/* ── Critical alert ── */
.alert-critical {
  display: flex;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-radius: 0.75rem;
  background: rgba(243, 139, 168, 0.08);
  border: 1px solid rgba(243, 139, 168, 0.25);
  color: #f38ba8;
  margin-bottom: 0.5rem;
}

.alert-critical-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: rgba(243, 139, 168, 0.15);
  flex-shrink: 0;
}

.alert-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin-top: 0.75rem;
}

.alert-action {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: var(--sd-text-xs);
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  background: rgba(243, 139, 168, 0.1);
  color: rgba(243, 139, 168, 0.8);
}

/* ── Two-column layout (large screens) ── */
.two-col-layout {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

@media (min-width: 1536px) {
  .two-col-layout {
    flex-direction: row;
  }
  .two-col-main {
    flex: 3;
    min-width: 0;
  }
  .two-col-side {
    flex: 2;
    min-width: 0;
  }
}

/* ── Equal height cards ── */
.card-eq {
  min-height: 0;
}

/* ── Parameter tabs ── */
.param-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  background: rgba(49, 50, 68, 0.5);
  border-radius: 0.625rem;
  margin-bottom: 0.75rem;
}

.param-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: #6c7086;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.param-tab:hover {
  color: #a6adc8;
  background: rgba(69, 71, 90, 0.4);
}

.param-tab.active {
  color: #cdd6f4;
  background: rgba(137, 180, 250, 0.12);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.param-tab-content {
  min-height: 380px;
}
</style>
