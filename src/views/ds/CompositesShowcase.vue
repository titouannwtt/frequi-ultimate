<script setup lang="ts">
/**
 * "Composites" section of the /__ds showcase (docs/redesign/02-design.md, section 5.2, batch A):
 * every composite on fixture data that covers the edge cases (40 bots; stale, offline, starting,
 * expired and stopped bots; live and dry; a shared wallet; long names; zero, negative and unknown
 * values; a trade id held by two bots; an orphan position; empty states). The confirmations go
 * to a fake source: nothing here can reach a bot.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import { Btn, SegmentedControl } from '@/components/ds';
import {
  AlertItem,
  AlertRail,
  AppShell,
  BotActionBar,
  BotHeader,
  FleetMap,
  FleetScope,
  FleetTable,
  PositionCard,
  ScopePanel,
  TradeDrawer,
  TradeTable,
} from '@/components/fq';
import type { AlertTab } from '@/components/fq';
import {
  fakeSource,
  FIXTURE_NOW,
  makeFixture,
  resetStores,
  scopeDetailOf,
  seedStores,
} from '@/components/fq/fixtures';
import { lineFromPosition } from '@/components/fq/lib/trades';
import type { FleetSort } from '@/components/fq/lib/bots';
import type { ShellPage } from '@/components/fq';
import { requestAction } from '@/composables/useActionDialog';
import { useCommandPalette } from '@/composables/useCommandPalette';
import { useScope } from '@/composables/useScope';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeRef } from '@/datasource/types';
import type { TradeRow } from '@/gateway/types.gen';

const prefs = useFqPrefsStore();
const fleetStore = useFqFleetStore();
const palette = useCommandPalette();
const scope = useScope();

const fixture = makeFixture(40);
const fake = fakeSource(fixture);

onMounted(() => {
  seedStores(fixture);
  // Groups of the fleet table: the first bots and the dry ones
  prefs.settings.fleet.groups = [
    {
      id: 'g-dca',
      name: 'Hippo DCA',
      icon: '',
      collapsed: false,
      botKeys: fixture.bots.slice(0, 8).map((b) => b.bot_key),
    },
    {
      id: 'g-dry',
      name: 'Dry',
      icon: '',
      collapsed: true,
      botKeys: fixture.bots.filter((b) => b.identity.mode === 'dry').map((b) => b.bot_key),
    },
  ];
  prefs.settings.scope.mode = 'all';
});
onBeforeUnmount(() => {
  resetStores();
  prefs.settings.fleet.groups = [];
  scope.reset();
});

// ---- fleet ----
const sort = ref<FleetSort>('attention');
const sortOptions = [
  { value: 'attention' as FleetSort, label: 'Attention' },
  { value: 'latent' as FleetSort, label: 'Latent' },
  { value: 'name' as FleetSort, label: 'Name' },
];
const view = ref<'table' | 'map'>('table');
const viewOptions = [
  { value: 'table' as const, label: 'Table' },
  { value: 'map' as const, label: 'Map' },
];
const rows = computed(() => scope.bots.value);
const selectedBot = ref<string | null>(null);
const widths = reactive({ a: 1180, b: 760, c: 420 });

// ---- scope panel ----
const panel = ref<ScopeRef | null>(null);
const panelOpen = computed(() => panel.value !== null);
const panelDetail = computed(() => (panel.value ? scopeDetailOf(fixture, panel.value) : null));

// ---- trades ----
const positions = computed(() => fixture.positions);
const botKeyA = fixture.bots[0]!.bot_key;
const botKeyB = fixture.bots[1]!.bot_key;
const closed: TradeRow[] = fixture.bots.slice(0, 3).flatMap((b, bi) =>
  Array.from({ length: 5 }, (_, i) => ({
    bot_key: b.bot_key,
    trade_id: 1100 + bi * 10 + i,
    pair: ['SOL/USDC:USDC', 'xyz:NVDA/USDC:USDC', 'WIF/USDC:USDC'][i % 3]!,
    market: i % 3 === 1 ? ('xyz_stocks' as const) : ('crypto' as const),
    side: i % 2 ? ('short' as const) : ('long' as const),
    mode: b.identity.mode,
    leverage: 2,
    open_ms: FIXTURE_NOW - (30 + i * 9) * 3_600_000,
    close_ms: FIXTURE_NOW - (3 + i * 7) * 3_600_000,
    open_rate: 100 + i,
    close_rate: i === 3 ? null : 101 + i,
    amount: 3,
    stake_amount: 150,
    profit_abs: i === 2 ? null : (i - 2) * 6.4,
    profit_ratio: i === 2 ? null : (i - 2) * 0.02,
    profit_unknown: i === 2,
    exit_reason: {
      raw: ['roi', 'stop_loss', '', 'force_exit', 'exit_signal'][i]!,
      kind: (['roi', 'stop_loss', 'unknown', 'force_exit', 'exit_signal'] as const)[i]!,
      class: 'other' as const,
    },
    enter_tag: null,
    manual: i === 3,
  })),
);
const quick = ref<'all' | 'loss' | 'dca3' | 'xyz' | 'orphan'>('all');
const selectedTrade = ref<string | null>(null);

// ---- drawer ----
const drawerSheet = ref(false);
const dupes = computed(() => positions.value.filter((p) => p.trade_id === 1180));
const orders = [
  { id: 'e', label: 'Entry', price: 5.392, stake: 14, state: 'filled' as const },
  { id: 's1', label: 'SO1', price: 5.257, stake: 20, state: 'filled' as const },
  { id: 's2', label: 'SO2', price: 5.122, stake: 29, state: 'next' as const },
  { id: 's3', label: 'SO3', price: 4.987, stake: 43, state: 'pending' as const },
];

// ---- cards ----
const cardLines = computed(() => {
  const list = positions.value;
  const orphan = list.find((p) => p.orphan)!;
  const stale = fixture.bots.find((b) => b.freshness.positions?.stale)!;
  const stalePos = list.find((p) => p.bot_key === stale.bot_key);
  return [
    list[0]!,
    list.find((p) => (p.profit_abs ?? 0) > 0)!,
    orphan,
    ...(stalePos ? [stalePos] : []),
  ].map((p) => ({ line: lineFromPosition(p, fleetStore.bots[p.bot_key]), p }));
});

// ---- headers ----
const headerBots = computed(() => [
  fixture.bots[0]!,
  fixture.bots[3]!,
  fixture.bots[4]!,
  fixture.bots[5]!,
  fixture.bots[10]!,
]);

// ---- alerts ----
const tab = ref<AlertTab>('active');

// ---- shell ----
const page = ref<ShellPage>('fleet');

// ---- dialogs ----
function openExit(botKey: string, tradeId: number) {
  const p = positions.value.find((x) => x.bot_key === botKey && x.trade_id === tradeId);
  if (!p) return;
  requestAction(botKey, {
    kind: 'forceexit',
    tradeId,
    expected: { pair: p.pair, isShort: p.side === 'short' },
  });
}
function openAll(botKey: string) {
  requestAction(botKey, { kind: 'forceexit', tradeId: 'all' });
}
function openPause(botKey: string) {
  requestAction(botKey, { kind: 'stopbuy' });
}
function openStop(botKey: string) {
  requestAction(botKey, { kind: 'stop' });
}
function openEntry(botKey: string) {
  requestAction(botKey, { kind: 'forceentry', pair: '' });
}
const dryBot = fixture.bots.find((b) => b.identity.mode === 'dry')!;
const dryPos = fixture.positions.find((p) => p.bot_key === dryBot.bot_key);
</script>

<template>
  <section class="blk" aria-labelledby="s-comp" data-testid="composites">
    <h2 id="s-comp">Composites (batch A)</h2>

    <!-- AppShell, ScopePanel launcher, palette and the confirmation host live here -->
    <h3>AppShell</h3>
    <div class="shell-box">
      <AppShell
        :page="page"
        :source="fake.source"
        contained
        inline
        @navigate="(tg) => (page = String(tg).split(':')[0] as ShellPage)"
      >
        <template #scope><FleetScope /></template>
        <div class="shell-body">
          <FleetTable
            :rows="rows"
            :now-ms="FIXTURE_NOW"
            max-height="260px"
            @select-bot="(k) => (selectedBot = k)"
          />
        </div>
      </AppShell>
    </div>
    <div class="row">
      <Btn @click="palette.show()">Command palette (Ctrl K)</Btn>
    </div>

    <h3>FleetScope, FleetTable (40 bots, groups, freeze on hover), FleetMap</h3>
    <div class="row">
      <SegmentedControl v-model="sort" :options="sortOptions" size="sm" label="Sort" />
      <SegmentedControl v-model="view" :options="viewOptions" size="sm" label="View" />
      <Btn size="sm" @click="panel = { kind: 'fleet' }">ScopePanel: fleet</Btn>
      <Btn size="sm" @click="panel = { kind: 'group', id: 'g-dca' }">ScopePanel: group</Btn>
      <Btn size="sm" @click="panel = { kind: 'bot', botKey: botKeyA }">ScopePanel: bot</Btn>
      <Btn size="sm" @click="panel = { kind: 'bot', botKey: fixture.bots[3]!.bot_key }"
        >ScopePanel: offline bot</Btn
      >
    </div>
    <FleetScope />
    <div class="frame" :style="{ width: `min(100%, ${widths.a}px)` }">
      <FleetTable
        v-if="view === 'table'"
        :rows="rows"
        :groups="prefs.settings.fleet.groups"
        :sort="sort"
        :selected-key="selectedBot"
        :now-ms="FIXTURE_NOW"
        max-height="520px"
        @select-bot="(k) => (selectedBot = k)"
        @select-scope="(s) => (panel = s)"
      />
      <FleetMap
        v-else
        :rows="rows"
        :groups="prefs.settings.fleet.groups"
        :sort="sort"
        :selected-key="selectedBot"
        :now-ms="FIXTURE_NOW"
        @select-bot="(k) => (selectedBot = k)"
      />
    </div>
    <div class="row">
      <div class="frame" :style="{ width: `min(100%, ${widths.b}px)` }">
        <FleetTable :rows="rows.slice(0, 8)" :now-ms="FIXTURE_NOW" />
      </div>
      <div class="frame" :style="{ width: `min(100%, ${widths.c}px)` }">
        <FleetMap :rows="rows.slice(0, 8)" :now-ms="FIXTURE_NOW" />
      </div>
    </div>
    <div class="row">
      <div class="frame" :style="{ width: `min(100%, 520px)` }">
        <FleetTable :rows="[]" />
      </div>
    </div>

    <h3>BotHeader (online, offline, expired session, starting, stopped)</h3>
    <div class="stack">
      <BotHeader
        v-for="b in headerBots"
        :key="b.bot_key"
        :bot="b"
        :now-ms="FIXTURE_NOW"
        can-next
        :backoff="{ count: 3, max: 10 }"
      />
    </div>

    <h3>BotActionBar (header, row, drawer), confirmations on the fake source</h3>
    <div class="row">
      <BotActionBar context="header" :bot-key="botKeyA" />
    </div>
    <div class="row">
      <BotActionBar
        v-if="positions[0]"
        context="row"
        :bot-key="positions[0].bot_key"
        :position="positions[0]"
      />
      <div class="drawer-bar">
        <BotActionBar
          v-if="positions[0]"
          context="drawer"
          :bot-key="positions[0].bot_key"
          :position="positions[0]"
        />
      </div>
    </div>
    <div class="row">
      <Btn @click="openExit(botKeyA, 1180)">Exit live 1180 ({{ botKeyA }})</Btn>
      <Btn @click="openExit(botKeyB, 1180)">Exit live 1180 ({{ botKeyB }})</Btn>
      <Btn @click="openAll(botKeyA)">Exit all (typed name)</Btn>
      <Btn @click="openPause(botKeyA)">Pause entries (one click)</Btn>
      <Btn @click="openStop(botKeyA)">Stop (typed name)</Btn>
      <Btn @click="openEntry(botKeyA)">Forced entry</Btn>
      <Btn v-if="dryPos" @click="openExit(dryBot.bot_key, dryPos.trade_id)">Exit a dry bot</Btn>
    </div>

    <h3>TradeTable (open, bot, closed, journal) and cards under 560 px</h3>
    <div class="frame" style="width: min(100%, 1180px)">
      <TradeTable
        preset="open"
        :positions="positions"
        v-model:filter="quick"
        v-model:selected-key="selectedTrade"
        scoped
      />
    </div>
    <div class="row">
      <div class="frame" style="width: min(100%, 720px)">
        <TradeTable preset="bot" :bot-key="botKeyA" :positions="positions" hide-filters />
      </div>
      <div class="frame" style="width: min(100%, 520px)">
        <TradeTable preset="open" :positions="positions" :container-width="390" />
      </div>
    </div>
    <div class="frame" style="width: min(100%, 1180px)">
      <TradeTable preset="journal" :trades="closed" cursor="next" />
    </div>
    <div class="row">
      <div class="frame" style="width: min(100%, 720px)">
        <TradeTable preset="closed" :bot-key="botKeyA" :trades="closed" />
      </div>
      <div class="frame" style="width: min(100%, 520px)">
        <TradeTable preset="open" :positions="[]" />
      </div>
    </div>

    <h3>PositionCard (profit, loss, orphan, stale)</h3>
    <div class="cards">
      <PositionCard
        v-for="c in cardLines"
        :key="c.line.key"
        :line="c.line"
        :position="c.p"
        :tp="c.line.entry * (c.line.side === 'long' ? 1.04 : 0.96)"
      />
    </div>

    <h3>TradeDrawer (docked; two bots hold trade 1180)</h3>
    <div class="row">
      <div v-for="p in dupes" :key="p.bot_key" class="drawer-frame">
        <TradeDrawer
          docked
          :bot-key="p.bot_key"
          :trade-id="p.trade_id"
          :tp="p.open_rate * (p.side === 'long' ? 1.04 : 0.96)"
          :next-so="p.open_rate * 0.96"
          :dca-max="6"
          :orders="orders"
        />
      </div>
      <div class="drawer-frame">
        <TradeDrawer docked :bot-key="botKeyA" :trade-id="424242" />
      </div>
    </div>
    <div class="row">
      <Btn @click="drawerSheet = true">TradeDrawer as a drawer or bottom sheet</Btn>
    </div>
    <TradeDrawer
      v-if="dupes[0]"
      :open="drawerSheet"
      :bot-key="dupes[0].bot_key"
      :trade-id="dupes[0].trade_id"
      :orders="orders"
      @close="drawerSheet = false"
    />

    <h3>AlertRail, AlertItem, SinceLastVisit, EventFeed</h3>
    <div class="row top">
      <div class="rail-frame"><AlertRail v-model:tab="tab" :now-ms="FIXTURE_NOW" /></div>
      <div class="rail-frame"><AlertRail tab="events" :now-ms="FIXTURE_NOW" /></div>
      <div class="rail-frame">
        <AlertRail :limit="2" :now-ms="FIXTURE_NOW" :bot-key="botKeyB" />
      </div>
      <div class="rail-frame">
        <AlertItem
          v-if="fixture.alerts[0]"
          :alert="fixture.alerts[0]"
          bot-name="hippo_stocks"
          bot-mode="live"
          :now-ms="FIXTURE_NOW"
        />
        <AlertItem v-if="fixture.alerts[4]" :alert="fixture.alerts[4]" :now-ms="FIXTURE_NOW" />
      </div>
    </div>

    <ScopePanel
      v-if="panel"
      :open="panelOpen"
      :scope="panel"
      :detail="panelDetail"
      @close="panel = null"
      @open-bot="(k) => (panel = { kind: 'bot', botKey: k })"
    />
  </section>
</template>

<style scoped>
.blk {
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  padding: var(--s3);
  display: grid;
  gap: var(--s3);
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: var(--t-md);
  color: var(--fg-2);
}
h3 {
  margin: var(--s2) 0 0;
  font-size: var(--t-sm);
  color: var(--fg-2);
}
.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s2);
  min-width: 0;
}
.row.top {
  align-items: flex-start;
}
.stack {
  display: grid;
  gap: var(--s2);
}
.frame {
  border: 1px dashed var(--line-2);
  border-radius: var(--r-2);
  overflow: hidden;
  min-width: 0;
  background: var(--bg-1);
}
.shell-box {
  height: 520px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  overflow: hidden;
  position: relative;
}
.shell-body {
  padding: var(--s2);
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: var(--s2);
}
.drawer-frame {
  width: 440px;
  max-width: 100%;
  height: 640px;
  border-radius: var(--r-2);
}
.rail-frame {
  width: 420px;
  max-width: 100%;
  max-height: 520px;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  align-self: start;
}
.drawer-bar {
  width: 380px;
  max-width: 100%;
}
</style>
