<script setup lang="ts">
import type { ProfitStats, Trade } from '@/types';
import {
  computeMaxDrawdown,
  computeAggregateDrawdown,
  accountBaseFromProfit,
  tradeWorstAbs,
} from '@/utils/maxDrawdown';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  botIds: string[];
  title: string;
  stakeCurrency?: string;
}>();

const botStore = useBotStore();

const single = computed(() => props.botIds.length === 1);

const currency = computed(
  () =>
    props.stakeCurrency ||
    (botStore.allBotState[props.botIds[0]]?.stake_currency as string) ||
    'USDC',
);

const closedTrades = computed<Trade[]>(() =>
  props.botIds
    .flatMap((id) => botStore.botStores[id]?.trades ?? [])
    .filter((tr) => !tr.is_open)
    .slice()
    .sort((a, b) => (a.close_timestamp ?? 0) - (b.close_timestamp ?? 0)),
);
const openTradesList = computed<Trade[]>(() =>
  props.botIds.flatMap((id) => botStore.botStores[id]?.openTrades ?? []),
);

const profit = computed<ProfitStats | undefined>(() =>
  single.value ? botStore.allProfit[props.botIds[0]] : undefined,
);

const dd = computed(() => {
  if (single.value) {
    return computeMaxDrawdown(profit.value, closedTrades.value, openTradesList.value);
  }
  const base = props.botIds.reduce((s, id) => s + accountBaseFromProfit(botStore.allProfit[id]), 0);
  return computeAggregateDrawdown(closedTrades.value, openTradesList.value, base);
});

const hasDrawdown = computed(() => ddView.value.realizedAbs > 0 || ddView.value.openAbs > 0);

// ── Period (single bot, from freqtrade) ──
const startTs = computed(() => profit.value?.max_drawdown_start_timestamp ?? 0);
const endTs = computed(() => profit.value?.max_drawdown_end_timestamp ?? 0);
const durationDays = computed(() => {
  if (!startTs.value || !endTs.value || endTs.value <= startTs.value) return 0;
  return (endTs.value - startTs.value) / (1000 * 60 * 60 * 24);
});
function humanizeDays(days: number): string {
  if (days <= 0) return '—';
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 7) return `${Math.round(days)}d`;
  const weeks = Math.floor(days / 7);
  const rem = Math.round(days % 7);
  return rem > 0 ? `${weeks}w ${rem}d` : `${weeks}w`;
}

// ── Charts ──
const SVG_W = 348;
const SVG_H = 70;
const PAD = 6;

interface Point {
  t: number;
  v: number;
}

// Sampled current-profit history per bot (fork backend). Empty until loaded, or when
// a bot predates the /profit_history endpoint — the curve then falls back to the
// legacy projection (realized curve + one point at the open positions' worst).
const histories = ref<Record<string, [number, number, number, number][]>>({});
async function loadHistories() {
  const res: Record<string, [number, number, number, number][]> = {};
  await Promise.all(
    props.botIds.map(async (id) => {
      const h = await botStore.botStores[id]?.getProfitHistory?.();
      if (h?.data?.length) res[id] = h.data;
    }),
  );
  histories.value = res;
}
onMounted(loadHistories);
watch(() => props.botIds.join(','), loadHistories);

const realizedPoints = computed<Point[]>(() => {
  let cum = 0;
  return closedTrades.value.map((tr) => ({
    t: tr.close_timestamp ?? 0,
    v: (cum += tr.profit_abs ?? 0),
  }));
});

// "Profit courant" over time: closed + open unrealized at each sample, summed across
// bots (forward-filling each bot's last sample when timestamps don't align).
const historyPoints = computed<Point[]>(() => {
  const seriesList = Object.values(histories.value);
  if (!seriesList.length) return [];
  if (seriesList.length === 1) {
    return seriesList[0].map((r) => ({ t: r[0], v: r[1] + r[2] }));
  }
  // Merge only from the first COMMON timestamp: before every bot has begun
  // sampling, the forward-filled sum silently misses whole bots (their slot is
  // primed at 0), fabricating an artificially-low start of the curve — the max
  // drawdown then anchors its trough dot on the zero line for no real reason.
  // The pre-sampling window is covered by the realized curve prepended in
  // openPoints instead.
  const startT = Math.max(...seriesList.map((s) => s[0][0]));
  const allTs = [...new Set(seriesList.flatMap((s) => s.map((r) => r[0])))]
    .filter((t) => t >= startT)
    .sort((a, b) => a - b);
  const idx = seriesList.map(() => 0);
  const last = seriesList.map(() => 0);
  return allTs.map((t) => {
    seriesList.forEach((s, i) => {
      while (idx[i] < s.length && s[idx[i]][0] <= t) {
        last[i] = s[idx[i]][1] + s[idx[i]][2];
        idx[i]++;
      }
    });
    return { t, v: last.reduce((a, b) => a + b, 0) };
  });
});

// Open-inclusive curve: the sampled current-profit series when available, otherwise the
// legacy projection. Both end with the open positions projected to their lows (min/max
// rate), which captures intra-sample lows the periodic series can miss.
const openPoints = computed<Point[]>(() => {
  const rp = realizedPoints.value;
  const lastRealized = rp.length ? rp[rp.length - 1].v : 0;
  const projected: Point = { t: Date.now(), v: lastRealized + dd.value.openWorstSum };
  const hist = historyPoints.value;
  if (hist.length >= 2) {
    // Align the time domain with the realized curve above: the sampled series only
    // exists since the profit_history feature was deployed, while the realized curve
    // spans the bot's whole trading history. Without prepending the pre-sampling
    // realized points, the two charts cover unrelated time windows and their shapes
    // are impossible to compare.
    const firstT = hist[0].t;
    const before = rp.filter((p) => p.t < firstT);
    return [...before, ...hist, projected];
  }
  return [...rp, projected];
});

function maxDDIndices(values: number[]): { peak: number; trough: number } {
  let runPeak = values[0] ?? 0;
  let runPeakIdx = 0;
  let best = -1;
  let p = 0;
  let tr = 0;
  values.forEach((v, i) => {
    if (v > runPeak) {
      runPeak = v;
      runPeakIdx = i;
    }
    if (runPeak - v > best) {
      best = runPeak - v;
      p = runPeakIdx;
      tr = i;
    }
  });
  return { peak: p, trough: tr };
}

function buildChart(points: Point[]) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.v);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const tMin = points[0].t;
  const tSpan = points[points.length - 1].t - tMin || 1;
  const x = (i: number) => PAD + ((points[i].t - tMin) / tSpan) * (SVG_W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (SVG_H - 2 * PAD);
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const { peak, trough } = maxDDIndices(values);
  return {
    line,
    zeroY: y(0),
    peak: { x: x(peak), y: y(values[peak]) },
    trough: { x: x(trough), y: y(values[trough]) },
  };
}
const realizedChart = computed(() => buildChart(realizedPoints.value));
const openChart = computed(() => buildChart(openPoints.value));
const openCurveIsHistory = computed(() => historyPoints.value.length >= 2);

// Headline "including open" figures: extend with the sampled curve's own max drawdown
// (past open books now closed leave no trace in the trade-based numbers).
function curveMaxDD(points: Point[]): number {
  let peak = 0;
  let best = 0;
  for (const p of points) {
    if (p.v > peak) peak = p.v;
    if (peak - p.v > best) best = peak - p.v;
  }
  return best;
}
const ddView = computed(() => {
  const d = dd.value;
  if (!openCurveIsHistory.value) return d;
  const openAbs = Math.max(d.openAbs, curveMaxDD(openPoints.value));
  const base = d.openRatio > 0 ? d.openAbs / d.openRatio : 0;
  return { ...d, openAbs, openRatio: base > 0 ? openAbs / base : d.openRatio };
});

// ── Responsible closed trades (single bot) ──
const responsibleTrades = computed<Trade[]>(() => {
  if (!single.value || !startTs.value || !endTs.value) return [];
  return closedTrades.value.filter(
    (tr) => (tr.close_timestamp ?? 0) > startTs.value && (tr.close_timestamp ?? 0) <= endTs.value,
  );
});
const worstClosed = computed(() =>
  responsibleTrades.value
    .slice()
    .sort((a, b) => (a.profit_abs ?? 0) - (b.profit_abs ?? 0))
    .slice(0, 3),
);

// ── Open positions at their worst ──
const openWorst = computed(() =>
  openTradesList.value
    .map((tr) => ({ trade: tr, worst: tradeWorstAbs(tr), current: tr.profit_abs ?? 0 }))
    .sort((a, b) => a.worst - b.worst)
    .slice(0, 4),
);

function ddColor(ratio: number): string {
  if (ratio >= 0.2) return 'text-red-400';
  if (ratio >= 0.1) return 'text-orange-400';
  if (ratio > 0) return 'text-amber-400';
  return 'text-gray-500';
}
function profitColor(val: number | undefined | null): string {
  if (val === undefined || val === null) return '';
  if (val > 0) return 'text-green-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-500';
}
</script>

<template>
  <div class="glass-card" style="width: 384px">
    <div class="section-header">
      <i-mdi-trending-down class="text-red-400" />
      <span>{{ t('maxDrawdownCard.title') }} · {{ title }}</span>
    </div>

    <div v-if="!hasDrawdown" class="flex flex-col items-center justify-center py-6 gap-2">
      <i-mdi-chart-line-variant class="text-3xl text-green-400/40" />
      <div class="text-sm text-gray-200">{{ t('maxDrawdownCard.none') }}</div>
      <div class="text-xs text-gray-500 text-center">{{ t('maxDrawdownCard.noneDesc') }}</div>
    </div>

    <template v-else>
      <!-- Two values -->
      <div class="grid grid-cols-2 gap-2 mb-3">
        <div class="metric-cell">
          <div class="text-[0.8rem] text-gray-500">{{ t('maxDrawdownCard.realized') }}</div>
          <div class="text-xl font-bold" :class="ddColor(dd.realizedRatio)">
            -{{ formatPercent(dd.realizedRatio, 2) }}
          </div>
          <div class="text-[0.8rem]" :class="ddColor(dd.realizedRatio)">
            {{ formatPriceCurrency(-dd.realizedAbs, currency, 2) }}
          </div>
        </div>
        <div class="metric-cell">
          <div class="text-[0.8rem] text-gray-500">{{ t('maxDrawdownCard.inclOpen') }}</div>
          <div class="text-xl font-bold" :class="ddColor(ddView.openRatio)">
            -{{ formatPercent(ddView.openRatio, 2) }}
          </div>
          <div class="text-[0.8rem]" :class="ddColor(ddView.openRatio)">
            {{ formatPriceCurrency(-ddView.openAbs, currency, 2) }}
          </div>
        </div>
      </div>

      <!-- Chart 1: realized -->
      <div class="mb-2">
        <div class="flex items-center justify-between mb-0.5">
          <span class="text-[0.8rem] font-medium text-blue-300">{{
            t('maxDrawdownCard.realizedCurve')
          }}</span>
          <span v-if="single && durationDays > 0" class="text-[0.75rem] text-gray-500">
            {{ humanizeDays(durationDays) }}
          </span>
        </div>
        <svg v-if="realizedChart" :viewBox="`0 0 ${SVG_W} ${SVG_H}`" class="w-full">
          <line
            :x1="0"
            :x2="SVG_W"
            :y1="realizedChart.zeroY"
            :y2="realizedChart.zeroY"
            stroke="rgba(255,255,255,0.12)"
            stroke-dasharray="3 3"
          />
          <rect
            :x="realizedChart.peak.x"
            :y="0"
            :width="Math.max(1, realizedChart.trough.x - realizedChart.peak.x)"
            :height="SVG_H"
            fill="rgba(239,68,68,0.10)"
          />
          <polyline :points="realizedChart.line" fill="none" stroke="#60a5fa" stroke-width="1.5" />
          <circle :cx="realizedChart.peak.x" :cy="realizedChart.peak.y" r="3.5" fill="#22c55e" />
          <circle
            :cx="realizedChart.trough.x"
            :cy="realizedChart.trough.y"
            r="3.5"
            fill="#ef4444"
          />
        </svg>
        <div v-else class="text-[0.75rem] text-gray-500 py-1 text-center">
          {{ t('maxDrawdownCard.notEnoughData') }}
        </div>
        <div v-if="single && startTs" class="flex justify-between text-[0.72rem] mt-0.5">
          <span class="text-green-400"
            >{{ t('maxDrawdownCard.peak') }}: {{ timestampms(startTs) }}</span
          >
          <span class="text-red-400"
            >{{ t('maxDrawdownCard.trough') }}: {{ endTs ? timestampms(endTs) : 'N/A' }}</span
          >
        </div>
      </div>

      <!-- Chart 2: including open positions -->
      <div class="mb-3 pb-3 border-b border-white/5">
        <div class="text-[0.8rem] font-medium text-orange-300 mb-0.5">
          {{ t('maxDrawdownCard.openCurve') }}
        </div>
        <svg v-if="openChart" :viewBox="`0 0 ${SVG_W} ${SVG_H}`" class="w-full">
          <line
            :x1="0"
            :x2="SVG_W"
            :y1="openChart.zeroY"
            :y2="openChart.zeroY"
            stroke="rgba(255,255,255,0.12)"
            stroke-dasharray="3 3"
          />
          <rect
            :x="openChart.peak.x"
            :y="0"
            :width="Math.max(1, openChart.trough.x - openChart.peak.x)"
            :height="SVG_H"
            fill="rgba(249,115,22,0.10)"
          />
          <polyline :points="openChart.line" fill="none" stroke="#fb923c" stroke-width="1.5" />
          <circle :cx="openChart.peak.x" :cy="openChart.peak.y" r="3.5" fill="#22c55e" />
          <circle :cx="openChart.trough.x" :cy="openChart.trough.y" r="3.5" fill="#ef4444" />
        </svg>
        <div v-else class="text-[0.75rem] text-gray-500 py-1 text-center">
          {{ t('maxDrawdownCard.notEnoughData') }}
        </div>
        <div class="text-[0.72rem] text-gray-500 mt-0.5">
          {{
            openCurveIsHistory
              ? t('maxDrawdownCard.openCurveHintHistory')
              : t('maxDrawdownCard.openCurveHint')
          }}
        </div>
      </div>

      <!-- Open positions at their worst -->
      <div v-if="openWorst.length" class="mb-3 pb-3 border-b border-white/5">
        <div class="section-header">
          <i-mdi-arrow-down-bold-circle-outline class="text-orange-400" />
          <span>{{ t('maxDrawdownCard.openPositions') }}</span>
        </div>
        <div class="space-y-0.5">
          <div v-for="o in openWorst" :key="o.trade.trade_id" class="stat-row">
            <span class="stat-label">{{ o.trade.pair }}</span>
            <span class="stat-value text-xs">
              <span :class="profitColor(o.current)">{{
                formatPriceCurrency(o.current, currency, 2)
              }}</span>
              <span class="text-gray-500"> · {{ t('maxDrawdownCard.low') }} </span>
              <span :class="profitColor(o.worst)">{{
                formatPriceCurrency(o.worst, currency, 2)
              }}</span>
            </span>
          </div>
        </div>
      </div>

      <!-- Responsible closed trades (single bot) -->
      <div v-if="single && responsibleTrades.length">
        <div class="section-header">
          <i-mdi-alert-circle-outline class="text-amber-400" />
          <span>{{ t('maxDrawdownCard.responsibleTrades') }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">{{ t('maxDrawdownCard.tradesInWindow') }}</span>
          <span class="stat-value">{{ responsibleTrades.length }}</span>
        </div>
        <div v-for="tr in worstClosed" :key="tr.trade_id" class="stat-row">
          <span class="stat-label flex items-center gap-1">
            <i-mdi-arrow-down-bold class="text-red-400 text-xs" />{{ tr.pair }}
          </span>
          <span class="stat-value text-xs" :class="profitColor(tr.profit_abs)">
            {{ formatPriceCurrency(tr.profit_abs ?? 0, currency, 2) }}
            <span class="text-gray-500">({{ formatPercent(tr.profit_ratio ?? 0, 1) }})</span>
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.glass-card {
  font-size: 0.9rem;
  line-height: 1.4;
  background: rgba(15, 17, 23, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 16px;
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
}
.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1px 0;
  gap: 8px;
}
.stat-label {
  color: rgba(255, 255, 255, 0.35);
  font-size: 0.95rem;
}
.stat-value {
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.95rem;
  text-align: right;
}
.metric-cell {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 8px 10px;
}
</style>
