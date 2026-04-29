<script setup lang="ts">
import type { Trade } from '@/types';
import {
  useTradeColumnVisibility,
  humanizeTradeDuration,
  tradeDurationMs,
  timeAgo,
  durationAnomalyLevel, durationAnomalyLevelFromPct,
  durationAnomalyPct,
  rowBgClass,
  profitBgClass,
  exitReasonColor,
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

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    trades: Trade[];
    multiBotView?: boolean;
  }>(),
  { multiBotView: false },
);

const botStore = useBotStore();
const router = useRouter();

const { allColumns, visibleColumns, toggleColumn, isVisible } = useTradeColumnVisibility('closed');

const filterText = ref('');
const sortField = ref<string>('close_timestamp');
const sortOrder = ref<number>(-1);
const selectedItem = ref();
const perPage = ref(50);
const currentPage = ref(1);
const columnPopover = ref<InstanceType<typeof Popover>>();

// Unified popover system
const {
  activePopover, activeTrade, activeBotId, popoverStyle, arrowStyle, actualPlacement,
  show: showPopover, showStats, hide: hidePopover, keepAlive,
} = useTradePopover();

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
        t.exit_reason?.toLowerCase().includes(f) ||
        t.enter_tag?.toLowerCase().includes(f) ||
        (botStore.botStores[t.botId]?.botState?.dry_run ? 'dry' : 'live').includes(f),
    );
  }
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

    <DataTable
      v-model:selection="selectedItem"
      :value="filteredTrades"
      :rows="perPage"
      :paginator="true"
      :first="(currentPage - 1) * perPage"
      :rows-per-page-options="[25, 50, 100]"
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
        {{ t('tradeList.noClosedTrades') }}
      </template>

      <Column
        v-for="col in visibleColumns"
        :key="col.key"
        :field="col.key"
        :sortable="col.sortable !== false"
        :sort-field="col.key === 'duration' ? '_durationMs' : col.key === 'duration_anomaly' ? '_durationAnomalyPct' : col.key === 'dca_info' ? 'nr_of_successful_entries' : col.key === 'open_date' ? 'open_timestamp' : col.key === 'close_date' ? 'close_timestamp' : col.key"
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
            <span
              class="cursor-help"
              @mouseenter="showPopover('tradeDetail', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >
              {{ data.pair }}
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
            >{{ formatPrice(data.open_rate) }}</span>
          </template>

          <!-- Profit % -->
          <template v-else-if="col.key === 'profit_pct'">
            <span
              class="inline-block px-1 py-0.5 rounded text-xs font-mono font-semibold"
              :class="profitBgClass(data.profit_pct)"
            >
              <span :class="(data.profit_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'">
                {{ data.profit_pct !== null && data.profit_pct !== undefined ? (data.profit_pct >= 0 ? '+' : '') + data.profit_pct.toFixed(2) + '%' : 'N/A' }}
              </span>
            </span>
          </template>

          <!-- Profit Abs -->
          <template v-else-if="col.key === 'profit_abs'">
            <span
              class="font-mono text-xs"
              :class="(data.profit_abs ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'"
            >
              {{ data.profit_abs !== undefined ? (data.profit_abs >= 0 ? '+' : '') + formatPrice(data.profit_abs, 3) : 'N/A' }}
              <span v-if="data.profit_abs !== undefined && data.stake_currency" class="text-xs opacity-50">{{ data.stake_currency }}</span>
            </span>
          </template>

          <!-- Stake -->
          <template v-else-if="col.key === 'stake_amount'">
            {{ formatPriceWithDecimals(data.max_stake_amount ?? data.stake_amount) }}
          </template>

          <!-- Duration -->
          <template v-else-if="col.key === 'duration'">
            <span
              class="text-xs cursor-help"
              @mouseenter="showPopover('duration', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >{{ humanizeTradeDuration(data) }}</span>
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
                  :class="durationAnomalyLevelFromPct(durationAnomalyPct(data, props.trades)) === 'ok' ? 'bg-green-500' : durationAnomalyLevelFromPct(durationAnomalyPct(data, props.trades)) === 'warn' ? 'bg-amber-500' : 'bg-red-500'"
                  :style="{ width: `${Math.min(durationAnomalyPct(data, props.trades), 100)}%` }"
                />
              </div>
            </div>
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

          <!-- Open Date -->
          <template v-else-if="col.key === 'open_date'">
            <DateTimeTZ :date="data.open_timestamp" />
          </template>

          <!-- Close Date -->
          <template v-else-if="col.key === 'close_date'">
            <DateTimeTZ :date="data.close_timestamp ?? 0" />
          </template>

          <!-- Close Price -->
          <template v-else-if="col.key === 'close_rate'">
            <span
              class="cursor-help"
              @mouseenter="showPopover('chart', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >{{ formatPrice(data.close_rate) }}</span>
          </template>

          <!-- Close Reason -->
          <template v-else-if="col.key === 'exit_reason'">
            <span
              v-if="data.exit_reason"
              class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold cursor-help"
              :class="exitReasonColor(data.exit_reason)"
              @mouseenter="showPopover('exitReason', $event, data as Trade)"
              @mouseleave="hidePopover()"
            >
              {{ data.exit_reason }}
            </span>
          </template>

          <!-- Closed Ago -->
          <template v-else-if="col.key === 'closed_ago'">
            <span class="text-xs text-surface-400">{{ data.close_timestamp ? timeAgo(data.close_timestamp) : '-' }}</span>
          </template>

          <!-- Fee -->
          <template v-else-if="col.key === 'fee'">
            <span class="text-xs font-mono">
              {{ data.fee_open !== undefined ? (data.fee_open * 100).toFixed(3) + '%' : '' }}
              {{ data.fee_close !== undefined ? '/ ' + ((data.fee_close ?? 0) * 100).toFixed(3) + '%' : '' }}
            </span>
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
      :is-open="false"
      @keep="keepAlive"
      @leave="hidePopover"
    >
      <template #tradeDetail="{ trade: t }">
        <TradeDetailPopover :trade="t" :is-open="false" :closed-trades="trades" />
      </template>
      <template #chart="{ trade: t, botId: bid }">
        <ChartPopover :trade="t" :bot-id="bid" :is-closed="true" />
      </template>
      <template #duration="{ trade: t, trades: allTrades }">
        <DurationHealthPopover :trade="t" :closed-trades="allTrades" :is-open="false" />
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
  </div>
</template>
