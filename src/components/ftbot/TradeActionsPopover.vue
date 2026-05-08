<script setup lang="ts">
import type { Trade } from '@/types';
import type { BotFeatures } from '@/types/features';
import Popover from 'primevue/popover';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const { t } = useI18n();
const router = useRouter();
const botStore = useBotStore();

const props = withDefaults(
  defineProps<{
    trade: Trade;
    id: number;
    botFeatures: BotFeatures;
    enableForceEntry?: boolean;
  }>(),
  {
    enableForceEntry: false,
  },
);
const emit = defineEmits<{
  forceExit: [trade: Trade, type?: string];
  forceExitPartial: [trade: Trade];
  cancelOpenOrder: [trade: Trade];
  reloadTrade: [trade: Trade];
  deleteTrade: [trade: Trade];
  forceEntry: [trade: Trade];
}>();

const popover = ref<InstanceType<typeof Popover> | null>(null);

function hide() {
  popover.value?.hide();
}

function forceExitHandler(item: Trade, ordertype: string | undefined = undefined) {
  hide();
  emit('forceExit', item, ordertype);
}
function forceExitPartialHandler(item: Trade) {
  hide();
  emit('forceExitPartial', item);
}
function cancelOpenOrderHandler(item: Trade) {
  hide();
  emit('cancelOpenOrder', item);
}
function handleReloadTrade(item: Trade) {
  hide();
  emit('reloadTrade', item);
}
function handleDeleteTrade(item: Trade) {
  hide();
  emit('deleteTrade', item);
}
function handleForceEntry(item: Trade) {
  hide();
  emit('forceEntry', item);
}

function viewChart() {
  hide();
  botStore.activeBot.selectedPair = props.trade.pair;
  router.push('/trade');
}

function getExchangeTradeUrl(trade: Trade): string | null {
  const exchange = (trade.exchange ?? '').toLowerCase();
  const pair = trade.pair ?? '';
  const base = pair.split('/')[0] ?? '';

  if (!base || !exchange) return null;

  // HIP-3 tokens on Hyperliquid use "xyz:<symbol>" format (e.g. xyz:SP500)
  // Standard pairs just use the base (e.g. TON)
  const isHip3 = base.startsWith('@') || pair.includes(':');

  switch (exchange) {
    case 'hyperliquid': {
      if (isHip3) {
        const hip3Symbol = base.replace('@', '');
        return `https://app.hyperliquid.xyz/trade/xyz:${hip3Symbol}`;
      }
      return `https://app.hyperliquid.xyz/trade/${base}`;
    }
    case 'binance':
      return `https://www.binance.com/en/futures/${base}USDT`;
    case 'bybit':
      return `https://www.bybit.com/trade/usdt/${base}USDT`;
    case 'okx':
    case 'myokx':
      return `https://www.okx.com/trade-swap/${base.toLowerCase()}-usdt-swap`;
    case 'kraken':
      return `https://pro.kraken.com/app/trade/${base.toLowerCase()}-usd`;
    case 'gateio':
      return `https://www.gate.io/futures_trade/USDT/${base}_USDT`;
    default:
      return null;
  }
}

function viewOnExchange() {
  hide();
  const url = getExchangeTradeUrl(props.trade);
  if (url) window.open(url, '_blank');
}

const exchangeUrl = computed(() => getExchangeTradeUrl(props.trade));
</script>

<template>
  <div>
    <button
      :id="`btn-actions-${id}`"
      class="p-0.5 rounded hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer opacity-50 hover:opacity-100 transition-opacity"
      :title="t('enhancedTrades.actions')"
      @click.stop="popover?.toggle"
    >
      <i-mdi-dots-vertical class="text-sm" />
    </button>
    <Popover
      ref="popover"
      :target="`btn-actions-${id}`"
      triggers="manual"
      placement="left"
    >
      <div class="flex flex-col gap-0.5 p-1 min-w-[180px]">
        <!-- Trade actions -->
        <button
          v-if="!botFeatures.forceExitParams"
          class="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-surface-200 dark:hover:bg-surface-700 w-full text-left cursor-pointer transition-colors"
          @click="forceExitHandler(trade)"
        >
          <i-mdi-close-box class="text-surface-500" /> Forceexit
        </button>
        <button
          v-if="botFeatures.forceExitParams"
          class="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-surface-200 dark:hover:bg-surface-700 w-full text-left cursor-pointer transition-colors"
          @click="forceExitHandler(trade, 'limit')"
        >
          <i-mdi-close-box class="text-surface-500" /> Forceexit limit
        </button>
        <button
          v-if="botFeatures.forceExitParams"
          class="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-surface-200 dark:hover:bg-surface-700 w-full text-left cursor-pointer transition-colors"
          @click="forceExitHandler(trade, 'market')"
        >
          <i-mdi-close-box class="text-surface-500" /> Forceexit market
        </button>
        <button
          v-if="botFeatures.forceEntryTag"
          class="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-surface-200 dark:hover:bg-surface-700 w-full text-left cursor-pointer transition-colors"
          @click="forceExitPartialHandler(trade)"
        >
          <i-mdi-close-box-multiple class="text-surface-500" /> Forceexit partial
        </button>
        <button
          v-if="botFeatures.cancelOpenOrders && (trade.open_order_id || trade.has_open_orders)"
          class="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-surface-200 dark:hover:bg-surface-700 w-full text-left cursor-pointer transition-colors"
          @click="cancelOpenOrderHandler(trade)"
        >
          <i-mdi-cancel class="text-surface-500" /> Cancel open orders
        </button>
        <button
          v-if="enableForceEntry"
          class="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-surface-200 dark:hover:bg-surface-700 w-full text-left cursor-pointer transition-colors"
          @click="handleForceEntry(trade)"
        >
          <i-mdi-plus-box-multiple-outline class="text-surface-500" /> Increase position
        </button>
        <button
          v-if="botFeatures.reloadTrade"
          class="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-surface-200 dark:hover:bg-surface-700 w-full text-left cursor-pointer transition-colors"
          @click="handleReloadTrade(trade)"
        >
          <i-mdi-reload-alert class="text-surface-500" /> Reload
        </button>

        <!-- Separator -->
        <div class="border-t border-surface-200 dark:border-surface-700 my-0.5" />

        <!-- Delete (destructive) -->
        <button
          class="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-red-500/10 w-full text-left cursor-pointer transition-colors text-red-400"
          @click="handleDeleteTrade(trade)"
        >
          <i-mdi-delete class="text-red-500" /> Delete trade
        </button>

        <!-- Navigation separator -->
        <div class="border-t border-surface-200 dark:border-surface-700 my-0.5" />

        <!-- Navigation actions -->
        <button
          class="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-surface-200 dark:hover:bg-surface-700 w-full text-left cursor-pointer transition-colors"
          @click="viewChart"
        >
          <i-mdi-chart-line class="text-surface-500" /> {{ t('enhancedTrades.viewChart') }}
        </button>
        <button
          v-if="exchangeUrl"
          class="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-surface-200 dark:hover:bg-surface-700 w-full text-left cursor-pointer transition-colors"
          @click="viewOnExchange"
        >
          <i-mdi-open-in-new class="text-surface-500" /> {{ t('enhancedTrades.viewOnExchange') }}
        </button>
      </div>
    </Popover>
  </div>
</template>
