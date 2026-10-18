<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  AdaptiveSheet,
  Badge,
  Btn,
  DirectionChip,
  EmptyState,
  ModeMark,
  PnlValue,
  Skeleton,
  ValueState,
} from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useDataSource } from '@/composables/useDataSource';
import { useValueSlot } from '@/composables/useValueSlot';
import { mapClosedTrade } from '@/datasource/direct/mappers';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { DataSource } from '@/datasource/types';
import type { BotKey, BotMode } from '@/gateway/types.gen';
import type { ClosedTrade, Order } from '@/types';

import { isHip3Market } from '@/datasource/calc/hip3';
import MaeMfeBar from './MaeMfeBar.vue';
import TradeChartFold from './TradeChartFold.vue';
import type { JournalTrade } from './lib/journal';
import { withTimeout } from './lib/logs';
import { formatDateTime } from './lib/time';
import { pairLabel } from './lib/trades';
import { READY, unavailable } from './lib/valueState';

/**
 * Detail of a closed trade for the Journal (02 sections 3.4 and 5.2): result, exit reason with the
 * raw freqtrade value, who exited (human from the audit, or the strategy), the DCA depth, MAE and
 * MFE, and the orders. It is addressed by `(botKey, tradeId)`: two bots can hold the same trade id.
 * Read only, there is no action on a closed trade. The Journal passes the row it already holds;
 * without it the trade is read from the bot (`GET /trade/{id}` through the proxy).
 */
const props = withDefaults(
  defineProps<{
    botKey: BotKey;
    tradeId: number;
    open?: boolean;
    /** The row the Journal list already holds. */
    trade?: JournalTrade | null;
    /** Orders of the trade, when known. */
    orders?: Order[] | null;
    inline?: boolean;
    /** "Show the chart" of the trade, folded until asked for. Off where the page has a chart. */
    chart?: boolean;
    /** A source to use instead of the active one (previews, tests). */
    source?: DataSource | null;
    timeoutMs?: number;
  }>(),
  { open: true, trade: null, orders: null, chart: true, timeoutMs: 10_000 },
);

const emit = defineEmits<{ close: []; openBot: [botKey: BotKey] }>();

const { t, locale } = useI18n();
const fmt = useFormat();
const { vs } = useValueSlot();
const data = useDataSource();
const fleet = useFqFleetStore();
const connection = useFqConnectionStore();
// The note names the mode really in use: with the gateway the excursions are not "direct mode" ones
const maeNoteKey = computed(() =>
  connection.kind === 'direct'
    ? 'fq.jr.sheet.maeNoteDirect'
    : connection.kind === 'gateway'
      ? 'fq.jr.sheet.maeNoteGateway'
      : 'fq.jr.sheet.maeNote',
);
const prefs = useFqPrefsStore();

const fetched = ref<JournalTrade | null>(null);
const fetchedOrders = ref<Order[] | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let token = 0;

const activeSource = computed(() => props.source ?? data.source.value);
const bot = computed(() => fleet.bots[props.botKey] ?? null);
const row = computed<JournalTrade | null>(() => {
  const given = props.trade;
  // A row of another bot or another trade is never shown under this address
  if (given && given.bot_key === props.botKey && given.trade_id === props.tradeId) return given;
  return fetched.value;
});
const orderList = computed(() => props.orders ?? fetchedOrders.value ?? []);

async function load(): Promise<void> {
  const mine = ++token;
  fetched.value = null;
  fetchedOrders.value = null;
  error.value = null;
  if (!props.open) return;
  const given = props.trade;
  if (given && given.bot_key === props.botKey && given.trade_id === props.tradeId) return;
  const source = activeSource.value;
  if (!source) return;
  loading.value = true;
  try {
    const raw = await withTimeout(
      source.proxy<ClosedTrade & { orders?: Order[] }>(
        props.botKey,
        'GET',
        `/trade/${props.tradeId}`,
        undefined,
        { timeoutMs: props.timeoutMs },
      ),
      props.timeoutMs,
    );
    if (mine !== token) return;
    // The bot answers for the id asked; anything else is refused rather than shown
    if (raw.trade_id !== props.tradeId) throw new Error('trade id mismatch');
    const mode: BotMode = bot.value?.identity.mode ?? 'live';
    fetched.value = mapClosedTrade(raw, props.botKey, mode);
    fetchedOrders.value = raw.orders ?? null;
  } catch (e) {
    if (mine !== token) return;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (mine === token) loading.value = false;
  }
}

watch(() => [props.botKey, props.tradeId, props.open, props.trade, activeSource.value], load, {
  immediate: true,
});

const maeVal = computed(() => row.value?.mae ?? null);
const mfeVal = computed(() => row.value?.mfe ?? null);
const stillOpen = computed(() => row.value !== null && row.value.close_ms === null);
const pct = computed(() =>
  row.value?.profit_ratio == null || row.value.profit_unknown ? null : row.value.profit_ratio * 100,
);
const durationH = computed(() =>
  row.value && row.value.close_ms !== null
    ? Math.max(0, row.value.close_ms - row.value.open_ms) / 3_600_000
    : null,
);
const exitOrigin = computed(() => {
  const r = row.value;
  if (!r) return '';
  if (r.manual) return t('fq.jr.sheet.originHuman');
  if (r.exit_reason.kind === 'force_exit') return t('fq.jr.sheet.originForced');
  return t('fq.jr.sheet.originStrategy');
});
const reasonLabel = computed(() => {
  const r = row.value?.exit_reason;
  if (!r || r.kind === 'unknown') return '';
  return r.kind === 'custom' ? r.raw : t(`fq.exit.${r.kind}`);
});

interface OrderLine {
  key: string;
  side: 'entry' | 'dca' | 'exit';
  ts: number | null;
  price: number;
  amount: number;
}
const lines = computed<OrderLine[]>(() => {
  let entries = 0;
  return orderList.value
    .filter((o) => o.filled == null || o.filled > 0)
    .map((o, i) => {
      const side: OrderLine['side'] = o.ft_is_entry ? (entries++ === 0 ? 'entry' : 'dca') : 'exit';
      const ts = o.order_filled_timestamp ?? o.order_timestamp ?? null;
      return {
        key: `${o.order_id ?? i}`,
        side,
        ts: ts === null ? null : ts,
        price: o.safe_price,
        amount: o.filled ?? o.amount,
      };
    });
});
const dcaDepth = computed(() => {
  const r = row.value;
  if (r?.dca_entries != null) return r.dca_entries;
  const n = lines.value.filter((l) => l.side !== 'exit').length;
  return n > 0 ? n : null;
});

const stamp = (ms: number) => formatDateTime(ms, prefs.settings.tz, locale.value);
const title = computed(() =>
  row.value ? `${pairLabel(row.value.pair)} #${props.tradeId}` : `#${props.tradeId}`,
);
</script>

<template>
  <AdaptiveSheet :open="open" :title="title" :inline="inline" @close="emit('close')">
    <template #header>
      <ModeMark v-if="row" :mode="row.mode" full />
    </template>
    <div class="cts" data-testid="closed-trade-sheet">
      <Skeleton v-if="loading && !row" shape="row" :count="5" />
      <template v-else-if="row">
        <p v-if="stillOpen" class="note warn" data-testid="cts-open">
          {{ t('fq.jr.sheet.stillOpen') }}
        </p>
        <section class="head">
          <div class="h1">
            <b class="pair">{{ pairLabel(row.pair) }}</b>
            <DirectionChip :side="row.side" :leverage="row.leverage" />
            <Badge v-if="isHip3Market(row.market)" kind="xyz" />
            <Badge v-if="row.manual" kind="manual" />
          </div>
          <div class="target">
            <span class="k">{{ t('fq.action.targetBot') }}</span>
            <button type="button" class="nm" @click="emit('openBot', botKey)">
              {{ bot?.identity.name ?? botKey }}
            </button>
            <ModeMark :mode="row.mode" full />
          </div>
        </section>

        <section class="pnl">
          <span class="big">
            <PnlValue :value="row.profit_abs" :unknown="row.profit_unknown" unit="USDC" />
          </span>
          <span v-if="pct !== null" class="pct"><PnlValue :value="pct" unit="%" /></span>
          <span class="dur num">
            <template v-if="row.close_ms !== null">{{
              t('fq.jr.sheet.closedAt', { d: stamp(row.close_ms) })
            }}</template>
            <template v-if="durationH !== null"> · {{ fmt.duration(durationH) }}</template>
          </span>
        </section>

        <TradeChartFold
          v-if="chart && row.close_ms !== null"
          :key="`${row.bot_key}/${row.trade_id}`"
          :trade="row"
          :source="activeSource"
        />

        <section class="facts" :aria-label="t('fq.drawer.facts')">
          <div class="fact">
            <span class="k">{{ t('fq.jr.sheet.dca') }}</span>
            <span class="v num" :class="{ warn: (dcaDepth ?? 0) >= 4 }"
              ><ValueState v-bind="vs(unavailable('noData'))">{{ dcaDepth }}</ValueState></span
            >
          </div>
          <div class="fact">
            <span class="k">{{ t('fq.jr.sheet.reason') }}</span>
            <span class="v ui" :title="row.exit_reason.raw || t('fq.jr.exit.noRaw')"
              ><ValueState v-bind="vs(unavailable('exitReason'))">{{
                reasonLabel
              }}</ValueState></span
            >
          </div>
          <div class="fact">
            <span class="k">{{ t('fq.jr.sheet.exitBy') }}</span>
            <span class="v ui" data-testid="cts-origin">{{ exitOrigin }}</span>
          </div>
          <div class="fact">
            <span class="k">{{ t('fq.col.entry') }}</span>
            <span class="v num">{{ fmt.price(row.open_rate) }}</span>
          </div>
          <div class="fact">
            <span class="k">{{ t('fq.jr.sheet.exitPrice') }}</span>
            <span class="v num"
              ><ValueState v-bind="vs(row.close_rate === null ? unavailable('noData') : READY)">{{
                fmt.price(row.close_rate as number)
              }}</ValueState></span
            >
          </div>
          <div class="fact">
            <span class="k">{{ t('fq.col.stake') }}</span>
            <span class="v num">{{ fmt.number(row.stake_amount, 2) }}</span>
          </div>
        </section>

        <section class="exc" data-testid="cts-excursions">
          <h4>{{ t('fq.jr.sheet.excursions') }}</h4>
          <MaeMfeBar :mae="row.mae" :mfe="row.mfe" :exit="row.profit_ratio" wide />
          <div v-if="maeVal !== null && mfeVal !== null" class="vals">
            <span class="num down">MAE {{ fmt.percent(maeVal * 100, 1) }}</span>
            <span class="num up">MFE {{ fmt.percent(mfeVal * 100, 1) }}</span>
          </div>
          <p v-else class="note">{{ t(maeNoteKey) }}</p>
        </section>

        <section v-if="lines.length > 0" class="ord">
          <h4>{{ t('fq.drawer.orders') }}</h4>
          <table>
            <tbody>
              <tr v-for="l in lines" :key="l.key">
                <td class="l">{{ t(`fq.jr.sheet.order.${l.side}`) }}</td>
                <td class="num">
                  <ValueState
                    v-if="l.ts === null"
                    state="unavailable"
                    :reason="t('fq.value.reason.noData')"
                  />
                  <template v-else>{{ stamp(l.ts) }}</template>
                </td>
                <td class="num">{{ fmt.price(l.price) }}</td>
                <td class="num">{{ fmt.number(l.amount, 4) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </template>
      <div v-else-if="error" class="err" role="alert">
        <EmptyState icon="triangle-alert" :title="t('fq.jr.sheet.error')" :hint="error" />
        <Btn size="sm" @click="load()">{{ t('fq.result.retry') }}</Btn>
      </div>
      <EmptyState
        v-else
        icon="layers"
        :title="t('fq.jr.sheet.notFound')"
        :hint="t('fq.jr.sheet.notFoundHint')"
      />
    </div>
  </AdaptiveSheet>
</template>

<style scoped>
.cts {
  display: grid;
  gap: var(--s3);
  padding: var(--s3);
  min-width: 0;
}
.head {
  display: grid;
  gap: var(--s2);
}
.h1 {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex-wrap: wrap;
}
.pair {
  font-size: var(--t-lg);
}
.target {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  background: var(--bg-2);
  flex-wrap: wrap;
}
.k {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.nm {
  background: none;
  border: 0;
  padding: 0;
  color: var(--fg);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.nm:hover {
  text-decoration: underline;
}
.pnl {
  display: flex;
  align-items: baseline;
  gap: var(--s3);
  flex-wrap: wrap;
}
.big {
  font-family: var(--font-num);
  font-size: var(--t-2xl);
  font-weight: 600;
}
.pct {
  font-family: var(--font-num);
  font-size: var(--t-lg);
}
.dur {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  overflow: hidden;
}
.fact {
  display: grid;
  gap: 2px;
  padding: 8px 10px;
  background: var(--bg-1);
  min-width: 0;
}
.v {
  font-size: var(--t-md);
  overflow-wrap: anywhere;
}
.v.ui {
  font-family: var(--font-ui);
}
.v.warn {
  color: var(--warn);
}
h4 {
  margin: 0 0 6px;
  font-size: var(--t-xs);
  color: var(--fg-3);
  font-weight: 600;
}
.vals {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: var(--t-xs);
}
.up {
  color: var(--profit);
}
.down {
  color: var(--loss);
}
.note {
  margin: 0;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.note.warn {
  color: var(--warn);
}
.ord table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--t-xs);
}
.ord td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--line);
  text-align: right;
}
.ord td.l {
  text-align: left;
  font-family: var(--font-ui);
}
.err {
  display: grid;
  justify-items: center;
  gap: var(--s2);
}
</style>
