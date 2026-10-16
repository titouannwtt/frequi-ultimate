<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, DsIcon, EmptyState, PnlValue, StatusDot, ValueState } from '@/components/ds';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useValueSlot } from '@/composables/useValueSlot';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import type { BotRow } from '@/gateway/types.gen';
import type { BotGroupPrefs } from '@/migration/schema';

import {
  attentionScore,
  botState,
  groupBots,
  isStaleGroup,
  stableOrder,
  UNGROUPED_ID,
  type FleetSort,
  type StableOrderState,
} from './lib/bots';
import { botSlot } from './lib/valueState';

/**
 * The fleet as tiles (02 section 3.1, `M`): neutral at rest. Colour only means something: a bar
 * for caution, a bar and border for critical, hatches for stale (amber) and offline (grey, the
 * value struck through). The legend is always visible. Same order and same freeze as the table.
 * Default view on a phone.
 */
const props = withDefaults(
  defineProps<{
    rows: BotRow[];
    groups?: BotGroupPrefs[];
    sort?: FleetSort;
    freezeOnHover?: boolean;
    selectedKey?: string | null;
    nowMs?: number;
    /** Tiles shown before "See the N others"; absent: every bot. Groups always show all. */
    limit?: number;
  }>(),
  { groups: () => [], sort: 'attention', freezeOnHover: true, selectedKey: null },
);

const emit = defineEmits<{ selectBot: [botKey: string] }>();

const { t } = useI18n();
const clock = useNowMs();
const { vs } = useValueSlot();
const conn = useFqConnectionStore();
const now = computed(() => props.nowMs ?? clock.value);
const skew = computed(() => conn.status.clockSkewMs);

function cell(b: BotRow, field: string, group: 'positions' | 'capital', value: number | null) {
  const slot = botSlot(b, group, value, {
    nowMs: now.value,
    skewMs: skew.value,
    prices: field === 'latent',
    settled: field === 'max' ? 'noData' : undefined,
  });
  return vs(slot, `${b.bot_key}/${field}`);
}

const hovered = ref(false);
const focused = ref(false);
const frozen = computed(() => props.freezeOnHover && (hovered.value || focused.value));
let prev: StableOrderState | null = null;
const rankOf = (b: BotRow) => attentionScore(b, botState(b, now.value, skew.value));
const order = computed(() => {
  const next = stableOrder(props.rows, props.sort, prev, frozen.value, rankOf);
  prev = next;
  return next;
});
const byKey = computed(() => new Map(props.rows.map((b) => [b.bot_key, b])));
const ordered = computed(() =>
  order.value.keys.map((k) => byKey.value.get(k)).filter((b): b is BotRow => !!b),
);
const expanded = ref(false);
const shownBots = computed(() =>
  props.limit && !expanded.value && props.groups.length === 0
    ? ordered.value.slice(0, props.limit)
    : ordered.value,
);
const hiddenBots = computed(() => ordered.value.length - shownBots.value.length);
const sections = computed(() =>
  props.groups.length === 0
    ? [{ id: UNGROUPED_ID, name: '', bots: shownBots.value }]
    : groupBots(ordered.value, props.groups, t('fq.fleet.ungrouped')),
);

/** The market in plain words: in the tooltip of the name, not on the tile. */
function marketLabel(b: BotRow): string {
  const m = b.identity.market;
  if (m === 'crypto') return '';
  const key = {
    xyz_stocks: 'stocks',
    xyz_indices: 'indices',
    xyz_commodities: 'commodities',
    mixed: 'mixed',
  }[m as string];
  return t(`fq.pg.fleet.market.${key ?? 'other'}`);
}
function nameTitle(b: BotRow): string {
  const m = marketLabel(b);
  return m ? `${b.identity.name} · ${m}` : b.identity.name;
}

type Tone = 'calm' | 'warn' | 'crit' | 'stale' | 'offline';
function toneOf(b: BotRow): Tone {
  const st = botState(b, now.value, skew.value);
  if (st === 'offline' || st === 'auth_expired') return 'offline';
  if (st === 'stale') return 'stale';
  if (b.alerts.max_severity === 'critical' && b.alerts.count > 0) return 'crit';
  if (b.alerts.max_severity === 'warning' && b.alerts.count > 0) return 'warn';
  return 'calm';
}

function reason(b: BotRow): string {
  const st = botState(b, now.value, skew.value);
  switch (st) {
    case 'offline':
      return t('fq.status.offline');
    case 'stale':
      return t('fq.status.stale');
    case 'starting':
      return t('fq.status.starting');
    case 'stopped':
      return t('fq.status.stopped');
    case 'auth_expired':
      return t('fq.status.sessionExpired');
    default:
      return '';
  }
}

// The legend explains what is on screen and nothing else: a calm, all-live fleet has none
const legend = computed(() => {
  const tones = new Set(props.rows.map(toneOf));
  const modes = new Set(props.rows.map((b) => b.identity.mode));
  const both = modes.has('live') && modes.has('dry');
  return [
    { tone: 'warn', label: t('fq.map.legend.warn') },
    { tone: 'crit', label: t('fq.map.legend.crit') },
    { tone: 'stale', label: t('fq.map.legend.stale') },
    { tone: 'offline', label: t('fq.map.legend.offline') },
    ...(both
      ? [
          { tone: 'dry', label: t('fq.map.legend.dry') },
          { tone: 'live', label: t('fq.map.legend.live') },
        ]
      : []),
  ].filter((l) => l.tone === 'dry' || l.tone === 'live' || tones.has(l.tone as Tone));
});
</script>

<template>
  <div
    class="map"
    :data-frozen="frozen || undefined"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focused = true"
    @focusout="focused = false"
  >
    <template v-for="s in sections" :key="s.id">
      <h3 v-if="s.name" class="grp">{{ s.name }}</h3>
      <div class="tiles">
        <button
          v-for="b in s.bots"
          :key="b.bot_key"
          type="button"
          class="tile"
          :class="[
            toneOf(b),
            b.identity.mode === 'live' ? 'is-live' : 'is-dry',
            { sel: selectedKey === b.bot_key },
          ]"
          :data-bot-key="b.bot_key"
          :aria-pressed="selectedKey === b.bot_key"
          @click="emit('selectBot', b.bot_key)"
        >
          <span class="t-top">
            <span
              v-if="b.identity.mode === 'live'"
              class="live-dot"
              :aria-label="t('fq.ds.badge.live')"
              role="img"
            ></span>
            <StatusDot :state="botState(b, now, skew)" />
            <Badge v-if="b.identity.mode !== 'live'" :kind="b.identity.mode" />
            <DsIcon
              v-if="b.alerts.count > 0"
              :name="b.alerts.max_severity === 'critical' ? 'octagon-alert' : 'triangle-alert'"
              :size="13"
              class="al"
            />
          </span>
          <span class="t-name" :title="nameTitle(b)">{{ b.identity.name }}</span>
          <span class="t-val" :class="{ struck: toneOf(b) === 'offline' }">
            <PnlValue
              :value="b.metrics.open_profit_abs"
              :muted="isStaleGroup(b, 'positions', now, skew)"
              v-bind="cell(b, 'latent', 'positions', b.metrics.open_profit_abs)"
            />
          </span>
          <span class="t-sub">
            <template v-if="reason(b)">{{ reason(b) }}</template>
            <template v-else
              >{{
                t('fq.pg.fleet.slots.tileOf', { open: b.state.open_trades }, b.state.open_trades)
              }}
              <ValueState v-bind="cell(b, 'max', 'capital', b.state.max_open_trades)">{{
                b.state.max_open_trades
              }}</ValueState></template
            >
          </span>
        </button>
      </div>
    </template>
    <EmptyState
      v-if="rows.length === 0"
      icon="bot"
      :title="t('fq.fleet.empty')"
      :hint="t('fq.fleet.emptyHint')"
    />
    <button
      v-if="hiddenBots > 0"
      type="button"
      class="more"
      data-testid="fleet-more-bots"
      @click="expanded = true"
    >
      {{ t('fq.pg.fleet.seeMoreBots', { n: hiddenBots }, hiddenBots) }}
    </button>
    <ul v-if="legend.length > 0" class="legend" :aria-label="t('fq.map.legend.title')">
      <li v-for="l in legend" :key="l.tone"><i :class="l.tone"></i>{{ l.label }}</li>
    </ul>
  </div>
</template>

<style scoped>
.map {
  padding: var(--s3);
  display: grid;
  gap: var(--s2);
}
.grp {
  margin: 4px 0 0;
  font-size: var(--t-xs);
  color: var(--fg-3);
  font-weight: 600;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
  gap: var(--gut);
}
.tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 78px;
  padding: 7px 9px 8px;
  text-align: left;
  color: var(--fg);
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  font-family: var(--font-ui);
  cursor: pointer;
  overflow: hidden;
}
.tile.is-dry {
  border-style: dashed;
}
.tile:hover {
  border-color: var(--fg-4);
}
.tile.sel {
  box-shadow: 0 0 0 2px var(--accent-w);
  border-color: var(--accent);
}
.tile.warn::before,
.tile.crit::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 3px;
  background: var(--warn);
}
.tile.crit {
  border-color: var(--crit);
}
.tile.crit::before {
  background: var(--crit);
}
.tile.stale {
  background-image: var(--stale-hatch);
  border-style: dashed;
  border-color: var(--warn);
}
.tile.offline {
  background-image: var(--off-hatch);
}
.t-top {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 18px;
}
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--live);
  flex: none;
}
.al {
  margin-left: auto;
  color: var(--warn);
}
.crit .al {
  color: var(--crit);
}
.t-name {
  font-size: var(--t-sm);
  font-weight: 600;
  overflow-wrap: anywhere;
  line-height: 1.2;
  /* Two lines at most: the full name stays in the tooltip of the tile */
}
.t-val {
  font: 600 var(--t-lg) var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
.t-val.struck {
  text-decoration: line-through;
  color: var(--fg-3);
}
.t-sub {
  font-size: var(--t-xs);
  color: var(--fg-3);
  margin-top: auto;
}
.more {
  justify-self: center;
  padding: var(--s2) var(--s3);
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: var(--t-sm);
  cursor: pointer;
}
@media (max-width: 599px), (pointer: coarse) {
  .more {
    min-height: 44px;
  }
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.legend li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend i {
  width: 14px;
  height: 10px;
  border: 1px solid var(--line-2);
  border-radius: 2px;
  display: inline-block;
}
.legend i.warn {
  border-top: 3px solid var(--warn);
}
.legend i.crit {
  border: 1px solid var(--crit);
  border-top: 3px solid var(--crit);
}
.legend i.stale {
  background-image: var(--stale-hatch);
  border-style: dashed;
}
.legend i.offline {
  background-image: var(--off-hatch);
}
.legend i.dry {
  border-style: dashed;
}
.legend i.live {
  width: 6px;
  height: 6px;
  border: 0;
  border-radius: 50%;
  background: var(--live);
}
</style>
