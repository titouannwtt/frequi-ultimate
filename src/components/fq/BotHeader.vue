<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  AgeBadge,
  Badge,
  Banner,
  DsIcon,
  IconBtn,
  KpiStrip,
  KpiTile,
  ModeMark,
  PnlValue,
  SplitBar,
  StatusDot,
} from '@/components/ds';
import type { KpiMeter } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { DIGEST_STALE_MS } from '@/datasource/calc/freshness';
import { ruleMeta } from '@/datasource/calc/alerts/rules';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { BotRow } from '@/gateway/types.gen';

import BotActionBar from './BotActionBar.vue';
import type { ActionId } from './lib/actions';
import { botState, drawdownPct, isStaleGroup, minutesSince } from './lib/bots';
import { formatClockSeconds } from './lib/time';

/**
 * Header of the Bot page (02 section 3.2): previous and next bot, the state dot, the name, the
 * full LIVE badge, the market badge, the meta line, the six KPIs of the bot and the actions. The
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
const prefs = useFqPrefsStore();

const now = computed(() => props.nowMs ?? Date.now());
const skew = computed(() => conn.status.clockSkewMs);
const state = computed(() => botState(props.bot, now.value, skew.value));
const m = computed(() => props.bot.metrics);

const marketLabel = computed(() => {
  const k = props.bot.identity.market;
  if (k === 'crypto') return t('fq.header.market.crypto');
  if (k === 'mixed') return t('fq.header.market.mixed');
  return t('fq.header.market.hip3');
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
  ddPct.value === null
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
      <Badge v-if="bot.identity.market !== 'crypto'" kind="xyz" :label="marketLabel" />
      <IconBtn icon="chevron-down" :label="t('fq.header.pick')" @click="emit('selectBot')" />
      <div class="meta">
        <span v-if="bot.identity.strategy">{{ bot.identity.strategy }}</span>
        <span v-if="bot.identity.exchange">{{ bot.identity.exchange }}</span>
        <span v-if="bot.identity.port !== null">{{
          t('fq.header.port', { port: bot.identity.port })
        }}</span>
        <span v-if="state === 'online' && uptime">{{ t('fq.header.uptime', { d: uptime }) }}</span>
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
        <AgeBadge
          v-if="bot.freshness.state"
          :as-of-ms="bot.freshness.state.as_of_ms"
          :stale-after-ms="DIGEST_STALE_MS"
          :clock-skew-ms="skew"
          :now-ms="now"
        />
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
      <KpiTile :label="t('fq.kpi.pnlOpen')">
        <template #value
          ><PnlValue :value="m.open_profit_abs" :muted="stale('positions')" :flash="true"
        /></template>
        <template #sub>{{ t('fq.header.openTrades', { n: bot.state.open_trades }) }}</template>
      </KpiTile>
      <KpiTile :label="t('fq.col.realized_1d')">
        <template #value><PnlValue :value="m.realized_1d" :muted="stale('metrics')" /></template>
      </KpiTile>
      <KpiTile :label="t('fq.col.realized_30d')">
        <template #value
          ><PnlValue :value="m.realized_30d" :decimals="0" :muted="stale('metrics')"
        /></template>
        <template #sub>{{
          m.winrate === null
            ? ''
            : t('fq.header.winrate', { n: fmt.percent(m.winrate * 100, 0, false) })
        }}</template>
      </KpiTile>
      <KpiTile
        :label="t('fq.col.capital')"
        :value="
          m.starting_capital === null ? t('fq.ds.notAvailable') : fmt.number(m.starting_capital, 0)
        "
        :sub="t('fq.header.capitalNote')"
      />
      <KpiTile
        :label="t('fq.header.exposure')"
        :sub="
          t('fq.header.net', { n: fmt.signed((m.exposure_long ?? 0) - (m.exposure_short ?? 0), 0) })
        "
      >
        <template #value
          >{{ fmt.number(m.exposure_long ?? 0, 0) }} /
          {{ fmt.number(m.exposure_short ?? 0, 0) }}</template
        >
        <SplitBar :long="m.exposure_long ?? 0" :short="m.exposure_short ?? 0" />
      </KpiTile>
      <KpiTile
        :label="t('fq.kpi.drawdownOpen')"
        :meter="ddMeter"
        :alert="ddPct !== null && ddPct >= ddThreshold"
      >
        <template #value>
          <template v-if="dd"
            ><PnlValue :value="-dd.abs" :decimals="0" /><small v-if="ddPct !== null">
              {{ fmt.percent(-ddPct, 1) }}</small
            ></template
          >
          <template v-else>{{ t('fq.ds.notAvailable') }}</template>
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
      <b>{{ t('fq.status.starting') }}</b> {{ t('fq.fleet.state.starting', { n: stateSince }) }}.
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
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  color: var(--fg-3);
  font-size: var(--t-xs);
  min-width: 0;
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
  .actions {
    flex: 1 1 100%;
    margin: 0;
  }
  .meta {
    flex: 1 1 100%;
  }
}
</style>
