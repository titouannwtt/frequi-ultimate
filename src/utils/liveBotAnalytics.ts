import type { ClosedTrade, Trade } from '@/types/trades';
import type { ProfitStats, AllProfitStats } from '@/types/profit';
import type { PerformanceEntry, EntryStats, ExitStats, MixTagStats } from '@/types/tradeStats';
import type { TimeSummaryReturnValue } from '@/types/daily';
import type { WalletHistory } from '@/types/daily';
import type { BotState } from '@/types/types';

export interface LiveBotInput {
  botId: string;
  botName: string;
  closedTrades: ClosedTrade[];
  openTrades: Trade[];
  profitAll?: AllProfitStats;
  performanceStats: PerformanceEntry[];
  entryStats: EntryStats[];
  exitStats: ExitStats[];
  mixTagStats: MixTagStats[];
  dailyStats: TimeSummaryReturnValue;
  weeklyStats: TimeSummaryReturnValue;
  monthlyStats: TimeSummaryReturnValue;
  balanceHistory?: WalletHistory;
  botState: BotState;
  balance: { total?: number; starting_capital?: number; stake?: string };
}

function simulateClose(trade: Trade): ClosedTrade {
  const closeRate = trade.current_rate ?? trade.open_rate;
  const now = Date.now();
  let profitRatio: number;
  if (trade.is_short) {
    profitRatio = (trade.open_rate - closeRate) / trade.open_rate;
  } else {
    profitRatio = (closeRate - trade.open_rate) / trade.open_rate;
  }
  if (trade.leverage && trade.leverage > 1) {
    profitRatio *= trade.leverage;
  }
  const feeRate = (trade.fee_open ?? 0) + (trade.fee_close ?? trade.fee_open ?? 0);
  profitRatio -= feeRate;
  const profitAbs = profitRatio * trade.stake_amount;

  return {
    ...trade,
    close_rate: closeRate,
    close_date: new Date(now).toISOString().replace('T', ' ').slice(0, 19),
    close_timestamp: now,
    fee_close: trade.fee_close ?? trade.fee_open ?? 0,
    fee_open_cost: trade.fee_open_cost ?? trade.fee_open * trade.stake_amount,
    fee_open_currency: trade.fee_open_currency ?? '',
    exit_reason: 'simulated_close',
    min_rate: Math.min(trade.open_rate, closeRate),
    max_rate: Math.max(trade.open_rate, closeRate),
    profit_ratio: profitRatio,
    profit_pct: profitRatio * 100,
    profit_abs: profitAbs,
    is_open: false,
  } as ClosedTrade;
}

export function buildLiveBotAnalytics(input: LiveBotInput): Record<string, unknown> {
  const simulatedTrades = input.openTrades.map(simulateClose);
  const allTrades = [...input.closedTrades, ...simulatedTrades].sort(
    (a, b) => (a.close_timestamp ?? 0) - (b.close_timestamp ?? 0),
  );

  if (allTrades.length === 0) {
    return { empty: true };
  }

  const profit = input.profitAll?.all;
  const stakeCurrency = input.balance.stake ?? input.botState.stake_currency ?? 'USDT';
  const startingBalance =
    input.balance.starting_capital && input.balance.starting_capital > 0
      ? input.balance.starting_capital
      : input.balance.total && input.balance.total > 0
        ? input.balance.total - allTrades.reduce((s, t) => s + (t.profit_abs ?? 0), 0)
        : 1000;
  const finalBalance =
    input.balance.total && input.balance.total > 0 ? input.balance.total : startingBalance;
  const firstTs = allTrades[0]?.open_timestamp ?? Date.now();
  const lastTs = Date.now();
  const daySpan = Math.max(1, (lastTs - firstTs) / 86400000);

  const wins = allTrades.filter((t) => (t.profit_ratio ?? 0) > 0);
  const losses = allTrades.filter((t) => (t.profit_ratio ?? 0) < 0);
  const draws = allTrades.filter((t) => (t.profit_ratio ?? 0) === 0);

  const totalProfitAbs = allTrades.reduce((s, t) => s + (t.profit_abs ?? 0), 0);
  const totalProfitPct = startingBalance > 0 ? (totalProfitAbs / startingBalance) * 100 : 0;
  const avgProfitPct =
    allTrades.length > 0
      ? allTrades.reduce((s, t) => s + (t.profit_ratio ?? 0), 0) / allTrades.length
      : 0;

  const equityCurve = buildEquityCurve(allTrades, startingBalance, input.balanceHistory);
  const drawdownSeries = buildDrawdownSeries(equityCurve);
  const topDrawdowns = findTopDrawdowns(drawdownSeries, 5);
  const monthlyReturns = buildMonthlyReturns(allTrades);
  const rollingMetrics = buildRollingMetrics(allTrades, 30);
  const hourlyPattern = buildHourlyPattern(allTrades);
  const tradePnlDistribution = buildPnlDistribution(allTrades);
  const durationScatter = buildDurationScatter(allTrades);
  const exitReasonDetail = buildExitReasonDetail(allTrades);
  const streaks = buildStreaks(allTrades);
  const riskMetrics = buildRiskMetrics(allTrades, startingBalance);
  const longShortSplit = buildLongShortSplit(allTrades);
  const weekdayPattern = buildWeekdayPattern(allTrades);
  const rollingWinrate = buildRollingWinrate(allTrades, 20);
  const rollingProfitFactor = buildRollingProfitFactor(allTrades, 20);
  const dcaAnalysis = buildDcaAnalysis(allTrades);
  const durationBuckets = buildDurationBuckets(allTrades);

  const pairResults = buildPairResults(allTrades);
  const sortedPairs = [...pairResults].sort((a, b) => b.profit_total_abs - a.profit_total_abs);

  const summary: Record<string, unknown> = {
    total_trades: allTrades.length,
    total_profit_pct: totalProfitPct,
    profit_total: totalProfitPct / 100,
    profit_total_abs: totalProfitAbs,
    profit_mean: avgProfitPct,
    starting_balance: startingBalance,
    final_balance: finalBalance,
    stake_currency: stakeCurrency,
    backtest_start: new Date(firstTs).toISOString().slice(0, 10),
    backtest_end: new Date(lastTs).toISOString().slice(0, 10),
    backtest_days: Math.round(daySpan),
    trades_per_day: allTrades.length / daySpan,
    market_change: 0,
    winning_days: countProfitDays(allTrades, 'win'),
    losing_days: countProfitDays(allTrades, 'loss'),
    draw_days: countProfitDays(allTrades, 'draw'),
    backtest_best_day: 0,
    backtest_worst_day: 0,
    backtest_best_day_abs: 0,
    backtest_worst_day_abs: 0,
    avg_stake_amount:
      allTrades.length > 0
        ? allTrades.reduce((s, t) => s + t.stake_amount, 0) / allTrades.length
        : 0,
    total_volume: allTrades.reduce((s, t) => s + t.stake_amount, 0),
    best_pair: sortedPairs[0] ?? { key: '-', profit_total_pct: 0 },
    worst_pair: sortedPairs[sortedPairs.length - 1] ?? { key: '-', profit_total_pct: 0 },
    holding_avg: formatDuration(
      allTrades.reduce((s, t) => s + ((t.close_timestamp ?? 0) - t.open_timestamp), 0) /
        Math.max(1, allTrades.length),
    ),
    winner_holding_avg: formatDuration(
      wins.reduce((s, t) => s + ((t.close_timestamp ?? 0) - t.open_timestamp), 0) /
        Math.max(1, wins.length),
    ),
    loser_holding_avg: formatDuration(
      losses.reduce((s, t) => s + ((t.close_timestamp ?? 0) - t.open_timestamp), 0) /
        Math.max(1, losses.length),
    ),
    max_consecutive_wins: streaks.max_consecutive_wins,
    max_consecutive_losses: streaks.max_consecutive_losses,
    sharpe: profit?.sharpe ?? computeSharpe(allTrades),
    sortino: profit?.sortino ?? computeSortino(allTrades),
    calmar: profit?.calmar,
    sqn: profit?.sqn ?? computeSqn(allTrades),
    expectancy: profit?.expectancy,
    expectancy_ratio: profit?.expectancy_ratio,
    profit_factor: profit?.profit_factor ?? computeProfitFactor(allTrades),
    cagr: profit?.cagr,
    max_drawdown_account: profit?.max_drawdown ?? findMaxDrawdown(drawdownSeries),
    max_drawdown_abs: profit?.max_drawdown_abs,
    winrate: wins.length / Math.max(1, allTrades.length),
    trade_count_long: allTrades.filter((t) => !t.is_short).length,
    trade_count_short: allTrades.filter((t) => t.is_short).length,
    results_per_pair: pairResults,
    results_per_enter_tag: buildEnterTagResults(allTrades),
    exit_reason_summary: exitReasonDetail,
  };

  const dailyPnl = buildDailyPnl(allTrades);
  if (dailyPnl.length > 0) {
    const bestDay = dailyPnl.reduce((best, d) => (d.pnl > best.pnl ? d : best), dailyPnl[0]);
    const worstDay = dailyPnl.reduce((worst, d) => (d.pnl < worst.pnl ? d : worst), dailyPnl[0]);
    summary.backtest_best_day_abs = bestDay.pnl;
    summary.backtest_worst_day_abs = worstDay.pnl;
    summary.backtest_best_day = startingBalance > 0 ? bestDay.pnl / startingBalance : 0;
    summary.backtest_worst_day = startingBalance > 0 ? worstDay.pnl / startingBalance : 0;
  }

  return {
    backtest_summary: summary,
    equity_curve: equityCurve,
    starting_balance: startingBalance,
    drawdown_series: drawdownSeries,
    top_drawdowns: topDrawdowns,
    monthly_returns: monthlyReturns,
    rolling_metrics: rollingMetrics,
    hourly_pattern: hourlyPattern,
    trade_pnl_distribution: tradePnlDistribution,
    duration_scatter: durationScatter,
    exit_reason_detail: exitReasonDetail,
    streaks,
    risk_metrics: riskMetrics,
    long_short_split: longShortSplit,
    weekday_pattern: weekdayPattern,
    rolling_winrate: rollingWinrate,
    rolling_profit_factor: rollingProfitFactor,
    dca_analysis: dcaAnalysis,
    duration_buckets: durationBuckets,
    simulated_close_count: simulatedTrades.length,
    is_live_bot: true,
  };
}

function buildEquityCurve(
  trades: ClosedTrade[],
  startingBalance: number,
  walletHistory?: WalletHistory,
): { date: string; balance: number }[] {
  if (walletHistory?.data?.length && walletHistory.columns?.length) {
    const dateIdx = walletHistory.columns.indexOf('date');
    const balIdx = walletHistory.columns.indexOf('balance');
    if (dateIdx >= 0 && balIdx >= 0) {
      const points = walletHistory.data
        .map((row) => ({ date: String(row[dateIdx]), balance: Number(row[balIdx]) }))
        .filter((p) => p.date && !isNaN(p.balance));
      if (points.length > 0) return points;
    }
  }
  const curve: { date: string; balance: number }[] = [];
  let bal = startingBalance;
  for (const t of trades) {
    bal += t.profit_abs ?? 0;
    const dateStr = t.close_date
      ? t.close_date.slice(0, 10)
      : new Date(t.close_timestamp ?? 0).toISOString().slice(0, 10);
    curve.push({ date: dateStr, balance: bal });
  }
  if (curve.length > 0) {
    curve.unshift({ date: curve[0].date, balance: startingBalance });
  }
  return curve;
}

function buildDrawdownSeries(
  equity: { date: string; balance: number }[],
): { date: string; dd_pct: number }[] {
  let peak = 0;
  return equity.map((e) => {
    if (e.balance > peak) peak = e.balance;
    const dd = peak > 0 ? ((e.balance - peak) / peak) * 100 : 0;
    return { date: e.date, dd_pct: dd };
  });
}

function findMaxDrawdown(dd: { dd_pct: number }[]): number {
  if (dd.length === 0) return 0;
  return Math.abs(Math.min(...dd.map((d) => d.dd_pct)));
}

interface DrawdownEvent {
  start: string;
  valley: string;
  end: string;
  depth_pct: number;
  decline_days?: number;
  recovery_days?: number;
  total_days?: number;
  active?: boolean;
}

function findTopDrawdowns(dd: { date: string; dd_pct: number }[], count: number): DrawdownEvent[] {
  if (dd.length === 0) return [];
  const events: DrawdownEvent[] = [];
  let inDD = false;
  let start = '';
  let valley = '';
  let minPct = 0;

  for (let i = 0; i < dd.length; i++) {
    const d = dd[i];
    if (d.dd_pct < -0.01) {
      if (!inDD) {
        inDD = true;
        start = d.date;
        valley = d.date;
        minPct = d.dd_pct;
      } else if (d.dd_pct < minPct) {
        minPct = d.dd_pct;
        valley = d.date;
      }
    } else if (inDD) {
      events.push({ start, valley, end: d.date, depth_pct: Math.abs(minPct) });
      inDD = false;
    }
  }
  if (inDD) {
    events.push({
      start,
      valley,
      end: dd[dd.length - 1].date,
      depth_pct: Math.abs(minPct),
      active: true,
    });
  }
  return events.sort((a, b) => b.depth_pct - a.depth_pct).slice(0, count);
}

function buildMonthlyReturns(
  trades: ClosedTrade[],
): { year: number; month: number; profit_abs: number; trades: number }[] {
  const map = new Map<
    string,
    { year: number; month: number; profit_abs: number; trades: number }
  >();
  for (const t of trades) {
    const d = new Date(t.close_timestamp ?? 0);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    const existing = map.get(key);
    if (existing) {
      existing.profit_abs += t.profit_abs ?? 0;
      existing.trades += 1;
    } else {
      map.set(key, {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        profit_abs: t.profit_abs ?? 0,
        trades: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}

function buildRollingMetrics(
  trades: ClosedTrade[],
  window: number,
): {
  sharpe: { date: string; value: number }[];
  sortino: { date: string; value: number }[];
  volatility: { date: string; value: number }[];
  window: number;
} {
  const result = {
    sharpe: [] as { date: string; value: number }[],
    sortino: [] as { date: string; value: number }[],
    volatility: [] as { date: string; value: number }[],
    window,
  };
  if (trades.length < window) return result;

  for (let i = window; i <= trades.length; i++) {
    const slice = trades.slice(i - window, i);
    const date = slice[slice.length - 1].close_date ?? '';
    const returns = slice.map((t) => t.profit_ratio ?? 0);
    const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
    const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    const downside = Math.sqrt(
      returns.filter((r) => r < 0).reduce((s, v) => s + v ** 2, 0) / Math.max(1, returns.length),
    );

    result.sharpe.push({ date, value: std > 0 ? (mean / std) * Math.sqrt(252) : 0 });
    result.sortino.push({ date, value: downside > 0 ? (mean / downside) * Math.sqrt(252) : 0 });
    result.volatility.push({ date, value: std * Math.sqrt(252) * 100 });
  }
  return result;
}

function buildHourlyPattern(trades: ClosedTrade[]) {
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    count: 0,
    totalProfit: 0,
    wins: 0,
  }));
  for (const t of trades) {
    const h = new Date(t.open_timestamp).getHours();
    hours[h].count++;
    hours[h].totalProfit += t.profit_ratio ?? 0;
    if ((t.profit_ratio ?? 0) > 0) hours[h].wins++;
  }
  return {
    hours: hours.map((h) => ({
      hour: h.hour,
      avg_profit: h.count > 0 ? h.totalProfit / h.count : 0,
      winrate: h.count > 0 ? h.wins / h.count : 0,
      trades: h.count,
    })),
  };
}

function buildPnlDistribution(trades: ClosedTrade[]) {
  const returns = trades.map((t) => (t.profit_ratio ?? 0) * 100);
  if (returns.length === 0)
    return {
      bins: [],
      counts: [],
      total: 0,
      mean: 0,
      median: 0,
      std: 0,
      avg_win: 0,
      avg_loss: 0,
      best_trade: 0,
      worst_trade: 0,
    };

  const sorted = [...returns].sort((a, b) => a - b);
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const std = Math.sqrt(returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length);
  const winReturns = returns.filter((r) => r > 0);
  const lossReturns = returns.filter((r) => r < 0);

  const binCount = Math.min(50, Math.max(10, Math.ceil(Math.sqrt(returns.length))));
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const binWidth = (max - min) / binCount || 1;
  const bins: number[] = [];
  const counts: number[] = [];
  for (let i = 0; i < binCount; i++) {
    bins.push(min + binWidth * (i + 0.5));
    const lo = min + binWidth * i;
    const hi = lo + binWidth;
    counts.push(returns.filter((r) => r >= lo && (i === binCount - 1 ? r <= hi : r < hi)).length);
  }

  return {
    bins,
    counts,
    total: returns.length,
    mean,
    median,
    std,
    avg_win: winReturns.length > 0 ? winReturns.reduce((s, v) => s + v, 0) / winReturns.length : 0,
    avg_loss:
      lossReturns.length > 0 ? lossReturns.reduce((s, v) => s + v, 0) / lossReturns.length : 0,
    best_trade: max,
    worst_trade: min,
  };
}

function buildDurationScatter(
  trades: ClosedTrade[],
): { duration: number; profit: number; pair: string }[] {
  return trades.map((t) => ({
    duration: ((t.close_timestamp ?? 0) - t.open_timestamp) / 3600000,
    profit: (t.profit_ratio ?? 0) * 100,
    pair: t.pair,
  }));
}

function buildExitReasonDetail(trades: ClosedTrade[]) {
  const map = new Map<
    string,
    { count: number; totalProfit: number; wins: number; losses: number }
  >();
  for (const t of trades) {
    const reason = t.exit_reason ?? 'unknown';
    const e = map.get(reason) ?? { count: 0, totalProfit: 0, wins: 0, losses: 0 };
    e.count++;
    e.totalProfit += t.profit_ratio ?? 0;
    if ((t.profit_ratio ?? 0) > 0) e.wins++;
    else e.losses++;
    map.set(reason, e);
  }
  return [...map.entries()].map(([reason, e]) => ({
    reason,
    count: e.count,
    avg_profit: e.count > 0 ? (e.totalProfit / e.count) * 100 : 0,
    total_profit: e.totalProfit * 100,
    wins: e.wins,
    losses: e.losses,
    winrate: e.count > 0 ? e.wins / e.count : 0,
  }));
}

function buildStreaks(trades: ClosedTrade[]) {
  let maxWin = 0,
    maxLoss = 0,
    curWin = 0,
    curLoss = 0;
  const winsCount = trades.filter((t) => (t.profit_ratio ?? 0) > 0).length;
  const lossesCount = trades.filter((t) => (t.profit_ratio ?? 0) < 0).length;
  const drawsCount = trades.filter((t) => (t.profit_ratio ?? 0) === 0).length;

  for (const t of trades) {
    if ((t.profit_ratio ?? 0) > 0) {
      curWin++;
      curLoss = 0;
    } else if ((t.profit_ratio ?? 0) < 0) {
      curLoss++;
      curWin = 0;
    } else {
      curWin = 0;
      curLoss = 0;
    }
    maxWin = Math.max(maxWin, curWin);
    maxLoss = Math.max(maxLoss, curLoss);
  }
  return {
    max_consecutive_wins: maxWin,
    max_consecutive_losses: maxLoss,
    wins: winsCount,
    losses: lossesCount,
    draws: drawsCount,
  };
}

function buildRiskMetrics(trades: ClosedTrade[], startingBalance: number) {
  const returns = trades.map((t) => t.profit_ratio ?? 0);
  if (returns.length < 2) return {};

  const sorted = [...returns].sort((a, b) => a - b);
  const idx95 = Math.floor(returns.length * 0.05);
  const var95 = Math.abs(sorted[idx95] ?? 0) * 100;
  const cvar95 =
    (sorted.slice(0, idx95 + 1).reduce((s, v) => s + Math.abs(v), 0) / Math.max(1, idx95 + 1)) *
    100;

  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const totalProfit = returns.reduce((s, v) => s + v, 0);
  const totalLoss = returns.filter((r) => r < 0).reduce((s, v) => s + Math.abs(v), 0);
  const gainPainRatio = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0;

  const winRate = returns.filter((r) => r > 0).length / returns.length;
  const avgWin =
    returns.filter((r) => r > 0).reduce((s, v) => s + v, 0) /
    Math.max(1, returns.filter((r) => r > 0).length);
  const avgLoss =
    Math.abs(returns.filter((r) => r < 0).reduce((s, v) => s + v, 0)) /
    Math.max(1, returns.filter((r) => r < 0).length);
  const kelly = avgLoss > 0 ? winRate - (1 - winRate) / (avgWin / avgLoss) : 0;

  return {
    var_95: var95,
    cvar_95: cvar95,
    omega: 0,
    tail_ratio: 0,
    ulcer_index: 0,
    recovery_factor: 0,
    gain_pain_ratio: gainPainRatio,
    kelly_criterion: kelly * 100,
  };
}

function buildLongShortSplit(trades: ClosedTrade[]) {
  function sideStats(tds: ClosedTrade[]) {
    const wins = tds.filter((t) => (t.profit_ratio ?? 0) > 0);
    const losses = tds.filter((t) => (t.profit_ratio ?? 0) < 0);
    return {
      count: tds.length,
      total_profit: tds.reduce((s, t) => s + (t.profit_abs ?? 0), 0),
      avg_profit:
        tds.length > 0 ? tds.reduce((s, t) => s + (t.profit_ratio ?? 0), 0) / tds.length : 0,
      wins: wins.length,
      losses: losses.length,
      winrate: tds.length > 0 ? wins.length / tds.length : 0,
      avg_duration:
        tds.length > 0
          ? tds.reduce((s, t) => s + ((t.close_timestamp ?? 0) - t.open_timestamp), 0) /
            tds.length /
            3600000
          : 0,
    };
  }
  return {
    long: sideStats(trades.filter((t) => !t.is_short)),
    short: sideStats(trades.filter((t) => t.is_short)),
  };
}

function buildWeekdayPattern(trades: ClosedTrade[]) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = Array.from({ length: 7 }, (_, d) => ({
    dayIndex: d,
    count: 0,
    totalProfit: 0,
    wins: 0,
  }));
  for (const t of trades) {
    const d = new Date(t.open_timestamp).getDay();
    days[d].count++;
    days[d].totalProfit += t.profit_ratio ?? 0;
    if ((t.profit_ratio ?? 0) > 0) days[d].wins++;
  }
  // WeekdayPatternChart expects Mon=0..Sun=6, JS getDay() gives Sun=0..Sat=6
  // Remap: Mon(1)→0, Tue(2)→1, ..., Sun(0)→6
  const reordered = [1, 2, 3, 4, 5, 6, 0];
  return {
    days: reordered.map((jsDay, i) => ({
      day: dayNames[jsDay],
      day_index: i,
      trades: days[jsDay].count,
      avg_profit: days[jsDay].count > 0 ? days[jsDay].totalProfit / days[jsDay].count : 0,
      total_profit: days[jsDay].totalProfit,
      winrate: days[jsDay].count > 0 ? days[jsDay].wins / days[jsDay].count : 0,
    })),
  };
}

function buildRollingWinrate(
  trades: ClosedTrade[],
  window: number,
): { index: number; date: string; winrate: number }[] {
  const result: { index: number; date: string; winrate: number }[] = [];
  for (let i = window; i <= trades.length; i++) {
    const slice = trades.slice(i - window, i);
    const wins = slice.filter((t) => (t.profit_ratio ?? 0) > 0).length;
    result.push({
      index: i,
      date: slice[slice.length - 1].close_date ?? '',
      winrate: wins / window,
    });
  }
  return result;
}

function buildRollingProfitFactor(
  trades: ClosedTrade[],
  window: number,
): { index: number; date: string; profit_factor: number }[] {
  const result: { index: number; date: string; profit_factor: number }[] = [];
  for (let i = window; i <= trades.length; i++) {
    const slice = trades.slice(i - window, i);
    const gains = slice
      .filter((t) => (t.profit_ratio ?? 0) > 0)
      .reduce((s, t) => s + (t.profit_ratio ?? 0), 0);
    const losses = Math.abs(
      slice.filter((t) => (t.profit_ratio ?? 0) < 0).reduce((s, t) => s + (t.profit_ratio ?? 0), 0),
    );
    result.push({
      index: i,
      date: slice[slice.length - 1].close_date ?? '',
      profit_factor: losses > 0 ? gains / losses : gains > 0 ? 10 : 1,
    });
  }
  return result;
}

function buildDcaAnalysis(trades: ClosedTrade[]) {
  const singleTrades = trades.filter((t) => (t.nr_of_successful_entries ?? 1) <= 1);
  const multiTrades = trades.filter((t) => (t.nr_of_successful_entries ?? 1) > 1);
  if (multiTrades.length === 0) return { no_dca: true };

  const maxEntries = Math.max(...trades.map((t) => t.nr_of_successful_entries ?? 1));
  const avgEntries =
    trades.reduce((s, t) => s + (t.nr_of_successful_entries ?? 1), 0) / trades.length;

  const levelDist = buildDcaLevels(trades);

  const singleAvg =
    singleTrades.length > 0
      ? singleTrades.reduce((s, t) => s + (t.profit_ratio ?? 0), 0) / singleTrades.length
      : 0;
  const multiAvg =
    multiTrades.length > 0
      ? multiTrades.reduce((s, t) => s + (t.profit_ratio ?? 0), 0) / multiTrades.length
      : 0;

  const multiWins = multiTrades.filter((t) => (t.profit_ratio ?? 0) > 0).length;
  const recoveryRate = multiTrades.length > 0 ? multiWins / multiTrades.length : 0;

  const singleProfitTotal = singleTrades.reduce((s, t) => s + (t.profit_abs ?? 0), 0);
  const multiProfitTotal = multiTrades.reduce((s, t) => s + (t.profit_abs ?? 0), 0);
  const totalProfit = singleProfitTotal + multiProfitTotal;

  const pairMap = new Map<string, { entries: number; profit: number; count: number }>();
  for (const t of multiTrades) {
    const e = pairMap.get(t.pair) ?? { entries: 0, profit: 0, count: 0 };
    e.entries += t.nr_of_successful_entries ?? 1;
    e.profit += t.profit_ratio ?? 0;
    e.count++;
    pairMap.set(t.pair, e);
  }

  return {
    total_trades: trades.length,
    max_entries: maxEntries,
    avg_entries: avgEntries,
    level_distribution: levelDist,
    recovery_rate: recoveryRate,
    single_entry_avg: singleAvg * 100,
    multi_entry_avg: multiAvg * 100,
    single_count: singleTrades.length,
    multi_count: multiTrades.length,
    profit_contribution_single: totalProfit !== 0 ? singleProfitTotal / totalProfit : 0,
    profit_contribution_multi: totalProfit !== 0 ? multiProfitTotal / totalProfit : 0,
    pair_dca_stats: [...pairMap.entries()].map(([pair, e]) => ({
      pair,
      avg_entries: e.count > 0 ? e.entries / e.count : 0,
      avg_profit: e.count > 0 ? (e.profit / e.count) * 100 : 0,
      trades: e.count,
    })),
    insights: [],
  };
}

function buildDcaLevels(trades: ClosedTrade[]) {
  const map = new Map<
    number,
    {
      count: number;
      totalProfit: number;
      totalProfitAbs: number;
      wins: number;
      totalDuration: number;
      totalStake: number;
    }
  >();
  for (const t of trades) {
    const level = t.nr_of_successful_entries ?? 1;
    const e = map.get(level) ?? {
      count: 0,
      totalProfit: 0,
      totalProfitAbs: 0,
      wins: 0,
      totalDuration: 0,
      totalStake: 0,
    };
    e.count++;
    e.totalProfit += t.profit_ratio ?? 0;
    e.totalProfitAbs += t.profit_abs ?? 0;
    e.totalDuration += (t.close_timestamp ?? 0) - t.open_timestamp;
    e.totalStake += t.stake_amount ?? 0;
    if ((t.profit_ratio ?? 0) > 0) e.wins++;
    map.set(level, e);
  }
  const total = trades.length;
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, e]) => ({
      level,
      label: level === 1 ? 'Single entry' : `${level} entries`,
      count: e.count,
      pct_of_total: total > 0 ? e.count / total : 0,
      avg_profit: (e.totalProfit / e.count) * 100,
      total_profit: e.totalProfitAbs,
      winrate: e.wins / e.count,
      avg_duration: e.totalDuration / e.count / 3600000,
      avg_stake: e.totalStake / e.count,
    }));
}

function buildDurationBuckets(trades: ClosedTrade[]) {
  const buckets = [
    { label: '< 1h', max: 3600000 },
    { label: '1-4h', max: 14400000 },
    { label: '4-12h', max: 43200000 },
    { label: '12-24h', max: 86400000 },
    { label: '1-3d', max: 259200000 },
    { label: '3-7d', max: 604800000 },
    { label: '> 7d', max: Infinity },
  ];
  return buckets.map((b) => {
    const prev = buckets[buckets.indexOf(b) - 1]?.max ?? 0;
    const inBucket = trades.filter((t) => {
      const dur = (t.close_timestamp ?? 0) - t.open_timestamp;
      return dur >= prev && dur < b.max;
    });
    return {
      label: b.label,
      count: inBucket.length,
      avg_profit:
        inBucket.length > 0
          ? inBucket.reduce((s, t) => s + (t.profit_ratio ?? 0), 0) / inBucket.length
          : 0,
      winrate:
        inBucket.length > 0
          ? inBucket.filter((t) => (t.profit_ratio ?? 0) > 0).length / inBucket.length
          : 0,
    };
  });
}

function buildPairResults(trades: ClosedTrade[]) {
  const map = new Map<
    string,
    {
      trades: number;
      wins: number;
      losses: number;
      draws: number;
      totalProfit: number;
      totalProfitAbs: number;
    }
  >();
  for (const t of trades) {
    const e = map.get(t.pair) ?? {
      trades: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      totalProfit: 0,
      totalProfitAbs: 0,
    };
    e.trades++;
    e.totalProfit += t.profit_ratio ?? 0;
    e.totalProfitAbs += t.profit_abs ?? 0;
    if ((t.profit_ratio ?? 0) > 0) e.wins++;
    else if ((t.profit_ratio ?? 0) < 0) e.losses++;
    else e.draws++;
    map.set(t.pair, e);
  }
  return [...map.entries()].map(([key, e]) => ({
    key,
    trades: e.trades,
    wins: e.wins,
    losses: e.losses,
    draws: e.draws,
    profit_total: e.totalProfit,
    profit_total_abs: e.totalProfitAbs,
    profit_total_pct: e.totalProfit * 100,
    profit_mean: e.trades > 0 ? e.totalProfit / e.trades : 0,
    profit_mean_pct: e.trades > 0 ? (e.totalProfit / e.trades) * 100 : 0,
    duration_avg: '',
    winrate: e.trades > 0 ? e.wins / e.trades : 0,
  }));
}

function buildEnterTagResults(trades: ClosedTrade[]) {
  const map = new Map<
    string,
    {
      trades: number;
      wins: number;
      losses: number;
      draws: number;
      totalProfit: number;
      totalProfitAbs: number;
    }
  >();
  for (const t of trades) {
    const tag = t.enter_tag ?? '';
    const e = map.get(tag) ?? {
      trades: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      totalProfit: 0,
      totalProfitAbs: 0,
    };
    e.trades++;
    e.totalProfit += t.profit_ratio ?? 0;
    e.totalProfitAbs += t.profit_abs ?? 0;
    if ((t.profit_ratio ?? 0) > 0) e.wins++;
    else if ((t.profit_ratio ?? 0) < 0) e.losses++;
    else e.draws++;
    map.set(tag, e);
  }
  return [...map.entries()].map(([key, e]) => ({
    key,
    trades: e.trades,
    wins: e.wins,
    losses: e.losses,
    draws: e.draws,
    profit_total: e.totalProfit,
    profit_total_abs: e.totalProfitAbs,
    profit_total_pct: e.totalProfit * 100,
    profit_mean: e.trades > 0 ? e.totalProfit / e.trades : 0,
    profit_mean_pct: e.trades > 0 ? (e.totalProfit / e.trades) * 100 : 0,
    duration_avg: '',
    winrate: e.trades > 0 ? e.wins / e.trades : 0,
  }));
}

function buildDailyPnl(trades: ClosedTrade[]): { date: string; pnl: number }[] {
  const map = new Map<string, number>();
  for (const t of trades) {
    const d = (t.close_date ?? '').slice(0, 10);
    if (d) map.set(d, (map.get(d) ?? 0) + (t.profit_abs ?? 0));
  }
  return [...map.entries()]
    .map(([date, pnl]) => ({ date, pnl }))
    .sort((a, b) => (a.date > b.date ? 1 : -1));
}

function countProfitDays(trades: ClosedTrade[], type: 'win' | 'loss' | 'draw'): number {
  const daily = buildDailyPnl(trades);
  if (type === 'win') return daily.filter((d) => d.pnl > 0).length;
  if (type === 'loss') return daily.filter((d) => d.pnl < 0).length;
  return daily.filter((d) => d.pnl === 0).length;
}

function computeSharpe(trades: ClosedTrade[]): number {
  const returns = trades.map((t) => t.profit_ratio ?? 0);
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const std = Math.sqrt(returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length);
  return std > 0 ? (mean / std) * Math.sqrt(252) : 0;
}

function computeSortino(trades: ClosedTrade[]): number {
  const returns = trades.map((t) => t.profit_ratio ?? 0);
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const downside = Math.sqrt(
    returns.filter((r) => r < 0).reduce((s, v) => s + v ** 2, 0) / returns.length,
  );
  return downside > 0 ? (mean / downside) * Math.sqrt(252) : 0;
}

function computeSqn(trades: ClosedTrade[]): number {
  const returns = trades.map((t) => t.profit_ratio ?? 0);
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const std = Math.sqrt(returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length);
  return std > 0 ? (mean / std) * Math.sqrt(returns.length) : 0;
}

function computeProfitFactor(trades: ClosedTrade[]): number {
  const gains = trades
    .filter((t) => (t.profit_ratio ?? 0) > 0)
    .reduce((s, t) => s + (t.profit_ratio ?? 0), 0);
  const losses = Math.abs(
    trades.filter((t) => (t.profit_ratio ?? 0) < 0).reduce((s, t) => s + (t.profit_ratio ?? 0), 0),
  );
  return losses > 0 ? gains / losses : gains > 0 ? Infinity : 0;
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${minutes}m`;
}
