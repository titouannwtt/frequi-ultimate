<script setup lang="ts">
import type { MultiDeletePayload, MultiForceExitPayload, Trade } from '@/types';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

enum ModalReasons {
  removeTrade,
  forceExit,
  forceExitPartial,
  cancelOpenOrder,
}

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    trades: Trade[];
    title?: string;
    stakeCurrency?: string;
    activeTrades?: boolean;
    showFilter?: boolean;
    multiBotView?: boolean;
    emptyText?: string;
  }>(),
  {
    title: 'Trades',
    stakeCurrency: '',
    activeTrades: false,
    showFilter: false,
    multiBotView: false,
    emptyText: 'No Trades to show.',
  },
);

const botStore = useBotStore();
const router = useRouter();
const settingsStore = useSettingsStore();
const currentPage = ref(1);
const selectedItem = ref();
const filterText = ref('');
const feTrade = ref<Trade>({} as Trade);
const perPage = props.activeTrades ? 200 : 15;
const tradesTable = ref<HTMLFormElement>();
const forceExitVisible = ref(false);
const removeTradeVisible = ref(false);
const confirmExitText = ref('');
const confirmExitValue = ref<ModalReasons | null>(null);

const increasePosition = ref({ visible: false, trade: {} as Trade });
function formatPriceWithDecimals(price: number) {
  return formatPrice(price, botStore.activeBot.stakeCurrencyDecimals);
}

const tableFields = computed(() => {
  const fields = [
    { field: 'trade_id', header: t('tradeList.id') },
    { field: 'pair', header: t('tradeList.pair') },
    { field: 'amount', header: t('tradeList.amount') },
    props.activeTrades
      ? { field: 'stake_amount', header: t('tradeList.stakeAmount') }
      : { field: 'max_stake_amount', header: t('tradeList.totalStakeAmount') },
    {
      field: 'open_rate',
      header: t('tradeList.openRate'),
    },
    {
      field: props.activeTrades ? 'current_rate' : 'close_rate',
      header: props.activeTrades ? t('tradeList.currentRate') : t('tradeList.closeRate'),
    },
    {
      field: 'profit',
      header: props.activeTrades ? t('tradeList.currentProfit') : t('tradeList.profit'),
    },
    { field: 'open_timestamp', header: t('tradeList.openDate') },
    ...(props.activeTrades
      ? [{ field: 'actions', header: '' }]
      : [
          { field: 'close_timestamp', header: t('tradeList.closeDate') },
          { field: 'exit_reason', header: t('tradeList.closeReason') },
        ]),
  ];
  if (props.multiBotView) {
    fields.unshift({ field: 'botName', header: t('tradeList.bot') });
  }
  return fields;
});

const feOrderType = ref<string | undefined>(undefined);
function forceExitHandler(item: Trade, ordertype: string | undefined = undefined) {
  feTrade.value = item;
  confirmExitValue.value = ModalReasons.forceExit;
  confirmExitText.value = t('tradeList.confirmExit', {
    id: item.trade_id,
    pair: item.pair,
    orderType: ordertype,
  });
  feOrderType.value = ordertype;
  if (settingsStore.confirmDialog === true) {
    removeTradeVisible.value = true;
  } else {
    forceExitExecuter();
  }
}

function forceExitExecuter() {
  if (confirmExitValue.value === ModalReasons.removeTrade) {
    const payload: MultiDeletePayload = {
      tradeid: String(feTrade.value.trade_id),
      botId: feTrade.value.botId,
    };
    botStore.deleteTradeMulti(payload).catch((error) => console.log(error.response));
  }
  if (confirmExitValue.value === ModalReasons.forceExit) {
    const payload: MultiForceExitPayload = {
      tradeid: String(feTrade.value.trade_id),
      botId: feTrade.value.botId,
    };
    if (feOrderType.value) {
      payload.ordertype = feOrderType.value;
    }
    botStore
      .forceSellMulti(payload)
      .then((xxx) => console.log(xxx))
      .catch((error) => console.log(error.response));
  }
  if (confirmExitValue.value === ModalReasons.cancelOpenOrder) {
    const payload: MultiDeletePayload = {
      tradeid: String(feTrade.value.trade_id),
      botId: feTrade.value.botId,
    };
    botStore.cancelOpenOrderMulti(payload);
  }

  feOrderType.value = undefined;
  removeTradeVisible.value = false;
}

function removeTradeHandler(item: Trade) {
  confirmExitText.value = t('tradeList.confirmDelete', { id: item.trade_id, pair: item.pair });
  confirmExitValue.value = ModalReasons.removeTrade;
  feTrade.value = item;
  removeTradeVisible.value = true;
}

function forceExitPartialHandler(item: Trade) {
  feTrade.value = item;
  forceExitVisible.value = true;
}

function cancelOpenOrderHandler(item: Trade) {
  confirmExitText.value = t('tradeList.cancelOpenOrder', { id: item.trade_id, pair: item.pair });
  feTrade.value = item;
  confirmExitValue.value = ModalReasons.cancelOpenOrder;
  removeTradeVisible.value = true;
}

function reloadTradeHandler(item: Trade) {
  botStore.reloadTradeMulti({ tradeid: String(item.trade_id), botId: item.botId });
}

function handleForceEntry(item: Trade) {
  increasePosition.value.trade = item;
  increasePosition.value.visible = true;
}

const onRowClicked = ({ data: item }) => {
  if (props.multiBotView && botStore.selectedBot !== item.botId) {
    // Multibotview - on click switch to the bot trade view
    botStore.selectBot(item.botId);
  }
  if (item && item.trade_id !== botStore.activeBot.detailTradeId) {
    botStore.activeBot.setDetailTrade(item);
    if (props.multiBotView) {
      router.push({ name: 'Freqtrade Trading' });
    }
  } else {
    botStore.activeBot.setDetailTrade(null);
  }
};

watch(
  () => botStore.activeBot.detailTradeId,
  (val) => {
    const index = props.trades.findIndex((v) => v.trade_id === val);
    // Unselect when another tradeTable is selected!
    if (index < 0) {
      selectedItem.value = undefined;
    }
  },
);
</script>

<template>
  <div class="h-full overflow-auto w-full">
    <DataTable
      ref="tradesTable"
      v-model:selection="selectedItem"
      :value="
        trades.filter(
          (t) =>
            t.pair.toLowerCase().includes(filterText.toLowerCase()) ||
            t.exit_reason?.toLowerCase().includes(filterText.toLowerCase()) ||
            t.enter_tag?.toLowerCase().includes(filterText.toLowerCase()) ||
            (props.multiBotView
              ? t.botName?.toLowerCase().includes(filterText.toLowerCase())
              : false),
        )
      "
      :rows="perPage"
      :paginator="!activeTrades"
      :first="(currentPage - 1) * perPage"
      selection-mode="single"
      class="text-center"
      size="small"
      :scrollable="true"
      scroll-height="flex"
      @row-click="onRowClicked"
    >
      <template #empty>
        {{ emptyText }}
      </template>
      <Column
        v-for="column in tableFields"
        :key="column.field"
        :field="column.field"
        :header="column.header"
      >
        <template #body="{ data, field, index }">
          <template v-if="field === 'trade_id'">
            {{ data.trade_id }}
            {{
              botStore.activeBot.botFeatures.futures && data.trading_mode !== 'spot'
                ? (data.trade_id ? '| ' : '') +
                  (data.is_short ? t('tradeList.short') : t('tradeList.long'))
                : ''
            }}
          </template>
          <template v-else-if="field === 'pair'">
            {{ `${data.pair}${data.open_order_id || data.has_open_orders ? '*' : ''}` }}
          </template>
          <template v-else-if="field === 'actions'">
            <TradeActionsPopover
              :id="index"
              :enable-force-entry="botStore.activeBot.botState.force_entry_enable"
              :trade="data as Trade"
              :bot-features="botStore.activeBot.botFeatures"
              @delete-trade="removeTradeHandler(data as Trade)"
              @force-exit="forceExitHandler"
              @force-exit-partial="forceExitPartialHandler"
              @cancel-open-order="cancelOpenOrderHandler"
              @reload-trade="reloadTradeHandler"
              @force-entry="handleForceEntry"
            />
          </template>
          <template v-else-if="field === 'stake_amount' || field === 'max_stake_amount'">
            {{ formatPriceWithDecimals(data[field]) }}
            {{ data.trading_mode !== 'spot' ? `(${data.leverage}x)` : '' }}
          </template>
          <template
            v-else-if="field === 'open_rate' || field === 'current_rate' || field === 'close_rate'"
          >
            {{ formatPrice(data[field]) }}
          </template>
          <template v-else-if="field === 'amount'">
            {{ formatPrice(data[field]) }}
          </template>
          <template v-else-if="field === 'profit'">
            <TradeProfit :trade="data" />
          </template>
          <template v-else-if="field === 'open_timestamp'">
            <DateTimeTZ :date="data.open_timestamp" />
          </template>
          <template v-else-if="field === 'close_timestamp'">
            <DateTimeTZ :date="data.close_timestamp ?? 0" />
          </template>
          <template v-else>
            {{ data[field as string] }}
          </template>
        </template>
      </Column>
      <template v-if="showFilter" #paginatorstart> </template>
      <template v-if="showFilter" #paginatorend>
        <div class="flex justify-end gap-2 p-2">
          <InputText
            v-model="filterText"
            :placeholder="t('tradeList.filter')"
            class="w-64"
            size="small"
          />
        </div>
      </template>
    </DataTable>

    <ForceExitForm
      v-if="activeTrades"
      v-model="forceExitVisible"
      :trade="feTrade"
      :stake-currency-decimals="botStore.activeBot.botState.stake_currency_decimals ?? 3"
    />
    <ForceEntryForm
      v-model="increasePosition.visible"
      :pair="increasePosition.trade?.pair"
      position-increase
    />

    <Dialog v-model:visible="removeTradeVisible" :modal="true" :header="t('tradeList.exitTrade')">
      <p>{{ confirmExitText }}</p>
      <template #footer>
        <Button :label="t('tradeList.cancel')" @click="removeTradeVisible = false" />
        <Button :label="t('tradeList.confirm')" severity="danger" @click="forceExitExecuter" />
      </template>
    </Dialog>
  </div>
</template>
