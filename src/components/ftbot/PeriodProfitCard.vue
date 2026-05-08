<script setup lang="ts">
import type { ClosedTrade, ProfitStats } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  botId: string;
  stakeCurrency?: string;
}>();

const botStore = useBotStore();

const profit = computed<ProfitStats | undefined>(() => {
  return botStore.allProfit[props.botId];
});

const botState = computed(() => {
  return botStore.allBotState[props.botId];
});

const currency = computed(() => props.stakeCurrency || (botState.value?.stake_currency as string) || 'USDC');

// Trading period
const firstTradeTs = computed(() => profit.value?.first_trade_timestamp ?? 0);
const latestTradeTs = computed(() => profit.value?.latest_trade_timestamp ?? 0);
const tradingPeriodDays = computed(() => {
  if (!firstTradeTs.value || !latestTradeTs.value) return 0;
  return (latestTradeTs.value - firstTradeTs.value) / (1000 * 60 * 60 * 24);
});

const totalProfit = computed(() => profit.value?.profit_closed_coin ?? 0);

// ═══ Projection Charts Data ═══

const closedTrades = computed<ClosedTrade[]>(() => {
  return botStore.botStores[props.botId]?.trades ?? [];
});

const now = new Date();

// Current month trades
const currentMonthTrades = computed(() => {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return closedTrades.value.filter((t) => new Date(t.close_date) >= monthStart);
});

// Current year trades
const currentYearTrades = computed(() => {
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return closedTrades.value.filter((t) => new Date(t.close_date) >= yearStart);
});

interface DayProfit {
  day: number;
  profit: number;
}

function buildDailyCumulative(
  trades: ClosedTrade[],
  startDate: Date,
  totalDays: number,
): DayProfit[] {
  const dailyProfit = new Array(totalDays).fill(0);
  for (const trade of trades) {
    const closeDate = new Date(trade.close_date);
    const dayIdx = Math.floor((closeDate.getTime() - startDate.getTime()) / 86400000);
    if (dayIdx >= 0 && dayIdx < totalDays) {
      dailyProfit[dayIdx] += trade.profit_abs ?? 0;
    }
  }
  let cum = 0;
  return dailyProfit.map((p, i) => {
    cum += p;
    return { day: i, profit: cum };
  });
}

// Days in current month
const daysInMonth = computed(() => new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
const todayDayOfMonth = now.getDate(); // 1-based

// Monthly cumulative data
const monthlyCumulative = computed(() => {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return buildDailyCumulative(currentMonthTrades.value, monthStart, daysInMonth.value);
});

// Monthly projection
const monthlyCurrentProfit = computed(() => {
  const data = monthlyCumulative.value;
  if (data.length === 0) return 0;
  return data[Math.min(todayDayOfMonth - 1, data.length - 1)]?.profit ?? 0;
});

const monthlyDailyAvg = computed(() => {
  if (todayDayOfMonth <= 0) return 0;
  return monthlyCurrentProfit.value / todayDayOfMonth;
});

const monthlyProjectedEnd = computed(() => {
  return monthlyCurrentProfit.value + monthlyDailyAvg.value * (daysInMonth.value - todayDayOfMonth);
});

// Days in current year
const isLeapYear = now.getFullYear() % 4 === 0 && (now.getFullYear() % 100 !== 0 || now.getFullYear() % 400 === 0);
const daysInYear = isLeapYear ? 366 : 365;
const todayDayOfYear = Math.floor(
  (now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000,
) + 1;

// Yearly cumulative data
const yearlyCumulative = computed(() => {
  const yearStart = new Date(now.getFullYear(), 0, 1);
  return buildDailyCumulative(currentYearTrades.value, yearStart, daysInYear);
});

const yearlyCurrentProfit = computed(() => {
  const data = yearlyCumulative.value;
  if (data.length === 0) return 0;
  return data[Math.min(todayDayOfYear - 1, data.length - 1)]?.profit ?? 0;
});

const yearlyDailyAvg = computed(() => {
  if (todayDayOfYear <= 0) return 0;
  return yearlyCurrentProfit.value / todayDayOfYear;
});

const yearlyProjectedEnd = computed(() => {
  return yearlyCurrentProfit.value + yearlyDailyAvg.value * (daysInYear - todayDayOfYear);
});

// Yearly compound projection: if profits compound, remaining days grow exponentially
const yearlyProjectedEndCompound = computed(() => {
  if (todayDayOfYear <= 0 || yearlyCurrentProfit.value <= 0 || !profit.value?.profit_closed_ratio) return yearlyProjectedEnd.value;
  const ratio = profit.value.profit_closed_ratio;
  if (ratio <= 0) return yearlyProjectedEnd.value;
  const capitalInitial = totalProfit.value / ratio;
  if (capitalInitial <= 0) return yearlyProjectedEnd.value;
  const capitalNow = capitalInitial + yearlyCurrentProfit.value;
  const dailyRate = Math.pow(capitalNow / capitalInitial, 1 / todayDayOfYear) - 1;
  if (dailyRate <= 0) return yearlyProjectedEnd.value;
  // Project remaining days with compounding
  const projected = capitalNow * Math.pow(1 + dailyRate, daysInYear - todayDayOfYear) - capitalInitial;
  return projected;
});

// Monthly target = monthlyAvgProfit (the average monthly profit from period averages)
const monthlyTarget = computed(() => monthlyAvgProfit.value ?? 0);
// Yearly target = annualizedReturn
const yearlyTarget = computed(() => annualizedReturn.value ?? 0);

// Status labels
const monthlyStatus = computed(() => {
  if (!monthlyTarget.value) return '';
  const ratio = monthlyProjectedEnd.value / monthlyTarget.value;
  if (ratio >= 0.95 && ratio <= 1.05) return t('periodProfitCard.onTrack');
  if (ratio > 1.05) return t('periodProfitCard.ahead');
  return t('periodProfitCard.behind');
});

const yearlyStatus = computed(() => {
  if (!yearlyTarget.value) return '';
  const ratio = yearlyProjectedEnd.value / yearlyTarget.value;
  if (ratio >= 0.95 && ratio <= 1.05) return t('periodProfitCard.onTrack');
  if (ratio > 1.05) return t('periodProfitCard.ahead');
  return t('periodProfitCard.behind');
});

function statusColor(target: number, projected: number): string {
  if (!target) return 'text-gray-600 dark:text-gray-400';
  const ratio = projected / target;
  if (ratio >= 0.95 && ratio <= 1.05) return 'text-blue-400';
  if (ratio > 1.05) return 'text-green-400';
  return 'text-amber-400';
}

// SVG chart builder
interface ChartConfig {
  cumulative: DayProfit[];
  totalDays: number;
  todayIdx: number; // 0-based day index for today
  target: number;
  projectedEnd: number;
  currentProfit: number;
}

const SVG_W = 320;
const SVG_H = 120;
const PAD_L = 4;
const PAD_R = 4;
const PAD_T = 14;
const PAD_B = 16;
const CHART_W = SVG_W - PAD_L - PAD_R;
const CHART_H = SVG_H - PAD_T - PAD_B;

function buildSvgPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function chartData(config: ChartConfig) {
  const { cumulative, totalDays, todayIdx, target, projectedEnd, currentProfit } = config;
  // Determine Y range
  const allValues = cumulative
    .slice(0, todayIdx + 1)
    .map((d) => d.profit)
    .concat([target, projectedEnd, 0]);
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yRange = yMax - yMin || 1;

  function xPos(day: number): number {
    return PAD_L + (day / (totalDays - 1)) * CHART_W;
  }
  function yPos(val: number): number {
    return PAD_T + CHART_H - ((val - yMin) / yRange) * CHART_H;
  }

  // Actual line (day 0 to todayIdx)
  const actualPoints = cumulative.slice(0, todayIdx + 1).map((d) => ({
    x: xPos(d.day),
    y: yPos(d.profit),
  }));
  const actualPath = buildSvgPath(actualPoints);

  // Fill under actual line
  const actualFillPath =
    actualPoints.length > 0
      ? actualPath +
        ` L${actualPoints[actualPoints.length - 1].x.toFixed(1)},${yPos(0).toFixed(1)} L${actualPoints[0].x.toFixed(1)},${yPos(0).toFixed(1)} Z`
      : '';

  // Projection line (from today to end of period)
  const dailyAvg = todayIdx > 0 ? currentProfit / todayIdx : 0;
  const projPoints = [];
  for (let d = todayIdx; d < totalDays; d++) {
    const val = currentProfit + dailyAvg * (d - todayIdx);
    projPoints.push({ x: xPos(d), y: yPos(val) });
  }
  const projPath = buildSvgPath(projPoints);

  // Fill under projection
  const projFillPath =
    projPoints.length > 1
      ? projPath +
        ` L${projPoints[projPoints.length - 1].x.toFixed(1)},${yPos(0).toFixed(1)} L${projPoints[0].x.toFixed(1)},${yPos(0).toFixed(1)} Z`
      : '';

  // Target horizontal line
  const targetY = yPos(target);

  // Today vertical line
  const todayX = xPos(todayIdx);

  // Zero line
  const zeroY = yPos(0);

  return {
    actualPath,
    actualFillPath,
    projPath,
    projFillPath,
    targetY,
    todayX,
    zeroY,
    xStart: PAD_L,
    xEnd: PAD_L + CHART_W,
  };
}

const monthlyChart = computed(() =>
  chartData({
    cumulative: monthlyCumulative.value,
    totalDays: daysInMonth.value,
    todayIdx: todayDayOfMonth - 1,
    target: monthlyTarget.value,
    projectedEnd: monthlyProjectedEnd.value,
    currentProfit: monthlyCurrentProfit.value,
  }),
);

const yearlyChart = computed(() =>
  chartData({
    cumulative: yearlyCumulative.value,
    totalDays: daysInYear,
    todayIdx: todayDayOfYear - 1,
    target: yearlyTarget.value,
    projectedEnd: yearlyProjectedEnd.value,
    currentProfit: yearlyCurrentProfit.value,
  }),
);

// Month progress percentage
const monthProgress = computed(() => Math.round((todayDayOfMonth / daysInMonth.value) * 100));
const monthProfitProgress = computed(() => {
  if (!monthlyTarget.value) return 0;
  return Math.min(Math.round((monthlyCurrentProfit.value / monthlyTarget.value) * 100), 200);
});

// Period averages
const dailyAvgProfit = computed(() => {
  if (tradingPeriodDays.value < 1) return undefined;
  return totalProfit.value / tradingPeriodDays.value;
});

const weeklyAvgProfit = computed(() => {
  if (tradingPeriodDays.value < 1) return undefined;
  return totalProfit.value / (tradingPeriodDays.value / 7);
});

const monthlyAvgProfit = computed(() => {
  if (tradingPeriodDays.value < 1) return undefined;
  return totalProfit.value / (tradingPeriodDays.value / 30);
});

// Annualized return (linear)
const annualizedReturn = computed(() => {
  if (tradingPeriodDays.value < 1) return undefined;
  return totalProfit.value / (tradingPeriodDays.value / 365);
});

// Annualized return (compound — snowball effect for stake_amount: "unlimited")
const annualizedCompound = computed(() => {
  if (tradingPeriodDays.value < 1 || !profit.value?.profit_closed_ratio) return undefined;
  const ratio = profit.value.profit_closed_ratio;
  if (ratio <= 0) return undefined;
  // Reconstruct starting capital: profit / ratio = capital
  const capitalInitial = totalProfit.value / ratio;
  if (capitalInitial <= 0) return undefined;
  const capitalFinal = capitalInitial + totalProfit.value;
  // Daily compound rate
  const dailyRate = Math.pow(capitalFinal / capitalInitial, 1 / tradingPeriodDays.value) - 1;
  // Projected compound profit over 1 year
  return capitalInitial * (Math.pow(1 + dailyRate, 365) - 1);
});

// Projections at current rate
const projected1m = computed(() => {
  if (dailyAvgProfit.value === undefined) return undefined;
  return dailyAvgProfit.value * 30;
});

const projected3m = computed(() => {
  if (dailyAvgProfit.value === undefined) return undefined;
  return dailyAvgProfit.value * 90;
});

const projected1y = computed(() => {
  if (dailyAvgProfit.value === undefined) return undefined;
  return dailyAvgProfit.value * 365;
});

// Ratio versions for percent display
const dailyAvgRatio = computed(() => {
  if (tradingPeriodDays.value < 1 || !profit.value?.profit_closed_ratio) return undefined;
  return profit.value.profit_closed_ratio / tradingPeriodDays.value;
});

const weeklyAvgRatio = computed(() => {
  if (!dailyAvgRatio.value) return undefined;
  return dailyAvgRatio.value * 7;
});

const monthlyAvgRatio = computed(() => {
  if (!dailyAvgRatio.value) return undefined;
  return dailyAvgRatio.value * 30;
});

// Recent performance warning
// If "recent" profit rate (last portion) is below historical average, show warning
// Since we only have aggregate data, we approximate with CAGR vs simple rate
const isRecentBelowAvg = computed(() => {
  if (!profit.value?.cagr || !profit.value?.profit_closed_ratio) return false;
  // Very rough heuristic: if CAGR is significantly below simple annualized ratio, recent might be worse
  const simpleAnnualized = profit.value.profit_closed_ratio * (365 / Math.max(tradingPeriodDays.value, 1));
  return profit.value.cagr < simpleAnnualized * 0.7;
});

function profitColor(val: number | undefined | null): string {
  if (val === undefined || val === null) return '';
  if (val > 0) return 'text-green-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-600 dark:text-gray-400';
}
</script>

<template>
  <div class="glass-card" style="width: 540px">

    <!-- ═══ SECTION 1: Period Averages ═══ -->
    <div class="section-header">
      <i-mdi-calendar-multiselect class="text-blue-400" />
      <span>{{ t('periodProfitCard.title') }}</span>
      <span v-if="isRecentBelowAvg" class="ml-auto anomaly-warning">
        {{ t('periodProfitCard.belowAverage') }}
      </span>
    </div>

    <div v-if="!profit || tradingPeriodDays < 1 || (profit?.trade_count ?? 0) === 0" class="flex flex-col items-center justify-center py-8 gap-2">
      <i-mdi-calendar-clock class="text-3xl text-blue-400/40" />
      <div class="text-sm text-gray-800 dark:text-gray-200">{{ t('emptyStates.insufficientHistory') }}</div>
      <div class="text-xs text-gray-600 dark:text-gray-400 text-center">{{ t('emptyStates.insufficientHistoryDesc') }}</div>
    </div>

    <template v-else>
      <!-- Large weekly average -->
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-[0.8rem] text-gray-600 dark:text-gray-500 mb-0.5" v-tooltip.top="t('tooltips.weeklyAvg')">{{ t('periodProfitCard.weeklyAvg') }}</div>
            <div class="text-2xl font-bold" :class="profitColor(weeklyAvgProfit)">
              {{ weeklyAvgProfit !== undefined ? formatPriceCurrency(weeklyAvgProfit, currency, 2) : 'N/A' }}
            </div>
            <div v-if="weeklyAvgRatio !== undefined" class="text-[0.8rem]" :class="profitColor(weeklyAvgRatio)">
              {{ formatPercent(weeklyAvgRatio, 2) }} / {{ t('periodProfitCard.week') }}
            </div>
          </div>
          <div class="text-right">
            <div class="text-[0.8rem] text-gray-600 dark:text-gray-500 mb-0.5" v-tooltip.top="t('tooltips.monthlyAvg')">{{ t('periodProfitCard.monthlyAvg') }}</div>
            <div class="text-lg font-bold" :class="profitColor(monthlyAvgProfit)">
              {{ monthlyAvgProfit !== undefined ? formatPriceCurrency(monthlyAvgProfit, currency, 2) : 'N/A' }}
            </div>
            <div v-if="monthlyAvgRatio !== undefined" class="text-[0.8rem]" :class="profitColor(monthlyAvgRatio)">
              {{ formatPercent(monthlyAvgRatio, 2) }} / {{ t('periodProfitCard.month') }}
            </div>
          </div>
        </div>
      </div>

      <!-- Daily average -->
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="section-header">
          <i-mdi-clock-outline class="text-amber-400" />
          <span>{{ t('periodProfitCard.dailyBreakdown') }}</span>
        </div>
        <div class="space-y-0.5">
          <div class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.dailyAvg')">{{ t('periodProfitCard.dailyAvg') }}</span>
            <span class="stat-value" :class="profitColor(dailyAvgProfit)">
              {{ dailyAvgProfit !== undefined ? formatPriceCurrency(dailyAvgProfit, currency, 2) : 'N/A' }}
            </span>
          </div>
          <div v-if="annualizedReturn !== undefined" class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.annualizedReturn')">{{ t('periodProfitCard.annualizedReturn') }}</span>
            <span class="stat-value" :class="profitColor(annualizedReturn)">
              {{ formatPriceCurrency(annualizedReturn, currency, 0) }}
            </span>
          </div>
          <div v-if="annualizedCompound !== undefined && annualizedCompound !== annualizedReturn" class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.annualizedCompound')">{{ t('periodProfitCard.annualizedCompound') }}</span>
            <span class="stat-value font-bold" :class="profitColor(annualizedCompound)">
              {{ formatPriceCurrency(annualizedCompound, currency, 0) }}
            </span>
          </div>
          <div v-if="profit.cagr !== undefined" class="stat-row">
            <span class="stat-label" v-tooltip.top="t('tooltips.cagr')">{{ t('profit.cagr') }}</span>
            <span class="stat-value" :class="profitColor(profit.cagr)">
              {{ formatPercent(profit.cagr, 2) }}
            </span>
          </div>
        </div>
      </div>

      <!-- ═══ SECTION 2: Projections ═══ -->
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="section-header">
          <i-mdi-crystal-ball class="text-purple-400" />
          <span>{{ t('periodProfitCard.projections') }}</span>
        </div>
        <div class="text-[0.8rem] text-gray-600 mb-2">{{ t('periodProfitCard.projectionsDisclaimer') }}</div>
        <div class="grid grid-cols-3 gap-2">
          <div class="metric-cell">
            <div class="text-[0.85rem] text-gray-600 dark:text-gray-500 mb-0.5" v-tooltip.top="t('tooltips.projection1m')">1 {{ t('periodProfitCard.month') }}</div>
            <div class="font-bold text-sm" :class="profitColor(projected1m)">
              {{ projected1m !== undefined ? formatPriceCurrency(projected1m, currency, 0) : 'N/A' }}
            </div>
          </div>
          <div class="metric-cell">
            <div class="text-[0.85rem] text-gray-600 dark:text-gray-500 mb-0.5" v-tooltip.top="t('tooltips.projection3m')">3 {{ t('periodProfitCard.months') }}</div>
            <div class="font-bold text-sm" :class="profitColor(projected3m)">
              {{ projected3m !== undefined ? formatPriceCurrency(projected3m, currency, 0) : 'N/A' }}
            </div>
          </div>
          <div class="metric-cell">
            <div class="text-[0.85rem] text-gray-600 dark:text-gray-500 mb-0.5" v-tooltip.top="t('tooltips.projection1y')">1 {{ t('periodProfitCard.year') }}</div>
            <div class="font-bold text-sm" :class="profitColor(projected1y)">
              {{ projected1y !== undefined ? formatPriceCurrency(projected1y, currency, 0) : 'N/A' }}
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ SECTION 3: Monthly Projection Chart ═══ -->
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="section-header">
          <i-mdi-chart-timeline-variant class="text-green-400" />
          <span>{{ t('periodProfitCard.currentMonth') }}</span>
          <span class="ml-auto text-[0.85rem]" :class="statusColor(monthlyTarget, monthlyProjectedEnd)">
            {{ monthlyStatus }}
          </span>
        </div>

        <!-- Mini progress bar -->
        <div class="mb-2">
          <div class="flex justify-between text-[0.8rem] text-gray-600 dark:text-gray-500 mb-1">
            <span>{{ t('periodProfitCard.actual') }}: {{ formatPriceCurrency(monthlyCurrentProfit, currency, 2) }}</span>
            <span>{{ t('periodProfitCard.target') }}: {{ formatPriceCurrency(monthlyTarget, currency, 2) }}</span>
          </div>
          <div class="progress-track">
            <div
              class="progress-time"
              :style="{ width: monthProgress + '%' }"
            />
            <div
              class="progress-profit"
              :style="{ width: Math.min(monthProfitProgress, 100) + '%' }"
            />
          </div>
          <div class="flex justify-between text-[0.85rem] text-gray-600 mt-0.5">
            <span>{{ monthProgress }}% {{ t('periodProfitCard.elapsed') }}</span>
            <span>{{ monthProfitProgress }}% {{ t('periodProfitCard.ofTarget') }}</span>
          </div>
        </div>

        <!-- SVG Monthly Chart -->
        <svg :width="320" :height="120" class="projection-chart">
          <!-- Background grid -->
          <line :x1="monthlyChart.xStart" :y1="monthlyChart.zeroY" :x2="monthlyChart.xEnd" :y2="monthlyChart.zeroY" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
          <!-- Target horizontal line -->
          <line :x1="monthlyChart.xStart" :y1="monthlyChart.targetY" :x2="monthlyChart.xEnd" :y2="monthlyChart.targetY" stroke="rgba(156,163,175,0.4)" stroke-width="1" stroke-dasharray="3,3" />
          <text :x="monthlyChart.xEnd - 2" :y="monthlyChart.targetY - 3" fill="rgba(156,163,175,0.5)" font-size="9" text-anchor="end">{{ t('periodProfitCard.target') }}</text>
          <!-- Actual fill -->
          <path :d="monthlyChart.actualFillPath" fill="rgba(34,197,94,0.12)" />
          <!-- Projection fill -->
          <path :d="monthlyChart.projFillPath" fill="rgba(34,197,94,0.05)" />
          <!-- Actual line -->
          <path :d="monthlyChart.actualPath" fill="none" stroke="rgba(34,197,94,0.9)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <!-- Projection line -->
          <path :d="monthlyChart.projPath" fill="none" stroke="rgba(34,197,94,0.4)" stroke-width="1.5" stroke-dasharray="4,3" stroke-linecap="round" />
          <!-- Today vertical line -->
          <line :x1="monthlyChart.todayX" y1="14" :x2="monthlyChart.todayX" y2="104" stroke="rgba(34,211,238,0.5)" stroke-width="1" stroke-dasharray="2,2" />
          <text :x="monthlyChart.todayX" y="11" fill="rgba(34,211,238,0.7)" font-size="9" text-anchor="middle">{{ t('periodProfitCard.today') }}</text>
          <!-- X-axis labels -->
          <text :x="monthlyChart.xStart" y="116" fill="rgba(255,255,255,0.3)" font-size="9" text-anchor="start">1</text>
          <text :x="monthlyChart.xEnd" y="116" fill="rgba(255,255,255,0.3)" font-size="9" text-anchor="end">{{ daysInMonth }}</text>
        </svg>

        <div class="flex justify-between text-[0.8rem] text-gray-600 dark:text-gray-500 mt-1">
          <span>{{ t('periodProfitCard.projection') }}: {{ formatPriceCurrency(monthlyProjectedEnd, currency, 2) }}</span>
        </div>
      </div>

      <!-- ═══ SECTION 4: Yearly Projection Chart ═══ -->
      <div class="mb-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div class="section-header">
          <i-mdi-chart-areaspline class="text-purple-400" />
          <span>{{ t('periodProfitCard.currentYear') }}</span>
          <span class="ml-auto text-[0.85rem]" :class="statusColor(yearlyTarget, yearlyProjectedEnd)">
            {{ yearlyStatus }}
          </span>
        </div>

        <!-- SVG Yearly Chart -->
        <svg :width="320" :height="120" class="projection-chart">
          <!-- Background grid -->
          <line :x1="yearlyChart.xStart" :y1="yearlyChart.zeroY" :x2="yearlyChart.xEnd" :y2="yearlyChart.zeroY" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
          <!-- Target horizontal line -->
          <line :x1="yearlyChart.xStart" :y1="yearlyChart.targetY" :x2="yearlyChart.xEnd" :y2="yearlyChart.targetY" stroke="rgba(156,163,175,0.4)" stroke-width="1" stroke-dasharray="3,3" />
          <text :x="yearlyChart.xEnd - 2" :y="yearlyChart.targetY - 3" fill="rgba(156,163,175,0.5)" font-size="9" text-anchor="end">{{ t('periodProfitCard.target') }}</text>
          <!-- Actual fill -->
          <path :d="yearlyChart.actualFillPath" fill="rgba(34,197,94,0.12)" />
          <!-- Projection fill -->
          <path :d="yearlyChart.projFillPath" fill="rgba(34,197,94,0.05)" />
          <!-- Actual line -->
          <path :d="yearlyChart.actualPath" fill="none" stroke="rgba(34,197,94,0.9)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          <!-- Projection line -->
          <path :d="yearlyChart.projPath" fill="none" stroke="rgba(34,197,94,0.4)" stroke-width="1.5" stroke-dasharray="4,3" stroke-linecap="round" />
          <!-- Today vertical line -->
          <line :x1="yearlyChart.todayX" y1="14" :x2="yearlyChart.todayX" y2="104" stroke="rgba(34,211,238,0.5)" stroke-width="1" stroke-dasharray="2,2" />
          <text :x="yearlyChart.todayX" y="11" fill="rgba(34,211,238,0.7)" font-size="9" text-anchor="middle">{{ t('periodProfitCard.today') }}</text>
          <!-- X-axis labels -->
          <text :x="yearlyChart.xStart" y="116" fill="rgba(255,255,255,0.3)" font-size="9" text-anchor="start">Jan</text>
          <text :x="yearlyChart.xEnd" y="116" fill="rgba(255,255,255,0.3)" font-size="9" text-anchor="end">Dec</text>
        </svg>

        <div class="flex justify-between text-[0.8rem] text-gray-600 dark:text-gray-500 mt-1">
          <span>{{ t('periodProfitCard.actual') }}: {{ formatPriceCurrency(yearlyCurrentProfit, currency, 2) }}</span>
          <span>{{ t('periodProfitCard.projection') }}: {{ formatPriceCurrency(yearlyProjectedEnd, currency, 0) }}</span>
        </div>
        <div v-if="yearlyProjectedEndCompound !== yearlyProjectedEnd" class="flex justify-between text-[0.8rem] mt-0.5">
          <span class="text-purple-400/70">{{ t('periodProfitCard.compoundProjection') }}</span>
          <span class="text-purple-400 font-bold">{{ formatPriceCurrency(yearlyProjectedEndCompound, currency, 0) }}</span>
        </div>
      </div>

      <!-- ═══ SECTION 5: Warning if below average ═══ -->
      <div v-if="isRecentBelowAvg" class="warning-box">
        <i-mdi-alert class="text-amber-400 flex-shrink-0" />
        <span class="text-[0.8rem] text-amber-400/80">
          {{ t('periodProfitCard.belowAverageWarning') }}
        </span>
      </div>

      <!-- Trading period info -->
      <div>
        <div class="stat-row">
          <span class="stat-label" v-tooltip="t('tooltips.tradingPeriod')">{{ t('periodProfitCard.tradingPeriod') }}</span>
          <span class="stat-value">{{ formatNumber(tradingPeriodDays, 0) }} {{ t('periodProfitCard.days') }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label" v-tooltip="t('tooltips.realizedProfit')">{{ t('periodProfitCard.totalRealized') }}</span>
          <span class="stat-value" :class="profitColor(totalProfit)">
            {{ formatPriceCurrency(totalProfit, currency, 2) }}
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
  letter-spacing: 0.02em;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1px 0;
}

.stat-label {
  color: rgba(255, 255, 255, 0.35);
  font-size: 0.95rem;
}

.stat-value {
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.95rem;
}

.metric-cell {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 8px;
  text-align: center;
}

.metric-cell:hover {
  background: rgba(255, 255, 255, 0.06);
}

.anomaly-warning {
  font-size: 0.95rem;
  color: #f59e0b;
  font-weight: 600;
  animation: pulse-amber 2s ease-in-out infinite;
}

.warning-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.15);
  margin-bottom: 8px;
}

@keyframes pulse-amber {
  0%, 100% { box-shadow: 0 0 4px rgba(245, 158, 11, 0.3); }
  50% { box-shadow: 0 0 8px rgba(245, 158, 11, 0.6); }
}

.projection-chart {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  display: block;
  width: 100%;
  height: auto;
}

.progress-track {
  position: relative;
  height: 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 3px;
  overflow: hidden;
}

.progress-time {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-profit {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: rgba(34, 197, 94, 0.4);
  border-radius: 3px;
  transition: width 0.3s ease;
}
</style>
