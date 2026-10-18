<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, SegmentedControl } from '@/components/ds';
import { useActionNav } from '@/composables/useActionNav';
import { useTradeOrders } from '@/composables/useTradeOrders';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { DataSource } from '@/datasource/types';
import type { Position } from '@/gateway/types.gen';

import CandleChart from './CandleChart.vue';
import { overlaysFromPosition, type Overlays } from './lib/candles';
import { effectiveTf, tfMs } from './lib/chartsPage';
import { closedTradeOverlays, type ChartTrade } from './lib/chartTrades';
import { pairLabel } from './lib/trades';

/**
 * The chart of one trade, open or closed: the pair in the timeframe of the bot's strategy, with the
 * entry, the top-ups (the fills read from the orders of the trade) and the exit, framed on the
 * life of the trade. A closed trade that ended beyond what the bot holds is read from the local
 * history of the gateway, back to its open; the chart says so and offers the other timeframes.
 * Used in the drawers and the sheets, where the page has no chart of its own.
 */
const props = withDefaults(
  defineProps<{
    /** The trade: `close_ms` null is an open one. */
    trade: ChartTrade;
    /** The live position of an open trade: its average entry and liquidation are drawn. */
    position?: Position | null;
    height?: string;
    /** A "Open large" button leads to the Bot page on this trade. */
    expandable?: boolean;
    /** A source to use instead of the active one (previews, tests). */
    source?: DataSource | null;
  }>(),
  { position: null, height: '300px', expandable: true },
);

const { t } = useI18n();
const fleet = useFqFleetStore();
const nav = useActionNav();

const bot = computed(() => fleet.bots[props.trade.bot_key] ?? null);
const ownTf = computed(() => bot.value?.identity.timeframe ?? null);
const pick = ref<string | null>(null);
const tf = computed({
  get: () => effectiveTf(pick.value, ownTf.value),
  set: (v: string) => (pick.value = v),
});
const TFS = ['5m', '15m', '1h', '4h'];
const tfOptions = computed(() =>
  [...new Set([...TFS, ...(ownTf.value ? [ownTf.value] : [])])]
    .sort((a, b) => (tfMs(a) || 0) - (tfMs(b) || 0))
    .map((v) => ({ value: v, label: v })),
);

const isClosed = computed(() => props.trade.close_ms != null);
const orders = useTradeOrders(
  () => props.trade.bot_key,
  () => props.trade.trade_id,
  () => props.trade.side,
);

const overlays = computed<Overlays>(() => {
  const tr = props.trade;
  const fills = orders.model.value?.fills ?? [];
  if (isClosed.value) {
    return closedTradeOverlays(tr, fills, (r) =>
      r.kind === 'custom' ? r.raw : t(`fq.exit.${r.kind}`),
    );
  }
  if (props.position) {
    return overlaysFromPosition(props.position, tr.pair, {
      orders: orders.model.value?.ladder ?? [],
      fills,
    });
  }
  return { average: tr.open_rate, fills, openTs: tr.open_ms };
});

// The ladder of the pair is not shown for a closed trade: its toggles are the default ones
const subs = ref<string[] | null>(null);
// The orders could not be read: said, the trade is then drawn with its entry and exit only
const noOrders = computed(() => orders.loading.value === false && orders.rows.value === null);
</script>

<template>
  <div class="tc" data-testid="trade-chart" :data-closed="isClosed ? 1 : 0">
    <div class="bar">
      <span class="ttl">{{ t('fq.tradeChart.title', { pair: pairLabel(trade.pair) }) }}</span>
      <SegmentedControl
        v-model="tf"
        :options="tfOptions"
        size="sm"
        :label="t('fq.pg.bot.timeframe')"
      />
      <Btn
        v-if="expandable"
        size="sm"
        variant="ghost"
        icon="chart-candlestick"
        data-testid="trade-chart-expand"
        @click="nav.navigateAction('openTrade', { botKey: trade.bot_key, tradeId: trade.trade_id })"
      >
        {{ t('fq.tradeChart.expand') }}
      </Btn>
    </div>
    <div class="body" :style="{ height }">
      <CandleChart
        :key="`${trade.bot_key}/${trade.pair}/${trade.trade_id}`"
        :bot-key="trade.bot_key"
        :pair="trade.pair"
        :tf="tf"
        :overlays="overlays"
        :anchor-end-ms="trade.close_ms"
        :frame-max="3000"
        :controls="false"
        :announce="false"
        :sub-choice="subs"
        :source="source"
        height="100%"
        @update:sub-choice="(ids) => (subs = ids)"
      />
    </div>
    <p v-if="noOrders" class="note" data-testid="trade-chart-no-orders">
      {{ t('fq.tradeChart.noOrders') }}
    </p>
  </div>
</template>

<style scoped>
.tc {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--bg-1);
}
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s2);
  padding: 4px var(--s2);
  border-bottom: 1px solid var(--line);
}
.ttl {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--t-sm);
  font-weight: 600;
}
.body {
  min-height: 0;
  min-width: 0;
}
.note {
  margin: 0;
  padding: 4px var(--s3);
  color: var(--fg-3);
  font-size: var(--t-xs);
}
</style>
