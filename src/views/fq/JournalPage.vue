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
  ShellSlot,
  TradeTable,
} from '@/components/fq';
import { resultByBot } from '@/components/fq/lib/journal';
import {
  JOURNAL_PERIODS,
  type JournalGrouping,
  type JournalPeriod,
} from '@/components/fq/lib/journalPage';
import { useJournal } from '@/composables/useJournal';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { BotKey } from '@/gateway/types.gen';

/**
 * The Journal (docs/redesign/02-design.md, section 3.4): filters, filtered totals, the closed
 * trades grouped by day with the server cursor, and the analysis (distribution, DCA depth, exit
 * reasons, per bot). Live by default, replay excluded by default and said so. The list, the
 * totals and the three analysis panels all come from the same query (`useJournal`). Read only: a
 * closed trade has no action; the row opens its detail sheet.
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

// ---- analysis ----
type AnTab = 'dist' | 'dca' | 'why' | 'bot';
const anTab = ref<AnTab>('dist');
const anTabs = computed<TabItem[]>(() =>
  (['dist', 'dca', 'why', 'bot'] as AnTab[]).map((id) => ({ id, label: t(`fq.jr.an.${id}`) })),
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
    <component :is="phone ? 'div' : ShellSlot" :name="phone ? undefined : 'scope'">
      <JournalFilterBar
        v-model="j.filters"
        :mode="j.scope.mode.value"
        :bot-options="botOptions"
        :reasons="reasons"
        :depth-available="j.depthAvailable.value"
        :export-scope="j.exportScope.value"
        :exporting="j.exporting.value"
        @update:mode="(m) => (j.scope.mode.value = m)"
        @export-csv="download"
      />
    </component>
    <component :is="phone ? 'div' : ShellSlot" :name="phone ? undefined : 'strip'">
      <JournalTotals
        :stats="j.stats.value"
        :totals="j.totals.value"
        :partial="j.partial.value"
        :loading="j.analysis.loading.value || j.loading.value"
        :bot-name="botName"
      />
    </component>

    <main class="jg">
      <Pane
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

      <Pane class="an" icon="activity" :title="t('fq.jr.an.title')">
        <template #tools>
          <Tabs v-model="anTab" :tabs="anTabs" :label="t('fq.jr.an.title')" />
        </template>
        <div class="anbody">
          <DistributionChart v-if="anTab === 'dist'" :trades="j.analysisRows.value" />
          <DcaDepthTable v-else-if="anTab === 'dca'" :trades="j.analysisRows.value" />
          <ExitReasonTable v-else-if="anTab === 'why'" :trades="j.analysisRows.value" />
          <div v-else class="bots" data-testid="by-bot">
            <EmptyState v-if="byBot.length === 0" icon="bot" :title="t('fq.jr.empty')" />
            <table v-else class="tbl">
              <thead>
                <tr>
                  <th class="l colh">{{ t('fq.jr.an.botCol') }}</th>
                  <th class="colh">{{ t('fq.jr.trades') }}</th>
                  <th class="colh">P&amp;L</th>
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
.anbody {
  min-height: 260px;
  display: flex;
  flex-direction: column;
}
.anbody > :deep(*) {
  flex: 1;
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
    grid-template-columns: minmax(0, 1fr) clamp(380px, 32vw, 480px);
    overflow: hidden;
  }
}
</style>
