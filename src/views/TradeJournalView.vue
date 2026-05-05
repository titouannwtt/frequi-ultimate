<script setup lang="ts">
import type { ClosedTrade } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();

const allTrades = computed(() =>
  botStore.allTradesSelectedBots.map((t) => ({
    ...t,
    botMode: botStore.botStores[t.botId]?.botState?.dry_run ? 'Dry' : 'Live',
  })),
);

const filters = ref({
  global: { value: null, matchMode: 'contains' as const },
  botMode: { value: null, matchMode: 'in' as const },
  botName: { value: null, matchMode: 'in' as const },
  pair: { value: null, matchMode: 'in' as const },
  exchange: { value: null, matchMode: 'in' as const },
  exit_reason: { value: null, matchMode: 'in' as const },
});

function getBotMode(trade: ClosedTrade): string {
  return botStore.botStores[trade.botId]?.botState?.dry_run ? 'Dry' : 'Live';
}

const uniqueModes = computed(() => {
  const modes = new Set(allTrades.value.map(t => getBotMode(t)));
  return [...modes].sort();
});

const uniqueBots = computed(() => [...new Set(allTrades.value.map(t => t.botName))].sort());
const uniquePairs = computed(() => [...new Set(allTrades.value.map(t => t.pair))].sort());
const uniqueExchanges = computed(() => [...new Set(allTrades.value.map(t => t.exchange).filter(Boolean))].sort());
const uniqueExitReasons = computed(() => [...new Set(allTrades.value.map(t => t.exit_reason).filter(Boolean))].sort());

const rowsPerPage = ref(100);

function formatDate(ts?: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function tradeDuration(trade: ClosedTrade): string {
  if (!trade.open_timestamp || !trade.close_timestamp) return '-';
  const ms = trade.close_timestamp - trade.open_timestamp;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${minutes}m`;
}

function tradeFees(trade: ClosedTrade): number {
  return (trade.fee_open_cost ?? 0) + (trade.fee_close_cost ?? 0);
}

function dcaCount(trade: ClosedTrade): number {
  return trade.nr_of_successful_entries ?? 1;
}

function concurrentPositions(trade: ClosedTrade): number {
  if (!trade.open_timestamp || !trade.close_timestamp) return 0;
  return allTrades.value.filter(t =>
    t.botId === trade.botId &&
    t.botTradeId !== trade.botTradeId &&
    t.open_timestamp < trade.close_timestamp! &&
    (t.close_timestamp ?? Date.now()) > trade.open_timestamp,
  ).length;
}

function exportCSV() {
  const sorted = [...allTrades.value].sort((a, b) => (a.close_timestamp ?? 0) - (b.close_timestamp ?? 0));
  const headers = ['Trade ID', 'Mode', 'Bot', 'Exchange', 'Pair', 'Direction', 'Open Date', 'Close Date', 'Duration', 'Entry Price', 'Exit Price', 'Fees', 'Profit', 'Profit %', 'DCA', 'Exit Reason', 'Stake', 'Concurrent'];
  const rows = sorted.map(t => [
    (t.trade_id ?? '').toString(),
    t.botMode ?? '',
    t.botName,
    t.exchange ?? '',
    t.pair,
    t.is_short ? 'Short' : 'Long',
    t.open_date ?? '',
    t.close_date ?? '',
    tradeDuration(t),
    t.open_rate?.toString() ?? '',
    t.close_rate?.toString() ?? '',
    tradeFees(t).toFixed(4),
    (t.profit_abs ?? 0).toFixed(4),
    ((t.profit_ratio ?? 0) * 100).toFixed(2),
    dcaCount(t).toString(),
    t.exit_reason ?? '',
    t.stake_amount?.toString() ?? '',
    concurrentPositions(t).toString(),
  ]);
  const esc = (f: string) => f.includes(',') || f.includes('"') ? `"${f.replace(/"/g, '""')}"` : f;
  const csv = [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trade_journal_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportExcel() {
  const xlsx = await import('xlsx');
  const sorted = [...allTrades.value].sort((a, b) => (a.close_timestamp ?? 0) - (b.close_timestamp ?? 0));
  const headers = ['Trade ID', 'Mode', 'Bot', 'Exchange', 'Pair', 'Direction', 'Open Date', 'Close Date', 'Duration', 'Entry Price', 'Exit Price', 'Fees', 'Profit', 'Profit %', 'DCA', 'Exit Reason', 'Stake', 'Concurrent'];
  const rows = sorted.map(t => [
    t.trade_id ?? '',
    t.botMode ?? '',
    t.botName,
    t.exchange ?? '',
    t.pair,
    t.is_short ? 'Short' : 'Long',
    t.open_date ?? '',
    t.close_date ?? '',
    tradeDuration(t),
    t.open_rate ?? 0,
    t.close_rate ?? 0,
    tradeFees(t),
    t.profit_abs ?? 0,
    (t.profit_ratio ?? 0) * 100,
    dcaCount(t),
    t.exit_reason ?? '',
    t.stake_amount ?? 0,
    concurrentPositions(t),
  ]);
  const ws = xlsx.utils.aoa_to_sheet([headers, ...rows]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Trades');
  xlsx.writeFile(wb, `trade_journal_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
</script>

<template>
  <div class="p-4 h-full flex flex-col gap-4" style="animation: ft-fade-in 300ms ease-out">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <h2 class="text-lg font-semibold">{{ t('nav.journal') }}</h2>
      <div class="flex items-center gap-2">
        <span class="text-xs text-surface-400">{{ allTrades.length }} trades</span>
        <Button size="small" severity="secondary" @click="exportCSV">
          <i-mdi-file-delimited class="mr-1" /> CSV
        </Button>
        <Button size="small" severity="secondary" @click="exportExcel">
          <i-mdi-file-excel class="mr-1" /> Excel
        </Button>
      </div>
    </div>

    <DataTable
      :value="allTrades"
      v-model:filters="filters"
      :paginator="true"
      :rows="rowsPerPage"
      :rows-per-page-options="[50, 100, 200, 500, 1000, 2000]"
      :global-filter-fields="['botName', 'pair', 'exit_reason', 'exchange', 'botMode']"
      sort-field="close_timestamp"
      :sort-order="-1"
      striped-rows
      removable-sort
      size="small"
      class="text-xs"
      filter-display="row"
      scroll-height="flex"
      scrollable
    >
      <Column field="trade_id" header="ID" sortable style="max-width: 5rem">
        <template #body="{ data }">{{ data.trade_id ?? '-' }}</template>
      </Column>
      <Column field="botMode" header="Mode" sortable :show-filter-menu="false" style="max-width: 6rem">
        <template #filter="{ filterModel, filterCallback }">
          <MultiSelect
            v-model="filterModel.value"
            :options="uniqueModes"
            placeholder="All"
            size="small"
            class="text-xs w-full"
            @change="filterCallback()"
          />
        </template>
        <template #body="{ data }">
          <span
            class="px-1.5 py-0.5 rounded text-[10px] font-semibold"
            :class="data.botMode === 'Dry' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'"
          >
            {{ data.botMode }}
          </span>
        </template>
      </Column>
      <Column field="botName" header="Bot" sortable :show-filter-menu="false">
        <template #filter="{ filterModel, filterCallback }">
          <MultiSelect
            v-model="filterModel.value"
            :options="uniqueBots"
            placeholder="All"
            size="small"
            class="text-xs w-full"
            @change="filterCallback()"
          />
        </template>
      </Column>
      <Column field="exchange" header="Exchange" sortable :show-filter-menu="false">
        <template #filter="{ filterModel, filterCallback }">
          <MultiSelect
            v-model="filterModel.value"
            :options="uniqueExchanges"
            placeholder="All"
            size="small"
            class="text-xs w-full"
            @change="filterCallback()"
          />
        </template>
        <template #body="{ data }">{{ data.exchange ?? '-' }}</template>
      </Column>
      <Column field="pair" header="Pair" sortable :show-filter-menu="false">
        <template #filter="{ filterModel, filterCallback }">
          <MultiSelect
            v-model="filterModel.value"
            :options="uniquePairs"
            placeholder="All"
            size="small"
            class="text-xs w-full"
            :max-selected-labels="2"
            @change="filterCallback()"
          />
        </template>
      </Column>
      <Column field="is_short" header="Dir" sortable>
        <template #body="{ data }">
          <span :class="data.is_short ? 'text-red-400' : 'text-green-400'" class="font-semibold">
            {{ data.is_short ? 'S' : 'L' }}
          </span>
        </template>
      </Column>
      <Column field="open_timestamp" header="Opened" sortable>
        <template #body="{ data }">{{ formatDate(data.open_timestamp) }}</template>
      </Column>
      <Column field="close_timestamp" header="Closed" sortable>
        <template #body="{ data }">{{ formatDate(data.close_timestamp) }}</template>
      </Column>
      <Column header="Duration" sortable sort-field="close_timestamp">
        <template #body="{ data }">{{ tradeDuration(data) }}</template>
      </Column>
      <Column field="open_rate" header="Entry">
        <template #body="{ data }">{{ data.open_rate?.toPrecision(6) ?? '-' }}</template>
      </Column>
      <Column field="close_rate" header="Exit">
        <template #body="{ data }">{{ data.close_rate?.toPrecision(6) ?? '-' }}</template>
      </Column>
      <Column header="Fees" sortable>
        <template #body="{ data }">{{ tradeFees(data).toFixed(4) }}</template>
      </Column>
      <Column field="profit_abs" header="Profit" sortable>
        <template #body="{ data }">
          <span :class="(data.profit_abs ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'" class="font-semibold">
            {{ (data.profit_abs ?? 0) >= 0 ? '+' : '' }}{{ (data.profit_abs ?? 0).toFixed(2) }}
          </span>
        </template>
      </Column>
      <Column field="profit_ratio" header="%" sortable>
        <template #body="{ data }">
          <span :class="(data.profit_ratio ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'">
            {{ ((data.profit_ratio ?? 0) * 100).toFixed(2) }}%
          </span>
        </template>
      </Column>
      <Column header="DCA" sortable sort-field="nr_of_successful_entries">
        <template #body="{ data }">{{ dcaCount(data) }}</template>
      </Column>
      <Column field="exit_reason" header="Exit Reason" sortable :show-filter-menu="false">
        <template #filter="{ filterModel, filterCallback }">
          <MultiSelect
            v-model="filterModel.value"
            :options="uniqueExitReasons"
            placeholder="All"
            size="small"
            class="text-xs w-full"
            @change="filterCallback()"
          />
        </template>
      </Column>
      <Column field="stake_amount" header="Stake" sortable>
        <template #body="{ data }">{{ data.stake_amount?.toFixed(2) ?? '-' }}</template>
      </Column>
      <Column header="Concurrent" sortable>
        <template #body="{ data }">{{ concurrentPositions(data) }}</template>
      </Column>
    </DataTable>
  </div>
</template>
