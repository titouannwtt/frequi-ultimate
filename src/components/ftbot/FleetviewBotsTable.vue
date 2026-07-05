<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FleetviewBot } from '@/types';

const { t } = useI18n();

const { overview, overviewError, overviewLoading, loadOverview, subscribe } = useFleetView();
subscribe();

const bots = computed((): FleetviewBot[] => overview.value?.bots ?? []);

const initialLoading = computed(() => overviewLoading.value && !overview.value);

// Adaptive columns: hide secondary columns as the widget gets narrower.
const rootEl = ref<HTMLElement | null>(null);
const { width: rootWidth } = useElementSize(rootEl);
const showWide = computed(() => rootWidth.value === 0 || rootWidth.value >= 1000);
const showMedium = computed(() => rootWidth.value === 0 || rootWidth.value >= 700);

type ModeFilter = 'all' | 'live' | 'dry';
const modeFilter = ref<ModeFilter>('live');
const modeOptions = computed((): { text: string; value: ModeFilter }[] => [
  { text: t('fleet.botsTable.modeLive'), value: 'live' },
  { text: t('fleet.botsTable.modeDry'), value: 'dry' },
  { text: t('fleet.botsTable.modeAll'), value: 'all' },
]);

const globalFilter = ref('');

const filteredBots = computed(() => {
  let rows = bots.value;
  if (modeFilter.value === 'live') rows = rows.filter((b) => !b.dry_run);
  else if (modeFilter.value === 'dry') rows = rows.filter((b) => b.dry_run);
  const q = globalFilter.value.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (b) =>
        b.bot_name.toLowerCase().includes(q) || (b.strategy ?? '').toLowerCase().includes(q),
    );
  }
  return rows;
});

const totals = computed(() => {
  const t = { effective: 0, pnl1d: 0, pnl7d: 0, pnl30d: 0, pnlTotal: 0, open: 0 };
  for (const b of filteredBots.value) {
    t.effective += b.capital.effective ?? 0;
    t.pnl1d += b.pnl.realized_1d;
    t.pnl7d += b.pnl.realized_7d;
    t.pnl30d += b.pnl.realized_30d;
    t.pnlTotal += b.pnl.realized_total;
    t.open += b.trades.open_count;
  }
  return t;
});

function directionSeverity(direction: string): string {
  switch (direction) {
    case 'long':
      return 'success';
    case 'short':
      return 'danger';
    case 'dual':
      return 'info';
    default:
      return 'secondary';
  }
}

function pnlClass(v: number): string {
  if (v > 0) return 'text-emerald-500';
  if (v < 0) return 'text-red-400';
  return 'text-surface-400';
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return '-';
  return v.toFixed(digits);
}

function humanDuration(seconds: number): string {
  if (seconds < 3600) return t('fleet.botsTable.durationM', { m: Math.round(seconds / 60) });
  if (seconds < 86400)
    return t('fleet.botsTable.durationHM', {
      h: Math.floor(seconds / 3600),
      m: Math.round((seconds % 3600) / 60),
    });
  return t('fleet.botsTable.durationDH', {
    d: Math.floor(seconds / 86400),
    h: Math.floor((seconds % 86400) / 3600),
  });
}

function processUptime(bot: FleetviewBot): string {
  if (!bot.uptime.process_start) return '-';
  return humanDuration(Date.now() / 1000 - bot.uptime.process_start);
}

function botAge(bot: FleetviewBot): string {
  if (!bot.uptime.first_trade) return '-';
  const start = new Date(bot.uptime.first_trade + 'Z').getTime();
  if (Number.isNaN(start)) return '-';
  return humanDuration((Date.now() - start) / 1000);
}

function maxLeverage(bot: FleetviewBot): number {
  return bot.badges.leverage_values.length ? Math.max(...bot.badges.leverage_values) : 0;
}
</script>

<template>
  <div ref="rootEl" class="flex flex-col h-full p-3 gap-3">
    <!-- Fetch error banner with retry -->
    <div
      v-if="overviewError"
      class="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-xs bg-red-500/10 border border-red-500/25 text-red-400"
    >
      <span class="flex items-center gap-1.5 min-w-0">
        <i-mdi-alert-circle-outline class="w-4 h-4 shrink-0" />
        <span class="truncate">{{ t('widgetState.fetchError') }}</span>
      </span>
      <button
        class="shrink-0 px-2 py-0.5 rounded bg-red-500/15 hover:bg-red-500/25 transition-colors cursor-pointer"
        @click="loadOverview()"
      >
        {{ t('widgetState.retry') }}
      </button>
    </div>

    <!-- Initial loading: table-shaped skeleton rows -->
    <div v-if="initialLoading" class="flex flex-col gap-2">
      <Skeleton height="1.5rem" width="70%" />
      <Skeleton v-for="i in 6" :key="i" height="1.25rem" />
    </div>

    <template v-else>
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div class="flex flex-wrap items-center gap-1.5 text-xs text-surface-500 dark:text-surface-400">
        <span class="inline-block px-1.5 py-0.5 rounded bg-surface-500/10">
          {{ t('fleet.botsTable.botCount', { count: filteredBots.length }) }}
        </span>
        <span class="inline-block px-1.5 py-0.5 rounded bg-surface-500/10">
          {{ t('fleet.botsTable.capital') }}
          <span class="font-mono tabular-nums font-semibold text-surface-700 dark:text-surface-200">
            {{ totals.effective.toFixed(0) }}
          </span>
        </span>
        <span class="inline-block px-1.5 py-0.5 rounded bg-surface-500/10">
          {{ t('fleet.botsTable.label1d') }}
          <span class="font-mono tabular-nums" :class="pnlClass(totals.pnl1d)">
            {{ totals.pnl1d.toFixed(2) }}
          </span>
        </span>
        <span class="inline-block px-1.5 py-0.5 rounded bg-surface-500/10">
          {{ t('fleet.botsTable.label7d') }}
          <span class="font-mono tabular-nums" :class="pnlClass(totals.pnl7d)">
            {{ totals.pnl7d.toFixed(2) }}
          </span>
        </span>
        <span class="inline-block px-1.5 py-0.5 rounded bg-surface-500/10">
          {{ t('fleet.botsTable.label30d') }}
          <span class="font-mono tabular-nums" :class="pnlClass(totals.pnl30d)">
            {{ totals.pnl30d.toFixed(2) }}
          </span>
        </span>
        <span class="inline-block px-1.5 py-0.5 rounded bg-surface-500/10">
          {{ t('fleet.botsTable.total') }}
          <span class="font-mono tabular-nums" :class="pnlClass(totals.pnlTotal)">
            {{ totals.pnlTotal.toFixed(2) }}
          </span>
        </span>
        <span class="inline-block px-1.5 py-0.5 rounded bg-surface-500/10">
          {{ t('fleet.botsTable.open') }}
          <span class="font-mono tabular-nums">{{ totals.open }}</span>
        </span>
      </div>
      <div class="flex items-center gap-2">
        <InputText
          v-model="globalFilter"
          :placeholder="t('fleet.botsTable.filterPlaceholder')"
          size="small"
        />
        <SelectButton
          v-model="modeFilter"
          :options="modeOptions"
          size="small"
          :allow-empty="false"
          option-label="text"
          option-value="value"
        />
      </div>
    </div>
    <div class="flex-1 min-h-0">
    <DataTable
      :value="filteredBots"
      sort-field="capital.effective"
      :sort-order="-1"
      striped-rows
      removable-sort
      size="small"
      class="text-xs"
      scrollable
      scroll-height="flex"
    >
      <template #empty>
        <div class="flex flex-col items-center gap-1.5 py-6 text-center">
          <i-mdi-robot-off class="w-8 h-8 text-surface-500" />
          <span class="text-sm text-surface-500 dark:text-surface-400">
            {{ t('fleet.botsTable.botCount', { count: 0 }) }}
          </span>
        </div>
      </template>
      <Column field="bot_name" :header="t('fleet.botsTable.colBot')" sortable frozen>
        <template #body="{ data }">
          <span class="font-semibold">{{ data.bot_name }}</span>
          <Tag
            v-if="data.dry_run"
            :value="t('fleet.botsTable.dryTag')"
            severity="secondary"
            class="ml-1 !text-[0.6rem] !py-0"
          />
          <span v-if="data.badges.frozen" :title="t('fleet.botsTable.frozenTitle')">&#129482;</span>
          <span v-if="data.badges.inert" :title="t('fleet.botsTable.inertTitle')">&#128164;</span>
          <span
            v-if="maxLeverage(data) > 1"
            :title="t('fleet.botsTable.leverageTitle', { leverage: maxLeverage(data) })"
            >&#9888;&#65039;</span
          >
          <span v-if="!data.db_ok" class="text-red-400" :title="t('fleet.botsTable.dbUnreadable')"
            >DB!</span
          >
        </template>
      </Column>
      <Column v-if="showMedium" field="strategy" :header="t('fleet.botsTable.colStrategy')" sortable>
        <template #body="{ data }">
          <span
            class="text-surface-500 dark:text-surface-400 truncate inline-block max-w-40"
            :title="data.strategy"
          >
            {{ data.strategy ?? '-' }}
          </span>
        </template>
      </Column>
      <Column field="direction" :header="t('fleet.botsTable.colDirection')" sortable>
        <template #body="{ data }">
          <Tag
            :value="data.direction"
            :severity="directionSeverity(data.direction)"
            class="!text-[0.65rem] !py-0"
          />
        </template>
      </Column>
      <Column field="capital.effective" :header="t('fleet.botsTable.colCapital')" sortable>
        <template #body="{ data }">
          <span
            class="block text-right font-mono tabular-nums"
            :class="{ 'text-surface-500': data.capital.effective === null }"
          >
            {{ fmt(data.capital.effective, 0) }}
          </span>
        </template>
      </Column>
      <Column field="pnl.realized_1d" :header="t('fleet.botsTable.colPnl1d')" sortable>
        <template #body="{ data }">
          <span class="block text-right font-mono tabular-nums" :class="pnlClass(data.pnl.realized_1d)">
            {{ fmt(data.pnl.realized_1d) }}
          </span>
        </template>
      </Column>
      <Column v-if="showMedium" field="pnl.realized_7d" :header="t('fleet.botsTable.label7d')" sortable>
        <template #body="{ data }">
          <span class="block text-right font-mono tabular-nums" :class="pnlClass(data.pnl.realized_7d)">
            {{ fmt(data.pnl.realized_7d) }}
          </span>
        </template>
      </Column>
      <Column v-if="showMedium" field="pnl.realized_30d" :header="t('fleet.botsTable.label30d')" sortable>
        <template #body="{ data }">
          <span class="block text-right font-mono tabular-nums" :class="pnlClass(data.pnl.realized_30d)">
            {{ fmt(data.pnl.realized_30d) }}
          </span>
        </template>
      </Column>
      <Column field="pnl.realized_total" :header="t('fleet.botsTable.total')" sortable>
        <template #body="{ data }">
          <span class="block text-right font-mono tabular-nums" :class="pnlClass(data.pnl.realized_total)">
            {{ fmt(data.pnl.realized_total) }}
          </span>
        </template>
      </Column>
      <Column field="trades.open_count" :header="t('fleet.botsTable.colOpen')" sortable>
        <template #body="{ data }">
          <span class="block text-right font-mono tabular-nums">{{ data.trades.open_count }}</span>
        </template>
      </Column>
      <Column v-if="showWide" field="trades.count_30d" :header="t('fleet.botsTable.colTrades30d')" sortable>
        <template #body="{ data }">
          <span class="block text-right font-mono tabular-nums">{{ data.trades.count_30d }}</span>
        </template>
      </Column>
      <Column
        v-if="showWide"
        :header="t('fleet.botsTable.colUptime')"
        sortable
        field="uptime.process_start"
        :sort-order="1"
      >
        <template #body="{ data }">
          <span class="font-mono tabular-nums">{{ processUptime(data) }}</span>
        </template>
      </Column>
      <Column v-if="showWide" :header="t('fleet.botsTable.colAge')" sortable field="uptime.first_trade">
        <template #body="{ data }">
          <span class="font-mono tabular-nums">{{ botAge(data) }}</span>
        </template>
      </Column>
      <Column v-if="showWide" field="port" :header="t('fleet.botsTable.colPort')" sortable>
        <template #body="{ data }">
          <span class="text-surface-500 font-mono tabular-nums">{{ data.port ?? '-' }}</span>
        </template>
      </Column>
    </DataTable>
    </div>
    </template>
  </div>
</template>
