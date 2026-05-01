<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();
</script>

<template>
  <div v-if="botStore.activeBot.botState" class="p-4">
    <p class="mb-4">
      {{ t('botStatus.running') }} <strong>{{ botStore.activeBot.version }}</strong>
    </p>
    <p class="mb-4">
      {{ t('botStatus.runningWith') }}
      <strong>
        {{ botStore.activeBot.botState.max_open_trades }}x{{
          botStore.activeBot.botState.stake_amount
        }}
        {{ botStore.activeBot.botState.stake_currency }}
      </strong>
      {{ t('botStatus.on') }}
      <strong class="text-nowrap"
        >{{ botStore.activeBot.botState.exchange }}
        {{ botStore.activeBot.botState.demo_trading ? '(Demo)' : '' }}</strong
      >
      {{ t('botStatus.in') }}
      <strong
        >{{ botStore.activeBot.botState.trading_mode || t('botStatus.spot') }}
        {{
          botStore.activeBot.botState.trading_mode !== 'spot'
            ? (botStore.activeBot.botState.margin_mode ?? '')
            : ''
        }}</strong
      >
      {{ t('botStatus.markets') }} <strong>{{ botStore.activeBot.botState.strategy }}</strong
      >.
    </p>
    <p v-if="'stoploss_on_exchange' in botStore.activeBot.botState" class="mb-4">
      {{ t('botStatus.stoplossOnExchange') }}
      <strong>{{
        botStore.activeBot.botState.stoploss_on_exchange ? t('botStatus.enabled') : t('botStatus.disabled')
      }}</strong
      >.
    </p>
    <p class="mb-4">
      {{ t('botStatus.currently') }} <strong>{{ botStore.activeBot.botState.state }}</strong
      >,
      <strong>{{ t('botStatus.forceEntry') }}: {{ botStore.activeBot.botState.force_entry_enable }}</strong>
    </p>
    <p>
      <strong>{{ botStore.activeBot.botState.dry_run ? t('botStatus.dryRun') : t('botStatus.live') }}</strong>
    </p>
    <Divider />
    <p class="mb-4" v-if="botStore.activeBot.profit">
      {{ t('botStatus.avgProfit') }} {{ formatPercent(botStore.activeBot.profit.profit_all_ratio_mean) }} (&sum;
      {{ formatPercent(botStore.activeBot.profit.profit_all_ratio_sum) }}) in
      {{ botStore.activeBot.profit.trade_count }} {{ t('botStatus.tradesAvgDuration') }}
      {{ botStore.activeBot.profit.avg_duration }}. {{ t('botStatus.bestPair') }}:
      {{ botStore.activeBot.profit.best_pair }}.
    </p>
    <p v-if="botStore.activeBot.profit?.first_trade_timestamp" class="mb-4">
      <span v-if="botStore.activeBot.profit.bot_start_timestamp" class="block">
        {{ t('botStatus.botStartDate') }}:
        <strong>
          <DateTimeTZ :date="botStore.activeBot.profit.bot_start_timestamp" show-timezone />
        </strong>
      </span>
      <span class="block">
        {{ t('botStatus.firstTradeOpened') }}:
        <strong>
          <DateTimeTZ :date="botStore.activeBot.profit.first_trade_timestamp" show-timezone />
        </strong>
      </span>
      <span class="block">
        {{ t('botStatus.lastTradeOpened') }}:
        <strong>
          <DateTimeTZ :date="botStore.activeBot.profit.latest_trade_timestamp" show-timezone />
        </strong>
      </span>
    </p>
    <p>
      <span v-if="botStore.activeBot.profit?.profit_factor" class="block">
        {{ t('botStatus.profitFactor') }}:
        {{ formatNumber(botStore.activeBot.profit.profit_factor, 2) }}
      </span>
      <span v-if="botStore.activeBot.profit?.trading_volume" class="block mb-4">
        {{ t('botStatus.tradingVolume') }}:
        {{
          formatPriceCurrency(
            botStore.activeBot.profit.trading_volume,
            botStore.activeBot.botState.stake_currency,
            botStore.activeBot.botState.stake_currency_decimals ?? 3,
          )
        }}
      </span>
    </p>
    <Panel
      v-if="botStore.activeBot.strategy?.params"
      :header="t('botStatus.strategyParams')"
      toggleable
      collapsed
    >
      <StrategyParameters :strategy="botStore.activeBot.strategy" />
    </Panel>
    <Divider />
    <BotProfit
      class="mx-1"
      v-if="botStore.activeBot.profitAll"
      :profit-all="botStore.activeBot.profitAll"
      :stake-currency="botStore.activeBot.botState.stake_currency ?? 'USDT'"
      :stake-currency-decimals="botStore.activeBot.botState.stake_currency_decimals ?? 3"
    />
  </div>
</template>
