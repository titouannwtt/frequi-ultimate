<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  summary: Record<string, unknown>;
  orderStats?: {
    rejected_signals: number;
    timedout_entry_orders: number;
    timedout_exit_orders: number;
    canceled_trade_entries: number;
  };
}>();

function fmtPct(v: unknown): string {
  const n = Number(v);
  if (isNaN(n)) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
}

function fmtNum(v: unknown, d = 2): string {
  const n = Number(v);
  if (isNaN(n)) return '—';
  return n.toFixed(d);
}

const cards = computed(() => {
  const s = props.summary;
  const result: Array<{ label: string; value: string; sub?: string; color?: string }> = [];

  if (s.best_pair) {
    result.push({ label: t('strategyDev.btBestPair'), value: String(s.best_pair), color: 'green' });
  }
  if (s.worst_pair) {
    result.push({ label: t('strategyDev.btWorstPair'), value: String(s.worst_pair), color: 'red' });
  }
  if (s.trades_per_day != null) {
    result.push({ label: t('strategyDev.btTradesPerDay'), value: fmtNum(s.trades_per_day, 1) });
  }
  if (s.market_change != null) {
    const mc = Number(s.market_change);
    result.push({
      label: t('strategyDev.btMarketChange'),
      value: fmtPct(s.market_change),
      color: mc >= 0 ? 'green' : 'red',
    });
  }

  const w = s.winning_days;
  const l = s.losing_days;
  const d = s.draw_days;
  if (w != null || l != null) {
    result.push({
      label: t('strategyDev.btWinLossDays'),
      value: `${w ?? 0}W / ${l ?? 0}L / ${d ?? 0}D`,
    });
  }

  if (s.holding_avg) {
    result.push({ label: t('strategyDev.btHoldingAvg'), value: String(s.holding_avg) });
  }
  if (s.winner_holding_avg) {
    result.push({
      label: t('strategyDev.btWinnerHolding'),
      value: String(s.winner_holding_avg),
      color: 'green',
    });
  }
  if (s.loser_holding_avg) {
    result.push({
      label: t('strategyDev.btLoserHolding'),
      value: String(s.loser_holding_avg),
      color: 'red',
    });
  }

  if (s.sqn != null) result.push({ label: 'SQN', value: fmtNum(s.sqn) });
  if (s.cagr != null) result.push({ label: 'CAGR', value: fmtPct(s.cagr) });
  if (s.expectancy != null) result.push({ label: t('strategyDev.btExpectancy'), value: fmtNum(s.expectancy, 4) });
  if (s.expectancy_ratio != null) result.push({ label: t('strategyDev.btExpectancyRatio'), value: fmtNum(s.expectancy_ratio) });

  return result;
});

const orderCards = computed(() => {
  if (!props.orderStats) return [];
  const os = props.orderStats;
  const result: Array<{ label: string; value: number; warn: boolean }> = [];
  result.push({ label: t('strategyDev.btRejectedSignals'), value: os.rejected_signals, warn: os.rejected_signals > 0 });
  result.push({ label: t('strategyDev.btTimedoutEntry'), value: os.timedout_entry_orders, warn: os.timedout_entry_orders > 0 });
  result.push({ label: t('strategyDev.btTimedoutExit'), value: os.timedout_exit_orders, warn: os.timedout_exit_orders > 0 });
  result.push({ label: t('strategyDev.btCanceledEntries'), value: os.canceled_trade_entries, warn: os.canceled_trade_entries > 0 });
  return result;
});
</script>

<template>
  <div class="summary-grid">
    <!-- Main metrics -->
    <div class="cards-grid">
      <div
        v-for="(card, i) in cards"
        :key="i"
        class="summary-card"
      >
        <span class="card-label">{{ card.label }}</span>
        <span
          class="card-value"
          :class="{
            'text-green': card.color === 'green',
            'text-red': card.color === 'red',
          }"
        >
          {{ card.value }}
        </span>
        <span v-if="card.sub" class="card-sub">{{ card.sub }}</span>
      </div>
    </div>

    <!-- Order stats -->
    <div v-if="orderCards.length > 0" class="order-stats">
      <h4 class="order-title">{{ t('strategyDev.btOrderStats') }}</h4>
      <div class="order-grid">
        <div
          v-for="(oc, i) in orderCards"
          :key="i"
          class="order-card"
          :class="{ 'order-warn': oc.warn }"
        >
          <span class="order-value">{{ oc.value }}</span>
          <span class="order-label">{{ oc.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.summary-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.5rem;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: rgba(30, 30, 46, 0.5);
  border: 1px solid rgba(69, 71, 90, 0.25);
}

.card-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6c7086;
}

.card-value {
  font-family: var(--sd-font-mono);
  font-size: 14px;
  font-weight: 700;
  color: #cdd6f4;
}

.card-sub {
  font-size: 10px;
  color: #6c7086;
}

.text-green { color: #a6e3a1; }
.text-red { color: #f38ba8; }

.order-stats {
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: rgba(30, 30, 46, 0.3);
  border: 1px solid rgba(69, 71, 90, 0.2);
}

.order-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6c7086;
  margin: 0 0 0.5rem 0;
}

.order-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.375rem;
}

.order-card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-radius: 0.375rem;
  background: rgba(69, 71, 90, 0.15);
}

.order-card.order-warn {
  background: rgba(250, 179, 135, 0.08);
  border: 1px solid rgba(250, 179, 135, 0.15);
}

.order-value {
  font-family: var(--sd-font-mono);
  font-size: 14px;
  font-weight: 700;
  color: #cdd6f4;
}

.order-warn .order-value {
  color: #fab387;
}

.order-label {
  font-size: 10px;
  color: #6c7086;
}
</style>
