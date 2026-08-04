import type { Order, PairHistory, Trade, BTOrder } from '@/types';

import type {
  MarkAreaComponentOption,
  MarkLineComponentOption,
  MarkPointComponentOption,
  ScatterSeriesOption,
} from 'echarts';

// ── Marker types ──
type MarkerKind = 'entry' | 'exit-win' | 'exit-loss' | 'dca';

// ── Colors ──
const COLOR_ENTRY = '#0066FF';
const COLOR_DCA = '#7B1FA2';
const COLOR_EXIT_WIN = '#00E676';
const COLOR_EXIT_LOSS = '#FF1744';
const COLOR_BORDER = '#000000';

// ── Symbols ──
const SYM_CIRCLE = 'circle';
const SYM_TRIANGLE = 'path://M0,-8 L7,6 L-7,6 Z';
const SYM_SQUARE = 'rect';

function markerSymbol(isShort: boolean, kind: MarkerKind): string {
  if (kind === 'dca') return SYM_SQUARE;
  return isShort ? SYM_TRIANGLE : SYM_CIRCLE;
}

function markerColor(kind: MarkerKind): string {
  switch (kind) {
    case 'entry':
      return COLOR_ENTRY;
    case 'dca':
      return COLOR_DCA;
    case 'exit-win':
      return COLOR_EXIT_WIN;
    case 'exit-loss':
      return COLOR_EXIT_LOSS;
  }
}

function markerSize(_kind: MarkerKind): number {
  return 10;
}

// ── Tooltip builders ──

function fmtDuration(openTs: number, closeTs: number): string {
  const mins = Math.floor((closeTs - openTs) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
}

function buildEntryTooltip(trade: Trade, order: Order | BTOrder, quoteCurrency: string): string {
  const side = trade.is_short ? 'Short' : 'Long';
  const cost = 'cost' in order ? order.cost : order.amount * order.safe_price;
  const lines = [
    `${side} Entry · ${trade.pair?.split('/')[0] ?? ''}/${quoteCurrency}`,
    `Prix: ${formatPriceCurrency(order.safe_price, quoteCurrency)}${trade.leverage && trade.leverage > 1 ? ` | ${trade.leverage}×` : ''}`,
    `Stake: ${formatPriceCurrency(cost, quoteCurrency)}`,
  ];
  if (trade.profit_ratio != null && trade.profit_abs != null) {
    const sign = trade.profit_ratio >= 0 ? '+' : '';
    lines.push(
      `P&L: ${sign}${formatPriceCurrency(trade.profit_abs, quoteCurrency)} (${sign}${(trade.profit_ratio * 100).toFixed(2)}%)`,
    );
  }
  const ts =
    order.order_filled_timestamp ??
    ('order_timestamp' in order ? order.order_timestamp : trade.open_timestamp);
  lines.push(fmtTs(ts));
  if (trade.enter_tag) lines.push(`Tag: ${trade.enter_tag}`);
  return lines.join('<br>');
}

function buildExitTooltip(trade: Trade, order: Order | BTOrder, quoteCurrency: string): string {
  const side = trade.is_short ? 'Short' : 'Long';
  const lines = [
    `${side} Exit · ${trade.pair?.split('/')[0] ?? ''}/${quoteCurrency}`,
    `Prix: ${formatPriceCurrency(order.safe_price, quoteCurrency)}`,
  ];
  if (trade.profit_ratio != null && trade.profit_abs != null) {
    const sign = trade.profit_ratio >= 0 ? '+' : '';
    lines.push(
      `P&L: ${sign}${formatPriceCurrency(trade.profit_abs, quoteCurrency)} (${sign}${(trade.profit_ratio * 100).toFixed(2)}%)`,
    );
  }
  if (trade.open_timestamp && trade.close_timestamp) {
    lines.push(`Durée: ${fmtDuration(trade.open_timestamp, trade.close_timestamp)}`);
  }
  const ts = order.order_filled_timestamp ?? trade.close_timestamp ?? 0;
  if (ts) lines.push(fmtTs(ts));
  if (trade.exit_reason) lines.push(`Exit: ${trade.exit_reason}`);
  return lines.join('<br>');
}

function buildDcaTooltip(
  trade: Trade,
  order: Order | BTOrder,
  quoteCurrency: string,
  orderIndex: number,
): string {
  const side = trade.is_short ? 'Short' : 'Long';
  const cost = 'cost' in order ? order.cost : order.amount * order.safe_price;
  const lines = [
    `${side} DCA #${orderIndex} · ${trade.pair?.split('/')[0] ?? ''}/${quoteCurrency}`,
    `Prix: ${formatPriceCurrency(order.safe_price, quoteCurrency)}`,
    `Stake: ${formatPriceCurrency(cost, quoteCurrency)}`,
  ];
  if (trade.profit_ratio != null && trade.profit_abs != null) {
    const sign = trade.profit_ratio >= 0 ? '+' : '';
    lines.push(
      `P&L cumulé: ${sign}${formatPriceCurrency(trade.profit_abs, quoteCurrency)} (${sign}${(trade.profit_ratio * 100).toFixed(2)}%)`,
    );
  }
  const ts =
    order.order_filled_timestamp ??
    ('order_timestamp' in order ? order.order_timestamp : trade.open_timestamp);
  lines.push(fmtTs(ts));
  if ('ft_order_tag' in order && order.ft_order_tag) lines.push(`Tag: ${order.ft_order_tag}`);
  return lines.join('<br>');
}

/** Return trade entries for charting */
function getTradeEntries(dataset: PairHistory, trades: Trade[]) {
  // Return schema:
  // 0: Timeframe
  // 1: rate
  // 2: symbol
  // 3: symbolRotate (unused now, kept for compat)
  // 4: color
  // 5: label
  // 6: tooltip (HTML)
  // 7: opacity
  // 8: symbolSize
  // 9: borderColor
  // 10: borderWidth
  const tradeData: (number | string)[][] = [];
  const stop_ts_adjusted = dataset.data_stop_ts + dataset.timeframe_ms;
  for (const trade of trades) {
    const openTs = trade.open_fill_timestamp ?? trade.open_timestamp;
    if (
      roundTimeframe(dataset.timeframe_ms ?? 0, trade.open_timestamp) <= stop_ts_adjusted ||
      !trade.close_timestamp ||
      (trade.close_timestamp && trade.close_timestamp >= dataset.data_start_ts)
    ) {
      if (trade.orders) {
        for (const [j, order] of trade.orders.entries()) {
          const orderTs =
            order.order_filled_timestamp ??
            ('order_timestamp' in order ? order.order_timestamp : trade.open_timestamp);
          const { quoteCurrency } = splitTradePair(trade.quote_currency ?? trade.pair ?? '');
          if (
            orderTs &&
            roundTimeframe(dataset.timeframe_ms ?? 0, orderTs) <= stop_ts_adjusted &&
            orderTs > dataset.data_start_ts
          ) {
            if (j === 0) {
              // ── Entry ──
              const kind: MarkerKind = 'entry';
              tradeData.push([
                roundTimeframe(dataset.timeframe_ms ?? 0, openTs),
                order.safe_price,
                markerSymbol(trade.is_short, kind),
                0,
                markerColor(kind),
                (trade.is_short ? 'Short' : 'Long') +
                  (!order.order_filled_timestamp ? ' (open)' : ''),
                buildEntryTooltip(trade, order, quoteCurrency),
                1.0,
                markerSize(kind),
                COLOR_BORDER,
                2,
              ]);
            } else if (j === trade.orders.length - 1 && trade.close_timestamp) {
              // ── Exit ──
              if (
                roundTimeframe(dataset.timeframe_ms ?? 0, trade.close_timestamp) <=
                  stop_ts_adjusted &&
                trade.close_timestamp > dataset.data_start_ts &&
                trade.is_open === false
              ) {
                const isWin = (trade.profit_ratio ?? 0) >= 0;
                const kind: MarkerKind = isWin ? 'exit-win' : 'exit-loss';
                tradeData.push([
                  roundTimeframe(dataset.timeframe_ms ?? 0, trade.close_timestamp),
                  order.safe_price,
                  markerSymbol(trade.is_short, kind),
                  0,
                  markerColor(kind),
                  formatPercent(trade.profit_ratio, 2),
                  buildExitTooltip(trade, order, quoteCurrency),
                  1.0,
                  markerSize(kind),
                  COLOR_BORDER,
                  2,
                ]);
              }
            } else {
              // ── DCA / Position adjustment ──
              if (
                order.ft_order_side !== 'stoploss' ||
                ('filled' in order && (order.filled ?? 0) > 0)
              ) {
                const kind: MarkerKind = 'dca';
                tradeData.push([
                  roundTimeframe(dataset.timeframe_ms ?? 0, orderTs),
                  order.safe_price,
                  markerSymbol(trade.is_short, kind),
                  0,
                  markerColor(kind),
                  `DCA #${j}`,
                  buildDcaTooltip(trade, order, quoteCurrency, j),
                  1.0,
                  markerSize(kind),
                  COLOR_BORDER,
                  2,
                ]);
              }
            }
          }
        }
      }
    }
  }
  return { tradeData };
}

/**
 *  Generate Series displaying trades
 *  This may include trades, orders, and eventually other things related to the trade.
 */
export interface TradeSeriesOptions {
  showLiquidation?: boolean;
  showInitialStoploss?: boolean;
  showLeverage?: boolean;
}

export function generateTradeSeries(
  nameTrades: string,
  theme: string,
  dataset: PairHistory,
  trades: Trade[],
  options: TradeSeriesOptions = {},
): ScatterSeriesOption[] {
  const { tradeData } = getTradeEntries(dataset, trades);

  const openTrade = trades.find((t) => t.is_open);

  if (options.showLeverage) {
    for (const td of tradeData) {
      const label = td[5] as string;
      if (
        label &&
        (label.startsWith('Long') || label.startsWith('Short')) &&
        !label.includes('×')
      ) {
        const trade = trades.find(
          (t) =>
            t.leverage && t.leverage > 1 && (t.open_fill_timestamp ?? t.open_timestamp) != null,
        );
        if (trade) {
          td[5] = `${label} ×${trade.leverage}`;
        }
      }
    }
  }

  const tradesSeries: ScatterSeriesOption = {
    name: nameTrades,
    type: 'scatter',
    xAxisIndex: 0,
    yAxisIndex: 0,
    encode: {
      x: 0,
      y: 1,
      label: 5,
    },
    label: {
      show: true,
      fontSize: 11,
      backgroundColor: theme !== 'dark' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)',
      padding: [2, 4],
      color: theme === 'dark' ? '#fff' : '#000',
      rotate: 75,
      offset: [10, 0],
      align: 'left',
      borderRadius: 2,
    },
    itemStyle: {
      color: (v) => (v.data ? v.data[4] : '#000'),
      borderColor: COLOR_BORDER,
      borderWidth: 1.5,
    },
    tooltip: {
      show: true,
      trigger: 'item',
      renderMode: 'html',
      formatter: (params: any) => params.data?.[6] ?? '',
      extraCssText: 'max-width: 300px; line-height: 1.6; font-size: 12px; padding: 8px 12px;',
      backgroundColor: theme === 'dark' ? 'rgba(15, 15, 25, 0.95)' : 'rgba(255, 255, 255, 0.97)',
      borderColor: theme === 'dark' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(0, 0, 0, 0.1)',
      textStyle: {
        color: theme === 'dark' ? '#e0e0e0' : '#333',
        fontSize: 12,
      },
    },
    emphasis: {
      scale: 1.8,
      itemStyle: { borderWidth: 2 },
    },
    z: 20,
    symbol: (v) => v[2],
    symbolSize: 10,
    data: tradeData,
  };

  const result: ScatterSeriesOption[] = [tradesSeries];

  if (openTrade) {
    const offset = dataset.timeframe_ms * 10;
    const xStart =
      dataset.data_stop_ts - offset > openTrade.open_timestamp
        ? openTrade.open_timestamp
        : dataset.data_stop_ts - offset;
    const xEnd = openTrade.close_timestamp ?? dataset.data_stop_ts + dataset.timeframe_ms;

    const markLineData: MarkLineComponentOption['data'] = [];

    // Current stoploss
    if (openTrade.stop_loss_abs != null && openTrade.stop_loss_abs !== 0) {
      const slDist = openTrade.stoploss_current_dist_pct;
      const slLabel = slDist != null ? `SL ${slDist.toFixed(1)}%` : 'Stoploss';
      markLineData.push([
        {
          name: slLabel,
          yAxis: openTrade.stop_loss_abs,
          lineStyle: { color: '#ff0000AA', type: 'solid', width: 2 },
          xAxis: xStart,
          label: {
            show: true,
            formatter: slLabel,
            color: '#ff4444',
            fontSize: 10,
            fontWeight: 'bold',
            backgroundColor: theme === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.9)',
            padding: [2, 6],
            borderRadius: 3,
          },
        },
        {
          lineStyle: { color: '#ff0000AA', type: 'solid', width: 2 },
          yAxis: openTrade.stop_loss_abs,
          xAxis: xEnd,
        },
      ]);
    }

    // Initial stoploss
    if (
      options.showInitialStoploss &&
      openTrade.initial_stop_loss_abs &&
      openTrade.initial_stop_loss_abs !== openTrade.stop_loss_abs
    ) {
      markLineData.push([
        {
          name: 'Initial SL',
          yAxis: openTrade.initial_stop_loss_abs,
          lineStyle: { color: 'rgba(180,180,180,0.5)', type: 'dashed', width: 1 },
          xAxis: xStart,
          label: {
            show: true,
            formatter: 'Init SL',
            color: 'rgba(160,160,160,0.7)',
            fontSize: 9,
          },
        },
        {
          lineStyle: { color: 'rgba(180,180,180,0.5)', type: 'dashed', width: 1 },
          yAxis: openTrade.initial_stop_loss_abs,
          xAxis: xEnd,
        },
      ]);
    }

    // Liquidation price — full-width dotted line with label on the right edge
    if (options.showLiquidation && openTrade.liquidation_price) {
      markLineData.push({
        name: 'Liquidation',
        yAxis: openTrade.liquidation_price,
        lineStyle: { color: '#ff0066', type: 'dashed', width: 1.5, opacity: 0.7 },
        label: {
          show: true,
          position: 'insideEndTop',
          formatter: `Liquidation à ${formatPrice(openTrade.liquidation_price)}`,
          color: '#ff0066',
          fontSize: 10,
          fontWeight: 'bold',
          backgroundColor: theme === 'dark' ? 'rgba(40,0,20,0.85)' : 'rgba(255,230,240,0.95)',
          padding: [3, 8],
          borderRadius: 3,
        },
      });
    }

    if (markLineData.length > 0) {
      result.push({
        type: 'scatter',
        symbol: 'none',
        xAxisIndex: 0,
        yAxisIndex: 0,
        tooltip: { show: false },
        silent: true,
        z: 19,
        data: [],
        markLine: {
          symbol: 'none',
          label: { show: true, position: 'middle' },
          data: markLineData,
        },
      });
    }
  }

  return result;
}

export function generateMarkArea(
  dataset: PairHistory,
  enabled: boolean,
  markAreaZIndex?: number | undefined,
): {
  markArea?: MarkAreaComponentOption;
  markLine?: MarkLineComponentOption;
  markPoint?: MarkPointComponentOption;
} {
  if (!dataset.annotations || !enabled) return {};

  const markArea: MarkAreaComponentOption = {
    label: {
      position: 'insideTop',
    },
    z: markAreaZIndex ?? 1,
    data: dataset.annotations
      .filter((area) => area.type === 'area')
      .map((area) => {
        return [
          {
            z2: area.z_index ?? 1,
            xAxis: area.start,
            yAxis: area.y_start,
            itemStyle: {
              color: area.color,
            },
            label: {
              formatter: area.label,
            },
          },
          {
            z2: area.z_index ?? 1,
            xAxis: area.end,
            yAxis: area.y_end,
          },
        ];
      }),
  };
  const markLine: MarkLineComponentOption = {
    label: {
      position: 'middle',
    },
    symbol: ['none', 'none'],
    z: markAreaZIndex ?? 1,
    data: dataset.annotations
      .filter((line) => line.type === 'line')
      .map((line) => {
        return [
          {
            name: line.label,
            xAxis: line.start,
            yAxis: line.y_start,
            lineStyle: {
              color: line.color,
              width: line.width ?? 1,
              type: line.line_style ?? 'solid',
            },
            z2: line.z_index ?? 1,
          },
          {
            xAxis: line.end,
            yAxis: line.y_end,
            z2: line.z_index ?? 1,
          },
        ];
      }),
  };

  const markPoint: MarkPointComponentOption = {
    label: {
      position: 'top',
      show: true,
    },
    z: markAreaZIndex ? markAreaZIndex : 5,
    data: dataset.annotations
      .filter((point) => point.type === 'point')
      .map((point) => {
        return {
          name: point.label ?? '',
          xAxis: point.x,
          yAxis: point.y,
          itemStyle: {
            color: point.color,
          },
          label: {
            formatter: '{b}',
          },
          symbolSize: point.size ?? 10,
          symbol: point.shape ?? 'circle',
          symbolRotate: point.rotate,
          z2: point.z_index ?? 1,
        };
      }),
  };
  return {
    markArea,
    markLine,
    markPoint,
  };
}

export function generateMarkAreaSeries(
  dataset: PairHistory,
  enabled: boolean,
  markAreaZIndex?: number | undefined,
): ScatterSeriesOption | undefined {
  if (!dataset.annotations || !enabled) {
    return undefined;
  }
  // Invisible series added to chart to work around marklines bug
  // TODO: https://github.com/apache/echarts/issues/21300
  return {
    // Invisible
    type: 'scatter',
    symbol: 'none',
    xAxisIndex: 0,
    ...generateMarkArea(dataset, enabled, markAreaZIndex),
  };
}
