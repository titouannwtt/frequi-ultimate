<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();
const epochData = ref<Record<string, unknown> | null>(null);
const epochLoading = ref(false);

const topEpochs = computed(() => {
  const a = store.hyperoptAnalysis;
  if (!a) return [];
  const top = a.top_epochs as Array<Record<string, unknown>> | undefined;
  return top?.slice(0, 10) ?? [];
});

const selectedRank = computed({
  get: () => store.selectedEpochRank,
  set: (v) => { store.selectedEpochRank = v; },
});

async function loadEpoch(rank: number) {
  selectedRank.value = rank;
  const filename = store.selectedRun?.filename;
  if (!filename) return;
  epochLoading.value = true;
  try {
    epochData.value = await store.fetchEpochAdvancedAnalytics(filename, rank);
  } finally {
    epochLoading.value = false;
  }
}

onMounted(() => {
  if (topEpochs.value.length > 0) {
    loadEpoch(selectedRank.value);
  }
});

watch(topEpochs, (v) => {
  if (v.length > 0 && !epochData.value) loadEpoch(selectedRank.value);
});

const epochInfo = computed(() => epochData.value?.epoch_info as Record<string, unknown> | undefined);

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
  <div class="epoch-panel">
    <!-- ═══ EPOCH SELECTOR ═══ -->
    <div v-if="topEpochs.length > 0" class="epoch-selector">
      <span class="epoch-selector-label">{{ t('strategyDev.epochSelectorLabel') }}</span>
      <div class="epoch-pills">
        <button
          v-for="ep in topEpochs"
          :key="(ep.rank as number)"
          class="epoch-pill"
          :class="{
            active: selectedRank === ep.rank,
            positive: (ep.profit_pct as number) > 0,
            negative: (ep.profit_pct as number) <= 0,
          }"
          @click="loadEpoch(ep.rank as number)"
        >
          <span class="ep-rank">#{{ ep.rank }}</span>
          <span class="ep-profit">{{ (ep.profit_pct as number) >= 0 ? '+' : '' }}{{ (ep.profit_pct as number).toFixed(1) }}%</span>
        </button>
      </div>
    </div>

    <!-- ═══ LOADING ═══ -->
    <div v-if="epochLoading" class="py-6">
      <SkeletonPanel variant="cards" :cols="4" />
      <SkeletonPanel variant="chart" class="mt-4" />
    </div>

    <!-- ═══ EPOCH CONTENT ═══ -->
    <template v-else-if="epochData && epochInfo">
      <!-- Scorecard -->
      <div class="scorecard">
        <div class="scorecard-badge">
          <i-mdi-numeric class="w-3.5 h-3.5" />
          Epoch #{{ epochInfo.current_epoch ?? selectedRank }}
          <span class="scorecard-rank">Rank {{ selectedRank }}</span>
        </div>
        <div class="scorecard-metrics">
          <div class="sc-metric">
            <span class="sc-label">{{ t('strategyDev.totalProfit') }}</span>
            <span class="sc-value" :class="Number(epochInfo.total_profit) >= 0 ? 'sc-pos' : 'sc-neg'">
              {{ fmtPct(epochInfo.total_profit) }}
            </span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">{{ t('strategyDev.totalTrades') }}</span>
            <span class="sc-value">{{ epochInfo.total_trades }}</span>
          </div>
          <div class="sc-metric">
            <span class="sc-label">{{ t('strategyDev.btScorecardDD') }}</span>
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
            <span class="sc-label">{{ t('strategyDev.btScorecardWinrate') }}</span>
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

      <!-- Charts grid -->
      <div class="grid grid-cols-1 gap-4 mt-4">
        <!-- Equity + Underwater -->
        <ChartWrapper
          v-if="epochData.equity_curve"
          :title="t('strategyDev.aaEquityCurve')"
          :hint="t('strategyDev.hintEquityCurve')"
          chart-id="epoch-equity"
        >
          <EquityCurveChart
            :equity="epochData.equity_curve as any[]"
            :starting-balance="(epochData.starting_balance as number) ?? 1000"
          />
          <template #fullscreen>
            <EquityCurveChart
              :equity="epochData.equity_curve as any[]"
              :starting-balance="(epochData.starting_balance as number) ?? 1000"
            />
          </template>
        </ChartWrapper>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper
            v-if="epochData.drawdown_series"
            :title="t('strategyDev.aaUnderwaterPlot')"
            :hint="t('strategyDev.hintUnderwater')"
            chart-id="epoch-underwater"
          >
            <UnderwaterChart :series="epochData.drawdown_series as any[]" />
            <template #fullscreen>
              <UnderwaterChart :series="epochData.drawdown_series as any[]" />
            </template>
          </ChartWrapper>

          <ChartWrapper
            v-if="epochData.cumulative_trades"
            :title="t('strategyDev.aaCumulativeTrades')"
            :hint="t('strategyDev.hintCumulativeTrades')"
            chart-id="epoch-cumulative"
          >
            <CumulativeTradesChart :trades="epochData.cumulative_trades as any[]" />
            <template #fullscreen>
              <CumulativeTradesChart :trades="epochData.cumulative_trades as any[]" />
            </template>
          </ChartWrapper>
        </div>

        <!-- New charts: Return Distribution, Drawdown Calendar, MAE/MFE -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper
            v-if="epochData.return_distribution_fit"
            :title="t('strategyDev.aaReturnDistribution')"
            :hint="t('strategyDev.hintReturnDistribution')"
            chart-id="epoch-return-dist"
          >
            <ReturnDistributionChart :data="epochData.return_distribution_fit as any" />
            <template #fullscreen>
              <ReturnDistributionChart :data="epochData.return_distribution_fit as any" />
            </template>
          </ChartWrapper>

          <ChartWrapper
            v-if="epochData.mae_mfe"
            :title="t('strategyDev.aaMaeMfe')"
            :hint="t('strategyDev.hintMaeMfe')"
            chart-id="epoch-mae-mfe"
          >
            <MaeMfeScatter :points="epochData.mae_mfe as any[]" />
            <template #fullscreen>
              <MaeMfeScatter :points="epochData.mae_mfe as any[]" />
            </template>
          </ChartWrapper>
        </div>

        <ChartWrapper
          v-if="epochData.drawdown_calendar"
          :title="t('strategyDev.aaDrawdownCalendar')"
          :hint="t('strategyDev.hintDrawdownCalendar')"
          chart-id="epoch-dd-calendar"
        >
          <DrawdownCalendarChart :data="epochData.drawdown_calendar as any[]" />
          <template #fullscreen>
            <DrawdownCalendarChart :data="epochData.drawdown_calendar as any[]" />
          </template>
        </ChartWrapper>

        <!-- Monthly returns -->
        <ChartWrapper
          v-if="epochData.monthly_returns"
          :title="t('strategyDev.aaMonthlyReturns')"
          :hint="t('strategyDev.hintMonthlyReturns')"
          chart-id="epoch-monthly"
        >
          <MonthlyReturnsHeatmap :data="epochData.monthly_returns as any[]" />
          <template #fullscreen>
            <MonthlyReturnsHeatmap :data="epochData.monthly_returns as any[]" />
          </template>
        </ChartWrapper>

        <!-- Trade analysis -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper
            v-if="epochData.trade_pnl_distribution"
            :title="t('strategyDev.aaTradePnl')"
            :hint="t('strategyDev.hintTradePnl')"
            chart-id="epoch-pnl"
          >
            <TradePnlChart :distribution="epochData.trade_pnl_distribution as any" />
            <template #fullscreen>
              <TradePnlChart :distribution="epochData.trade_pnl_distribution as any" />
            </template>
          </ChartWrapper>

          <ChartWrapper
            v-if="epochData.duration_scatter"
            :title="t('strategyDev.aaDurationScatter')"
            :hint="t('strategyDev.hintDurationScatter')"
            chart-id="epoch-duration"
          >
            <DurationScatterChart :points="epochData.duration_scatter as any[]" />
            <template #fullscreen>
              <DurationScatterChart :points="epochData.duration_scatter as any[]" />
            </template>
          </ChartWrapper>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper
            v-if="epochData.exit_reason_detail"
            :title="t('strategyDev.aaExitReasons')"
            :hint="t('strategyDev.hintExitReasons')"
            chart-id="epoch-exit"
          >
            <ExitReasonChart :reasons="epochData.exit_reason_detail as any[]" />
            <template #fullscreen>
              <ExitReasonChart :reasons="epochData.exit_reason_detail as any[]" />
            </template>
          </ChartWrapper>

          <ChartWrapper
            v-if="epochData.weekday_pattern"
            :title="t('strategyDev.aaWeekdayPattern')"
            :hint="t('strategyDev.hintWeekdayPattern')"
            chart-id="epoch-weekday"
          >
            <WeekdayPatternChart :pattern="epochData.weekday_pattern as any" />
            <template #fullscreen>
              <WeekdayPatternChart :pattern="epochData.weekday_pattern as any" />
            </template>
          </ChartWrapper>
        </div>

        <!-- Risk & Structure -->
        <RiskMetricsCard v-if="epochData.risk_metrics" :metrics="epochData.risk_metrics as any" />

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper
            v-if="epochData.long_short_split"
            :title="t('strategyDev.aaLongShort')"
            :hint="t('strategyDev.hintLongShort')"
            chart-id="epoch-ls"
          >
            <LongShortCard :split="epochData.long_short_split as any" />
          </ChartWrapper>

          <ChartWrapper
            v-if="epochData.trade_expectancy"
            :title="t('strategyDev.aaExpectancy')"
            :hint="t('strategyDev.hintExpectancy')"
            chart-id="epoch-expectancy"
          >
            <ExpectancyCard :data="epochData.trade_expectancy as any" />
          </ChartWrapper>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper
            v-if="epochData.rolling_winrate"
            :title="t('strategyDev.aaRollingWinrate')"
            :hint="t('strategyDev.hintRollingWinrate')"
            chart-id="epoch-rwr"
          >
            <RollingWinrateChart :data="epochData.rolling_winrate as any[]" />
            <template #fullscreen>
              <RollingWinrateChart :data="epochData.rolling_winrate as any[]" />
            </template>
          </ChartWrapper>

          <ChartWrapper
            v-if="epochData.rolling_profit_factor"
            :title="t('strategyDev.aaRollingProfitFactor')"
            :hint="t('strategyDev.hintRollingProfitFactor')"
            chart-id="epoch-rpf"
          >
            <RollingProfitFactorChart :data="epochData.rolling_profit_factor as any[]" />
            <template #fullscreen>
              <RollingProfitFactorChart :data="epochData.rolling_profit_factor as any[]" />
            </template>
          </ChartWrapper>
        </div>

        <ChartWrapper
          v-if="epochData.exposure_timeline"
          :title="t('strategyDev.aaExposure')"
          :hint="t('strategyDev.hintExposure')"
          chart-id="epoch-exposure"
        >
          <ExposureChart :timeline="epochData.exposure_timeline as any[]" />
          <template #fullscreen>
            <ExposureChart :timeline="epochData.exposure_timeline as any[]" />
          </template>
        </ChartWrapper>

        <ChartWrapper
          v-if="epochData.streaks"
          :title="t('strategyDev.aaStreaks')"
          :hint="t('strategyDev.hintStreaks')"
          chart-id="epoch-streaks"
        >
          <StreaksCard :streaks="epochData.streaks as any" />
        </ChartWrapper>
      </div>
    </template>

    <!-- Empty state -->
    <div v-else-if="!epochLoading" class="epoch-empty">
      <i-mdi-chart-box-outline class="w-8 h-8 opacity-30" />
      <p>{{ t('strategyDev.epochSelectPrompt') }}</p>
    </div>
  </div>
</template>

<style scoped>
.epoch-panel {
  padding: 0.75rem 0;
}

/* ── Epoch selector ── */
.epoch-selector {
  margin-bottom: 1rem;
}

.epoch-selector-label {
  display: block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6c7086;
  margin-bottom: 0.5rem;
}

.epoch-pills {
  display: flex;
  gap: 0.375rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
  scrollbar-width: none;
}

.epoch-pills::-webkit-scrollbar {
  display: none;
}

.epoch-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: rgba(49, 50, 68, 0.5);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  min-width: 64px;
}

.epoch-pill:hover {
  background: rgba(69, 71, 90, 0.6);
}

.epoch-pill.active {
  background: rgba(137, 180, 250, 0.12);
  border-color: rgba(137, 180, 250, 0.3);
}

.ep-rank {
  font-size: 10px;
  font-weight: 700;
  color: #6c7086;
}

.epoch-pill.active .ep-rank {
  color: #89b4fa;
}

.ep-profit {
  font-family: var(--sd-font-mono);
  font-size: 12px;
  font-weight: 600;
}

.epoch-pill.positive .ep-profit {
  color: #a6e3a1;
}

.epoch-pill.negative .ep-profit {
  color: #f38ba8;
}

/* ── Scorecard ── */
.scorecard {
  padding: 0.875rem 1.25rem;
  border-radius: 0.75rem;
  background: rgba(137, 180, 250, 0.05);
  border: 1px solid rgba(137, 180, 250, 0.12);
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

.scorecard-rank {
  font-family: var(--sd-font-mono);
  font-size: 10px;
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
  font-size: 13px;
  font-weight: 700;
  color: #cdd6f4;
}

.sc-pos { color: #a6e3a1; }
.sc-neg { color: #f38ba8; }

/* ── Empty ── */
.epoch-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 3rem;
  color: #6c7086;
  text-align: center;
}
</style>
