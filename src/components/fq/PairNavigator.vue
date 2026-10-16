<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  Badge,
  Btn,
  DirectionChip,
  EmptyState,
  PnlValue,
  SearchField,
  Skeleton,
} from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useSourceQuery } from '@/composables/useSourceQuery';
import { withTimeout } from './lib/logs';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { DataSource } from '@/datasource/types';
import type { BotKey } from '@/gateway/types.gen';

import {
  lockItems,
  matchesPair,
  positionItems,
  signalItems,
  whitelistItems,
  type LockRecord,
  type PairFilter,
  type PairItem,
  type SignalSummary,
} from './lib/pairs';
import { pairLabel } from './lib/trades';

/**
 * One pair selector for the Bot and Charts pages (02 section 4.1 C11): the open positions of the
 * fleet first (bot, DCA, P&L, worst first), then the signals of a bot, its pair locks and its
 * whitelist. The same pair held by two bots is two rows. Reads only: a lock is lifted from the
 * confirmation dialog, which this component asks for by event and never performs. The chips layout
 * is the phone strip above the chart.
 */
const props = withDefaults(
  defineProps<{
    /** A bot: signals, locks and whitelist are its own; none: the whole fleet's positions. */
    botKey?: BotKey | null;
    filter?: PairFilter;
    /** `bot_key/trade_id` of a position row, or the pair of another list. */
    selectedKey?: string | null;
    layout?: 'list' | 'chips';
    /**
     * List the open positions of the whole fleet under "Positions" even when a bot is given
     * (the Charts page: the bot is the context of the signals and the whitelist, not a filter).
     */
    fleetPositions?: boolean;
    /** The filters offered; by default every filter that makes sense for the bot. */
    tabs?: PairFilter[];
    /** A source to use instead of the active one (previews, tests). */
    source?: DataSource | null;
    timeoutMs?: number;
  }>(),
  { botKey: null, filter: 'positions', selectedKey: null, layout: 'list', timeoutMs: 10_000 },
);

const emit = defineEmits<{
  'update:filter': [filter: PairFilter];
  select: [item: PairItem];
  liftLock: [item: PairItem];
}>();

const { t } = useI18n();
const fmt = useFormat();
const fleet = useFqFleetStore();
const positions = useFqPositionsStore();
const clock = useNowMs();
const q = ref('');

const filters = computed<PairFilter[]>(
  () => props.tabs ?? (props.botKey ? ['positions', 'signals', 'locks', 'all'] : ['positions']),
);

function read<T>(path: string) {
  return (source: DataSource) =>
    withTimeout(
      source.proxy<T>(props.botKey as BotKey, 'GET', path, undefined, {
        timeoutMs: props.timeoutMs,
      }),
      props.timeoutMs,
    );
}
const wanted = (f: PairFilter) => props.filter === f && props.botKey !== null;

const signals = useSourceQuery<SignalSummary>(
  (s) => (wanted('signals') ? read<SignalSummary>('/signal_summary')(s) : null),
  () => `${props.botKey}|signals|${props.filter}`,
  { refreshMs: 30_000, source: () => props.source },
);
const locks = useSourceQuery<{ locks: LockRecord[] }>(
  (s) => (wanted('locks') ? read<{ locks: LockRecord[] }>('/locks')(s) : null),
  () => `${props.botKey}|locks|${props.filter}`,
  { refreshMs: 60_000, source: () => props.source },
);
const whitelist = useSourceQuery<{ whitelist: string[] }>(
  (s) => (wanted('all') ? read<{ whitelist: string[] }>('/whitelist')(s) : null),
  () => `${props.botKey}|all|${props.filter}`,
  { source: () => props.source },
);

const nameOf = (k: BotKey | null) => (k ? (fleet.bots[k]?.identity.name ?? k) : null);

const items = computed<PairItem[]>(() => {
  const key = props.botKey;
  switch (props.filter) {
    case 'positions':
      return positionItems(positions.list, props.fleetPositions ? null : key);
    case 'signals':
      return key ? signalItems(signals.data.value, key) : [];
    case 'locks':
      return key ? lockItems(locks.data.value?.locks, key) : [];
    default:
      return key ? whitelistItems(whitelist.data.value?.whitelist, key) : [];
  }
});
const shown = computed(() => items.value.filter((i) => matchesPair(i, q.value, nameOf(i.botKey))));
const active = computed(() =>
  props.filter === 'signals'
    ? signals
    : props.filter === 'locks'
      ? locks
      : props.filter === 'all'
        ? whitelist
        : null,
);
const loading = computed(
  () => !!active.value && active.value.loading.value && active.value.data.value === null,
);
const failed = computed(() => active.value?.error.value ?? null);

function leftLabel(i: PairItem): string {
  if (i.lockEndMs !== null) {
    return t('fq.pairnav.lockEnds', { d: fmt.age(Math.max(0, i.lockEndMs - clock.value)) });
  }
  return '';
}
</script>

<template>
  <section
    class="pn"
    :class="layout"
    data-testid="pair-navigator"
    :aria-label="t('fq.pairnav.title')"
  >
    <template v-if="layout === 'list'">
      <div class="top">
        <SearchField v-model="q" :placeholder="t('fq.pairnav.search')" />
      </div>
      <div
        v-if="filters.length > 1"
        class="tabs"
        role="tablist"
        :aria-label="t('fq.pairnav.filter')"
      >
        <button
          v-for="f in filters"
          :key="f"
          type="button"
          role="tab"
          :aria-selected="filter === f"
          :class="{ on: filter === f }"
          @click="emit('update:filter', f)"
        >
          {{ t(`fq.pairnav.f.${f}`) }}
        </button>
      </div>
    </template>

    <p v-if="failed" class="note warn" role="alert" data-testid="pairnav-error">
      {{ t('fq.ds.pane.error') }} · {{ failed }}
      <button type="button" class="link" @click="active?.reload()">
        {{ t('fq.result.retry') }}
      </button>
    </p>

    <Skeleton v-if="loading" shape="row" :count="5" />

    <ul v-else-if="shown.length > 0 && layout === 'list'" class="items">
      <li v-for="i in shown" :key="i.key">
        <button
          type="button"
          class="it"
          :class="{ on: selectedKey === i.key, stale: i.stale }"
          :aria-current="selectedKey === i.key || undefined"
          :data-key="i.key"
          @click="emit('select', i)"
        >
          <b class="p">
            {{ pairLabel(i.pair) }}
            <DirectionChip v-if="i.side" :side="i.side" />
            <Badge v-if="i.orphan" kind="orphan" />
          </b>
          <span v-if="i.profitAbs !== null || i.tradeId !== null" class="r">
            <PnlValue
              :value="i.profitAbs"
              :muted="i.stale"
              :unknown="i.profitAbs === null"
              :decimals="2"
            />
          </span>
          <span class="sub">
            <template v-if="i.tradeId !== null">
              {{ i.orphan ? t('fq.trade.noBot') : nameOf(i.botKey) }} ·
              {{ t('fq.pairnav.dca', { n: i.dca ?? 0 }) }}
            </template>
            <template v-else-if="i.signals.length > 0">
              {{ i.signals.map((s) => t(`fq.pairnav.signal.${s}`)).join(' · ') }}
            </template>
            <template v-else-if="i.lockId !== null">
              {{ i.lockReason ?? t('fq.pairnav.lock') }} · {{ leftLabel(i) }}
            </template>
          </span>
          <span v-if="i.profitPct !== null" class="r pct">
            <PnlValue :value="i.profitPct" unit="%" :muted="i.stale" :decimals="1" />
          </span>
        </button>
        <Btn
          v-if="i.lockId !== null"
          size="xs"
          variant="ghost"
          class="lift"
          @click="emit('liftLock', i)"
          >{{ t('fq.pairnav.lift') }}</Btn
        >
      </li>
    </ul>

    <div
      v-else-if="shown.length > 0"
      class="chips"
      role="listbox"
      :aria-label="t('fq.pairnav.title')"
    >
      <button
        v-for="i in shown"
        :key="i.key"
        type="button"
        class="chip"
        role="option"
        :aria-selected="selectedKey === i.key"
        :class="{ on: selectedKey === i.key, stale: i.stale }"
        @click="emit('select', i)"
      >
        {{ pairLabel(i.pair) }}
        <span v-if="i.profitPct !== null" class="num" :class="i.profitPct >= 0 ? 'up' : 'down'">{{
          fmt.percent(i.profitPct, 1)
        }}</span>
      </button>
    </div>

    <EmptyState
      v-else-if="!loading"
      :icon="filter === 'locks' ? 'hand' : filter === 'signals' ? 'activity' : 'layers'"
      :title="
        botKey === null && filter !== 'positions'
          ? t('fq.pairnav.pickBot')
          : t(`fq.pairnav.empty.${filter}`)
      "
      :hint="q ? t('fq.pairnav.noMatch') : undefined"
    />
  </section>
</template>

<style scoped>
.pn {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg-1);
}
.top {
  padding: 8px;
  border-bottom: 1px solid var(--line);
}
.tabs {
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
}
.tabs button {
  flex: 1;
  height: 26px;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--r-1);
  color: var(--fg-2);
  font: inherit;
  font-size: var(--t-xs);
  cursor: pointer;
}
.tabs button.on {
  background: var(--bg-3);
  color: var(--fg);
}
@media (max-width: 599px), (pointer: coarse) {
  .tabs button {
    height: 44px;
  }
}
.note {
  margin: 0;
  padding: 5px var(--s3);
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.note.warn {
  color: var(--warn);
}
.link {
  background: none;
  border: 0;
  padding: 0;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
.items {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: auto;
  min-height: 0;
  position: relative;
}
.it {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1px 8px;
  width: 100%;
  padding: 7px var(--s3);
  background: none;
  border: 0;
  border-bottom: 1px solid var(--line);
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.it:hover {
  background: var(--bg-2);
}
.it.on {
  background: var(--accent-w);
  box-shadow: inset 2px 0 0 var(--accent);
}
.it.stale {
  background-image: var(--stale-hatch);
}
.p {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: var(--t-sm);
  min-width: 0;
}
.r {
  text-align: right;
  font-family: var(--font-num);
  font-size: var(--t-xs);
  font-weight: 600;
}
.r.pct {
  font-weight: 500;
}
.sub {
  font-size: var(--t-xs);
  color: var(--fg-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.lift {
  margin: 0 var(--s3) 6px;
}
.chips {
  display: flex;
  gap: 6px;
  padding: 8px var(--s3);
  overflow-x: auto;
  scrollbar-width: none;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
}
.chips::-webkit-scrollbar {
  display: none;
}
.chip {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 12px;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: var(--r-pill);
  color: var(--fg);
  font: inherit;
  font-size: var(--t-sm);
  cursor: pointer;
}
.chip.on {
  background: var(--accent-w);
  border-color: var(--accent);
}
.chip.stale {
  background-image: var(--stale-hatch);
}
.num {
  font-family: var(--font-num);
  font-size: var(--t-xs);
  font-variant-numeric: tabular-nums slashed-zero;
}
.up {
  color: var(--profit);
}
.down {
  color: var(--loss);
}
</style>
