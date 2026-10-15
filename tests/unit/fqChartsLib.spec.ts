import { describe, expect, it, vi } from 'vitest';

import {
  makeCandles,
  makeClosedTrades,
  makeLogLines,
  makeRecon,
} from '@/components/fq/fixtures/charts';
import { FIXTURE_NOW, makeFleet, makePosition as makePos } from '@/components/fq/fixtures';
import { drawdownPct } from '@/components/fq/lib/bots';
import {
  bucketsNeeded,
  dayTint,
  monthGrid,
  monthKey,
  monthOf,
  shiftMonth,
} from '@/components/fq/lib/calendar';
import {
  DATE_COL,
  ALL_OVERLAYS,
  indexAt,
  legendAt,
  levelLines,
  mergeTail,
  overlaysFromPosition,
  toCandleSet,
} from '@/components/fq/lib/candles';
import {
  binLabel,
  dcaDepth,
  distribution,
  exitReasons,
  knownPct,
  knownProfit,
  resultByBot,
  type JournalTrade,
} from '@/components/fq/lib/journal';
import {
  downsample,
  drawdownSeries,
  maxDrawdownAbs,
  periodStartMs,
  variation,
  type Point,
} from '@/components/fq/lib/equity';
import { itemsFromBots, rank } from '@/components/fq/lib/leaderboard';
import {
  TimeoutError,
  filterEntries,
  levelRank,
  mergeEntries,
  toEntries,
  withTimeout,
} from '@/components/fq/lib/logs';
import {
  lockItems,
  matchesPair,
  positionItems,
  signalItems,
  whitelistItems,
} from '@/components/fq/lib/pairs';
import { nextSweepInMs, onChainNotional, reconView, sortRecon } from '@/components/fq/lib/recon';
import { migrationView, registryRows, sortRegistry } from '@/components/fq/lib/registry';
import {
  budgetTone,
  hitRateTone,
  isKnownReason,
  liquidationTone,
  riskModel,
  sortReasons,
} from '@/components/fq/lib/risk';
import { pnlPeriods } from '@/datasource/calc/periods';
import type { BotRow, Position } from '@/gateway/types.gen';

import { makeRegistry } from '@/components/fq/fixtures/charts';
import { makeFixture } from '@/components/fq/fixtures';

let seq = 0;
const makePosition = (bot: BotRow, _i: number, pair = 'ETH/USDC:USDC'): Position =>
  makePos(bot, pair, 9000 + seq++, 'long', 0.4);

const trades = (): JournalTrade[] => makeClosedTrades(makeFleet(40), 96, 14);

describe('drawdownPct (B73)', () => {
  it('turns the ratio of the contract into a percentage', () => {
    expect(drawdownPct({ pct: 0.024 })).toBeCloseTo(2.4, 10);
    expect(drawdownPct({ pct: 0.184 })).toBeCloseTo(18.4, 10);
  });
  it('keeps unknown unknown, never zero', () => {
    expect(drawdownPct({ pct: null })).toBeNull();
    expect(drawdownPct(null)).toBeNull();
    expect(drawdownPct(undefined)).toBeNull();
    expect(drawdownPct({ pct: Number.NaN })).toBeNull();
  });
});

describe('journal: known values', () => {
  it('a trade with an unknown profit has no profit and no percentage', () => {
    const t = trades().find((x) => x.profit_unknown)!;
    expect(knownProfit(t)).toBeNull();
    expect(knownPct(t)).toBeNull();
  });

  it('distribution leaves unknown trades out of every bin and counts them', () => {
    const all = trades();
    const d = distribution(all);
    const unknown = all.filter((t) => knownProfit(t) === null || knownPct(t) === null).length;
    expect(unknown).toBeGreaterThan(0);
    expect(d.unknown).toBe(unknown);
    expect(d.drawn + d.unknown).toBe(all.length);
    expect(d.bins.reduce((s, b) => s + b.count, 0)).toBe(d.drawn);
  });

  it('puts out-of-range trades in the open edge bins', () => {
    const base = trades()[0]!;
    const mk = (pct: number): JournalTrade => ({
      ...base,
      profit_unknown: false,
      profit_abs: pct,
      profit_ratio: pct / 100,
    });
    const d = distribution([mk(-40), mk(30)], { lo: -14, hi: 4, binWidth: 1 });
    expect(d.bins[0]!.count).toBe(1);
    expect(d.bins[0]!.open).toBe('low');
    expect(d.bins[d.bins.length - 1]!.count).toBe(1);
    expect(binLabel(d.bins[0]!)).toBe('≤ -13');
    expect(binLabel(d.bins[d.bins.length - 1]!)).toMatch(/^≥ /);
  });

  it('tail share is null without any loss, and the tail sums only losses', () => {
    const base = trades()[0]!;
    const win: JournalTrade = {
      ...base,
      profit_unknown: false,
      profit_abs: 5,
      profit_ratio: 0.03,
    };
    expect(distribution([win]).tail.share).toBeNull();
    const big: JournalTrade = { ...win, profit_abs: -30, profit_ratio: -0.08 };
    const small: JournalTrade = { ...win, profit_abs: -10, profit_ratio: -0.01 };
    const d = distribution([big, small, win]);
    expect(d.tail.count).toBe(1);
    expect(d.tail.sum).toBe(-30);
    expect(d.tail.share).toBeCloseTo(0.75, 10);
  });

  it('dca depth groups by orders filled and keeps unknown depth apart', () => {
    const base = trades()[0]!;
    const mk = (dca: number | null | undefined, profit: number): JournalTrade => ({
      ...base,
      profit_unknown: false,
      profit_abs: profit,
      dca_entries: dca,
    });
    const s = dcaDepth([mk(1, 5), mk(1, -2), mk(5, -20), mk(6, 3), mk(null, 9), mk(undefined, -1)]);
    expect(s.rows.map((r) => r.depth)).toEqual([1, 5, 6]);
    expect(s.rows[0]).toMatchObject({ trades: 2, wins: 1, pnl: 3 });
    expect(s.unknownDepth).toMatchObject({ trades: 2, pnl: 8 });
    expect(s.deep).not.toBeNull();
    expect(s.deep!.deep.trades).toBe(2);
    expect(s.deep!.shallow.trades).toBe(2);
  });

  it('dca depth has no deep split when only one side exists, and skips unknown profit', () => {
    const base = trades()[0]!;
    const shallow: JournalTrade = { ...base, profit_unknown: false, profit_abs: 1, dca_entries: 1 };
    const unknown: JournalTrade = {
      ...base,
      profit_unknown: true,
      profit_abs: null,
      dca_entries: 2,
    };
    const s = dcaDepth([shallow, unknown]);
    expect(s.deep).toBeNull();
    expect(s.unknownProfit).toBe(1);
    expect(s.rows).toHaveLength(1);
  });

  it('exit reasons never merge two custom reasons and keep unknown apart', () => {
    const all = trades();
    const r = exitReasons(all);
    const custom = r.rows.filter((x) => x.kind === 'custom');
    expect(custom.map((c) => c.key)).toContain('custom:custom_exit_rsi_overbought');
    expect(r.rows.some((x) => x.kind === 'unknown')).toBe(true);
    expect(r.unknownProfit).toBe(all.filter((t) => t.profit_unknown).length);
    // Sorted best first
    for (let i = 1; i < r.rows.length; i++) {
      expect(r.rows[i - 1]!.pnl).toBeGreaterThanOrEqual(r.rows[i]!.pnl);
    }
    // Counted trades equal known-profit trades
    expect(r.rows.reduce((s, x) => s + x.trades, 0)).toBe(
      all.filter((t) => knownProfit(t) !== null).length,
    );
  });

  it('counts human exits apart', () => {
    const r = exitReasons(trades());
    expect(r.rows.reduce((s, x) => s + x.manual, 0)).toBeGreaterThan(0);
  });

  it('result per bot sums known profits only', () => {
    const all = trades();
    const rows = resultByBot(all);
    const total = rows.reduce((s, x) => s + x.pnl, 0);
    const expected = all.reduce((s, t) => s + (knownProfit(t) ?? 0), 0);
    expect(total).toBeCloseTo(expected, 8);
  });
});

describe('calendar', () => {
  const tz = 'Europe/Paris' as const;

  it('month helpers wrap the year', () => {
    expect(monthKey(2026, 13)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthOf(Date.UTC(2026, 2, 31, 23, 30), tz)).toBe('2026-04'); // 01:30 local on the 1st
    expect(monthOf(Date.UTC(2026, 2, 31, 23, 30), 'UTC')).toBe('2026-03');
  });

  it('builds a Monday-first grid padded to full weeks', () => {
    const now = Date.UTC(2026, 9, 15, 12);
    const buckets = pnlPeriods([], 'day', tz, now, 40);
    const g = monthGrid('2026-10', buckets, now, tz);
    expect(g.cells.length % 7).toBe(0);
    // 1 Oct 2026 is a Thursday: three padding cells
    expect(g.cells.slice(0, 3).every((c) => c.label === null)).toBe(true);
    expect(g.cells[3]!.label).toBe('2026-10-01');
    expect(g.cells.filter((c) => c.today)).toHaveLength(1);
    expect(g.cells.find((c) => c.today)!.label).toBe('2026-10-15');
  });

  it('marks days after today as future and keeps them out of every sum', () => {
    const now = Date.UTC(2026, 9, 15, 12);
    const closed = [{ ts_ms: now - 3_600_000, profit_abs: 40 }];
    const g = monthGrid('2026-10', pnlPeriods(closed, 'day', tz, now, 40), now, tz);
    expect(g.cells.find((c) => c.label === '2026-10-20')!.future).toBe(true);
    expect(g.total).toBe(40);
    expect(g.winningDays).toBe(1);
    expect(g.best!.label).toBe('2026-10-15');
  });

  it('a past day without a bucket is missing, not zero', () => {
    const now = Date.UTC(2026, 9, 15, 12);
    const buckets = pnlPeriods([], 'day', tz, now, 40).filter((b) => b.label !== '2026-10-05');
    const g = monthGrid('2026-10', buckets, now, tz);
    const cell = g.cells.find((c) => c.label === '2026-10-05')!;
    expect(cell.missing).toBe(true);
    expect(cell.bucket).toBeNull();
  });

  it('shows the 25 h and 23 h days of the daylight-saving changes', () => {
    const autumn = Date.UTC(2026, 9, 30, 12);
    const g = monthGrid('2026-10', pnlPeriods([], 'day', tz, autumn, 40), autumn, tz);
    expect(g.cells.find((c) => c.label === '2026-10-25')!.dstHours).toBe(25);
    expect(g.cells.find((c) => c.label === '2026-10-24')!.dstHours).toBeNull();
    const spring = Date.UTC(2026, 3, 2, 12);
    const g2 = monthGrid('2026-03', pnlPeriods([], 'day', tz, spring, 45), spring, tz);
    expect(g2.cells.find((c) => c.label === '2026-03-29')!.dstHours).toBe(23);
    // No such day in UTC
    const gu = monthGrid('2026-10', pnlPeriods([], 'day', 'UTC', autumn, 40), autumn, 'UTC');
    expect(gu.cells.every((c) => c.dstHours === null)).toBe(true);
  });

  it('a trade near midnight lands on the local day', () => {
    const now = Date.UTC(2026, 9, 15, 12);
    // 22:30 UTC on the 10th is 00:30 local on the 11th
    const closed = [{ ts_ms: Date.UTC(2026, 9, 10, 22, 30), profit_abs: 7 }];
    const g = monthGrid('2026-10', pnlPeriods(closed, 'day', tz, now, 40), now, tz);
    expect(g.cells.find((c) => c.label === '2026-10-11')!.bucket!.profit_abs).toBe(7);
    expect(g.cells.find((c) => c.label === '2026-10-10')!.bucket!.profit_abs).toBe(0);
  });

  it('asks for enough buckets to reach the first of the month, capped', () => {
    const now = Date.UTC(2026, 9, 15, 12);
    expect(bucketsNeeded('2026-10', now, tz)).toBe(15);
    expect(bucketsNeeded('2020-01', now, tz)).toBe(800);
    expect(bucketsNeeded('2026-12', now, tz)).toBe(1);
  });

  it('tints in proportion to the biggest day, never above 28', () => {
    expect(dayTint(0, 100)).toBe(0);
    expect(dayTint(50, 0)).toBe(0);
    expect(dayTint(100, 100)).toBe(28);
    expect(dayTint(-500, 100)).toBe(28);
    expect(dayTint(-50, 100)).toBe(14);
  });
});

describe('equity helpers', () => {
  const pts: Point[] = [
    [1, 0],
    [2, 10],
    [3, 4],
    [4, 12],
    [5, 3],
  ];
  it('variation, drawdown series and deepest decline', () => {
    expect(variation(pts)).toBe(3);
    expect(variation([[1, 5]])).toBeNull();
    expect(drawdownSeries(pts).map((p) => p[1] + 0)).toEqual([0, 0, -6, 0, -9]);
    expect(maxDrawdownAbs(pts)).toBe(9);
    expect(maxDrawdownAbs([])).toBe(0);
  });
  it('downsampling keeps the first, the last and the extremes', () => {
    const many: Point[] = Array.from({ length: 5000 }, (_, i) => [i, Math.sin(i / 50) * 10]);
    many[2500] = [2500, 99];
    many[3100] = [3100, -77];
    const out = downsample(many, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out[0]).toEqual(many[0]);
    expect(out[out.length - 1]).toEqual(many[many.length - 1]);
    expect(out.some((p) => p[1] === 99)).toBe(true);
    expect(out.some((p) => p[1] === -77)).toBe(true);
    for (let i = 1; i < out.length; i++) expect(out[i]![0]).toBeGreaterThanOrEqual(out[i - 1]![0]);
    expect(downsample(pts, 200)).toEqual(pts);
  });
  it('period start: all history is undefined, others look back in the zone', () => {
    expect(periodStartMs('all', FIXTURE_NOW, 'Europe/Paris')).toBeUndefined();
    const d7 = periodStartMs('7d', FIXTURE_NOW, 'Europe/Paris')!;
    expect(d7).toBeLessThan(FIXTURE_NOW);
    expect(FIXTURE_NOW - d7).toBeGreaterThan(5 * 86_400_000);
  });
});

describe('logs (B13)', () => {
  const lines = makeLogLines();

  it('two lines that start alike keep distinct ids', () => {
    const e = toEntries('a', lines);
    const tao = e.filter((x) => x.message.startsWith('Unable to place order for TAO'));
    expect(tao).toHaveLength(2);
    expect(tao[0]!.id).not.toBe(tao[1]!.id);
    expect(tao[0]!.message.slice(0, 40)).toBe(tao[1]!.message.slice(0, 40));
  });

  it('a genuine repetition in the same millisecond survives', () => {
    const e = toEntries('a', lines);
    expect(e.filter((x) => x.message === 'Rate limit hit on /info')).toHaveLength(2);
    expect(new Set(e.map((x) => x.id)).size).toBe(e.length);
  });

  it('the same batch received again is merged without duplicates', () => {
    const first = mergeEntries([], toEntries('a', lines));
    const again = mergeEntries(first, toEntries('a', lines));
    expect(again).toHaveLength(first.length);
  });

  it('a bot key is part of the identity', () => {
    const a = toEntries('a', lines.slice(0, 3));
    const b = toEntries('b', lines.slice(0, 3));
    expect(mergeEntries(a, b)).toHaveLength(6);
  });

  it('merges newest first and caps', () => {
    const merged = mergeEntries([], toEntries('a', lines), 4);
    expect(merged).toHaveLength(4);
    for (let i = 1; i < merged.length; i++) {
      expect(merged[i - 1]!.ts_ms).toBeGreaterThanOrEqual(merged[i]!.ts_ms);
    }
  });

  it('splits the traceback from the first line', () => {
    const e = toEntries('a', lines).find((x) => x.message === 'Could not fetch balance.')!;
    expect(e.detail).toContain('DDosProtection');
    expect(e.detail).not.toContain('Could not fetch');
  });

  it('filters by level (this one and worse), text and bot', () => {
    const e = toEntries('a', lines);
    expect(
      filterEntries(e, { level: 'ERROR', query: '', botKey: null }).every(
        (x) => levelRank(x.level) >= 3,
      ),
    ).toBe(true);
    expect(
      filterEntries(e, { level: 'DEBUG', query: 'ddosprotection', botKey: null }),
    ).toHaveLength(1);
    expect(filterEntries(e, { level: 'DEBUG', query: '', botKey: 'zzz' })).toHaveLength(0);
    expect(levelRank('mystery')).toBe(levelRank('INFO'));
    expect(levelRank('WARN')).toBe(levelRank('WARNING'));
  });

  it('withTimeout rejects a request that never answers', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<number>(() => undefined);
      const p = withTimeout(never, 1000);
      const caught = p.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await caught).toBeInstanceOf(TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('withTimeout passes the value and the error of a fast request', async () => {
    await expect(withTimeout(Promise.resolve(3), 1000)).resolves.toBe(3);
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});

describe('candles', () => {
  const fx = makeCandles(50);
  const base = toCandleSet(fx);

  it('adds the numeric date column from an ISO date, read as UTC', () => {
    const set = toCandleSet({
      columns: ['date', 'open', 'high', 'low', 'close', 'volume'],
      data: [['2026-10-15T12:00:00Z', 1, 2, 0.5, 1.5, 10]] as never,
      timeframe_ms: 60_000,
    });
    expect(set.columns).toContain(DATE_COL);
    expect(set.rows[0]![set.columns.indexOf(DATE_COL)]).toBe(Date.UTC(2026, 9, 15, 12));
  });

  it('a set without any date has no rows rather than invented ones', () => {
    expect(toCandleSet({ columns: ['open'], data: [[1]], timeframe_ms: 1 }).rows).toEqual([]);
  });

  it('merges a tail by timestamp: replace the open candle, append the new, ignore the old', () => {
    const di = base.columns.indexOf(DATE_COL);
    const last = base.rows[base.rows.length - 1]!;
    const replaced = last.slice();
    replaced[base.columns.indexOf('close')] = 123;
    const next = last.slice();
    next[di] = (last[di] as number) + base.timeframeMs;
    const old = base.rows[3]!.slice();
    const merged = mergeTail(base, { ...base, rows: [old, replaced, next] })!;
    expect(merged.rows).toHaveLength(base.rows.length + 1);
    expect(merged.rows[base.rows.length - 1]![base.columns.indexOf('close')]).toBe(123);
    expect(merged.rows[merged.rows.length - 1]![di]).toBe(next[di]);
    // The input set is not mutated
    expect(base.rows).toHaveLength(50);
  });

  it('refuses to merge when the columns differ', () => {
    expect(mergeTail(base, { ...base, columns: [...base.columns, 'extra'] })).toBeNull();
  });

  it('finds the candle at or before a time', () => {
    const di = base.columns.indexOf(DATE_COL);
    const t10 = base.rows[10]![di] as number;
    expect(indexAt(base, t10)).toBe(10);
    expect(indexAt(base, t10 + 1)).toBe(10);
    expect(indexAt(base, (base.rows[0]![di] as number) - 1)).toBe(-1);
    expect(indexAt(base, Number.MAX_SAFE_INTEGER)).toBe(49);
  });

  it('legend of the last candle by default, with indicator values', () => {
    const lg = legendAt(base, undefined, ['ema_50', 'nope'])!;
    expect(lg.close).toBe(base.rows[49]![base.columns.indexOf('close')]);
    expect(lg.values.ema_50).not.toBeNull();
    expect(lg.values.nope).toBeNull();
    expect(legendAt({ ...base, rows: [] })).toBeNull();
  });

  const tokens = { warn: 'W', fg3: 'F', accent: 'A', profit: 'P', crit: 'C' } as never;
  const labels = { average: 'avg', tp: 'tp', liquidation: 'liq' };

  it('draws only the levels that are on and finite', () => {
    const o = {
      average: 4.9,
      tp: 5.2,
      liquidation: Number.NaN,
      safetyOrders: [
        { price: 4.7, state: 'filled' as const, label: 'SO1' },
        { price: 4.5, state: 'next' as const, label: 'SO2' },
        { price: 0, state: 'pending' as const, label: 'SO3' },
      ],
    };
    const all = levelLines(o, ALL_OVERLAYS, tokens, labels);
    expect(all.map((l) => l.id)).toEqual(['so:SO1', 'so:SO2', 'avg', 'tp']);
    expect(all.find((l) => l.id === 'so:SO2')!.dash).toBe('dashed');
    const off = levelLines(o, { ...ALL_OVERLAYS, safetyOrders: false, tp: false }, tokens, labels);
    expect(off.map((l) => l.id)).toEqual(['avg']);
  });

  it('overlays belong to the pair of the position only', () => {
    const pos = makePosition(makeFleet(40)[0]!, 0);
    expect(overlaysFromPosition(pos, 'OTHER/USDC:USDC')).toEqual({});
    expect(overlaysFromPosition(null, pos.pair)).toEqual({});
    const o = overlaysFromPosition(pos, pos.pair, {
      tp: 6,
      orders: [
        { price: 5, state: 'filled', label: 'Entry' },
        { price: 4.5, state: 'next', label: 'SO1' },
      ] as never,
    });
    expect(o.average).toBe(pos.open_rate);
    expect(o.tp).toBe(6);
    // The entry order is the average line, not a safety level
    expect(o.safetyOrders).toEqual([{ price: 4.5, state: 'next', label: 'SO1' }]);
  });
});

describe('risk', () => {
  const f = makeFixture(40);
  const modeOf = (k: string) => f.bots.find((b) => b.bot_key === k)?.identity.mode ?? null;

  it('nets per wallet and coin, never per bot, and lists stale bots as excluded', () => {
    const [a, b] = f.bots.filter((x) => x.identity.mode === 'live');
    const mk = (bot: typeof a, side: 'long' | 'short', notional: number, stale = false) =>
      ({
        ...makePosition(bot!, 0),
        coin: 'ETH',
        side,
        notional,
        orphan: false,
        liq_distance_pct: 40,
        freshness: { stale },
      }) as unknown as Position;
    const m = riskModel({
      positions: [mk(a, 'long', 300), mk(b, 'short', 100), mk(a, 'long', 999, true)],
      totals: null,
      mode: 'live',
      modeOf,
      walletOf: () => 'w1',
    });
    expect(m.coins).toHaveLength(1);
    expect(m.coins[0]).toMatchObject({ long: 300, short: 100, net: 200 });
    expect(m.excluded).toContain(a!.bot_key);
    expect(m.leverage).toBeNull();
  });

  it('orphans are listed apart and never counted in the coin rows', () => {
    const live = f.bots.find((x) => x.identity.mode === 'live')!;
    const orphan = {
      ...makePosition(live, 0),
      orphan: true,
      coin: 'PENGU',
      notional: 50,
    } as unknown as Position;
    const m = riskModel({
      positions: [orphan],
      totals: null,
      mode: 'live',
      modeOf,
      walletOf: () => 'w',
    });
    expect(m.orphans).toHaveLength(1);
    expect(m.coins).toHaveLength(0);
    expect(m.nearest).toBeNull();
  });

  it('tones', () => {
    expect(liquidationTone(null)).toBe('neutral');
    expect(liquidationTone(9)).toBe('crit');
    expect(liquidationTone(20)).toBe('warn');
    expect(liquidationTone(60)).toBe('neutral');
    expect(budgetTone(59)).toBe('ok');
    expect(budgetTone(60)).toBe('warn');
    expect(budgetTone(80)).toBe('crit');
    expect(hitRateTone(0.95)).toBe('ok');
    expect(hitRateTone(0.8)).toBe('warn');
    expect(hitRateTone(0.7)).toBe('crit');
    expect(hitRateTone(null)).toBe('ok');
  });

  it('shows unknown reason codes as received and sorts worst first', () => {
    expect(isKnownReason('bots_offline')).toBe(true);
    expect(isKnownReason('something_new')).toBe(false);
    const sorted = sortReasons([
      { code: 'b', severity: 'info' },
      { code: 'z', severity: 'critical' },
      { code: 'a', severity: 'warning' },
    ] as never);
    expect(sorted.map((r) => r.code)).toEqual(['z', 'a', 'b']);
  });
});

describe('leaderboard', () => {
  const bots = makeFleet(40);
  const items = () => itemsFromBots(bots, '7d', FIXTURE_NOW, 0);

  it('never mixes modes', () => {
    const r = rank(items(), 'live');
    expect(r.rows.every((x) => x.mode === 'live')).toBe(true);
    expect(r.rows.length).toBe(items().filter((i) => i.mode === 'live').length);
  });

  it('stale and unknown values get no bar, no scale and no sum', () => {
    const it0 = items().filter((i) => i.mode === 'live');
    const stale = { ...it0[0]!, value: 9999, stale: true };
    const unknown = { ...it0[1]!, value: null };
    const r = rank([stale, unknown, ...it0.slice(2)], 'live');
    expect(r.scale).toBeLessThan(9999);
    expect(r.excluded.map((x) => x.key)).toEqual(expect.arrayContaining([stale.key, unknown.key]));
    expect(r.excluded.every((x) => x.ratio === 0 && !x.counted)).toBe(true);
    expect(r.total).toBeCloseTo(
      it0.slice(2).reduce((s, x) => s + (x.stale || x.value === null ? 0 : x.value), 0),
      8,
    );
    // Excluded rows sit after the counted ones
    const firstExcluded = r.rows.findIndex((x) => !x.counted);
    expect(r.rows.slice(firstExcluded).every((x) => !x.counted)).toBe(true);
  });

  it('bars are proportional to the biggest absolute value', () => {
    const base = items().filter((i) => i.mode === 'live')[0]!;
    const r = rank(
      [
        { ...base, key: 'a', name: 'a', value: 100, stale: false },
        { ...base, key: 'b', name: 'b', value: -50, stale: false },
      ],
      'live',
    );
    expect(r.rows.map((x) => x.ratio)).toEqual([1, 0.5]);
  });
});

describe('pairs', () => {
  const f = makeFixture(40);

  it('a pair held by two bots is two rows', () => {
    const [a, b] = f.bots.filter((x) => x.identity.mode === 'live');
    const pa = { ...makePosition(a!, 0), pair: 'ETH/USDC:USDC' } as Position;
    const pb = { ...makePosition(b!, 0), pair: 'ETH/USDC:USDC' } as Position;
    const rows = positionItems([pa, pb]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it('worst P&L first, unknown last', () => {
    const live = f.bots.filter((x) => x.identity.mode === 'live');
    const mk = (i: number, p: number | null) =>
      ({ ...makePosition(live[i]!, 0), profit_abs: p }) as Position;
    const rows = positionItems([mk(0, 5), mk(1, null), mk(2, -9)]);
    expect(rows.map((r) => r.profitAbs)).toEqual([-9, 5, null]);
  });

  it('signals: entries before exits, pairs without a signal dropped', () => {
    const rows = signalItems(
      { pairs: { A: { exit_long: 1 }, B: { enter_long: 2 }, C: { enter_long: 0 } } },
      'k',
    );
    expect(rows.map((r) => r.pair)).toEqual(['B', 'A']);
    expect(signalItems(null, 'k')).toEqual([]);
  });

  it('locks: inactive dropped, the one ending last first', () => {
    const rows = lockItems(
      [
        { id: 1, pair: 'A', lock_end_timestamp: 10 },
        { id: 2, pair: 'B', lock_end_timestamp: 30 },
        { id: 3, pair: 'C', lock_end_timestamp: 99, active: false },
      ],
      'k',
    );
    expect(rows.map((r) => r.pair)).toEqual(['B', 'A']);
  });

  it('whitelist is deduplicated and sorted; search covers pair and bot name', () => {
    const rows = whitelistItems(['B', 'A', 'B'], 'k');
    expect(rows.map((r) => r.pair)).toEqual(['A', 'B']);
    expect(matchesPair(rows[0]!, 'a', null)).toBe(true);
    expect(matchesPair(rows[0]!, 'dyn', 'dynv1')).toBe(true);
    expect(matchesPair(rows[0]!, 'zzz', 'dynv1')).toBe(false);
    expect(matchesPair(rows[0]!, '  ', null)).toBe(true);
  });
});

describe('reconciliation', () => {
  const rows = makeRecon();
  const by = (coin: string) => rows.find((r) => r.coin === coin)!;

  it('classifies and proposes, and only some rows are actionable', () => {
    expect(reconView(by('HYPE'))).toMatchObject({ proposalKey: 'none', actionable: false });
    expect(reconView(by('PENGU'))).toMatchObject({
      tone: 'orphan',
      proposalKey: 'closeUnowned',
      actionable: true,
    });
    expect(reconView(by('SEI'))).toMatchObject({ proposalKey: 'deletePhantom', actionable: true });
    const tao = reconView(by('TAO'));
    expect(tao).toMatchObject({ tone: 'crit', actionable: false, proposalKey: 'review' });
    expect(tao.hints).toEqual(['refresh_first', 'partial_fill']);
    expect(reconView(by('HYPE')).bots).toBe(3);
  });

  it('a phantom without a candidate is reviewed, not deleted', () => {
    const v = reconView({ ...by('SEI'), phantom_candidate: null });
    expect(v).toMatchObject({ proposalKey: 'review', actionable: false });
  });

  it('problems first, then by coin', () => {
    expect(sortRecon(rows).map((r) => r.coin)).toEqual(['PENGU', 'TAO', 'SEI', 'HYPE', 'WIF']);
  });

  it('on-chain notional is unknown without a mark price', () => {
    expect(onChainNotional(by('PENGU'))).toBeCloseTo(18_000 * 0.0118, 6);
    expect(onChainNotional({ ...by('PENGU'), mark_price: null })).toBeNull();
  });

  it('a new sweep is allowed 60 s after the last one', () => {
    expect(nextSweepInMs(null, 1000)).toBe(0);
    expect(nextSweepInMs(1000, 1000 + 20_000)).toBe(40_000);
    expect(nextSweepInMs(1000, 1000 + 60_000)).toBe(0);
  });
});

describe('registry', () => {
  const f = makeFixture(40);
  const reg = makeRegistry(f);

  it('rows carry the alias, the group and the state of the fleet', () => {
    const fleet = Object.fromEntries(f.bots.map((b) => [b.bot_key, b]));
    const rows = registryRows(
      reg.bots,
      fleet,
      [{ name: 'G1', botKeys: [reg.bots[0]!.botKey] } as never],
      FIXTURE_NOW,
      0,
    );
    expect(rows).toHaveLength(reg.bots.length);
    expect(rows[0]!.group).toBe('G1');
    expect(rows[0]!.alias).toBe('ftbot.1');
    expect(rows[13]!.alias).toBeNull();
  });

  it('a bot unknown to the fleet has no state, not a guessed one', () => {
    const rows = registryRows(reg.bots, {}, [], FIXTURE_NOW, 0);
    expect(rows.every((r) => r.state === null && r.mode === null)).toBe(true);
  });

  it('sorts expired sessions first, then live before dry', () => {
    const base = registryRows(reg.bots, {}, [], FIXTURE_NOW, 0)[0]!;
    const sorted = sortRegistry([
      { ...base, botKey: 'b', name: 'b', mode: 'dry', needsLogin: false },
      { ...base, botKey: 'a', name: 'a', mode: 'live', needsLogin: false },
      { ...base, botKey: 'c', name: 'c', mode: 'dry', needsLogin: true },
    ]);
    expect(sorted.map((r) => r.botKey)).toEqual(['c', 'a', 'b']);
  });

  it('migration view counts the bots that came from this browser', () => {
    const v = migrationView(reg.migration, reg.bots)!;
    expect(v.imported).toBe(13);
    expect(v.unmapped).toEqual(['ftbot.31']);
    expect(v.forcedConfirmation).toBe(true);
    expect(migrationView(null, reg.bots)).toBeNull();
  });
});
