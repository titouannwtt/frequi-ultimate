<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import { Btn, EmptyState, ModeMark, Pane, PnlValue, SegmentedControl, Tabs } from '@/components/ds';
import type { TabItem } from '@/components/ds';
import {
  ClosedTradeSheet,
  DcaDepthTable,
  DistributionChart,
  ExitReasonTable,
  JournalFilterBar,
  JournalTotals,
  Leaderboard,
  PnlCalendar,
  ShellSlot,
  TradeTable,
} from '@/components/fq';
import { resultByBot } from '@/components/fq/lib/journal';
import type { LeaderboardPeriod } from '@/components/fq/lib/leaderboard';
import {
  JOURNAL_PERIODS,
  type JournalFilters,
  type JournalGrouping,
  type JournalPeriod,
} from '@/components/fq/lib/journalPage';
import { useJournal } from '@/composables/useJournal';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { BotKey, BotMode } from '@/gateway/types.gen';

/**
 * The Journal (docs/redesign/02-design.md, section 3.4; 05-friendly-plan.md, section 2.6): filters,
 * four filtered totals, then two views: the closed trades grouped by day with the server cursor,
 * and the analysis (distribution, DCA depth, exit reasons, per bot, then the fleet ranking and the
 * P&L calendar that used to sit on the Fleet). Live by default, replay excluded by default and
 * said so. The list, the totals and the first four analysis panels all come from the same query
 * (`useJournal`). Read only: a closed trade has no action; the row opens its detail sheet.
 * `?view=analysis&an=calendar` opens a view and a panel directly.
 */
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const fleet = useFqFleetStore();
const j = useJournal();

const phone = useMediaQuery('(max-width: 599px)');

// ---- arriving from another page: ?bot=, ?pair=, ?period= ----
function applyQuery() {
  const bot = typeof route.query.bot === 'string' ? route.query.bot : null;
  if (bot) {
    j.filters.bots = [bot];
    // A bot hidden by the current mode would give an empty page without saying why
    const mode = fleet.bots[bot]?.identity.mode;
    if (
      (mode === 'live' || mode === 'dry') &&
      j.scope.mode.value !== 'all' &&
      j.scope.mode.value !== mode
    ) {
      j.scope.mode.value = mode;
    }
  }
  if (typeof route.query.pair === 'string') j.filters.pair = route.query.pair;
  const p = route.query.period;
  if (typeof p === 'string' && (JOURNAL_PERIODS as readonly string[]).includes(p)) {
    j.filters.period = p as JournalPeriod;
  }
}
watch(() => [route.query.bot, route.query.pair, route.query.period], applyQuery, {
  immediate: true,
});
// Bots load after the first render: re-check once the fleet is known
watch(
  () => fleet.loaded,
  (loaded) => loaded && applyQuery(),
);

// The bar sends a whole new set of filters. `j.filters` is the composable's reactive object:
// assigning the property of the returned object would leave it (and the query) untouched
function setFilters(next: JournalFilters) {
  Object.assign(j.filters, next);
}

// ---- list ----
const grouping = computed({
  get: () => j.filters.grouping,
  set: (g: JournalGrouping) => (j.filters.grouping = g),
});
const groupOptions = computed(() =>
  (['day', 'bot', 'pair'] as JournalGrouping[]).map((g) => ({
    value: g,
    label: t(`fq.jr.group.${g}`),
  })),
);
const total = computed(() =>
  j.totals.value ? j.totals.value.count + j.totals.value.unknown : j.listRows.value.length,
);
const replayBots = computed(() => fleet.list.filter((b) => b.identity.mode === 'replay').length);
const listMeta = computed(() => {
  const parts = [
    t(
      'fq.jr.listMeta',
      { n: total.value, period: t(`fq.jr.period.${j.filters.period}`) },
      total.value,
    ),
  ];
  if (j.filters.sansReplay && replayBots.value > 0) {
    parts.push(t('fq.jr.replayExcluded', { n: replayBots.value }, replayBots.value));
  }
  return parts.join(' · ');
});
const botOptions = computed(() =>
  j.scope.bots.value.map((b) => ({ key: b.bot_key, name: b.identity.name, mode: b.identity.mode })),
);
const reasons = computed(() =>
  [...j.knownReasons.entries()]
    .map(([value, r]) => ({
      value,
      // A strategy's own reason keeps its text; the others are named in the user's language
      label: r.kind === 'custom' ? r.label : t(`fq.exit.${r.kind}`),
      trades: r.trades,
    }))
    .sort((a, b) => b.trades - a.trades),
);

// ---- detail sheet ----
const sheet = ref<{ botKey: BotKey; tradeId: number } | null>(null);
const sheetRow = computed(
  () =>
    j.listRows.value.find(
      (r) => r.bot_key === sheet.value?.botKey && r.trade_id === sheet.value?.tradeId,
    ) ??
    j.analysisRows.value.find(
      (r) => r.bot_key === sheet.value?.botKey && r.trade_id === sheet.value?.tradeId,
    ) ??
    null,
);

// ---- the two views: the trades, and the analysis ----
type View = 'list' | 'analysis';
const view = ref<View>(route.query.view === 'analysis' ? 'analysis' : 'list');
const viewTabs = computed<TabItem[]>(() =>
  (['list', 'analysis'] as View[]).map((id) => ({ id, label: t(`fq.jr.view.${id}`) })),
);

// ---- analysis ----
type AnTab = 'dist' | 'dca' | 'why' | 'bot' | 'rank' | 'calendar';
const AN_TABS: AnTab[] = ['dist', 'dca', 'why', 'bot', 'rank', 'calendar'];
const anFromQuery = (): AnTab => AN_TABS.find((id) => id === route.query.an) ?? 'dist';
const anTab = ref<AnTab>(anFromQuery());
const anTabs = computed<TabItem[]>(() => AN_TABS.map((id) => ({ id, label: t(`fq.jr.an.${id}`) })));
// The view and the panel live in the URL: a reload or a shared link comes back to the same place
watch([view, anTab], ([v, a]) => {
  if (route.name !== 'journal') return;
  void router.replace({
    query: {
      ...route.query,
      view: v === 'list' ? undefined : v,
      an: v === 'list' || a === 'dist' ? undefined : a,
    },
  });
});
watch(
  () => [route.query.view, route.query.an],
  () => {
    if (route.name !== 'journal') return;
    view.value = route.query.view === 'analysis' ? 'analysis' : 'list';
    anTab.value = anFromQuery();
  },
);
/** Ranking and calendar never mix modes: "All" shows the live bots, like on the Fleet. */
const figuresMode = computed<BotMode>(() => (j.scope.mode.value === 'dry' ? 'dry' : 'live'));
const lbPeriod = ref<LeaderboardPeriod>('30d');
const lbOptions = computed(() =>
  (['1d', '7d', '30d', 'total'] as LeaderboardPeriod[]).map((p) => ({
    value: p,
    label: t(`fq.jr.an.rankPeriod.${p}`),
  })),
);
const byBot = computed(() => resultByBot(j.analysisRows.value));
const botScale = computed(() => Math.max(1, ...byBot.value.map((r) => Math.abs(r.pnl))));
const botName = (k: string) => fleet.bots[k]?.identity.name ?? k;

// ---- export ----
async function download() {
  const csv = await j.exportCsv();
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `journal-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const noBots = computed(() => fleet.loaded && j.botKeys.value.length === 0);
</script>

<template>
  <div class="journal" data-testid="journal-page">
    <component :is="phone ? 'div' : ShellSlot" :name="phone ? undefined : 'strip'">
      <JournalTotals
        :stats="j.stats.value"
        :totals="j.totals.value"
        :partial="j.partial.value"
        :loading="j.analysis.loading.value || j.loading.value"
        :bot-name="botName"
      />
    </component>
    <component :is="phone ? 'div' : ShellSlot" :name="phone ? undefined : 'scope'">
      <JournalFilterBar
        :model-value="j.filters"
        :mode="j.scope.mode.value"
        :bot-options="botOptions"
        :reasons="reasons"
        :depth-available="j.depthAvailable.value"
        :export-scope="j.exportScope.value"
        :exporting="j.exporting.value"
        @update:model-value="setFilters"
        @update:mode="(m) => (j.scope.mode.value = m)"
        @export-csv="download"
      />
    </component>

    <div class="vbar">
      <Tabs v-model="view" :tabs="viewTabs" :label="t('fq.jr.view.label')" data-testid="jr-view" />
    </div>

    <main class="jg">
      <Pane
        v-if="view === 'list'"
        class="list"
        :title="t('fq.jr.listTitle')"
        icon="book-open-text"
        :meta="listMeta"
        :state="noBots ? 'empty' : j.error.value && j.rows.value.length === 0 ? 'error' : 'ready'"
        :error-message="j.error.value ?? undefined"
        :empty-title="t('fq.jr.noBots')"
        :empty-hint="t('fq.jr.noBotsHint')"
        empty-icon="bot"
      >
        <template #tools>
          <Btn
            v-if="j.staleSince.value !== null"
            size="sm"
            variant="primary"
            icon="refresh-cw"
            data-testid="journal-refresh"
            @click="j.refresh()"
            >{{ t('fq.jr.newClosed') }}</Btn
          >
          <SegmentedControl
            v-model="grouping"
            :options="groupOptions"
            size="sm"
            :label="t('fq.jr.group.label')"
          />
        </template>
        <TradeTable
          preset="journal"
          :trades="j.listRows.value"
          :cursor="j.cursor.value"
          :grouping="grouping"
          shortcuts
          @open="(k, id) => (sheet = { botKey: k, tradeId: id })"
          @open-bot="(k) => router.push({ name: 'bot', params: { botKey: k } })"
          @load-more="j.loadMore()"
        />
      </Pane>

      <Pane v-else class="an" icon="activity" :title="t('fq.jr.an.title')" :meta="listMeta">
        <div class="antabs">
          <Tabs v-model="anTab" :tabs="anTabs" :label="t('fq.jr.an.title')" data-testid="jr-an" />
        </div>
        <div class="anbody" :class="{ narrow: anTab === 'rank' || anTab === 'calendar' }">
          <DistributionChart v-if="anTab === 'dist'" :trades="j.analysisRows.value" />
          <DcaDepthTable v-else-if="anTab === 'dca'" :trades="j.analysisRows.value" />
          <ExitReasonTable v-else-if="anTab === 'why'" :trades="j.analysisRows.value" />
          <div v-else-if="anTab === 'bot'" class="bots" data-testid="by-bot">
            <EmptyState v-if="byBot.length === 0" icon="bot" :title="t('fq.jr.empty')" />
            <table v-else class="tbl">
              <thead>
                <tr>
                  <th class="l colh">{{ t('fq.jr.an.botCol') }}</th>
                  <th class="colh">{{ t('fq.jr.trades') }}</th>
                  <th class="colh" :title="t('fq.hint.col.pnl_abs')">{{ t('fq.col.pnl_abs') }}</th>
                  <th class="colh barc"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in byBot"
                  :key="r.botKey"
                  :class="fleet.bots[r.botKey]?.identity.mode === 'live' ? 'is-live' : 'is-dry'"
                >
                  <td class="l ui">
                    <ModeMark
                      v-if="fleet.bots[r.botKey]"
                      :mode="fleet.bots[r.botKey]!.identity.mode"
                    />
                    {{ botName(r.botKey) }}
                  </td>
                  <td>{{ r.trades }}</td>
                  <td><PnlValue :value="r.pnl" :decimals="2" /></td>
                  <td class="barc">
                    <span
                      class="hb"
                      :class="r.pnl >= 0 ? 'up' : 'down'"
                      :style="{ width: `${(Math.abs(r.pnl) / botScale) * 100}%` }"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="fleetfig" :data-testid="`an-${anTab}`">
            <p class="note">
              {{ t(j.scope.mode.value === 'all' ? 'fq.jr.an.figNoteAll' : 'fq.jr.an.figNote') }}
            </p>
            <template v-if="anTab === 'rank'">
              <div class="lbbar">
                <SegmentedControl
                  v-model="lbPeriod"
                  :options="lbOptions"
                  size="sm"
                  :label="t('fq.jr.an.rankPeriodLabel')"
                />
              </div>
              <Leaderboard
                :scope="j.scope.fleetScopeRef.value"
                :period="lbPeriod"
                :mode="figuresMode"
                @select="(k) => router.push({ name: 'bot', params: { botKey: k } })"
              />
            </template>
            <PnlCalendar v-else :scope="j.scope.fleetScopeRef.value" :mode="figuresMode" />
          </div>
        </div>
      </Pane>
    </main>

    <ClosedTradeSheet
      v-if="sheet"
      :bot-key="sheet.botKey"
      :trade-id="sheet.tradeId"
      :trade="sheetRow"
      @close="sheet = null"
      @open-bot="(k) => router.push({ name: 'bot', params: { botKey: k } })"
    />
  </div>
</template>

<style scoped>
.journal {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  text-align: left;
}
.vbar {
  display: flex;
  padding: 0 var(--s3);
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}
.jg {
  display: grid;
  gap: var(--gut, 6px);
  padding: var(--gut, 6px);
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(0, 1fr);
}
.list,
.an {
  min-width: 0;
  min-height: 0;
}
.antabs {
  display: flex;
  padding: 0 var(--s3);
  border-bottom: 1px solid var(--line);
}
/* The analysis body takes the rest of the panel, so a chart can fill it */
.an :deep(.pb) {
  display: flex;
  flex-direction: column;
}
.anbody {
  flex: 1 1 auto;
  min-height: 260px;
  display: flex;
  flex-direction: column;
}
.anbody > :deep(*) {
  flex: 1;
}
.anbody.narrow {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
}
.fleetfig {
  display: grid;
  align-content: start;
  gap: var(--s2);
  min-width: 0;
}
.fleetfig .note {
  margin: 0;
  padding: var(--s2) var(--s3) 0;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.lbbar {
  display: flex;
  padding: 0 var(--s3);
}
.bots {
  padding: var(--s2) var(--s3);
}
.bots .tbl {
  width: 100%;
}
.barc {
  width: 34%;
}
.hb {
  display: block;
  height: 8px;
  border-radius: 2px;
  min-width: 1px;
}
.hb.up {
  background: var(--profit);
}
.hb.down {
  background: var(--loss);
}
@media (max-width: 599px) {
  .vbar {
    padding: 0 var(--s2);
  }
  .jg {
    padding: 8px 0;
    gap: 8px;
  }
  .jg :deep(.pane) {
    border-radius: 0;
    border-left: 0;
    border-right: 0;
  }
}
@media (min-width: 1024px) {
  .journal {
    height: 100%;
  }
  .jg {
    overflow: hidden;
  }
}
</style>
