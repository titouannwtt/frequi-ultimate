<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useBtcBenchmark } from '@/composables/useBtcBenchmark';

const { t } = useI18n();
const store = useStrategyDevStore();
const analysisLoading = ref(false);
const advancedLoading = ref(false);

const btcEquityInput = computed(() => store.advancedAnalytics?.equity_curve as { date: string; balance: number }[] | undefined);
const btcStartBal = computed(() => (store.advancedAnalytics?.starting_balance as number) ?? 1000);
const { benchmarkEquity: btcBenchmark } = useBtcBenchmark(btcEquityInput, btcStartBal);

onMounted(async () => {
  const filename = store.selectedRun?.filename;
  if (!filename) return;

  const promises: Promise<void>[] = [];
  if (!store.hyperoptAnalysis) {
    analysisLoading.value = true;
    promises.push(
      store.fetchHyperoptAnalysis(filename).finally(() => { analysisLoading.value = false; }),
    );
  }
  if (!store.advancedAnalytics) {
    advancedLoading.value = true;
    promises.push(
      store.fetchAdvancedAnalytics(filename).finally(() => { advancedLoading.value = false; }),
    );
  }
  await Promise.all(promises);
});

const analysis = computed(() => store.hyperoptAnalysis);
const advanced = computed(() => store.advancedAnalytics);
const epochInfo = computed(() => (advanced.value?.epoch_info as Record<string, unknown>) ?? null);

const regimeTimeline = computed(() => {
  const mr = advanced.value?.market_regime as Record<string, unknown> | undefined;
  return mr?.timeline as { date: string; regime: string; volatility: number; trend: number }[] | undefined;
});
const isLoading = computed(() => analysisLoading.value || advancedLoading.value);

const analyseMode = computed({
  get: () => store.analyseMode,
  set: (v) => { store.analyseMode = v; },
});

// ── Section visibility ──
const activeSection = ref('diagnostic');
const sections = computed(() => {
  const s: { id: string; label: string; icon: string }[] = [];
  s.push({ id: 'diagnostic', label: t('strategyDev.navDiagnostic'), icon: 'i-mdi-stethoscope' });
  s.push({ id: 'equity', label: t('strategyDev.navEquity'), icon: 'i-mdi-chart-line' });
  s.push({ id: 'performance', label: t('strategyDev.navPerformance'), icon: 'i-mdi-chart-bar' });
  s.push({ id: 'trades', label: t('strategyDev.navTrades'), icon: 'i-mdi-swap-horizontal' });
  s.push({ id: 'risk', label: t('strategyDev.navRisk'), icon: 'i-mdi-shield-alert' });
  s.push({ id: 'consistency', label: t('strategyDev.navConsistency'), icon: 'i-mdi-pulse' });
  s.push({ id: 'robustness', label: t('strategyDev.navRobustness'), icon: 'i-mdi-test-tube' });
  s.push({ id: 'parameters', label: t('strategyDev.navParameters'), icon: 'i-mdi-tune' });
  return s;
});

function scrollToSection(id: string) {
  activeSection.value = id;
  const el = document.getElementById(`analyse-${id}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Intersection observer for active section tracking ──
const sectionRefs = ref<Record<string, HTMLElement | null>>({});

onMounted(() => {
  nextTick(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            activeSection.value = entry.target.id.replace('analyse-', '');
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 },
    );
    for (const section of sections.value) {
      const el = document.getElementById(`analyse-${section.id}`);
      if (el) observer.observe(el);
    }
  });
});

// ── Analysis data accessors ──
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
  const a = analysis.value;
  if (!a) return null;
  const ps = (a as Record<string, unknown>).param_stats;
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

// ── Epoch info formatting ──
function fmtPct(v: unknown): string {
  const n = Number(v);
  if (isNaN(n)) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
}

function fmtNum(v: unknown, decimals = 2): string {
  const n = Number(v);
  if (isNaN(n)) return '—';
  return n.toFixed(decimals);
}
</script>

<template>
  <div class="analyse-root">
    <!-- ═══ LOADING ═══ -->
    <div v-if="isLoading && !analysis && !advanced" class="py-6">
      <SkeletonPanel variant="cards" :cols="4" />
      <SkeletonPanel variant="chart" class="mt-4" />
      <SkeletonPanel variant="chart" class="mt-4" />
    </div>

    <template v-else>
      <!-- ═══ MODE TOGGLE ═══ -->
      <div class="mode-toggle">
        <button
          class="mode-btn"
          :class="{ active: analyseMode === 'global' }"
          @click="analyseMode = 'global'"
        >
          <i-mdi-chart-line class="w-3.5 h-3.5" />
          {{ t('strategyDev.modeGlobal') }}
        </button>
        <button
          class="mode-btn"
          :class="{ active: analyseMode === 'epoch' }"
          @click="analyseMode = 'epoch'"
        >
          <i-mdi-numeric class="w-3.5 h-3.5" />
          {{ t('strategyDev.modeEpoch') }}
        </button>
        <button
          class="mode-btn"
          :class="{ active: analyseMode === 'compare' }"
          @click="analyseMode = 'compare'"
        >
          <i-mdi-compare-horizontal class="w-3.5 h-3.5" />
          {{ t('strategyDev.modeCompare') }}
        </button>
      </div>

      <!-- ═══ PER-EPOCH MODE ═══ -->
      <EpochAnalysePanel v-if="analyseMode === 'epoch'" />

      <!-- ═══ COMPARE MODE ═══ -->
      <EpochComparePanel v-else-if="analyseMode === 'compare'" />

      <!-- ═══ GLOBAL MODE ═══ -->
      <!-- ═══ SCORECARD BANNER ═══ -->
      <template v-else>
      <div v-if="epochInfo" class="scorecard">
        <div class="scorecard-badge">
          <i-mdi-trophy class="w-3.5 h-3.5" />
          {{ t('strategyDev.aaBestEpochBanner') }}
          <span v-if="epochInfo.current_epoch" class="scorecard-epoch">#{{ epochInfo.current_epoch }}</span>
        </div>
        <div class="scorecard-metrics">
          <div class="sc-metric">
            <span class="sc-label">Profit</span>
            <span class="sc-value" :class="Number(epochInfo.total_profit) >= 0 ? 'sc-pos' : 'sc-neg'">
              {{ fmtPct(epochInfo.total_profit) }}
            </span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Trades</span>
            <span class="sc-value">{{ epochInfo.total_trades }}</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Drawdown</span>
            <span class="sc-value sc-neg">{{ fmtPct(epochInfo.max_drawdown) }}</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Sharpe</span>
            <span class="sc-value">{{ fmtNum(epochInfo.sharpe) }}</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Sortino</span>
            <span class="sc-value">{{ fmtNum(epochInfo.sortino) }}</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Win Rate</span>
            <span class="sc-value">
              {{ typeof epochInfo.winrate === 'number' && epochInfo.winrate <= 1
                ? (Number(epochInfo.winrate) * 100).toFixed(1)
                : fmtNum(epochInfo.winrate, 1) }}%
            </span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">PF</span>
            <span class="sc-value">{{ fmtNum(epochInfo.profit_factor) }}</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Loss</span>
            <span class="sc-value">{{ fmtNum(epochInfo.loss, 4) }}</span>
          </div>
        </div>
      </div>

      <!-- ═══ STICKY NAVIGATION ═══ -->
      <nav class="analyse-nav">
        <button
          v-for="s in sections"
          :key="s.id"
          class="nav-pill"
          :class="{ active: activeSection === s.id }"
          @click="scrollToSection(s.id)"
        >
          {{ s.label }}
        </button>
      </nav>

      <!-- ═══ SECTION 1: DIAGNOSTIC ═══ -->
      <section id="analyse-diagnostic" class="analyse-section">
        <div class="section-header">
          <span class="section-num">1</span>
          <h3>{{ t('strategyDev.navDiagnostic') }}</h3>
        </div>

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

        <OverfitWarningsPanel v-if="overfitWarnings" :warnings="overfitWarnings" class="mb-3" />

        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <DsrAnalysisCard v-if="dsrAnalysis" :data="dsrAnalysis as any" />
          <DofAnalysisCard v-if="dofAnalysis" :data="dofAnalysis as any" />
          <BenchmarkCard v-if="benchmarkComparison" :data="benchmarkComparison as any" />
          <DistributionAnalysisCard v-if="distributionAnalysis" :data="distributionAnalysis as any" />
        </div>
      </section>

      <!-- ═══ SECTION 2: EQUITY & DRAWDOWNS ═══ -->
      <section id="analyse-equity" class="analyse-section">
        <div class="section-header">
          <span class="section-num">2</span>
          <h3>{{ t('strategyDev.navEquity') }}</h3>
        </div>

        <div class="grid grid-cols-1 gap-4">
          <ChartWrapper
            v-if="advanced?.equity_curve"
            :title="t('strategyDev.aaEquityCurve')"
            :hint="t('strategyDev.hintEquityCurve')"
            chart-id="equity-curve"
          >
            <EquityCurveChart
              :equity="advanced.equity_curve as any[]"
              :starting-balance="(advanced.starting_balance as number) ?? 1000"
              :benchmark="btcBenchmark"
              benchmark-label="BTC"
              :regimes="regimeTimeline"
            />
            <template #fullscreen>
              <EquityCurveChart
                :equity="advanced.equity_curve as any[]"
                :starting-balance="(advanced.starting_balance as number) ?? 1000"
                :benchmark="btcBenchmark"
                benchmark-label="BTC"
                :regimes="regimeTimeline"
              />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />

          <ChartWrapper
            v-if="advanced?.drawdown_series"
            :title="t('strategyDev.aaUnderwaterPlot')"
            :hint="t('strategyDev.hintUnderwater')"
            chart-id="underwater-plot"
          >
            <UnderwaterChart :series="advanced.drawdown_series as any[]" :regimes="regimeTimeline" />
            <template #fullscreen>
              <UnderwaterChart :series="advanced.drawdown_series as any[]" :regimes="regimeTimeline" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              v-if="advanced?.top_drawdowns"
              :title="t('strategyDev.aaDrawdownDetails')"
              :hint="t('strategyDev.hintDrawdownDetails')"
              chart-id="drawdown-details"
            >
              <DrawdownDetailsCard :drawdowns="advanced.top_drawdowns as any[]" />
            </ChartWrapper>
            <ChartEmptyState v-else />

            <ChartWrapper
              v-if="advanced?.cumulative_trades"
              :title="t('strategyDev.aaCumulativeTrades')"
              :hint="t('strategyDev.hintCumulativeTrades')"
              chart-id="cumulative-trades"
            >
              <CumulativeTradesChart :trades="advanced.cumulative_trades as any[]" :regimes="regimeTimeline" />
              <template #fullscreen>
                <CumulativeTradesChart :trades="advanced.cumulative_trades as any[]" :regimes="regimeTimeline" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />
          </div>

          <ChartWrapper
            v-if="advanced?.drawdown_calendar"
            :title="t('strategyDev.aaDrawdownCalendar')"
            :hint="t('strategyDev.hintDrawdownCalendar')"
            chart-id="drawdown-calendar"
          >
            <DrawdownCalendarChart :data="advanced.drawdown_calendar as any[]" />
            <template #fullscreen>
              <DrawdownCalendarChart :data="advanced.drawdown_calendar as any[]" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />
        </div>
      </section>

      <!-- ═══ SECTION 3: PERFORMANCE ═══ -->
      <section id="analyse-performance" class="analyse-section">
        <div class="section-header">
          <span class="section-num">3</span>
          <h3>{{ t('strategyDev.navPerformance') }}</h3>
        </div>

        <div class="grid grid-cols-1 gap-4">
          <ChartWrapper
            v-if="advanced?.monthly_returns"
            :title="t('strategyDev.aaMonthlyReturns')"
            :hint="t('strategyDev.hintMonthlyReturns')"
            chart-id="monthly-returns"
          >
            <MonthlyReturnsHeatmap :data="advanced.monthly_returns as any[]" />
            <template #fullscreen>
              <MonthlyReturnsHeatmap :data="advanced.monthly_returns as any[]" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />

          <ChartWrapper
            v-if="advanced?.rolling_metrics"
            :title="t('strategyDev.aaRollingMetrics')"
            :hint="t('strategyDev.hintRollingMetrics')"
            chart-id="rolling-metrics"
          >
            <RollingMetricsChart :metrics="advanced.rolling_metrics as any" />
            <template #fullscreen>
              <RollingMetricsChart :metrics="advanced.rolling_metrics as any" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />
        </div>
      </section>

      <!-- ═══ SECTION 4: TRADES ═══ -->
      <section id="analyse-trades" class="analyse-section">
        <div class="section-header">
          <span class="section-num">4</span>
          <h3>{{ t('strategyDev.navTrades') }}</h3>
        </div>

        <div class="grid grid-cols-1 gap-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              v-if="advanced?.trade_pnl_distribution"
              :title="t('strategyDev.aaTradePnl')"
              :hint="t('strategyDev.hintTradePnl')"
              chart-id="trade-pnl"
            >
              <TradePnlChart :distribution="advanced.trade_pnl_distribution as any" />
              <template #fullscreen>
                <TradePnlChart :distribution="advanced.trade_pnl_distribution as any" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />

            <ChartWrapper
              v-if="advanced?.duration_scatter"
              :title="t('strategyDev.aaDurationScatter')"
              :hint="t('strategyDev.hintDurationScatter')"
              chart-id="duration-scatter"
            >
              <DurationScatterChart :points="advanced.duration_scatter as any[]" />
              <template #fullscreen>
                <DurationScatterChart :points="advanced.duration_scatter as any[]" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              v-if="advanced?.exit_reason_detail"
              :title="t('strategyDev.aaExitReasons')"
              :hint="t('strategyDev.hintExitReasons')"
              chart-id="exit-reasons"
            >
              <ExitReasonChart :reasons="advanced.exit_reason_detail as any[]" />
              <template #fullscreen>
                <ExitReasonChart :reasons="advanced.exit_reason_detail as any[]" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />

            <ChartWrapper
              v-if="advanced?.streaks"
              :title="t('strategyDev.aaStreaks')"
              :hint="t('strategyDev.hintStreaks')"
              chart-id="streaks"
            >
              <StreaksCard :streaks="advanced.streaks as any" />
            </ChartWrapper>
            <ChartEmptyState v-else />
          </div>

          <ChartWrapper
            v-if="advanced?.trade_expectancy"
            :title="t('strategyDev.aaExpectancy')"
            :hint="t('strategyDev.hintExpectancy')"
            chart-id="expectancy"
          >
            <ExpectancyCard :data="advanced.trade_expectancy as any" />
          </ChartWrapper>
          <ChartEmptyState v-else />

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              v-if="advanced?.return_distribution_fit"
              :title="t('strategyDev.aaReturnDistribution')"
              :hint="t('strategyDev.hintReturnDistribution')"
              chart-id="return-dist"
            >
              <ReturnDistributionChart :data="advanced.return_distribution_fit as any" />
              <template #fullscreen>
                <ReturnDistributionChart :data="advanced.return_distribution_fit as any" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />

            <ChartWrapper
              v-if="advanced?.mae_mfe"
              :title="t('strategyDev.aaMaeMfe')"
              :hint="t('strategyDev.hintMaeMfe')"
              chart-id="mae-mfe"
            >
              <MaeMfeScatter :points="advanced.mae_mfe as any[]" />
              <template #fullscreen>
                <MaeMfeScatter :points="advanced.mae_mfe as any[]" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />
          </div>

          <!-- Duration Deep Analysis -->
          <div v-if="advanced?.duration_boxplot || advanced?.duration_buckets" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              v-if="advanced?.duration_boxplot"
              :title="t('strategyDev.aaDurationBoxplot')"
              :hint="t('strategyDev.hintDurationBoxplot')"
              chart-id="ep-duration-boxplot"
            >
              <DurationBoxPlotChart :data="advanced.duration_boxplot as any" />
              <template #fullscreen>
                <DurationBoxPlotChart :data="advanced.duration_boxplot as any" />
              </template>
            </ChartWrapper>
            <ChartWrapper
              v-if="advanced?.duration_buckets"
              :title="t('strategyDev.aaDurationBuckets')"
              :hint="t('strategyDev.hintDurationBuckets')"
              chart-id="ep-duration-buckets"
            >
              <DurationBucketChart :data="advanced.duration_buckets as any" />
              <template #fullscreen>
                <DurationBucketChart :data="advanced.duration_buckets as any" />
              </template>
            </ChartWrapper>
          </div>
          <div v-if="advanced?.duration_profit_heatmap || (advanced?.stuck_trades && (advanced.stuck_trades as any).stuck_count > 0)" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              v-if="advanced?.duration_profit_heatmap"
              :title="t('strategyDev.aaDurationProfitHeatmap')"
              :hint="t('strategyDev.hintDurationProfitHeatmap')"
              chart-id="ep-duration-heatmap"
            >
              <DurationProfitHeatmap :data="advanced.duration_profit_heatmap as any" />
              <template #fullscreen>
                <DurationProfitHeatmap :data="advanced.duration_profit_heatmap as any" />
              </template>
            </ChartWrapper>
            <ChartWrapper
              v-if="advanced?.stuck_trades && (advanced.stuck_trades as any).stuck_count > 0"
              :title="t('strategyDev.aaStuckTrades')"
              :hint="t('strategyDev.hintStuckTrades')"
              chart-id="ep-stuck-trades"
            >
              <DurationStuckTradesCard :data="advanced.stuck_trades as any" />
            </ChartWrapper>
          </div>

          <!-- DCA Analysis -->
          <div v-if="advanced?.dca_analysis && !(advanced.dca_analysis as any).no_dca" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              :title="t('strategyDev.aaDcaDistribution')"
              :hint="t('strategyDev.hintDcaDistribution')"
              chart-id="ep-dca-distribution"
            >
              <DcaLevelDistributionChart :data="advanced.dca_analysis as any" />
              <template #fullscreen>
                <DcaLevelDistributionChart :data="advanced.dca_analysis as any" />
              </template>
            </ChartWrapper>
            <ChartWrapper
              :title="t('strategyDev.aaDcaProfitContribution')"
              :hint="t('strategyDev.hintDcaProfitContribution')"
              chart-id="ep-dca-contribution"
            >
              <DcaProfitContributionChart :data="advanced.dca_analysis as any" />
              <template #fullscreen>
                <DcaProfitContributionChart :data="advanced.dca_analysis as any" />
              </template>
            </ChartWrapper>
          </div>
          <ChartWrapper
            v-if="advanced?.dca_analysis && !(advanced.dca_analysis as any).no_dca"
            :title="t('strategyDev.aaDcaRecovery')"
            :hint="t('strategyDev.hintDcaRecovery')"
            chart-id="ep-dca-recovery"
          >
            <DcaRecoveryCard :data="advanced.dca_analysis as any" />
          </ChartWrapper>

          <!-- Pair Correlation -->
          <div v-if="advanced?.pair_correlation" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              :title="t('strategyDev.aaPairCorrelation')"
              :hint="t('strategyDev.hintPairCorrelation')"
              chart-id="ep-pair-correlation"
            >
              <PairCorrelationHeatmap :data="advanced.pair_correlation as any" />
              <template #fullscreen>
                <PairCorrelationHeatmap :data="advanced.pair_correlation as any" />
              </template>
            </ChartWrapper>
            <div class="flex flex-col gap-4">
              <ChartWrapper
                :title="t('strategyDev.aaConcentrationRisk')"
                :hint="t('strategyDev.hintConcentrationRisk')"
                chart-id="ep-concentration-risk"
              >
                <ConcentrationRiskCard :data="advanced.pair_correlation as any" />
              </ChartWrapper>
              <ChartWrapper
                v-if="(advanced.pair_correlation as any).max_simultaneous_loss"
                :title="t('strategyDev.aaMaxSimultaneousLoss')"
                :hint="t('strategyDev.hintMaxSimultaneousLoss')"
                chart-id="ep-max-simul-loss"
              >
                <MaxSimultaneousLossCard :data="(advanced.pair_correlation as any).max_simultaneous_loss" />
              </ChartWrapper>
            </div>
          </div>

          <!-- Market Regime -->
          <div v-if="advanced?.market_regime" class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              :title="t('strategyDev.aaRegimePerformance')"
              :hint="t('strategyDev.hintRegimePerformance')"
              chart-id="ep-regime-perf"
            >
              <RegimePerformanceChart :data="advanced.market_regime as any" />
              <template #fullscreen>
                <RegimePerformanceChart :data="advanced.market_regime as any" />
              </template>
            </ChartWrapper>
            <ChartWrapper
              :title="t('strategyDev.aaRegimeTimeline')"
              :hint="t('strategyDev.hintRegimeTimeline')"
              chart-id="ep-regime-timeline"
            >
              <RegimeEquityOverlayChart :data="advanced.market_regime as any" :equity="advanced.equity_curve as any" />
              <template #fullscreen>
                <RegimeEquityOverlayChart :data="advanced.market_regime as any" :equity="advanced.equity_curve as any" />
              </template>
            </ChartWrapper>
          </div>
          <ChartWrapper
            v-if="advanced?.market_regime"
            :title="t('strategyDev.aaRegimeTransitions')"
            :hint="t('strategyDev.hintRegimeTransitions')"
            chart-id="ep-regime-transitions"
          >
            <RegimeTransitionCard :data="advanced.market_regime as any" />
          </ChartWrapper>
        </div>
      </section>

      <!-- ═══ SECTION 5: RISK ═══ -->
      <section id="analyse-risk" class="analyse-section">
        <div class="section-header">
          <span class="section-num">5</span>
          <h3>{{ t('strategyDev.navRisk') }}</h3>
        </div>

        <RiskMetricsCard v-if="advanced?.risk_metrics" :metrics="advanced.risk_metrics as any" class="mb-4" />

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper
            v-if="advanced?.long_short_split"
            :title="t('strategyDev.aaLongShort')"
            :hint="t('strategyDev.hintLongShort')"
            chart-id="long-short"
          >
            <LongShortCard :split="advanced.long_short_split as any" />
          </ChartWrapper>
          <ChartEmptyState v-else />

          <ChartWrapper
            v-if="advanced?.exposure_timeline"
            :title="t('strategyDev.aaExposure')"
            :hint="t('strategyDev.hintExposure')"
            chart-id="exposure"
          >
            <ExposureChart :timeline="advanced.exposure_timeline as any[]" :regimes="regimeTimeline" />
            <template #fullscreen>
              <ExposureChart :timeline="advanced.exposure_timeline as any[]" :regimes="regimeTimeline" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />
        </div>
      </section>

      <!-- ═══ SECTION 6: CONSISTENCY ═══ -->
      <section id="analyse-consistency" class="analyse-section">
        <div class="section-header">
          <span class="section-num">6</span>
          <h3>{{ t('strategyDev.navConsistency') }}</h3>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper
            v-if="advanced?.rolling_winrate"
            :title="t('strategyDev.aaRollingWinrate')"
            :hint="t('strategyDev.hintRollingWinrate')"
            chart-id="rolling-winrate"
          >
            <RollingWinrateChart :data="advanced.rolling_winrate as any[]" :regimes="regimeTimeline" />
            <template #fullscreen>
              <RollingWinrateChart :data="advanced.rolling_winrate as any[]" :regimes="regimeTimeline" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />

          <ChartWrapper
            v-if="advanced?.rolling_profit_factor"
            :title="t('strategyDev.aaRollingProfitFactor')"
            :hint="t('strategyDev.hintRollingProfitFactor')"
            chart-id="rolling-pf"
          >
            <RollingProfitFactorChart :data="advanced.rolling_profit_factor as any[]" :regimes="regimeTimeline" />
            <template #fullscreen>
              <RollingProfitFactorChart :data="advanced.rolling_profit_factor as any[]" :regimes="regimeTimeline" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />
        </div>

        <ChartWrapper
          v-if="advanced?.weekday_pattern"
          :title="t('strategyDev.aaWeekdayPattern')"
          :hint="t('strategyDev.hintWeekdayPattern')"
          chart-id="weekday-pattern"
          class="mt-4"
        >
          <WeekdayPatternChart :pattern="advanced.weekday_pattern as any" />
          <template #fullscreen>
            <WeekdayPatternChart :pattern="advanced.weekday_pattern as any" />
          </template>
        </ChartWrapper>
        <ChartEmptyState v-else class="mt-4" />
      </section>

      <!-- ═══ SECTION 7: ROBUSTNESS ═══ -->
      <section id="analyse-robustness" class="analyse-section">
        <div class="section-header">
          <span class="section-num">7</span>
          <h3>{{ t('strategyDev.navRobustness') }}</h3>
        </div>

        <div class="two-col-layout">
          <div class="two-col-main">
            <ChartWrapper v-if="monteCarlo" :title="t('strategyDev.chartMonteCarloTitle')" :hint="t('strategyDev.hintMonteCarlo')" chart-id="monte-carlo">
              <MonteCarloChart :data="monteCarlo as any" :title="t('strategyDev.chartMonteCarloTitle')" />
              <template #fullscreen>
                <MonteCarloChart :data="monteCarlo as any" :title="t('strategyDev.chartMonteCarloTitle')" />
              </template>
            </ChartWrapper>
          </div>
          <div class="two-col-side">
            <div class="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-1 gap-3">
              <BestVsMedianCard v-if="bestVsMedian" :data="bestVsMedian as any" />
              <SansTopTradeCard v-if="sansTopTrade" :data="sansTopTrade as any" />
              <RegimeAnalysisCard v-if="regimeAnalysis" :data="regimeAnalysis as any" />
              <DispersionBandsCard v-if="dispersionBands" :data="dispersionBands as any" />
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <ChartWrapper v-if="analysis?.convergence" :title="t('strategyDev.chartLossConvergence')" :hint="t('strategyDev.hintConvergence')" chart-id="convergence">
            <ConvergenceChart :data="analysis.convergence as any[]" :title="t('strategyDev.chartLossConvergence')" />
            <template #fullscreen>
              <ConvergenceChart :data="analysis.convergence as any[]" :title="t('strategyDev.chartLossConvergence')" />
            </template>
          </ChartWrapper>
          <ChartWrapper v-if="analysis?.loss_histogram" :title="t('strategyDev.chartLossDistribution')" :hint="t('strategyDev.hintLossHistogram')" chart-id="loss-histogram">
            <LossHistogramChart :histogram="analysis.loss_histogram as Record<string, unknown>" :title="t('strategyDev.chartLossDistribution')" />
            <template #fullscreen>
              <LossHistogramChart :histogram="analysis.loss_histogram as Record<string, unknown>" :title="t('strategyDev.chartLossDistribution')" />
            </template>
          </ChartWrapper>
          <ChartWrapper v-if="analysis?.return_vs_dd" :title="t('strategyDev.chartReturnVsDrawdown')" :hint="t('strategyDev.hintReturnVsDd')" chart-id="return-vs-dd">
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
      </section>

      <!-- ═══ SECTION 8: PARAMETERS ═══ -->
      <section id="analyse-parameters" class="analyse-section">
        <div class="section-header">
          <span class="section-num">8</span>
          <h3>{{ t('strategyDev.navParameters') }}</h3>
        </div>

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

        <ParamRecommendationTable
          v-if="paramDeepDive && paramStats"
          :deepDive="paramDeepDive as any"
          :paramStats="paramStats as any"
          :paramStability="paramStabilityData as any"
          class="mt-4"
        />
      </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.analyse-root {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0.75rem 0;
  max-width: 1600px;
  margin: 0 auto;
}

/* ── Mode toggle ── */
.mode-toggle {
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem;
  background: rgba(49, 50, 68, 0.5);
  border-radius: 0.625rem;
  margin-bottom: 0.75rem;
  width: fit-content;
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  border-radius: 0.5rem;
  font-size: 12px;
  font-weight: 500;
  color: #6c7086;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.mode-btn:hover {
  color: #a6adc8;
  background: rgba(69, 71, 90, 0.4);
}

.mode-btn.active {
  color: #cdd6f4;
  background: rgba(137, 180, 250, 0.15);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* ── Scorecard ── */
.scorecard {
  padding: 0.875rem 1.25rem;
  border-radius: 0.75rem;
  background: rgba(137, 180, 250, 0.05);
  border: 1px solid rgba(137, 180, 250, 0.12);
  margin-bottom: 0.75rem;
}

.scorecard-badge {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  color: #89b4fa;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.625rem;
}

.scorecard-epoch {
  font-family: var(--sd-font-mono);
  font-size: var(--sd-text-xs);
  color: #cdd6f4;
  background: rgba(137, 180, 250, 0.12);
  padding: 0.0625rem 0.375rem;
  border-radius: 0.25rem;
}

.scorecard-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 1.5rem;
}

.sc-metric {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.sc-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6c7086;
}

.sc-value {
  font-family: var(--sd-font-mono);
  font-size: var(--sd-text-sm);
  font-weight: 700;
  color: #cdd6f4;
}

.sc-pos { color: #a6e3a1; }
.sc-neg { color: #f38ba8; }

/* ── Sticky navigation ── */
.analyse-nav {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  gap: 0.25rem;
  padding: 0.375rem;
  background: rgba(17, 17, 27, 0.92);
  backdrop-filter: blur(12px);
  border-radius: 0.625rem;
  margin-bottom: 0.5rem;
  overflow-x: auto;
  scrollbar-width: none;
}

.analyse-nav::-webkit-scrollbar {
  display: none;
}

.nav-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  font-size: 11px;
  font-weight: 500;
  color: #6c7086;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.nav-pill:hover {
  color: #a6adc8;
  background: rgba(69, 71, 90, 0.4);
}

.nav-pill.active {
  color: #cdd6f4;
  background: rgba(137, 180, 250, 0.15);
}

/* ── Sections ── */
.analyse-section {
  padding: 1.25rem 0;
  scroll-margin-top: 56px;
}

.analyse-section + .analyse-section {
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

/* ── Alert ── */
.alert-critical {
  display: flex;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-radius: 0.75rem;
  background: rgba(243, 139, 168, 0.08);
  border: 1px solid rgba(243, 139, 168, 0.25);
  color: #f38ba8;
  margin-bottom: 0.75rem;
  text-align: left;
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

/* ── Two-column layout ── */
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
