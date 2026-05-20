import { describe, it, expect } from 'vitest';
import {
  getProfitPeriodCutoff,
  aggregateProfitByBot,
  PROFIT_PERIODS,
  type TradeProfitInput,
} from '@/utils/botProfit';

const NOW = new Date('2026-05-20T12:00:00Z').getTime();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

describe('getProfitPeriodCutoff', () => {
  it('returns rolling windows for hour/day periods', () => {
    expect(getProfitPeriodCutoff('24h', NOW)).toBe(NOW - 24 * HOUR);
    expect(getProfitPeriodCutoff('48h', NOW)).toBe(NOW - 48 * HOUR);
    expect(getProfitPeriodCutoff('7d', NOW)).toBe(NOW - 7 * DAY);
    expect(getProfitPeriodCutoff('14d', NOW)).toBe(NOW - 14 * DAY);
  });

  it('returns local start-of-day for "today"', () => {
    const cutoff = getProfitPeriodCutoff('today', NOW);
    const d = new Date(cutoff);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(cutoff).toBeLessThanOrEqual(NOW);
    expect(cutoff).toBeGreaterThan(NOW - DAY);
  });

  it('returns calendar-aware cutoffs for months and year', () => {
    expect(getProfitPeriodCutoff('1m', NOW)).toBe(new Date('2026-04-20T12:00:00Z').getTime());
    expect(getProfitPeriodCutoff('3m', NOW)).toBe(new Date('2026-02-20T12:00:00Z').getTime());
    expect(getProfitPeriodCutoff('1y', NOW)).toBe(new Date('2025-05-20T12:00:00Z').getTime());
  });

  it('returns 0 (no lower bound) for "all"', () => {
    expect(getProfitPeriodCutoff('all', NOW)).toBe(0);
  });

  it('exposes 11 period options', () => {
    expect(PROFIT_PERIODS).toHaveLength(11);
    expect(PROFIT_PERIODS.map((p) => p.key)).toContain('all');
  });
});

describe('aggregateProfitByBot', () => {
  const trades: TradeProfitInput[] = [
    { botId: 'a', botName: 'Alpha', profit_abs: 10, close_timestamp: NOW - 2 * HOUR },
    { botId: 'a', botName: 'Alpha', profit_abs: -4, close_timestamp: NOW - 30 * HOUR },
    { botId: 'b', botName: 'Beta', profit_abs: -7, close_timestamp: NOW - 1 * HOUR },
    { botId: 'c', botName: 'Gamma', profit_abs: 100, close_timestamp: NOW - 10 * DAY },
  ];

  it('sums profit per bot within the period and counts trades', () => {
    const res = aggregateProfitByBot(trades, getProfitPeriodCutoff('24h', NOW));
    const byId = Object.fromEntries(res.map((e) => [e.botId, e]));
    expect(byId.a.profit).toBe(10); // only the -2h trade is within 24h
    expect(byId.a.tradeCount).toBe(1);
    expect(byId.b.profit).toBe(-7);
  });

  it('keeps bots with no trades in the period (profit 0)', () => {
    const res = aggregateProfitByBot(trades, getProfitPeriodCutoff('24h', NOW));
    // Gamma traded 10 days ago -> outside 24h -> still present at 0
    const gamma = res.find((e) => e.botId === 'c');
    expect(gamma).toBeDefined();
    expect(gamma?.profit).toBe(0);
    expect(gamma?.tradeCount).toBe(0);
  });

  it('includes everything when cutoff is 0 (all)', () => {
    const res = aggregateProfitByBot(trades, 0);
    const byId = Object.fromEntries(res.map((e) => [e.botId, e]));
    expect(byId.a.profit).toBe(6); // 10 - 4
    expect(byId.a.tradeCount).toBe(2);
    expect(byId.c.profit).toBe(100);
  });

  it('applies the currency conversion callback per bot', () => {
    const convert = (amount: number, botId: string) => (botId === 'c' ? amount * 0.5 : amount);
    const res = aggregateProfitByBot(trades, 0, convert);
    expect(res.find((e) => e.botId === 'c')?.profit).toBe(50);
    expect(res.find((e) => e.botId === 'a')?.profit).toBe(6);
  });

  it('falls back to botId as name and ignores entries without botId', () => {
    const res = aggregateProfitByBot(
      [
        { botId: 'x', profit_abs: 5, close_timestamp: NOW },
        { botId: '', profit_abs: 999, close_timestamp: NOW },
      ],
      0,
    );
    expect(res).toHaveLength(1);
    expect(res[0].botName).toBe('x');
  });
});
