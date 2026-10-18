<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, DirectionChip, PnlValue } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { TradeRow } from '@/gateway/types.gen';

import { formatDateTime } from './lib/time';
import { pairLabel } from './lib/trades';

/**
 * Short card of a closed trade, in the place the drawer of an open position takes on the Bot page:
 * the result, how long it lasted, the entry and the exit. The chart beside it draws the trade;
 * "Details" opens the full sheet (orders, excursions). Read only, there is no action on a closed
 * trade.
 */
const props = defineProps<{ trade: TradeRow }>();
const emit = defineEmits<{ details: [] }>();

const { t, locale } = useI18n();
const fmt = useFormat();
const prefs = useFqPrefsStore();
const fleet = useFqFleetStore();

const stamp = (ms: number) => formatDateTime(ms, prefs.settings.tz, locale.value);
const pct = computed(() =>
  props.trade.profit_ratio == null || props.trade.profit_unknown
    ? null
    : props.trade.profit_ratio * 100,
);
const hours = computed(() =>
  props.trade.close_ms != null
    ? Math.max(0, props.trade.close_ms - props.trade.open_ms) / 3_600_000
    : null,
);
const reason = computed(() => {
  const r = props.trade.exit_reason;
  if (r.kind === 'unknown') return '';
  return r.kind === 'custom' ? r.raw : t(`fq.exit.${r.kind}`);
});
const botName = computed(
  () => fleet.bots[props.trade.bot_key]?.identity.name ?? props.trade.bot_key,
);
</script>

<template>
  <section class="ctp" data-testid="closed-trade-panel">
    <header class="h">
      <b class="pair">{{ pairLabel(trade.pair) }} #{{ trade.trade_id }}</b>
      <DirectionChip :side="trade.side" :leverage="trade.leverage" />
    </header>
    <p class="bot">{{ botName }} · {{ t('fq.pg.bot.closedTrade') }}</p>
    <div class="pnl">
      <span class="big"
        ><PnlValue :value="trade.profit_abs" :unknown="trade.profit_unknown" unit="USDC"
      /></span>
      <span v-if="pct !== null" class="pct"><PnlValue :value="pct" unit="%" /></span>
    </div>
    <dl class="facts">
      <dt>{{ t('fq.col.entry') }}</dt>
      <dd class="num">{{ fmt.price(trade.open_rate) }} · {{ stamp(trade.open_ms) }}</dd>
      <template v-if="trade.close_ms !== null && trade.close_rate !== null">
        <dt>{{ t('fq.jr.sheet.exitPrice') }}</dt>
        <dd class="num">{{ fmt.price(trade.close_rate) }} · {{ stamp(trade.close_ms) }}</dd>
      </template>
      <template v-if="hours !== null">
        <dt>{{ t('fq.col.duration') }}</dt>
        <dd class="num">{{ fmt.duration(hours) }}</dd>
      </template>
      <template v-if="reason">
        <dt>{{ t('fq.jr.sheet.reason') }}</dt>
        <dd>{{ reason }}</dd>
      </template>
    </dl>
    <Btn size="sm" icon="layers" data-testid="closed-trade-details" @click="emit('details')">{{
      t('fq.pg.bot.closedDetails')
    }}</Btn>
  </section>
</template>

<style scoped>
.ctp {
  display: grid;
  gap: var(--s2);
  align-content: start;
  padding: var(--s3);
  min-width: 0;
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  text-align: left;
}
.h {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex-wrap: wrap;
}
.pair {
  font-size: var(--t-md);
}
.bot {
  margin: 0;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.pnl {
  display: flex;
  align-items: baseline;
  gap: var(--s2);
}
.big {
  font-size: var(--t-lg);
  font-weight: 600;
}
.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px var(--s3);
  margin: 0;
  font-size: var(--t-sm);
}
.facts dt {
  color: var(--fg-3);
}
.facts dd {
  margin: 0;
  min-width: 0;
}
</style>
