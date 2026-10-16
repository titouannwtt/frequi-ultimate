<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, DirectionChip, Pane } from '@/components/ds';
import { useChartDisplay, useSubplotChoice } from '@/composables/useChartDisplay';
import { useClosedOnPair } from '@/composables/useClosedOnPair';
import { useTradeOrders } from '@/composables/useTradeOrders';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { BotKey } from '@/gateway/types.gen';
import type { PlotConfig } from '@/types';

import CandleChart from './CandleChart.vue';
import { overlaysFromPosition, type OverlayToggles, type SubplotInfo } from './lib/candles';
import { closedMarks, gainFromPosition, pendingOrders } from './lib/chartTrades';
import { pairLabel } from './lib/trades';

/**
 * One cell of the Charts page (02 section 3.3): the same `CandleChart` as the Bot page, with the
 * levels of the position the context bot holds on this pair, the HA switch and the links to the
 * bot and to the position. The overlays come from THIS bot's position only: a position of another
 * bot on the same pair is not drawn on this chart. What is drawn over the candles is the page's
 * "Affichage" menu (`toggles`, or the remembered choice when the cell stands alone); the sub-chart
 * is one by default, and the ones the user adds are remembered per strategy.
 */
const props = withDefaults(
  defineProps<{
    botKey: BotKey;
    pair: string;
    tf: string;
    heikinAshi?: boolean;
    plotConfig?: PlotConfig | null;
    plotExtra?: Partial<PlotConfig> | null;
    measureArmed?: boolean;
    toggles?: Partial<OverlayToggles>;
    active?: boolean;
    height?: string;
  }>(),
  { heikinAshi: false, measureArmed: false, active: false, height: '100%' },
);

const emit = defineEmits<{
  select: [];
  subplots: [list: SubplotInfo[]];
  openBot: [botKey: BotKey, pair: string];
  openTrade: [botKey: BotKey, tradeId: number];
}>();

const { t, te } = useI18n();
const fleet = useFqFleetStore();
const positions = useFqPositionsStore();

const bot = computed(() => fleet.bots[props.botKey] ?? null);
const position = computed(
  () => positions.byBot(props.botKey).find((p) => p.pair === props.pair) ?? null,
);
const tradeId = computed(() => position.value?.trade_id ?? null);
const orders = useTradeOrders(
  () => props.botKey,
  tradeId,
  () => position.value?.side ?? 'long',
);
// The orders that wait (DCA, take profit, stop), the gain now and the closed trades of this pair
// Direct mode reads their price from the bot; the gateway ledger has none, so there they are unknown
const pending = computed(() =>
  orders.rows.value
    ? pendingOrders(orders.rows.value, position.value?.side ?? 'long', position.value?.open_rate)
    : null,
);
const closedRows = useClosedOnPair(
  () => props.botKey,
  () => props.pair,
);
const closed = computed(() =>
  closedMarks(closedRows.trades.value, props.pair, (r) =>
    r.kind === 'custom' ? r.raw : t(`fq.exit.${r.kind}`),
  ),
);
// A new fill (a safety order, a partial exit) changes the orders of the open trade
watch(
  () => [position.value?.dca_entries, position.value?.amount],
  () => void orders.reload(),
);
const overlays = computed(() =>
  overlaysFromPosition(position.value, props.pair, {
    orders: orders.model.value?.ladder ?? [],
    fills: orders.model.value?.fills ?? [],
    pending: pending.value,
    gain: gainFromPosition(position.value, null),
    closed: closed.value,
  }),
);
const meta = computed(() => {
  const on = t('fq.pg.charts.onBot', { bot: bot.value?.identity.name ?? props.botKey });
  const p = position.value;
  return p ? `${on}, ${t('fq.pairnav.dca', { n: p.dca_entries })}` : on;
});
const tfLabel = computed(() =>
  te(`fq.pg.charts.tf.${props.tf}`) ? t(`fq.pg.charts.tf.${props.tf}`) : props.tf,
);

const own = useChartDisplay();
const shown = computed(() => props.toggles ?? own.toggles.value);
// A strategy is read the same way whichever bot runs it: the choice follows the strategy
const subs = useSubplotChoice(() => bot.value?.identity.strategy ?? props.botKey);
</script>

<template>
  <Pane
    class="cell"
    :class="{ active }"
    :title="`${pairLabel(pair)} · ${tfLabel}`"
    :meta="meta"
    icon="chart-candlestick"
    data-testid="chart-cell"
    :data-pair="pair"
    @pointerdown.capture="emit('select')"
  >
    <template #tools>
      <DirectionChip v-if="position" :side="position.side" :leverage="position.leverage" />
      <Btn
        v-if="position"
        size="sm"
        variant="ghost"
        icon="layers"
        @click="emit('openTrade', botKey, position.trade_id)"
        >{{ t('fq.pg.charts.position') }}</Btn
      >
      <Btn size="sm" variant="ghost" icon="bot" @click="emit('openBot', botKey, pair)">{{
        t('fq.pg.charts.botPage')
      }}</Btn>
    </template>
    <CandleChart
      :key="`${botKey}/${pair}/${tf}`"
      :bot-key="botKey"
      :pair="pair"
      :tf="tf"
      :heikin-ashi="heikinAshi"
      :plot-config="plotConfig"
      :plot-extra="plotExtra"
      :measure-armed="measureArmed"
      :overlays="overlays"
      :toggles="shown"
      :sub-choice="subs.choice.value"
      :height="height"
      :controls="false"
      @update:sub-choice="subs.set"
      @subplots="(l) => emit('subplots', l)"
    />
  </Pane>
</template>

<style scoped>
.cell {
  min-width: 0;
  min-height: 0;
}
.cell.active {
  box-shadow: inset 0 0 0 1px var(--accent);
}
</style>
