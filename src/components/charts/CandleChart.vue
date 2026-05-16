<script setup lang="ts">
import type { ChartSliderPosition, IndicatorConfig, PairHistory, PlotConfig, Trade } from '@/types';
import { ChartType } from '@/types';
import type { TradeSeriesOptions } from '@/utils/charts/tradeChartData';

import ECharts from 'vue-echarts';

import type { EChartsOption, ScatterSeriesOption } from 'echarts';
import { BarChart, CandlestickChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  AxisPointerComponent,
  CalendarComponent,
  DataZoomComponent,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TimelineComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
  VisualMapPiecewiseComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  GraphicComponent,
} from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

use([
  AxisPointerComponent,
  CalendarComponent,
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TimelineComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
  VisualMapPiecewiseComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,

  CandlestickChart,
  BarChart,
  LineChart,
  ScatterChart,
  CanvasRenderer,
  GraphicComponent,
]);

export interface SeriesInfo {
  name: string;
  color: string;
  type: string;
  group: 'price' | 'volume' | 'signal' | 'indicator' | 'subplot' | 'trade';
  subplotName?: string;
  visible: boolean;
}

export interface AxisPointerValues {
  dataIndex: number;
  values: Record<string, number | string | null>;
}

const props = defineProps<{
  trades: Trade[];
  dataset: PairHistory;
  heikinAshi: boolean;
  showMarkArea: boolean;
  hideSimultaneousEntryExit: boolean;
  useUTC: boolean;
  plotConfig: PlotConfig;
  theme: 'dark' | 'light';
  sliderPosition?: ChartSliderPosition;
  colorUp: string;
  colorDown: string;
  labelSide: 'left' | 'right';
  startCandleCount: number;
  volumeVisible?: boolean;
  crosshairStyle?: 'cross' | 'vertical' | 'horizontal' | 'none';
  tradeSeriesOptions?: TradeSeriesOptions;
}>();

const emit = defineEmits<{
  seriesInfo: [series: SeriesInfo[]];
  axisValues: [values: AxisPointerValues];
  subplotClick: [name: string];
}>();

const isLabelLeft = computed(() => props.labelSide === 'left');
const MARGINLEFT = isLabelLeft.value ? '5.5%' : '1%';
const MARGINRIGHT = isLabelLeft.value ? '1%' : '5.5%';
const NAMEGAP = 55;
const SUBPLOTHEIGHT = 8;
const showAxisLine = false;

const upColor = props.colorUp;
const upBorderColor = props.colorUp;
const downColor = props.colorDown;
const downBorderColor = props.colorDown;

const signalEntryColor = '#00E676';
const signalExitColor = '#FF1744';
const signalBorderColor = 'rgba(0, 0, 0, 0.35)';
const SIGNAL_OPACITY = 0.75;
const SYM_CIRCLE = 'circle';
const SYM_TRIANGLE_DOWN = 'path://M0,-8 L7,6 L-7,6 Z';

const candleChart = useTemplateRef<InstanceType<typeof ECharts>>('candleChart');
const chartOptions = shallowRef<EChartsOption>({});

const seriesRegistry = ref<SeriesInfo[]>([]);
const hiddenSeries = ref<Set<string>>(new Set());
let currentDataset: (number | string | null)[][] = [];
let currentColumns: string[] = [];

const strategy = computed(() => props.dataset?.strategy ?? '');
const pair = computed(() => props.dataset?.pair ?? '');
const timeframe = computed(() => props.dataset?.timeframe ?? '');
const hasData = computed(() => props.dataset !== null && typeof props.dataset === 'object');

const filteredTrades = computed(() =>
  props.trades.filter((item: Trade) => item.pair === pair.value),
);

const chartTitle = computed(
  () => `${strategy.value} - ${pair.value} - ${timeframe.value}`,
);

const diffCols = computed(() => getDiffColumnsFromPlotConfig(props.plotConfig));

usePercentageTool(
  candleChart,
  toRef(() => props.theme),
  toRef(() => props.dataset.timeframe_ms),
);


function registerSeries(
  name: string,
  color: string,
  type: string,
  group: SeriesInfo['group'],
  subplotName?: string,
) {
  const existing = seriesRegistry.value.find((s) => s.name === name);
  if (!existing) {
    seriesRegistry.value.push({
      name,
      color,
      type,
      group,
      subplotName,
      visible: !hiddenSeries.value.has(name),
    });
  }
}

function addLegend(name: string, position: number | undefined = undefined) {
  if (
    !chartOptions.value.legend ||
    Array.isArray(chartOptions.value.legend) ||
    !Array.isArray(chartOptions.value.legend.data)
  )
    return;
  if (!chartOptions.value.legend.data.includes(name)) {
    if (position !== undefined) {
      chartOptions.value.legend.data.splice(position, 0, name);
    } else {
      chartOptions.value.legend.data.push(name);
    }
  }
}

function toggleSeries(name: string) {
  if (hiddenSeries.value.has(name)) {
    hiddenSeries.value.delete(name);
  } else {
    hiddenSeries.value.add(name);
  }
  candleChart.value?.dispatchAction({
    type: 'legendToggleSelect',
    name,
  });
  updateSeriesVisibility();
}

function isolateSeries(name: string) {
  const allNames = seriesRegistry.value.map((s) => s.name);
  const currentlyHidden = new Set(hiddenSeries.value);
  const isAlreadyIsolated =
    allNames.filter((n) => !currentlyHidden.has(n)).length === 1 &&
    !currentlyHidden.has(name);

  if (isAlreadyIsolated) {
    hiddenSeries.value.clear();
    for (const n of allNames) {
      candleChart.value?.dispatchAction({
        type: 'legendSelect',
        name: n,
      });
    }
  } else {
    for (const n of allNames) {
      if (n === name) {
        hiddenSeries.value.delete(n);
        candleChart.value?.dispatchAction({
          type: 'legendSelect',
          name: n,
        });
      } else {
        hiddenSeries.value.add(n);
        candleChart.value?.dispatchAction({
          type: 'legendUnSelect',
          name: n,
        });
      }
    }
  }
  updateSeriesVisibility();
}

function showAllSeries() {
  hiddenSeries.value.clear();
  for (const s of seriesRegistry.value) {
    candleChart.value?.dispatchAction({
      type: 'legendSelect',
      name: s.name,
    });
  }
  updateSeriesVisibility();
}

function updateSeriesVisibility() {
  for (const s of seriesRegistry.value) {
    s.visible = !hiddenSeries.value.has(s.name);
  }
  emit('seriesInfo', [...seriesRegistry.value]);
}

function resetZoom() {
  if (!candleChart.value) return;
  candleChart.value.dispatchAction({
    type: 'dataZoom',
    start: 0,
    end: 100,
  });
}

function scrollChart(candles: number) {
  if (!candleChart.value || !Array.isArray(chartOptions.value.dataZoom)) return;
  const dz = chartOptions.value.dataZoom[0];
  if (!dz) return;
  const totalLen = currentDataset.length || 1;
  const shift = (candles / totalLen) * 100;
  const start = Math.max(0, (dz.start ?? 80) + shift);
  const end = Math.min(100, (dz.end ?? 100) + shift);
  candleChart.value.dispatchAction({
    type: 'dataZoom',
    start,
    end,
  });
}

function zoomChart(factor: number) {
  if (!candleChart.value || !Array.isArray(chartOptions.value.dataZoom)) return;
  const dz = chartOptions.value.dataZoom[0];
  if (!dz) return;
  const start = dz.start ?? 80;
  const end = dz.end ?? 100;
  const center = (start + end) / 2;
  const range = (end - start) * factor;
  const newStart = Math.max(0, center - range / 2);
  const newEnd = Math.min(100, center + range / 2);
  candleChart.value.dispatchAction({
    type: 'dataZoom',
    start: newStart,
    end: newEnd,
  });
}

function setupAxisPointerListener() {
  candleChart.value?.chart?.on('updateAxisPointer', (event: any) => {
    if (!event.axesInfo?.[0]?.value) return;
    const timestamp = event.axesInfo[0].value;
    const colDate = currentColumns.indexOf('__date_ts');
    if (colDate < 0) return;

    let closestIdx = -1;
    let closestDiff = Infinity;
    for (let i = 0; i < currentDataset.length; i++) {
      const row = currentDataset[i];
      if (!row || row[colDate] == null) continue;
      const diff = Math.abs(Number(row[colDate]) - timestamp);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
      }
    }

    if (closestIdx < 0) return;
    const row = currentDataset[closestIdx];
    if (!row) return;

    const values: Record<string, number | string | null> = {};
    for (let c = 0; c < currentColumns.length; c++) {
      values[currentColumns[c]] = row[c] ?? null;
    }
    emit('axisValues', { dataIndex: closestIdx, values });
  });
}

function updateChart(initial = false) {
  if (!hasData.value) return;

  seriesRegistry.value = [];

  if (chartOptions.value?.title) {
    chartOptions.value.title[0].text = chartTitle.value;
  }

  const columns = props.dataset.columns.slice();
  currentColumns = columns;

  const colDate = columns.findIndex((el) => el === '__date_ts');
  const colOpen = columns.findIndex((el) => el === 'open');
  const colHigh = columns.findIndex((el) => el === 'high');
  const colLow = columns.findIndex((el) => el === 'low');
  const colClose = columns.findIndex((el) => el === 'close');
  const colVolume = columns.findIndex((el) => el === 'volume');
  const colEnterTag = columns.findIndex((el) => el === 'enter_tag');
  const colExitTag = columns.findIndex((el) => el === 'exit_tag');

  const colEntryData = columns.findIndex(
    (el) => el === '_buy_signal_close' || el === '_enter_long_signal_close',
  );
  const colExitData = columns.findIndex(
    (el) => el === '_sell_signal_close' || el === '_exit_long_signal_close',
  );
  const colShortEntryData = columns.findIndex((el) => el === '_enter_short_signal_close');
  const colShortExitData = columns.findIndex((el) => el === '_exit_short_signal_close');

  const subplotCount =
    'subplots' in props.plotConfig ? Object.keys(props.plotConfig.subplots).length + 1 : 1;

  if (Array.isArray(chartOptions.value?.dataZoom)) {
    if (initial) {
      const startingZoom = (1 - (props.startCandleCount + 2) / props.dataset.length) * 100;
      chartOptions.value.dataZoom.forEach((el, i) => {
        if (chartOptions.value?.dataZoom) {
          chartOptions.value.dataZoom[i].start = startingZoom;
        }
      });
    } else {
      chartOptions.value.dataZoom.forEach((el, i) => {
        if (chartOptions.value?.dataZoom) {
          delete chartOptions.value.dataZoom[i].start;
          delete chartOptions.value.dataZoom[i].end;
        }
      });
    }
  }

  let dataset = props.heikinAshi
    ? heikinAshiDataset(columns, props.dataset.data)
    : props.dataset.data.slice();

  diffCols.value.forEach(([colFrom, colTo]) => {
    if (colFrom && colTo) {
      dataset = calculateDiff(columns, dataset, colFrom, colTo);
    }
  });

  if (props.hideSimultaneousEntryExit) {
    const longEntry = colEntryData >= 0 ? colEntryData : -1;
    const longExit = colExitData >= 0 ? colExitData : -1;
    const shortEntry = colShortEntryData >= 0 ? colShortEntryData : -1;
    const shortExit = colShortExitData >= 0 ? colShortExitData : -1;
    for (const row of dataset) {
      if (longEntry >= 0 && longExit >= 0 && row[longEntry] && row[longExit]) {
        row[longEntry] = null;
        row[longExit] = null;
      }
      if (shortEntry >= 0 && shortExit >= 0 && row[shortEntry] && row[shortExit]) {
        row[shortEntry] = null;
        row[shortExit] = null;
      }
    }
  }

  const scrollPastLength = 5;
  const lastColDate = dataset[dataset.length - 1]?.[colDate];
  if (lastColDate) {
    const newArray = Array(scrollPastLength);
    newArray[colDate] = lastColDate + props.dataset.timeframe_ms * scrollPastLength;
    dataset.push(newArray);
  }

  currentDataset = dataset;

  const volumeVisible = props.volumeVisible !== false;

  registerSeries('Candles', upColor, 'candlestick', 'price');
  registerSeries('Volume', 'rgba(120,120,140,0.5)', 'bar', 'volume');

  const options: EChartsOption = {
    dataset: { source: dataset },
    grid: [
      {
        left: MARGINLEFT,
        right: MARGINRIGHT,
        bottom: `${subplotCount * SUBPLOTHEIGHT + 2}%`,
      },
      {
        left: MARGINLEFT,
        right: MARGINRIGHT,
        bottom: `${subplotCount * SUBPLOTHEIGHT}%`,
        height: volumeVisible ? `${SUBPLOTHEIGHT}%` : '0%',
      },
    ],
    series: [
      {
        name: 'Candles',
        type: 'candlestick',
        barWidth: '65%',
        barMinWidth: 1,
        barMaxWidth: 20,
        itemStyle: {
          color: upColor,
          color0: downColor,
          borderColor: upBorderColor,
          borderColor0: downBorderColor,
          borderWidth: 1,
        },
        encode: {
          x: colDate,
          y: [colOpen, colClose, colLow, colHigh],
        },
      },
      {
        name: 'Volume',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        itemStyle: {
          color: (params) => {
            const d = params.data as number[];
            if (d && d[colOpen] !== undefined && d[colClose] !== undefined) {
              return d[colClose] >= d[colOpen]
                ? 'rgba(38, 166, 154, 0.35)'
                : 'rgba(239, 83, 80, 0.35)';
            }
            return 'rgba(120, 120, 140, 0.2)';
          },
        },
        large: true,
        encode: {
          x: colDate,
          y: volumeVisible ? colVolume : -1,
        },
      },
    ],
    xAxis: [
      {
        type: 'time',
        axisLine: { onZero: false, lineStyle: { color: props.theme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' } },
        axisTick: { show: true, lineStyle: { color: props.theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' } },
        axisLabel: {
          show: true,
          color: props.theme === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
          fontSize: 10,
        },
        axisPointer: { label: { show: false } },
        position: 'top',
        splitLine: {
          show: true,
          lineStyle: {
            color: props.theme === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)',
            type: 'dashed',
          },
        },
        splitNumber: 20,
        min: 'dataMin',
        max: 'dataMax',
      },
      {
        type: 'time',
        gridIndex: 1,
        axisLine: { onZero: false, lineStyle: { color: 'transparent' } },
        axisTick: { show: false },
        axisLabel: { show: false },
        axisPointer: { label: { show: false } },
        splitLine: { show: false },
        splitNumber: 20,
        min: 'dataMin',
        max: 'dataMax',
      },
    ],
    yAxis: [
      {
        scale: true,
        max: (value) => value.max + (value.max - value.min) * 0.02,
        min: (value) => value.min - (value.max - value.min) * 0.04,
        name: ' ',
        nameLocation: 'middle',
        nameGap: NAMEGAP,
        axisLine: { show: false },
        axisLabel: {
          hideOverlap: true,
          overflow: 'truncate',
          color: props.theme === 'dark' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)',
          fontSize: 10,
        },
        axisPointer: {
          show: true,
          label: {
            show: true,
            backgroundColor: props.theme === 'dark' ? 'rgba(99, 102, 241, 0.85)' : 'rgba(99, 102, 241, 0.9)',
            color: '#fff',
            fontSize: 10,
            padding: [4, 6],
          },
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: props.theme === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)',
            type: 'dashed',
          },
        },
        position: props.labelSide,
      },
      {
        scale: true,
        gridIndex: 1,
        splitNumber: 2,
        name: volumeVisible ? 'volume' : '',
        nameLocation: 'middle',
        position: props.labelSide,
        nameGap: NAMEGAP,
        axisLabel: { show: false },
        axisLine: { show: showAxisLine },
        axisTick: { show: false },
        splitLine: { show: false },
        axisPointer: {
          show: true,
          label: {
            show: true,
            backgroundColor: props.theme === 'dark' ? 'rgba(99, 102, 241, 0.7)' : 'rgba(99, 102, 241, 0.8)',
            fontSize: 9,
            padding: [3, 5],
          },
        },
      },
    ],
  };

  if (Array.isArray(options.series)) {
    const areaSeries = generateMarkAreaSeries(
      props.dataset,
      props.showMarkArea,
      props.plotConfig.options?.markAreaZIndex,
    );
    if (areaSeries) {
      options.series.push(areaSeries);
    }

    const signalConfigs = [
      {
        colData: colEntryData,
        name: 'Entry',
        symbol: SYM_CIRCLE,
        symbolSize: 10,
        color: signalEntryColor,
        tooltipPrefix: 'Long entry',
        colTooltip: colEnterTag,
      },
      {
        colData: colExitData,
        name: 'Exit',
        symbol: SYM_CIRCLE,
        symbolSize: 8,
        color: signalExitColor,
        tooltipPrefix: 'Long exit',
        colTooltip: colExitTag,
      },
      {
        colData: colShortEntryData,
        name: 'Entry',
        symbol: SYM_TRIANGLE_DOWN,
        symbolSize: 10,
        color: signalEntryColor,
        tooltipPrefix: 'Short entry',
        colTooltip: colEnterTag,
      },
      {
        colData: colShortExitData,
        name: 'Exit',
        symbol: SYM_TRIANGLE_DOWN,
        symbolSize: 8,
        color: signalExitColor,
        tooltipPrefix: 'Short exit',
        colTooltip: colExitTag,
      },
    ];

    for (const signal of signalConfigs) {
      if (signal.colData >= 0) {
        registerSeries(signal.name, signal.color, 'scatter', 'signal');
        options.series.push({
          name: signal.name,
          type: 'scatter',
          animation: false,
          symbol: signal.symbol,
          symbolSize: signal.symbolSize,
          xAxisIndex: 0,
          yAxisIndex: 0,
          itemStyle: {
            color: signal.color,
            opacity: SIGNAL_OPACITY,
            borderColor: signalBorderColor,
            borderWidth: 1,
          },
          tooltip: {
            formatter: (params: any) => {
              const val = params.value;
              if (!val) return '';
              const colIdx = signal.colData;
              const v = Array.isArray(val) ? val[colIdx] : val;
              if (!v) return '';
              let tag = '';
              if (signal.colTooltip >= 0 && Array.isArray(val)) {
                tag = val[signal.colTooltip]?.toString()?.substring(0, 100) ?? '';
              }
              return `${signal.tooltipPrefix}${tag ? ` · ${tag}` : ''}`;
            },
          },
          encode: {
            x: colDate,
            y: signal.colData,
            tooltip:
              signal.colTooltip >= 0 ? [signal.colData, signal.colTooltip] : [signal.colData],
          },
        });
      }
    }
  }

  if ('main_plot' in props.plotConfig) {
    Object.entries(props.plotConfig.main_plot).forEach(([key, value]) => {
      const col = columns.findIndex((el) => el === key);
      if (col > 0) {
        addLegend(key);
        registerSeries(key, value.color || '#888', value.type || 'line', 'indicator');
        if (Array.isArray(options.series)) {
          options.series.push(generateCandleSeries(colDate, col, key, value));
          if (value.fill_to) {
            const fillColKey = `${key}-${value.fill_to}`;
            const fillCol = columns.findIndex((el) => el === fillColKey);
            const fillValue: IndicatorConfig = { color: value.color, type: ChartType.line };
            const areaSeries = generateAreaCandleSeries(colDate, fillCol, key, fillValue, 0);
            const currentSeries = options.series[options.series.length - 1];
            if (currentSeries) currentSeries['stack'] = key;
            options.series.push(areaSeries);
          }
          options.series.splice(options.series.length - 1, 0);
        }
      }
    });
  }

  if ('subplots' in props.plotConfig) {
    let plotIndex = 2;
    Object.entries(props.plotConfig.subplots).forEach(([key, value]) => {
      const currGridIdx = plotIndex;
      if (Array.isArray(options.yAxis) && options.yAxis.length <= plotIndex) {
        options.yAxis.push({
          scale: true,
          gridIndex: currGridIdx,
          name: key,
          position: props.labelSide,
          nameLocation: 'middle',
          nameGap: NAMEGAP,
          triggerEvent: true,
          nameTextStyle: {
            color: 'rgba(99, 102, 241, 0.7)',
          },
          axisLabel: { show: true, hideOverlap: true, overflow: 'truncate' },
          axisLine: { show: showAxisLine },
          axisTick: { show: false },
          splitLine: { show: false },
          axisPointer: {
            show: true,
            label: {
              show: true,
              backgroundColor: props.theme === 'dark' ? 'rgba(99, 102, 241, 0.7)' : 'rgba(99, 102, 241, 0.8)',
              fontSize: 9,
              padding: [3, 5],
            },
          },
        });
      }
      if (Array.isArray(options.xAxis) && options.xAxis.length <= plotIndex) {
        options.xAxis.push({
          type: 'time',
          gridIndex: currGridIdx,
          axisLine: { onZero: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          axisPointer: { label: { show: false } },
          splitLine: { show: false },
          splitNumber: 20,
        });
      }
      if (Array.isArray(chartOptions.value.dataZoom)) {
        chartOptions.value.dataZoom.forEach((el) =>
          el.xAxisIndex && Array.isArray(el.xAxisIndex) ? el.xAxisIndex.push(plotIndex) : null,
        );
      }
      if (options.grid && Array.isArray(options.grid)) {
        options.grid.push({
          left: MARGINLEFT,
          right: MARGINRIGHT,
          bottom: `${(subplotCount - plotIndex + 1) * SUBPLOTHEIGHT}%`,
          height: `${SUBPLOTHEIGHT}%`,
        });
      }
      Object.entries(value).forEach(([sk, sv]) => {
        const col = columns.findIndex((el) => el === sk);
        if (col > 0) {
          addLegend(sk);
          registerSeries(sk, sv.color || '#888', sv.type || 'line', 'subplot', key);
          if (options.series && Array.isArray(options.series)) {
            options.series.push(generateCandleSeries(colDate, col, sk, sv, plotIndex));
            if (sv.fill_to) {
              const fillColKey = `${sk}-${sv.fill_to}`;
              const fillCol = columns.findIndex((el) => el === fillColKey);
              const fillValue: IndicatorConfig = { color: sv.color, type: ChartType.line };
              const areaSeries = generateAreaCandleSeries(colDate, fillCol, sk, fillValue, plotIndex);
              const currentSeries = options.series[options.series.length - 1];
              if (currentSeries) currentSeries['stack'] = sk;
              options.series.push(areaSeries);
            }
            options.series.splice(options.series.length - 1, 0);
          }
        }
      });
      plotIndex += 1;
    });
  }

  if (Array.isArray(options.grid)) {
    const localGrid = options.grid[options.grid.length - 1];
    if (localGrid) {
      localGrid.bottom = '50px';
      delete localGrid.top;
    }
  }

  const nameTrades = 'Trades';
  addLegend(nameTrades, 4);
  registerSeries(nameTrades, '#6366f1', 'scatter', 'trade');
  const tradeSeriesList: ScatterSeriesOption[] = generateTradeSeries(
    nameTrades,
    props.theme,
    props.dataset,
    filteredTrades.value,
    props.tradeSeriesOptions,
  );
  if (Array.isArray(options.series)) {
    options.series.push(...tradeSeriesList);
  }

  Object.assign(chartOptions.value, options);
  candleChart.value?.setOption(chartOptions.value, {
    replaceMerge: ['series', 'grid', 'yAxis', 'xAxis', 'legend'],
    notMerge: initial,
  });

  emit('seriesInfo', [...seriesRegistry.value]);

  // Re-apply hidden series after chart update
  nextTick(() => {
    for (const name of hiddenSeries.value) {
      candleChart.value?.dispatchAction({ type: 'legendUnSelect', name });
    }
  });
}

function initializeChartOptions() {
  candleChart.value?.setOption({}, { notMerge: true });

  chartOptions.value = {
    title: [{ show: false }],
    backgroundColor: 'rgba(0, 0, 0, 0)',
    useUTC: props.useUTC,
    animation: true,
    animationDuration: 300,
    animationDurationUpdate: 200,
    animationEasing: 'cubicOut',
    animationEasingUpdate: 'cubicOut',
    legend: {
      data: ['Candles', 'Volume', 'Entry', 'Exit'],
      show: false,
      right: '1%',
      top: 0,
      type: 'scroll',
    },
    tooltip: {
      show: true,
      trigger: 'axis',
      renderMode: 'html',
      backgroundColor: props.theme === 'dark' ? 'rgba(15, 15, 25, 0.92)' : 'rgba(255, 255, 255, 0.95)',
      borderColor: props.theme === 'dark' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(0, 0, 0, 0.08)',
      borderWidth: 1,
      textStyle: {
        color: props.theme === 'dark' ? '#e0e0e0' : '#333',
        fontSize: 12,
      },
      axisPointer: {
        type: 'cross',
        crossStyle: {
          color: props.theme === 'dark' ? 'rgba(165, 180, 252, 0.3)' : 'rgba(99, 102, 241, 0.2)',
          width: 1,
        },
        lineStyle: {
          color: props.theme === 'dark' ? 'rgba(165, 180, 252, 0.3)' : 'rgba(99, 102, 241, 0.2)',
          width: 1,
        },
      },
      position(pos, params, dom, rect, size) {
        const obj = { top: 60 };
        const mouseIsLeft = pos[0] < size.viewSize[0] / 2;
        obj[['left', 'right'][+mouseIsLeft]!] = mouseIsLeft ? 5 : 60;
        return obj;
      },
    },
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
      label: { backgroundColor: '#777' },
      triggerOn: 'mousemove',
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 80, end: 100 },
      { xAxisIndex: [0, 1], bottom: 10, start: 80, end: 100, ...dataZoomPartial },
    ],
  };

  updateChart(true);
}

function updateSliderPosition() {
  if (!props.sliderPosition) return;
  const start = props.sliderPosition.startValue - props.dataset.timeframe_ms * 40;
  const end = props.sliderPosition.endValue
    ? props.sliderPosition.endValue + props.dataset.timeframe_ms * 40
    : props.sliderPosition.startValue + props.dataset.timeframe_ms * 80;
  if (candleChart.value) {
    candleChart.value.dispatchAction({
      type: 'dataZoom',
      dataZoomIndex: 0,
      startValue: start,
      endValue: end,
    });
  }
}

function onChartClick(params: any) {
  if (params.componentType === 'yAxis' && params.targetType === 'axisName') {
    const name = params.value ?? params.name ?? params.event?.target?.style?.text;
    if (name) {
      emit('subplotClick', name);
    }
  }
}

onMounted(() => {
  initializeChartOptions();
  nextTick(() => {
    setupAxisPointerListener();
  });
});

watch([() => props.useUTC, () => props.theme, () => props.plotConfig, () => props.crosshairStyle], () =>
  initializeChartOptions(),
);

watch([
  () => props.dataset,
  () => props.heikinAshi,
  () => props.showMarkArea,
  () => props.hideSimultaneousEntryExit,
  () => props.volumeVisible,
  () => props.tradeSeriesOptions,
], () => updateChart());

watch(
  () => props.sliderPosition,
  () => updateSliderPosition(),
);

defineExpose({
  toggleSeries,
  isolateSeries,
  showAllSeries,
  resetZoom,
  scrollChart,
  zoomChart,
  seriesRegistry,
});
</script>

<template>
  <div class="h-full w-full">
    <ECharts v-if="hasData" ref="candleChart" :theme="theme" autoresize manual-update @click="onChartClick" />
  </div>
</template>

<style scoped lang="css">
.echarts {
  width: 100%;
  min-height: 200px;
  height: 100%;
}
</style>
