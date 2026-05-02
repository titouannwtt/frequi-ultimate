<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useBtcBenchmark } from '@/composables/useBtcBenchmark';

const { t } = useI18n();
const store = useStrategyDevStore();
const loading = ref(true);

onMounted(async () => {
  if (!store.advancedAnalytics && store.selectedRun) {
    await store.fetchAdvancedAnalytics(store.selectedRun.filename);
  }
  loading.value = false;
});

const data = computed(() => store.advancedAnalytics);

const btcEquityInput = computed(() => data.value?.equity_curve as { date: string; balance: number }[] | undefined);
const btcStartBal = computed(() => (data.value?.starting_balance as number) ?? 1000);
const { benchmarkEquity: btcBenchmark } = useBtcBenchmark(btcEquityInput, btcStartBal);
const epochInfo = computed(() => (data.value?.epoch_info as Record<string, unknown>) ?? null);

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

// Section offset: continues from HyperoptChartsPanel sections
// HyperoptChartsPanel has max 5 sections (with overfit warnings)
// We start at 6 (or 5 without overfit warnings). Use fixed offset since
// we can't know the exact count from here — use a letter-based system instead.
</script>

<template>
  <div class="aa-panel">
    <!-- Loading state -->
    <div v-if="loading" class="aa-loading">
      <div class="sd-loading-spinner" />
      <p>{{ t('strategyDev.aaLoadingAnalytics') }}</p>
    </div>

    <template v-else-if="data && !data.error">
      <!-- ═══ EPOCH CONTEXT BANNER ═══ -->
      <div v-if="epochInfo" class="aa-epoch-banner">
        <div class="aa-epoch-title">
          <i-mdi-trophy class="w-4 h-4" />
          <span>{{ t('strategyDev.aaBestEpochBanner') }}</span>
          <span v-if="epochInfo.current_epoch" class="aa-epoch-num">#{{ epochInfo.current_epoch }}</span>
        </div>
        <div class="aa-epoch-stats">
          <div class="aa-epoch-stat">
            <span class="aa-epoch-stat-label">Profit</span>
            <span
              class="aa-epoch-stat-value"
              :class="Number(epochInfo.total_profit) >= 0 ? 'aa-stat-pos' : 'aa-stat-neg'"
            >{{ fmtPct(epochInfo.total_profit) }}</span>
          </div>
          <div class="aa-epoch-stat">
            <span class="aa-epoch-stat-label">Trades</span>
            <span class="aa-epoch-stat-value">{{ epochInfo.total_trades }}</span>
          </div>
          <div class="aa-epoch-stat">
            <span class="aa-epoch-stat-label">Drawdown</span>
            <span class="aa-epoch-stat-value aa-stat-neg">{{ fmtPct(epochInfo.max_drawdown) }}</span>
          </div>
          <div class="aa-epoch-stat">
            <span class="aa-epoch-stat-label">Sharpe</span>
            <span class="aa-epoch-stat-value">{{ fmtNum(epochInfo.sharpe) }}</span>
          </div>
          <div class="aa-epoch-stat">
            <span class="aa-epoch-stat-label">Sortino</span>
            <span class="aa-epoch-stat-value">{{ fmtNum(epochInfo.sortino) }}</span>
          </div>
          <div class="aa-epoch-stat">
            <span class="aa-epoch-stat-label">Win Rate</span>
            <span class="aa-epoch-stat-value">
              {{ typeof epochInfo.winrate === 'number' && epochInfo.winrate <= 1
                ? (Number(epochInfo.winrate) * 100).toFixed(1)
                : fmtNum(epochInfo.winrate, 1) }}%
            </span>
          </div>
          <div class="aa-epoch-stat">
            <span class="aa-epoch-stat-label">Loss</span>
            <span class="aa-epoch-stat-value">{{ fmtNum(epochInfo.loss, 4) }}</span>
          </div>
          <div class="aa-epoch-stat">
            <span class="aa-epoch-stat-label">Profit Factor</span>
            <span class="aa-epoch-stat-value">{{ fmtNum(epochInfo.profit_factor) }}</span>
          </div>
        </div>
      </div>

      <!-- ═══ SECTION A: EQUITY & DRAWDOWNS ═══ -->
      <div v-if="data.equity_curve || data.top_drawdowns" class="section">
        <div class="section-header">
          <span class="section-num">A</span>
          <h3>{{ t('strategyDev.aaSectionEquityDrawdowns') }}</h3>
        </div>

        <div class="grid grid-cols-1 gap-4">
          <ChartWrapper
            v-if="data.equity_curve"
            :title="t('strategyDev.aaEquityCurve')"
            :hint="t('strategyDev.hintEquityCurve')"
            chart-id="equity-curve"
          >
            <EquityCurveChart
              :equity="data.equity_curve as any[]"
              :starting-balance="(data.starting_balance as number) ?? 1000"
              :benchmark="btcBenchmark"
              benchmark-label="BTC"
            />
            <template #fullscreen>
              <EquityCurveChart
                :equity="data.equity_curve as any[]"
                :starting-balance="(data.starting_balance as number) ?? 1000"
              />
            </template>
          </ChartWrapper>

          <ChartWrapper
            v-if="data.drawdown_series"
            :title="t('strategyDev.aaUnderwaterPlot')"
            :hint="t('strategyDev.hintUnderwater')"
            chart-id="underwater-plot"
          >
            <UnderwaterChart :series="data.drawdown_series as any[]" />
            <template #fullscreen>
              <UnderwaterChart :series="data.drawdown_series as any[]" />
            </template>
          </ChartWrapper>

          <ChartWrapper
            v-if="data.top_drawdowns"
            :title="t('strategyDev.aaDrawdownDetails')"
            :hint="t('strategyDev.hintDrawdownDetails')"
            chart-id="drawdown-details"
          >
            <DrawdownDetailsCard :drawdowns="data.top_drawdowns as any[]" />
          </ChartWrapper>
        </div>
      </div>

      <!-- ═══ SECTION B: RETURNS ANALYSIS ═══ -->
      <div v-if="data.monthly_returns || data.rolling_metrics" class="section">
        <div class="section-header">
          <span class="section-num">B</span>
          <h3>{{ t('strategyDev.aaSectionReturns') }}</h3>
        </div>

        <div class="grid grid-cols-1 gap-4">
          <ChartWrapper
            v-if="data.monthly_returns"
            :title="t('strategyDev.aaMonthlyReturns')"
            :hint="t('strategyDev.hintMonthlyReturns')"
            chart-id="monthly-returns"
          >
            <MonthlyReturnsHeatmap :data="data.monthly_returns as any[]" />
            <template #fullscreen>
              <MonthlyReturnsHeatmap :data="data.monthly_returns as any[]" />
            </template>
          </ChartWrapper>

          <ChartWrapper
            v-if="data.rolling_metrics"
            :title="t('strategyDev.aaRollingMetrics')"
            :hint="t('strategyDev.hintRollingMetrics')"
            chart-id="rolling-metrics"
          >
            <RollingMetricsChart :metrics="data.rolling_metrics as any" />
            <template #fullscreen>
              <RollingMetricsChart :metrics="data.rolling_metrics as any" />
            </template>
          </ChartWrapper>
        </div>
      </div>

      <!-- ═══ SECTION C: TRADE ANALYSIS ═══ -->
      <div v-if="data.trade_pnl_distribution || data.streaks" class="section">
        <div class="section-header">
          <span class="section-num">C</span>
          <h3>{{ t('strategyDev.aaSectionTradeAnalysis') }}</h3>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartWrapper
            v-if="data.trade_pnl_distribution"
            :title="t('strategyDev.aaTradePnl')"
            :hint="t('strategyDev.hintTradePnl')"
            chart-id="trade-pnl"
          >
            <TradePnlChart :distribution="data.trade_pnl_distribution as any" />
            <template #fullscreen>
              <TradePnlChart :distribution="data.trade_pnl_distribution as any" />
            </template>
          </ChartWrapper>

          <ChartWrapper
            v-if="data.streaks"
            :title="t('strategyDev.aaStreaks')"
            :hint="t('strategyDev.hintStreaks')"
            chart-id="streaks"
          >
            <StreaksCard :streaks="data.streaks as any" />
          </ChartWrapper>
        </div>
      </div>

      <!-- ═══ SECTION D: RISK ASSESSMENT ═══ -->
      <div v-if="data.risk_metrics" class="section">
        <div class="section-header">
          <span class="section-num">D</span>
          <h3>{{ t('strategyDev.aaSectionRisk') }}</h3>
        </div>

        <RiskMetricsCard :metrics="data.risk_metrics as any" />
      </div>
    </template>

    <div v-else-if="data?.error" class="aa-error">
      <i-mdi-alert-circle class="w-8 h-8" />
      <p>{{ data.error }}</p>
    </div>
  </div>
</template>

<style scoped>
.aa-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
  max-width: 1600px;
  margin: 0 auto;
}

.aa-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--sd-overlay);
  font-size: var(--sd-text-sm);
}

.aa-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--sd-overlay);
}

/* ── Epoch context banner ── */
.aa-epoch-banner {
  padding: 1rem 1.25rem;
  border-radius: 0.75rem;
  background: rgba(137, 180, 250, 0.06);
  border: 1px solid rgba(137, 180, 250, 0.15);
  margin-bottom: 0.5rem;
}

.aa-epoch-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #89b4fa;
  font-size: var(--sd-text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 0.75rem;
}

.aa-epoch-num {
  font-family: var(--sd-font-mono);
  font-size: var(--sd-text-sm);
  color: #cdd6f4;
  background: rgba(137, 180, 250, 0.12);
  padding: 0.125rem 0.5rem;
  border-radius: 0.375rem;
}

.aa-epoch-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
}

.aa-epoch-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.aa-epoch-stat-label {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6c7086;
}

.aa-epoch-stat-value {
  font-family: var(--sd-font-mono);
  font-size: var(--sd-text-sm);
  font-weight: 700;
  color: #cdd6f4;
}

.aa-stat-pos { color: #a6e3a1; }
.aa-stat-neg { color: #f38ba8; }

/* ── Sections (matches HyperoptChartsPanel) ── */
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
