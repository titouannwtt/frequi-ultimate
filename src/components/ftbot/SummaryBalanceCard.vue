<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useExchangeRates } from '@/composables/exchangeRates';

const { t } = useI18n();

const botStore = useBotStore();
const { convert, getRate, hasRates } = useExchangeRates();

// ── Gather balance data from all selected bots ──
interface BotBalanceEntry {
  botId: string;
  name: string;
  balance: number;
  stakeCurrency: string;
}

const botEntries = computed<BotBalanceEntry[]>(() => {
  const entries: BotBalanceEntry[] = [];
  for (const bot of botStore.selectedBots) {
    const botId = bot.botId;
    const state = botStore.allBotState[botId];
    const balance = botStore.allBalance[botId];
    const currency = (state?.stake_currency as string) || 'USDC';
    const bal = balance?.total_bot ?? balance?.total ?? 0;

    entries.push({
      botId,
      name: bot.uiBotName || botId,
      balance: bal,
      stakeCurrency: currency,
    });
  }
  return entries.sort((a, b) => b.balance - a.balance);
});

// Per-currency totals
const perCurrencyTotals = computed(() => {
  const map: Record<string, number> = {};
  for (const e of botEntries.value) {
    map[e.stakeCurrency] = (map[e.stakeCurrency] ?? 0) + e.balance;
  }
  return map;
});

const isMultiCurrency = computed(() => Object.keys(perCurrencyTotals.value).length > 1);

const totalBalance = computed(() => {
  if (isMultiCurrency.value) return 0;
  return botEntries.value.reduce((s, e) => s + e.balance, 0);
});

// Converted total when multi-currency and rates are available
// Pick the most common currency as the conversion target, or fallback to USDC
const convertTargetCurrency = computed(() => {
  const currencies = Object.keys(perCurrencyTotals.value);
  if (currencies.length <= 1) return currencies[0] || 'USDC';
  // Pick the currency with the highest total balance value
  let best = currencies[0];
  let bestVal = 0;
  for (const cur of currencies) {
    const val = perCurrencyTotals.value[cur] ?? 0;
    if (val > bestVal) {
      bestVal = val;
      best = cur;
    }
  }
  return best;
});

const convertedTotal = computed<{
  total: number;
  currency: string;
  rates: { from: string; rate: number }[];
} | null>(() => {
  if (!isMultiCurrency.value || !hasRates.value) return null;
  const target = convertTargetCurrency.value;
  let total = 0;
  const rates: { from: string; rate: number }[] = [];
  for (const [cur, amt] of Object.entries(perCurrencyTotals.value)) {
    const converted = convert(amt, cur, target);
    if (converted === null) return null; // Cannot convert all currencies
    total += converted;
    if (cur !== target) {
      const rate = getRate(cur, target);
      if (rate !== null) rates.push({ from: cur, rate });
    }
  }
  return { total, currency: target, rates };
});

// Per-currency percentage for per-bot breakdown
function botPercentOfCurrency(entry: BotBalanceEntry): number {
  const currencyTotal = perCurrencyTotals.value[entry.stakeCurrency] ?? 0;
  if (currencyTotal <= 0) return 0;
  return (entry.balance / currencyTotal) * 100;
}

// Donut chart data
const donutRadius = 32;
const donutStroke = 6;
const donutCircumference = 2 * Math.PI * donutRadius;

const barColors = [
  { from: '#3b82f6', to: '#60a5fa' },
  { from: '#8b5cf6', to: '#a78bfa' },
  { from: '#06b6d4', to: '#22d3ee' },
  { from: '#f59e0b', to: '#fbbf24' },
  { from: '#ec4899', to: '#f472b6' },
  { from: '#10b981', to: '#34d399' },
];

function barColor(index: number): { from: string; to: string } {
  return barColors[index % barColors.length];
}

// For donut: group by currency when multi, else by bot
const donutEntries = computed(() => {
  if (isMultiCurrency.value) {
    return Object.entries(perCurrencyTotals.value).map(([cur, amt]) => ({
      label: cur,
      value: amt,
    }));
  }
  return botEntries.value.map((e) => ({
    label: e.name,
    value: e.balance,
  }));
});

const donutTotal = computed(() => donutEntries.value.reduce((s, e) => s + e.value, 0));

function donutDash(value: number, total: number): string {
  const pct = total > 0 ? Math.min(value / total, 1) : 0;
  return `${pct * donutCircumference} ${donutCircumference}`;
}
</script>

<template>
  <div class="glass-card" style="width: 380px">
    <!-- ═══ HEADER ═══ -->
    <div
      class="flex items-center justify-between mb-3 pb-2 border-b border-black/5 dark:border-white/5"
    >
      <div class="flex items-center gap-2">
        <i-mdi-wallet class="text-blue-400 text-base" />
        <span class="font-semibold text-gray-100 text-sm">
          {{ t('summaryTrades.balanceTitle') }}
        </span>
      </div>
    </div>

    <!-- ═══ TOTAL PER CURRENCY ═══ -->
    <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="section-header">
        <i-mdi-sigma class="text-blue-400" />
        <span>{{ t('summaryTrades.totalPerCurrency') }}</span>
      </div>
      <div v-for="(amt, cur) in perCurrencyTotals" :key="cur" class="stat-row">
        <span class="stat-label text-sm">{{ cur }}</span>
        <span class="stat-value font-bold text-sm text-blue-400">{{
          formatPriceCurrency(amt, cur as string, 2)
        }}</span>
      </div>
      <!-- Converted total when multi-currency -->
      <div v-if="convertedTotal" class="mt-2 pt-2 border-t border-black/5 dark:border-white/5">
        <div class="stat-row">
          <span class="stat-label text-sm"
            >{{ t('summaryTrades.convertedTotal') }} ({{ convertedTotal.currency }})</span
          >
          <span class="stat-value font-bold text-sm text-purple-400"
            >&#8776;
            {{ formatPriceCurrency(convertedTotal.total, convertedTotal.currency, 2) }}</span
          >
        </div>
        <div
          v-for="r in convertedTotal.rates"
          :key="r.from"
          class="text-[0.85rem] text-gray-600 dark:text-gray-500 text-right"
        >
          {{ t('summaryTrades.conversionRate') }}: 1 {{ r.from }} &#8776;
          {{ r.rate < 1 ? r.rate.toFixed(6) : r.rate.toFixed(2) }} {{ convertedTotal.currency }}
        </div>
      </div>
    </div>

    <!-- ═══ DONUT + LEGEND ═══ -->
    <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
      <div class="flex items-center gap-4">
        <!-- Donut chart -->
        <svg width="80" height="80" viewBox="0 0 80 80" class="flex-shrink-0">
          <circle
            cx="40"
            cy="40"
            :r="donutRadius"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            :stroke-width="donutStroke"
          />
          <circle
            v-for="(entry, idx) in donutEntries"
            :key="'donut-' + entry.label"
            cx="40"
            cy="40"
            :r="donutRadius"
            fill="none"
            :stroke="barColor(idx).from"
            :stroke-width="donutStroke"
            stroke-linecap="round"
            :stroke-dasharray="donutDash(entry.value, donutTotal)"
            :stroke-dashoffset="
              -(
                donutEntries
                  .slice(0, idx)
                  .reduce((sum, e) => sum + (donutTotal > 0 ? e.value / donutTotal : 0), 0) *
                donutCircumference
              ) +
              donutCircumference / 4
            "
            style="transition: stroke-dasharray 0.6s ease"
          />
          <text
            x="40"
            y="38"
            text-anchor="middle"
            class="fill-gray-100 font-bold"
            style="font-size: 0.95rem"
          >
            {{ botEntries.length }}
          </text>
          <text
            x="40"
            y="48"
            text-anchor="middle"
            class="fill-gray-600 dark:fill-gray-500"
            style="font-size: 0.4rem"
          >
            {{ t('summaryCards.bots') }}
          </text>
        </svg>
        <!-- Legend -->
        <div class="flex-1 space-y-0.5">
          <div
            v-for="(entry, idx) in donutEntries"
            :key="'legend-' + entry.label"
            class="flex items-center gap-1.5 text-[0.8rem]"
          >
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :style="{ background: barColor(idx).from }"
            />
            <span class="text-gray-600 dark:text-gray-400 truncate" style="max-width: 100px">{{
              entry.label
            }}</span>
            <span class="ml-auto text-gray-800 dark:text-gray-200">
              {{ donutTotal > 0 ? ((entry.value / donutTotal) * 100).toFixed(1) : 0 }}%
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ PER-BOT BREAKDOWN ═══ -->
    <div>
      <div class="section-header">
        <i-mdi-robot class="text-blue-400" />
        <span>{{ t('summaryTrades.perBot') }}</span>
      </div>
      <div class="space-y-1">
        <div v-for="(entry, idx) in botEntries" :key="entry.botId">
          <div class="flex items-center justify-between mb-0.5">
            <div class="flex items-center gap-1.5">
              <span
                class="w-2 h-2 rounded-full flex-shrink-0"
                :style="{ background: barColor(idx).from }"
              />
              <span
                class="text-gray-700 dark:text-gray-300 text-[0.85rem] truncate"
                style="max-width: 120px"
                >{{ entry.name }}</span
              >
            </div>
            <div class="flex items-center gap-2">
              <span class="text-gray-600 dark:text-gray-500 text-[0.85rem]"
                >{{ botPercentOfCurrency(entry).toFixed(1) }}%</span
              >
              <span class="text-gray-800 dark:text-gray-200 text-[0.85rem] font-bold">
                {{ formatPriceCurrency(entry.balance, entry.stakeCurrency, 2) }}
              </span>
            </div>
          </div>
          <div class="h-1 rounded-full bg-white/5 overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :style="{
                width: `${botPercentOfCurrency(entry)}%`,
                background: `linear-gradient(to right, ${barColor(idx).from}, ${barColor(idx).to})`,
              }"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.glass-card {
  font-size: 0.9rem;
  line-height: 1.4;
  background: rgba(15, 17, 23, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 16px;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 0.02em;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1px 0;
}

.stat-label {
  color: rgba(255, 255, 255, 0.35);
  font-size: 0.95rem;
}

.stat-value {
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.95rem;
}
</style>
