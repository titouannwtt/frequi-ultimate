<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RunType } from '@/types';
import type { JobStartRequest } from '@/types';
import { buildPrefillFromLiveBot } from '@/utils/reconstitute';

const { t } = useI18n();
const store = useStrategyDevStore();
const botStore = useBotStore();

const emit = defineEmits<{
  reconstitute: [prefill: Partial<JobStartRequest>];
}>();

const run = computed(() => store.selectedRun);
const data = computed(() => store.backtestAnalysis);
const summary = computed(() => (data.value?.backtest_summary as Record<string, unknown>) ?? null);

const subStore = computed(() => {
  const botId = run.value?.botId;
  if (!botId) return null;
  return botStore.botStores[botId] ?? null;
});

const botState = computed(() => subStore.value?.botState ?? null);

const simulatedCount = computed(() => (data.value?.simulated_close_count as number) ?? 0);

function refreshAnalytics() {
  if (run.value?.botId) {
    store.buildLiveBotAnalyticsForRun(run.value.botId);
  }
}

function fmtPct(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  return v.toFixed(decimals);
}

const botInfo = computed(() => {
  const items: { label: string; value: string; color?: string }[] = [];
  const s = botState.value;
  if (!s) return items;

  items.push({ label: t('strategyDev.liveExchange'), value: s.exchange || '—' });
  items.push({
    label: t('strategyDev.liveMode'),
    value: s.dry_run ? t('strategyDev.liveDryRun') : t('strategyDev.liveReal'),
    color: s.dry_run ? 'var(--sd-warning)' : 'var(--sd-success)',
  });
  items.push({ label: t('strategyDev.liveTimeframe'), value: s.timeframe || '—' });
  items.push({ label: t('strategyDev.liveMaxTrades'), value: String(s.max_open_trades ?? '—') });

  return items;
});

function handleBacktestFromLive() {
  const s = botState.value;
  const r = run.value;
  const sub = subStore.value;
  if (!s || !r || !sub) return;

  const profit = sub.profitAll?.all;
  const prefill = buildPrefillFromLiveBot({
    strategy: s.strategy || r.strategy,
    timeframe: s.timeframe,
    maxOpenTrades: s.max_open_trades,
    stakeAmount: String(s.stake_amount),
    dryRunWallet: sub.balance?.starting_capital ?? null,
    firstTradeTimestamp: profit?.first_trade_timestamp ?? null,
    pairs: sub.whitelist?.length ? sub.whitelist : undefined,
  });

  emit('reconstitute', prefill);
}

const summaryStats = computed(() => {
  const items: { label: string; value: string; color?: string }[] = [];
  const s = summary.value;
  if (!s) return items;

  if (s.total_profit_pct != null) {
    const v = s.total_profit_pct as number;
    items.push({
      label: t('strategyDev.totalProfit'),
      value: fmtPct(v),
      color: v >= 0 ? 'var(--sd-success)' : 'var(--sd-danger)',
    });
  }
  if (s.total_trades != null) {
    items.push({ label: t('strategyDev.totalTrades'), value: String(s.total_trades) });
  }
  if (s.winrate != null) {
    items.push({
      label: t('strategyDev.btScorecardWinrate'),
      value: fmtPct((s.winrate as number) * 100, 1),
    });
  }
  if (s.profit_factor != null) {
    items.push({
      label: 'Profit Factor',
      value: fmtNum(s.profit_factor as number),
      color: (s.profit_factor as number) >= 1 ? 'var(--sd-success)' : 'var(--sd-danger)',
    });
  }
  if (s.sharpe != null) {
    items.push({ label: 'Sharpe', value: fmtNum(s.sharpe as number, 3) });
  }
  if (s.max_drawdown_account != null) {
    items.push({
      label: t('strategyDev.btScorecardDD'),
      value: fmtPct(s.max_drawdown_account as number, 1),
      color: 'var(--sd-danger)',
    });
  }
  if (s.final_balance != null && s.starting_balance != null) {
    items.push({
      label: t('strategyDev.btFinalBalance'),
      value: `${fmtNum(s.final_balance as number)} ${s.stake_currency ?? ''}`,
    });
  }

  return items;
});
</script>

<template>
  <div class="live-overview">
    <!-- Simulated close banner -->
    <div v-if="simulatedCount > 0" class="live-sim-banner">
      <i-mdi-information-outline class="w-4 h-4" />
      <span>
        {{ t('strategyDev.liveSimBanner', { count: simulatedCount }) }}
      </span>
      <button class="live-refresh-btn" @click="refreshAnalytics">
        <i-mdi-refresh class="w-4 h-4" />
        {{ t('strategyDev.liveRefresh') }}
      </button>
    </div>

    <!-- Bot info -->
    <div v-if="botInfo.length" class="live-section">
      <h3 class="live-section-title">
        <i-mdi-robot class="w-4 h-4" />
        {{ t('strategyDev.liveBotInfo') }}
      </h3>
      <div class="live-info-grid">
        <div v-for="item in botInfo" :key="item.label" class="live-info-item">
          <span class="live-info-label">{{ item.label }}</span>
          <span class="live-info-value" :style="item.color ? { color: item.color } : undefined">
            {{ item.value }}
          </span>
        </div>
      </div>
    </div>

    <!-- Summary stats -->
    <div v-if="summaryStats.length" class="live-section">
      <h3 class="live-section-title">
        <i-mdi-chart-box class="w-4 h-4" />
        {{ t('strategyDev.liveSummary') }}
      </h3>
      <div class="live-stats-grid">
        <div v-for="stat in summaryStats" :key="stat.label" class="live-stat">
          <span class="live-stat-label">{{ stat.label }}</span>
          <span class="live-stat-value" :style="stat.color ? { color: stat.color } : undefined">
            {{ stat.value }}
          </span>
        </div>
      </div>
    </div>

    <!-- Backtest from live -->
    <div v-if="botState" class="live-section">
      <div class="cmd-reconstitute">
        <button class="cmd-reconstitute-btn" @click="handleBacktestFromLive">
          <i-mdi-flask-outline class="w-4 h-4" />
          {{ t('strategyDev.liveBacktest') }}
        </button>
        <span class="cmd-reconstitute-hint">{{ t('strategyDev.liveBacktestHint') }}</span>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!data || data.empty" class="live-empty">
      <i-mdi-chart-line class="w-8 h-8" />
      <p>{{ t('strategyDev.liveNoTrades') }}</p>
    </div>
  </div>
</template>

<style scoped>
.live-overview {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0;
}

.live-sim-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--sd-info-dim);
  border: 1px solid rgba(137, 180, 250, 0.25);
  border-radius: var(--sd-radius-md);
  font-size: var(--sd-text-xs);
  color: var(--sd-info);
}

.live-refresh-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 4px 10px;
  font-size: var(--sd-text-xs);
  font-weight: 500;
  border: 1px solid rgba(137, 180, 250, 0.3);
  border-radius: var(--sd-radius-sm);
  background: transparent;
  color: var(--sd-info);
  cursor: pointer;
  transition: all 150ms;
}

.live-refresh-btn:hover {
  background: rgba(137, 180, 250, 0.15);
}

.live-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.live-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--sd-text-sm);
  font-weight: 600;
  color: var(--sd-text);
  margin: 0;
}

.live-info-grid {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.live-info-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 16px;
  background: var(--sd-surface0);
  border-radius: var(--sd-radius-sm);
  min-width: 80px;
}

.live-info-label {
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sd-overlay);
}

.live-info-value {
  font-size: var(--sd-text-sm);
  font-weight: 700;
  font-family: var(--sd-font-mono);
  color: var(--sd-text);
}

.live-stats-grid {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.live-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 16px;
  background: var(--sd-surface0);
  border-radius: var(--sd-radius-sm);
  min-width: 80px;
}

.live-stat-label {
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sd-overlay);
}

.live-stat-value {
  font-size: var(--sd-text-sm);
  font-weight: 700;
  font-family: var(--sd-font-mono);
  color: var(--sd-text);
}

.live-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--sd-overlay);
  font-size: var(--sd-text-sm);
}

.cmd-reconstitute {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cmd-reconstitute-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: var(--sd-radius-md);
  border: 1px solid rgba(137, 180, 250, 0.25);
  background: rgba(137, 180, 250, 0.08);
  color: #89b4fa;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.cmd-reconstitute-btn:hover {
  background: rgba(137, 180, 250, 0.15);
  border-color: rgba(137, 180, 250, 0.4);
}

.cmd-reconstitute-hint {
  font-size: 11px;
  color: var(--sd-overlay);
}
</style>
