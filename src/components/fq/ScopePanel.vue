<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  AdaptiveSheet,
  Badge,
  Btn,
  EmptyState,
  ExcludedCount,
  KpiTile,
  ModeMark,
  PnlValue,
  Skeleton,
  Sparkline,
  SplitBar,
} from '@/components/ds';
import type { BotRef, KpiMeter } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useScopeDetail } from '@/composables/useScopeDetail';
import { useFqAlertsStore } from '@/datasource/stores/alerts';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeDetail, ScopeRef, ScopeTotals } from '@/datasource/types';
import type { Alert, BotKey } from '@/gateway/types.gen';

import AlertItem from './AlertItem.vue';
import BotActionBar from './BotActionBar.vue';
import type { ActionId } from './lib/actions';
import { lineFromPosition } from './lib/trades';
import PositionCard from './PositionCard.vue';

/**
 * The same panel for a bot, a group or the whole fleet (02 sections 3.1 and 4.1, C2 and C3), as a
 * side drawer or a bottom sheet. One block of figures per trading mode: live and dry are never
 * added together. The figures come from the active source (`/scope/{scope}` on the gateway); a
 * failed refresh keeps the last detail, marked.
 */
const props = withDefaults(
  defineProps<{
    scope: ScopeRef;
    open: boolean;
    /** Preloaded detail (previews, tests); otherwise read from the active source. */
    detail?: ScopeDetail | null;
    inline?: boolean;
    /** Positions shown before "See the N others". */
    positionLimit?: number;
  }>(),
  { detail: null, positionLimit: 5 },
);

const emit = defineEmits<{
  close: [];
  openBot: [botKey: BotKey];
  openTrade: [botKey: BotKey, tradeId: number];
  navigate: [id: ActionId, botKey: BotKey];
  alertAction: [id: string, alert: Alert];
}>();

const { t } = useI18n();
const fmt = useFormat();
const fleet = useFqFleetStore();
const alertsStore = useFqAlertsStore();
const prefs = useFqPrefsStore();

const loaded = useScopeDetail(() => props.scope);
const data = computed<ScopeDetail | null>(() => props.detail ?? loaded.detail.value);

const botKey = computed<BotKey | null>(() =>
  props.scope.kind === 'bot' ? props.scope.botKey : null,
);
const bot = computed(() => (botKey.value ? (fleet.bots[botKey.value] ?? null) : null));

const title = computed(() => {
  switch (props.scope.kind) {
    case 'bot':
      return bot.value?.identity.name ?? props.scope.botKey;
    case 'group':
      return (
        prefs.settings.fleet.groups.find((g) => g.id === (props.scope as { id: string }).id)
          ?.name ?? t('fq.scopePanel.group')
      );
    default:
      return t('fq.scopePanel.fleet');
  }
});

const nameOf = (key: string) => fleet.bots[key]?.identity.name ?? key;

function excludedRefs(b: ScopeTotals): BotRef[] {
  return b.excluded.map((k) => ({ key: k, name: nameOf(k) }));
}

function ddMeter(): KpiMeter | undefined {
  const d = data.value?.drawdown?.with_open;
  if (!d || d.pct == null) return undefined;
  return { value: d.pct, max: 22, threshold: 15, tone: d.pct >= 15 ? 'crit' : 'neutral' };
}

/** 24 h latent curve of the scope: the bots' hourly samples added up (same length only). */
const spark = computed(() => {
  const bots = data.value?.bots ?? [];
  const series = bots.map((b) => b.metrics.spark24h).filter((s) => s.length === 24);
  if (series.length === 0) return [] as number[];
  return Array.from({ length: 24 }, (_, i) => series.reduce((acc, s) => acc + s[i]!, 0));
});

const lines = computed(() =>
  (data.value?.positions ?? []).map((p) => lineFromPosition(p, fleet.bots[p.bot_key])),
);
const showAll = ref(false);
const visibleLines = computed(() =>
  showAll.value ? lines.value : lines.value.slice(0, props.positionLimit),
);

const scopeAlerts = computed(() => {
  const keys = new Set((data.value?.bots ?? []).map((b) => b.bot_key));
  return alertsStore
    .view(Date.now(), 'active')
    .filter((a) => (a.bot_key ? keys.has(a.bot_key) : props.scope.kind === 'fleet'));
});

const unavailable = computed(() => alertsStore.unavailable);
</script>

<template>
  <AdaptiveSheet :open="open" :title="title" :inline="inline" @close="emit('close')">
    <template #header>
      <ModeMark v-if="bot" :mode="bot.identity.mode" full />
    </template>
    <div class="sp" data-testid="scope-panel">
      <p v-if="loaded.stale.value && data" class="err" role="status">
        {{ t('fq.ds.pane.error') }} · {{ t('fq.ds.pane.lastValues') }}
      </p>
      <template v-if="data">
        <p v-if="data.totals.length > 1" class="notsum">{{ t('fq.scopePanel.notSummed') }}</p>
        <section v-for="blk in data.totals" :key="blk.mode" class="blk" :data-mode="blk.mode">
          <header class="bh">
            <ModeMark :mode="blk.mode" full />
            <span class="n">{{ t('fq.fleet.bots', { n: blk.bots }) }}</span>
            <ExcludedCount :bots="excludedRefs(blk)" @select="(b) => emit('openBot', b.key)" />
          </header>
          <div class="tiles">
            <KpiTile
              :label="t('fq.kpi.pnlOpen')"
              :sub="t('fq.header.openTrades', { n: blk.open_trades })"
            >
              <template #value><PnlValue :value="blk.open_profit_abs" /></template>
            </KpiTile>
            <KpiTile :label="t('fq.col.realized_1d')">
              <template #value><PnlValue :value="blk.realized_1d" /></template>
            </KpiTile>
            <KpiTile :label="t('fq.col.realized_30d')">
              <template #value><PnlValue :value="blk.realized_30d" :decimals="0" /></template>
            </KpiTile>
            <KpiTile
              :label="t('fq.col.capital')"
              :value="fmt.number(blk.starting_capital.total, 0)"
              :sub="
                blk.starting_capital.unknown > 0
                  ? t('fq.scopePanel.unknownCapital', { n: blk.starting_capital.unknown })
                  : t('fq.header.capitalNote')
              "
            />
            <KpiTile
              :label="t('fq.header.exposure')"
              :sub="`${t('fq.header.net', { n: fmt.signed(blk.exposure.net, 0) })}${blk.netted ? '' : ` · ${t('fq.fleet.notNetted')}`}`"
            >
              <template #value
                >{{ fmt.number(blk.exposure.long, 0) }} /
                {{ fmt.number(blk.exposure.short, 0) }}</template
              >
              <SplitBar :long="blk.exposure.long" :short="blk.exposure.short" />
            </KpiTile>
            <KpiTile
              v-if="data.drawdown && blk.mode === data.totals[0]?.mode"
              :label="t('fq.kpi.drawdownOpen')"
              :meter="ddMeter()"
            >
              <template #value>
                <PnlValue :value="-data.drawdown.with_open.abs" :decimals="0" />
                <small v-if="data.drawdown.with_open.pct !== null">
                  {{ fmt.percent(-data.drawdown.with_open.pct, 1) }}</small
                >
              </template>
            </KpiTile>
          </div>
        </section>

        <section v-if="spark.length > 0" class="sparkblk">
          <h4>{{ t('fq.scopePanel.latent24h') }}</h4>
          <Sparkline
            :values="spark"
            :width="420"
            :height="44"
            :label="t('fq.scopePanel.latent24h')"
          />
        </section>

        <section v-if="botKey" class="actions">
          <BotActionBar
            context="header"
            :bot-key="botKey"
            @navigate="(id) => emit('navigate', id, botKey!)"
          />
        </section>

        <section class="alerts">
          <h4>
            {{ t('fq.attention.title') }}
            <Badge v-if="scopeAlerts.length" kind="warn" :label="String(scopeAlerts.length)" />
          </h4>
          <p v-if="scopeAlerts.length === 0" class="dim">{{ t('fq.attention.allClear') }}</p>
          <AlertItem
            v-for="a in scopeAlerts.slice(0, 3)"
            :key="a.id"
            :alert="a"
            :bot-name="a.bot_key ? nameOf(a.bot_key) : null"
            :bot-mode="a.bot_key ? (fleet.bots[a.bot_key]?.identity.mode ?? null) : null"
            @action="(id, al) => emit('alertAction', id, al)"
          />
        </section>

        <section v-if="!botKey" class="bots">
          <h4>{{ t('fq.scopePanel.bots') }}</h4>
          <button
            v-for="b in data.bots"
            :key="b.bot_key"
            type="button"
            class="botrow"
            @click="emit('openBot', b.bot_key)"
          >
            <ModeMark :mode="b.identity.mode" />
            <span class="bn">{{ b.identity.name }}</span>
            <PnlValue :value="b.metrics.open_profit_abs" />
          </button>
        </section>

        <section class="positions">
          <h4>{{ t('fq.scopePanel.positions', { n: lines.length }) }}</h4>
          <EmptyState
            v-if="lines.length === 0"
            icon="layers"
            :title="t('fq.trade.empty.open')"
            :hint="t('fq.trade.emptyHint.open')"
          />
          <div v-else class="cards">
            <PositionCard
              v-for="l in visibleLines"
              :key="l.key"
              :line="l"
              :position="
                (data.positions ?? []).find(
                  (p) => p.bot_key === l.botKey && p.trade_id === l.tradeId,
                ) ?? null
              "
              @activate="(x) => emit('openTrade', x.botKey, x.tradeId)"
              @open-bot="(k) => emit('openBot', k)"
            />
            <Btn v-if="lines.length > visibleLines.length" @click="showAll = true">
              {{ t('fq.trade.seeOthers', { n: lines.length - visibleLines.length }) }}
            </Btn>
          </div>
        </section>
      </template>
      <div v-else-if="loaded.loading.value" class="loading">
        <Skeleton shape="kpi" :count="3" />
      </div>
      <EmptyState
        v-else-if="unavailable"
        icon="cable"
        :title="t('fq.connection.unavailableDirect')"
        :hint="unavailable"
      />
      <EmptyState v-else icon="info" :title="t('fq.ds.pane.empty')" />
    </div>
  </AdaptiveSheet>
</template>

<style scoped>
.sp {
  display: grid;
  gap: var(--s3);
  padding: var(--s3);
  align-content: start;
}
.err {
  margin: 0;
  padding: 5px var(--s3);
  background: var(--warn-w);
  color: var(--warn);
  font-size: var(--t-xs);
  border-radius: var(--r-2);
}
.notsum {
  margin: 0;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.blk {
  border: 1px solid var(--line);
  border-radius: var(--r-2);
}
.bh {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 7px var(--s3);
  border-bottom: 1px solid var(--line);
}
.bh .n {
  color: var(--fg-3);
  font-size: var(--t-xs);
  margin-right: auto;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
}
.tiles :deep(.kpi) {
  border-bottom: 1px solid var(--line);
}
h4 {
  margin: 0 0 6px;
  font-size: var(--t-md);
  display: flex;
  align-items: center;
  gap: 8px;
}
.dim {
  color: var(--fg-3);
  font-size: var(--t-sm);
  margin: 0;
}
.cards {
  display: grid;
  gap: var(--s2);
}
.botrow {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: var(--row);
  padding: 0 var(--s2);
  border: 0;
  border-bottom: 1px solid var(--line);
  background: none;
  color: var(--fg);
  font: inherit;
  font-size: var(--t-sm);
  cursor: pointer;
  text-align: left;
}
.botrow:hover {
  background: var(--bg-2);
}
.bn {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
small {
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.loading {
  padding: var(--s3);
}
</style>
