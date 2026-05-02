<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  data: Array<{
    pair: string;
    trades: number;
    winrate: number;
    avg_profit: number;
    total_profit: number;
    profit_factor: number;
  }>;
}>();

const sortCol = ref<string>('total_profit');
const sortDir = ref<'asc' | 'desc'>('desc');

function toggleSort(col: string) {
  if (sortCol.value === col) {
    sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc';
  } else {
    sortCol.value = col;
    sortDir.value = 'desc';
  }
}

const sortedData = computed(() => {
  const d = [...props.data].filter((p) => p.pair !== 'TOTAL');
  d.sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortCol.value] as number;
    const bv = (b as Record<string, unknown>)[sortCol.value] as number;
    return sortDir.value === 'desc' ? bv - av : av - bv;
  });
  return d;
});

const totalRow = computed(() => props.data.find((p) => p.pair === 'TOTAL'));

function cellClass(value: number, metric: string): string {
  if (metric === 'winrate') {
    if (value >= 0.7) return 'cell-strong-pos';
    if (value >= 0.5) return 'cell-pos';
    if (value >= 0.3) return 'cell-neg';
    return 'cell-strong-neg';
  }
  if (value > 0) return value > 0.02 ? 'cell-strong-pos' : 'cell-pos';
  if (value < 0) return value < -0.02 ? 'cell-strong-neg' : 'cell-neg';
  return '';
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
}

const columns = computed(() => [
  { key: 'pair', label: t('strategyDev.columnPair') },
  { key: 'trades', label: t('strategyDev.metricTrades') },
  { key: 'winrate', label: t('strategyDev.metricWinRate') },
  { key: 'avg_profit', label: t('strategyDev.metricAvgProfit') },
  { key: 'total_profit', label: t('strategyDev.metricTotalProfit') },
  { key: 'profit_factor', label: t('strategyDev.metricPF') },
]);
</script>

<template>
  <div class="heatmap-table-wrapper">
    <table class="heatmap-table">
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            :class="{ sortable: true, sorted: sortCol === col.key }"
            @click="toggleSort(col.key)"
          >
            {{ col.label }}
            <span v-if="sortCol === col.key" class="sort-arrow">
              {{ sortDir === 'desc' ? '▼' : '▲' }}
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in sortedData" :key="row.pair">
          <td class="pair-cell">{{ row.pair }}</td>
          <td class="num-cell">{{ row.trades }}</td>
          <td class="num-cell" :class="cellClass(row.winrate, 'winrate')">
            {{ (row.winrate * 100).toFixed(1) }}%
          </td>
          <td class="num-cell" :class="cellClass(row.avg_profit, 'profit')">
            {{ fmtPct(row.avg_profit) }}
          </td>
          <td class="num-cell" :class="cellClass(row.total_profit, 'profit')">
            {{ fmtPct(row.total_profit) }}
          </td>
          <td class="num-cell" :class="row.profit_factor >= 1 ? 'cell-pos' : 'cell-neg'">
            {{ row.profit_factor.toFixed(2) }}
          </td>
        </tr>
      </tbody>
      <tfoot v-if="totalRow">
        <tr class="total-row">
          <td class="pair-cell"><b>TOTAL</b></td>
          <td class="num-cell"><b>{{ totalRow.trades }}</b></td>
          <td class="num-cell"><b>{{ (totalRow.winrate * 100).toFixed(1) }}%</b></td>
          <td class="num-cell" :class="cellClass(totalRow.avg_profit, 'profit')">
            <b>{{ fmtPct(totalRow.avg_profit) }}</b>
          </td>
          <td class="num-cell" :class="cellClass(totalRow.total_profit, 'profit')">
            <b>{{ fmtPct(totalRow.total_profit) }}</b>
          </td>
          <td class="num-cell"><b>{{ totalRow.profit_factor.toFixed(2) }}</b></td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
.heatmap-table-wrapper {
  overflow-x: auto;
  border-radius: 0.5rem;
  border: 1px solid rgba(69, 71, 90, 0.3);
}

.heatmap-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-family: var(--sd-font-mono);
}

.heatmap-table th {
  padding: 0.5rem 0.75rem;
  text-align: right;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #6c7086;
  background: rgba(30, 30, 46, 0.6);
  border-bottom: 1px solid rgba(69, 71, 90, 0.3);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.heatmap-table th:first-child {
  text-align: left;
}

.heatmap-table th:hover {
  color: #a6adc8;
}

.heatmap-table th.sorted {
  color: #89b4fa;
}

.sort-arrow {
  font-size: 8px;
  margin-left: 2px;
}

.heatmap-table td {
  padding: 0.375rem 0.75rem;
  border-bottom: 1px solid rgba(69, 71, 90, 0.15);
}

.pair-cell {
  color: #cdd6f4;
  font-weight: 500;
  white-space: nowrap;
}

.num-cell {
  text-align: right;
  color: #a6adc8;
}

.cell-strong-pos { color: #a6e3a1; background: rgba(166, 227, 161, 0.08); }
.cell-pos { color: #a6e3a1; }
.cell-neg { color: #f38ba8; }
.cell-strong-neg { color: #f38ba8; background: rgba(243, 139, 168, 0.08); }

.total-row td {
  border-top: 2px solid rgba(137, 180, 250, 0.2);
  background: rgba(30, 30, 46, 0.4);
}

.heatmap-table tbody tr:hover td {
  background: rgba(69, 71, 90, 0.15);
}
</style>
