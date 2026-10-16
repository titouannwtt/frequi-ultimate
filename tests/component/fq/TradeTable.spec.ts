import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PositionCard from '../../../src/components/fq/PositionCard.vue';
import TradeTable from '../../../src/components/fq/TradeTable.vue';
import { lineFromPosition } from '../../../src/components/fq/lib/trades';
import { FIXTURE_NOW, makePosition } from '../../../src/components/fq/fixtures';
import type { Position, TradeRow } from '../../../src/gateway/types.gen';
import { mountFq, setupWorld, teardownWorld, type FqWorld } from './helpers';

let world: FqWorld;
beforeEach(() => {
  world = setupWorld();
});
afterEach(teardownWorld);

const closedTrades = (): TradeRow[] => {
  const [a, b] = world.fixture.bots.filter((x) => x.identity.mode === 'live');
  return [a!, b!].flatMap((bot) =>
    [1180, 1181].map((id, i) => ({
      bot_key: bot.bot_key,
      trade_id: id,
      pair: 'TAO/USDC:USDC',
      market: 'crypto' as const,
      side: i ? ('short' as const) : ('long' as const),
      mode: bot.identity.mode,
      leverage: 2,
      open_ms: FIXTURE_NOW - 40 * 3_600_000,
      close_ms: FIXTURE_NOW - (3 + i) * 3_600_000,
      open_rate: 300,
      close_rate: i === 1 ? null : 310,
      amount: 2,
      stake_amount: 150,
      profit_abs: i === 1 ? null : 12.5,
      profit_ratio: i === 1 ? null : 0.04,
      profit_unknown: i === 1,
      exit_reason: { raw: 'roi', kind: 'roi' as const, class: 'other' as const },
      enter_tag: null,
      manual: false,
    })),
  );
};

function mountTrades(props: Record<string, unknown>) {
  return mountFq(TradeTable, { props, attachTo: document.body });
}

describe('TradeTable: the bot cell', () => {
  it('cuts a long bot name in one line and keeps the full name in the title', async () => {
    const live = world.fixture.bots.find((b) => b.identity.mode === 'live')!;
    const long = 'très long nom de stratégie avec accents éèà et suite sans fin de mots';
    // The fleet store is the source of the name on a line
    live.identity.name = long;
    const { useFqFleetStore } = await import('../../../src/datasource/stores/fleet');
    useFqFleetStore().bots[live.bot_key]!.identity.name = long;
    const w = mountTrades({ preset: 'open', containerWidth: 1200 });
    const cell = w.find('.botlink .bn');
    expect(cell.exists()).toBe(true);
    const titled = w.findAll('.botlink .bn').filter((e) => e.attributes('title') === long);
    expect(titled.length).toBeGreaterThan(0);
  });
});

describe('TradeTable: presets', () => {
  it('open: every open position of the fleet, worst P&L first, unknown last', () => {
    const w = mountTrades({ preset: 'open', containerWidth: 1200 });
    const keys = (w.vm as unknown as { sorted: () => string[] }).sorted();
    expect(keys.length).toBe(world.fixture.positions.length);
    const byKey = new Map(world.fixture.positions.map((p) => [`${p.bot_key}/${p.trade_id}`, p]));
    const pnl = keys.map((k) => byKey.get(k)!.profit_abs);
    const known = pnl.filter((x): x is number => x != null);
    expect([...known].sort((a, b) => a - b)).toEqual(known);
  });

  it('bot: only the positions of that bot, and no bot column', () => {
    const botKey = world.fixture.positions.find((p) => !p.orphan)!.bot_key;
    const w = mountTrades({ preset: 'bot', botKey, containerWidth: 1200 });
    const keys = (w.vm as unknown as { sorted: () => string[] }).sorted();
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith(`${botKey}/`))).toBe(true);
    expect(w.findAll('thead th').map((h) => h.text().toLowerCase())).not.toContain('bot');
  });

  it('closed: only that bot, with the exit reason; unknown profit shows as an icon, not zero', () => {
    const trades = closedTrades();
    const botKey = trades[0]!.bot_key;
    const w = mountTrades({ preset: 'closed', botKey, trades, containerWidth: 1200 });
    const rows = w.findAll('tbody tr:not(.pad):not(.none)');
    expect(rows).toHaveLength(2);
    const unknown = rows.find((r) => r.find('[data-state="unavailable"]').exists());
    expect(unknown).toBeDefined();
    expect(unknown!.text()).not.toMatch(/unknown|n\/a|n\/d|\+0\.00/i);
  });

  it('journal: the closed trades of the whole fleet', () => {
    const w = mountTrades({ preset: 'journal', trades: closedTrades(), containerWidth: 1200 });
    expect(w.findAll('tbody tr:not(.pad):not(.none)')).toHaveLength(4);
  });

  it('journal: leaves out the DCA and MAE/MFE columns when no loaded trade carries them (B201)', () => {
    const w = mountTrades({ preset: 'journal', trades: closedTrades(), containerWidth: 1200 });
    const heads = w.findAll('thead th').map((h) => h.text().toLowerCase());
    expect(heads.some((h) => h.includes('mae'))).toBe(false);
    expect(heads.some((h) => h === 'dca')).toBe(false);
    // The room goes to the exit reason and the duration
    expect(heads.some((h) => h.includes('reason') || h.includes('exit'))).toBe(true);
  });

  it('empty states say what to do, per preset', () => {
    for (const preset of ['open', 'bot', 'closed', 'journal'] as const) {
      const w = mountTrades({
        preset,
        botKey: 'local:1',
        trades: [],
        positions: [],
        containerWidth: 1200,
      });
      expect(w.text().length).toBeGreaterThan(10);
    }
  });

  it('quick filters narrow the open list and show their counts', () => {
    const w = mountTrades({ preset: 'open', filter: 'loss', containerWidth: 1200 });
    const keys = (w.vm as unknown as { sorted: () => string[] }).sorted();
    const losses = world.fixture.positions.filter((p) => (p.profit_abs ?? 0) < 0).length;
    expect(keys).toHaveLength(losses);
    const orphan = mountTrades({ preset: 'open', filter: 'orphan', containerWidth: 1200 });
    expect((orphan.vm as unknown as { sorted: () => string[] }).sorted()).toHaveLength(1);
  });
});

describe('TradeTable: plain words (B381, B382)', () => {
  const longRunning = (botIdx = 0, percentile = 98): Position => {
    const bot = world.fixture.bots.filter((b) => b.identity.mode === 'live')[botIdx]!;
    return { ...makePosition(bot, 'SOL/USDC:USDC', 90 + percentile, 'long', 0.5), percentile };
  };

  it('says "longer than usual" instead of P98, and keeps the percentile in the tooltip', () => {
    const w = mountTrades({ preset: 'open', containerWidth: 1200, positions: [longRunning()] });
    const note = w.get('.durnote');
    expect(note.text()).toBe('longer than usual');
    expect(note.attributes('title')).toContain('98');
    expect(w.text()).not.toMatch(/\bP\d\d\b/i);
  });

  it('says "long" from p84 and nothing while the duration is usual', () => {
    const w = mountTrades({
      preset: 'open',
      containerWidth: 1200,
      positions: [longRunning(0, 86), longRunning(1, 40)],
    });
    expect(w.findAll('.durnote').map((n) => n.text())).toEqual(['long']);
  });

  it('cards use the same words', () => {
    const w = mountTrades({ preset: 'open', containerWidth: 400, positions: [longRunning()] });
    expect(w.get('.dnote').text()).toBe('longer than usual');
    expect(w.text()).not.toMatch(/\bp98\b/i);
  });

  it('the market badge only shows where the market matters: open positions, never the journal', () => {
    const bot = world.fixture.bots.find((b) => b.identity.mode === 'live')!;
    const gold = {
      ...makePosition(bot, 'xyz:GOLD/USDC:USDC', 70, 'long', 0.5),
      market: 'xyz_commodities' as const,
    };
    const open = mountTrades({ preset: 'open', containerWidth: 1200, positions: [gold] });
    expect(open.find('.badge.xyz').text()).toBe('Stocks, commodities');
    const closed = closedTrades().map((t) => ({
      ...t,
      pair: 'xyz:GOLD/USDC:USDC',
      market: 'xyz_commodities' as const,
    }));
    const journal = mountTrades({ preset: 'journal', containerWidth: 1200, trades: closed });
    expect(journal.find('.badge.xyz').exists()).toBe(false);
    expect(journal.text()).not.toContain('HIP-3');
  });
});

describe('TradeTable: unknown exit reason (B383, B401)', () => {
  it('shows a muted dash that says why, not "unknown", and the row stays', () => {
    const trades = closedTrades().map((t) => ({
      ...t,
      exit_reason: { raw: '', kind: 'unknown' as const, class: 'other' as const },
    }));
    const w = mountTrades({ preset: 'journal', trades, containerWidth: 1200 });
    expect(w.findAll('tbody tr:not(.pad):not(.none)')).toHaveLength(4);
    expect(w.text().toLowerCase()).not.toContain('unknown');
    const cards = mountTrades({ preset: 'journal', trades, containerWidth: 400 });
    expect(cards.text().toLowerCase()).not.toContain('unknown');
    // The empty cell is a dash with its reason in the title, in the table and in the cards (B401)
    const dash = w.findAll('[data-testid=exit-reason-none]');
    expect(dash).toHaveLength(4);
    expect(dash[0]!.text()).toBe('–');
    expect(dash[0]!.attributes('title')).toBe(
      'The bot did not record an exit reason for this trade.',
    );
    expect(dash[0]!.attributes('aria-label')).toBe(dash[0]!.attributes('title'));
  });
  it('a trade still open says it has no reason yet', () => {
    const trades = closedTrades().map((t) => ({
      ...t,
      close_ms: null,
      exit_reason: { raw: '', kind: 'unknown' as const, class: 'other' as const },
    }));
    const w = mountTrades({ preset: 'journal', trades, containerWidth: 1200 });
    const dash = w.get('[data-testid=exit-reason-none]');
    expect(dash.attributes('title')).toBe('Position still open: no exit reason yet.');
  });
});

describe('TradeTable: the same trade id on two bots', () => {
  const dupes = () => world.fixture.positions.filter((p) => p.trade_id === 1180);

  it('keeps two distinct lines, with unique keys and no Vue duplicate key warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = mountTrades({ preset: 'open', containerWidth: 1200 });
    const keys = (w.vm as unknown as { sorted: () => string[] }).sorted();
    expect(new Set(keys).size).toBe(keys.length);
    const [a, b] = dupes();
    expect(keys).toContain(`${a!.bot_key}/1180`);
    expect(keys).toContain(`${b!.bot_key}/1180`);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('Duplicate key'))).toHaveLength(0);
    warn.mockRestore();
  });

  it('opening a line reports the bot it belongs to, not the first bot with that trade id', async () => {
    const [a, b] = dupes();
    const w = mountTrades({ preset: 'open', containerWidth: 1200, positions: [a!, b!] });
    const rows = w.findAll('tbody tr:not(.pad):not(.none)');
    expect(rows).toHaveLength(2);
    const nameOf = (botKey: string) =>
      world.fixture.bots.find((x) => x.bot_key === botKey)!.identity.name;
    for (const row of rows) {
      await row.trigger('click');
    }
    const opened = w.emitted('open')!.map((e) => e as [string, number]);
    expect(opened.map((e) => e[1])).toEqual([1180, 1180]);
    expect(new Set(opened.map((e) => e[0]))).toEqual(new Set([a!.bot_key, b!.bot_key]));
    // The row shown first is the row opened first
    const firstName = rows[0]!.text();
    expect(firstName).toContain(nameOf(opened[0]![0]));
    expect(rows[1]!.text()).toContain(nameOf(opened[1]![0]));
  });

  it('in cards mode, each card carries its own bot and key', () => {
    const [a, b] = dupes();
    const w = mountTrades({ preset: 'open', containerWidth: 400, positions: [a!, b!] });
    const cards = w.findAllComponents(PositionCard);
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.props('line').key)).size).toBe(2);
    expect(cards.map((c) => c.props('line').botKey).sort()).toEqual(
      [a!.bot_key, b!.bot_key].sort(),
    );
  });
});

describe('TradeTable: cards under 560 px of container', () => {
  it('is a table at 560 px and cards at 559 px, whatever the window', () => {
    const table = mountTrades({ preset: 'open', containerWidth: 560 });
    expect(table.attributes('data-cards')).toBeUndefined();
    expect(table.find('table').exists()).toBe(true);
    const cards = mountTrades({ preset: 'open', containerWidth: 559 });
    expect(cards.attributes('data-cards')).toBeDefined();
    expect(cards.find('table').exists()).toBe(false);
    expect(cards.findAllComponents(PositionCard).length).toBeGreaterThan(0);
  });

  it('shows seven cards then "See the N others"', async () => {
    const w = mountTrades({ preset: 'open', containerWidth: 400 });
    const total = world.fixture.positions.length;
    expect(w.findAllComponents(PositionCard)).toHaveLength(7);
    const more = w.get('.more');
    expect(more.text()).toContain(String(total - 7));
    await more.trigger('click');
    expect(w.findAllComponents(PositionCard)).toHaveLength(total);
  });

  it('cards keep profit, loss, orphan and stale apart', () => {
    const bot = world.fixture.bots.find(
      (b) => b.identity.mode === 'live' && b.state.status === 'online',
    )!;
    const win: Position = {
      ...makePosition(bot, 'SOL/USDC:USDC', 1, 'long', 0.5),
      profit_abs: 12.34,
      profit_ratio: 0.05,
    };
    const loss: Position = {
      ...makePosition(bot, 'SOL/USDC:USDC', 2, 'long', 0.5),
      profit_abs: -12.34,
      profit_ratio: -0.05,
    };
    const orphan: Position = {
      ...makePosition(bot, 'SOL/USDC:USDC', 3, 'short', 0.5),
      bot_key: 'orphan:w',
      orphan: true,
    };
    const stale: Position = {
      ...makePosition(bot, 'SOL/USDC:USDC', 4, 'long', 0.5),
      freshness: { as_of_ms: FIXTURE_NOW - 600_000, source: 'digest', stale: true },
    };
    const w = mountTrades({
      preset: 'open',
      containerWidth: 400,
      positions: [win, loss, orphan, stale],
    });
    const cards = w.findAll('article.card');
    expect(cards).toHaveLength(4);
    expect(cards.some((c) => c.classes().includes('orphan'))).toBe(true);
    expect(cards.some((c) => c.classes().includes('stale'))).toBe(true);
    // The orphan card has no exit button, only a reconciliation
    const orphanCard = cards.find((c) => c.classes().includes('orphan'))!;
    expect(orphanCard.find('[data-action=exit]').exists()).toBe(false);
    expect(orphanCard.find('[data-action=reconcile]').exists()).toBe(true);
    // Lines carry the sign of the P&L
    expect(lineFromPosition(win, bot).pnlAbs).toBeGreaterThan(0);
    expect(lineFromPosition(loss, bot).pnlAbs).toBeLessThan(0);
  });

  it('a long bot name wraps in the table and is never dropped', () => {
    const long = world.fixture.bots.find((b) => b.identity.name.length > 60)!;
    const p = { ...makePosition(long, 'SOL/USDC:USDC', 7, 'long', 0.5) };
    const w = mountTrades({ preset: 'open', containerWidth: 1200, positions: [p] });
    expect(w.text()).toContain(long.identity.name);
  });
});
