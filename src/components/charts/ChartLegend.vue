<script setup lang="ts">
import type { SeriesInfo, AxisPointerValues } from './CandleChart.vue';

const props = withDefaults(
  defineProps<{
    series: SeriesInfo[];
    axisValues?: AxisPointerValues;
    showRealtimeValues?: boolean;
    theme?: 'dark' | 'light';
  }>(),
  {
    axisValues: undefined,
    showRealtimeValues: true,
    theme: 'dark',
  },
);

const emit = defineEmits<{
  toggle: [name: string];
  isolate: [name: string];
  showAll: [];
}>();

const expanded = ref(false);

const uniqueSeries = computed(() => {
  const seen = new Set<string>();
  return props.series.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
});

function getValueForSeries(name: string): string | null {
  if (!props.showRealtimeValues || !props.axisValues) return null;
  const val = props.axisValues.values[name];
  if (val == null) return null;
  if (typeof val === 'number') {
    if (Math.abs(val) < 0.001 && val !== 0) return val.toExponential(2);
    if (Math.abs(val) > 100000) return val.toFixed(0);
    return val.toFixed(4);
  }
  return String(val);
}

function getOhlcValues(): {
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  change: number;
} | null {
  if (!props.axisValues) return null;
  const v = props.axisValues.values;
  if (v.open == null || v.close == null) return null;
  const fmt = (n: number | string | null) => {
    if (n == null) return '-';
    const num = Number(n);
    if (Math.abs(num) < 0.001 && num !== 0) return num.toExponential(2);
    return num.toFixed(4);
  };
  const open = Number(v.open);
  const close = Number(v.close);
  const change = open !== 0 ? ((close - open) / open) * 100 : 0;
  return {
    o: fmt(v.open),
    h: fmt(v.high),
    l: fmt(v.low),
    c: fmt(v.close),
    v:
      v.volume != null
        ? Number(v.volume).toLocaleString(undefined, { maximumFractionDigits: 0 })
        : '-',
    change,
  };
}

const indicatorSeries = computed(() =>
  uniqueSeries.value.filter((s) => s.group === 'indicator' || s.group === 'subplot'),
);
</script>

<template>
  <div class="legend-bar" :class="{ 'legend-dark': theme === 'dark' }">
    <!-- OHLCV compact -->
    <template v-if="getOhlcValues()">
      <span class="ohlcv">
        <span class="ohlcv-label">O</span><span class="ohlcv-val">{{ getOhlcValues()!.o }}</span>
      </span>
      <span class="ohlcv">
        <span class="ohlcv-label">H</span
        ><span class="ohlcv-val ohlcv-high">{{ getOhlcValues()!.h }}</span>
      </span>
      <span class="ohlcv">
        <span class="ohlcv-label">L</span
        ><span class="ohlcv-val ohlcv-low">{{ getOhlcValues()!.l }}</span>
      </span>
      <span class="ohlcv">
        <span class="ohlcv-label">C</span><span class="ohlcv-val">{{ getOhlcValues()!.c }}</span>
      </span>
      <span
        class="ohlcv-change"
        :class="{ positive: getOhlcValues()!.change >= 0, negative: getOhlcValues()!.change < 0 }"
      >
        {{ getOhlcValues()!.change >= 0 ? '+' : '' }}{{ getOhlcValues()!.change.toFixed(2) }}%
      </span>
      <span class="ohlcv ohlcv-volume">
        <span class="ohlcv-label">Vol</span><span class="ohlcv-val">{{ getOhlcValues()!.v }}</span>
      </span>
      <span class="legend-sep" />
    </template>

    <!-- Built-in series toggles (compact) -->
    <button
      v-for="s in uniqueSeries.filter((s) =>
        ['price', 'volume', 'signal', 'trade'].includes(s.group),
      )"
      :key="s.name + '-btn'"
      class="legend-chip"
      :class="{ off: !s.visible }"
      :title="s.name + ' — double-clic: isoler'"
      @click="emit('toggle', s.name)"
      @dblclick="emit('isolate', s.name)"
    >
      <span
        class="chip-dot"
        :style="{ backgroundColor: s.visible ? s.color : 'transparent', borderColor: s.color }"
      />
      <span class="chip-name">{{ s.name }}</span>
    </button>

    <!-- Trade marker legend -->
    <span class="legend-sep" />
    <span class="trade-legend-item"
      ><span class="tl-marker tl-circle tl-sig-entry" />Signal entrée</span
    >
    <span class="trade-legend-item"
      ><span class="tl-marker tl-circle tl-sig-exit" />Signal sortie</span
    >
    <span class="trade-legend-item"><span class="tl-marker tl-circle tl-entry" />Entrée</span>
    <span class="trade-legend-item"><span class="tl-marker tl-triangle tl-entry" />Short</span>
    <span class="trade-legend-item"><span class="tl-marker tl-square tl-dca" />DCA</span>
    <span class="trade-legend-item"><span class="tl-marker tl-circle tl-win" />Win</span>
    <span class="trade-legend-item"><span class="tl-marker tl-circle tl-loss" />Loss</span>

    <!-- Indicator values -->
    <template v-if="indicatorSeries.length > 0">
      <span class="legend-sep" />
      <button
        v-for="ind in expanded ? indicatorSeries : indicatorSeries.slice(0, 4)"
        :key="ind.name + '-ind'"
        class="legend-chip indicator-chip"
        :class="{ off: !ind.visible }"
        :title="
          (ind.subplotName ? ind.subplotName + ' / ' : '') + ind.name + ' — double-clic: isoler'
        "
        @click="emit('toggle', ind.name)"
        @dblclick="emit('isolate', ind.name)"
      >
        <span
          class="chip-dot"
          :style="{
            backgroundColor: ind.visible ? ind.color : 'transparent',
            borderColor: ind.color,
          }"
        />
        <span class="chip-name">{{ ind.name }}</span>
        <span
          v-if="showRealtimeValues && ind.visible && getValueForSeries(ind.name)"
          class="chip-value"
        >
          {{ getValueForSeries(ind.name) }}
        </span>
      </button>
      <button
        v-if="indicatorSeries.length > 4"
        class="legend-chip expand-chip"
        @click="expanded = !expanded"
      >
        {{ expanded ? '−' : `+${indicatorSeries.length - 4}` }}
      </button>
    </template>

    <!-- Show all button -->
    <button class="legend-show-all" title="Tout afficher" @click="emit('showAll')">
      <i-mdi-eye class="w-3 h-3" />
    </button>
  </div>
</template>

<style scoped>
.legend-bar {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
  flex-wrap: wrap;
  min-height: 1.75rem;
  font-size: 0.8125rem;
  overflow: hidden;
}
.legend-dark {
  border-bottom-color: rgba(255, 255, 255, 0.04);
}

/* OHLCV */
.ohlcv {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  white-space: nowrap;
}

.ohlcv-label {
  font-weight: 700;
  font-size: 0.6875rem;
  color: rgba(0, 0, 0, 0.3);
}
.legend-dark .ohlcv-label {
  color: rgba(255, 255, 255, 0.25);
}

.ohlcv-val {
  font-family: monospace;
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.65);
}
.legend-dark .ohlcv-val {
  color: rgba(255, 255, 255, 0.7);
}
.ohlcv-high {
  color: #26a69a !important;
}
.ohlcv-low {
  color: #ef5350 !important;
}

.ohlcv-change {
  font-family: monospace;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0 0.25rem;
  border-radius: 0.1875rem;
}
.ohlcv-change.positive {
  color: #26a69a;
  background: rgba(38, 166, 154, 0.08);
}
.ohlcv-change.negative {
  color: #ef5350;
  background: rgba(239, 83, 80, 0.08);
}

.ohlcv-volume .ohlcv-val {
  color: rgba(99, 102, 241, 0.7);
}

/* Separator */
.legend-sep {
  width: 1px;
  height: 0.75rem;
  background: rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
  margin: 0 0.125rem;
}
.legend-dark .legend-sep {
  background: rgba(255, 255, 255, 0.08);
}

/* Chips */
.legend-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.1875rem;
  padding: 0.0625rem 0.375rem;
  border-radius: 0.25rem;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: all 0.1s;
  white-space: nowrap;
  color: inherit;
  font-size: 0.75rem;
}
.legend-chip:hover {
  background: rgba(0, 0, 0, 0.04);
}
.legend-dark .legend-chip:hover {
  background: rgba(255, 255, 255, 0.04);
}
.legend-chip.off {
  opacity: 0.3;
}

.chip-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid;
}

.chip-name {
  font-weight: 500;
  color: rgba(0, 0, 0, 0.6);
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.legend-dark .chip-name {
  color: rgba(255, 255, 255, 0.6);
}

.chip-value {
  font-family: monospace;
  font-weight: 600;
  font-size: 0.6875rem;
  color: rgba(0, 0, 0, 0.45);
}
.legend-dark .chip-value {
  color: rgba(255, 255, 255, 0.45);
}

.indicator-chip .chip-name {
  max-width: 60px;
}

.expand-chip {
  font-weight: 700;
  font-size: 0.5625rem;
  color: rgba(99, 102, 241, 0.7);
  padding: 0.0625rem 0.25rem;
}
.expand-chip:hover {
  background: rgba(99, 102, 241, 0.08);
}

/* Trade legend markers */
.trade-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.6875rem;
  color: rgba(0, 0, 0, 0.45);
  white-space: nowrap;
}
.legend-dark .trade-legend-item {
  color: rgba(255, 255, 255, 0.4);
}
.tl-marker {
  width: 0.625rem;
  height: 0.625rem;
  flex-shrink: 0;
  border: 1.5px solid #000;
}
.tl-circle {
  border-radius: 50%;
}
.tl-square {
  border-radius: 1px;
}
.tl-triangle {
  border: none;
  width: 0;
  height: 0;
  border-left: 0.3rem solid transparent;
  border-right: 0.3rem solid transparent;
}
.tl-sig-entry {
  background: #00e676;
  opacity: 0.35;
}
.tl-sig-exit {
  background: #ff1744;
  opacity: 0.35;
}
.tl-entry.tl-circle,
.tl-entry.tl-square {
  background: #0066ff;
}
.tl-entry.tl-triangle {
  border-top: 0.5rem solid #0066ff;
}
.tl-dca {
  background: #7b1fa2;
}
.tl-win {
  background: #00e676;
}
.tl-loss {
  background: #ff1744;
}

/* Show all */
.legend-show-all {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.125rem;
  height: 1.125rem;
  border-radius: 0.25rem;
  border: none;
  background: transparent;
  color: rgba(0, 0, 0, 0.25);
  cursor: pointer;
  transition: all 0.15s;
  margin-left: auto;
  flex-shrink: 0;
}
.legend-show-all:hover {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.5);
}
.legend-dark .legend-show-all {
  color: rgba(255, 255, 255, 0.2);
}
.legend-dark .legend-show-all:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.5);
}
</style>
