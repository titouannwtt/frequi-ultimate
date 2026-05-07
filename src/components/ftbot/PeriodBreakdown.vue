<script setup lang="ts">
import { TimeSummaryOptions } from '@/types';
import { useI18n } from 'vue-i18n';
import { useWidgetDefaults } from '@/composables/useWidgetDefaults';
import { DashboardLayout } from '@/stores/layout';
import { useTradingModeFilter } from '@/composables/useTradingModeFilter';
import type { TimeSummaryReturnValue, TimeSummaryRecord } from '@/types';

const { t } = useI18n();
const botStore = useBotStore();
const settingsStore = useSettingsStore();
const { tradingMode, hasMultipleModes, isBotInMode } = useTradingModeFilter();

const props = defineProps<{
  multiBotView?: boolean;
}>();

const hasWeekly = computed(
  () => botStore.activeBot?.botFeatures?.weeklyMonthlyStats || props.multiBotView,
);

const periodicBreakdownSelections = computed(() => {
  const vals = [{ value: TimeSummaryOptions.daily, text: t('periodBreakdown.days') }];
  if (hasWeekly.value) {
    vals.push({ value: TimeSummaryOptions.weekly, text: t('periodBreakdown.weeks') });
    vals.push({ value: TimeSummaryOptions.monthly, text: t('periodBreakdown.months') });
  }
  return vals;
});

const absRelSelections = computed(() => [
  { value: 'abs_profit', text: t('periodBreakdown.absProfit') },
  { value: 'rel_profit', text: t('periodBreakdown.relProfit') },
]);

const HARDCODED_DEFAULTS_PB = {
  timeProfitPeriod: TimeSummaryOptions.daily as string,
  timeProfitPreference: 'abs_profit' as string,
  tradingMode: 'all' as string,
};

const { filtersChanged, saveCurrentAsDefault, loadDefaults } = useWidgetDefaults(
  DashboardLayout.periodBreakdown,
  () => ({
    timeProfitPeriod: settingsStore.timeProfitPeriod,
    timeProfitPreference: settingsStore.timeProfitPreference,
    tradingMode: tradingMode.value,
  }),
  (d) => {
    if (d.timeProfitPeriod !== undefined) settingsStore.timeProfitPeriod = d.timeProfitPeriod as string;
    if (d.timeProfitPreference !== undefined) settingsStore.timeProfitPreference = d.timeProfitPreference as string;
    if (d.tradingMode !== undefined) tradingMode.value = d.tradingMode as typeof tradingMode.value;
  },
  HARDCODED_DEFAULTS_PB,
);

onMounted(() => { loadDefaults(); });

defineExpose({ filtersChanged, saveCurrentAsDefault });

function aggregateStats(
  statsKey: 'dailyStats' | 'weeklyStats' | 'monthlyStats',
): TimeSummaryReturnValue {
  const resp: Record<string, TimeSummaryRecord> = {};
  Object.entries(botStore.botStores).forEach(([botId, store]) => {
    if (!store.isSelected || !isBotInMode(botId)) return;
    store[statsKey]?.data?.forEach((d: TimeSummaryRecord) => {
      const existing = resp[d.date];
      if (!existing) {
        resp[d.date] = { ...d };
      } else {
        existing.abs_profit += d.abs_profit;
        existing.fiat_value += d.fiat_value;
        existing.trade_count += d.trade_count;
      }
    });
  });
  return {
    stake_currency: 'USDT',
    fiat_display_currency: 'USD',
    data: Object.values(resp).sort((a, b) => (a.date > b.date ? 1 : -1)),
  };
}

const selectedStats = computed(() => {
  if (props.multiBotView) {
    switch (settingsStore.timeProfitPeriod) {
      case TimeSummaryOptions.weekly:
        return aggregateStats('weeklyStats');
      case TimeSummaryOptions.monthly:
        return aggregateStats('monthlyStats');
      default:
        return aggregateStats('dailyStats');
    }
  }

  switch (settingsStore.timeProfitPeriod) {
    case TimeSummaryOptions.weekly:
      return botStore.activeBot.weeklyStats;
    case TimeSummaryOptions.monthly:
      return botStore.activeBot.monthlyStats;
    default:
      return botStore.activeBot.dailyStats;
  }
});

const selectedStatsSorted = computed(() => {
  // Sorted version for chart
  return {
    ...selectedStats.value,
    data: selectedStats.value.data
      ? Object.values(selectedStats.value.data).sort((a, b) => (a.date > b.date ? 1 : -1))
      : [],
  };
});

function refreshSummary() {
  if (props.multiBotView) {
    botStore.allGetTimeSummary(settingsStore.timeProfitPeriod);
  } else {
    botStore.activeBot.getTimeSummary(settingsStore.timeProfitPeriod);
  }
}

onMounted(() => {
  refreshSummary();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <div v-if="!props.multiBotView" class="mb-2">
      <h3 class="me-auto inline text-xl">{{ hasWeekly ? t('periodBreakdown.title') : t('periodBreakdown.dailyBreakdown') }}</h3>
      <Button class="float-end" severity="secondary" @click="refreshSummary">
        <template #icon>
          <i-mdi-refresh />
        </template>
      </Button>
    </div>
    <div class="flex align-center justify-between">
      <SelectButton
        v-if="hasWeekly"
        id="order-direction"
        v-model="settingsStore.timeProfitPeriod"
        :options="periodicBreakdownSelections"
        name="radios-btn-default"
        size="small"
        :allow-empty="false"
        option-label="text"
        option-value="value"
        @change="refreshSummary"
      ></SelectButton>
      <SelectButton
        v-model="settingsStore.timeProfitPreference"
        name="radios-btn-select"
        size="small"
        :allow-empty="false"
        option-label="text"
        option-value="value"
        :options="absRelSelections"
        buttons
        button-variant="outline-primary"
      >
      </SelectButton>
      <TradingModeSelect v-model="tradingMode" :show="hasMultipleModes" />
    </div>

    <div
      v-if="
        !props.multiBotView ||
        botStore.selectedBotCount <= 1 ||
        settingsStore.timeProfitPreference !== 'rel_profit'
      "
    >
      <TimePeriodChart
        v-if="selectedStats"
        :daily-stats="selectedStatsSorted"
        :show-title="false"
        :profit-col="settingsStore.timeProfitPreference"
      />
    </div>
    <div v-else class="flex items-center justify-center h-full w-full p-2">
      Time period chart is only available when a single bot is selected and showing absolute profit.
    </div>
    <div v-if="!props.multiBotView">
      <DataTable size="small" :value="selectedStats.data">
        <Column field="date" :header="t('periodBreakdown.day')"></Column>
        <Column field="abs_profit" :header="t('periodBreakdown.profit')">
          <template #body="{ data, field }">
            {{ formatPrice(data[field as string], botStore.activeBot.stakeCurrencyDecimals) }}
          </template>
        </Column>
        <Column
          field="fiat_value"
          :header="t('periodBreakdown.inFiat', { currency: botStore.activeBot.dailyStats.fiat_display_currency })"
        >
          <template #body="{ data, field }">
            {{ formatPrice(data[field as string], 2) }}
          </template>
        </Column>
        <Column field="trade_count" :header="t('periodBreakdown.trades')"></Column>
        <Column
          v-if="botStore.activeBot.botFeatures.advancedDailyMetrics"
          field="rel_profit"
          :header="t('periodBreakdown.profitPct')"
        >
          <template #body="{ data, field }">
            {{ formatPercent(data[field as string], 2) }}
          </template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>
