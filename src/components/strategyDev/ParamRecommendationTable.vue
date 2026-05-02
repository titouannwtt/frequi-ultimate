<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface ParamDeepDive {
  name: string;
  type?: string;
  range_low?: number;
  range_high?: number;
  best_value?: unknown;
  top10_min?: number;
  top10_max?: number;
  top10_median?: number;
  top10_std?: number;
  tendency?: string;
  boundary_cluster?: boolean;
  sensitivity?: number;
  sensitivity_label?: string;
  categories?: string[];
  category_counts?: Record<string, number>;
}

interface ParamStat {
  median?: number;
  mean?: number;
  median_top5?: number;
  mean_top5?: number;
  median_top3?: number;
  mean_top3?: number;
  recommended?: number;
  majority_top5?: unknown;
  majority_top5_count?: number;
  majority_top10?: unknown;
  majority_top10_count?: number;
}

interface ParamStability {
  median?: number;
  std?: number;
  std_over_range?: number;
  stable?: boolean;
  unstable?: boolean;
}

const props = defineProps<{
  deepDive: Record<string, ParamDeepDive>;
  paramStats: Record<string, ParamStat>;
  paramStability?: Record<string, ParamStability>;
}>();

interface BoxPlotData {
  rangeMin: number;
  rangeMax: number;
  t10Min: number;
  t10Max: number;
  median: number;
  best: number;
  mean: number;
}

interface Row {
  name: string;
  type: string;
  bestValue: string;
  recommended: string;
  median: string;
  range: string;
  top10Range: string;
  tendency: string;
  tendencyColor: string;
  sensitivity: string;
  sensitivityColor: string;
  reasoning: string;
  boxPlot: BoxPlotData | null;
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    if (Math.abs(v) >= 100) return v.toFixed(1);
    if (Math.abs(v) >= 1) return v.toFixed(2);
    return v.toFixed(4);
  }
  return String(v);
}

const rows = computed<Row[]>(() => {
  const result: Row[] = [];
  const allNames = new Set([
    ...Object.keys(props.deepDive),
    ...Object.keys(props.paramStats),
  ]);

  for (const name of [...allNames].sort()) {
    const dd = props.deepDive[name];
    const ps = props.paramStats[name];
    const stab = props.paramStability?.[name];

    const type = dd?.type ?? '?';
    const bestValue = fmtVal(dd?.best_value);
    const recommended = fmtVal(ps?.recommended);
    const median = fmtVal(dd?.top10_median ?? ps?.median);

    let range = '—';
    if (dd?.range_low != null && dd?.range_high != null) {
      range = `${fmtVal(dd.range_low)} — ${fmtVal(dd.range_high)}`;
    } else if (dd?.categories?.length) {
      range = dd.categories.join(', ');
    }

    let top10Range = '—';
    if (dd?.top10_min != null && dd?.top10_max != null) {
      top10Range = `${fmtVal(dd.top10_min)} — ${fmtVal(dd.top10_max)}`;
    }

    let tendency = '—';
    let tendencyColor = '';
    if (dd?.tendency === 'converging') {
      tendency = t('strategyDev.prtConverging');
      tendencyColor = 'text-green-400';
      if (dd.boundary_cluster) {
        tendency = t('strategyDev.prtBoundary');
        tendencyColor = 'text-yellow-400';
      }
    } else if (dd?.tendency === 'spread') {
      tendency = t('strategyDev.prtSpread');
      tendencyColor = 'text-orange-400';
    }
    if (stab?.stable) {
      tendency = t('strategyDev.prtStable');
      tendencyColor = 'text-green-400';
    } else if (stab?.unstable && tendency === '—') {
      tendency = t('strategyDev.prtUnstable');
      tendencyColor = 'text-red-400';
    }

    let sensitivity = '—';
    let sensitivityColor = '';
    if (dd?.sensitivity_label === 'high') {
      sensitivity = t('strategyDev.prtSensHigh');
      sensitivityColor = 'text-red-400';
    } else if (dd?.sensitivity_label === 'medium') {
      sensitivity = t('strategyDev.prtSensMedium');
      sensitivityColor = 'text-yellow-400';
    } else if (dd?.sensitivity_label === 'low') {
      sensitivity = t('strategyDev.prtSensLow');
      sensitivityColor = 'text-green-400';
    }

    let reasoning = '';
    const reasons: string[] = [];

    if (dd?.tendency === 'converging' && !dd?.boundary_cluster) {
      reasons.push(t('strategyDev.prtReasonConverging'));
    }
    if (dd?.boundary_cluster) {
      reasons.push(t('strategyDev.prtReasonBoundary'));
    }
    if (dd?.tendency === 'spread') {
      reasons.push(t('strategyDev.prtReasonSpread'));
    }
    if (dd?.sensitivity_label === 'high') {
      reasons.push(t('strategyDev.prtReasonHighSens'));
    }
    if (dd?.sensitivity_label === 'low') {
      reasons.push(t('strategyDev.prtReasonLowSens'));
    }
    if (stab?.stable) {
      reasons.push(t('strategyDev.prtReasonStable'));
    }
    if (stab?.unstable) {
      reasons.push(t('strategyDev.prtReasonUnstable'));
    }
    reasoning = reasons.join('. ');

    let boxPlot: BoxPlotData | null = null;
    if (dd?.range_low != null && dd?.range_high != null && dd.range_high > dd.range_low
      && dd?.top10_min != null && dd?.top10_max != null && dd?.top10_median != null) {
      const bestNum = typeof dd.best_value === 'number' ? dd.best_value : dd.top10_median;
      const meanNum = ps?.mean ?? ps?.median ?? dd.top10_median;
      boxPlot = {
        rangeMin: dd.range_low,
        rangeMax: dd.range_high,
        t10Min: dd.top10_min,
        t10Max: dd.top10_max,
        median: dd.top10_median,
        best: bestNum,
        mean: meanNum,
      };
    }

    result.push({
      name,
      type,
      bestValue,
      recommended,
      median,
      range,
      top10Range,
      tendency,
      tendencyColor,
      sensitivity,
      sensitivityColor,
      reasoning,
      boxPlot,
    });
  }

  return result;
});

function boxX(val: number, bp: BoxPlotData, width: number): number {
  const range = bp.rangeMax - bp.rangeMin;
  if (range <= 0) return width / 2;
  return Math.max(2, Math.min(width - 2, ((val - bp.rangeMin) / range) * width));
}

const BOX_W = 140;
const BOX_H = 18;

const summary = computed(() => {
  const converging = rows.value.filter(r => r.tendency === t('strategyDev.prtConverging') || r.tendency === t('strategyDev.prtStable')).length;
  const spread = rows.value.filter(r => r.tendency === t('strategyDev.prtSpread') || r.tendency === t('strategyDev.prtUnstable')).length;
  const total = rows.value.length;
  if (converging === total) return { color: '#a6e3a1', bg: 'rgba(166, 227, 161, 0.12)', text: t('strategyDev.prtSummaryAllClear') };
  if (spread > total / 2) return { color: '#f38ba8', bg: 'rgba(243, 139, 168, 0.12)', text: t('strategyDev.prtSummaryMostSpread') };
  return { color: '#f9e2af', bg: 'rgba(249, 226, 175, 0.12)', text: t('strategyDev.prtSummaryMixed', { converging, spread, total }) };
});
</script>

<template>
  <div class="prt-wrap">
    <h4 class="prt-title">
      {{ t('strategyDev.prtTitle') }}
      <InfoTip :text="t('strategyDev.hintPrt')" width="320px" />
    </h4>

    <div class="prt-table-wrap">
      <table class="prt-table">
        <thead>
          <tr>
            <th>{{ t('strategyDev.prtParam') }}</th>
            <th>{{ t('strategyDev.prtType') }}</th>
            <th>{{ t('strategyDev.prtBest') }}</th>
            <th>{{ t('strategyDev.prtRecommended') }}</th>
            <th>{{ t('strategyDev.prtMedian') }}</th>
            <th>{{ t('strategyDev.prtSearchRange') }}</th>
            <th>{{ t('strategyDev.prtTop10Range') }}</th>
            <th class="th-boxplot">{{ t('strategyDev.prtDistribution') }}</th>
            <th>{{ t('strategyDev.prtTendency') }}</th>
            <th>{{ t('strategyDev.prtSensitivity') }}</th>
            <th>{{ t('strategyDev.prtReasoning') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.name">
            <td class="td-name">{{ row.name }}</td>
            <td class="td-type">{{ row.type }}</td>
            <td class="td-val text-blue-400">{{ row.bestValue }}</td>
            <td class="td-val font-semibold text-green-300">{{ row.recommended }}</td>
            <td class="td-val" style="color: #cba6f7">{{ row.median }}</td>
            <td class="td-range">{{ row.range }}</td>
            <td class="td-range">{{ row.top10Range }}</td>
            <td class="td-boxplot">
              <svg v-if="row.boxPlot" :width="BOX_W" :height="BOX_H" class="bp-svg">
                <!-- Full range whisker line -->
                <line
                  x1="2" :y1="BOX_H / 2" :x2="BOX_W - 2" :y2="BOX_H / 2"
                  stroke="#45475a" stroke-width="1"
                />
                <!-- Min/Max whisker caps -->
                <line x1="2" :y1="BOX_H / 2 - 4" x2="2" :y2="BOX_H / 2 + 4" stroke="#45475a" stroke-width="1" />
                <line :x1="BOX_W - 2" :y1="BOX_H / 2 - 4" :x2="BOX_W - 2" :y2="BOX_H / 2 + 4" stroke="#45475a" stroke-width="1" />
                <!-- Top 10 box -->
                <rect
                  :x="boxX(row.boxPlot.t10Min, row.boxPlot, BOX_W)"
                  :y="BOX_H / 2 - 6"
                  :width="Math.max(2, boxX(row.boxPlot.t10Max, row.boxPlot, BOX_W) - boxX(row.boxPlot.t10Min, row.boxPlot, BOX_W))"
                  :height="12"
                  rx="2"
                  fill="rgba(137, 180, 250, 0.25)"
                  stroke="#89b4fa"
                  stroke-width="1"
                />
                <!-- Median line -->
                <line
                  :x1="boxX(row.boxPlot.median, row.boxPlot, BOX_W)"
                  :y1="BOX_H / 2 - 6"
                  :x2="boxX(row.boxPlot.median, row.boxPlot, BOX_W)"
                  :y2="BOX_H / 2 + 6"
                  stroke="#f9e2af"
                  stroke-width="2"
                />
                <!-- Mean dot -->
                <circle
                  :cx="boxX(row.boxPlot.mean, row.boxPlot, BOX_W)"
                  :cy="BOX_H / 2"
                  r="3"
                  fill="#cba6f7"
                  stroke="#1e1e2e"
                  stroke-width="1"
                />
                <!-- Best value dot -->
                <circle
                  :cx="boxX(row.boxPlot.best, row.boxPlot, BOX_W)"
                  :cy="BOX_H / 2"
                  r="3.5"
                  fill="#a6e3a1"
                  stroke="#1e1e2e"
                  stroke-width="1"
                />
                <!-- Labels at extremes -->
                <text x="2" :y="BOX_H / 2 - 6" class="bp-label">{{ fmtVal(row.boxPlot.rangeMin) }}</text>
                <text :x="BOX_W - 2" :y="BOX_H / 2 - 6" class="bp-label" text-anchor="end">{{ fmtVal(row.boxPlot.rangeMax) }}</text>
              </svg>
              <span v-else class="td-range">—</span>
            </td>
            <td :class="row.tendencyColor">{{ row.tendency }}</td>
            <td :class="row.sensitivityColor">{{ row.sensitivity }}</td>
            <td class="td-reason">{{ row.reasoning }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Box plot legend -->
    <div class="bp-legend">
      <span class="bp-legend-item">
        <svg width="16" height="12"><line x1="0" y1="6" x2="16" y2="6" stroke="#45475a" stroke-width="1" /></svg>
        {{ t('strategyDev.prtBpFullRange') }}
      </span>
      <span class="bp-legend-item">
        <svg width="16" height="12"><rect x="2" y="2" width="12" height="8" rx="1" fill="rgba(137,180,250,0.25)" stroke="#89b4fa" stroke-width="1" /></svg>
        Top 10
      </span>
      <span class="bp-legend-item">
        <svg width="8" height="12"><line x1="4" y1="1" x2="4" y2="11" stroke="#f9e2af" stroke-width="2" /></svg>
        {{ t('strategyDev.prtMedian') }}
      </span>
      <span class="bp-legend-item">
        <svg width="10" height="10"><circle cx="5" cy="5" r="3" fill="#cba6f7" stroke="#1e1e2e" stroke-width="1" /></svg>
        {{ t('strategyDev.prtBpMean') }}
      </span>
      <span class="bp-legend-item">
        <svg width="10" height="10"><circle cx="5" cy="5" r="3.5" fill="#a6e3a1" stroke="#1e1e2e" stroke-width="1" /></svg>
        {{ t('strategyDev.prtBest') }}
      </span>
    </div>

    <!-- Summary advisory -->
    <div
      class="prt-summary"
      :style="{ backgroundColor: summary.bg, color: summary.color, borderColor: summary.color + '33' }"
    >
      <span class="prt-summary-dot" :style="{ backgroundColor: summary.color }" />
      {{ summary.text }}
    </div>

  </div>
</template>

<style scoped>
.prt-wrap {
  background: var(--sd-base, #1e1e2e);
  border-radius: var(--sd-radius-lg);
  padding: 1rem;
}

.prt-title {
  font-size: var(--sd-text-sm);
  font-weight: 700;
  color: var(--sd-text);
  margin-bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 6px;
}

.prt-table-wrap {
  border-radius: var(--sd-radius-md);
  overflow-x: auto;
  border: 1px solid var(--sd-border-subtle);
}

.prt-table {
  width: 100%;
  min-width: 1050px;
  border-collapse: collapse;
  font-size: var(--sd-text-xs);
  font-family: var(--sd-font-mono);
}

.prt-table thead {
  background: #181825;
}

.prt-table th {
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--sd-overlay);
  border-bottom: 1px solid var(--sd-border-subtle);
  white-space: nowrap;
}

.th-boxplot {
  min-width: 150px;
}

.prt-table tbody tr {
  background: #1e1e2e;
  transition: background 0.1s;
}
.prt-table tbody tr:hover {
  background: #313244;
}
.prt-table tbody tr:nth-child(even) {
  background: #1a1a2a;
}
.prt-table tbody tr:nth-child(even):hover {
  background: #313244;
}

.prt-table td {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #313244;
  white-space: nowrap;
}

.td-name {
  color: #89b4fa;
  font-weight: 500;
}

.td-type {
  color: #6c7086;
  font-size: var(--sd-text-2xs);
}

.td-val {
  font-variant-numeric: tabular-nums;
}

.td-range {
  color: #a6adc8;
}

.td-boxplot {
  padding: 0.25rem 0.5rem;
}

.bp-svg {
  display: block;
}

.bp-label {
  font-size: 7px;
  fill: #6c7086;
  font-family: var(--sd-font-mono, monospace);
}

.td-reason {
  color: #a6adc8;
  font-size: var(--sd-text-2xs);
  white-space: normal;
  min-width: 200px;
  max-width: 450px;
  line-height: 1.4;
}

.bp-legend {
  display: flex;
  gap: 14px;
  justify-content: center;
  margin-top: 10px;
  flex-wrap: wrap;
}

.bp-legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #6c7086;
}

.prt-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: var(--sd-radius-md);
  font-size: var(--sd-text-xs);
  font-weight: 500;
  border: 1px solid;
}

.prt-summary-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
