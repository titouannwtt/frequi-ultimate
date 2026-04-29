<script setup lang="ts">
import type { PipelineStep } from '@/types/blacklist';

const props = defineProps<{ botId: string }>();
const botStore = useBotStore();

const store = computed(() => botStore.botStores[props.botId]);
const whitelist = computed(() => store.value?.whitelist ?? []);
const pipeline = computed<PipelineStep[]>(() => store.value?.pairlistPipeline ?? []);
const handlerConfigs = computed<Record<string, any>[]>(() => store.value?.handlerConfigs ?? []);
const totalMarketPairs = computed(() => store.value?.totalMarketPairs ?? 0);
const addedPairs = computed<string[]>(() => store.value?.addedPairs ?? []);
const pairlistMethods = computed(() => store.value?.pairlistMethods ?? []);

const pairCount = computed(() => whitelist.value.length);
const pairlistPairCount = computed(() => pairCount.value - addedPairs.value.length);
const proportion = computed(() =>
  totalMarketPairs.value > 0 ? Math.round((pairlistPairCount.value / totalMarketPairs.value) * 100) : 0,
);

const hasPipeline = computed(() => pipeline.value.length > 0);

const expandedStep = ref<number | null>(null);

function toggleStep(idx: number) {
  expandedStep.value = expandedStep.value === idx ? null : idx;
}

function getConfigParams(idx: number): [string, any][] {
  const cfg = handlerConfigs.value[idx];
  if (!cfg) return [];
  return Object.entries(cfg).filter(([k]) => k !== 'method');
}

function formatValue(v: any): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}
</script>

<template>
  <div class="glass-card text-xs" style="width: 420px; max-height: 80vh; overflow-y: auto">
    <!-- Header -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <i-mdi-filter-variant class="text-blue-400" style="font-size: 1.1rem" />
        <span class="font-bold text-sm text-surface-200">Pairlist Pipeline</span>
      </div>
      <div class="text-right">
        <span class="text-lg font-bold text-surface-100">{{ pairlistPairCount }}</span>
        <span v-if="totalMarketPairs > 0" class="text-surface-500"> / {{ totalMarketPairs }}</span>
      </div>
    </div>

    <!-- Proportion bar -->
    <div v-if="totalMarketPairs > 0" class="mb-3">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[10px] text-surface-500">{{ proportion }}% of exchange pairs</span>
      </div>
      <div class="w-full h-1.5 rounded-full overflow-hidden" style="background: rgba(255,255,255,0.06)">
        <div
          class="h-full rounded-full transition-all"
          :style="{ width: `${Math.max(proportion, 1)}%`, background: 'linear-gradient(90deg, #3b82f6, #60a5fa)' }"
        />
      </div>
    </div>

    <!-- Pipeline -->
    <div v-if="hasPipeline" class="mb-3">
      <div class="text-[9px] text-surface-500 uppercase tracking-wider mb-1.5 font-semibold">Pipeline</div>
      <div class="space-y-0">
        <template v-for="(step, idx) in pipeline" :key="idx">
          <!-- Step row -->
          <div
            class="flex items-start gap-2 px-2 py-1.5 rounded-md transition-colors cursor-pointer"
            :class="step.pairs_removed.length > 0 ? 'hover:bg-surface-700/50' : ''"
            @click="step.pairs_removed.length > 0 ? toggleStep(idx) : undefined"
          >
            <!-- Step number -->
            <span
              class="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5"
              :style="{ background: idx === 0 ? 'rgba(59,130,246,0.2)' : 'rgba(255,255,255,0.06)', color: idx === 0 ? '#60a5fa' : '#9ca3af' }"
            >{{ idx + 1 }}</span>

            <!-- Handler info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between">
                <span class="font-semibold text-surface-200">{{ step.handler }}</span>
                <span class="text-surface-400 font-mono text-[10px]">{{ step.count_after }} pairs</span>
              </div>
              <!-- Config params -->
              <div v-if="getConfigParams(idx).length > 0" class="flex flex-wrap gap-x-2 mt-0.5">
                <span
                  v-for="[k, v] in getConfigParams(idx).slice(0, 4)"
                  :key="k"
                  class="text-[9px] text-surface-500"
                >{{ k }}: <span class="text-surface-400">{{ formatValue(v) }}</span></span>
                <span v-if="getConfigParams(idx).length > 4" class="text-[9px] text-surface-600">+{{ getConfigParams(idx).length - 4 }} more</span>
              </div>
            </div>
          </div>

          <!-- Connector + removed count -->
          <div v-if="idx < pipeline.length - 1" class="flex items-center gap-2 pl-4 py-0.5">
            <div class="w-px h-3 ml-2" style="background: rgba(255,255,255,0.08)" />
            <span
              v-if="step.pairs_removed.length > 0"
              class="text-[9px] font-mono"
              :style="{ color: step.pairs_removed.length > 10 ? '#f97316' : '#6b7280' }"
            >−{{ step.pairs_removed.length }}</span>
          </div>

          <!-- Expanded: removed pairs -->
          <Transition name="expand">
            <div v-if="expandedStep === idx && step.pairs_removed.length > 0" class="ml-9 mb-1">
              <div class="text-[9px] text-surface-500 mb-0.5">Removed by {{ step.handler }}:</div>
              <div class="flex flex-wrap gap-1 max-h-[80px] overflow-y-auto">
                <span
                  v-for="pair in step.pairs_removed"
                  :key="pair"
                  class="px-1.5 py-0.5 rounded text-[8px] font-mono"
                  style="background: rgba(239,68,68,0.1); color: #f87171"
                >{{ pair.split('/')[0] }}</span>
              </div>
            </div>
          </Transition>
        </template>
      </div>
    </div>

    <!-- Fallback: no pipeline data, show method names -->
    <div v-else-if="pairlistMethods.length > 0" class="mb-3">
      <div class="text-[9px] text-surface-500 uppercase tracking-wider mb-1.5 font-semibold">Handlers</div>
      <div class="flex flex-wrap gap-1">
        <span
          v-for="(method, idx) in pairlistMethods"
          :key="idx"
          class="px-2 py-0.5 rounded text-[10px] font-mono"
          style="background: rgba(255,255,255,0.05)"
        >
          <span class="text-surface-500 mr-1">{{ idx + 1 }}.</span>
          <span class="text-surface-300">{{ method }}</span>
        </span>
      </div>
    </div>

    <!-- Separator -->
    <div class="border-t my-2" style="border-color: rgba(255,255,255,0.06)" />

    <!-- Active pairs -->
    <div class="mb-1">
      <div class="flex items-center justify-between mb-1">
        <span class="text-[9px] text-surface-500 uppercase tracking-wider font-semibold">Active Pairs ({{ pairlistPairCount }})</span>
      </div>
      <div class="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto pr-1">
        <span
          v-for="pair in whitelist.filter(p => !addedPairs.includes(p))"
          :key="pair"
          class="px-1.5 py-0.5 rounded text-[9px] font-mono text-surface-300"
          style="background: rgba(255,255,255,0.04)"
        >{{ pair.split('/')[0] }}</span>
      </div>
    </div>

    <!-- Added pairs -->
    <div v-if="addedPairs.length > 0" class="mt-2">
      <div class="border-t mb-2" style="border-color: rgba(255,255,255,0.06)" />
      <div class="text-[9px] text-surface-500 mb-1">
        <i-mdi-plus-circle class="text-green-500 mr-0.5" style="font-size: 0.7rem; vertical-align: middle" />
        Added from open trades
      </div>
      <div class="flex flex-wrap gap-1">
        <span
          v-for="pair in addedPairs"
          :key="pair"
          class="px-1.5 py-0.5 rounded text-[9px] font-mono"
          style="background: rgba(34,197,94,0.1); color: #4ade80"
        >+ {{ pair.split('/')[0] }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.glass-card {
  font-size: 0.9rem;
  line-height: 1.4;
  background: rgba(15, 17, 23, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 16px;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 200px;
}
</style>
