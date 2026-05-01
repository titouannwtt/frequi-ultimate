<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RunType } from '@/types';

const { t } = useI18n();
const store = useStrategyDevStore();

const params = computed<Record<string, unknown> | null>(() => {
  const run = store.selectedRun;
  if (!run) return null;

  if (run.run_type === RunType.hyperopt) {
    const d = store.hyperoptDetail;
    if (!d) return null;
    return (d.best_params as Record<string, unknown>) ?? null;
  }
  if (run.run_type === RunType.wfa) {
    const d = store.wfaDetail;
    if (!d) return null;
    return (d.consensus_params as Record<string, unknown>) ?? null;
  }
  if (run.run_type === RunType.backtest) {
    const snap = store.backtestSnapshot;
    if (!snap) return null;
    return (snap.strategy_params as Record<string, unknown>) ?? null;
  }
  return null;
});

const paramStats = computed(() => {
  if (!store.hyperoptAnalysis) return null;
  const analysis = store.hyperoptAnalysis as Record<string, unknown>;
  return analysis.param_stats as Record<string, Record<string, unknown>> | undefined;
});

const runType = computed(() => store.selectedRun?.run_type);

const viewMode = ref<'json' | 'table'>('json');

const jsonString = computed(() => {
  if (!params.value) return '';
  return JSON.stringify(params.value, null, 2);
});

const copied = ref(false);
async function copyParams() {
  if (params.value) {
    await navigator.clipboard.writeText(JSON.stringify(params.value, null, 2));
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  }
}

interface ParamRow {
  space: string;
  key: string;
  value: unknown;
  recommended?: unknown;
  top10Median?: unknown;
  top5Median?: unknown;
}

const tableRows = computed<ParamRow[]>(() => {
  const p = params.value;
  if (!p) return [];
  const stats = paramStats.value;
  const rows: ParamRow[] = [];

  for (const [space, spaceParams] of Object.entries(p)) {
    if (typeof spaceParams === 'object' && spaceParams !== null && !Array.isArray(spaceParams)) {
      for (const [key, value] of Object.entries(spaceParams as Record<string, unknown>)) {
        const row: ParamRow = { space, key, value };
        if (stats && stats[key]) {
          row.recommended = stats[key].recommended;
          row.top10Median = stats[key].median;
          row.top5Median = stats[key].median_top5;
        }
        rows.push(row);
      }
    } else {
      rows.push({ space: '', key: space, value: spaceParams });
    }
  }
  return rows;
});

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4);
  return String(v);
}

function valClass(v: unknown): string {
  if (v === null || v === undefined) return 'text-surface-400';
  if (typeof v === 'number') return 'text-blue-400';
  if (typeof v === 'boolean') return 'text-orange-400';
  if (typeof v === 'string') return 'text-green-400';
  return '';
}
</script>

<template>
  <div class="flex flex-col gap-3 py-3" style="max-width: 1600px; margin: 0 auto">
    <div v-if="!params" class="text-center text-surface-500 py-8">
      {{ t('strategyDev.noParamsAvailable') }}
    </div>
    <template v-else>
      <!-- Toolbar -->
      <div class="flex justify-between items-center">
        <div class="flex items-center gap-2">
          <h4 class="text-sm font-semibold">{{ t('strategyDev.tabParameters') }}</h4>
          <Tag v-if="runType === RunType.hyperopt" :value="t('strategyDev.ppBestEpochTag')" severity="success" class="text-sm" />
          <Tag v-else-if="runType === RunType.wfa" :value="t('strategyDev.ppConsensusTag')" severity="info" class="text-sm" />
          <Tag v-else-if="runType === RunType.backtest" :value="t('strategyDev.ppSnapshotTag')" severity="secondary" class="text-sm" />
        </div>
        <div class="flex items-center gap-2">
          <SelectButton
            v-model="viewMode"
            :options="[
              { label: 'JSON', value: 'json' },
              { label: 'Table', value: 'table' },
            ]"
            optionLabel="label"
            optionValue="value"
            :allowEmpty="false"
            class="text-sm"
          />
          <Button
            size="small"
            severity="secondary"
            variant="outlined"
            @click="copyParams"
          >
            <i-mdi-check v-if="copied" class="w-4 h-4 mr-1 text-green-400" />
            <i-mdi-content-copy v-else class="w-4 h-4 mr-1" />
            {{ copied ? t('strategyDev.copied') : t('strategyDev.copyJson') }}
          </Button>
        </div>
      </div>

      <!-- JSON View -->
      <div v-if="viewMode === 'json'" class="text-left">
        <CodeViewer :code="jsonString" language="json" />
      </div>

      <!-- Table View -->
      <div v-else>
        <div class="param-table-wrap">
          <table class="param-table">
            <thead>
              <tr>
                <th v-if="tableRows.some(r => r.space)" class="th-space">{{ t('strategyDev.ppSpace') }}</th>
                <th class="th-param">{{ t('strategyDev.ppParameter') }}</th>
                <th class="th-val">
                  {{ runType === RunType.hyperopt ? t('strategyDev.ppBestEpochTag') : runType === RunType.wfa ? t('strategyDev.ppConsensusTag') : t('strategyDev.ppValue') }}
                </th>
                <template v-if="runType === RunType.hyperopt && paramStats">
                  <th class="th-val">{{ t('strategyDev.ppTop5Median') }}</th>
                  <th class="th-val">{{ t('strategyDev.ppTop10Median') }}</th>
                  <th class="th-val">{{ t('strategyDev.ppRecommended') }}</th>
                </template>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in tableRows" :key="i">
                <td v-if="tableRows.some(r => r.space)" class="td-space">
                  <Tag v-if="row.space" :value="row.space" severity="secondary" class="text-sm" />
                </td>
                <td class="td-param">{{ row.key }}</td>
                <td class="td-val" :class="valClass(row.value)">{{ formatVal(row.value) }}</td>
                <template v-if="runType === RunType.hyperopt && paramStats">
                  <td class="td-val" :class="valClass(row.top5Median)">{{ formatVal(row.top5Median) }}</td>
                  <td class="td-val" :class="valClass(row.top10Median)">{{ formatVal(row.top10Median) }}</td>
                  <td class="td-val font-semibold" :class="valClass(row.recommended)">{{ formatVal(row.recommended) }}</td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.param-table-wrap {
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid var(--p-surface-700);
}

.param-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.param-table thead {
  background: #181825;
}

.param-table th {
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-size: var(--sd-text-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-surface-400);
  border-bottom: 1px solid var(--p-surface-700);
}

.param-table tbody tr {
  background: #1e1e2e;
  transition: background 0.1s;
}
.param-table tbody tr:hover {
  background: #313244;
}
.param-table tbody tr:nth-child(even) {
  background: #1a1a2a;
}
.param-table tbody tr:nth-child(even):hover {
  background: #313244;
}

.param-table td {
  padding: 0.375rem 0.75rem;
  border-bottom: 1px solid #313244;
  white-space: nowrap;
}

.td-space {
  width: 6rem;
}

.td-param {
  color: #89b4fa;
  font-weight: 500;
}

.td-val {
  font-variant-numeric: tabular-nums;
}

.th-val {
  text-align: right;
}
.td-val {
  text-align: right;
}
</style>
