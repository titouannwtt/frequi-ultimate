import { CHART_FONT_FALLBACK, readCssToken } from '@/utils/designTokens';

/** Tokens the chart theme is built from (read from the computed style of <html>). */
export interface ChartTokens {
  fg: string;
  fg2: string;
  fg3: string;
  line: string;
  line2: string;
  bg1: string;
  bg2: string;
  accent: string;
  profit: string;
  loss: string;
  warn: string;
  info: string;
  fontNum: string;
  fontUi: string;
}

/** Fallbacks are the dark values, used when the stylesheet is not loaded (tests). */
const FALLBACKS: ChartTokens = {
  fg: '#e3e8ee',
  fg2: '#a3adb9',
  fg3: '#8590a0',
  line: '#1f262d',
  line2: '#2a333c',
  bg1: '#0f1216',
  bg2: '#151a1f',
  accent: '#5b95ff',
  profit: '#2fca88',
  loss: '#ff6b80',
  warn: '#f2b33d',
  info: '#4cbbe9',
  fontNum: `'JetBrains Mono Variable', 'JetBrains Mono', ${CHART_FONT_FALLBACK}`,
  fontUi: `'Inter Variable', Inter, system-ui, sans-serif`,
};

export function readChartTokens(el?: Element): ChartTokens {
  const r = (name: string, fb: string) => readCssToken(name, fb, el);
  return {
    fg: r('--fg', FALLBACKS.fg),
    fg2: r('--fg-2', FALLBACKS.fg2),
    fg3: r('--fg-3', FALLBACKS.fg3),
    line: r('--line', FALLBACKS.line),
    line2: r('--line-2', FALLBACKS.line2),
    bg1: r('--bg-1', FALLBACKS.bg1),
    bg2: r('--bg-2', FALLBACKS.bg2),
    accent: r('--accent', FALLBACKS.accent),
    profit: r('--profit', FALLBACKS.profit),
    loss: r('--loss', FALLBACKS.loss),
    warn: r('--warn', FALLBACKS.warn),
    info: r('--info', FALLBACKS.info),
    fontNum: r('--font-num', FALLBACKS.fontNum),
    fontUi: r('--font-ui', FALLBACKS.fontUi),
  };
}

/**
 * ECharts theme derived from the design tokens (docs/redesign/02-design.md, section 6.6).
 * Axis labels are at least 11 px and use the monospace figure font, with the documented
 * `ui-monospace` fallback when the self-hosted font is not loaded.
 */
export function buildChartTheme(tokens: ChartTokens): Record<string, unknown> {
  const axis = {
    axisLine: { lineStyle: { color: tokens.line2 } },
    axisTick: { lineStyle: { color: tokens.line2 } },
    axisLabel: { color: tokens.fg3, fontSize: 11, fontFamily: tokens.fontNum, hideOverlap: true },
    splitLine: { lineStyle: { color: tokens.line } },
    nameTextStyle: { color: tokens.fg3, fontSize: 11 },
  };
  return {
    // Not the pure green or red of P&L for the series palette: accent first, then neutral tones
    color: [tokens.accent, tokens.info, tokens.warn, tokens.fg2, tokens.fg3],
    backgroundColor: 'transparent',
    textStyle: { color: tokens.fg2, fontFamily: tokens.fontUi, fontSize: 11 },
    animation: false,
    grid: { left: 8, right: 8, top: 12, bottom: 8, containLabel: true },
    categoryAxis: axis,
    valueAxis: axis,
    timeAxis: axis,
    logAxis: axis,
    line: { symbolSize: 4, lineStyle: { width: 1.5 } },
    candlestick: {
      itemStyle: {
        color: tokens.profit,
        color0: tokens.loss,
        borderColor: tokens.profit,
        borderColor0: tokens.loss,
      },
    },
    tooltip: {
      backgroundColor: tokens.bg1,
      borderColor: tokens.line2,
      borderWidth: 1,
      textStyle: { color: tokens.fg, fontSize: 12, fontFamily: tokens.fontNum },
      extraCssText: 'box-shadow: 0 12px 32px rgba(0,0,0,.35);',
    },
    legend: { textStyle: { color: tokens.fg2, fontSize: 11 } },
    dataZoom: { textStyle: { color: tokens.fg3, fontSize: 11 } },
    markLine: { lineStyle: { color: tokens.fg3 }, label: { color: tokens.fg2, fontSize: 11 } },
  };
}
