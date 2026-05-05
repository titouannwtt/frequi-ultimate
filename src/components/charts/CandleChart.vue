<script setup lang="ts">
import type { ChartSliderPosition, IndicatorConfig, PairHistory, PlotConfig, Trade } from '@/types';
import { ChartType } from '@/types';

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
}>();

const isLabelLeft = computed(() => props.labelSide === 'left');
// Chart default options
const MARGINLEFT = isLabelLeft.value ? '5.5%' : '1%';
const MARGINRIGHT = isLabelLeft.value ? '1%' : '5.5%';
const NAMEGAP = 55;
const SUBPLOTHEIGHT = 8; // Value in %
// minimal helpers for debugging
const showAxisLine = false;

// Candle Colors — TradingView-style
const upColor = props.colorUp;
const upBorderColor = props.colorUp;
const downColor = props.colorDown;
const downBorderColor = props.colorDown;

// Signal Colors — cleaner TradingView-inspired palette
const buySignalColor = '#26a69a';        // Long entry: teal green
const shortEntrySignalColor = '#ef5350'; // Short entry: warm red
const sellSignalColor = '#ff9800';       // Long exit: amber
const shortexitSignalColor = '#ff9800';  // Short exit: amber

const candleChart = useTemplateRef<InstanceType<typeof ECharts>>('candleChart');
const chartOptions = shallowRef<EChartsOption>({});

const strategy = computed(() => {
  return props.dataset ? props.dataset.strategy : '';
});

const pair = computed(() => {
  return props.dataset ? props.dataset.pair : '';
});

const timeframe = computed(() => {
  return props.dataset ? props.dataset.timeframe : '';
});

const hasData = computed(() => {
  return props.dataset !== null && typeof props.dataset === 'object';
});

const filteredTrades = computed(() => {
  return props.trades.filter((item: Trade) => item.pair === pair.value);
});

const chartTitle = computed(() => {
  return `${strategy.value} - ${pair.value} - ${timeframe.value}`;
});

const diffCols = computed(() => {
  return getDiffColumnsFromPlotConfig(props.plotConfig);
});

usePercentageTool(
  candleChart,
  toRef(() => props.theme),
  toRef(() => props.dataset.timeframe_ms),
);

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

function updateChart(initial = false) {
  if (!hasData.value) {
    return;
  }
  if (chartOptions.value?.title) {
    chartOptions.value.title[0].text = chartTitle.value;
  }
  // Avoid mutation of dataset.columns array
  const columns = props.dataset.columns.slice();

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
    // Only set zoom once ...
    if (initial) {
      // Add 2 candles to the initial zoom to allow for a "scroll past" effect
      const startingZoom = (1 - (props.startCandleCount + 2) / props.dataset.length) * 100;
      chartOptions.value.dataZoom.forEach((el, i) => {
        if (chartOptions.value && chartOptions.value.dataZoom) {
          chartOptions.value.dataZoom[i].start = startingZoom;
        }
      });
    } else {
      // Remove start/end settings after chart initialization to avoid chart resetting
      chartOptions.value.dataZoom.forEach((el, i) => {
        if (chartOptions.value && chartOptions.value.dataZoom) {
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
      // Enhance dataset with diff columns for area plots
      dataset = calculateDiff(columns, dataset, colFrom, colTo);
    }
  });
  // Filter out simultaneous entry/exit signals on the same candle
  if (props.hideSimultaneousEntryExit) {
    const longEntry = colEntryData >= 0 ? colEntryData : -1;
    const longExit = colExitData >= 0 ? colExitData : -1;
    const shortEntry = colShortEntryData >= 0 ? colShortEntryData : -1;
    const shortExit = colShortExitData >= 0 ? colShortExitData : -1;
    for (const row of dataset) {
      // Long: if both entry and exit signal on same candle, hide both
      if (longEntry >= 0 && longExit >= 0 && row[longEntry] && row[longExit]) {
        row[longEntry] = null;
        row[longExit] = null;
      }
      // Short: if both entry and exit signal on same candle, hide both
      if (shortEntry >= 0 && shortExit >= 0 && row[shortEntry] && row[shortExit]) {
        row[shortEntry] = null;
        row[shortExit] = null;
      }
    }
  }
  // Add new rows to end to allow slight "scroll past"
  const scrollPastLength = 5;
  const lastColDate = dataset[dataset.length - 1]?.[colDate];
  if (lastColDate) {
    const newArray = Array(scrollPastLength);
    newArray[colDate] = lastColDate + props.dataset.timeframe_ms * scrollPastLength;
    dataset.push(newArray);
  }

  const options: EChartsOption = {
    dataset: {
      source: dataset,
    },
    grid: [
      {
        left: MARGINLEFT,
        right: MARGINRIGHT,
        // Grid Layout from bottom to top
        bottom: `${subplotCount * SUBPLOTHEIGHT + 2}%`,
      },
      {
        // Volume
        left: MARGINLEFT,
        right: MARGINRIGHT,
        // Grid Layout from bottom to top
        bottom: `${subplotCount * SUBPLOTHEIGHT}%`,
        height: `${SUBPLOTHEIGHT}%`,
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
          // open, close, low, high
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
          y: colVolume,
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
        axisPointer: {
          label: { show: false },
        },
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
        axisPointer: {
          label: { show: false },
        },
        splitLine: { show: false },
        splitNumber: 20,
        min: 'dataMin',
        max: 'dataMax',
      },
    ],
    yAxis: [
      {
        scale: true,
        max: (value) => {
          return formatDecimal(value.max + (value.max - value.min) * 0.02);
        },
        min: (value) => {
          return formatDecimal(value.min - (value.max - value.min) * 0.04);
        },
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
        name: 'volume',
        nameLocation: 'middle',
        position: props.labelSide,
        nameGap: NAMEGAP,
        axisLabel: { show: false },
        axisLine: { show: showAxisLine },
        axisTick: { show: false },
        splitLine: { show: false },
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
        symbol: 'triangle',
        symbolSize: 10,
        color: buySignalColor,
        tooltipPrefix: 'Long entry',
        colTooltip: colEnterTag,
      },
      {
        colData: colExitData,
        name: 'Exit',
        symbol: 'diamond',
        symbolSize: 8,
        color: sellSignalColor,
        tooltipPrefix: 'Long exit',
        colTooltip: colExitTag,
      },
      {
        colData: colShortEntryData,
        name: 'Entry',
        symbol: 'triangle',
        symbolSize: 10,
        symbolRotate: 180,
        color: shortEntrySignalColor,
        tooltipPrefix: 'Short entry',
        colTooltip: colEnterTag,
      },
      {
        colData: colShortExitData,
        name: 'Exit',
        symbol: 'pin',
        symbolSize: 8,
        color: shortexitSignalColor,
        tooltipPrefix: 'Short exit',
        colTooltip: colExitTag,
      },
    ];

    for (const signal of signalConfigs) {
      if (signal.colData >= 0) {
        options.series.push({
          name: signal.name,
          type: 'scatter',
          symbol: signal.symbol,
          symbolSize: signal.symbolSize,
          symbolRotate: signal.symbolRotate ?? 0,
          xAxisIndex: 0,
          yAxisIndex: 0,
          itemStyle: {
            color: signal.color,
          },
          tooltip: {
            valueFormatter: (value) => {
              if (Array.isArray(value)) {
                if (value.length > 0 && value[0]) {
                  // If tag column number get's too high, we get the full list as second argument (for no good reason)
                  const tag = Array.isArray(value[1])
                    ? value[1][signal.colTooltip]?.toString()
                    : value[1]?.toString();
                  const tagShort = tag.substring(0, 100);

                  // Show both value and tag
                  return `${signal.tooltipPrefix} ${value[0]} ${tagShort ? `(${tagShort})` : ''}`;
                }
                // fall back to empty output if tag ain't set.
                return '';
              }
              // Fallback for single value
              return value ? `${signal.tooltipPrefix} ${value}` : '';
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
        if (Array.isArray(options.series)) {
          options.series.push(generateCandleSeries(colDate, col, key, value));

          if (value.fill_to) {
            // Assign
            const fillColKey = `${key}-${value.fill_to}`;
            const fillCol = columns.findIndex((el) => el === fillColKey);
            const fillValue: IndicatorConfig = {
              color: value.color,
              type: ChartType.line,
            };
            const areaSeries = generateAreaCandleSeries(colDate, fillCol, key, fillValue, 0);

            const currentSeries = options.series[options.series.length - 1];
            if (currentSeries) {
              currentSeries['stack'] = key;
            }
            options.series.push(areaSeries);
          }
          options.series.splice(options.series.length - 1, 0);
        }
      } else {
        console.log(`element ${key} for main plot not found in columns.`);
      }
    });
  }

  // START Subplots
  if ('subplots' in props.plotConfig) {
    let plotIndex = 2;
    Object.entries(props.plotConfig.subplots).forEach(([key, value]) => {
      // define yaxis

      // Subplots are added from bottom to top - only the "bottom-most" plot stays at the bottom.
      // const currGridIdx = totalSubplots - plotIndex > 1 ? totalSubplots - plotIndex : plotIndex;
      const currGridIdx = plotIndex;
      if (Array.isArray(options.yAxis) && options.yAxis.length <= plotIndex) {
        options.yAxis.push({
          scale: true,
          gridIndex: currGridIdx,
          name: key,
          position: props.labelSide,
          nameLocation: 'middle',
          nameGap: NAMEGAP,
          axisLabel: {
            show: true,
            hideOverlap: true,
            overflow: 'truncate',
          },
          axisLine: { show: showAxisLine },
          axisTick: { show: false },
          splitLine: { show: false },
        });
      }
      if (Array.isArray(options.xAxis) && options.xAxis.length <= plotIndex) {
        options.xAxis.push({
          type: 'time',
          gridIndex: currGridIdx,
          axisLine: { onZero: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          axisPointer: {
            label: { show: false },
          },
          splitLine: { show: false },
          splitNumber: 20,
        });
      }
      if (Array.isArray(chartOptions.value.dataZoom)) {
        // Must be set on the chartOptions object - options doesn't have dataZoom at this point
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
        // entries per subplot
        const col = columns.findIndex((el) => el === sk);
        if (col > 0) {
          addLegend(sk);
          if (options.series && Array.isArray(options.series)) {
            options.series.push(generateCandleSeries(colDate, col, sk, sv, plotIndex));
            if (sv.fill_to) {
              // Assign
              const fillColKey = `${sk}-${sv.fill_to}`;
              const fillCol = columns.findIndex((el) => el === fillColKey);
              const fillValue: IndicatorConfig = {
                color: sv.color,
                type: ChartType.line,
              };
              const areaSeries = generateAreaCandleSeries(
                colDate,
                fillCol,
                sk,
                fillValue,
                plotIndex,
              );
              const currentSeries = options.series[options.series.length - 1];
              if (currentSeries) {
                currentSeries['stack'] = sk;
              }
              options.series.push(areaSeries);
            }
            options.series.splice(options.series.length - 1, 0);
          }
        } else {
          console.log(`element ${sk} was not found in the columns.`);
        }
      });

      plotIndex += 1;
    });
  }
  // END Subplots
  // Last subplot should show xAxis labels
  // if (options.xAxis && Array.isArray(options.xAxis)) {
  //   options.xAxis[options.xAxis.length - 1].axisLabel.show = true;
  //   options.xAxis[options.xAxis.length - 1].axisTick.show = true;
  // }
  if (Array.isArray(options.grid)) {
    // Last subplot is bottom
    const localGrid = options.grid[options.grid.length - 1];
    if (localGrid) {
      // Last subplot is bottom
      localGrid.bottom = '50px';
      delete localGrid.top;
    }
  }

  const nameTrades = 'Trades';
  // Insert trades into legend, after the default columns
  addLegend(nameTrades, 4);
  const tradesSeries: ScatterSeriesOption = generateTradeSeries(
    nameTrades,
    props.theme,
    props.dataset,
    filteredTrades.value,
  );
  if (Array.isArray(options.series)) {
    options.series.push(tradesSeries);
  }

  // Merge this into original data
  Object.assign(chartOptions.value, options);
  // console.log('chartOptions', chartOptions.value);
  candleChart.value?.setOption(chartOptions.value, {
    replaceMerge: ['series', 'grid', 'yAxis', 'xAxis', 'legend'],
    notMerge: initial,
  });
}

function initializeChartOptions() {
  // Ensure we start empty.
  candleChart.value?.setOption({}, { notMerge: true });

  chartOptions.value = {
    title: [
      {
        // text: this.chartTitle,
        show: false,
      },
    ],
    backgroundColor: 'rgba(0, 0, 0, 0)',
    useUTC: props.useUTC,
    animation: true,
    animationDuration: 300,
    animationEasing: 'cubicOut',
    legend: {
      // Initial legend, further entries are pushed to the below list
      data: ['Candles', 'Volume', 'Entry', 'Exit'],
      right: '1%',
      top: 0,
      type: 'scroll',
      textStyle: {
        color: props.theme === 'dark' ? 'rgba(255,255,255,0.6)' : '#666',
        fontSize: 11,
      },
      pageTextStyle: {
        color: props.theme === 'dark' ? '#dedede' : '#333',
      },
      pageIconColor: props.theme === 'dark' ? '#aaa' : '#2f4554',
      pageIconInactiveColor: props.theme === 'dark' ? '#2f4554' : '#aaa',
    },
    tooltip: {
      show: true,
      trigger: 'axis',
      renderMode: 'richText',
      backgroundColor: props.theme === 'dark' ? 'rgba(15, 15, 25, 0.92)' : 'rgba(255, 255, 255, 0.95)',
      borderColor: props.theme === 'dark' ? 'rgba(99, 102, 241, 0.15)' : 'rgba(0, 0, 0, 0.08)',
      borderWidth: 1,
      textStyle: {
        color: props.theme === 'dark' ? '#e0e0e0' : '#333',
        fontSize: 12,
      },
      axisPointer: {
        type: 'cross',
        lineStyle: {
          color: props.theme === 'dark' ? 'rgba(165, 180, 252, 0.3)' : 'rgba(99, 102, 241, 0.2)',
          width: 1,
          opacity: 1,
        },
      },
      // positioning copied from https://echarts.apache.org/en/option.html#tooltip.position
      position(pos, params, dom, rect, size) {
        // tooltip will be fixed on the right if mouse hovering on the left,
        // and on the left if hovering on the right.
        const obj = { top: 60 };
        const mouseIsLeft = pos[0] < size.viewSize[0] / 2;
        obj[['left', 'right'][+mouseIsLeft]!] = mouseIsLeft ? 5 : 60;
        return obj;
      },
    },
    axisPointer: {
      link: [{ xAxisIndex: 'all' }],
      label: {
        backgroundColor: '#777',
      },
    },

    dataZoom: [
      // Start values are recalculated once the data is known
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        start: 80,
        end: 100,
      },
      {
        xAxisIndex: [0, 1],
        bottom: 10,
        start: 80,
        end: 100,
        ...dataZoomPartial,
      },
    ],
    // visualMap: {
    //   //  TODO: this would allow to colorize volume bars (if we'd want this)
    //   //  Needs green / red indicator column in data.
    //   show: true,
    //   seriesIndex: 1,
    //   dimension: 5,
    //   pieces: [
    //     {
    //       max: 500000.0,
    //       color: downColor,
    //     },
    //     {
    //       min: 500000.0,
    //       color: upColor,
    //     },
    //   ],
    // },
  };

  console.log('Initialized');
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

// const buyData = ref<number[][]>([]);
// const sellData = ref<number[][]>([]);
// createSignalData(colDate: number, colOpen: number, colBuy: number, colSell: number): void {
// Calculate Buy and sell Series
// if (!this.signalsCalculated) {
//   // Generate Buy and sell array (using open rate to display marker)
//   for (let i = 0, len = this.dataset.data.length; i < len; i += 1) {
//     if (this.dataset.data[i][colBuy] === 1) {
//       this.buyData.push([this.dataset.data[i][colDate], this.dataset.data[i][colOpen]]);
//     }
//     if (this.dataset.data[i][colSell] === 1) {
//       this.sellData.push([this.dataset.data[i][colDate], this.dataset.data[i][colOpen]]);
//     }
//   }
//   this.signalsCalculated = true;
// }
// }

onMounted(() => {
  initializeChartOptions();
});

watch([() => props.useUTC, () => props.theme, () => props.plotConfig], () =>
  initializeChartOptions(),
);

watch([() => props.dataset, () => props.heikinAshi, () => props.showMarkArea, () => props.hideSimultaneousEntryExit], () => updateChart());

watch(
  () => props.sliderPosition,
  () => updateSliderPosition(),
);
</script>

<template>
  <div class="h-full w-full">
    <ECharts v-if="hasData" ref="candleChart" :theme="theme" autoresize manual-update />
  </div>
</template>

<style scoped lang="css">
.echarts {
  width: 100%;
  min-height: 200px;
  /* TODO: height calculation is not working correctly - uses min-height for now */
  /* height: 600px; */
  height: 100%;
}
</style>