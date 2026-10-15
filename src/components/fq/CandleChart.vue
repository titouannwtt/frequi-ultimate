<script lang="ts">
import { DatasetComponent } from 'echarts/components';
import { use } from 'echarts/core';

// The candles come as a dataset the series encode into: BaseChart does not register that component.
// Module level (a plain script block), so it runs once, before any chart is created.
use([DatasetComponent]);
</script>

<script setup lang="ts">
import type { ECharts } from 'echarts/core';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { BaseChart, EmptyState, FilterChip, Skeleton } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useDataSource } from '@/composables/useDataSource';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { DataSource } from '@/datasource/types';
import type { BotKey } from '@/gateway/types.gen';
import type { PairHistory, PlotConfig } from '@/types';

import { useChartTokens } from './lib/chartTokens';
import {
  ALL_OVERLAYS,
  buildCandleOption,
  indexAt,
  indicatorNames,
  legendAt,
  mergeTail,
  toCandleSet,
  type CandleSet,
  type OverlayToggles,
  type Overlays,
} from './lib/candles';
import { withTimeout } from './lib/logs';

/**
 * Candle chart of one pair of one bot (02 sections 3.3 and 5.2). Candles, volume, the indicators
 * of the strategy's plot config and an RSI sub-chart, with the overlays of the open position:
 * average entry, take profit, safety orders, fills and liquidation. History and plot config are
 * read through the bot proxy (GET only); a new candle (channel `chart:<key>:<pair>:<tf>`) asks for
 * the last few candles and merges them by time, so the chart is extended without a reload and
 * without animation. One chart instance; the legend follows the pointer in `requestAnimationFrame`.
 */
const props = withDefaults(
  defineProps<{
    botKey: BotKey;
    pair: string;
    tf: string;
    overlays?: Overlays;
    /** Which overlays are drawn at first; the user can switch them (`controls`). */
    toggles?: Partial<OverlayToggles>;
    heikinAshi?: boolean;
    rsi?: boolean;
    /** The strategy's plot config; read from the bot when omitted. */
    plotConfig?: PlotConfig | null;
    /** Preloaded candles (previews, tests); otherwise read from the bot. */
    candles?: Pick<PairHistory, 'columns' | 'data' | 'timeframe_ms'> | null;
    visibleCandles?: number;
    controls?: boolean;
    height?: string;
    /** A source to use instead of the active one (previews, tests). */
    source?: DataSource | null;
    timeoutMs?: number;
  }>(),
  {
    overlays: () => ({}),
    heikinAshi: false,
    rsi: true,
    controls: true,
    height: '100%',
    timeoutMs: 20_000,
  },
);

const emit = defineEmits<{ 'update:toggles': [t: OverlayToggles]; ready: [chart: ECharts] }>();

const { t } = useI18n();
const fmt = useFormat();
const prefs = useFqPrefsStore();
const data = useDataSource();
const { tokens } = useChartTokens();

const activeSource = computed(() => props.source ?? data.source.value);
const set = shallowRef<CandleSet | null>(null);
const plot = shallowRef<PlotConfig>({ main_plot: {}, subplots: {} });
const loading = ref(false);
const error = ref<string | null>(null);
const toggles = ref<OverlayToggles>({ ...ALL_OVERLAYS, ...(props.toggles ?? {}) });
const hover = ref<number | null>(null);
let token = 0;
let unsubscribe: (() => void) | null = null;
let tailing = false;
let tailAgain = false;
let rafId = 0;
let chartRef: ECharts | null = null;

const HISTORY = 1000;
const path = (limit: number) =>
  `/pair_candles?pair=${encodeURIComponent(props.pair)}&timeframe=${encodeURIComponent(props.tf)}&limit=${limit}`;

function proxy<T>(p: string): Promise<T> {
  const source = activeSource.value;
  if (!source) return Promise.reject(new Error('no source'));
  return withTimeout(
    source.proxy<T>(props.botKey, 'GET', p, undefined, { timeoutMs: props.timeoutMs }),
    props.timeoutMs,
  );
}

async function loadAll(): Promise<void> {
  const mine = ++token;
  if (props.candles) {
    set.value = toCandleSet(props.candles);
    return;
  }
  if (!activeSource.value) return;
  loading.value = true;
  try {
    const [history, cfg] = await Promise.all([
      proxy<PairHistory>(path(HISTORY)),
      props.plotConfig !== undefined
        ? Promise.resolve(props.plotConfig)
        : proxy<Partial<PlotConfig>>('/plot_config').catch(() => null),
    ]);
    if (mine !== token) return;
    set.value = toCandleSet(history);
    plot.value = { main_plot: {}, subplots: {}, ...(cfg ?? {}) } as PlotConfig;
    error.value = null;
  } catch (e) {
    if (mine !== token) return;
    // The chart keeps what it had; only the note says the refresh failed
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (mine === token) loading.value = false;
  }
}

/** A candle closed: ask for the last few and merge them, one request at a time. */
async function refreshTail(): Promise<void> {
  if (tailing) {
    tailAgain = true;
    return;
  }
  tailing = true;
  const mine = token;
  try {
    const tail = toCandleSet(await proxy<PairHistory>(path(4)));
    if (mine !== token || !set.value) return;
    const merged = mergeTail(set.value, tail);
    if (merged) set.value = merged;
    else void loadAll();
  } catch (e) {
    if (mine === token) error.value = e instanceof Error ? e.message : String(e);
  } finally {
    tailing = false;
    if (tailAgain) {
      tailAgain = false;
      void refreshTail();
    }
  }
}

function resubscribe() {
  unsubscribe?.();
  unsubscribe = null;
  const source = activeSource.value;
  if (!source || props.candles) return;
  unsubscribe = source.subscribe(
    'chart',
    { botKey: props.botKey, pair: props.pair, timeframe: props.tf },
    (u) => {
      if (u.kind === 'item') void refreshTail();
    },
  );
}

watch(
  () => [activeSource.value, props.botKey, props.pair, props.tf, props.candles] as const,
  () => {
    set.value = props.candles ? toCandleSet(props.candles) : null;
    hover.value = null;
    void loadAll();
    resubscribe();
  },
  { immediate: true },
);
watch(
  () => props.plotConfig,
  (p) => {
    if (p !== undefined) plot.value = { main_plot: {}, subplots: {}, ...(p ?? {}) } as PlotConfig;
  },
  { immediate: true },
);
watch(
  () => props.toggles,
  (v) => {
    toggles.value = { ...ALL_OVERLAYS, ...(v ?? {}) };
  },
);

const visibleCount = computed(
  () => props.visibleCandles ?? prefs.settings.ui.chartDefaultCandleCount,
);

// The zoom window is only imposed on the first render of a pair and timeframe
const zoomKey = computed(() => `${props.botKey}|${props.pair}|${props.tf}`);
const zoomApplied = ref<string | null>(null);

const option = computed(() => {
  if (!set.value || set.value.rows.length === 0) return null;
  return buildCandleOption({
    set: set.value,
    heikinAshi: props.heikinAshi,
    plotConfig: plot.value,
    rsi: props.rsi,
    overlays: props.overlays,
    toggles: toggles.value,
    tokens: tokens.value,
    labels: {
      candles: t('fq.candle.candles'),
      volume: t('fq.candle.volume'),
      average: t('fq.candle.average'),
      tp: t('fq.candle.tp'),
      liquidation: t('fq.candle.liquidation'),
      entry: t('fq.candle.entry'),
      dca: t('fq.candle.dca'),
      exit: t('fq.candle.exit'),
    },
    fmtPrice: (v) => fmt.price(v),
    visibleCandles: visibleCount.value,
    initialZoom: zoomApplied.value !== zoomKey.value,
    labelSide: prefs.settings.ui.chartLabelSide,
  });
});

watch(
  option,
  (o) => {
    if (o) zoomApplied.value = zoomKey.value;
  },
  { flush: 'post' },
);

const names = computed(() =>
  set.value ? indicatorNames(plot.value, props.rsi, set.value.columns) : [],
);
const legend = computed(() =>
  set.value ? legendAt(set.value, hover.value ?? undefined, names.value) : null,
);
const up = computed(() => (legend.value?.close ?? 0) >= (legend.value?.open ?? 0));

function onReady(chart: ECharts) {
  chartRef = chart;
  chart.on('updateAxisPointer', (ev: unknown) => {
    const info = (ev as { axesInfo?: Array<{ value?: number }> }).axesInfo?.[0];
    if (info?.value === undefined || !set.value) return;
    const ts = info.value;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      hover.value = indexAt(set.value as CandleSet, ts);
    });
  });
  chart.on('globalout', () => {
    cancelAnimationFrame(rafId);
    hover.value = null;
  });
  emit('ready', chart);
}

function setToggle(k: keyof OverlayToggles) {
  toggles.value = { ...toggles.value, [k]: !toggles.value[k] };
  emit('update:toggles', toggles.value);
}

onBeforeUnmount(() => {
  token += 1;
  cancelAnimationFrame(rafId);
  chartRef?.off('updateAxisPointer');
  chartRef?.off('globalout');
  chartRef = null;
  unsubscribe?.();
  unsubscribe = null;
});

const toggleKeys: Array<keyof OverlayToggles> = [
  'average',
  'tp',
  'safetyOrders',
  'fills',
  'liquidation',
];
const hasOverlay = (k: keyof OverlayToggles) => {
  const o = props.overlays;
  switch (k) {
    case 'average':
      return o.average != null;
    case 'tp':
      return o.tp != null;
    case 'safetyOrders':
      return (o.safetyOrders?.length ?? 0) > 0;
    case 'fills':
      return (o.fills?.length ?? 0) > 0;
    case 'liquidation':
      return o.liquidation != null;
  }
};
</script>

<template>
  <div class="cc" data-testid="candle-chart" :aria-busy="loading || undefined">
    <div v-if="legend" class="legend" data-testid="candle-legend">
      <span class="ohlc num">
        O <b>{{ legend.open === null ? '' : fmt.price(legend.open) }}</b> H
        <b>{{ legend.high === null ? '' : fmt.price(legend.high) }}</b> L
        <b>{{ legend.low === null ? '' : fmt.price(legend.low) }}</b> C
        <b :class="up ? 'up' : 'down'">{{
          legend.close === null ? '' : fmt.price(legend.close)
        }}</b>
      </span>
      <span v-for="n in names" :key="n" class="ind">
        {{ n }}
        <b class="num">{{
          legend.values[n] === null || legend.values[n] === undefined
            ? t('fq.ds.dash')
            : fmt.number(legend.values[n] as number, 2)
        }}</b>
      </span>
    </div>
    <div
      v-if="controls && toggleKeys.some(hasOverlay)"
      class="ov"
      :aria-label="t('fq.candle.overlays')"
    >
      <FilterChip
        v-for="k in toggleKeys.filter(hasOverlay)"
        :key="k"
        :label="t(`fq.candle.ov.${k}`)"
        :active="toggles[k]"
        @toggle="setToggle(k)"
      />
    </div>
    <p v-if="error" class="note" role="status" data-testid="candle-error">
      {{ t('fq.ds.pane.error') }} · {{ error }}
    </p>
    <div class="plot" :style="{ height }">
      <Skeleton v-if="loading && !option" shape="row" :count="6" />
      <BaseChart
        v-else-if="option"
        :option="option"
        :replace-merge="['series', 'grid', 'xAxis', 'yAxis']"
        :label="t('fq.candle.chartLabel', { pair, tf })"
        @ready="onReady"
      />
      <EmptyState
        v-else
        icon="chart-candlestick"
        :title="t('fq.candle.empty')"
        :hint="error ? t('fq.candle.emptyError') : t('fq.candle.emptyHint')"
      />
    </div>
  </div>
</template>

<style scoped>
.cc {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  padding: 4px var(--s3);
  border-bottom: 1px solid var(--line);
  color: var(--fg-3);
  font-family: var(--font-num);
  font-size: var(--t-xs);
  font-variant-numeric: tabular-nums slashed-zero;
}
.legend b {
  color: var(--fg);
  font-weight: 600;
}
.legend b.up {
  color: var(--profit);
}
.legend b.down {
  color: var(--loss);
}
.ov {
  display: flex;
  gap: 4px;
  padding: 4px var(--s3);
  flex-wrap: wrap;
  border-bottom: 1px solid var(--line);
}
.note {
  margin: 0;
  padding: 4px var(--s3);
  color: var(--warn);
  font-size: var(--t-xs);
}
.plot {
  flex: 1;
  min-height: 220px;
  min-width: 0;
  position: relative;
}
</style>
