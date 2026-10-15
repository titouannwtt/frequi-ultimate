<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { markRaw } from 'vue';
import type { EChartsOption } from 'echarts';
import { BarChart, CandlestickChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from 'echarts/components';
import { init, registerTheme, use, type ECharts } from 'echarts/core';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { buildChartTheme, readChartTokensFor } from './lib/chartTheme';
import { useDocumentAppearance } from './lib/useDocumentTheme';

use([
  LineChart,
  BarChart,
  CandlestickChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent,
  MarkAreaComponent,
  AxisPointerComponent,
  CanvasRenderer,
  SVGRenderer,
]);

/**
 * ECharts wrapper (docs/redesign/02-design.md, sections 5.1, 6.6 and 9).
 *
 * - The theme is built from the CSS tokens of the requested mode and registered per mode and
 *   palette (`fq-dark`, `fq-light-cvd`...); the instance is disposed and created again when the
 *   theme, the colour-blind palette or the renderer changes (ECharts themes are fixed at init).
 * - The instance is `markRaw`: Vue must never make it reactive.
 * - Updates merge by `id` and replace the series (`replaceMerge`), with animation off: charts do
 *   not animate on each live delta.
 */
const props = withDefaults(
  defineProps<{
    option: EChartsOption;
    /** Theme name; by default the current document theme. */
    theme?: 'dark' | 'light';
    renderer?: 'canvas' | 'svg';
    /** Components replaced (not merged) on update; series with an `id` are matched by it. */
    replaceMerge?: string[];
    /** Animate the update. Off for live deltas; turn on for the first render of an equity curve. */
    animate?: boolean;
    height?: string;
    /** Accessible description of the chart. */
    label?: string;
  }>(),
  { renderer: 'canvas', replaceMerge: () => ['series'], animate: false, height: '100%' },
);

const emit = defineEmits<{ ready: [chart: ECharts] }>();

const { theme: docTheme, cvd } = useDocumentAppearance();
const el = ref<HTMLElement | null>(null);
const chart = shallowRef<ECharts | null>(null);
let observer: ResizeObserver | undefined;

function resolvedTheme(): 'dark' | 'light' {
  return props.theme ?? docTheme.value;
}

function themeName(): string {
  return `fq-${resolvedTheme()}${cvd.value ? '-cvd' : ''}`;
}

function create() {
  if (!el.value) {
    return;
  }
  const name = themeName();
  // Tokens are read for the requested mode, even when `theme` differs from the document's
  registerTheme(name, buildChartTheme(readChartTokensFor(resolvedTheme())));
  const instance = markRaw(init(el.value, name, { renderer: props.renderer }));
  chart.value = instance;
  apply();
  emit('ready', instance);
}

function dispose() {
  chart.value?.dispose();
  chart.value = null;
}

function apply() {
  chart.value?.setOption(
    { ...props.option, animation: props.animate },
    { notMerge: false, replaceMerge: props.replaceMerge, lazyUpdate: true },
  );
}

onMounted(() => {
  create();
  if (typeof ResizeObserver !== 'undefined' && el.value) {
    observer = new ResizeObserver(() => chart.value?.resize());
    observer.observe(el.value);
  }
});

watch(() => props.option, apply, { deep: false });

// A new theme, palette or renderer needs a new instance
watch([resolvedTheme, cvd, () => props.renderer], () => {
  dispose();
  create();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  dispose();
});

defineExpose({ chart });
</script>

<template>
  <div ref="el" class="chart" :style="{ height }" role="img" :aria-label="label"></div>
</template>

<style scoped>
.chart {
  width: 100%;
  min-height: 0;
}
</style>
