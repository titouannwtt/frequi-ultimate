<script lang="ts">
import { DatasetComponent } from 'echarts/components';
import { use } from 'echarts/core';

// The candles come as a dataset the series encode into: BaseChart does not register that component.
// Module level (a plain script block), so it runs once, before any chart is created.
use([DatasetComponent]);
</script>

<script setup lang="ts">
import type { ECharts } from 'echarts/core';
import { useElementSize, useMediaQuery } from '@vueuse/core';
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { BaseChart, EmptyState, FilterChip, Skeleton, ValueState } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useDataSource } from '@/composables/useDataSource';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { CandlesPage, DataSource } from '@/datasource/types';
import type { BotKey } from '@/gateway/types.gen';
import type { PairHistory, PlotConfig } from '@/types';
import { indicatorLabel, subplotLabel } from '@/utils/indicatorLabel';

import { useChartTokens } from './lib/chartTokens';
import {
  COVER_MARGIN,
  MAX_CANDLES,
  OLDER_PAGE,
  ageParts,
  isCovered,
  nextTailDelay,
  olderState,
  prependOlder,
  setFromPage,
  staleAgeMs,
  tailHasGap,
  tailLimit,
  tradeStartTs,
} from './lib/candlesHistory';
import { entryEdge, frameCandles, recentreOn } from './lib/chartTrades';
import {
  ALL_OVERLAYS,
  BUILTIN_RSI,
  DATE_COL,
  buildCandleOption,
  fillPlan,
  indexAt,
  indicatorNames,
  legendAt,
  levelLines,
  mergeTail,
  minHeightForSubs,
  offscreenLevels,
  paneLayout,
  planLevelLabels,
  resolveSubplots,
  subplotCandidates,
  subplotCount,
  toCandleSet,
  zoomStartPct,
  type CandleSet,
  type FillPx,
  type FillPlan,
  type LabelPlan,
  type OverlayToggles,
  type Overlays,
  type SubplotInfo,
} from './lib/candles';
import { withTimeout } from './lib/logs';
import { measure as measureMove, type MeasurePoint } from './lib/measure';
import { mergePlot, tfMs } from './lib/chartsPage';

/**
 * Candle chart of one pair of one bot (02 sections 3.3 and 5.2). Candles, volume, the indicators
 * of the strategy's plot config and an RSI sub-chart, with the overlays of the open position:
 * average entry, take profit, safety orders, fills and liquidation. History and plot config are
 * read through the bot proxy (GET only); a new candle (channel `chart:<key>:<pair>:<tf>`) asks for
 * the last few candles and merges them by time, so the chart is extended without a reload and
 * without animation. One chart instance; the legend follows the pointer in `requestAnimationFrame`.
 *
 * A bot only serves the candles of its own strategy timeframe and nothing older than its window.
 * When the active source can read the local history (`query.candles`, gateway), a timeframe the
 * bot does not serve is drawn from it (OHLCV only, said under the legend), and the button "Load
 * previous candles" puts older pages in front of the set until the open of the trade is covered.
 * Every load, a timeframe change included, dims the chart and says it is loading; the previous
 * chart stays under the veil instead of vanishing.
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
    /**
     * Sub-charts, chosen by the user: undefined draws them all (Bot page); null draws the default
     * one (the RSI, else the first); a list draws those. Each is titled, with a "Hide" button, and
     * the others are offered under the chart. The parent keeps the choice (`update:subChoice`).
     */
    subChoice?: readonly string[] | null;
    /** Say at the edge of the chart which levels lie outside the price range. */
    announce?: boolean;
    /**
     * A closed trade: when it ended long ago the chart opens on the local history around this
     * time (ms) instead of the latest candles, and reads back until the open is covered.
     */
    anchorEndMs?: number | null;
    /** Most candles the first window may widen to in order to show the whole trade. */
    frameMax?: number;
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
    announce: true,
    subChoice: undefined,
    height: '100%',
    timeoutMs: 20_000,
  },
);

const emit = defineEmits<{
  'update:toggles': [t: OverlayToggles];
  'update:subChoice': [ids: string[]];
  subplots: [list: SubplotInfo[]];
  ready: [chart: ECharts];
}>();

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
let tailTimer: ReturnType<typeof setTimeout> | undefined;

const HISTORY = 1000;
/** Candles of the first page of a closed trade that ended long ago: it lies beyond a bot's window. */
const ANCHOR_AFTER_CANDLES = 800;
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

// ---- where the candles come from ----
// `bot`: the bot's own answer (its strategy timeframe, with the indicators). `local`: the local
// history of the gateway (any timeframe, OHLCV only).
const via = ref<'bot' | 'local'>('bot');
const resampledFrom = ref<string | null>(null);
/** Older candles exist locally; null while it is not known (the candles came from a bot). */
const hasMore = ref<boolean | null>(null);
const firstAvailable = ref<number | null>(null);
const localApi = computed(() => activeSource.value?.query.candles ?? null);
// What the held set is a set of: a change of timeframe keeps the chart under the veil until the
// new set is there, and the first window is framed again only for the new set
const heldPair = ref('');
const heldTf = ref(props.tf);
const pairKey = () => `${props.botKey}|${props.pair}`;
let anchoredLoad = false;

interface Loaded {
  set: CandleSet;
  via: 'bot' | 'local';
  hasMore: boolean | null;
  first: number | null;
  resampledFrom: string | null;
  plot?: Partial<PlotConfig> | null;
}

async function readLocal(endMs: number | null, limit: number): Promise<Loaded> {
  const api = localApi.value;
  if (!api) throw new Error('no local history');
  const page: CandlesPage = await withTimeout(
    api({ pair: props.pair, timeframe: props.tf, endMs, limit }),
    props.timeoutMs,
  );
  return {
    set: setFromPage(page, tfMs(props.tf) || 0),
    via: 'local',
    hasMore: page.hasMore,
    first: page.firstAvailableMs,
    resampledFrom: page.resampledFrom,
  };
}

async function readBot(): Promise<Loaded> {
  const [history, cfg] = await Promise.all([
    proxy<PairHistory>(path(HISTORY)),
    props.plotConfig !== undefined
      ? Promise.resolve(props.plotConfig)
      : proxy<Partial<PlotConfig>>('/plot_config').catch(() => null),
  ]);
  return {
    set: toCandleSet(history),
    via: 'bot',
    hasMore: null,
    first: null,
    resampledFrom: null,
    plot: cfg ?? {},
  };
}

function hold(l: Loaded) {
  set.value = l.set;
  heldPair.value = pairKey();
  heldTf.value = props.tf;
  via.value = l.via;
  hasMore.value = l.hasMore;
  firstAvailable.value = l.first;
  resampledFrom.value = l.resampledFrom;
  if (l.plot !== undefined) {
    basePlot.value = { main_plot: {}, subplots: {}, ...(l.plot ?? {}) } as PlotConfig;
  }
}

async function loadAll(): Promise<void> {
  const mine = ++token;
  cancelOlder();
  clearTimeout(tailTimer);
  if (props.candles) {
    set.value = toCandleSet(props.candles);
    heldPair.value = pairKey();
    heldTf.value = props.tf;
    loading.value = false;
    return;
  }
  if (!activeSource.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const own = ownTf.value;
    const ms = tfMs(props.tf) || 0;
    // A closed trade that ended beyond what a bot holds: the history around its end
    const anchor = props.anchorEndMs ?? null;
    const anchored =
      !!localApi.value &&
      anchor !== null &&
      ms > 0 &&
      Date.now() - anchor > ANCHOR_AFTER_CANDLES * ms;
    // A timeframe other than the strategy's: the bot answers with nothing, ask the history first
    const preferLocal = !!localApi.value && (anchored || (own !== null && own !== props.tf));
    let loaded: Loaded | null = null;
    let failure: unknown = null;
    if (preferLocal) {
      try {
        const r = await readLocal(anchored ? anchor! + COVER_MARGIN * ms : null, HISTORY);
        if (r.set.rows.length > 0) loaded = r;
      } catch (e) {
        failure = e;
      }
      if (mine !== token) return;
    }
    if (!loaded) {
      try {
        const b = await readBot();
        if (mine !== token) return;
        loaded = b;
        // The bot has nothing for this timeframe: the local history, when there is one
        if (b.set.rows.length === 0 && !preferLocal && localApi.value) {
          try {
            const r = await readLocal(null, HISTORY);
            if (r.set.rows.length > 0) loaded = r;
          } catch (e) {
            failure = e;
          }
          if (mine !== token) return;
        }
      } catch (e) {
        if (mine !== token) return;
        failure = failure ?? e;
      }
    }
    if (!loaded) throw failure ?? new Error('no candles');
    anchoredLoad = anchored && loaded.via === 'local';
    hold(loaded);
    error.value = null;
    if (loaded.via === 'local') {
      if (anchoredLoad && !isCovered(firstTs.value, tradeStart.value, ms)) void loadOlder();
      else scheduleLocalTail();
    }
  } catch (e) {
    if (mine !== token) return;
    // The chart keeps what it had, unless that is another timeframe: it must not pass for this one
    if (heldPair.value !== pairKey() || heldTf.value !== props.tf) set.value = null;
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

/** The local history has no channel: the newest candles are asked once per candle. */
function scheduleLocalTail() {
  clearTimeout(tailTimer);
  const ms = tfMs(props.tf);
  if (via.value !== 'local' || anchoredLoad || props.candles || !localApi.value || !(ms > 0)) {
    return;
  }
  const mine = token;
  tailTimer = setTimeout(
    async () => {
      if (mine !== token) return;
      if (typeof document === 'undefined' || !document.hidden) await refreshLocalTail(mine);
      if (mine === token) scheduleLocalTail();
    },
    nextTailDelay(Date.now(), ms),
  );
}
async function refreshLocalTail(mine: number): Promise<void> {
  const api = localApi.value;
  const cur = set.value;
  const ms = tfMs(props.tf);
  if (!api || !cur || !(ms > 0) || lastTs.value === null) return;
  // Only the few newest candles: a stale history must not cost a page at every candle
  const limit = tailLimit(lastTs.value, Date.now(), ms);
  try {
    const page = await withTimeout(
      api({ pair: props.pair, timeframe: props.tf, limit }),
      props.timeoutMs,
    );
    if (mine !== token || !set.value) return;
    const tail = setFromPage(page, set.value.timeframeMs);
    const di = tail.columns.indexOf(DATE_COL);
    const first = di >= 0 && tail.rows.length > 0 ? (tail.rows[0]![di] as number | null) : null;
    // The tab slept longer than the few candles cover: reload rather than leave a hole
    if (tailHasGap(lastTs.value, first, ms)) {
      void loadAll();
      return;
    }
    const merged = mergeTail(set.value, tail);
    if (merged) {
      set.value = merged;
      error.value = null;
    }
  } catch (e) {
    if (mine === token) error.value = e instanceof Error ? e.message : String(e);
  }
}

// A tab that was hidden skipped the tail updates and nothing wakes them before the next candle
// boundary: when it is shown again, catch up at once
function onVisible() {
  if (typeof document === 'undefined' || document.hidden) return;
  if (via.value === 'local' && !anchoredLoad && !props.candles && localApi.value) {
    void refreshLocalTail(token);
  }
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);

function resubscribe() {
  unsubscribe?.();
  unsubscribe = null;
  const source = activeSource.value;
  if (!source || props.candles) return;
  unsubscribe = source.subscribe(
    'chart',
    { botKey: props.botKey, pair: props.pair, timeframe: props.tf },
    (u) => {
      if (u.kind !== 'item') return;
      if (via.value === 'bot') void refreshTail();
      // The bot answers again on its own timeframe after a restart: leave the local fallback, once
      else if (via.value === 'local' && !anchoredLoad && ownTf.value === props.tf) void loadAll();
    },
  );
}

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
const hasVolumeColumn = computed(() => set.value?.columns.includes('volume') ?? false);
const subsTotal = computed(() =>
  set.value ? subplotCount(plot.value, props.rsi, set.value.columns) : 0,
);

// Chosen sub-charts: titled bands above them are part of the layout
const touch = useMediaQuery('(max-width: 599px), (pointer: coarse)');
const subTitleH = computed(() => (touch.value ? 44 : 24));
const SUB_H_CHOSEN = 78;
// The user chose these sub-charts: they get room, the price pane keeps at least 40 % of the chart
const MAIN_MIN_SHARE_CHOSEN = 0.4;
const managed = computed(() => props.subChoice !== undefined);
const candidates = computed(() =>
  set.value ? subplotCandidates(plot.value, props.rsi, set.value.columns) : [],
);
const chosenIds = computed<string[] | null>(() =>
  managed.value ? resolveSubplots(candidates.value, props.subChoice) : null,
);
// A small chart cannot hold the volume and the sub-chart the user chose: the sub-chart wins
const hideVolume = computed(() => {
  if (!managed.value || !hasVolumeColumn.value || !showSubs.value) return false;
  const want = chosenIds.value?.length ?? 0;
  if (want === 0) return false;
  const withVolume = paneLayout({
    heightPx: plotHeight.value,
    hasVolume: true,
    subCount: want,
    showSubplots: true,
    subTitleH: subTitleH.value,
    subH: SUB_H_CHOSEN,
    mainMinShare: MAIN_MIN_SHARE_CHOSEN,
  });
  return withVolume.subs.length < want;
});
const hasVolume = computed(() => hasVolumeColumn.value && !hideVolume.value);
const layoutIn = computed(() => ({
  heightPx: plotHeight.value,
  hasVolume: hasVolume.value,
  subCount: managed.value ? (chosenIds.value?.length ?? 0) : subsTotal.value,
  showSubplots: showSubs.value,
  subTitleH: managed.value ? subTitleH.value : 0,
  subH: managed.value ? SUB_H_CHOSEN : undefined,
  mainMinShare: managed.value ? MAIN_MIN_SHARE_CHOSEN : undefined,
}));
const layout = computed(() => paneLayout(layoutIn.value));
// The first sub-chart the user chose keeps its room: a chart given less (a short window) grows to
// this height and its panel scrolls, rather than dropping the sub-chart
const minPlot = computed(() =>
  managed.value && showSubs.value && (chosenIds.value?.length ?? 0) > 0
    ? `${minHeightForSubs({ subs: 1, subTitleH: subTitleH.value, subH: SUB_H_CHOSEN })}px`
    : undefined,
);
const subsShown = computed(() => layout.value.subs.length);

/** Plain title, one-line explanation and raw names of a sub-chart. */
function subInfo(c: {
  id: string;
  series: Record<string, unknown>;
}): SubplotInfo & { short: string } {
  const raw = Object.keys(c.series);
  const group = c.id === BUILTIN_RSI ? 'rsi' : c.id;
  const l = subplotLabel(group, raw, lang.value);
  return {
    id: c.id,
    label: l.label,
    short: l.short,
    explain: l.explain ?? t('fq.pg.charts.sub.generic'),
    raw,
    shown: chosenIds.value?.includes(c.id) ?? true,
  };
}
const lang = computed(() => (fmt.lang() === 'fr' ? 'fr' : 'en') as 'fr' | 'en');
const subList = computed(() => candidates.value.map(subInfo));
// What the panes draw, in order (the ones that do not fit are not on screen)
const panes = computed(() =>
  (chosenIds.value ?? [])
    .slice(0, layout.value.subs.length)
    .map((id) => subList.value.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s, k) => ({ ...s, band: layout.value.subs[k]!.top - subTitleH.value })),
);
// Chosen but without room on this screen: said, not silently dropped
const noRoom = computed(() =>
  managed.value && set.value
    ? Math.max(0, (chosenIds.value?.length ?? 0) - layout.value.subs.length)
    : 0,
);
const addable = computed(() => subList.value.filter((s) => !s.shown));
function hideSub(id: string) {
  emit(
    'update:subChoice',
    (chosenIds.value ?? []).filter((x) => x !== id),
  );
}
function addSub(id: string) {
  emit('update:subChoice', [...(chosenIds.value ?? []), id]);
}
watch(
  subList,
  (l) =>
    emit(
      'subplots',
      l.map(({ id, label, explain, raw, shown }) => ({ id, label, explain, raw, shown })),
    ),
  { immediate: true },
);

// A bot only serves the candles of its own strategy timeframe: say so rather than "no candle yet"
const ownTf = computed(() => fleet.bots[props.botKey]?.identity.timeframe ?? null);
const wrongTf = computed(() => ownTf.value !== null && ownTf.value !== props.tf);

const visibleCount = computed(
  () => props.visibleCandles ?? prefs.settings.ui.chartDefaultCandleCount,
);

// The open position is framed: the window shows its open date unless that is too far back
const lastTs = computed(() => {
  const set_ = set.value;
  const di = set_ ? set_.columns.indexOf(DATE_COL) : -1;
  return set_ && di >= 0 && set_.rows.length > 0
    ? (set_.rows[set_.rows.length - 1]![di] as number)
    : null;
});
const clock = useNowMs();
const staleText = computed(() => {
  const age = staleAgeMs(lastTs.value, clock.value, tfMs(props.tf));
  if (age === null) return '';
  const { n, unit } = ageParts(age);
  return t('fq.candle.localStale', { age: t(`fq.candle.age.${unit}`, { n }) });
});
const firstTs = computed(() => {
  const set_ = set.value;
  const di = set_ ? set_.columns.indexOf(DATE_COL) : -1;
  return set_ && di >= 0 && set_.rows.length > 0 ? (set_.rows[0]![di] as number) : null;
});
const frame = computed(() =>
  frameCandles({
    openTs: props.overlays.openTs,
    lastTs: lastTs.value,
    timeframeMs: set.value?.timeframeMs ?? 0,
    base: visibleCount.value,
    max: props.frameMax,
  }),
);

// The zoom window is only imposed on the first render of a pair and timeframe (and again when the
// position it frames changes)
const zoomKey = computed(
  () => `${props.botKey}|${props.pair}|${heldTf.value}|${props.overlays.openTs ?? ''}`,
);
const zoomApplied = ref<string | null>(null);
// A window in percent to show now: older candles were put in front and the moment on screen stays
const zoomWin = ref<{ start: number; end: number } | null>(null);

// ---- older candles ("Load previous candles") ----
const tradeStart = computed(() => tradeStartTs(props.overlays));
const older = ref({ running: false, pages: 0, candles: 0 });
const olderError = ref<string | null>(null);
let olderGen = 0;

function cancelOlder() {
  olderGen += 1;
  older.value = { running: false, pages: 0, candles: 0 };
}

const olderUi = computed(() =>
  olderState({
    hasApi: !!localApi.value,
    firstTs: firstTs.value,
    tradeStart: tradeStart.value,
    hasMore: hasMore.value,
    atEdge: win.value.start <= 0.5,
    count: set.value?.rows.length ?? 0,
  }),
);
const noMoreText = computed(() =>
  firstAvailable.value !== null
    ? t('fq.candle.olderNoMoreSince', { date: timeFmt.value.format(firstAvailable.value) })
    : t('fq.candle.olderNoMore'),
);

/** The window on screen as moments, from its percentages and the candles it is a window of. */
function windowTs(s: CandleSet): { from: number; to: number } | null {
  const di = s.columns.indexOf(DATE_COL);
  if (di < 0 || s.rows.length === 0) return null;
  const a = s.rows[0]![di] as number;
  const b = s.rows[s.rows.length - 1]![di] as number;
  return { from: a + ((b - a) * win.value.start) / 100, to: a + ((b - a) * win.value.end) / 100 };
}
const pctIn = (s: CandleSet, ts: number): number => {
  const di = s.columns.indexOf(DATE_COL);
  const a = s.rows[0]![di] as number;
  const b = s.rows[s.rows.length - 1]![di] as number;
  return b > a ? Math.min(100, Math.max(0, ((ts - a) / (b - a)) * 100)) : 0;
};

/**
 * Put older pages in front of the candles, one after the other, until the open of the trade is
 * covered (with a margin) or, with no trade to reach, after one page. It stops when the history
 * ends, at the memory ceiling, on a failure or when the user cancels. The moment that was on
 * screen stays on screen; at the end the window is framed on the trade.
 */
async function loadOlder(): Promise<void> {
  const api = localApi.value;
  if (!api || older.value.running || !set.value || props.candles) return;
  const gen = ++olderGen;
  const mine = token;
  const target = tradeStart.value;
  older.value = { running: true, pages: 0, candles: 0 };
  olderError.value = null;
  try {
    for (;;) {
      const cur = set.value;
      if (!cur || mine !== token || gen !== olderGen) return;
      const first =
        cur.rows.length > 0 ? (cur.rows[0]![cur.columns.indexOf(DATE_COL)] as number) : null;
      if (first === null || cur.rows.length >= MAX_CANDLES) break;
      const page = await withTimeout(
        api({ pair: props.pair, timeframe: props.tf, endMs: first, limit: OLDER_PAGE }),
        props.timeoutMs,
      );
      const now = set.value;
      if (!now || mine !== token || gen !== olderGen) return;
      const merged = prependOlder(now, setFromPage(page, now.timeframeMs));
      const added = merged.rows.length - now.rows.length;
      hasMore.value = page.hasMore;
      firstAvailable.value = page.firstAvailableMs;
      older.value = {
        running: true,
        pages: older.value.pages + 1,
        candles: older.value.candles + added,
      };
      // The same moment stays on screen while pages come in
      const w = windowTs(now);
      if (w && added > 0) {
        zoomWin.value = { start: pctIn(merged, w.from), end: pctIn(merged, w.to) };
      }
      set.value = merged;
      const newFirst = merged.rows[0]![merged.columns.indexOf(DATE_COL)] as number;
      const finished =
        !page.hasMore ||
        added === 0 ||
        target === null ||
        merged.rows.length >= MAX_CANDLES ||
        isCovered(newFirst, target, now.timeframeMs);
      if (finished) {
        if (target === null && w && added > 0) {
          // No trade to reach: show what was just added, the old edge a fifth into the window
          const span = w.to - w.from;
          zoomWin.value = {
            start: pctIn(merged, Math.max(newFirst, first - span * 0.8)),
            end: pctIn(merged, first + span * 0.2),
          };
        }
        break;
      }
    }
  } catch (e) {
    if (mine === token && gen === olderGen) {
      olderError.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    if (gen === olderGen) older.value = { ...older.value, running: false };
  }
  if (gen !== olderGen || mine !== token) return;
  // The trade is in reach: frame it. A trade too far for the first window is brought back by hand
  const s = set.value;
  const tf = s?.timeframeMs ?? 0;
  if (s && tradeStart.value !== null && isCovered(firstTs.value, tradeStart.value, tf)) {
    if (frame.value.framed) {
      zoomWin.value = null;
      zoomApplied.value = null;
    } else {
      await nextTick();
      requestAnimationFrame(() => recentre());
    }
  }
  scheduleLocalTail();
}

// The measure in progress (see the tool below); it dies with the pair or the timeframe
interface Drag {
  a: MeasurePoint;
  b: MeasurePoint;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}
const drag = ref<Drag | null>(null);

watch(
  () =>
    [
      activeSource.value,
      props.botKey,
      props.pair,
      props.tf,
      props.candles,
      props.anchorEndMs ?? null,
    ] as const,
  () => {
    // Another pair or bot: the held chart is no use. The same pair in another timeframe stays
    // under the veil until the candles of the new one are there.
    if (props.candles) set.value = toCandleSet(props.candles);
    else if (heldPair.value !== pairKey()) set.value = null;
    hover.value = null;
    drag.value = null;
    olderError.value = null;
    void loadAll();
    resubscribe();
  },
  { immediate: true },
);

const timeFmt = computed(
  () =>
    new Intl.DateTimeFormat(fmt.lang() === 'fr' ? 'fr-FR' : 'en-GB', {
      timeZone: prefs.settings.tz,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
);
const chartFmt = {
  number: (v: number, d?: number) => fmt.number(v, d),
  signed: (v: number, d?: number) => fmt.signed(v, d),
  percent: (v: number) => fmt.percent(v, 2),
  time: (ts: number) => timeFmt.value.format(ts),
  duration: (ms: number) => fmt.duration(ms / 3_600_000),
};

const overlayLabels = computed(() => ({
  candles: t('fq.candle.candles'),
  volume: t('fq.candle.volume'),
  average: t('fq.candle.average'),
  tp: t('fq.candle.tp'),
  liquidation: t('fq.candle.liquidation'),
  entry: t('fq.candle.entry'),
  dca: t('fq.candle.dca'),
  exit: t('fq.candle.exit'),
  dcaTag: t('fq.candle.dcaTag'),
  refill: t('fq.candle.refill'),
  refills: t('fq.candle.refills'),
  closedTrade: t('fq.candle.closedTrade'),
  pending: {
    entry: t('fq.candle.pending.entry'),
    dca: t('fq.candle.pending.dca'),
    tp: t('fq.candle.pending.tp'),
    exit: t('fq.candle.pending.exit'),
    stop: t('fq.candle.pending.stop'),
  },
  tip: {
    amount: t('fq.candle.tip.amount'),
    price: t('fq.candle.tip.price'),
    cost: t('fq.candle.tip.cost'),
    time: t('fq.candle.tip.time'),
    duration: t('fq.candle.tip.duration'),
    reason: t('fq.candle.tip.reason'),
    result: t('fq.candle.tip.result'),
    opened: t('fq.candle.tip.opened'),
    closed: t('fq.candle.tip.closed'),
  },
}));

const levels = computed(() =>
  levelLines(props.overlays, toggles.value, tokens.value, overlayLabels.value),
);
// The price range on screen, read back from the chart (a pan or a zoom moves it)
const axisRange = ref<{ lo: number; hi: number } | null>(null);
// Level labels that would be written over each other are merged or stacked. Placing them needs the
// price range really on screen, so the first draw writes them as they come and the next one (after
// the chart reports its range) places them; the plan is kept as text so that a pan which moves
// nothing does not redraw the chart.
const planKey = computed(() =>
  JSON.stringify(
    planLevelLabels(
      levels.value,
      (v) => fmt.price(v),
      { refills: overlayLabels.value.refills },
      axisRange.value
        ? {
            lo: axisRange.value.lo,
            hi: axisRange.value.hi,
            top: layout.value.main.top,
            height: layout.value.main.height,
          }
        : null,
    ),
  ),
);
const labelPlan = computed<Record<string, LabelPlan>>(() => JSON.parse(planKey.value));

// Execution markers that sit on top of each other on screen (a wide window packs many candles into
// a few pixels) merge their tags. The merge needs the markers' pixels, read back from the chart; it
// is kept as text so that a pan that moves every marker together does not redraw the chart.
const fillPx = ref<Array<FillPx | null>>([]);
const fillKey = computed(() =>
  JSON.stringify(
    fillPlan(
      props.overlays.fills ?? [],
      overlayLabels.value.dcaTag,
      set.value?.timeframeMs ?? 0,
      4,
      fillPx.value,
    ),
  ),
);
const fillPlanNow = computed<FillPlan>(() => JSON.parse(fillKey.value));

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
    labels: overlayLabels.value,
    fmtPrice: (v) => fmt.price(v),
    fmt: chartFmt,
    visibleCandles: frame.value.visible,
    initialZoom: zoomApplied.value !== zoomKey.value,
    zoomWin: zoomWin.value,
    labelSide: prefs.settings.ui.chartLabelSide,
    heightPx: plotHeight.value,
    showSubplots: showSubs.value,
    subplotIds: chosenIds.value,
    subTitleH: layoutIn.value.subTitleH,
    subH: layoutIn.value.subH,
    mainMinShare: layoutIn.value.mainMinShare,
    labelPlan: labelPlan.value,
    fillPlan: fillPlanNow.value,
    hideVolume: hideVolume.value,
  });
});

// The window on screen, in percent of the loaded candles: the first render sets it, a zoom or a
// pan (the `datazoom` event) moves it
const win = ref<{ start: number; end: number }>({ start: 0, end: 100 });
watch(
  option,
  (o) => {
    if (!o) return;
    if (zoomWin.value) {
      win.value = { ...zoomWin.value };
      zoomWin.value = null;
    } else if (zoomApplied.value !== zoomKey.value) {
      win.value = {
        start: zoomStartPct(set.value?.rows.length ?? 0, frame.value.visible),
        end: 100,
      };
    }
    zoomApplied.value = zoomKey.value;
  },
  { flush: 'post' },
);

// "entered 5 h ago": the open date is left of the window, the click brings it back
const edge = computed(() => {
  const a = firstTs.value;
  const b = lastTs.value;
  if (a === null || b === null || props.overlays.openTs == null) return null;
  return entryEdge(props.overlays.openTs, a + ((b - a) * win.value.start) / 100, Date.now());
});
function recentre() {
  const a = firstTs.value;
  const b = lastTs.value;
  const open = props.overlays.openTs;
  if (!chartRef || a === null || b === null || open == null) return;
  const w = recentreOn({
    openTs: open,
    firstTs: a,
    lastTs: b,
    spanMs: ((b - a) * (win.value.end - win.value.start)) / 100,
  });
  chartRef.dispatchAction({ type: 'dataZoom', startValue: w.startTs, endValue: w.endTs });
}

const names = computed(() =>
  set.value ? indicatorNames(plot.value, props.rsi, set.value.columns) : [],
);
const legend = computed(() =>
  set.value ? legendAt(set.value, hover.value ?? undefined, names.value) : null,
);
const up = computed(() => (legend.value?.close ?? 0) >= (legend.value?.open ?? 0));
// The legend speaks plainly ("RSI 14"); the column name stays in the tooltip
const legendNames = computed(() =>
  names.value.map((raw) => ({
    raw,
    short: indicatorLabel(raw, lang.value).short,
  })),
);

// ---- levels outside the price range: announced at the edge, with their distance ----
const lastClose = computed(() => {
  const s_ = set.value;
  const ci = s_ ? s_.columns.indexOf('close') : -1;
  if (!s_ || ci < 0) return null;
  for (let i = s_.rows.length - 1; i >= 0; i--) {
    const v = s_.rows[i]![ci];
    if (v != null) return v as number;
  }
  return null;
});
function readFillPx() {
  const fills = props.overlays.fills ?? [];
  if (!chartRef || typeof chartRef.convertToPixel !== 'function') return;
  fillPx.value = fills.map((f) => {
    const p = chartRef!.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [
      f.ts,
      f.price,
    ]) as unknown;
    return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
      ? { x: Math.round(p[0] as number), y: Math.round(p[1] as number) }
      : null;
  });
}
function readRange() {
  readFillPx();
  const m = layout.value.main;
  if (!chartRef || typeof chartRef.convertFromPixel !== 'function') return;
  const a = chartRef.convertFromPixel({ yAxisIndex: 0 }, m.top) as unknown;
  const b = chartRef.convertFromPixel({ yAxisIndex: 0 }, m.top + m.height) as unknown;
  if (
    typeof a !== 'number' ||
    typeof b !== 'number' ||
    !Number.isFinite(a) ||
    !Number.isFinite(b)
  ) {
    return;
  }
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const cur = axisRange.value;
  const eps = (hi - lo) * 1e-6;
  if (cur && Math.abs(cur.lo - lo) < eps && Math.abs(cur.hi - hi) < eps) return;
  axisRange.value = { lo, hi };
}
const FAR_MAX = 3;
const far = computed(() => {
  if (!props.announce || !axisRange.value) return { up: [], down: [], moreUp: 0, moreDown: 0 };
  const all = offscreenLevels(levels.value, axisRange.value, lastClose.value).map((o) => ({
    ...o,
    color: levels.value.find((l) => l.id === o.id)?.color,
    text: t('fq.candle.far.level', {
      arrow: o.dir === 'up' ? '↑' : '↓',
      label: o.label,
      price: fmt.price(o.price),
      pct: o.pct === null ? '' : fmt.percent(o.pct, 0),
    }),
  }));
  const upList = all.filter((o) => o.dir === 'up');
  const downList = all.filter((o) => o.dir === 'down');
  return {
    up: upList.slice(0, FAR_MAX),
    down: downList.slice(0, FAR_MAX),
    moreUp: Math.max(0, upList.length - FAR_MAX),
    moreDown: Math.max(0, downList.length - FAR_MAX),
  };
});

function onReady(chart: ECharts) {
  chartRef = chart;
  chart.on('finished', readRange);
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
  chart.on('datazoom', (ev: unknown) => {
    drag.value = null;
    type Z = { start?: number; end?: number; startValue?: number; endValue?: number };
    const e = ev as Z & { batch?: Z[] };
    const w = e.batch?.[0] ?? e;
    const a = firstTs.value;
    const b = lastTs.value;
    if (typeof w.start === 'number' && typeof w.end === 'number') {
      win.value = { start: w.start, end: w.end };
    } else if (
      a !== null &&
      b !== null &&
      b > a &&
      typeof w.startValue === 'number' &&
      typeof w.endValue === 'number'
    ) {
      // A window given in time (the edge marker) comes back without percentages
      win.value = {
        start: Math.max(0, ((w.startValue - a) / (b - a)) * 100),
        end: Math.min(100, ((w.endValue - a) / (b - a)) * 100),
      };
    }
  });
  emit('ready', chart);
}

// ---- measure tool: Shift + drag (or armed, or long press on touch) ----
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
  olderGen += 1;
  clearTimeout(tailTimer);
  cancelAnimationFrame(rafId);
  clearTimeout(pressTimer);
  removeWindowListeners();
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
  chartRef?.off('updateAxisPointer');
  chartRef?.off('finished');
  chartRef?.off('globalout');
  chartRef = null;
  unsubscribe?.();
  unsubscribe = null;
});

const toggleKeys: Array<keyof OverlayToggles> = [
  'average',
  'tp',
  'safetyOrders',
  'pending',
  'fills',
  'gain',
  'closed',
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
    case 'pending':
      return (o.pending?.length ?? 0) > 0;
    case 'gain':
      return o.gain != null;
    case 'closed':
      return (o.closed?.length ?? 0) > 0;
  }
};
</script>

<template>
  <div
    class="cc"
    data-testid="candle-chart"
    :aria-busy="loading || undefined"
    :data-fills="overlays.fills?.length ?? 0"
    :data-pending="overlays.pending?.length ?? 0"
    :data-closed="overlays.closed?.length ?? 0"
    :data-gain="overlays.gain ? 1 : 0"
    :data-framed="frame.framed ? 1 : 0"
  >
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
        <span v-for="n in legendNames" :key="n.raw" class="ind" :title="n.raw">
          {{ n.short }}
          <b class="num"
            ><ValueState
              v-if="legend.values[n.raw] === null || legend.values[n.raw] === undefined"
              state="unavailable"
              :reason="t('fq.value.reason.noData')"
            /><template v-else>{{ fmt.number(legend.values[n.raw] as number, 2) }}</template></b
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
    <p v-if="option && via === 'local'" class="lnote" data-testid="candle-local-note">
      {{
        resampledFrom
          ? t('fq.candle.localNoteResampled', { from: resampledFrom })
          : t('fq.candle.localNote')
      }}
      <span v-if="staleText" data-testid="candle-local-stale">{{ staleText }}</span>
    </p>
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
    <!-- Levels off the screen are announced in their own row above the chart, never over it: on
         the plot they sat on the gain label and on the price axis -->
    <div
      v-if="option && (far.up.length > 0 || far.down.length > 0)"
      class="far"
      data-testid="candle-far"
    >
      <span
        v-for="o in [...far.up, ...far.down]"
        :key="o.id"
        class="item num"
        :style="{ color: o.color }"
        data-testid="candle-far-level"
        >{{ o.text }}</span
      >
      <span v-if="far.moreUp + far.moreDown > 0" class="item num">{{
        t('fq.candle.far.more', { n: far.moreUp + far.moreDown })
      }}</span>
    </div>
    <div
      ref="plotEl"
      class="plot"
      :class="{ armed: measureArmed }"
      :style="{ height, minHeight: minPlot }"
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
              ? localApi
                ? t('fq.candle.emptyLocal')
                : `${t('fq.candle.onlyTf', { tf: ownTf })} ${t('fq.candle.needGatewayTf')}`
              : t('fq.candle.emptyHint')
        "
        data-testid="candle-empty"
      />
      <div
        v-for="p in option ? panes : []"
        :key="p.id"
        class="subhd"
        :class="prefs.settings.ui.chartLabelSide"
        :style="{ top: `${p.band}px`, height: `${subTitleH}px` }"
        data-testid="candle-subhd"
      >
        <b :title="p.raw.join(', ')">{{ p.label }}</b>
        <span class="why" :title="p.explain ?? undefined">{{ p.explain }}</span>
        <button
          type="button"
          class="hide"
          :aria-label="t('fq.pg.charts.sub.hideNamed', { name: p.label })"
          data-testid="candle-sub-hide"
          @click="hideSub(p.id)"
        >
          {{ t('fq.pg.charts.sub.hide') }}
        </button>
      </div>
      <div
        v-if="option && (edge || older.running || olderUi !== 'hidden' || olderError)"
        class="edges"
      >
        <button
          v-if="edge"
          type="button"
          class="edge num"
          data-testid="candle-entry-edge"
          :title="t('fq.candle.entryEdgeTip')"
          @click="recentre"
        >
          {{ t('fq.candle.entryAgo', { age: fmt.age(edge.ageMs) }) }}
        </button>
        <span
          v-if="older.running"
          class="edge prog"
          role="status"
          data-testid="candle-older-progress"
        >
          <span class="spin vs-spin" aria-hidden="true"></span>
          {{ t('fq.candle.olderProgress', { n: older.candles }) }}
          <button
            type="button"
            class="cancel"
            data-testid="candle-older-cancel"
            @click="cancelOlder"
          >
            {{ t('fq.candle.olderCancel') }}
          </button>
        </span>
        <button
          v-else-if="olderUi === 'show'"
          type="button"
          class="edge older"
          data-testid="candle-load-older"
          :title="t('fq.candle.loadOlderTip')"
          @click="loadOlder()"
        >
          {{ t('fq.candle.loadOlder') }}
        </button>
        <span
          v-else-if="olderUi === 'needGateway'"
          class="hintline"
          data-testid="candle-need-gateway"
        >
          {{ t('fq.candle.olderNeedGateway') }}
        </span>
        <span v-else-if="olderUi === 'noMore'" class="hintline" data-testid="candle-no-more">
          {{ noMoreText }}
        </span>
        <span v-else-if="olderUi === 'capped'" class="hintline" data-testid="candle-capped">
          {{ t('fq.candle.olderCapped', { n: MAX_CANDLES }) }}
        </span>
        <span
          v-if="olderError"
          class="hintline warn"
          role="status"
          data-testid="candle-older-error"
        >
          {{ t('fq.candle.olderError') }} · {{ olderError }}
        </span>
      </div>
      <!-- Every load says so: the chart stays under a veil (a first load shows the skeleton) -->
      <Transition name="cc-veil">
        <div
          v-if="loading"
          class="veil"
          :class="{ bare: !option }"
          role="status"
          data-testid="candle-loading"
        >
          <span class="spin vs-spin" aria-hidden="true"></span>
          <span>{{ t('fq.candle.loading', { tf }) }}</span>
        </div>
      </Transition>
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
    <p v-if="noRoom > 0" class="note" role="status" data-testid="candle-sub-noroom">
      {{ t('fq.pg.charts.sub.noRoom', { n: noRoom }) }}
    </p>
    <div v-if="managed && addable.length > 0" class="addsub" data-testid="candle-addsub">
      <span class="lead">{{ t('fq.pg.charts.sub.add') }}</span>
      <button
        v-for="a in addable"
        :key="a.id"
        type="button"
        class="pick"
        :title="a.raw.join(', ')"
        data-testid="candle-sub-add"
        @click="addSub(a.id)"
      >
        {{ a.label }}
      </button>
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
.far {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px var(--s3);
  border-bottom: 1px solid var(--line);
  pointer-events: none;
}
.far .item {
  padding: 1px 8px;
  border-radius: var(--r-1);
  background: color-mix(in srgb, var(--bg-1) 88%, transparent);
  border: 1px solid var(--line-2);
  color: var(--fg-2);
  font-size: var(--t-xs);
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.subhd {
  position: absolute;
  z-index: 3;
  left: 8px;
  right: 8px;
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
  padding: 4px 4px 0;
  font-size: var(--t-sm);
  white-space: nowrap;
}
.subhd.left {
  left: 46px;
}
.subhd b {
  flex: none;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}
.subhd .why {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.subhd .hide,
.addsub .pick {
  flex: none;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: var(--t-xs);
  cursor: pointer;
  padding: 0 2px;
}
.subhd .hide:hover,
.addsub .pick:hover {
  text-decoration: underline;
}
.addsub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin: 2px var(--s3) var(--s2);
  padding: 7px 12px;
  border: 1px dashed var(--line-2);
  border-radius: var(--r-2);
  color: var(--fg-3);
  font-size: var(--t-sm);
}
.addsub .pick {
  font-size: var(--t-sm);
  min-height: 24px;
}
@media (max-width: 599px), (pointer: coarse) {
  .subhd .hide,
  .addsub .pick {
    min-height: 44px;
    padding: 0 8px;
  }
  .subhd {
    align-items: center;
    padding-top: 0;
  }
  .addsub {
    margin: 2px var(--s3) var(--s2);
  }
}
.edges {
  position: absolute;
  z-index: 3;
  /* At the left edge, mid height: the top of the plot carries the labels of the lines */
  left: 56px;
  top: 40%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  max-width: calc(100% - 120px);
}
.edge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: var(--r-1);
  background: var(--bg-3);
  border: 1px solid var(--accent);
  color: var(--accent);
  font-size: var(--t-xs);
  cursor: pointer;
}
.edge:hover {
  background: var(--bg-2);
}
.edge.prog {
  cursor: default;
  color: var(--fg-2);
  border-color: var(--line-2);
}
.edge.prog:hover {
  background: var(--bg-3);
}
.cancel {
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
  padding: 0 2px;
}
.cancel:hover {
  text-decoration: underline;
}
.hintline {
  padding: 2px 8px;
  border-radius: var(--r-1);
  background: color-mix(in srgb, var(--bg-1) 88%, transparent);
  border: 1px solid var(--line-2);
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.hintline.warn {
  color: var(--warn);
}
.lnote {
  margin: 0;
  padding: 2px var(--s3);
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.veil {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  color: var(--fg-2);
  font-size: var(--t-sm);
  cursor: progress;
}
.veil.bare {
  background: none;
}
.spin {
  flex: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--fg-2);
  border-right-color: transparent;
  animation: fq-spin 700ms linear infinite;
}
.cc-veil-enter-active,
.cc-veil-leave-active {
  transition: opacity var(--d-base) var(--e-out);
}
.cc-veil-enter-from,
.cc-veil-leave-to {
  opacity: 0;
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
