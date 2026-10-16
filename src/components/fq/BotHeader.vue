<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  Banner,
  DsIcon,
  IconBtn,
  KpiStrip,
  KpiTile,
  ModeMark,
  PnlValue,
  StatusDot,
} from '@/components/ds';
import type { KpiMeter } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { ruleMeta } from '@/datasource/calc/alerts/rules';
import { useValueSlot } from '@/composables/useValueSlot';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { BotRow } from '@/gateway/types.gen';

import BotActionBar from './BotActionBar.vue';
import type { ActionId } from './lib/actions';
import { botState, drawdownPct, isStaleGroup, minutesSince } from './lib/bots';
import { formatClockSeconds } from './lib/time';
import { botSlot, READY, type Slot, type SlotReason } from './lib/valueState';

/**
 * Header of the Bot page (02 section 3.2, 05 section 2.4): previous and next bot, the state dot,
 * the name, the full LIVE badge, ONE meta line (strategy, timeframe, uptime; the port, the exchange
 * and the age of the data are in the "More" menu), the four KPIs of the bot and the actions (Pause
 * entries and "More"). The
 * state banners say what is wrong without a second page: session expired (Reconnect), starting
 * (no offline alert for 20 minutes), offline (values frozen, "do not relaunch a bot only to close
 * a position"), stopped (orphan ledger, read only).
 */
const props = defineProps<{
  bot: BotRow;
  canPrev?: boolean;
  canNext?: boolean;
  /** Backoff 429 of the bot read through the proxy, when available (`count` of `max`). */
  backoff?: { count: number; max: number } | null;
  nowMs?: number;
  /** Phone: the sensitive actions are shown by the page at its foot, not in the header. */
  splitSensitive?: boolean;
}>();

const emit = defineEmits<{
  prev: [];
  next: [];
  selectBot: [];
  reconnect: [];
  navigate: [id: ActionId];
}>();

const { t } = useI18n();
const fmt = useFormat();
const conn = useFqConnectionStore();
const { vs } = useValueSlot();
const prefs = useFqPrefsStore();

const now = computed(() => props.nowMs ?? Date.now());
const skew = computed(() => conn.status.clockSkewMs);
const state = computed(() => botState(props.bot, now.value, skew.value));
const m = computed(() => props.bot.metrics);
// States of the figures: a figure not received yet is pending, one that cannot be known says why
const slotOf = (
  group: 'positions' | 'metrics' | 'capital',
  value: number | null | undefined,
  o: { prices?: boolean; settled?: SlotReason } = {},
): Slot => botSlot(props.bot, group, value, { nowMs: now.value, skewMs: skew.value, ...o });
const latentSlot = computed(() => slotOf('positions', m.value.open_profit_abs, { prices: true }));
// Both sides null: the positions were not read yet, which is not the same as a flat book
const exposureSlot = computed(() =>
  slotOf('positions', m.value.exposure_long ?? m.value.exposure_short),
);
const exposureKnown = computed(() => exposureSlot.value.state === 'ready');
/** Under the capital: how much of it is exposed, long and short (unread positions: nothing). */
const exposedSub = computed(() =>
  exposureKnown.value
    ? t('fq.pg.bot.kpi.exposed', {
        total: fmt.number((m.value.exposure_long ?? 0) + (m.value.exposure_short ?? 0), 0),
        long: fmt.number(m.value.exposure_long ?? 0, 0),
        short: fmt.number(m.value.exposure_short ?? 0, 0),
      })
    : undefined,
);
/** Under the 30 days: today's gain and the share of winning trades, whichever is known. */
const realizedSub = computed(() => {
  const parts: string[] = [];
  if (m.value.realized_1d != null) {
    parts.push(t('fq.pg.bot.kpi.today', { v: fmt.signed(m.value.realized_1d, 2) }));
  }
  if (m.value.winrate != null) {
    parts.push(t('fq.pg.bot.kpi.winners', { n: fmt.percent(m.value.winrate * 100, 0, false) }));
  }
  return parts.join(' · ');
});
const ddSlot = computed<Slot>(() =>
  latentSlot.value.state !== 'ready'
    ? latentSlot.value
    : dd.value
      ? READY
      : slotOf('metrics', null),
);
const key = (field: string) => `${props.bot.bot_key}/${field}`;

const marketLabel = computed(() => {
  const k = props.bot.identity.market;
  if (k === 'crypto') return t('fq.header.market.crypto');
  if (k === 'mixed') return t('fq.header.market.mixed');
  return t('fq.header.market.hip3');
});

/** "15m" as "15 min", "1h" as "1 h": the unit in words, the raw code stays in the tooltip. */
const tfText = computed(() => {
  const tf = props.bot.identity.timeframe;
  const m = tf ? /^(\d+)([mhdw])$/.exec(tf) : null;
  return m ? `${m[1]} ${t(`fq.pg.bot.tfUnit.${m[2]}`)}` : (tf ?? '');
});

const uptime = computed(() => {
  const min = minutesSince(props.bot.state.started_ms, now.value, skew.value);
  return min === null ? '' : fmt.duration(min / 60);
});

const ddThreshold = computed(() => {
  const custom = prefs.settings.alerts.rules.global.highDrawdown?.threshold;
  return Math.abs(custom ?? ruleMeta('highDrawdown').threshold?.default ?? 15);
});
const dd = computed(() => m.value.drawdown_with_open);
/** Percent of the account, converted from the ratio of the contract. */
const ddPct = computed(() => drawdownPct(dd.value));
const ddMeter = computed<KpiMeter | undefined>(() =>
  ddPct.value === null || ddSlot.value.state !== 'ready'
    ? undefined
    : {
        value: ddPct.value,
        max: ddThreshold.value * 1.5,
        threshold: ddThreshold.value,
        tone: ddPct.value >= ddThreshold.value ? 'crit' : 'neutral',
      },
);

const stale = (g: 'positions' | 'metrics' | 'capital') =>
  isStaleGroup(props.bot, g, now.value, skew.value);

const frozenAt = computed(() => {
  const f = props.bot.freshness.state ?? props.bot.freshness.metrics;
  return f ? formatClockSeconds(f.as_of_ms, prefs.settings.tz) : '';
});
const stateSince = computed(
  () => minutesSince(props.bot.state.since_ms, now.value, skew.value) ?? 0,
);
</script>

<template>
  <header class="bh" :data-state="state" data-testid="bot-header">
    <div class="line1">
      <IconBtn
        icon="chevron-left"
        class="nav prev"
        :label="t('fq.header.prev')"
        shortcut="["
        :disabled="!canPrev"
        @click="emit('prev')"
      />
      <IconBtn
        icon="chevron-right"
        class="nav next"
        :label="t('fq.header.next')"
        shortcut="]"
        :disabled="!canNext"
        @click="emit('next')"
      />
      <StatusDot :state="state" />
      <h1 class="name" :title="bot.identity.name">{{ bot.identity.name }}</h1>
      <ModeMark :mode="bot.identity.mode" full />
      <IconBtn icon="chevron-down" :label="t('fq.header.pick')" @click="emit('selectBot')" />
      <div class="meta" data-testid="bot-meta">
        <span v-if="bot.identity.strategy" :title="bot.identity.strategy">{{
          bot.identity.strategy
        }}</span>
        <span v-if="bot.identity.timeframe" :title="bot.identity.timeframe">{{ tfText }}</span>
        <span v-if="bot.identity.market !== 'crypto'">{{ marketLabel }}</span>
        <span v-if="state === 'online' && uptime">{{ t('fq.pg.bot.since', { d: uptime }) }}</span>
        <span v-if="bot.identity.mode === 'dry' && bot.state.first_real_trade_ms">
          {{
            t('fq.origin.since', {
              date: new Date(bot.state.first_real_trade_ms).toLocaleDateString(undefined, {
                day: '2-digit',
                month: '2-digit',
              }),
            })
          }}
        </span>
      </div>
      <div class="actions">
        <BotActionBar
          context="header"
          :bot-key="bot.bot_key"
          :split-sensitive="splitSensitive"
          @navigate="(id) => emit('navigate', id)"
        />
      </div>
    </div>

    <KpiStrip :label="bot.identity.name">
      <KpiTile
        :label="t('fq.kpi.pnlOpen')"
        :hint="t('fq.hint.pnlOpen')"
        v-bind="vs(latentSlot, key('latent'))"
      >
        <template #value
          ><PnlValue :value="m.open_profit_abs" :muted="stale('positions')" :flash="true"
        /></template>
        <template #sub>{{
          t('fq.pg.bot.kpi.onPositions', { n: bot.state.open_trades }, bot.state.open_trades)
        }}</template>
      </KpiTile>
      <KpiTile
        :label="t('fq.kpi.realized30d')"
        :hint="t('fq.hint.realized30d')"
        :short-label="t('fq.kpiShort.realized30d')"
        v-bind="vs(slotOf('metrics', m.realized_30d), key('d30'))"
      >
        <template #value
          ><PnlValue :value="m.realized_30d" :decimals="0" :muted="stale('metrics')"
        /></template>
        <template #sub>{{ realizedSub }}</template>
      </KpiTile>
      <KpiTile
        :label="t('fq.pg.bot.kpi.capital')"
        :short-label="t('fq.pg.bot.kpi.capitalShort')"
        :value="fmt.number(m.starting_capital ?? 0, 0)"
        :sub="exposedSub"
        v-bind="vs(slotOf('capital', m.starting_capital, { settled: 'capital' }), key('capital'))"
      />
      <KpiTile
        :label="t('fq.kpi.drawdownOpen')"
        :hint="t('fq.hint.drawdownOpen')"
        :short-label="t('fq.kpiShort.drawdownOpen')"
        :meter="ddMeter"
        :alert="ddSlot.state === 'ready' && ddPct !== null && ddPct >= ddThreshold"
        v-bind="vs(ddSlot, key('drawdown'))"
      >
        <template #value>
          <PnlValue :value="-(dd?.abs ?? 0)" :decimals="0" /><small v-if="ddPct !== null"
            >&nbsp;{{ fmt.percent(-ddPct, 1) }}</small
          >
        </template>
        <template #sub>{{
          t('fq.header.threshold', { n: fmt.percent(-ddThreshold, 0) })
        }}</template>
      </KpiTile>
      <KpiTile
        v-if="backoff"
        :label="t('fq.header.backoff')"
        :value="`${backoff.count}/${backoff.max}`"
        :alert="backoff.count >= backoff.max"
      />
    </KpiStrip>

    <Banner
      v-if="state === 'auth_expired'"
      kind="auth"
      :action="t('fq.status.reconnect')"
      @action="emit('reconnect')"
    >
      <b>{{ t('fq.status.sessionExpired') }}.</b> {{ t('fq.banner.authBody') }}
    </Banner>
    <Banner v-else-if="state === 'starting'" kind="starting">
      <b>{{ t('fq.status.starting') }}</b> {{ t('fq.pg.bot.startingFor', { n: stateSince }) }}
      {{ t('fq.banner.startingBody') }}
    </Banner>
    <Banner v-else-if="state === 'offline'" kind="offline">
      <b>{{ t('fq.status.offline') }}.</b> {{ t('fq.freshness.frozenAt', { time: frozenAt }) }}.
      {{ t('fq.banner.offlineBody') }}
    </Banner>
    <Banner v-else-if="state === 'stopped'" kind="stopped">
      <b>{{ t('fq.status.stopped') }}.</b> {{ t('fq.banner.stoppedBody') }}
    </Banner>
    <Banner v-else-if="state === 'stale'" kind="degraded">
      <DsIcon name="history" :size="13" /> {{ t('fq.status.stale') }}.
      {{ t('fq.banner.staleBody') }}
    </Banner>
  </header>
</template>

<style scoped>
.bh {
  display: grid;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.line1 {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 8px var(--s3);
  flex-wrap: wrap;
}
.nav {
  flex: none;
}
.name {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.meta {
  color: var(--fg-3);
  font-size: var(--t-sm);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta > span + span::before {
  content: '·';
  margin: 0 6px;
}
.actions {
  margin-left: auto;
  flex: none;
}
small {
  font-size: var(--t-xs);
  font-weight: 500;
  color: var(--fg-3);
}
@media (max-width: 599px) {
  /* A phone tile is half a screen: the line under the figure wraps instead of ending in an ellipsis */
  .bh :deep(.kpi .s) {
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
  }
  .actions {
    flex: 1 1 100%;
    margin: 0;
  }
  .meta {
    flex: 1 1 100%;
  }
}
</style>
