import { describe, expect, it } from 'vitest';

import {
  chartsQuery,
  contextBotFor,
  defaultPair,
  stickyDefaultPair,
  parseChartsQuery,
  resolvePlotChoice,
  secondPair,
  mergePlot,
} from '@/components/fq/lib/chartsPage';
import {
  csvCell,
  CSV_COLUMNS,
  defaultJournalFilters,
  depthMatches,
  groupTotal,
  hasDepth,
  journalBots,
  journalQuery,
  journalStats,
  periodBounds,
  resolvePair,
  tradesToCsv,
} from '@/components/fq/lib/journalPage';
import { measure } from '@/components/fq/lib/measure';
import type { JournalTrade } from '@/components/fq/lib/journal';
import type { BotKey, BotRow, Position } from '@/gateway/types.gen';

const tz = 'Europe/Paris' as never;
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const HOUR = 3_600_000;

const trade = (over: Partial<JournalTrade>): JournalTrade =>
  ({
    bot_key: 'b1' as BotKey,
    trade_id: 1,
    pair: 'ARB/USDC:USDC',
    market: 'crypto',
    side: 'long',
    mode: 'live',
    leverage: 2,
    open_ms: NOW - 10 * HOUR,
    close_ms: NOW - 5 * HOUR,
    open_rate: 1,
    close_rate: 1.1,
    amount: 10,
    stake_amount: 100,
    profit_abs: 10,
    profit_ratio: 0.1,
    profit_unknown: false,
    exit_reason: { raw: 'roi', kind: 'roi', class: 'profit' },
    enter_tag: null,
    manual: false,
    ...over,
  }) as JournalTrade;

const bot = (key: string, name: string, mode: 'live' | 'dry' | 'replay'): BotRow =>
  ({ bot_key: key, identity: { name, mode } }) as unknown as BotRow;

const position = (bot_key: string, pair: string, profit_abs: number | null, orphan = false) =>
  ({ bot_key, pair, profit_abs, orphan }) as unknown as Position;

describe('charts page model', () => {
  it('reads the URL with defaults for anything unknown and writes a short URL back', () => {
    const s = parseChartsQuery({ bot: 'b1', pair: 'ARB/USDC:USDC', tf: '3m', cells: '2', ha: '1' });
    expect(s).toMatchObject({ bot: 'b1', tf: '15m', cells: 2, ha: true });
    expect(parseChartsQuery({}).cells).toBe(1);
    expect(parseChartsQuery({ ha: '0' }).ha).toBe(false);
    expect(chartsQuery(parseChartsQuery({}))).toEqual({});
    expect(chartsQuery({ ...s, tf: '1h' })).toMatchObject({ tf: '1h', cells: '2', ha: '1' });
    // The second pair is only carried when two cells are shown.
    expect(chartsQuery({ ...s, cells: 1, pair2: 'X' }).pair2).toBeUndefined();
  });

  it('picks the worst open position as the default pair and another one for the second cell', () => {
    const ps = [
      position('b1', 'A', -5),
      position('b1', 'B', -20),
      position('b2', 'C', null),
      position('b2', 'O', -99, true),
    ];
    expect(defaultPair(ps, 'b1' as BotKey)).toBe('B');
    expect(defaultPair(ps, 'b3' as BotKey)).toBe('B');
    expect(defaultPair([], null)).toBeNull();
    expect(secondPair(ps, 'B')).toBe('A');
  });

  it('keeps the default pair while it is still held, so the chart does not jump with every tick (B156)', () => {
    const ps = [position('b1', 'A', -5), position('b1', 'B', -20)];
    expect(stickyDefaultPair(null, ps, 'b1' as BotKey)).toBe('B');
    // A moves to the worst place: the pair already shown stays
    const moved = [position('b1', 'A', -50), position('b1', 'B', -20)];
    expect(defaultPair(moved, 'b1' as BotKey)).toBe('A');
    expect(stickyDefaultPair('B', moved, 'b1' as BotKey)).toBe('B');
    // Its position is gone, or it belongs to no candidate: a new default is chosen
    expect(stickyDefaultPair('B', [position('b1', 'A', -5)], 'b1' as BotKey)).toBe('A');
    expect(
      stickyDefaultPair(
        'B',
        [position('b1', 'B', -1, true), position('b1', 'A', -5)],
        'b1' as BotKey,
      ),
    ).toBe('A');
    expect(stickyDefaultPair('B', [], null)).toBeNull();
  });

  it('chooses the bot that computes the indicators of a pair', () => {
    const bots = [
      bot('d', 'a_dry', 'dry'),
      bot('l2', 'z_live', 'live'),
      bot('l1', 'b_live', 'live'),
    ];
    const ps = [position('d', 'P', 0), position('l2', 'P', 0)];
    const base = { pair: 'P', requested: null, selected: null, positions: ps, bots };
    expect(contextBotFor({ ...base, requested: 'd' as BotKey })).toBe('d');
    // A live holder wins over a dry one.
    expect(contextBotFor(base)).toBe('l2');
    expect(contextBotFor({ ...base, pair: 'none', selected: 'd' as BotKey })).toBe('d');
    expect(contextBotFor({ ...base, pair: 'none' })).toBe('l1');
    expect(contextBotFor({ ...base, bots: [] })).toBeNull();
  });

  it('falls back to the strategy plot for an unknown preset and keeps a custom one', () => {
    expect(resolvePlotChoice(null, null).kind).toBe('strategy');
    expect(resolvePlotChoice('tpl:nope', null).kind).toBe('strategy');
    expect(resolvePlotChoice('mine', { mine: { main_plot: {} } }).kind).toBe('custom');
    expect(resolvePlotChoice('missing', {}).kind).toBe('strategy');
    const base = { main_plot: { a: {} }, subplots: {} } as never;
    expect(mergePlot(base, undefined)).toBe(base);
  });
});

describe('journal page model', () => {
  it('turns the filters into an explicit, sorted, closed-trades query', () => {
    const f = {
      ...defaultJournalFilters(),
      side: 'short' as const,
      pair: ' arb ',
      exitReason: 'roi',
    };
    const q = journalQuery({
      filters: f,
      bots: ['b2', 'b1'] as BotKey[],
      nowMs: NOW,
      tz,
      limit: 50,
    });
    expect(q).toMatchObject({
      status: 'closed',
      side: 'short',
      pair: 'ARB',
      exitReason: 'roi',
      sort: 'close_ms',
      order: 'desc',
      limit: 50,
    });
    expect(q.fromMs).toBeLessThan(NOW);
    expect(
      journalQuery({ filters: defaultJournalFilters(), bots: [], nowMs: NOW, tz }).cursor,
    ).toBeUndefined();
  });

  it('has bounds per period and keeps an open end open', () => {
    expect(periodBounds({ period: 'all', range: { fromMs: null, toMs: null } }, NOW, tz)).toEqual(
      {},
    );
    expect(periodBounds({ period: 'range', range: { fromMs: 5, toMs: null } }, NOW, tz)).toEqual({
      fromMs: 5,
    });
    const w = periodBounds({ period: '24h', range: { fromMs: null, toMs: null } }, NOW, tz);
    expect(NOW - (w.fromMs as number)).toBeCloseTo(24 * HOUR, -4);
  });

  it('lists the bots of the scope, the picked ones among them, and replay only when asked', () => {
    const scope = [bot('b', 'b', 'live'), bot('a', 'a', 'live')];
    const all = [...scope, bot('r', 'r', 'replay')];
    const base = { bots: [] as BotKey[], sansReplay: true };
    expect(journalBots(scope, all, base, 'all')).toEqual(['a', 'b']);
    expect(journalBots(scope, all, { ...base, sansReplay: false }, 'all')).toEqual(['a', 'b', 'r']);
    // Replay never comes in under a live or dry scope.
    expect(journalBots(scope, all, { ...base, sansReplay: false }, 'live')).toEqual(['a', 'b']);
    expect(journalBots(scope, all, { ...base, bots: ['b', 'zzz'] as BotKey[] }, 'all')).toEqual([
      'b',
    ]);
  });

  it('filters by depth and treats a missing depth as matching no depth filter', () => {
    expect(depthMatches({ dca_entries: null }, null)).toBe(true);
    expect(depthMatches({ dca_entries: null }, { kind: 'min', n: 0 })).toBe(false);
    expect(depthMatches({ dca_entries: 3 }, { kind: 'eq', n: 3 })).toBe(true);
    expect(depthMatches({ dca_entries: 3 }, { kind: 'min', n: 4 })).toBe(false);
    expect(hasDepth([{ dca_entries: undefined }, { dca_entries: 2 }])).toBe(true);
    expect(hasDepth([{ dca_entries: null }])).toBe(false);
  });

  it('resolves a typed coin to a loaded market', () => {
    const pairs = ['xyz:NVDA/USDC:USDC', 'ARB/USDC:USDC'];
    expect(resolvePair('arb', pairs)).toBe('ARB/USDC:USDC');
    expect(resolvePair('nvda', pairs)).toBe('xyz:NVDA/USDC:USDC');
    expect(resolvePair('doge', pairs)).toBe('DOGE');
    expect(resolvePair(' ', pairs)).toBe('');
  });

  it('adds known profits only and counts the unknown ones apart', () => {
    const rows = [
      trade({ profit_abs: 10 }),
      trade({ profit_abs: -4 }),
      trade({ profit_abs: null, profit_unknown: true }),
    ];
    expect(groupTotal(rows)).toEqual({ trades: 3, sum: 6, unknown: 1 });
  });

  it('computes the totals of the filtered set without inventing a figure', () => {
    const rows = [
      trade({ trade_id: 1, profit_abs: 30 }),
      trade({ trade_id: 2, profit_abs: -10, mae: -0.2 }),
      trade({ trade_id: 3, profit_abs: 0 }),
      trade({ trade_id: 4, profit_abs: null, profit_unknown: true }),
    ];
    const s = journalStats(rows);
    expect(s).toMatchObject({ trades: 4, unknown: 1, net: 20, wins: 1, losses: 1 });
    // The break-even trade is a known result: three known trades, one win.
    expect(s.winrate).toBeCloseTo(1 / 3);
    expect(s.profitFactor).toBe(3);
    expect(s.expectancy).toBeCloseTo(20 / 3);
    expect(s.worstTrade?.tradeId).toBe(2);
    expect(s.worstDrawdown).toBe(-20);
    expect(s.medianHours).toBeCloseTo(5);
    // No loss: the profit factor is undefined, not infinite.
    expect(journalStats([trade({ profit_abs: 5 })]).profitFactor).toBeNull();
    const none = journalStats([]);
    expect(none.winrate).toBeNull();
    expect(none.expectancy).toBeNull();
    expect(none.worstDrawdown).toBeNull();
  });

  it('guards CSV cells against spreadsheet formulas and quotes separators', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(-3)).toBe('-3');
  });

  it('exports the same columns as the gateway, with the raw exit reason', () => {
    const csv = tradesToCsv([trade({ enter_tag: '=cmd' })]);
    const [head, line] = csv.split('\n');
    expect(head.split(',')).toEqual([...CSV_COLUMNS]);
    expect(line).toContain(',roi,');
    expect(line).toContain("'=cmd");
    expect(csv.endsWith('\n')).toBe(true);
  });
});

describe('measure tool', () => {
  it('gives the move in price, percent, candles and time, whichever way it is dragged', () => {
    const m = measure({ ts: 0, price: 100 }, { ts: 3 * 900_000, price: 90 }, 900_000);
    expect(m).toEqual({ dPrice: -10, dPct: -10, candles: 3, durationMs: 2_700_000 });
    expect(measure({ ts: 2_700_000, price: 90 }, { ts: 0, price: 100 }, 900_000).durationMs).toBe(
      2_700_000,
    );
  });

  it('has no percent without a positive start price and no candles without a timeframe', () => {
    const m = measure({ ts: 0, price: 0 }, { ts: 10, price: 5 }, 0);
    expect(m.dPct).toBeNull();
    expect(m.candles).toBe(0);
  });
});
