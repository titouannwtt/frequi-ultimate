<script setup lang="ts">
import type { DownloadDataPayload, ExchangeSelection } from '@/types';
import { MarginMode, TradingMode } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();
const pairlistStore = usePairlistConfigStore();
// Defaults come from the bot the tool is used on (its stake currency, market and exchange)
const bot = botStore.activeBot;
const stake = bot?.stakeCurrency || 'USDT';
const futures = bot?.botState?.trading_mode === TradingMode.FUTURES;
const quoted = (base: string) => (futures ? `${base}/${stake}:${stake}` : `${base}/${stake}`);
const pairs = ref<string[]>([quoted('BTC'), quoted('ETH'), '']);
const timeframes = ref<string[]>(['5m', '1h']);

const timeSelection = ref({
  useCustomTimerange: false,
  timerange: '',
  days: 30,
});

const { pairTemplates } = usePairTemplates();

const exchange = ref<{
  customExchange: boolean;
  selectedExchange: ExchangeSelection;
}>({
  customExchange: false,
  selectedExchange: {
    exchange: bot?.botState?.exchange || 'binance',
    trade_mode: {
      margin_mode: futures ? MarginMode.ISOLATED : MarginMode.NONE,
      trading_mode: bot?.botState?.trading_mode ?? TradingMode.SPOT,
    },
  },
});

const advancedOptions = ref({
  erase: false,
  prepend_data: false,
  downloadTrades: false,
  candleTypes: [] as string[],
});

// State to track the collapse status
const isAdvancedOpen = ref(false);
const candleTypes = [
  { text: 'Spot', value: 'spot' },
  { text: 'Futures', value: 'futures' },
  { text: 'Funding Rate', value: 'funding_rate' },
  { text: 'Mark', value: 'mark' },
  { text: 'Index', value: 'index' },
  { text: 'Premium Index', value: 'premiumIndex' },
];

function addPairs(_pairs: string[]) {
  pairs.value.push(..._pairs);
}

function replacePairs(_pairs: string[]) {
  pairs.value = [..._pairs];
}

const canDownload = computed(
  () => pairs.value.some((p) => p !== '') && timeframes.value.some((tf) => tf !== ''),
);

async function startDownload() {
  const payload: DownloadDataPayload = {
    pairs: pairs.value.filter((pair) => pair !== ''),
    timeframes: timeframes.value.filter((tf) => tf !== ''),
  };

  // Add either timerange or days to the payload
  if (timeSelection.value.useCustomTimerange && timeSelection.value.timerange) {
    payload.timerange = timeSelection.value.timerange;
  } else {
    payload.days = timeSelection.value.days;
  }

  // Include advanced options only if the section is open
  if (isAdvancedOpen.value) {
    payload.erase = advancedOptions.value.erase;
    payload.download_trades = advancedOptions.value.downloadTrades;

    if (exchange.value.customExchange) {
      payload.exchange = exchange.value.selectedExchange.exchange;
      payload.trading_mode = exchange.value.selectedExchange.trade_mode.trading_mode;
      payload.margin_mode = exchange.value.selectedExchange.trade_mode.margin_mode;
    }
    if (
      botStore.activeBot.botFeatures.downloadDataCandleTypes &&
      advancedOptions.value.candleTypes.length > 0
    ) {
      payload.candle_types = advancedOptions.value.candleTypes;
    }
    if (botStore.activeBot.botFeatures.downloadDataPrepend && advancedOptions.value.prepend_data) {
      payload.prepend_data = true;
    }
  }

  await botStore.activeBot.startDataDownload(payload);
}
</script>

<template>
  <div class="px-1 mx-auto w-full max-w-4xl lg:max-w-7xl">
    <BackgroundJobTracking class="mb-4" />
    <section class="mx-1 p-4 rounded-lg border border-surface-300 dark:border-surface-700">
      <h2 class="text-start font-bold text-xl mb-3">{{ t('downloadData.title') }}</h2>
      <div class="flex mb-3 gap-3 flex-col">
        <div class="flex flex-col gap-3">
          <div class="flex flex-col lg:flex-row gap-3">
            <!-- Pairs section - keeping template buttons next to input -->
            <div class="flex-fill">
              <div class="flex flex-col gap-2">
                <div class="flex justify-between">
                  <h4 class="text-start font-bold text-lg">{{ t('downloadData.selectPairs') }}</h4>
                  <h5 class="text-start font-bold text-lg">
                    {{ t('downloadData.pairsFromTemplate') }}
                  </h5>
                </div>
                <div class="flex gap-2">
                  <BaseStringList
                    v-model="pairs"
                    :placeholder="t('fq.pg.legacy.download.pairPlaceholder')"
                    size="small"
                    class="grow"
                  />
                  <div class="flex flex-col gap-1">
                    <div class="flex flex-col gap-1">
                      <Button
                        v-for="pt in pairTemplates"
                        :key="pt.idx"
                        severity="secondary"
                        :title="pt.pairs.reduce((acc, p) => `${acc}${p}\n`, '')"
                        @click="addPairs(pt.pairs)"
                      >
                        {{ pt.description }}
                      </Button>
                    </div>
                    <Divider />
                    <Button
                      :disabled="pairlistStore.whitelist.length === 0"
                      :title="t('downloadData.addAllPairs')"
                      severity="secondary"
                      @click="replacePairs(pairlistStore.whitelist)"
                    >
                      {{ t('fq.pg.legacy.download.fromPairlist') }}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Timeframes section -->
            <div class="flex-fill px-3">
              <div class="flex flex-col gap-2">
                <h4 class="text-start font-bold text-lg">
                  {{ t('downloadData.selectTimeframes') }}
                </h4>
                <BaseStringList
                  v-model="timeframes"
                  :placeholder="t('fq.pg.legacy.download.timeframePlaceholder')"
                />
              </div>
            </div>
          </div>

          <!-- Time selection section -->
          <div class="px-3 border dark:border-surface-700 border-surface-300 p-2 rounded-sm">
            <div class="flex flex-col gap-2">
              <div class="flex justify-between items-center">
                <h4 class="text-start mb-0 font-bold text-lg">
                  {{ t('downloadData.timeSelection') }}
                </h4>
                <BaseCheckbox v-model="timeSelection.useCustomTimerange" class="mb-0" switch>
                  {{ t('fq.pg.legacy.download.customTimerange') }}
                </BaseCheckbox>
              </div>

              <div v-if="timeSelection.useCustomTimerange">
                <TimeRangeSelect v-model="timeSelection.timerange" />
              </div>
              <div v-else class="flex items-center gap-2">
                <label>{{ t('downloadData.daysToDownload') }}:</label>
                <InputNumber
                  v-model="timeSelection.days"
                  type="number"
                  :aria-label="t('fq.pg.legacy.download.daysAria')"
                  :min="1"
                  :step="1"
                  size="small"
                />
              </div>
            </div>
          </div>

          <!-- Advanced options section -->
          <div
            class="mb-2 border dark:border-surface-700 border-surface-300 rounded-sm p-2 text-start"
          >
            <Button class="mb-2" severity="secondary" @click="isAdvancedOpen = !isAdvancedOpen">
              {{ t('fq.pg.legacy.download.advanced') }}
              <i-mdi-chevron-down v-if="!isAdvancedOpen" />
              <i-mdi-chevron-up v-else />
            </Button>
            <Transition>
              <div v-show="isAdvancedOpen">
                <Message severity="info" class="mb-2 py-2">
                  {{ t('fq.pg.legacy.download.advancedNote') }}
                </Message>
                <div
                  class="mb-2 border dark:border-surface-700 border-surface-300 rounded-md p-2 text-start"
                >
                  <BaseCheckbox v-model="advancedOptions.erase" class="mb-2">{{
                    t('fq.pg.legacy.download.erase')
                  }}</BaseCheckbox>
                  <BaseCheckbox
                    v-model="advancedOptions.prepend_data"
                    class="mb-2"
                    v-if="botStore.activeBot.botFeatures.downloadDataPrepend"
                    >{{ t('fq.pg.legacy.download.prepend') }}</BaseCheckbox
                  >
                  <BaseCheckbox v-model="advancedOptions.downloadTrades" class="mb-2">
                    {{ t('fq.pg.legacy.download.trades') }}
                  </BaseCheckbox>
                  <div class="grid grid-cols md:grid-cols-2 items-center gap-2">
                    <MultiSelect
                      v-if="botStore.activeBot.botFeatures.downloadDataCandleTypes"
                      v-model="advancedOptions.candleTypes"
                      :options="candleTypes"
                      option-label="text"
                      option-value="value"
                      :placeholder="t('fq.pg.legacy.download.candleTypes')"
                    />
                    <small>{{ t('fq.pg.legacy.download.candleTypesHint') }}</small>
                  </div>
                </div>
                <div
                  class="mb-2 border dark:border-surface-700 border-surface-300 rounded-md p-2 text-start"
                >
                  <BaseCheckbox v-model="exchange.customExchange" class="mb-2">
                    {{ t('fq.pg.legacy.download.customExchange') }}
                  </BaseCheckbox>
                  <Transition name="fade">
                    <ExchangeSelect
                      v-show="exchange.customExchange"
                      v-model="exchange.selectedExchange"
                    />
                  </Transition>
                </div>
              </div>
            </Transition>
          </div>

          <div class="px-3">
            <Button
              severity="primary"
              :disabled="!canDownload"
              :title="canDownload ? undefined : t('fq.pg.legacy.download.needPairs')"
              @click="startDownload"
              >{{ t('fq.pg.legacy.download.start') }}</Button
            >
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
