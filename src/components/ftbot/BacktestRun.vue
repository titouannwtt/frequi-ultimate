<script setup lang="ts">
import type { BacktestPayload } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();
const btStore = useBtStore();

function clickBacktest() {
  const btPayload: BacktestPayload = {
    strategy: btStore.strategy,
    timerange: btStore.timerange,
    enable_protections: btStore.enableProtections,
  };
  if (btStore.maxOpenTrades) {
    btPayload.max_open_trades = btStore.maxOpenTrades;
  }
  if (btStore.stakeAmountUnlimited) {
    btPayload.stake_amount = 'unlimited';
  } else {
    const stakeAmountLoc = Number(btStore.stakeAmount);
    if (stakeAmountLoc) {
      btPayload.stake_amount = stakeAmountLoc.toString();
    }
  }

  const startingCapitalLoc = Number(btStore.startingCapital);
  if (startingCapitalLoc) {
    btPayload.dry_run_wallet = startingCapitalLoc;
  }

  if (btStore.selectedTimeframe) {
    btPayload.timeframe = btStore.selectedTimeframe;
  }
  if (btStore.selectedDetailTimeframe) {
    btPayload.timeframe_detail = btStore.selectedDetailTimeframe;
  }
  if (!btStore.allowCache) {
    btPayload.backtest_cache = 'none';
  }
  if (btStore.freqAI.enabled) {
    btPayload.freqaimodel = btStore.freqAI.model;
    if (btStore.freqAI.identifier !== '') {
      btPayload.freqai = { identifier: btStore.freqAI.identifier };
    }
  }

  botStore.activeBot.startBacktest(btPayload);
}
</script>

<template>
  <div class="mb-2">
    <span>{{ t('charts.strategy') }}</span>
    <StrategySelect v-model="btStore.strategy"></StrategySelect>
  </div>
  <div
    class="grid grid-cols-2 border border-surface-500 rounded-sm gap-y-2 gap-2 items-center p-1 pt-3"
    :disabled="botStore.activeBot.backtestRunning"
  >
    <!-- Backtesting parameters -->
    <h3 class="font-bold mb-2 col-span-2 text-center">{{ t('backtest.params') }}</h3>
    <label for="timeframe-select">{{ t('backtest.timeframe') }}:</label>
    <TimeframeSelect id="timeframe-select" v-model="btStore.selectedTimeframe" size="small" />
    <label for="timeframe-detail-select" class="flex justify-end items-center gap-2"
      >{{ t('backtest.detailTimeframe') }}:
      <InfoBox :hint="t('backtest.detailTimeframeDesc')" />
    </label>
    <TimeframeSelect
      id="timeframe-detail-select"
      v-model="btStore.selectedDetailTimeframe"
      size="small"
      :below-timeframe="btStore.selectedTimeframe"
    />

    <label for="max-open-trades">{{ t('backtest.maxOpenTrades') }}:</label>
    <InputNumber
      id="max-open-trades"
      v-model="btStore.maxOpenTrades"
      size="small"
      :placeholder="t('backtest.useStrategyDefault')"
      type="number"
    ></InputNumber>
    <label for="starting-capital">{{ t('backtest.startingCapital') }}:</label>
    <InputNumber
      id="starting-capital"
      v-model="btStore.startingCapital"
      size="small"
      :placeholder="t('backtest.useConfigDefault')"
      type="number"
      :step="0.001"
    ></InputNumber>
    <label for="stake-amount-bool">{{ t('backtest.stakeAmount') }}:</label>
    <div class="flex items-center">
      <div class="flex basis-full">
        <BaseCheckbox id="stake-amount-bool" v-model="btStore.stakeAmountUnlimited">{{
          t('backtest.unlimitedStake')
        }}</BaseCheckbox>
      </div>
      <InputNumber
        id="stake-amount"
        v-model="btStore.stakeAmount"
        :placeholder="t('backtest.useStrategyDefault')"
        :step="0.01"
        size="small"
        :disabled="btStore.stakeAmountUnlimited"
      ></InputNumber>
    </div>

    <label for="enable-protections">{{ t('backtest.enableProtections') }}:</label>
    <BaseCheckbox id="enable-protections" v-model="btStore.enableProtections"></BaseCheckbox>
    <template v-if="botStore.activeBot.botFeatures.backtestFreqAI">
      <label for="enable-cache">{{ t('backtest.cacheResults') }}:</label>
      <BaseCheckbox id="enable-cache" v-model="btStore.allowCache"></BaseCheckbox>
    </template>

    <template v-if="botStore.activeBot.botFeatures.backtestFreqAI">
      <div class="flex justify-end items-center">
        <span class="me-2">{{ t('backtest.enableFreqAI') }}:</span>
        <InfoBox :hint="t('backtest.enableFreqAIDesc')" />
      </div>
      <BaseCheckbox id="enable-freqai" v-model="btStore.freqAI.enabled"></BaseCheckbox>

      <template v-if="btStore.freqAI.enabled">
        <label for="freqai-identifier">{{ t('backtest.freqAIIdentifier') }}:</label>
        <InputText
          id="freqai-identifier"
          v-model="btStore.freqAI.identifier"
          :placeholder="t('backtest.useConfigDefault')"
          size="small"
        ></InputText>
      </template>
      <template v-if="btStore.freqAI.enabled">
        <label for="freqai-model">{{ t('backtest.freqAIModel') }}:</label>
        <FreqaiModelSelect id="freqai-model" v-model="btStore.freqAI.model"></FreqaiModelSelect>
      </template>
    </template>

    <Divider class="col-span-2" />
    <TimeRangeSelect v-model="btStore.timerange" class="mx-auto mt-2 col-span-2"></TimeRangeSelect>
  </div>

  <h3 class="mt-3 font-bold text-2xl">{{ t('backtest.summary') }}</h3>
  <div class="flex flex-wrap md:flex-nowrap justify-between md:justify-center">
    <Button
      id="start-backtest"
      severity="primary"
      :disabled="
        !btStore.canRunBacktest ||
        botStore.activeBot.backtestRunning ||
        !botStore.activeBot.canRunBacktest
      "
      class="mx-1"
      @click="clickBacktest"
    >
      {{ t('backtest.startBacktest') }}
    </Button>
    <Button
      severity="secondary"
      :disabled="botStore.activeBot.backtestRunning || !botStore.activeBot.canRunBacktest"
      class="mx-1"
      @click="botStore.activeBot.pollBacktest"
    >
      {{ t('backtest.loadBacktestResult') }}
    </Button>
    <Button
      severity="secondary"
      class="mx-1"
      :disabled="!botStore.activeBot.backtestRunning"
      @click="botStore.activeBot.stopBacktest"
    >
      {{ t('backtest.stopBacktest') }}
    </Button>
    <Button
      severity="secondary"
      class="mx-1"
      :disabled="botStore.activeBot.backtestRunning || !botStore.activeBot.canRunBacktest"
      @click="botStore.activeBot.removeBacktest"
    >
      {{ t('backtest.resetBacktest') }}
    </Button>
  </div>
</template>
<style lang="css" scoped>
label {
  @apply text-right;
}
</style>
