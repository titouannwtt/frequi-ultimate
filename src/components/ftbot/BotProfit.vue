<script setup lang="ts">
import type { AllProfitStats } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  profitAll: AllProfitStats;
  stakeCurrency: string;
  stakeCurrencyDecimals: number;
}>();

const profit = computed(() => {
  if (!props.profitAll?.short) {
    return props.profitAll.all;
  }
  return props.profitAll[selectedOption.value];
});

const profitItems = computed(() => {
  if (!profit.value) return [];
  return [
    {
      metric: t('profit.roiClosed'),
      value: profit.value.profit_closed_coin
        ? `${formatPriceCurrency(
            profit.value.profit_closed_coin,
            props.stakeCurrency,
            props.stakeCurrencyDecimals,
          )} (${formatPercent(profit.value.profit_closed_ratio_mean, 2)})`
        : 'N/A',
      // (&sum; ${formatPercent(profit.value.profit_closed_ratio_sum,  2,)})`
    },
    {
      metric: t('profit.roiAll'),
      value: profit.value.profit_all_coin
        ? `${formatPriceCurrency(
            profit.value.profit_all_coin,
            props.stakeCurrency,
            props.stakeCurrencyDecimals,
          )} (${formatPercent(profit.value.profit_all_ratio_mean, 2)})`
        : 'N/A',
      //  (&sum; ${formatPercent(profit.value.profit_all_ratio_sum,2,)})`
    },

    {
      metric: t('profit.totalTradeCount'),
      value: `${profit.value.trade_count ?? 0}`,
    },
    {
      metric: t('profit.botStarted'),
      value: profit.value.bot_start_timestamp,
      isTs: true,
    },
    {
      metric: t('profit.firstTradeOpened'),
      value: profit.value.first_trade_timestamp,
      isTs: true,
    },
    {
      metric: t('profit.latestTradeOpened'),
      value: profit.value.latest_trade_timestamp,
      isTs: true,
    },
    {
      metric: t('profit.winLoss'),
      value: `${profit.value.winning_trades ?? 0} / ${profit.value.losing_trades ?? 0}`,
    },
    {
      metric: t('profit.winrate'),
      value: `${profit.value.winrate ? formatPercent(profit.value.winrate) : 'N/A'}`,
    },
    {
      metric: t('profit.expectancy'),
      value: `${formatNumber(profit.value.expectancy, 2)} (${formatNumber(profit.value.expectancy_ratio, 2)})`,
    },
    {
      metric: t('profit.cagr'),
      value: `${formatPercent(profit.value.cagr, 2)}`,
    },
    {
      metric: t('profit.calmar'),
      value: `${formatNumber(profit.value.calmar, 2)}`,
    },
    {
      metric: t('profit.sharpe'),
      value: `${formatNumber(profit.value.sharpe, 2)}`,
    },
    {
      metric: t('profit.sortino'),
      value: `${formatNumber(profit.value.sortino, 2)}`,
    },
    {
      metric: t('profit.sqn'),
      value: `${formatNumber(profit.value.sqn, 2)}`,
    },
    {
      metric: t('profit.pvalue'),
      value: `${formatNumber(profit.value.pvalue, 4)}`,
    },
    {
      metric: t('profit.avgDuration'),
      value: `${profit.value.avg_duration ?? 'N/A'}`,
    },
    {
      metric: t('profit.bestPerforming'),
      value: profit.value.best_pair
        ? `${profit.value.best_pair}: ${formatPercent(profit.value.best_pair_profit_ratio, 2)}`
        : 'N/A',
    },
    {
      metric: t('profit.tradingVolume'),
      value: `${formatPriceCurrency(
        profit.value.trading_volume ?? 0,
        props.stakeCurrency,
        props.stakeCurrencyDecimals,
      )}`,
    },
    {
      metric: t('profit.profitFactor'),
      value: `${formatNumber(profit.value.profit_factor, 2)}`,
    },
    ...(profit.value.capital_withdrawal
      ? [
          {
            metric: t('profit.withdrawn'),
            value: formatPriceCurrency(
              profit.value.capital_withdrawal,
              props.stakeCurrency,
              props.stakeCurrencyDecimals,
            ),
          },
          {
            metric: t('profit.netProfit'),
            value: formatPriceCurrency(
              profit.value.profit_closed_coin - (profit.value.capital_withdrawal ?? 0),
              props.stakeCurrency,
              props.stakeCurrencyDecimals,
            ),
          },
        ]
      : []),
    {
      metric: t('profit.maxDrawdown'),
      value: `${profit.value.max_drawdown ? formatPercent(profit.value.max_drawdown, 2) : 'N/A'} (${
        profit.value.max_drawdown_abs
          ? formatPriceCurrency(
              profit.value.max_drawdown_abs,
              props.stakeCurrency,
              props.stakeCurrencyDecimals,
            )
          : 'N/A'
      }) ${
        profit.value.max_drawdown_start_timestamp && profit.value.max_drawdown_end_timestamp
          ? 'from ' +
            timestampms(profit.value.max_drawdown_start_timestamp) +
            ' to ' +
            timestampms(profit.value.max_drawdown_end_timestamp)
          : ''
      }`,
    },
    {
      metric: t('profit.currentDrawdown'),
      value: `${profit.value.current_drawdown ? formatPercent(profit.value.current_drawdown, 2) : 'N/A'} (${
        profit.value.current_drawdown_abs
          ? formatPriceCurrency(
              profit.value.current_drawdown_abs,
              props.stakeCurrency,
              props.stakeCurrencyDecimals,
            )
          : 'N/A'
      }) ${
        profit.value.current_drawdown_start_timestamp
          ? 'since ' + timestampms(profit.value.current_drawdown_start_timestamp)
          : ''
      }`,
    },
  ];
});

const selectedOption = ref('all');
const options = computed(() => [
  { value: 'all', text: t('profit.all') },
  { value: 'long', text: t('profit.long') },
  { value: 'short', text: t('profit.short') },
]);
</script>

<template>
  <div>
    <div v-if="profitAll?.long && profitAll?.short" class="flex justify-between items-center">
      <span>{{ t('profit.profitsFor') }}</span>
      <SelectButton
        v-model="selectedOption"
        :options="options"
        option-label="text"
        option-value="value"
        :allow-empty="false"
        size="small"
      ></SelectButton>
      <span>{{ t('profit.trades') }}</span>
    </div>

    <DataTable class="text-start" small borderless :value="profitItems">
      <Column field="metric" :header="t('profit.metric')"></Column>
      <Column field="value" :header="t('profit.value')">
        <template #body="{ data }">
          <DateTimeTZ v-if="data.isTs" :date="data.value" show-timezone />
          <template v-else>
            {{ data.value }}
          </template>
        </template>
      </Column>
    </DataTable>
  </div>
</template>
