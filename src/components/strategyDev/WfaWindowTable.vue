<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  windows: Record<string, unknown>[];
}>();

const columns = computed(() => [
  { field: 'index', header: '#', sortable: true, style: 'width: 3rem' },
  { field: 'train_range', header: t('strategyDev.trainRange') },
  { field: 'test_range', header: t('strategyDev.testRange') },
  { field: 'wfe', header: 'WFE', sortable: true },
  { field: 'train_profit', header: t('strategyDev.trainProfit'), sortable: true },
  { field: 'test_profit', header: t('strategyDev.testProfit'), sortable: true },
  { field: 'test_trades', header: t('strategyDev.oosTradesLabel'), sortable: true },
  { field: 'degradation', header: t('strategyDev.degradation'), sortable: true },
]);

const rows = computed(() =>
  props.windows.map((w, i) => ({
    index: i + 1,
    train_range: (w.train_timerange as string) ?? '',
    test_range: (w.test_timerange as string) ?? '',
    wfe: w.wfe != null ? Number(w.wfe) : null,
    train_profit: w.train_profit != null ? Number(w.train_profit) : null,
    test_profit: w.test_profit != null ? Number(w.test_profit) : null,
    test_trades: w.test_trades != null ? Number(w.test_trades) : null,
    degradation: w.degradation != null ? Number(w.degradation) : null,
    raw: w,
  })),
);

function fmtPct(v: number | null): string {
  return v != null ? `${(v * 100).toFixed(2)}%` : '—';
}

function wfeClass(v: number | null): string {
  if (v == null) return '';
  if (v >= 0.5) return 'text-green-500';
  if (v >= 0.2) return 'text-yellow-500';
  return 'text-red-500';
}

function profitClass(v: number | null): string {
  if (v == null) return '';
  return v > 0 ? 'text-green-500' : 'text-red-500';
}
</script>

<template>
  <div class="mt-4">
    <h4 class="text-sm font-semibold mb-2">{{ t('strategyDev.windowsTitle') }}</h4>
    <DataTable
      :value="rows"
      size="small"
      stripedRows
      class="text-sm"
      scrollable
      scrollHeight="400px"
    >
      <Column
        v-for="col in columns"
        :key="col.field"
        :field="col.field"
        :header="col.header"
        :sortable="col.sortable"
        :style="col.style"
      >
        <template #body="{ data }">
          <template v-if="col.field === 'wfe'">
            <span :class="wfeClass(data.wfe)" class="font-semibold">
              {{ data.wfe != null ? data.wfe.toFixed(3) : '—' }}
            </span>
          </template>
          <template v-else-if="col.field === 'train_profit'">
            <span :class="profitClass(data.train_profit)">{{ fmtPct(data.train_profit) }}</span>
          </template>
          <template v-else-if="col.field === 'test_profit'">
            <span :class="profitClass(data.test_profit)">{{ fmtPct(data.test_profit) }}</span>
          </template>
          <template v-else-if="col.field === 'degradation'">
            <span :class="data.degradation != null && data.degradation > 0.5 ? 'text-red-500' : ''">
              {{ data.degradation != null ? data.degradation.toFixed(3) : '—' }}
            </span>
          </template>
          <template v-else>
            {{ data[col.field] ?? '—' }}
          </template>
        </template>
      </Column>
    </DataTable>
  </div>
</template>
