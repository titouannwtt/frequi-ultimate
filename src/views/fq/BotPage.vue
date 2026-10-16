<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { Btn, EmptyState, Pane, SegmentedControl, Skeleton, Tabs } from '@/components/ds';
import type { TabItem } from '@/components/ds';
import {
  AlertRail,
  BotActionBar,
  BotHeader,
  CandleChart,
  EquityCurve,
  Leaderboard,
  LogStream,
  PairNavigator,
  PairlistPanel,
  TradeDrawer,
  TradeTable,
} from '@/components/fq';
import { buildAction } from '@/components/fq/lib/actions';
import { overlaysFromPosition } from '@/components/fq/lib/candles';
import { effectiveTf, timeframeOptions } from '@/components/fq/lib/chartsPage';
import type { EquityDefinition, EquityPeriod } from '@/components/fq/lib/equity';
import { knownProfit } from '@/components/fq/lib/journal';
import type { LeaderboardItem } from '@/components/fq/lib/leaderboard';
import type { PairFilter, PairItem } from '@/components/fq/lib/pairs';
import { pairLabel } from '@/components/fq/lib/trades';
import { requestAction, toastRefusal } from '@/composables/useActionDialog';
import { useActionNav } from '@/composables/useActionNav';
import { useBotConfigEditorStore } from '@/stores/botConfigEditorStore';
import { useCommandPalette } from '@/composables/useCommandPalette';
import { useShortcuts } from '@/composables/useShortcuts';
import { usePositionsAwaiting } from '@/composables/usePositionsAwaiting';
import { useTradeOrders } from '@/composables/useTradeOrders';
import { useTradeSet } from '@/composables/useTradeSet';
import { useDataSource } from '@/composables/useDataSource';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { TradeRow } from '@/gateway/types.gen';

/**
 * The Bot page (docs/redesign/02-design.md, section 3.2): the header with the bot's figures and its
 * actions, the pair navigator, the chart with the levels of the selected position, the tabs
 * (Positions, History, Performance, Pairs and locks, Logs, Config) and the docked trade drawer.
 * Every mutation goes through the confirmation of THIS bot (BotActionBar, the drawer, the palette
 * or the `P` key), never through a "current bot" global.
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const fleet = useFqFleetStore();
const positionsStore = useFqPositionsStore();
const prefs = useFqPrefsStore();
const data = useDataSource();
const palette = useCommandPalette();
const nav = useActionNav();

// The per-bot config editor is the legacy modal (Python endpoints), loaded on first use
const BotConfigEditorModal = defineAsyncComponent(
  () => import('@/components/ftbot/configEditor/BotConfigEditorModal.vue'),
);
const configEditor = useBotConfigEditorStore();
const editorUsed = ref(false);

const desktop = useMediaQuery('(min-width: 1024px)');
const phone = useMediaQuery('(max-width: 599px)');

const botKey = computed(() => String(route.params.botKey));
// Positions the bot announces and the app has not read yet (direct mode reads the bots in turn)
const awaiting = usePositionsAwaiting(() => [botKey.value]);
const bot = computed(() => fleet.bots[botKey.value] ?? null);

// Remember the bot: it is where "Bot" in the navigation leads next time
watch(
  botKey,
  (k) => {
    if (k && prefs.ready && prefs.settings.selectedBot !== k) prefs.update('selectedBot', k);
  },
  { immediate: true },
);

// ---- the bots next to this one (same mode, by name) ----
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const neighbours = computed(() => {
  const mode = bot.value?.identity.mode;
  return fleet.list
    .filter((b) => !mode || b.identity.mode === mode)
    .slice()
    .sort((a, b) => collator.compare(a.identity.name, b.identity.name))
    .map((b) => b.bot_key);
});
const index = computed(() => neighbours.value.indexOf(botKey.value));
const prevKey = computed(() => (index.value > 0 ? neighbours.value[index.value - 1]! : null));
const nextKey = computed(() =>
  index.value >= 0 && index.value < neighbours.value.length - 1
    ? neighbours.value[index.value + 1]!
    : null,
);
function goBot(key: string | null) {
  if (key) void router.replace({ name: 'bot', params: { botKey: key }, query: { tab: tab.value } });
}

// ---- tabs, kept in the URL ----
type TabId = 'positions' | 'history' | 'performance' | 'pairs' | 'logs' | 'config';
const TAB_IDS: TabId[] = ['positions', 'history', 'performance', 'pairs', 'logs', 'config'];
const tab = computed<TabId>({
  get: () => {
    const q = String(route.query.tab ?? '');
    return (TAB_IDS as string[]).includes(q) ? (q as TabId) : 'positions';
  },
  set: (v) => void router.replace({ query: { ...route.query, tab: v } }),
});

const myPositions = computed(() => positionsStore.byBot(botKey.value));
const tabs = computed<TabItem[]>(() =>
  TAB_IDS.map((id) => ({
    id,
    label: t(`fq.pg.bot.tabs.${id}`),
    count: id === 'positions' ? myPositions.value.length : undefined,
  })),
);

// ---- selection: trade, pair ----
const queryTrade = computed(() => {
  const n = Number(route.query.trade);
  return Number.isInteger(n) && n > 0 ? n : null;
});
const selectedTradeId = ref<number | null>(null);
watch(queryTrade, (v) => v !== null && (selectedTradeId.value = v), { immediate: true });
watch(botKey, () => (selectedTradeId.value = queryTrade.value));

/** The worst position is selected until the user picks another (that is the one that needs a look). */
const worst = computed(
  () =>
    myPositions.value
      .slice()
      .sort((a, b) => (a.profit_abs ?? Infinity) - (b.profit_abs ?? Infinity))[0] ?? null,
);
/**
 * The chosen trade, else the worst one only when nothing was chosen. A chosen trade that has
 * since closed (or left the snapshot) must NOT fall back on another one: the drawer carries the
 * exit and add buttons, and a hold on a trade the user did not pick would act on it.
 */
const position = computed(() => {
  const id = selectedTradeId.value;
  if (id === null) return worst.value;
  return positionsStore.get(botKey.value, id) ?? null;
});
const tradeGone = computed(() => selectedTradeId.value !== null && position.value === null);
const tradeId = computed(() => position.value?.trade_id ?? null);

const queryPair = computed(() => (route.query.pair ? String(route.query.pair) : null));
const pickedPair = ref<string | null>(null);
watch(queryPair, (v) => v && (pickedPair.value = v), { immediate: true });
watch(botKey, () => (pickedPair.value = queryPair.value));
// The pair of the trade being shown, kept when that trade closes so the chart does not blank
const lastPair = ref<string | null>(null);
watch(
  () => position.value?.pair ?? null,
  (v) => v && (lastPair.value = v),
  { immediate: true },
);
watch(botKey, () => (lastPair.value = null));
const pair = computed(
  () => pickedPair.value ?? position.value?.pair ?? (tradeGone.value ? lastPair.value : null),
);

const sheetOpen = ref(false);
/** J and K move the selected row: the key is `<bot_key>/<trade_id>` and a bot key holds slashes. */
function moveSelection(key: string | null) {
  if (!key) return;
  const i = key.lastIndexOf('/');
  const id = Number(key.slice(i + 1));
  if (key.slice(0, i) !== botKey.value || !Number.isInteger(id)) return;
  selectedTradeId.value = id;
  pickedPair.value = null;
}
function selectTrade(_k: string, id: number) {
  selectedTradeId.value = id;
  pickedPair.value = null;
  if (!desktop.value) sheetOpen.value = true;
}
watch(
  () => route.query.trade,
  (v) => v && !desktop.value && (sheetOpen.value = true),
  { immediate: true },
);
// The phone sheet must not stay open (and reopen later) on a trade that is gone
watch(tradeGone, (gone) => gone && (sheetOpen.value = false));

// ---- pairs ----
const pairFilter = ref<PairFilter>('positions');
const selectedPairKey = computed(() =>
  position.value && pickedPair.value === null
    ? `${position.value.bot_key}/${position.value.trade_id}`
    : pickedPair.value,
);
function onPairSelect(item: PairItem) {
  if (item.tradeId !== null && item.botKey) {
    selectTrade(item.botKey, item.tradeId);
  } else {
    pickedPair.value = item.pair;
    selectedTradeId.value = null;
  }
}
function liftLock(item: PairItem) {
  if (item.lockId === null) return;
  // A lock removal mutates the bot: it goes through the same confirmation as every action
  toastRefusal(requestAction(botKey.value, { kind: 'lock_delete', lockId: item.lockId }));
}

// ---- chart ----
// A bot only serves the candles of its strategy timeframe: that is the default until one is picked
const tfPick = ref<string | null>(null);
watch(botKey, () => (tfPick.value = null));
const ownTf = computed(() => bot.value?.identity.timeframe ?? null);
const tf = computed({
  get: () => effectiveTf(tfPick.value, ownTf.value),
  set: (v: string) => (tfPick.value = v),
});
const tfOptions = computed(() =>
  timeframeOptions(ownTf.value).map((v) => ({ value: v, label: v })),
);
const orders = useTradeOrders(botKey, tradeId, () => position.value?.side ?? 'long');
const overlays = computed(() =>
  overlaysFromPosition(position.value, pair.value ?? '', {
    orders: orders.model.value?.ladder ?? [],
    fills: orders.model.value?.fills ?? [],
  }),
);
const ladderOrders = computed(() => orders.model.value?.ladder);
const dcaMax = computed(() => null as number | null);

// ---- history, performance ----
const closed = ref<TradeRow[]>([]);
const closedCursor = ref<string | null>(null);
const closedLoading = ref(false);
async function loadClosed(more = false) {
  const source = data.source.value;
  if (!source || closedLoading.value) return;
  closedLoading.value = true;
  try {
    const page = await source.query.trades({
      status: 'closed',
      bots: [botKey.value],
      sort: 'close_ms',
      order: 'desc',
      limit: 100,
      cursor: more ? closedCursor.value : null,
    });
    closed.value = more ? [...closed.value, ...page.items] : page.items;
    closedCursor.value = page.nextCursor;
  } catch {
    // The table keeps what it has; the next visit of the tab tries again
  } finally {
    closedLoading.value = false;
  }
}
watch(
  [() => tab.value === 'history', botKey, () => data.source.value],
  ([active]) => {
    if (active) void loadClosed();
  },
  { immediate: true },
);

const perfTrades = useTradeSet(() =>
  tab.value === 'performance' ? { status: 'closed', bots: [botKey.value] } : null,
);
const pairItems = computed<LeaderboardItem[]>(() => {
  const sums = new Map<string, number>();
  for (const tr of perfTrades.trades.value) {
    const v = knownProfit(tr);
    if (v !== null) sums.set(tr.pair, (sums.get(tr.pair) ?? 0) + v);
  }
  const mode = bot.value?.identity.mode ?? 'live';
  return [...sums.entries()].map(([p, value]) => ({
    key: p,
    name: pairLabel(p),
    mode,
    value,
    stale: false,
  }));
});
const eqPeriod = ref<EquityPeriod>('30d');
const eqDefinition = ref<EquityDefinition>('with_open');

// ---- shortcuts ----
useShortcuts([
  {
    id: 'bot.prev',
    keys: '[',
    labelKey: 'fq.shortcut.prevBot',
    group: 'list',
    run: () => goBot(prevKey.value),
  },
  {
    id: 'bot.next',
    keys: ']',
    labelKey: 'fq.shortcut.nextBot',
    group: 'list',
    run: () => goBot(nextKey.value),
  },
  {
    id: 'bot.pause',
    keys: 'p',
    labelKey: 'fq.shortcut.pause',
    group: 'actions',
    // Opens the confirmation of THIS bot; nothing is sent from the key
    run: () => void requestAction(botKey.value, buildAction('pause')!),
    enabled: () => bot.value !== null,
  },
]);

const header = ref<HTMLElement | null>(null);
const unknownBot = computed(() => fleet.loaded && !bot.value);
function editConfig() {
  const b = bot.value;
  if (!b) return;
  editorUsed.value = true;
  void configEditor.open(b.bot_key, b.identity.name, b.identity.mode);
}
const configRows = computed(() => {
  const b = bot.value;
  if (!b) return [];
  return [
    ['strategy', b.identity.strategy],
    ['exchange', b.identity.exchange],
    ['market', b.identity.market],
    ['stake', b.identity.stake_currency],
    ['mode', b.identity.mode],
    ['port', b.identity.port],
    ['maxTrades', b.state.max_open_trades],
  ] as Array<[string, string | number | null]>;
});
</script>

<template>
  <div ref="header" class="botpage" data-testid="bot-page" :data-bot="botKey">
    <template v-if="bot">
      <BotHeader
        :bot="bot"
        :can-prev="prevKey !== null"
        :can-next="nextKey !== null"
        :split-sensitive="phone"
        @prev="goBot(prevKey)"
        @next="goBot(nextKey)"
        @select-bot="palette.show()"
        @reconnect="router.push({ name: 'login' })"
        @navigate="(id) => nav.navigateAction(id, { botKey })"
      />

      <div class="grid">
        <Pane class="pairs" :title="t('fq.pg.bot.pairs')" icon="layers">
          <PairNavigator
            v-model:filter="pairFilter"
            :bot-key="botKey"
            :selected-key="selectedPairKey"
            :layout="desktop ? 'list' : 'chips'"
            @select="onPairSelect"
            @lift-lock="liftLock"
          />
        </Pane>

        <Pane
          class="chart"
          :title="pair ? pairLabel(pair) : t('fq.pg.bot.chart')"
          :meta="pair ? tf : undefined"
          icon="chart-candlestick"
        >
          <template #tools>
            <SegmentedControl
              v-model="tf"
              :options="tfOptions"
              size="sm"
              :label="t('fq.pg.bot.timeframe')"
            />
            <Btn
              v-if="pair"
              size="sm"
              variant="ghost"
              icon="chart-candlestick"
              @click="nav.navigateAction('chart', { botKey, pair })"
            >
              {{ t('fq.pg.bot.openCharts') }}
            </Btn>
          </template>
          <CandleChart
            v-if="pair"
            :key="`${botKey}/${pair}/${tf}`"
            :bot-key="botKey"
            :pair="pair"
            :tf="tf"
            :overlays="overlays"
            :height="phone ? '320px' : '100%'"
            controls
          />
          <EmptyState v-else icon="chart-candlestick" :title="t('fq.pg.bot.noPair')" />
        </Pane>

        <section class="tabsec">
          <Tabs v-model="tab" :tabs="tabs" :label="t('fq.nav.bot')" />
          <div class="tabbody">
            <template v-if="tab === 'positions'">
              <TradeTable
                preset="bot"
                :bot-key="botKey"
                :selected-key="position ? `${position.bot_key}/${position.trade_id}` : null"
                shortcuts
                @update:selected-key="moveSelection"
                hide-filters
                @open="selectTrade"
                @navigate="
                  (id, line) =>
                    nav.navigateAction(id, {
                      botKey: line.botKey,
                      pair: line.pair,
                      tradeId: line.tradeId,
                    })
                "
              />
            </template>
            <template v-else-if="tab === 'history'">
              <TradeTable
                preset="closed"
                :bot-key="botKey"
                :trades="closed"
                :cursor="closedCursor"
                @load-more="loadClosed(true)"
              />
              <p class="more">
                <Btn
                  size="sm"
                  variant="ghost"
                  @click="router.push({ path: '/journal', query: { bot: botKey } })"
                >
                  {{ t('fq.pg.bot.openJournal') }}
                </Btn>
              </p>
            </template>
            <template v-else-if="tab === 'performance'">
              <EquityCurve
                v-model:period="eqPeriod"
                v-model:definition="eqDefinition"
                :scope="{ kind: 'bot', botKey }"
                :mode="bot.identity.mode"
              />
              <h4 class="sub">{{ t('fq.pg.bot.perfPairs') }}</h4>
              <Skeleton v-if="perfTrades.loading.value" shape="row" :count="4" />
              <Leaderboard
                v-else
                :scope="{ kind: 'bot', botKey }"
                period="total"
                :mode="bot.identity.mode"
                :items="pairItems"
                :limit="12"
              />
              <p v-if="!perfTrades.complete.value" class="note">{{ t('fq.pg.bot.perfPartial') }}</p>
            </template>
            <template v-else-if="tab === 'pairs'">
              <PairNavigator
                :bot-key="botKey"
                filter="locks"
                :selected-key="selectedPairKey"
                @select="onPairSelect"
                @lift-lock="liftLock"
              />
              <PairlistPanel :bot-key="botKey" />
            </template>
            <template v-else-if="tab === 'logs'">
              <LogStream mode="compact" :bot="botKey" :limit="80" />
            </template>
            <template v-else>
              <dl class="cfg" data-testid="bot-config">
                <template v-for="[k, v] in configRows" :key="k">
                  <dt>{{ t(`fq.pg.bot.config.${k}`) }}</dt>
                  <dd>{{ v ?? t('fq.ds.notAvailable') }}</dd>
                </template>
              </dl>
              <p class="note">{{ t('fq.pg.bot.config.editHint') }}</p>
              <p class="more">
                <Btn size="sm" icon="settings" data-testid="bot-config-edit" @click="editConfig">{{
                  t('fq.pg.bot.config.edit')
                }}</Btn>
              </p>
            </template>
          </div>
        </section>

        <aside class="drawer">
          <TradeDrawer
            v-if="position && desktop"
            docked
            :bot-key="botKey"
            :trade-id="position.trade_id"
            :orders="ladderOrders"
            :dca-max="dcaMax"
            @navigate="
              (id) =>
                nav.navigateAction(id, {
                  botKey,
                  pair: position?.pair,
                  tradeId: position?.trade_id,
                })
            "
          />
          <Pane v-else-if="desktop" :title="t('fq.pg.bot.drawer')" icon="layers">
            <EmptyState
              icon="layers"
              :title="
                tradeGone
                  ? t('fq.pg.bot.tradeClosed')
                  : awaiting.missing.value > 0
                    ? t('fq.trade.awaiting', { n: awaiting.missing.value }, awaiting.missing.value)
                    : t('fq.pg.bot.noPosition')
              "
              :data-testid="tradeGone ? 'trade-closed' : undefined"
            />
          </Pane>
        </aside>
      </div>

      <TradeDrawer
        v-if="position && !desktop"
        :bot-key="botKey"
        :trade-id="position.trade_id"
        :open="sheetOpen"
        :orders="ladderOrders"
        :dca-max="dcaMax"
        @close="sheetOpen = false"
        @navigate="
          (id) =>
            nav.navigateAction(id, { botKey, pair: position?.pair, tradeId: position?.trade_id })
        "
      />
      <BotConfigEditorModal v-if="editorUsed" />
      <section v-if="phone" class="phone-alerts">
        <AlertRail :bot-key="botKey" :limit="4" />
      </section>
      <!-- Phone: "Exit all" and "Stop" at the very bottom, not next to Pause and Reload -->
      <div v-if="phone" class="foot-sens">
        <BotActionBar context="sensitive" :bot-key="botKey" />
      </div>
    </template>

    <div v-else-if="unknownBot" class="missing">
      <EmptyState
        icon="info"
        :title="t('fq.pg.bot.notFound', { key: botKey })"
        :hint="t('fq.pg.bot.notFoundHint')"
      >
        <Btn @click="router.push({ name: 'fleet' })">{{ t('fq.nav.fleet') }}</Btn>
      </EmptyState>
    </div>
    <div v-else class="loading"><Skeleton shape="kpi" :count="3" /></div>
  </div>
</template>

<style scoped>
.botpage {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  text-align: left;
}
.grid {
  display: grid;
  gap: var(--gut, 6px);
  padding: var(--gut, 6px);
  min-height: 0;
  flex: 1;
}
.drawer {
  min-width: 0;
  min-height: 0;
  display: grid;
}
.tabsec {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  overflow: hidden;
}
.tabbody {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.sub {
  margin: var(--s3) var(--s3) var(--s1);
  font-size: var(--t-md);
}
.note,
.more {
  margin: var(--s2) var(--s3);
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.cfg {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px var(--s4);
  margin: 0;
  padding: var(--s3);
  font-size: var(--t-sm);
}
.cfg dt {
  color: var(--fg-3);
}
.cfg dd {
  margin: 0;
}
.missing,
.loading {
  padding: var(--s6) var(--s4);
}
.phone-alerts {
  padding: 0 var(--gut, 6px) var(--s3);
}
.foot-sens {
  padding: 0 var(--gut, 6px) var(--s4);
}

/* Phone and tablet: one column, the tabs first, then the chart and the pairs */
.chart {
  min-height: 320px;
  order: 2;
}
.tabsec {
  order: 1;
  max-height: 70vh;
}
.pairs {
  order: 3;
  max-height: 260px;
}
.drawer {
  order: 4;
}
@media (min-width: 1024px) {
  .botpage {
    height: 100%;
  }
  .grid {
    grid-template-columns: 236px minmax(0, 1fr) clamp(340px, 26vw, 420px);
    grid-template-rows: minmax(320px, 1.6fr) minmax(0, 1fr);
    overflow: hidden;
  }
  .pairs {
    grid-column: 1;
    grid-row: 1 / span 2;
    max-height: none;
    order: 0;
  }
  .chart {
    grid-column: 2;
    grid-row: 1;
    order: 0;
  }
  .tabsec {
    grid-column: 2;
    grid-row: 2;
    max-height: none;
    order: 0;
  }
  .drawer {
    grid-column: 3;
    grid-row: 1 / span 2;
    order: 0;
  }
}
</style>
