<script setup lang="ts">
defineProps<{
  epochs: Record<string, unknown>[];
}>();

const expandedRows = ref<Record<string, boolean>>({});
</script>

<template>
  <div>
    <h4 class="text-sm font-semibold mb-2">Top 10 Epochs</h4>
    <DataTable
      v-model:expanded-rows="expandedRows"
      :value="epochs"
      size="small"
      show-gridlines
      bordered
      data-key="rank"
    >
      <Column expander style="width: 2rem" />
      <Column field="rank" header="#" style="width: 3rem" />
      <Column field="loss" header="Loss" sortable>
        <template #body="{ data }">
          {{ (data as Record<string, unknown>).loss }}
        </template>
      </Column>
      <Column field="profit_pct" header="Profit %" sortable>
        <template #body="{ data }">
          <span
            :class="{
              'text-green-500': ((data as Record<string, unknown>).profit_pct as number) > 0,
              'text-red-500': ((data as Record<string, unknown>).profit_pct as number) < 0,
            }"
          >
            {{ (data as Record<string, unknown>).profit_pct }}%
          </span>
        </template>
      </Column>
      <Column field="trades" header="Trades" sortable />
      <Column field="sharpe" header="Sharpe" sortable />
      <Column field="dd_pct" header="DD %" sortable>
        <template #body="{ data }">
          {{ (data as Record<string, unknown>).dd_pct }}%
        </template>
      </Column>
      <Column field="winrate" header="Win %" sortable>
        <template #body="{ data }">
          {{ (data as Record<string, unknown>).winrate }}%
        </template>
      </Column>
      <template #expansion="{ data }">
        <div class="p-3">
          <h5 class="text-xs font-semibold mb-1">Parameters</h5>
          <JsonViewer :data="(data as Record<string, unknown>).params as Record<string, unknown>" />
        </div>
      </template>
    </DataTable>
  </div>
</template>
