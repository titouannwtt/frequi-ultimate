<script setup lang="ts">
import { useI18n } from 'vue-i18n';

type Handler = Record<string, unknown> & { method?: string };

const props = defineProps<{
  modelValue: unknown;
  editable: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: Handler[]] }>();

const { t } = useI18n();

const PAIRLIST_METHODS = [
  'StaticPairList',
  'VolumePairList',
  'PercentChangePairList',
  'ProducerPairList',
  'RemotePairList',
  'MarketCapPairList',
  'CrossMarketPairList',
  'AgeFilter',
  'DelistFilter',
  'FullTradesFilter',
  'OffsetFilter',
  'PerformanceFilter',
  'PrecisionFilter',
  'PriceFilter',
  'RangeStabilityFilter',
  'ShuffleFilter',
  'SpreadFilter',
  'VolatilityFilter',
  'TrendRegularityFilter',
];

const handlers = computed<Handler[]>(() =>
  Array.isArray(props.modelValue) ? (props.modelValue as Handler[]) : [],
);

function commit(next: Handler[]) {
  emit('update:modelValue', next);
}

function paramEntries(h: Handler): [string, unknown][] {
  return Object.entries(h).filter(([k]) => k !== 'method');
}

function displayVal(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function parseVal(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed === '') return '';
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return s;
    }
  }
  if (!isNaN(Number(trimmed))) return Number(trimmed);
  return s;
}

function setMethod(idx: number, method: string) {
  const next = handlers.value.map((h) => ({ ...h }));
  next[idx].method = method;
  commit(next);
}
function setParamValue(idx: number, key: string, raw: string) {
  const next = handlers.value.map((h) => ({ ...h }));
  next[idx][key] = parseVal(raw);
  commit(next);
}
function renameParam(idx: number, oldKey: string, newKey: string) {
  if (!newKey || oldKey === newKey) return;
  const next = handlers.value.map((h) => ({ ...h }));
  const val = next[idx][oldKey];
  delete next[idx][oldKey];
  next[idx][newKey] = val;
  commit(next);
}
function removeParam(idx: number, key: string) {
  const next = handlers.value.map((h) => ({ ...h }));
  delete next[idx][key];
  commit(next);
}
function addParam(idx: number) {
  const next = handlers.value.map((h) => ({ ...h }));
  let i = 1;
  while (`param_${i}` in next[idx]) i++;
  next[idx][`param_${i}`] = '';
  commit(next);
}
function addHandler() {
  commit([...handlers.value.map((h) => ({ ...h })), { method: 'VolumePairList' }]);
}
function removeHandler(idx: number) {
  commit(handlers.value.filter((_, i) => i !== idx));
}
function move(idx: number, dir: -1 | 1) {
  const target = idx + dir;
  if (target < 0 || target >= handlers.value.length) return;
  const next = handlers.value.map((h) => ({ ...h }));
  [next[idx], next[target]] = [next[target], next[idx]];
  commit(next);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div
      v-for="(h, idx) in handlers"
      :key="idx"
      class="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50/50 dark:bg-surface-800/40 p-3"
    >
      <div class="flex items-center gap-2 mb-2">
        <span class="text-xs font-mono text-surface-400 w-5 text-right">{{ idx + 1 }}.</span>
        <Select
          :model-value="h.method"
          :options="PAIRLIST_METHODS"
          :disabled="!editable"
          class="grow"
          size="small"
          filter
          @update:model-value="(v) => setMethod(idx, v)"
        />
        <div v-if="editable" class="flex items-center gap-0.5">
          <button
            class="p-1 text-surface-400 hover:text-primary-400 disabled:opacity-30 cursor-pointer"
            :disabled="idx === 0"
            :title="t('configEditor.moveUp')"
            @click="move(idx, -1)"
          >
            <i-mdi-chevron-up />
          </button>
          <button
            class="p-1 text-surface-400 hover:text-primary-400 disabled:opacity-30 cursor-pointer"
            :disabled="idx === handlers.length - 1"
            :title="t('configEditor.moveDown')"
            @click="move(idx, 1)"
          >
            <i-mdi-chevron-down />
          </button>
          <button
            class="p-1 text-red-400 hover:text-red-500 cursor-pointer"
            :title="t('configEditor.removeHandler')"
            @click="removeHandler(idx)"
          >
            <i-mdi-trash-can-outline />
          </button>
        </div>
      </div>

      <div class="pl-7 flex flex-col gap-1">
        <div v-for="[key, val] in paramEntries(h)" :key="key" class="flex items-center gap-2">
          <InputText
            :model-value="key"
            :disabled="!editable"
            size="small"
            class="w-2/5 font-mono text-xs"
            @blur="(e: any) => renameParam(idx, key, e.target.value)"
          />
          <span class="text-surface-400">:</span>
          <InputText
            :model-value="displayVal(val)"
            :disabled="!editable"
            size="small"
            class="grow font-mono text-xs"
            @update:model-value="(v) => setParamValue(idx, key, v ?? '')"
          />
          <button
            v-if="editable"
            class="p-1 text-red-400 hover:text-red-500 cursor-pointer"
            :title="t('configEditor.removeParam')"
            @click="removeParam(idx, key)"
          >
            <i-mdi-close />
          </button>
        </div>
        <button
          v-if="editable"
          class="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 mt-1 w-fit cursor-pointer"
          @click="addParam(idx)"
        >
          <i-mdi-plus /> {{ t('configEditor.addParam') }}
        </button>
      </div>
    </div>

    <button
      v-if="editable"
      class="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1.5 w-fit cursor-pointer"
      @click="addHandler"
    >
      <i-mdi-plus-circle-outline /> {{ t('configEditor.addHandler') }}
    </button>
    <p v-if="handlers.length === 0" class="text-xs text-surface-400 italic">
      {{ t('configEditor.noPairlist') }}
    </p>
  </div>
</template>
