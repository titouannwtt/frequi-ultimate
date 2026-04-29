<script setup lang="ts">
import type { MultiDeletePayload, MultiForceExitPayload, Trade } from '@/types';
import {
  useTradeColumnVisibility,
  humanizeTradeDuration,
  tradeDurationMs,
  timeAgo,
  stoplossDistancePct,
  durationAnomalyLevel, durationAnomalyLevelFromPct,
  durationAnomalyPct,
  rowBgClass,
  profitBgClass,
} from '@/composables/tradeColumns';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import Popover from 'primevue/popover';
import { useTradePopover } from '@/composables/useTradePopover';
import TradePopoverHost from './TradePopoverHost.vue';
import TradeDetailPopover from './TradeDetailPopover.vue';
import DurationHealthPopover from './DurationHealthPopover.vue';
import ChartPopover from './ChartPopover.vue';
import DcaInfoPopover from './DcaInfoPopover.vue';
import TypeLeveragePopover from './TypeLeveragePopover.vue';
import ExitReasonPopover from './ExitReasonPopover.vue';

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
    multiBotView?: boolean;
  }>(),
  { multiBotView: false },
);

const botStore = useBotStore();
const settingsStore = useSettingsStore();
const router = useRouter();

const { allColumns, visibleColumns, toggleColumn, isVisible } = useTradeColumnVisibility('open');

const filterText = ref('');
const sortField = ref<string>('open_timestamp');
const sortOrder = ref<number>(1);
const selectedItem = ref();
const columnPopover = ref<InstanceType<typeof Popover>>();

// Unified popover system
const {
  activePopover, activeTrade, activeBotId, popoverStyle, arrowStyle, actualPlacement,
  show: showPopover, showStats, hide: hidePopover, keepAlive, close: closePopover,
} = useTradePopover();

// ── Correlation detection ──
const DISMISSED_KEY = 'ft_dismissed_correlations';

const dismissedCorrelations = ref<Set<string>>(new Set(
  JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'),
));

const correlatedTrades = computed(() => {
  // Find pairs traded by multiple bots simultaneously
  const pairMap: Record<string, { botId: string; botName: string; tradeId: number }[]> = {};
  for (const [botId, trades] of Object.entries(botStore.allOpenTrades)) {
    if (!botStore.botStores[botId]?.isSelected) continue;
    for (const trade of trades || []) {
      if (!pairMap[trade.pair]) pairMap[trade.pair] = [];
      pairMap[trade.pair].push({
        botId,
        botName: botStore.botStores[botId]?.uiBotName ?? botId,
        tradeId: trade.trade_id,
      });
    }
  }
  // Only pairs with 2+ bots, and build a dismissable key per correlation
  return Object.entries(pairMap)
    .filter(([, entries]) => entries.length > 1)
    .map(([pair, entries]) => {
      const key = entries.map((e) => `${e.botId}_${e.tradeId}`).sort().join('|');
      return { pair, entries, key };
    })
    .filter((c) => !dismissedCorrelations.value.has(c.key));
});

function dismissCorrelation(key: string) {
  dismissedCorrelations.value.add(key);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedCorrelations.value]));
}

// Map of pair → detailed correlation info for badge + popover
const CORR_COLORS = ['#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#22c55e'];

interface CorrelationInfo {
  count: number;
  color: string;
  positions: {
    botName: string;
    isShort: boolean;
    leverage: number;
    stakeAmount: number;
    profitPct: number;
    profitAbs: number;
  }[];
  totalMargin: number;
  totalNotional: number;
  sameDirection: boolean;
}

const correlationBadges = computed(() => {
  const pairMap: Record<string, { botId: string; trade: any }[]> = {};
  for (const [botId, trades] of Object.entries(botStore.allOpenTrades)) {
    if (!botStore.botStores[botId]?.isSelected) continue;
    for (const trade of trades || []) {
      if (!pairMap[trade.pair]) pairMap[trade.pair] = [];
      pairMap[trade.pair].push({
        botId,
        trade,
      });
    }
  }
  const result: Record<string, CorrelationInfo> = {};
  let colorIdx = 0;
  for (const [pair, entries] of Object.entries(pairMap)) {
    if (entries.length > 1) {
      const positions = entries.map((e) => ({
        botName: botStore.botStores[e.botId]?.uiBotName ?? e.botId,
        isShort: e.trade.is_short ?? false,
        leverage: e.trade.leverage ?? 1,
        stakeAmount: e.trade.stake_amount ?? 0,
        profitPct: e.trade.profit_pct ?? 0,
        profitAbs: e.trade.profit_abs ?? 0,
      }));
      const totalMargin = positions.reduce((s, p) => s + p.stakeAmount, 0);
      const totalNotional = positions.reduce((s, p) => s + p.stakeAmount * p.leverage, 0);
      const directions = positions.map((p) => p.isShort);
      const sameDirection = directions.every((d) => d === directions[0]);
      result[pair] = {
        count: entries.length,
        color: CORR_COLORS[colorIdx % CORR_COLORS.length],
        positions,
        totalMargin,
        totalNotional,
        sameDirection,
      };
      colorIdx++;
    }
  }
  return result;
});

// ── Correlation popover ──
const corrPopover = ref<InstanceType<typeof Popover>>();
const corrHoverPair = ref<string | null>(null);

// Action state
const feTrade = ref<Trade>({} as Trade);
const feOrderType = ref<string | undefined>(undefined);
const forceExitVisible = ref(false);
const removeTradeVisible = ref(false);
const confirmExitText = ref('');
const confirmExitValue = ref<ModalReasons | null>(null);
const increasePosition = ref({ visible: false, trade: {} as Trade });

function showColumnPopover(event: Event) {
  columnPopover.value?.toggle(event);
}

defineExpose({ showColumnPopover });

const filteredTrades = computed(() => {
  let result = props.trades;
  if (filterText.value) {
    const f = filterText.value.toLowerCase();
    result = result.filter(
      (t) =>
        t.pair.toLowerCase().includes(f) ||
        t.botName?.toLowerCase().includes(f) ||
        t.enter_tag?.toLowerCase().includes(f) ||
        (botStore.botStores[t.botId]?.botState?.dry_run ? 'dry' : 'live').includes(f),
    );
  }
  // Add computed sort fields for columns that don't map to a Trade property
  return result.map((t) => ({
    ...t,
    _durationMs: tradeDurationMs(t),
    _durationAnomalyPct: durationAnomalyPct(t, props.trades),
    botState: botStore.botStores[t.botId]?.botState?.dry_run ? 'Dry' : 'Live',
  }));
});

function formatPriceWithDecimals(price: number) {
  return formatPrice(price, botStore.activeBot?.stakeCurrencyDecimals);
}

function onSort(event: { sortField: string; sortOrder: number }) {
  sortField.value = event.sortField;
  sortOrder.value = event.sortOrder;
}

// All popover hover handlers replaced by useTradePopover — see showPopover/hidePopover/showStats

// Trade actions
function forceExitHandler(item: Trade, ordertype: string | undefined = undefined) {
  feTrade.value = item;
  confirmExitValue.value = ModalReasons.forceExit;
  confirmExitText.value = t('tradeList.confirmExit', { id: item.trade_id, pair: item.pair, orderType: ordertype });
  feOrderType.value = ordertype;
  if (settingsStore.confirmDialog === true) {
    removeTradeVisible.value = true;
  } else {
    forceExitExecuter();
  }
}

function forceExitExecuter() {
  if (confirmExitValue.value === ModalReasons.removeTrade) {
    const payload: MultiDeletePayload = { tradeid: String(feTrade.value.trade_id), botId: feTrade.value.botId };
    botStore.deleteTradeMulti(payload).catch((error) => console.log(error.response));
  }
  if (confirmExitValue.value === ModalReasons.forceExit) {
    const payload: MultiForceExitPayload = { tradeid: String(feTrade.value.trade_id), botId: feTrade.value.botId };
    if (feOrderType.value) payload.ordertype = feOrderType.value;
    botStore.forceSellMulti(payload).then((x) => console.log(x)).catch((error) => console.log(error.response));
  }
  if (confirmExitValue.value === ModalReasons.cancelOpenOrder) {
    const payload: MultiDeletePayload = { tradeid: String(feTrade.value.trade_id), botId: feTrade.value.botId };
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

const onRowClicked = ({ data: item }: { data: Trade }) => {
  if (props.multiBotView && botStore.selectedBot !== item.botId) {
    botStore.selectBot(item.botId);
  }
  if (item && item.trade_id !== botStore.activeBot?.detailTradeId) {
    botStore.activeBot?.setDetailTrade(item);
    if (props.multiBotView) {
      router.push({ name: 'Freqtrade Trading' });
    }
  } else {
    botStore.activeBot?.setDetailTrade(null);
  }
};

watch(
  () => botStore.activeBot?.detailTradeId,
  (val) => {
    const index = props.trades.findIndex((v) => v.trade_id === val);
    if (index < 0) selectedItem.value = undefined;
  },
);
</script>

<template>
  <div class="h-full overflow-hidden w-full flex flex-col">
    <!-- Filter bar -->
    <div class="flex items-center gap-2 px-2 py-1 flex-shrink-0">
      <InputText
        v-model="filterText"
        :placeholder="t('enhancedTrades.filterPlaceholder')"
        class="w-48"
        size="small"
      />
      <span class="text-xs text-surface-500">
        {{ filteredTrades.length }} {{ t('enhancedTrades.trades') }}
      </span>
    </div>

    <!-- Correlation alerts with dismiss -->
    <div v-if="correlatedTrades.length > 0" class="overflow-y-auto flex-shrink-0" style="max-height: 80px">
      <div
        v-for="corr in correlatedTrades"
        :key="corr.key"
        class="flex items-center gap-2 mx-2 mb-1 px-2 py-1 rounded text-[11px]"
        style="background: rgba(120, 80, 0, 0.2); border: 1px solid rgba(180, 130, 0, 0.25); color: #fbbf24"
      >
        <i-mdi-alert class="flex-shrink-0" style="font-size: 0.75rem" />
        <span class="flex-1">
          <strong>{{ corr.pair }}</strong> — {{ t('corrPopover.tradedBy', { bots: corr.entries.map(e => e.botName).join(' & ') }) }}
        </span>
        <button
          class="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] cursor-pointer hover:bg-amber-500/20 transition-colors"
          style="color: #92700a"
          :title="t('corrPopover.dismiss')"
          @click="dismissCorrelation(corr.key)"
        >✕ {{ t('corrPopover.dismiss') }}</button>
      </div>
    </div>

    <DataTable
      v-model:selection="selectedItem"
      :value="filteredTrades"
      :rows="200"
      selection-mode="single"
      class="text-center text-xs flex-1 min-h-0"
      size="small"
      :scrollable="true"
      scroll-height="flex"
      :sort-field="sortField"
      :sort-order="sortOrder"
      removable-sort
      :row-class="(data: Trade) => rowBgClass(data)"
      @sort="onSort"
      @row-click="onRowClicked"
    >
      <template #empty>
        {{ t('tradeList.currentlyNoOpen') }}
      </template>

      <Column
        v-for="col in visibleColumns"
        :key="col.key"
        :field="col.key"
        :sortable="col.sortable !== false"
        :sort-field="col.key === 'duration' ? '_durationMs' : col.key === 'duration_anomaly' ? '_durationAnomalyPct' : col.key === 'dca_info' ? 'nr_of_successful_entries' : col.key === 'open_date' ? 'open_timestamp' : col.key"
        :style="col.key === 'actions' ? 'width: 40px' : ''"
      >
        <template #header>
          <div class="flex items-center gap-1">
            <component :is="col.icon" v-if="col.icon" class="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
            <span>{{ t(col.labelKey) }}</span>
          </div>
        </template>
        <template #body="{ data }">
          <!-- Bot State (Dry/Live) -->
          <template v-if="col.key === 'botState'">
            <span
              class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold"
              :class="botStore.botStores[data.botId]?.botState?.dry_run ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'"
            >
              {{ botStore.botStores[data.botId]?.botState?.dry_run ? 'Dry' : 'Live' }}
            </span>
          </template>

          <!-- Bot Name -->
          <template v-else-if="col.key === 'botName'">
            <span class="font-semibold text-xs">{{ data.botName }}</span>
          </template>

          <!-- Pair -->
          <template v-else-if="col.key === 'pair'">
            <span class="flex items-center gap-1">
              <span
                class="cursor-help"
                @mouseenter="showPopover('tradeDetail', $event, data as Trade)"
                @mouseleave="hidePopover()"
              >
                {{ data.pair }}{{ data.has_open_orders ? '*' : '' }}
              </span>
              <span
                v-if="correlationBadges[data.pair]"
                class="inline-flex items-center justify-center w-4 h-4 rounded-full text-[8px] font-bold flex-shrink-0 cursor-help"
                :style="{
                  background: correlationBadges[data.pair].color + '25',
                  color: correlationBadges[data.pair].color,
                  border: '1px solid ' + correlationBadges[data.pair].color + '50',
                }"
                @mouseenter="corrHoverPair = data.pair; corrPopover?.show({ currentTarget: $event.currentTarget } as unknown as Event)"
                @mouseleave="corrPopover?.hide(); corrHoverPair = null"
              >{{ correlationBadges[data.pair].count }}</span>
            </span>
          </template>

          <!-- Type: Short/Long -->
          <template v-else-if="col.key === 'type'">
            <span
              v-if="data.trading_mode !== 'spot'"
              class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold cursor-help"
              :class="data.is_short ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'"
              @mouseenter="showStats('typeLeverage', $event)"
              @mouseleave="hidePopover()"
            >
              {{ data.is_short ? 'S' : 'L' }}
            </span>
            <span v-else class="text-surface-400 text-[10px]">spot</span>
          </template>

          <!-- Leverage -->
          <template v-else-if="col.key === 'leverage'">
            <span
              v-if="data.leverage && data.leverage > 1"
              class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-400 cursor-help"
              @mouseenter="showStats('typeLeverage', $event)"
              @mouseleave="hidePopover()"
            >
              {{ data.leverage }}x
            </span>
            <span v-else class="text-surface-400">1x</span>
          </template>

          <!-- Entry Price -->
          <template v-else-if="col.key === 'open_rate'">
            <span
              class="cursor-help"
              @mouseenter="showPopover('chart', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >
              {{ formatPrice(data.open_rate) }}
            </span>
          </template>

          <!-- Current Price -->
          <template v-else-if="col.key === 'current_rate'">
            <span
              class="cursor-help"
              @mouseenter="showPopover('chart', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >
              {{ formatPrice(data.current_rate) }}
            </span>
          </template>

          <!-- Profit % -->
          <template v-else-if="col.key === 'profit_pct'">
            <span
              class="inline-block px-1 py-0.5 rounded text-xs font-mono font-semibold cursor-help"
              :class="profitBgClass(data.profit_pct)"
              @mouseenter="showPopover('chart', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >
              <span :class="(data.profit_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'">
                {{ data.profit_pct !== null && data.profit_pct !== undefined ? (data.profit_pct >= 0 ? '+' : '') + data.profit_pct.toFixed(2) + '%' : 'N/A' }}
              </span>
            </span>
          </template>

          <!-- Profit Abs -->
          <template v-else-if="col.key === 'profit_abs'">
            <span
              class="font-mono text-xs cursor-help"
              :class="(data.profit_abs ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'"
              @mouseenter="showPopover('chart', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >
              {{ data.profit_abs !== undefined ? (data.profit_abs >= 0 ? '+' : '') + formatPrice(data.profit_abs, 3) : 'N/A' }}
            </span>
          </template>

          <!-- Stake -->
          <template v-else-if="col.key === 'stake_amount'">
            {{ formatPriceWithDecimals(data.stake_amount) }}
          </template>

          <!-- Duration -->
          <template v-else-if="col.key === 'duration'">
            <span
              class="text-xs cursor-help"
              @mouseenter="showPopover('duration', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >{{ humanizeTradeDuration(data) }}</span>
          </template>

          <!-- Open Reason / Entry Tag -->
          <template v-else-if="col.key === 'enter_tag'">
            <span
              v-if="data.enter_tag"
              class="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-500/20 text-indigo-300 cursor-help"
              @mouseenter="showPopover('exitReason', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >
              {{ data.enter_tag }}
            </span>
            <span v-else class="text-surface-400">-</span>
          </template>

          <!-- Stoploss Distance -->
          <template v-else-if="col.key === 'stoploss_dist'">
            <span
              v-if="stoplossDistancePct(data) !== null"
              class="text-xs font-mono cursor-help"
              @mouseenter="showPopover('chart', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >
              {{ stoplossDistancePct(data)!.toFixed(2) }}%
            </span>
            <span v-else class="text-surface-400">-</span>
          </template>

          <!-- Duration Anomaly (inline bar) -->
          <template v-else-if="col.key === 'duration_anomaly'">
            <div
              class="flex items-center gap-1 cursor-help"
              style="min-width: 50px"
              @mouseenter="showPopover('duration', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >
              <div class="flex-1 h-1.5 rounded-full bg-gray-700 overflow-hidden">
                <div
                  class="h-full rounded-full"
                  :class="durationAnomalyLevelFromPct(durationAnomalyPct(data, botStore.activeBot?.trades)) === 'ok' ? 'bg-green-500' : durationAnomalyLevelFromPct(durationAnomalyPct(data, botStore.activeBot?.trades)) === 'warn' ? 'bg-amber-500' : 'bg-red-500'"
                  :style="{ width: `${Math.min(durationAnomalyPct(data, botStore.activeBot?.trades), 100)}%` }"
                />
              </div>
            </div>
          </template>

          <!-- Open Date -->
          <template v-else-if="col.key === 'open_date'">
            <DateTimeTZ :date="data.open_timestamp" />
          </template>

          <!-- DCA Info -->
          <template v-else-if="col.key === 'dca_info'">
            <span
              v-if="(data.nr_of_successful_entries ?? 1) > 1"
              class="inline-block px-1 py-0.5 rounded text-[10px] font-mono cursor-help"
              style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.15)"
              @mouseenter="showPopover('dca', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >
              <span class="text-purple-300 font-semibold">#{{ data.nr_of_successful_entries }}</span>
              <span v-if="data.max_stake_amount" class="text-surface-400 ml-1">{{ data.max_stake_amount.toFixed(1) }}</span>
            </span>
            <span v-else class="text-surface-600">—</span>
          </template>

          <!-- Actions -->
          <template v-else-if="col.key === 'actions'">
            <TradeActionsPopover
              :id="data.trade_id"
              :enable-force-entry="botStore.activeBot?.botState?.force_entry_enable"
              :trade="data as Trade"
              :bot-features="botStore.activeBot?.botFeatures"
              @delete-trade="removeTradeHandler(data as Trade)"
              @force-exit="forceExitHandler"
              @force-exit-partial="forceExitPartialHandler"
              @cancel-open-order="cancelOpenOrderHandler"
              @reload-trade="reloadTradeHandler"
              @force-entry="handleForceEntry"
            />
          </template>

          <template v-else>
            {{ (data as Record<string, any>)[col.key] }}
          </template>
        </template>
      </Column>
    </DataTable>

    <!-- Unified Popover Host -->
    <TradePopoverHost
      :active="activePopover"
      :trade="activeTrade"
      :bot-id="activeBotId"
      :style-obj="popoverStyle"
      :arrow-style="arrowStyle"
      :actual-placement="actualPlacement"
      :trades="trades"
      :is-open="true"
      @keep="keepAlive"
      @leave="hidePopover"
    >
      <template #tradeDetail="{ trade: t }">
        <TradeDetailPopover :trade="t" :is-open="true" />
      </template>
      <template #chart="{ trade: t, botId: bid }">
        <ChartPopover :trade="t" :bot-id="bid" />
      </template>
      <template #duration="{ trade: t }">
        <DurationHealthPopover
          :trade="t"
          :closed-trades="botStore.botStores[t.botId || botStore.selectedBot]?.trades ?? []"
          :is-open="true"
        />
      </template>
      <template #dca="{ trade: t }">
        <DcaInfoPopover :trade="t" />
      </template>
      <template #typeLeverage="{ trades: allTrades }">
        <TypeLeveragePopover :trades="allTrades" />
      </template>
      <template #exitReason="{ trade: t, trades: allTrades }">
        <ExitReasonPopover :trade="t" :trades="allTrades" />
      </template>
    </TradePopoverHost>

    <!-- Correlation Popover -->
    <Popover ref="corrPopover" class="p-0">
      <div
        v-if="corrHoverPair && correlationBadges[corrHoverPair]"
        class="p-4 min-w-[320px] max-w-[400px]"
        @mouseenter.stop
        @mouseleave="corrPopover?.hide(); corrHoverPair = null"
      >
        <!-- Header -->
        <div class="flex items-center gap-2 mb-3">
          <span
            class="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold"
            :style="{
              background: correlationBadges[corrHoverPair].color + '25',
              color: correlationBadges[corrHoverPair].color,
              border: '1px solid ' + correlationBadges[corrHoverPair].color + '50',
            }"
          >{{ correlationBadges[corrHoverPair].count }}</span>
          <div>
            <div class="text-sm font-bold text-surface-100">{{ corrHoverPair }}</div>
            <div class="text-[11px] text-surface-400">{{ t('corrPopover.doubleExposure') }}</div>
          </div>
        </div>

        <!-- Positions breakdown -->
        <div class="space-y-1.5 mb-3">
          <div
            v-for="(pos, i) in correlationBadges[corrHoverPair].positions"
            :key="i"
            class="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px]"
            style="background: rgba(255,255,255,0.03)"
          >
            <span class="font-semibold text-surface-200 flex-1 truncate">{{ pos.botName }}</span>
            <span
              class="px-1.5 py-0.5 rounded text-[10px] font-bold"
              :class="pos.isShort ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'"
            >{{ pos.isShort ? 'SHORT' : 'LONG' }}</span>
            <span v-if="pos.leverage > 1" class="text-[10px] font-bold text-yellow-400">{{ pos.leverage }}x</span>
            <span class="font-mono text-[11px] text-surface-300">{{ pos.stakeAmount.toFixed(1) }}</span>
            <span
              class="font-mono text-[11px] font-bold"
              :class="pos.profitPct >= 0 ? 'text-green-400' : 'text-red-400'"
            >{{ pos.profitPct >= 0 ? '+' : '' }}{{ pos.profitPct.toFixed(2) }}%</span>
          </div>
        </div>

        <!-- Risk summary -->
        <div class="rounded-lg p-2.5 mb-2" :style="{ background: correlationBadges[corrHoverPair].color + '10', border: '1px solid ' + correlationBadges[corrHoverPair].color + '20' }">
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
            <span class="text-surface-400">{{ t('corrPopover.combinedMargin') }}</span>
            <span class="font-mono font-bold text-surface-200">{{ correlationBadges[corrHoverPair].totalMargin.toFixed(1) }} USDC</span>
            <span class="text-surface-400">{{ t('corrPopover.combinedNotional') }}</span>
            <span class="font-mono font-bold text-surface-200">{{ correlationBadges[corrHoverPair].totalNotional.toFixed(1) }} USDC</span>
            <span class="text-surface-400">{{ t('corrPopover.direction') }}</span>
            <span class="font-bold" :class="correlationBadges[corrHoverPair].sameDirection ? 'text-amber-400' : 'text-red-400'">
              {{ correlationBadges[corrHoverPair].sameDirection ? t('corrPopover.sameDirection') : t('corrPopover.oppositeDirection') }}
            </span>
          </div>
        </div>

        <!-- Warning -->
        <div class="flex items-start gap-2 text-[11px] text-surface-400">
          <i-mdi-alert class="text-amber-400 flex-shrink-0 mt-0.5" style="font-size: 0.8rem" />
          <span>
            {{ correlationBadges[corrHoverPair].sameDirection
              ? t('corrPopover.warningSame')
              : t('corrPopover.warningOpposite')
            }}
          </span>
        </div>
      </div>
    </Popover>

    <!-- Column Selector Popover -->
    <Popover ref="columnPopover" class="p-0">
      <div class="p-3 min-w-[200px]">
        <div class="font-bold text-sm mb-2">{{ t('enhancedTrades.columnSettings') }}</div>
        <div v-for="col in allColumns" :key="col.key" class="flex items-center gap-2 py-0.5">
          <Checkbox
            :model-value="isVisible(col.key)"
            :binary="true"
            @update:model-value="toggleColumn(col.key)"
          />
          <span class="text-xs">{{ t(col.labelKey) }}</span>
        </div>
      </div>
    </Popover>

    <!-- Modals -->
    <ForceExitForm
      v-model="forceExitVisible"
      :trade="feTrade"
      :stake-currency-decimals="botStore.activeBot?.botState?.stake_currency_decimals ?? 3"
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
