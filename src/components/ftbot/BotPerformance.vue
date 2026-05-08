<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();
enum PerformanceOptions {
  performance = 'performance',
  entryStats = 'entryStats',
  exitStats = 'exitStats',
  mixTagStats = 'mixTagStats',
}
const selectedOption = ref<PerformanceOptions>(PerformanceOptions.performance);

function formatTextLen(text: string, len: number) {
  if (text.length > len) {
    return text.substring(0, len) + '...';
  }
  return text;
}

const performanceTable = computed<
  {
    key: string;
    label: string;
    formatter?: (v: unknown) => string;
  }[]
>(() => {
  const textLength = 17;
  const initialCol = {
    [PerformanceOptions.performance]: { key: 'pair', label: t('performance.pair') },
    [PerformanceOptions.entryStats]: {
      key: 'enter_tag',
      label: t('performance.enterTag'),
      formatter: (v: unknown) => formatTextLen(v as string, textLength),
    },
    [PerformanceOptions.exitStats]: {
      key: 'exit_reason',
      label: t('performance.exitReason'),
      formatter: (v: unknown) => formatTextLen(v as string, textLength),
    },
    [PerformanceOptions.mixTagStats]: {
      key: 'mix_tag',
      label: t('performance.mixTag'),
      formatter: (v: unknown) => formatTextLen(v as string, textLength),
    },
  };
  return [
    initialCol[selectedOption.value],
    { key: 'profit', label: t('performance.profitPct') },
    {
      key: 'profit_abs',
      label: t('performance.profitStake', { stake: botStore.activeBot.botState?.stake_currency }),
      formatter: (v: unknown) => formatPrice(v as number, 5),
    },
    { key: 'count', label: t('performance.count') },
  ];
});

const performanceData = computed(() => {
  if (selectedOption.value === PerformanceOptions.performance) {
    return botStore.activeBot.performanceStats;
  }
  if (selectedOption.value === PerformanceOptions.entryStats) {
    return botStore.activeBot.entryStats;
  }
  if (selectedOption.value === PerformanceOptions.exitStats) {
    return botStore.activeBot.exitStats;
  }
  if (selectedOption.value === PerformanceOptions.mixTagStats) {
    return botStore.activeBot.mixTagStats;
  }
  return [];
});

const options = computed(() => [
  { value: PerformanceOptions.performance, text: t('performance.title') },
  { value: PerformanceOptions.entryStats, text: t('performance.entries') },
  { value: PerformanceOptions.exitStats, text: t('performance.exits') },
  { value: PerformanceOptions.mixTagStats, text: t('performance.mixTag') },
]);

function refreshSummary() {
  if (selectedOption.value === PerformanceOptions.performance) {
    botStore.activeBot.getPerformance();
  }
  if (selectedOption.value === PerformanceOptions.entryStats) {
    botStore.activeBot.getEntryStats();
  }
  if (selectedOption.value === PerformanceOptions.exitStats) {
    botStore.activeBot.getExitStats();
  }
  if (selectedOption.value === PerformanceOptions.mixTagStats) {
    botStore.activeBot.getMixTagStats();
  }
}

onMounted(() => {
  refreshSummary();
});
</script>
<template>
  <div>
    <div class="mb-2">
      <h3 class="me-auto text-2xl inline">{{ t('performance.title') }}</h3>
      <Button class="float-end" severity="secondary" @click="refreshSummary">
        <template #icon>
          <i-mdi-refresh />
        </template>
      </Button>
    </div>
    <SelectButton
      v-if="botStore.activeBot.botFeatures.hasAdvancedStats"
      id="order-direction"
      v-model="selectedOption"
      :options="options"
      :allow-empty="false"
      option-label="text"
      option-value="value"
      size="small"
      @change="refreshSummary"
    ></SelectButton>
    <DataTable
      size="small"
      class="text-center"
      :value="performanceData"
      :row-class="(data: any) => perfRowClass(data.profit)"
      scrollable
      scroll-height="flex"
    >
      <Column
        v-for="field in performanceTable"
        :key="field.key"
        :field="field.key"
        :sortable="true"
      >
        <template #header>
          <span>{{ field.label }}</span>
        </template>
        <template #body="{ data }">
          <!-- Key column (pair / tag) -->
          <template v-if="field.key === 'pair' || field.key === 'enter_tag' || field.key === 'exit_reason' || field.key === 'mix_tag'">
            <span class="font-semibold text-xs">
              {{ field.formatter ? field.formatter(data[field.key]) : data[field.key] }}
            </span>
          </template>
          <!-- Profit % -->
          <template v-else-if="field.key === 'profit'">
            <span
              class="inline-block px-1.5 py-0.5 rounded text-xs font-mono font-semibold"
              :class="perfProfitBgClass(data.profit)"
            >
              <span :class="data.profit >= 0 ? 'text-green-400' : 'text-red-400'">
                {{ data.profit >= 0 ? '+' : '' }}{{ data.profit.toFixed(2) }}%
              </span>
            </span>
          </template>
          <!-- Profit abs -->
          <template v-else-if="field.key === 'profit_abs'">
            <span
              class="font-mono text-xs"
              :class="data.profit_abs >= 0 ? 'text-green-400' : 'text-red-400'"
            >
              {{ data.profit_abs >= 0 ? '+' : '' }}{{ formatPrice(data.profit_abs, 5) }}
            </span>
          </template>
          <!-- Count -->
          <template v-else-if="field.key === 'count'">
            <span class="inline-block px-1.5 py-0.5 rounded text-xs font-mono bg-surface-500/10">
              {{ data.count }}
            </span>
          </template>
          <!-- Fallback -->
          <template v-else>
            {{ field.formatter ? field.formatter(data[field.key]) : data[field.key] }}
          </template>
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<script lang="ts">
function perfProfitBgClass(profit: number): string {
  if (profit > 5) return 'bg-green-500/20';
  if (profit > 2) return 'bg-green-500/15';
  if (profit > 0) return 'bg-green-500/8';
  if (profit > -2) return 'bg-red-500/8';
  if (profit > -5) return 'bg-red-500/15';
  return 'bg-red-500/20';
}

function perfRowClass(profit: number): string {
  if (profit > 3) return 'bg-green-500/8';
  if (profit > 0) return 'bg-green-500/4';
  if (profit > -3) return 'bg-red-500/4';
  return 'bg-red-500/8';
}
</script>
