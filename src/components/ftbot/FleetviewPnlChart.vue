<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { EChartsOption } from 'echarts';
import ECharts from 'vue-echarts';

import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

import type { FleetviewBot, FleetviewCoin } from '@/types';

use([BarChart, CanvasRenderer, GridComponent, TooltipComponent]);

const { overview, recon, subscribe } = useFleetView();
subscribe();

const bots = computed((): FleetviewBot[] => overview.value?.bots ?? []);
const coins = computed((): FleetviewCoin[] => recon.value?.coins ?? []);

// Dry/live mode filter — persisted per widget, defaults to 'live' (historic
// behaviour: the contribution chart only counted live bots).
const { tradingMode } = useTradingModeFilter('fleetPnl', 'live');
function botInMode(b: FleetviewBot): boolean {
  if (tradingMode.value === 'all') return true;
  return (tradingMode.value === 'dry') === !!b.dry_run;
}
const fleetHasBothModes = computed(() => {
  let dry = false;
  let live = false;
  for (const b of bots.value) {
    if (b.dry_run) dry = true;
    else live = true;
    if (dry && live) return true;
  }
  return false;
});

const colorStore = useColorStore();
const settingsStore = useSettingsStore();
const { t } = useI18n();

type Window = '1d' | '7d' | '30d';
const window_ = ref<Window>('7d');
const windowOptions = computed((): { text: string; value: Window }[] => [
  { text: t('fleet.pnl.window1d'), value: '1d' },
  { text: t('fleet.pnl.window7d'), value: '7d' },
  { text: t('fleet.pnl.window30d'), value: '30d' },
]);
const windowLabel = computed(() => {
  switch (window_.value) {
    case '1d':
      return t('fleet.pnl.window1d');
    case '7d':
      return t('fleet.pnl.window7d');
    default:
      return t('fleet.pnl.window30d');
  }
});
const includeUnrealized = ref(false);

const markPrices = computed(() => {
  const m: Record<string, number> = {};
  for (const c of coins.value) {
    if (c.mark_price) m[c.coin] = c.mark_price;
  }
  return m;
});

function realizedFor(bot: FleetviewBot): number {
  switch (window_.value) {
    case '1d':
      return bot.pnl.realized_1d;
    case '7d':
      return bot.pnl.realized_7d;
    default:
      return bot.pnl.realized_30d;
  }
}

function unrealizedFor(bot: FleetviewBot): number {
  let total = 0;
  for (const t of bot.open_trades) {
    const coin = t.pair.split('/')[0];
    const mark = markPrices.value[coin];
    if (!mark) continue;
    total += (mark - t.open_rate) * t.amount * (t.is_short ? -1 : 1);
  }
  return total;
}

const contributions = computed(() => {
  const rows = bots.value
    .filter((b) => botInMode(b))
    .map((b) => ({
      name: b.bot_name,
      value: realizedFor(b) + (includeUnrealized.value ? unrealizedFor(b) : 0),
    }))
    .filter((r) => Math.abs(r.value) > 0.005)
    .sort((a, b) => a.value - b.value);
  return rows;
});

// Fill the widget height; grow beyond it (internal scroll) when many bars.
const scrollEl = ref<HTMLElement | null>(null);
const { height: scrollHeight } = useElementSize(scrollEl);
const chartHeight = computed(() =>
  Math.max(180, scrollHeight.value, contributions.value.length * 24 + 70),
);

const chartOptions = computed((): EChartsOption => {
  const dark = settingsStore.chartTheme === 'dark';
  const labelColor = dark ? '#e2e8f0' : '#334155';
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const p = Array.isArray(params) ? params[0] : params;
        const v = Number(p.value);
        const sign = v >= 0 ? '+' : '';
        return `<b>${p.name}</b><br/>${sign}${v.toFixed(2)} USDC (${windowLabel.value}${includeUnrealized.value ? ' + uPnL' : ''})`;
      },
    },
    grid: { left: 8, right: 56, top: 8, bottom: 28, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { fontSize: 12, color: labelColor },
      splitLine: { lineStyle: { opacity: 0.15 } },
    },
    yAxis: {
      type: 'category',
      data: contributions.value.map((r) => r.name),
      axisLabel: { fontSize: 12, color: labelColor, width: 170, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: contributions.value.map((r) => ({
          value: Math.round(r.value * 100) / 100,
          itemStyle: {
            color: r.value >= 0 ? colorStore.colorProfit : colorStore.colorLoss,
          },
          label: {
            color: r.value >= 0 ? colorStore.colorProfit : colorStore.colorLoss,
          },
        })),
        barMaxWidth: 16,
        label: {
          show: true,
          position: 'right',
          fontSize: 12,
          fontWeight: 'bold',
          formatter: ({ value }) => {
            const v = Number(value);
            return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
          },
        },
      },
    ],
  };
});

const total = computed(() => contributions.value.reduce((acc, r) => acc + r.value, 0));
</script>

<template>
  <div class="flex flex-col h-full p-3 gap-3">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <label
        class="text-xs text-surface-500 dark:text-surface-400 flex items-center gap-1 cursor-pointer"
      >
        <Checkbox v-model="includeUnrealized" binary size="small" />
        {{ t('fleet.pnl.includeUpnl') }}
      </label>
      <div class="flex items-center gap-2">
        <TradingModeSelect v-model="tradingMode" :show="fleetHasBothModes" />
        <SelectButton
          v-model="window_"
          :options="windowOptions"
          size="small"
          :allow-empty="false"
          option-label="text"
          option-value="value"
        />
      </div>
    </div>
    <div class="text-xs text-surface-500 dark:text-surface-400">
      {{ t('fleet.pnl.sum') }}
      <span
        class="inline-block px-1.5 py-0.5 rounded text-xs font-mono tabular-nums bg-surface-500/10"
        :class="total >= 0 ? 'text-emerald-500' : 'text-red-400'"
      >
        {{ total.toFixed(2) }} USDC
      </span>
      <span class="ml-2">{{ t('fleet.pnl.nonZeroBots', { count: contributions.length }) }}</span>
    </div>
    <div v-if="contributions.length" ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto">
      <ECharts :option="chartOptions" :style="{ height: `${chartHeight}px` }" autoresize />
    </div>
    <div v-else class="text-sm text-surface-500 dark:text-surface-400">
      {{ t('fleet.pnl.noContribution') }}
    </div>
  </div>
</template>
