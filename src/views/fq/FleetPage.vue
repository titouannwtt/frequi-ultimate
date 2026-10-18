<script setup lang="ts">
import { useLocalStorage, useMediaQuery } from '@vueuse/core';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import { ExcludedCount, Pane, SegmentedControl } from '@/components/ds';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import {
  FleetAlerts,
  FleetKpis,
  FleetMap,
  FleetScope,
  FleetTable,
  FleetVerdict,
  LogStream,
  ProfitPanel,
  RiskPanel,
  ScopePanel,
  TradeDrawer,
  TradeTable,
  WatchList,
} from '@/components/fq';
import type { FleetSort } from '@/components/fq/lib/bots';
import { alertsInScope, watchSelection } from '@/components/fq/lib/fleetPage';
import { fleetKpiModel } from '@/components/fq/lib/kpis';
import { lineFromPosition, type QuickFilter } from '@/components/fq/lib/trades';
import { useActionNav } from '@/composables/useActionNav';
import { useFleetNotices } from '@/composables/useFleetNotices';
import { usePositionsAwaiting } from '@/composables/usePositionsAwaiting';
import { useScope } from '@/composables/useScope';
import { useScopeDetail } from '@/composables/useScopeDetail';
import { useShellBus } from '@/composables/useShellBus';
import { useShortcuts } from '@/composables/useShortcuts';
import { useFqAlertsStore } from '@/datasource/stores/alerts';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeRef } from '@/datasource/types';
import type { BotMode } from '@/gateway/types.gen';
import type { Workspace } from '@/migration/schema';

/**
 * The Fleet page, calmer (docs/redesign/05-friendly-plan.md, L4). One question, "is everything
 * fine?", answered by a sentence; the active alerts as cards right under it; four figures; the
 * Profit block (what the bots earned over a period, full width); the bots, each with what it
 * earned today, over 7 and 30 days and in total, and the wallet risk summarised; and the five
 * positions to watch, with "See all the positions" for the full table. The bots ticked in the
 * "Bots N/M" list of the scope count in all of it, except the alerts and the verdict, which always
 * watch the whole mode: an alert is never hidden by an unticked box. The workspaces (Monitoring,
 * Incident, Analysis) are a layout menu. The alert history (acknowledged, silenced, events) is
 * behind the bell.
 */
const { t } = useI18n();
const route = useRoute();
const scope = useScope();
const fleet = useFqFleetStore();
const conn = useFqConnectionStore();
const alerts = useFqAlertsStore();
const positions = useFqPositionsStore();
const prefs = useFqPrefsStore();
const bus = useShellBus();
const nav = useActionNav();
const clock = useNowMs();

const phone = useMediaQuery('(max-width: 599px)');

// ---- bots: a list or tiles (tiles are the default on a phone) ----
// Every ticked bot is in the table; on a phone the list stops there until the reader asks for more
const BOTS_SHOWN_PHONE = 8;
const botsShown = computed(() => (phone.value ? BOTS_SHOWN_PHONE : undefined));
const storedView = useLocalStorage<'table' | 'map' | null>('fqu2.fleetView', null);
const view = computed<'table' | 'map'>({
  get: () => storedView.value ?? (phone.value ? 'map' : 'table'),
  set: (v) => (storedView.value = v),
});
const sort = ref<FleetSort>('attention');

const viewOptions = computed(() => [
  { value: 'table' as const, label: t('fq.pg.fleet.view.table') },
  { value: 'map' as const, label: t('fq.pg.fleet.view.map') },
]);

// ---- scope panel, trade drawer ----
const panel = ref<ScopeRef | null>(null);
const drawer = ref<{ botKey: string; tradeId: number } | null>(null);
const selectedBot = computed(() => (panel.value?.kind === 'bot' ? panel.value.botKey : null));

function openTrade(botKey: string, tradeId: number) {
  panel.value = null;
  drawer.value = { botKey, tradeId };
}

// ---- positions: the five to watch, or all of them ----
const allPositions = ref(false);
const posFilter = ref<QuickFilter>('all');
// The selected row of the full table: J and K move it, X asks to exit it
const posSelected = ref<string | null>(null);

// ---- profit and risk: the ticked bots of one mode ----
/** Capital and risk never mix modes: "All" shows the live ones. */
const figuresMode = computed<BotMode>(() => (scope.mode.value === 'dry' ? 'dry' : 'live'));
const figuresScope = computed(() => scope.figuresScopeRef(figuresMode.value));
// The latent profit now, from the same detail as the four figures so that both agree
const latent = computed(() => {
  const d = fleetDetail.value;
  if (!d) return { value: null, state: 'pending' as const };
  const block = d.totals.find((b) => b.mode === figuresMode.value);
  if (!block) return { value: 0, state: 'ready' as const };
  const m = fleetKpiModel(block, d, tick.value, conn.status.clockSkewMs, false);
  return { value: m.openProfit, state: m.slots.openProfit.state };
});

// ---- workspaces ----
const ws = computed<Workspace>(() => scope.workspace.value);
// "Incident" filters the fleet to the bots in alert; the chip says so and leaving restores it
let autoAttention = false;
watch(ws, (now, before) => {
  if (now === 'incident' && !scope.filters.attentionOnly) {
    scope.filters.attentionOnly = true;
    autoAttention = true;
  } else if (before === 'incident' && now !== 'incident' && autoAttention) {
    scope.filters.attentionOnly = false;
    autoAttention = false;
  }
});

// ---- alerts of the scope (the bell keeps the whole history and every alert) ----
const tick = computed(() => Math.floor(clock.value / 15_000) * 15_000);
const activeAlerts = computed(() =>
  alertsInScope(
    alerts.view(tick.value, 'active'),
    (k) => fleet.bots[k]?.identity.mode ?? null,
    scope.mode.value,
  ),
);

// ---- what the owner must act on that no alert says (an expired session, a frozen bot, a
// drawdown above its limit, an orphan position): read from the detail of the WHOLE fleet, not of the
// ticked bots, so that unticking a bot never hides a problem. The four figures read the detail of
// the ticked bots; when nothing is unticked both are the same request ----
const { detail: fleetDetail, error: detailError } = useScopeDetail(() => scope.fleetScopeRef.value);
const narrowed = computed(() => scope.fleetScopeRef.value.kind !== 'fleet');
const { detail: wholeDetail, error: wholeError } = useScopeDetail(() =>
  narrowed.value ? { kind: 'fleet' } : null,
);
const noticeDetail = computed(() => (narrowed.value ? wholeDetail.value : fleetDetail.value));
const fleetNotices = useFleetNotices(
  noticeDetail,
  computed(() => (narrowed.value ? wholeError.value : detailError.value) !== null),
);

// "See the bots" of a drawdown card: the bots by what they gain or lose, in view
const tableEl = ref<{ $el?: HTMLElement } | HTMLElement | null>(null);
function showBots() {
  sort.value = 'latent';
  const r = tableEl.value;
  (r instanceof HTMLElement ? r : r?.$el)?.scrollIntoView?.({ block: 'start' });
}

// ---- positions to watch ----
const watchLines = computed(() => {
  const inScope = new Set(scope.botKeys.value);
  return positions.list
    .filter((p) => p.orphan || inScope.has(p.bot_key))
    .map((p) => lineFromPosition(p, fleet.bots[p.bot_key]));
});
const selection = computed(() => watchSelection(watchLines.value, phone.value ? 3 : 5));
const total = computed(() => watchLines.value.length);

// Bots that announce positions the table has not read yet (direct mode reads the bots in turn):
// the list is partial, and says so instead of looking complete
const awaiting = usePositionsAwaiting(() => scope.botKeys.value);
const awaitingBots = computed(() =>
  awaiting.bots.value.map((b) => ({
    key: b.bot_key,
    name: b.identity.name,
    reason: t('fq.pg.fleet.positionsAwaiting'),
  })),
);
const positionsMeta = computed(() => {
  if (awaiting.missing.value > 0) {
    return t('fq.pg.fleet.positionsMetaPartial', {
      n: total.value,
      total: total.value + awaiting.missing.value,
    });
  }
  if (allPositions.value || selection.value.top.length === 0) return '';
  return t(selection.value.losing ? 'fq.pg.fleet.watch.metaLoss' : 'fq.pg.fleet.watch.metaSoft', {
    n: selection.value.top.length,
    total: total.value,
  });
});

// ---- palette: toggle the view; `/open_trades` lands here with `?view=positions` ----
watch(
  () => bus.viewTick.value,
  () => (view.value = view.value === 'table' ? 'map' : 'table'),
);
// A ref on a component is its instance, not its element: the element is `$el`
const positionsEl = ref<{ $el?: HTMLElement } | HTMLElement | null>(null);
watch(
  () => route.query.view,
  (v) => {
    if (v !== 'positions') return;
    allPositions.value = true;
    void nextTick(() => {
      const r = positionsEl.value;
      (r instanceof HTMLElement ? r : r?.$el)?.scrollIntoView?.();
    });
  },
  { immediate: true },
);

useShortcuts([
  {
    id: 'fleet.view',
    keys: 'm',
    labelKey: 'fq.shortcut.view',
    group: 'list',
    run: () => void (view.value = view.value === 'table' ? 'map' : 'table'),
  },
  ...(['surveillance', 'incident', 'analysis'] as Workspace[]).map((w, i) => ({
    id: `fleet.ws.${w}`,
    keys: String(i + 1),
    alt: true,
    labelKey: `fq.scope.ws.${w}`,
    group: 'display' as const,
    run: () => void (scope.workspace.value = w),
  })),
]);

const groups = computed(() => prefs.settings.fleet.groups);
const showProfit = computed(() => ws.value !== 'incident');
const showRisk = computed(() => ws.value !== 'incident');
const showLogs = computed(() => ws.value === 'incident');
const showPositions = computed(() => ws.value !== 'analysis');
const tableMeta = computed(() =>
  t(
    'fq.pg.fleet.tableMeta',
    { n: scope.bots.value.length, sorted: t(`fq.pg.fleet.tableSorted.${sort.value}`) },
    scope.bots.value.length,
  ),
);
</script>

<template>
  <div class="fleet" :data-ws="ws" :data-phone="phone || undefined" data-testid="fleet-page">
    <header class="head">
      <FleetVerdict
        class="verdict"
        :alerts="activeAlerts"
        :notices="fleetNotices.notices.value"
        :ready="fleetNotices.ready.value"
      />
      <FleetScope v-if="!phone" class="scope" />
    </header>

    <FleetAlerts
      :alerts="activeAlerts"
      :notices="fleetNotices.notices.value"
      :limit="phone ? 2 : 3"
      @action="nav.alertAction"
      @more="bus.alertsOpen.value = true"
      @bots="showBots"
      @later="fleetNotices.later"
    />

    <FleetKpis :detail="fleetDetail" @open-bot="(k) => nav.openBot(k)" />
    <FleetScope v-if="phone" class="scope" />

    <!-- Phone: what needs a decision first, then the bots, then the rest -->
    <Pane v-if="showProfit" class="area profit" :title="t('fq.pg.fleet.profit.title')">
      <ProfitPanel
        :scope="figuresScope"
        :mode="figuresMode"
        :latent="latent.value"
        :latent-state="latent.state"
        :height="phone ? '240px' : ws === 'analysis' ? '460px' : '340px'"
      />
    </Pane>

    <div class="mid">
      <Pane
        ref="tableEl"
        class="area table"
        :title="t('fq.pg.fleet.table')"
        :meta="tableMeta"
        :state="fleet.loaded ? 'ready' : 'loading'"
        :unavailable-reason="fleet.unavailable ?? undefined"
      >
        <template #tools>
          <SegmentedControl
            v-model="view"
            :options="viewOptions"
            size="sm"
            :label="t('fq.pg.fleet.view.label')"
          />
        </template>
        <FleetTable
          v-if="view === 'table'"
          v-model:sort="sort"
          :rows="scope.bots.value"
          :groups="groups"
          :limit="botsShown"
          :selected-key="selectedBot"
          max-height="none"
          @select-bot="(k) => (panel = { kind: 'bot', botKey: k })"
          @select-scope="(s) => (panel = s)"
        />
        <FleetMap
          v-else
          :rows="scope.bots.value"
          :groups="groups"
          :sort="sort"
          :limit="botsShown"
          :selected-key="selectedBot"
          @select-bot="(k) => (panel = { kind: 'bot', botKey: k })"
        />
      </Pane>

      <div class="side">
        <Pane v-if="showLogs" class="area logs" :title="t('fq.ds.logs')" icon="terminal">
          <LogStream mode="compact" :limit="30" @open-bot="(k) => nav.openBot(k)" />
        </Pane>

        <Pane v-if="showRisk" class="area risk" :title="t('fq.pg.fleet.risk.title')">
          <RiskPanel
            summary
            :scope="figuresScope"
            :mode="figuresMode"
            @open-bot="(k) => nav.openBot(k)"
            @open-reconciliation="nav.navigateAction('reconcile', { botKey: '' })"
          />
        </Pane>
      </div>
    </div>

    <Pane
      v-if="showPositions"
      ref="positionsEl"
      class="area positions"
      :title="t('fq.pg.fleet.watch.title')"
      :meta="positionsMeta"
      :state="positions.loaded ? 'ready' : 'loading'"
      :unavailable-reason="positions.unavailable ?? undefined"
    >
      <template #tools>
        <ExcludedCount :bots="awaitingBots" @select="(b) => nav.openBot(b.key)" />
        <button
          v-if="total > selection.top.length || allPositions"
          type="button"
          class="link"
          data-testid="positions-toggle"
          :aria-expanded="allPositions"
          @click="allPositions = !allPositions"
        >
          {{
            allPositions
              ? t('fq.pg.fleet.watch.collapse')
              : t('fq.pg.fleet.watch.seeAll', { n: total }, total)
          }}
        </button>
      </template>
      <TradeTable
        v-if="allPositions"
        v-model:filter="posFilter"
        v-model:selected-key="posSelected"
        preset="open"
        scoped
        shortcuts
        @open="openTrade"
        @open-bot="(k) => nav.openBot(k)"
        @navigate="
          (id, line) =>
            nav.navigateAction(id, { botKey: line.botKey, pair: line.pair, tradeId: line.tradeId })
        "
      />
      <WatchList
        v-else
        :lines="selection.top"
        @open="openTrade"
        @open-bot="(k) => nav.openBot(k)"
        @chart="(l) => nav.navigateAction('chart', { botKey: l.botKey, pair: l.pair })"
      />
    </Pane>

    <ScopePanel
      v-if="panel"
      :scope="panel"
      :open="panel !== null"
      @close="panel = null"
      @open-bot="(k) => nav.openBot(k)"
      @open-trade="openTrade"
      @navigate="(id, k) => nav.navigateAction(id, { botKey: k })"
      @alert-action="(id, a) => nav.alertAction(id as never, a)"
    />
    <TradeDrawer
      v-if="drawer"
      :bot-key="drawer.botKey"
      :trade-id="drawer.tradeId"
      :open="drawer !== null"
      @close="drawer = null"
      @navigate="
        (id) =>
          drawer &&
          nav.navigateAction(id, {
            botKey: drawer.botKey,
            tradeId: drawer.tradeId,
            pair: positions.get(drawer.botKey, drawer.tradeId)?.pair,
          })
      "
    />
  </div>
</template>

<style scoped>
.fleet {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: var(--s5) var(--s5) var(--s6);
  text-align: left;
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--s4);
  flex-wrap: wrap;
}
.verdict {
  flex: 1 1 280px;
}
.scope {
  flex: 0 1 auto;
  min-width: 0;
}
.area {
  min-width: 0;
  min-height: 0;
}

/* The profit takes the whole width; under it the bots, and beside them the risk. */
.mid {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(0, 1fr);
}
.side {
  display: grid;
  gap: 18px;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  align-content: start;
}
.logs {
  max-height: 560px;
}
.link {
  padding: 0 var(--s2);
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: var(--t-sm);
  cursor: pointer;
  white-space: nowrap;
}

@media (max-width: 599px), (pointer: coarse) {
  .link {
    min-height: 44px;
  }
}

/* Tablet: the logs of the Incident layout take the whole row */
@media (min-width: 600px) and (max-width: 1023px) {
  .side .logs {
    grid-column: 1 / -1;
  }
}

/* Desktop: the bots on the left, the risk on the right. Every ticked bot has its line, so the
   table can be taller than the risk: the columns start at the top, no stretched empty card. */
@media (min-width: 1024px) {
  .mid {
    grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr);
    align-items: start;
  }
  .side .logs {
    max-height: none;
  }
}

/* Phone: the document scrolls, full width, no card chrome around the sections */
.fleet[data-phone] {
  padding: var(--s3) 0 var(--s4);
  gap: var(--s3);
}
.fleet[data-phone] .head,
.fleet[data-phone] .scope,
.fleet[data-phone] :deep(.fk),
.fleet[data-phone] :deep(.fa) {
  padding-left: var(--s3);
  padding-right: var(--s3);
}
.fleet[data-phone] :deep(.fa) {
  padding-left: 0;
  padding-right: 0;
}
.fleet[data-phone] .area {
  border-radius: 0;
  border-left: 0;
  border-right: 0;
}
.fleet[data-phone] .mid {
  gap: var(--s3);
}
.fleet[data-phone] .side {
  gap: var(--s3);
}
/* The positions to watch come before the bots on a phone */
.fleet[data-phone] .positions {
  order: 1;
}
.fleet[data-phone] .mid {
  order: 2;
}
</style>
