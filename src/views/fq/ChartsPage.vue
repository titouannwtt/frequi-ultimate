<script setup lang="ts">
import { useLocalStorage, useMediaQuery } from '@vueuse/core';
import { computed, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { Btn, EmptyState, Menu, Pane, SegmentedControl } from '@/components/ds';
import type { MenuItem } from '@/components/ds';
import {
  ChartCell,
  IndicatorsSheet,
  PairNavigator,
  PositionCard,
  ShellSlot,
  TradeDrawer,
} from '@/components/fq';
import {
  chartsQuery,
  contextBotFor,
  effectiveTf,
  stickyDefaultPair,
  parseChartsQuery,
  plotProps,
  resolvePlotChoice,
  secondPair,
  timeframeOptions,
  type CellCount,
  type ChartTf,
} from '@/components/fq/lib/chartsPage';
import type { PairFilter, PairItem } from '@/components/fq/lib/pairs';
import { lineFromPosition } from '@/components/fq/lib/trades';
import { useActionNav } from '@/composables/useActionNav';
import { useCommandPalette } from '@/composables/useCommandPalette';
import { useShortcuts } from '@/composables/useShortcuts';
import { useTradeOrders } from '@/composables/useTradeOrders';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { BotKey } from '@/gateway/types.gen';

/**
 * The Charts page (docs/redesign/02-design.md, section 3.3): the toolbar (pair, context bot,
 * timeframe, one or two cells, Heikin-Ashi, measure, indicators), the pair navigator with the open
 * positions of the fleet first, and the chart cells. What is on screen lives in the URL
 * (`/charts?bot=&pair=&tf=&cells=&pair2=&ha=`), so a view can be shared and survives a reload. The
 * context bot is the one whose strategy computes the indicators; it defaults to the bot holding a
 * position on the pair. Candles are read through the bot proxy (GET only), nothing here writes.
 */
const { t, te } = useI18n();
const route = useRoute();
const router = useRouter();
const fleet = useFqFleetStore();
const positionsStore = useFqPositionsStore();
const prefs = useFqPrefsStore();
const palette = useCommandPalette();
const nav = useActionNav();

const phone = useMediaQuery('(max-width: 599px)');
const desktop = useMediaQuery('(min-width: 1024px)');

// ---- state: the URL is the source of truth, defaults are derived ----
const requested = computed(() => parseChartsQuery(route.query));

// The default pair is chosen once (see stickyDefaultPair): the chart does not move under the user
const defaulted = ref<{ bot: BotKey | null; pair: string | null }>({ bot: null, pair: null });
watchEffect(() => {
  const bot = requested.value.bot;
  const current = defaulted.value.bot === bot ? defaulted.value.pair : null;
  const next = stickyDefaultPair(current, positionsStore.list, bot);
  if (next !== defaulted.value.pair || bot !== defaulted.value.bot) {
    defaulted.value = { bot, pair: next };
  }
});
const pair = computed(() => requested.value.pair ?? defaulted.value.pair);
const botKey = computed<BotKey | null>(() =>
  contextBotFor({
    pair: pair.value,
    requested: requested.value.bot,
    selected: prefs.settings.selectedBot,
    positions: positionsStore.list,
    bots: fleet.list,
  }),
);
// A bot only serves the candles of its strategy timeframe: that is the default, not a fixed 15m
const ownTf = computed(() =>
  botKey.value ? (fleet.bots[botKey.value]?.identity.timeframe ?? null) : null,
);
const tf = computed<ChartTf>(() => effectiveTf(requested.value.tf, ownTf.value));
// Under 1024 px there is room for one cell only
const cellCount = computed<CellCount>(() => (desktop.value ? requested.value.cells : 1));
const pair2 = computed(() =>
  cellCount.value === 2
    ? (requested.value.pair2 ?? secondPair(positionsStore.list, pair.value))
    : null,
);
const heikinAshi = computed(() => requested.value.ha ?? prefs.settings.ui.useHeikinAshiCandles);

function update(
  patch: Partial<{
    bot: BotKey | null;
    pair: string | null;
    pair2: string | null;
    tf: ChartTf | null;
    cells: CellCount;
    ha: boolean | null;
  }>,
) {
  const next = {
    bot: botKey.value,
    pair: pair.value,
    pair2: pair2.value,
    // Still implicit unless the user chose one: it follows the context bot
    tf: requested.value.tf,
    cells: requested.value.cells,
    ha: requested.value.ha,
    ...patch,
  };
  void router.replace({ query: chartsQuery(next) });
}

// A default context bot or pair becomes explicit once the user changes something, not before
const activeCell = ref<0 | 1>(0);
watch(cellCount, (n) => n === 1 && (activeCell.value = 0));

function onSelect(item: PairItem) {
  const patch: Parameters<typeof update>[0] = {};
  if (item.botKey) patch.bot = item.botKey;
  if (activeCell.value === 1 && cellCount.value === 2) patch.pair2 = item.pair;
  else patch.pair = item.pair;
  update(patch);
}
const selectedKey = computed(() => {
  const cur = activeCell.value === 1 && cellCount.value === 2 ? pair2.value : pair.value;
  if (!cur) return null;
  const mine = positionsStore.list.find((p) => p.pair === cur && p.bot_key === botKey.value);
  return mine ? `${mine.bot_key}/${mine.trade_id}` : cur;
});

const filter = ref<PairFilter>('positions');
const filterTabs: PairFilter[] = ['positions', 'signals', 'all'];

// ---- toolbar ----
const tfOptions = computed(() =>
  timeframeOptions(ownTf.value).map((v) => ({
    value: v,
    label: te(`fq.pg.charts.tf.${v}`) ? t(`fq.pg.charts.tf.${v}`) : v,
  })),
);
const cellOptions = computed(() => [
  { value: 1 as CellCount, label: t('fq.pg.charts.cells1'), icon: 'square' as const },
  { value: 2 as CellCount, label: t('fq.pg.charts.cells2'), icon: 'columns-2' as const },
]);
const botName = computed(() =>
  botKey.value ? (fleet.bots[botKey.value]?.identity.name ?? botKey.value) : null,
);

const ctxAnchor = ref<HTMLElement | null>(null);
const ctxOpen = ref(false);
const ctxItems = computed<MenuItem[]>(() => {
  const out: MenuItem[] = [];
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  for (const mode of ['live', 'dry'] as const) {
    const bots = fleet.list
      .filter((b) => b.identity.mode === mode)
      .sort((a, b) => collator.compare(a.identity.name, b.identity.name));
    if (bots.length === 0) continue;
    out.push({ id: `__h-${mode}`, kind: 'heading', label: t(`fq.scope.${mode}`) });
    for (const b of bots) out.push({ id: b.bot_key, label: b.identity.name });
  }
  return out;
});
function toggleCtx(e: MouseEvent) {
  ctxAnchor.value = e.currentTarget as HTMLElement;
  ctxOpen.value = !ctxOpen.value;
}

// ---- measure, indicators ----
const measureArmed = ref(false);
const indicatorsOpen = ref(false);
const rsi = useLocalStorage('fqu2.charts.rsi', true);
const plot = computed(() =>
  plotProps(
    resolvePlotChoice(prefs.settings.plot?.plotConfigName, prefs.settings.plot?.customPlotConfigs),
  ),
);

// ---- the open position of the first cell: card on a phone, sheet on request ----
const position = computed(
  () =>
    (botKey.value ? positionsStore.byBot(botKey.value).find((p) => p.pair === pair.value) : null) ??
    null,
);
const line = computed(() =>
  position.value
    ? lineFromPosition(position.value, botKey.value ? fleet.bots[botKey.value] : undefined)
    : null,
);
const sheet = ref<{ botKey: BotKey; tradeId: number } | null>(null);
// The orders of the trade the sheet shows (not of the first cell's)
const sheetOrders = useTradeOrders(
  () => sheet.value?.botKey ?? null,
  () => sheet.value?.tradeId ?? null,
  () =>
    (sheet.value ? positionsStore.get(sheet.value.botKey, sheet.value.tradeId)?.side : null) ??
    'long',
);

function openBot(key: BotKey, p: string) {
  void router.push({ name: 'bot', params: { botKey: key }, query: { pair: p } });
}

useShortcuts([
  ...([1, 2] as const).map((n) => ({
    id: `charts.cells.${n}`,
    keys: String(n),
    alt: true,
    labelKey: n === 1 ? 'fq.pg.charts.cells1' : 'fq.pg.charts.cells2',
    group: 'display' as const,
    run: () => update({ cells: n }),
  })),
]);
</script>

<template>
  <div class="charts" data-testid="charts-page" :data-cells="cellCount">
    <component :is="phone ? 'div' : ShellSlot" :name="phone ? undefined : 'scope'">
      <div class="cbar" role="toolbar" :aria-label="t('fq.pg.charts.toolbar')">
        <Btn size="sm" icon="search" data-testid="charts-pair" @click="palette.show()">
          <b>{{ pair ?? t('fq.pg.charts.pickPair') }}</b>
        </Btn>
        <Btn
          size="sm"
          icon="bot"
          :title="t('fq.pg.charts.contextTip')"
          data-testid="charts-context"
          :aria-expanded="ctxOpen"
          aria-haspopup="menu"
          @click="toggleCtx"
        >
          <span class="lab">{{ t('fq.pg.charts.context') }}</span>
          <b v-if="botName">{{ botName }}</b>
        </Btn>
        <Menu
          :open="ctxOpen"
          :anchor="ctxAnchor"
          :items="ctxItems"
          :label="t('fq.pg.charts.context')"
          @select="(k) => update({ bot: k })"
          @close="ctxOpen = false"
        />
        <SegmentedControl
          :model-value="tf"
          :options="tfOptions"
          size="sm"
          :label="t('fq.pg.charts.timeframe')"
          @update:model-value="(v) => update({ tf: v as ChartTf })"
        />
        <SegmentedControl
          v-if="desktop"
          :model-value="cellCount"
          :options="cellOptions"
          size="sm"
          :label="t('fq.pg.charts.cells')"
          @update:model-value="(v) => update({ cells: v })"
        />
        <span class="right">
          <Btn
            size="sm"
            :variant="heikinAshi ? 'secondary' : 'ghost'"
            :aria-pressed="heikinAshi"
            :title="t('fq.pg.charts.haTip')"
            :aria-label="t('fq.pg.charts.haTip')"
            data-testid="charts-ha"
            @click="update({ ha: !heikinAshi })"
            >{{ t('fq.pg.charts.ha') }}</Btn
          >
          <Btn
            size="sm"
            :variant="measureArmed ? 'secondary' : 'ghost'"
            icon="ruler"
            :aria-pressed="measureArmed"
            :title="t('fq.pg.charts.measureTip')"
            data-testid="charts-measure"
            @click="measureArmed = !measureArmed"
            ><span class="hide-m">{{ t('fq.pg.charts.measure') }}</span></Btn
          >
          <Btn
            size="sm"
            variant="ghost"
            icon="chart-line"
            data-testid="charts-indicators"
            @click="indicatorsOpen = true"
            >{{ t('fq.pg.charts.indicators') }}</Btn
          >
        </span>
      </div>
    </component>

    <PairNavigator
      v-if="!desktop"
      v-model:filter="filter"
      class="chips"
      layout="chips"
      :bot-key="botKey"
      fleet-positions
      :tabs="filterTabs"
      :selected-key="selectedKey"
      @select="onSelect"
    />

    <div class="grid">
      <Pane v-if="desktop" class="nav" :title="t('fq.pg.charts.pairs')" icon="layers">
        <PairNavigator
          v-model:filter="filter"
          :bot-key="botKey"
          fleet-positions
          :tabs="filterTabs"
          :selected-key="selectedKey"
          @select="onSelect"
        />
      </Pane>

      <div class="cells" :class="{ g2: cellCount === 2 }">
        <template v-if="botKey && pair">
          <ChartCell
            :bot-key="botKey"
            :pair="pair"
            :tf="tf"
            :heikin-ashi="heikinAshi"
            :plot-config="plot.plotConfig"
            :plot-extra="plot.plotExtra"
            :measure-armed="measureArmed"
            :active="cellCount === 2 && activeCell === 0"
            :height="desktop ? '100%' : '62vh'"
            @select="activeCell = 0"
            @open-bot="openBot"
            @open-trade="(k, id) => (sheet = { botKey: k, tradeId: id })"
          />
          <ChartCell
            v-if="cellCount === 2 && pair2"
            :bot-key="botKey"
            :pair="pair2"
            :tf="tf"
            :heikin-ashi="heikinAshi"
            :plot-config="plot.plotConfig"
            :plot-extra="plot.plotExtra"
            :measure-armed="measureArmed"
            :active="activeCell === 1"
            @select="activeCell = 1"
            @open-bot="openBot"
            @open-trade="(k, id) => (sheet = { botKey: k, tradeId: id })"
          />
        </template>
        <Pane v-else class="empty" :title="t('fq.nav.charts')" icon="chart-candlestick">
          <EmptyState
            icon="chart-candlestick"
            :title="fleet.loaded ? t('fq.pg.charts.noPair') : t('fq.ds.loading')"
            :hint="fleet.loaded ? t('fq.pg.charts.noPairHint') : undefined"
          />
        </Pane>
      </div>
    </div>

    <section v-if="!desktop && line" class="mpos" data-testid="charts-position">
      <h3>{{ t('fq.pg.charts.openOn', { pair: line.pair }) }}</h3>
      <PositionCard
        :line="line"
        :position="position"
        @activate="sheet = { botKey: line.botKey, tradeId: line.tradeId }"
      />
    </section>

    <IndicatorsSheet v-model:rsi="rsi" :open="indicatorsOpen" @close="indicatorsOpen = false" />
    <TradeDrawer
      v-if="sheet"
      :bot-key="sheet.botKey"
      :trade-id="sheet.tradeId"
      :open="true"
      :orders="sheetOrders.model.value?.ladder"
      :dca-max="null"
      @close="sheet = null"
      @navigate="
        (id) =>
          sheet &&
          nav.navigateAction(id, {
            botKey: sheet.botKey,
            pair: positionsStore.get(sheet.botKey, sheet.tradeId)?.pair,
            tradeId: sheet.tradeId,
          })
      "
    />
  </div>
</template>

<style scoped>
.charts {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  text-align: left;
}
.cbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px var(--s3);
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  scrollbar-width: none;
}
.cbar::-webkit-scrollbar {
  display: none;
}
.cbar > :deep(*) {
  flex: none;
}
.hide-m {
  display: inline;
}
@media (max-width: 599px) {
  .hide-m {
    display: none;
  }
}
.lab {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.right {
  margin-left: auto;
  display: flex;
  gap: 6px;
  align-items: center;
}
.chips {
  border-bottom: 1px solid var(--line);
  background: var(--bg-1);
}
.grid {
  display: grid;
  gap: var(--gut, 6px);
  padding: var(--gut, 6px);
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1fr);
}
.cells {
  display: grid;
  gap: var(--gut, 6px);
  min-height: 0;
  grid-template-columns: minmax(0, 1fr);
}
.cells > :deep(.cell) {
  min-height: 380px;
}
.mpos {
  padding: 0 var(--gut, 6px) var(--s3);
}
.mpos h3 {
  margin: var(--s2) var(--s2);
  font-size: var(--t-sm);
  color: var(--fg-2);
}
@media (max-width: 599px) {
  .grid {
    padding: 0;
    gap: 0;
  }
  .cells > :deep(.cell) {
    border-radius: 0;
    border-left: 0;
    border-right: 0;
  }
}
@media (min-width: 1024px) {
  .charts {
    height: 100%;
  }
  .grid {
    grid-template-columns: 260px minmax(0, 1fr);
    overflow: hidden;
  }
  .nav {
    min-height: 0;
  }
  .cells.g2 {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .cells > :deep(.cell) {
    min-height: 0;
  }
}
</style>
