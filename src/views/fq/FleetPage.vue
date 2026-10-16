<script setup lang="ts">
import { useLocalStorage, useMediaQuery } from '@vueuse/core';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import { ExcludedCount, Pane, SegmentedControl, Tabs } from '@/components/ds';
import type { TabItem } from '@/components/ds';
import {
  AlertRail,
  EquityCurve,
  FleetKpis,
  FleetMap,
  FleetScope,
  FleetTable,
  Leaderboard,
  LogStream,
  PnlCalendar,
  RiskPanel,
  ScopePanel,
  ShellSlot,
  TradeDrawer,
  TradeTable,
} from '@/components/fq';
import type { EquityDefinition, EquityPeriod } from '@/components/fq/lib/equity';
import type { FleetSort } from '@/components/fq/lib/bots';
import type { LeaderboardPeriod } from '@/components/fq/lib/leaderboard';
import type { QuickFilter } from '@/components/fq/lib/trades';
import { useActionNav } from '@/composables/useActionNav';
import { usePositionsAwaiting } from '@/composables/usePositionsAwaiting';
import { useScope } from '@/composables/useScope';
import { useShellBus } from '@/composables/useShellBus';
import { useShortcuts } from '@/composables/useShortcuts';
import { useFqAlertsStore } from '@/datasource/stores/alerts';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeRef } from '@/datasource/types';
import type { BotMode } from '@/gateway/types.gen';
import type { Workspace } from '@/migration/schema';

/**
 * The Fleet page (docs/redesign/02-design.md, section 3.1): KPI strip, scope bar, the fleet as a
 * table or a map, the open positions, "needs attention", equity / leaderboard / calendar and the
 * wallet risk, in named zones that follow the workspace (Surveillance, Incident, Analysis). On a
 * phone the figures come first, then the alerts (four at most), then the scope and the table.
 */
const { t } = useI18n();
const route = useRoute();
const scope = useScope();
const fleet = useFqFleetStore();
const alerts = useFqAlertsStore();
const positions = useFqPositionsStore();
const prefs = useFqPrefsStore();
const bus = useShellBus();
const nav = useActionNav();

const phone = useMediaQuery('(max-width: 599px)');
const desktop = useMediaQuery('(min-width: 1024px)');

// ---- view: table or map (map is the default on a phone) ----
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
const sortOptions = computed(() => [
  { value: 'attention' as FleetSort, label: t('fq.pg.fleet.sort.attention') },
  { value: 'latent' as FleetSort, label: t('fq.pg.fleet.sort.latent') },
  { value: 'name' as FleetSort, label: t('fq.pg.fleet.sort.name') },
]);

// ---- scope panel, trade drawer ----
const panel = ref<ScopeRef | null>(null);
const drawer = ref<{ botKey: string; tradeId: number } | null>(null);
const selectedBot = computed(() => (panel.value?.kind === 'bot' ? panel.value.botKey : null));

function openTrade(botKey: string, tradeId: number) {
  panel.value = null;
  drawer.value = { botKey, tradeId };
}

// ---- positions ----
const posFilter = ref<QuickFilter>('all');
// The selected row of the positions table: J and K move it, X asks to exit it
const posSelected = ref<string | null>(null);

// ---- equity panel ----
type EqTab = 'equity' | 'leaderboard' | 'calendar';
const eqTab = ref<EqTab>('equity');
const eqPeriod = ref<EquityPeriod>('7d');
const eqDefinition = ref<EquityDefinition>('with_open');
const lbPeriod = ref<LeaderboardPeriod>('30d');
const eqTabs = computed<TabItem[]>(() => [
  { id: 'equity', label: t('fq.pg.fleet.tabs.equity') },
  { id: 'leaderboard', label: t('fq.pg.fleet.tabs.leaderboard') },
  { id: 'calendar', label: t('fq.pg.fleet.tabs.calendar') },
]);
const lbOptions = computed(() =>
  (['1d', '7d', '30d', 'total'] as LeaderboardPeriod[]).map((p) => ({
    value: p,
    label: t(`fq.pg.fleet.lbPeriod.${p}`),
  })),
);

/** Equity, leaderboard, calendar and risk never mix modes: "All" shows the live ones. */
const figuresMode = computed<BotMode>(() => (scope.mode.value === 'dry' ? 'dry' : 'live'));

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

// ---- counts for headers ----
const online = computed(() => scope.bots.value.filter((b) => b.state.status === 'online').length);
const activeAlerts = computed(() => alerts.view(Date.now(), 'active').length);
// The number the table shows: the positions of the bots in scope, plus the orphans (no bot)
const openCount = computed(() => {
  const inScope = new Set(scope.botKeys.value);
  return positions.list.filter((p) => p.orphan || inScope.has(p.bot_key)).length;
});

// Bots that announce positions the table has not read yet (direct mode reads the bots in turn):
// the table is partial, and says so instead of looking complete
const awaiting = usePositionsAwaiting(() => scope.botKeys.value);
const awaitingBots = computed(() =>
  awaiting.bots.value.map((b) => ({
    key: b.bot_key,
    name: b.identity.name,
    reason: t('fq.pg.fleet.positionsAwaiting'),
  })),
);
const positionsMeta = computed(() =>
  awaiting.missing.value > 0
    ? t('fq.pg.fleet.positionsMetaPartial', {
        n: openCount.value,
        total: openCount.value + awaiting.missing.value,
      })
    : t('fq.pg.fleet.positionsMeta', { n: openCount.value }),
);

// ---- bell and palette: focus the rail, toggle the view ----
const rail = ref<HTMLElement | null>(null);
function focusRail() {
  void nextTick(() => {
    rail.value?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    rail.value?.querySelector<HTMLElement>('[role="tab"]')?.focus({ preventScroll: true });
  });
}
watch(() => bus.attentionTick.value, focusRail);
watch(
  () => bus.viewTick.value,
  () => (view.value = view.value === 'table' ? 'map' : 'table'),
);
watch(
  () => route.hash,
  (h) => h === '#attention' && focusRail(),
  { immediate: true },
);
// `/open_trades` lands here with `?view=positions`
// A ref on a component is its instance, not its element: the element is `$el`
const positionsEl = ref<{ $el?: HTMLElement } | HTMLElement | null>(null);
watch(
  () => route.query.view,
  (v) =>
    v === 'positions' &&
    void nextTick(() => {
      const r = positionsEl.value;
      (r instanceof HTMLElement ? r : r?.$el)?.scrollIntoView?.();
    }),
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
const showEquity = computed(() => ws.value !== 'incident');
const showRisk = computed(() => ws.value === 'surveillance');
const showLeaderboard = computed(() => ws.value === 'analysis');
const showLogs = computed(() => ws.value === 'incident');
const showPositions = computed(() => ws.value !== 'analysis');
const incidentFirst = computed(() => phone.value && activeAlerts.value > 0);
</script>

<template>
  <div class="fleet" :data-ws="ws" :data-phone="phone || undefined" data-testid="fleet-page">
    <!-- Strip and scope bar live in the shell on tablet and desktop; on a phone they are in the flow -->
    <template v-if="!phone">
      <ShellSlot name="strip"><FleetKpis @open-bot="(k) => nav.openBot(k)" /></ShellSlot>
      <ShellSlot name="scope"><FleetScope /></ShellSlot>
    </template>

    <!-- Phone: the figures first (they were pushed below the fold by four alert cards), then the
         alerts, which come before the scope and the table -->
    <template v-if="phone">
      <FleetKpis @open-bot="(k) => nav.openBot(k)" />
    </template>
    <section v-if="phone && incidentFirst" ref="rail" class="area attention" id="attention">
      <AlertRail :limit="4" @action="nav.alertAction" />
    </section>
    <template v-if="phone">
      <FleetScope />
    </template>

    <Pane
      class="area table"
      :title="t('fq.pg.fleet.table')"
      icon="layout-grid"
      :meta="
        t('fq.pg.fleet.tableMeta', { n: scope.bots.value.length, online }, scope.bots.value.length)
      "
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
        <SegmentedControl
          v-if="!phone"
          v-model="sort"
          :options="sortOptions"
          size="sm"
          :label="t('fq.pg.fleet.sort.label')"
        />
      </template>
      <FleetTable
        v-if="view === 'table'"
        :rows="scope.bots.value"
        :groups="groups"
        :sort="sort"
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
        :selected-key="selectedBot"
        @select-bot="(k) => (panel = { kind: 'bot', botKey: k })"
      />
    </Pane>

    <Pane
      v-if="showPositions"
      ref="positionsEl"
      class="area positions"
      :title="t('fq.pg.fleet.positions')"
      icon="layers"
      :meta="positionsMeta"
      :state="positions.loaded ? 'ready' : 'loading'"
      :unavailable-reason="positions.unavailable ?? undefined"
    >
      <template #tools>
        <ExcludedCount :bots="awaitingBots" @select="(b) => nav.openBot(b.key)" />
      </template>
      <TradeTable
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
    </Pane>

    <section v-if="!(phone && incidentFirst)" ref="rail" class="area attention" id="attention">
      <AlertRail :limit="phone ? 4 : undefined" @action="nav.alertAction" />
    </section>

    <Pane v-if="showLogs" class="area logs" :title="t('fq.ds.logs')" icon="terminal">
      <LogStream mode="compact" :limit="30" @open-bot="(k) => nav.openBot(k)" />
    </Pane>

    <Pane v-if="showEquity" class="area equity" :title="t('fq.pg.fleet.equity')" icon="activity">
      <div class="eqwrap">
        <Tabs v-model="eqTab" :tabs="eqTabs" :label="t('fq.pg.fleet.equity')" />
        <EquityCurve
          v-if="eqTab === 'equity'"
          v-model:period="eqPeriod"
          v-model:definition="eqDefinition"
          :scope="scope.fleetScopeRef.value"
          :mode="figuresMode"
          :height="desktop ? 'fill' : '240px'"
        />
        <template v-else-if="eqTab === 'leaderboard'">
          <div class="lbbar">
            <SegmentedControl
              v-model="lbPeriod"
              :options="lbOptions"
              size="sm"
              :label="t('fq.eq.periodLabel')"
            />
          </div>
          <Leaderboard
            :scope="scope.fleetScopeRef.value"
            :period="lbPeriod"
            :mode="figuresMode"
            @select="(k) => nav.openBot(k)"
          />
        </template>
        <PnlCalendar v-else :scope="scope.fleetScopeRef.value" :mode="figuresMode" />
      </div>
    </Pane>

    <Pane
      v-if="showLeaderboard"
      class="area leaderboard"
      :title="t('fq.pg.fleet.tabs.leaderboard')"
      icon="chart-candlestick"
    >
      <div class="lbbar">
        <SegmentedControl
          v-model="lbPeriod"
          :options="lbOptions"
          size="sm"
          :label="t('fq.eq.periodLabel')"
        />
      </div>
      <Leaderboard
        :scope="scope.fleetScopeRef.value"
        :period="lbPeriod"
        :mode="figuresMode"
        @select="(k) => nav.openBot(k)"
      />
    </Pane>

    <Pane
      v-if="showRisk"
      class="area risk"
      :title="t('fq.pg.fleet.risk')"
      :meta="t('fq.pg.fleet.riskMeta')"
      icon="triangle-alert"
    >
      <RiskPanel
        :scope="scope.fleetScopeRef.value"
        :mode="figuresMode"
        @open-bot="(k) => nav.openBot(k)"
        @open-reconciliation="nav.navigateAction('reconcile', { botKey: '' })"
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
  --gap: var(--gut, 6px);
  display: grid;
  gap: var(--gap);
  padding: var(--gap);
  text-align: left;
  align-content: start;
}
.area {
  min-width: 0;
  min-height: 0;
}
.attention {
  display: grid;
  min-height: 0;
}
.attention > :deep(.rail) {
  min-height: 0;
  height: 100%;
}
.eqwrap {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}
.eqwrap > :deep(.eq) {
  flex: 1;
}
.lbbar {
  display: flex;
  padding: var(--s2) var(--s3);
}

/* Phone and tablet: the document scrolls, every panel has a height of its own */
.table,
.positions,
.logs {
  max-height: 560px;
}
.equity,
.risk,
.leaderboard {
  max-height: 520px;
}
.attention {
  max-height: 560px;
}
.fleet[data-phone] {
  padding: 0;
  gap: 0;
}
.fleet[data-phone] .area {
  border-radius: 0;
  max-height: none;
}
@media (min-width: 600px) and (max-width: 1023px) {
  .fleet {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  /* "Needs attention" and "Risk" side by side, then the fleet, positions and equity */
  .attention {
    order: 1;
  }
  .risk {
    order: 2;
  }
  .table {
    order: 3;
    grid-column: 1 / -1;
  }
  .positions {
    order: 4;
    grid-column: 1 / -1;
  }
  .equity,
  .leaderboard,
  .logs {
    order: 5;
    grid-column: 1 / -1;
  }
}

/* Desktop: named zones over 12 fractional rows, the page fits the window */
@media (min-width: 1024px) {
  .fleet {
    height: 100%;
    grid-template-columns: minmax(0, 1fr) clamp(360px, 30vw, 430px);
    grid-template-rows: repeat(12, minmax(0, 1fr));
    grid-template-areas:
      'table attention'
      'table attention'
      'table attention'
      'table attention'
      'table equity'
      'table equity'
      'positions equity'
      'positions equity'
      'positions equity'
      'positions risk'
      'positions risk'
      'positions risk';
  }
  .area {
    max-height: none;
  }
  .table {
    grid-area: table;
  }
  .positions {
    grid-area: positions;
  }
  .attention {
    grid-area: attention;
  }
  .equity {
    grid-area: equity;
  }
  .risk {
    grid-area: risk;
  }
  .leaderboard {
    grid-area: risk;
  }
  .logs {
    grid-area: equity;
  }

  /* Incident: the alerts and the logs get the room, the fleet is filtered to the bots in alert */
  .fleet[data-ws='incident'] {
    grid-template-areas:
      'table attention'
      'table attention'
      'table attention'
      'table attention'
      'table attention'
      'table attention'
      'positions attention'
      'positions attention'
      'positions logs'
      'positions logs'
      'positions logs'
      'positions logs';
  }
  /* Analysis: the equity and the leaderboard get the room, the risk and the positions step aside */
  .fleet[data-ws='analysis'] {
    grid-template-areas:
      'equity attention'
      'equity attention'
      'equity attention'
      'equity attention'
      'equity attention'
      'equity leaderboard'
      'equity leaderboard'
      'table leaderboard'
      'table leaderboard'
      'table leaderboard'
      'table leaderboard'
      'table leaderboard';
  }
}
@media (min-width: 1800px) {
  .fleet {
    grid-template-columns: minmax(0, 1fr) minmax(0, 0.8fr) clamp(360px, 22vw, 430px);
    grid-template-areas:
      'table equity attention'
      'table equity attention'
      'table equity attention'
      'table equity attention'
      'table equity attention'
      'table equity attention'
      'table equity attention'
      'positions risk attention'
      'positions risk attention'
      'positions risk attention'
      'positions risk attention'
      'positions risk attention';
  }
  .fleet[data-ws='incident'],
  .fleet[data-ws='analysis'] {
    grid-template-columns: minmax(0, 1fr) clamp(360px, 30vw, 430px);
  }
}
</style>
