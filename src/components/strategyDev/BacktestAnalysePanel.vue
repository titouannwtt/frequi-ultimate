<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();
const loading = ref(false);

onMounted(async () => {
  const run = store.selectedRun;
  if (!run || store.backtestAnalysis) return;
  loading.value = true;
  try {
    await store.fetchBacktestAnalysis(run.filename, run.strategy);
  } finally {
    loading.value = false;
  }
});

const data = computed(() => store.backtestAnalysis);
const summary = computed(() => (data.value?.backtest_summary as Record<string, unknown>) ?? null);

const activeSection = ref('summary');
const sections = computed(() => [
  { id: 'summary', label: t('strategyDev.btNavSummary'), icon: 'i-mdi-view-dashboard' },
  { id: 'equity', label: t('strategyDev.btNavEquity'), icon: 'i-mdi-chart-line' },
  { id: 'performance', label: t('strategyDev.btNavPerformance'), icon: 'i-mdi-chart-bar' },
  { id: 'trades', label: t('strategyDev.btNavTrades'), icon: 'i-mdi-swap-horizontal' },
  { id: 'risk', label: t('strategyDev.btNavRisk'), icon: 'i-mdi-shield-alert' },
  { id: 'consistency', label: t('strategyDev.btNavConsistency'), icon: 'i-mdi-pulse' },
  { id: 'pairs', label: t('strategyDev.btNavPairs'), icon: 'i-mdi-chart-donut' },
  { id: 'config', label: t('strategyDev.btNavConfig'), icon: 'i-mdi-cog' },
]);

function scrollToSection(id: string) {
  activeSection.value = id;
  const el = document.getElementById(`bt-analyse-${id}`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

onMounted(() => {
  nextTick(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            activeSection.value = entry.target.id.replace('bt-analyse-', '');
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 },
    );
    for (const section of sections.value) {
      const el = document.getElementById(`bt-analyse-${section.id}`);
      if (el) observer.observe(el);
    }
  });
});

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
    <!-- LOADING -->
    <div v-if="loading && !data" class="py-6">
      <SkeletonPanel variant="cards" :cols="4" />
      <SkeletonPanel variant="chart" class="mt-4" />
      <SkeletonPanel variant="chart" class="mt-4" />
    </div>

    <template v-else-if="data">
      <!-- SCORECARD -->
      <div v-if="summary" class="scorecard">
        <div class="scorecard-badge">
          <i-mdi-test-tube class="w-3.5 h-3.5" />
          {{ t('strategyDev.btScorecardTitle') }}
          <span v-if="summary.timeframe" class="scorecard-tag">{{ summary.timeframe }}</span>
          <span v-if="summary.backtest_days" class="scorecard-tag">{{ summary.backtest_days }}d</span>
        </div>
        <div class="scorecard-metrics">
          <div class="sc-metric">
            <span class="sc-label">Profit</span>
            <span class="sc-value" :class="Number(summary.profit_total ?? data.epoch_info?.total_profit) >= 0 ? 'sc-pos' : 'sc-neg'">
              {{ fmtPct(summary.profit_total ?? (data.epoch_info as any)?.total_profit) }}
            </span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Trades</span>
            <span class="sc-value">{{ (data.epoch_info as any)?.total_trades ?? '—' }}</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Drawdown</span>
            <span class="sc-value sc-neg">{{ fmtPct((data.epoch_info as any)?.max_drawdown) }}</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Sharpe</span>
            <span class="sc-value">{{ fmtNum((data.epoch_info as any)?.sharpe) }}</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Sortino</span>
            <span class="sc-value">{{ fmtNum((data.epoch_info as any)?.sortino) }}</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">Win Rate</span>
            <span class="sc-value">
              {{ typeof (data.epoch_info as any)?.winrate === 'number' && (data.epoch_info as any).winrate <= 1
                ? ((data.epoch_info as any).winrate * 100).toFixed(1)
                : fmtNum((data.epoch_info as any)?.winrate, 1) }}%
            </span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">PF</span>
            <span class="sc-value">{{ fmtNum((data.epoch_info as any)?.profit_factor) }}</span>
          </div>
          <div v-if="summary.final_balance" class="sc-metric">
            <span class="sc-label">Balance</span>
            <span class="sc-value">{{ fmtNum(summary.final_balance, 0) }}</span>
          </div>
        </div>
      </div>

      <!-- STICKY NAV -->
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

      <!-- SECTION 1: SUMMARY -->
      <section id="bt-analyse-summary" class="analyse-section">
        <div class="section-header">
          <span class="section-num">1</span>
          <h3>{{ t('strategyDev.btNavSummary') }}</h3>
        </div>
        <BacktestSummaryCards v-if="summary" :summary="summary" :order-stats="data.order_stats as any" />
      </section>

      <!-- SECTION 2: EQUITY & DRAWDOWNS -->
      <section id="bt-analyse-equity" class="analyse-section">
        <div class="section-header">
          <span class="section-num">2</span>
          <h3>{{ t('strategyDev.btNavEquity') }}</h3>
        </div>

        <div class="grid grid-cols-1 gap-4">
          <ChartWrapper
            v-if="data.equity_curve"
            :title="t('strategyDev.aaEquityCurve')"
            :hint="t('strategyDev.hintEquityCurve')"
            chart-id="bt-equity-curve"
          >
            <EquityCurveChart
              :equity="data.equity_curve as any[]"
              :starting-balance="(data.starting_balance as number) ?? 1000"
            />
            <template #fullscreen>
              <EquityCurveChart
                :equity="data.equity_curve as any[]"
                :starting-balance="(data.starting_balance as number) ?? 1000"
              />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />

          <ChartWrapper
            v-if="data.drawdown_series"
            :title="t('strategyDev.aaUnderwaterPlot')"
            :hint="t('strategyDev.hintUnderwater')"
            chart-id="bt-underwater"
          >
            <UnderwaterChart :series="data.drawdown_series as any[]" />
            <template #fullscreen>
              <UnderwaterChart :series="data.drawdown_series as any[]" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              v-if="data.top_drawdowns"
              :title="t('strategyDev.aaDrawdownDetails')"
              :hint="t('strategyDev.hintDrawdownDetails')"
              chart-id="bt-drawdown-details"
            >
              <DrawdownDetailsCard :drawdowns="data.top_drawdowns as any[]" />
            </ChartWrapper>
            <ChartEmptyState v-else />

            <ChartWrapper
              v-if="data.cumulative_trades"
              :title="t('strategyDev.aaCumulativeTrades')"
              :hint="t('strategyDev.hintCumulativeTrades')"
              chart-id="bt-cumulative-trades"
            >
              <CumulativeTradesChart :trades="data.cumulative_trades as any[]" />
              <template #fullscreen>
                <CumulativeTradesChart :trades="data.cumulative_trades as any[]" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />
          </div>

          <ChartWrapper
            v-if="data.drawdown_calendar"
            :title="t('strategyDev.aaDrawdownCalendar')"
            :hint="t('strategyDev.hintDrawdownCalendar')"
            chart-id="bt-drawdown-calendar"
          >
            <DrawdownCalendarChart :data="data.drawdown_calendar as any[]" />
            <template #fullscreen>
              <DrawdownCalendarChart :data="data.drawdown_calendar as any[]" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />

          <ChartWrapper
            v-if="data.benchmark"
            :title="t('strategyDev.btBenchmark')"
            :hint="t('strategyDev.hintBtBenchmark')"
            chart-id="bt-benchmark"
          >
            <BenchmarkComparisonChart :data="data.benchmark as any" />
            <template #fullscreen>
              <BenchmarkComparisonChart :data="data.benchmark as any" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />
        </div>
      </section>

      <!-- SECTION 3: PERFORMANCE -->
      <section id="bt-analyse-performance" class="analyse-section">
        <div class="section-header">
          <span class="section-num">3</span>
          <h3>{{ t('strategyDev.btNavPerformance') }}</h3>
        </div>

        <div class="grid grid-cols-1 gap-4">
          <ChartWrapper
            v-if="data.monthly_returns"
            :title="t('strategyDev.aaMonthlyReturns')"
            :hint="t('strategyDev.hintMonthlyReturns')"
            chart-id="bt-monthly-returns"
          >
            <MonthlyReturnsHeatmap :data="data.monthly_returns as any[]" />
            <template #fullscreen>
              <MonthlyReturnsHeatmap :data="data.monthly_returns as any[]" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />

          <ChartWrapper
            v-if="data.rolling_metrics"
            :title="t('strategyDev.aaRollingMetrics')"
            :hint="t('strategyDev.hintRollingMetrics')"
            chart-id="bt-rolling-metrics"
          >
            <RollingMetricsChart :metrics="data.rolling_metrics as any" />
            <template #fullscreen>
              <RollingMetricsChart :metrics="data.rolling_metrics as any" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />

          <ChartWrapper
            v-if="data.hourly_pattern"
            :title="t('strategyDev.btHourlyPattern')"
            :hint="t('strategyDev.hintBtHourlyPattern')"
            chart-id="bt-hourly-pattern"
          >
            <HourlyPatternChart :data="data.hourly_pattern as any" />
            <template #fullscreen>
              <HourlyPatternChart :data="data.hourly_pattern as any" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />
        </div>
      </section>

      <!-- SECTION 4: TRADES -->
      <section id="bt-analyse-trades" class="analyse-section">
        <div class="section-header">
          <span class="section-num">4</span>
          <h3>{{ t('strategyDev.btNavTrades') }}</h3>
        </div>

        <div class="grid grid-cols-1 gap-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              v-if="data.trade_pnl_distribution"
              :title="t('strategyDev.aaTradePnl')"
              :hint="t('strategyDev.hintTradePnl')"
              chart-id="bt-trade-pnl"
            >
              <TradePnlChart :distribution="data.trade_pnl_distribution as any" />
              <template #fullscreen>
                <TradePnlChart :distribution="data.trade_pnl_distribution as any" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />

            <ChartWrapper
              v-if="data.duration_scatter"
              :title="t('strategyDev.aaDurationScatter')"
              :hint="t('strategyDev.hintDurationScatter')"
              chart-id="bt-duration-scatter"
            >
              <DurationScatterChart :points="data.duration_scatter as any[]" />
              <template #fullscreen>
                <DurationScatterChart :points="data.duration_scatter as any[]" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              v-if="data.exit_reason_detail"
              :title="t('strategyDev.aaExitReasons')"
              :hint="t('strategyDev.hintExitReasons')"
              chart-id="bt-exit-reasons"
            >
              <ExitReasonChart :reasons="data.exit_reason_detail as any[]" />
              <template #fullscreen>
                <ExitReasonChart :reasons="data.exit_reason_detail as any[]" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />

            <ChartWrapper
              v-if="data.streaks"
              :title="t('strategyDev.aaStreaks')"
              :hint="t('strategyDev.hintStreaks')"
              chart-id="bt-streaks"
            >
              <StreaksCard :streaks="data.streaks as any" />
            </ChartWrapper>
            <ChartEmptyState v-else />
          </div>

          <ChartWrapper
            v-if="data.trade_expectancy"
            :title="t('strategyDev.aaExpectancy')"
            :hint="t('strategyDev.hintExpectancy')"
            chart-id="bt-expectancy"
          >
            <ExpectancyCard :data="data.trade_expectancy as any" />
          </ChartWrapper>
          <ChartEmptyState v-else />

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartWrapper
              v-if="data.return_distribution_fit"
              :title="t('strategyDev.aaReturnDistribution')"
              :hint="t('strategyDev.hintReturnDistribution')"
              chart-id="bt-return-dist"
            >
              <ReturnDistributionChart :data="data.return_distribution_fit as any" />
              <template #fullscreen>
                <ReturnDistributionChart :data="data.return_distribution_fit as any" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />

            <ChartWrapper
              v-if="data.mae_mfe"
              :title="t('strategyDev.aaMaeMfe')"
              :hint="t('strategyDev.hintMaeMfe')"
              chart-id="bt-mae-mfe"
            >
              <MaeMfeScatter :points="data.mae_mfe as any[]" />
              <template #fullscreen>
                <MaeMfeScatter :points="data.mae_mfe as any[]" />
              </template>
            </ChartWrapper>
            <ChartEmptyState v-else />
          </div>
        </div>
      </section>

      <!-- SECTION 5: RISK -->
      <section id="bt-analyse-risk" class="analyse-section">
        <div class="section-header">
          <span class="section-num">5</span>
          <h3>{{ t('strategyDev.btNavRisk') }}</h3>
        </div>

        <RiskMetricsCard v-if="data.risk_metrics" :metrics="data.risk_metrics as any" class="mb-4" />

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper
            v-if="data.long_short_split"
            :title="t('strategyDev.aaLongShort')"
            :hint="t('strategyDev.hintLongShort')"
            chart-id="bt-long-short"
          >
            <LongShortCard :split="data.long_short_split as any" />
          </ChartWrapper>
          <ChartEmptyState v-else />

          <ChartWrapper
            v-if="data.exposure_timeline"
            :title="t('strategyDev.aaExposure')"
            :hint="t('strategyDev.hintExposure')"
            chart-id="bt-exposure"
          >
            <ExposureChart :timeline="data.exposure_timeline as any[]" />
            <template #fullscreen>
              <ExposureChart :timeline="data.exposure_timeline as any[]" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />
        </div>

        <ChartWrapper
          v-if="data.capital_utilization"
          :title="t('strategyDev.btCapitalUtilization')"
          :hint="t('strategyDev.hintBtCapitalUtilization')"
          chart-id="bt-capital-util"
          class="mt-4"
        >
          <CapitalUtilizationChart :data="data.capital_utilization as any[]" />
          <template #fullscreen>
            <CapitalUtilizationChart :data="data.capital_utilization as any[]" />
          </template>
        </ChartWrapper>
        <ChartEmptyState v-else class="mt-4" />
      </section>

      <!-- SECTION 6: CONSISTENCY -->
      <section id="bt-analyse-consistency" class="analyse-section">
        <div class="section-header">
          <span class="section-num">6</span>
          <h3>{{ t('strategyDev.btNavConsistency') }}</h3>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper
            v-if="data.rolling_winrate"
            :title="t('strategyDev.aaRollingWinrate')"
            :hint="t('strategyDev.hintRollingWinrate')"
            chart-id="bt-rolling-winrate"
          >
            <RollingWinrateChart :data="data.rolling_winrate as any[]" />
            <template #fullscreen>
              <RollingWinrateChart :data="data.rolling_winrate as any[]" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />

          <ChartWrapper
            v-if="data.rolling_profit_factor"
            :title="t('strategyDev.aaRollingProfitFactor')"
            :hint="t('strategyDev.hintRollingProfitFactor')"
            chart-id="bt-rolling-pf"
          >
            <RollingProfitFactorChart :data="data.rolling_profit_factor as any[]" />
            <template #fullscreen>
              <RollingProfitFactorChart :data="data.rolling_profit_factor as any[]" />
            </template>
          </ChartWrapper>
          <ChartEmptyState v-else />
        </div>

        <ChartWrapper
          v-if="data.weekday_pattern"
          :title="t('strategyDev.aaWeekdayPattern')"
          :hint="t('strategyDev.hintWeekdayPattern')"
          chart-id="bt-weekday-pattern"
          class="mt-4"
        >
          <WeekdayPatternChart :pattern="data.weekday_pattern as any" />
          <template #fullscreen>
            <WeekdayPatternChart :pattern="data.weekday_pattern as any" />
          </template>
        </ChartWrapper>
        <ChartEmptyState v-else class="mt-4" />
      </section>

      <!-- SECTION 7: PAIRS -->
      <section id="bt-analyse-pairs" class="analyse-section">
        <div class="section-header">
          <span class="section-num">7</span>
          <h3>{{ t('strategyDev.btNavPairs') }}</h3>
        </div>

        <ChartWrapper
          v-if="data.pair_heatmap"
          :title="t('strategyDev.btPairHeatmap')"
          :hint="t('strategyDev.hintBtPairHeatmap')"
          chart-id="bt-pair-heatmap"
        >
          <PairHeatmapChart :data="data.pair_heatmap as any[]" />
        </ChartWrapper>
        <ChartEmptyState v-else />
      </section>

      <!-- SECTION 8: CONFIG -->
      <section id="bt-analyse-config" class="analyse-section">
        <div class="section-header">
          <span class="section-num">8</span>
          <h3>{{ t('strategyDev.btNavConfig') }}</h3>
        </div>

        <BacktestConfigCard v-if="summary" :summary="summary" />
      </section>
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

.scorecard-tag {
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
  background: rgba(137, 180, 250, 0.12);
}

.analyse-section {
  padding: 1.25rem 0;
  border-top: 1px solid rgba(69, 71, 90, 0.3);
}

.analyse-section:first-of-type {
  border-top: none;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-bottom: 1rem;
}

.section-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.375rem;
  background: rgba(137, 180, 250, 0.1);
  color: #89b4fa;
  font-size: 11px;
  font-weight: 700;
}

.section-header h3 {
  font-size: 14px;
  font-weight: 600;
  color: #cdd6f4;
  margin: 0;
}
</style>
