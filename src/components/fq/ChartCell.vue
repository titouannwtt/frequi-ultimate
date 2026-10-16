<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, DirectionChip, Pane } from '@/components/ds';
import { useTradeOrders } from '@/composables/useTradeOrders';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { BotKey } from '@/gateway/types.gen';
import type { PlotConfig } from '@/types';

import CandleChart from './CandleChart.vue';
import { overlaysFromPosition } from './lib/candles';
import { pairLabel } from './lib/trades';

/**
 * One cell of the Charts page (02 section 3.3): the same `CandleChart` as the Bot page, with the
 * levels of the position the context bot holds on this pair, the HA switch and the links to the
 * bot and to the position. The overlays come from THIS bot's position only: a position of another
 * bot on the same pair is not drawn on this chart.
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
    active?: boolean;
    height?: string;
  }>(),
  { heikinAshi: false, measureArmed: false, active: false, height: '100%' },
);

const emit = defineEmits<{
  select: [];
  openBot: [botKey: BotKey, pair: string];
  openTrade: [botKey: BotKey, tradeId: number];
}>();

const { t } = useI18n();
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
const overlays = computed(() =>
  overlaysFromPosition(position.value, props.pair, {
    orders: orders.model.value?.ladder ?? [],
    fills: orders.model.value?.fills ?? [],
  }),
);
const meta = computed(() => {
  const name = bot.value?.identity.name ?? props.botKey;
  const p = position.value;
  return p ? `${name}, ${t('fq.pairnav.dca', { n: p.dca_entries })}` : name;
});
</script>

<template>
  <Pane
    class="cell"
    :class="{ active }"
    :title="`${pairLabel(pair)} · ${tf}`"
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
      :height="height"
      controls
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
