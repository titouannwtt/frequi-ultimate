<script lang="ts">
import { DatasetComponent } from 'echarts/components';
import { use } from 'echarts/core';

// The candles come as a dataset the series encode into: BaseChart does not register that component.
// Module level (a plain script block), so it runs once, before any chart is created.
use([DatasetComponent]);
</script>

<script setup lang="ts">
import type { ECharts } from 'echarts/core';
import { useElementSize } from '@vueuse/core';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { BaseChart, EmptyState, FilterChip, Skeleton, ValueState } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useDataSource } from '@/composables/useDataSource';
import { useFqFleetStore } from '@/datasource/stores/fleet';
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
  paneLayout,
  subplotCount,
  toCandleSet,
  type CandleSet,
  type OverlayToggles,
  type Overlays,
} from './lib/candles';
import { withTimeout } from './lib/logs';
import { measure as measureMove, type MeasurePoint } from './lib/measure';
import { mergePlot } from './lib/chartsPage';

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
    /** Indicators layered on top of the plot config (a built-in template). */
    plotExtra?: Partial<PlotConfig> | null;
    /** The measure tool is armed: a plain drag measures instead of panning (Shift does it too). */
    measureArmed?: boolean;
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
const fleet = useFqFleetStore();
const data = useDataSource();
const { tokens } = useChartTokens();

const activeSource = computed(() => props.source ?? data.source.value);
const set = shallowRef<CandleSet | null>(null);
const basePlot = shallowRef<PlotConfig>({ main_plot: {}, subplots: {} });
const plot = computed(() => mergePlot(basePlot.value, props.plotExtra ?? undefined));
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
    basePlot.value = { main_plot: {}, subplots: {}, ...(cfg ?? {}) } as PlotConfig;
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
    if (p !== undefined)
      basePlot.value = { main_plot: {}, subplots: {}, ...(p ?? {}) } as PlotConfig;
  },
  { immediate: true },
);
watch(
  () => props.toggles,
  (v) => {
    toggles.value = { ...ALL_OVERLAYS, ...(v ?? {}) };
  },
);

// The panes are sized in pixels from the room the chart really has
const plotEl = ref<HTMLElement | null>(null);
const { height: plotHeight } = useElementSize(plotEl);
const showSubs = ref(true);
const hasVolume = computed(() => set.value?.columns.includes('volume') ?? false);
const subsTotal = computed(() =>
  set.value ? subplotCount(plot.value, props.rsi, set.value.columns) : 0,
);
const subsShown = computed(
  () =>
    paneLayout({
      heightPx: plotHeight.value,
      hasVolume: hasVolume.value,
      subCount: subsTotal.value,
      showSubplots: showSubs.value,
    }).subs.length,
);

// A bot only serves the candles of its own strategy timeframe: say so rather than "no candle yet"
const ownTf = computed(() => fleet.bots[props.botKey]?.identity.timeframe ?? null);
const wrongTf = computed(() => ownTf.value !== null && ownTf.value !== props.tf);

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
    heightPx: plotHeight.value,
    showSubplots: showSubs.value,
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
  // A measurement is drawn in pixels: a zoom or a pan would leave it on the wrong candles
  chart.on('datazoom', () => {
    drag.value = null;
  });
  emit('ready', chart);
}

// ---- measure tool: Shift + drag (or armed, or long press on touch) ----
interface Drag {
  a: MeasurePoint;
  b: MeasurePoint;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
const drag = ref<Drag | null>(null);
const LONG_PRESS_MS = 450;
const PRESS_SLOP_PX = 10;
let swallowing = false;
let dragging = false;
let pressTimer: ReturnType<typeof setTimeout> | undefined;
let press: { id: number; x: number; y: number } | null = null;

function toPoint(x: number, y: number): MeasurePoint | null {
  const v = chartRef?.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [x, y]) as
    | number[]
    | undefined;
  return v && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? { ts: v[0]!, price: v[1]! } : null;
}
function localXY(e: PointerEvent): { x: number; y: number } {
  const r = plotEl.value?.getBoundingClientRect();
  return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
}
function startMeasure(x: number, y: number) {
  const p = toPoint(x, y);
  if (!p) return;
  drag.value = { a: p, b: p, ax: x, ay: y, bx: x, by: y };
  dragging = true;
  swallowing = true;
  window.addEventListener('pointermove', onWindowMove, true);
  window.addEventListener('pointerup', endMeasure, true);
  window.addEventListener('pointercancel', endMeasure, true);
}
function onDown(e: PointerEvent) {
  if (e.button !== 0 || !chartRef) return;
  const { x, y } = localXY(e);
  if (e.pointerType === 'touch') {
    // Long press: until it fires, the touch belongs to the chart (pan, zoom)
    press = { id: e.pointerId, x, y };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => press && startMeasure(press.x, press.y), LONG_PRESS_MS);
    window.addEventListener('pointermove', onWindowMove, true);
    window.addEventListener('pointerup', endMeasure, true);
    window.addEventListener('pointercancel', endMeasure, true);
    return;
  }
  if (!(e.shiftKey || props.measureArmed)) {
    drag.value = null;
    return;
  }
  e.stopPropagation();
  e.preventDefault();
  startMeasure(x, y);
}
function onWindowMove(e: PointerEvent) {
  const { x, y } = localXY(e);
  if (!dragging) {
    // A finger that moves before the long press fires is a pan, not a measurement
    if (press && Math.hypot(x - press.x, y - press.y) > PRESS_SLOP_PX) cancelPress();
    return;
  }
  const d = drag.value;
  const p = toPoint(x, y);
  if (d && p) drag.value = { ...d, b: p, bx: x, by: y };
}
function cancelPress() {
  clearTimeout(pressTimer);
  press = null;
  if (!dragging) removeWindowListeners();
}
function removeWindowListeners() {
  window.removeEventListener('pointermove', onWindowMove, true);
  window.removeEventListener('pointerup', endMeasure, true);
  window.removeEventListener('pointercancel', endMeasure, true);
}
function endMeasure() {
  clearTimeout(pressTimer);
  press = null;
  dragging = false;
  removeWindowListeners();
  // The mouseup that follows must not reach the chart either; the flag drops after it
  setTimeout(() => (swallowing = false), 0);
  const d = drag.value;
  if (d && d.ax === d.bx && d.ay === d.by) drag.value = null;
}
function swallow(e: Event) {
  if (swallowing) e.stopPropagation();
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && drag.value) drag.value = null;
}
if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
const move = computed(() =>
  drag.value ? measureMove(drag.value.a, drag.value.b, set.value?.timeframeMs ?? 0) : null,
);
const moveText = computed(() => {
  const m = move.value;
  if (!m) return '';
  return t('fq.candle.measureLabel', {
    price: `${m.dPrice < 0 ? '−' : '+'}${fmt.price(Math.abs(m.dPrice))}`,
    pct: m.dPct === null ? '' : fmt.percent(m.dPct, 2),
    candles: m.candles,
    duration: fmt.duration(m.durationMs / 3_600_000),
  });
});
const boxStyle = computed(() => {
  const d = drag.value;
  if (!d) return {};
  return {
    left: `${Math.min(d.ax, d.bx)}px`,
    top: `${Math.min(d.ay, d.by)}px`,
    width: `${Math.abs(d.bx - d.ax)}px`,
    height: `${Math.abs(d.by - d.ay)}px`,
  };
});

function setToggle(k: keyof OverlayToggles) {
  toggles.value = { ...toggles.value, [k]: !toggles.value[k] };
  emit('update:toggles', toggles.value);
}

onBeforeUnmount(() => {
  token += 1;
  cancelAnimationFrame(rafId);
  clearTimeout(pressTimer);
  removeWindowListeners();
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
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
    <div v-if="legend" class="legrow">
      <div class="legend" data-testid="candle-legend">
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
          <b class="num"
            ><ValueState
              v-if="legend.values[n] === null || legend.values[n] === undefined"
              state="unavailable"
              :reason="t('fq.value.reason.noData')"
            /><template v-else>{{ fmt.number(legend.values[n] as number, 2) }}</template></b
          >
        </span>
      </div>
      <FilterChip
        v-if="controls && subsTotal > 0"
        class="subs"
        :label="t('fq.candle.ov.subplots', { shown: subsShown, total: subsTotal })"
        :active="showSubs"
        data-testid="candle-subplots"
        @toggle="showSubs = !showSubs"
      />
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
    <div
      ref="plotEl"
      class="plot"
      :class="{ armed: measureArmed }"
      :style="{ height }"
      @pointerdown.capture="onDown"
      @mousedown.capture="swallow"
      @touchstart.capture="swallow"
      @pointermove.capture="swallow"
      @mousemove.capture="swallow"
      @touchmove.capture="swallow"
      @pointerup.capture="swallow"
      @mouseup.capture="swallow"
      @touchend.capture="swallow"
    >
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
        :title="wrongTf ? t('fq.candle.emptyTf', { tf }) : t('fq.candle.empty')"
        :hint="
          error
            ? t('fq.candle.emptyError')
            : wrongTf
              ? t('fq.candle.onlyTf', { tf: ownTf })
              : t('fq.candle.emptyHint')
        "
        data-testid="candle-empty"
      />
      <div
        v-if="drag && move"
        class="measure"
        :class="move.dPrice >= 0 ? 'up' : 'down'"
        :style="boxStyle"
        data-testid="candle-measure"
      >
        <span class="mlabel num">{{ moveText }}</span>
      </div>
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
.legrow {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding-right: var(--s2);
  border-bottom: 1px solid var(--line);
}
.subs {
  flex: none;
}
.legend {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  gap: 12px;
  /* One line: a strategy with a dozen indicators must not eat the price pane */
  flex-wrap: nowrap;
  overflow: hidden;
  white-space: nowrap;
  padding: 4px var(--s3);
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
@media (max-width: 599px) {
  /* One scrolling row: four wrapped rows of chips would eat the chart */
  .ov {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .ov > :deep(*) {
    flex: none;
  }
}
.note {
  margin: 0;
  padding: 4px var(--s3);
  color: var(--warn);
  font-size: var(--t-xs);
}
.plot {
  /* The basis is the given height (a phone gives 62vh); in a bounded panel it shrinks to fit */
  flex: 1 1 auto;
  min-height: 220px;
  min-width: 0;
  position: relative;
}
.plot.armed {
  cursor: crosshair;
}
.measure {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  border: 1px dashed var(--fg-2);
  background: color-mix(in srgb, var(--fg-2) 10%, transparent);
}
.measure.up {
  border-color: var(--profit);
  background: color-mix(in srgb, var(--profit) 12%, transparent);
}
.measure.down {
  border-color: var(--loss);
  background: color-mix(in srgb, var(--loss) 12%, transparent);
}
.mlabel {
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translate(-50%, 4px);
  white-space: nowrap;
  padding: 2px 6px;
  border-radius: var(--r-1);
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  color: var(--fg);
  font-size: var(--t-xs);
}
</style>
