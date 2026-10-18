import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import FleetMap from '../../../src/components/fq/FleetMap.vue';
import FleetTable from '../../../src/components/fq/FleetTable.vue';
import { FIXTURE_NOW, makeBot, makeFleet } from '../../../src/components/fq/fixtures';
import { attentionScore, botState } from '../../../src/components/fq/lib/bots';
import type { BotRow } from '../../../src/gateway/types.gen';
import { mountFq, setFqLocale, setupWorld, teardownWorld, type FqWorld } from './helpers';

let world: FqWorld;
beforeEach(() => {
  world = setupWorld();
});
afterEach(teardownWorld);

const names = (w: ReturnType<typeof mountFq>) =>
  w.findAll('tr.bot').map((r) => r.attributes('data-bot-key')!);

function mountTable(rows: BotRow[], props: Record<string, unknown> = {}) {
  return mountFq(FleetTable, {
    props: { rows, nowMs: FIXTURE_NOW, containerWidth: 1200, ...props },
    attachTo: document.body,
  });
}

describe('FleetTable', () => {
  it('lists the 40 bots, one row each, unvirtualised', () => {
    const w = mountTable(world.fixture.bots);
    expect(w.findAll('tr.bot')).toHaveLength(40);
    expect(w.find('tr.pad').exists()).toBe(false);
    expect(w.classes()).not.toContain('virtual');
  });

  it('windows a very large fleet instead of rendering every row', () => {
    const big = makeFleet(160);
    const w = mountTable(big);
    expect(w.classes()).toContain('virtual');
    const rendered = w.findAll('tr.bot').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(80);
    expect(w.find('tr.pad').exists()).toBe(true);
    // aria-rowcount tells the whole size, not the window
    expect(Number(w.get('table').attributes('aria-rowcount'))).toBeGreaterThanOrEqual(160);
  });

  it('sorts by open P&L, worst first, with the unknown ones last (B8)', () => {
    const w = mountTable([...world.fixture.bots], { sort: 'latent' });
    const rows = world.fixture.bots;
    const latent = names(w).map((k) => rows.find((r) => r.bot_key === k)!.metrics.open_profit_abs);
    const known = latent.filter((v): v is number => v !== null && v !== undefined);
    expect(known.length).toBeGreaterThan(5);
    expect(known).toEqual([...known].sort((a, b) => a - b));
    // Unknown figures never sit in the middle of the order
    const firstUnknown = latent.findIndex((v) => v === null || v === undefined);
    if (firstUnknown !== -1) {
      expect(latent.slice(firstUnknown).every((v) => v === null || v === undefined)).toBe(true);
    }
  });

  it('puts the problems first (silent bots, then alerts), calm ones last, whatever the input order', () => {
    const rows = [...world.fixture.bots].reverse();
    const w = mountTable(rows);
    const order = names(w).map((k) => rows.find((r) => r.bot_key === k)!);
    const rank = (b: BotRow) => attentionScore(b, botState(b, FIXTURE_NOW, 0));
    const ranks = order.map(rank);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    expect(ranks[0]).toBeGreaterThanOrEqual(6);
    // No silent bot (offline or expired session) sits below a bot that answers
    const lastSilent = order.map((b) => botState(b, FIXTURE_NOW, 0)).lastIndexOf('auth_expired');
    const firstOnline = order.findIndex((b) => botState(b, FIXTURE_NOW, 0) === 'online');
    expect(lastSilent).toBeLessThan(firstOnline);
  });

  it('shows a bot whose session expired among the first rows (B360)', () => {
    const expired = makeBot(99, {
      name: 'expired_one',
      mode: 'live',
      status: 'auth_expired',
      latent: 40,
    });
    const rows = [...world.fixture.bots.filter((b) => b.identity.mode === 'live'), expired];
    const w = mountTable(rows, { limit: 8 });
    expect(names(w).slice(0, 8)).toContain(expired.bot_key);
    expect(names(w)[0]).not.toBe(rows[0]!.bot_key);
  });

  it('draws an expired session as offline on the tiles (B362)', () => {
    const expired = makeBot(96, { name: 'exp', mode: 'live', status: 'auth_expired' });
    const w = mountFq(FleetMap, { props: { rows: [expired], nowMs: FIXTURE_NOW } });
    expect(w.get('.tile').classes()).toContain('offline');
  });

  it('writes no "xyz" market tag on the row, the market is in the tooltip of the name (B363)', () => {
    const mixed = makeBot(98, { name: 'mix', mode: 'live', market: 'mixed' });
    const w = mountTable([mixed]);
    expect(w.text()).not.toMatch(/xyz/i);
    expect(w.get('.name').attributes('title')).toContain('mix');
    const tile = mountFq(FleetMap, { props: { rows: [mixed], nowMs: FIXTURE_NOW } });
    expect(tile.text()).not.toMatch(/xyz/i);
  });

  it('the order does not move at a tick, and not at all under the pointer', async () => {
    const bots = world.fixture.bots;
    const w = mountTable(bots);
    const before = names(w);

    // A tick: latent changes everywhere, no alert changes
    const ticked = bots.map((b) => ({
      ...b,
      metrics: {
        ...b.metrics,
        open_profit_abs: (b.metrics.open_profit_abs ?? 0) - 500 + Math.random(),
      },
    }));
    await w.setProps({ rows: ticked });
    expect(names(w)).toEqual(before);

    // The pointer enters: an alert appears on the last calm bot, the table must not shuffle
    await w.trigger('mouseenter');
    expect(w.attributes('data-frozen')).toBeDefined();
    const target = ticked.find((b) => b.alerts.count === 0)!;
    const alerted = ticked.map((b) =>
      b.bot_key === target.bot_key
        ? { ...b, alerts: { count: 1, max_severity: 'critical' as const } }
        : b,
    );
    await w.setProps({ rows: alerted });
    expect(names(w)).toEqual(before);

    // The pointer leaves: the new alert moves its bot up
    await w.trigger('mouseleave');
    await nextTick();
    const after = names(w);
    expect(after).not.toEqual(before);
    expect(after.indexOf(target.bot_key)).toBeLessThan(before.indexOf(target.bot_key));
  });

  it('freezeOnHover=false lets the order follow an alert even under the pointer', async () => {
    const bots = world.fixture.bots;
    const w = mountTable(bots, { freezeOnHover: false });
    const before = names(w);
    await w.trigger('mouseenter');
    const target = bots.find((b) => b.alerts.count === 0)!;
    await w.setProps({
      rows: bots.map((b) =>
        b.bot_key === target.bot_key
          ? { ...b, alerts: { count: 1, max_severity: 'critical' as const } }
          : b,
      ),
    });
    expect(names(w)).not.toEqual(before);
  });

  it('has no sum row: the totals are in the four figures above', () => {
    const w = mountTable(world.fixture.bots.filter((b) => b.identity.mode !== 'replay'));
    expect(w.find('tr.sigma').exists()).toBe(false);
    expect(w.find('thead').findAll('tr')).toHaveLength(1);
  });

  it('shows the profit of each bot by default and keeps the others behind "Columns"', () => {
    const w = mountTable(world.fixture.bots, { containerWidth: 1300 });
    const ids = (w.vm as unknown as { visibleColumnIds: () => string[] }).visibleColumnIds();
    expect(ids).toEqual([
      'bot',
      'latent',
      'realized_1d',
      'realized_7d',
      'realized_30d',
      'realized_total',
      'spark24h',
      'trades',
      'last_trade',
    ]);
    for (const hidden of ['side', 'exposure', 'drawdown', 'age']) {
      expect(ids).not.toContain(hidden);
    }
  });

  it('"Columns" lists the others and a choice adds the column', async () => {
    const w = mountTable(world.fixture.bots, { containerWidth: 1300 });
    await w.get('[data-testid=fleet-columns]').trigger('click');
    const boxes = [...document.body.querySelectorAll<HTMLInputElement>('.colmenu input')];
    expect(boxes.length).toBeGreaterThan(6);
    const drawdown = boxes.find((b) => b.closest('label')?.textContent?.match(/Drop|Recul/i))!;
    expect(drawdown.checked).toBe(false);
    drawdown.checked = true;
    drawdown.dispatchEvent(new Event('change'));
    await nextTick();
    const ids = (w.vm as unknown as { visibleColumnIds: () => string[] }).visibleColumnIds();
    expect(ids).toContain('drawdown');
  });

  it('stops at the limit and shows the others on request', async () => {
    const bots = world.fixture.bots.filter((b) => b.identity.mode === 'live');
    expect(bots.length).toBeGreaterThan(3);
    const w = mountTable(bots, { limit: 3 });
    expect(w.findAll('tr.bot')).toHaveLength(3);
    const more = w.get('[data-testid=fleet-more-bots]');
    expect(more.text()).toContain(String(bots.length - 3));
    await more.trigger('click');
    expect(w.findAll('tr.bot')).toHaveLength(bots.length);
  });

  it('the Bot and Open headers sort, a second click restores the attention order', async () => {
    const w = mountTable(world.fixture.bots);
    const heads = w.findAll('th button.hbtn');
    expect(heads).toHaveLength(2);
    await heads[0]!.trigger('click');
    expect(w.emitted('update:sort')![0]).toEqual(['name']);
    await w.setProps({ sort: 'name' });
    await w.findAll('th button.hbtn')[0]!.trigger('click');
    expect(w.emitted('update:sort')![1]).toEqual(['attention']);
  });

  it('a silent bot shows "frozen" instead of a number that looks alive', () => {
    const w = mountTable(world.fixture.bots);
    const offline = world.fixture.bots.find((b) => b.state.status === 'offline')!;
    expect(w.get(`tr[data-bot-key="${offline.bot_key}"] [data-testid=frozen]`).text()).toMatch(
      /frozen/i,
    );
  });

  it('draws the open positions as bars, one per slot', () => {
    const bot = world.fixture.bots.find(
      (b) => b.state.status === 'online' && (b.state.max_open_trades ?? 0) > 0,
    )!;
    const w = mountTable([bot], { containerWidth: 1300 });
    const pips = w.findAll('[data-testid=slots] .pip');
    expect(pips).toHaveLength(bot.state.max_open_trades!);
    expect(pips.filter((p) => p.classes('on'))).toHaveLength(
      Math.min(bot.state.open_trades, bot.state.max_open_trades!),
    );
  });

  it('a group of mixed modes shows no aggregate (live and dry are never added)', () => {
    const live = world.fixture.bots.find(
      (b) => b.identity.mode === 'live' && b.state.status === 'online',
    )!;
    const dry = world.fixture.bots.find((b) => b.identity.mode === 'dry')!;
    const mixed = mountTable([live, dry], {
      groups: [
        {
          id: 'g',
          name: 'Mixed',
          icon: '',
          collapsed: false,
          botKeys: [live.bot_key, dry.bot_key],
        },
      ],
    });
    const group = mixed.get('tr.grp');
    expect(group.findAll('.pnl, [class*=pnl]').length).toBe(0);
    const pure = mountTable([live], {
      groups: [{ id: 'g', name: 'Pure', icon: '', collapsed: false, botKeys: [live.bot_key] }],
    });
    expect(pure.get('tr.grp').text()).toMatch(/\d/);
  });

  it('groups collapse and expand, say how many bots need a look, and open their scope', async () => {
    const bots = world.fixture.bots.slice(0, 8);
    const w = mountTable(bots, {
      groups: [
        {
          id: 'g1',
          name: 'Core',
          icon: '',
          collapsed: false,
          botKeys: bots.slice(0, 4).map((b) => b.bot_key),
        },
      ],
    });
    const rows = () => w.findAll('tr.bot').length;
    expect(rows()).toBe(8);
    const watch = bots.slice(0, 4).filter((b) => b.alerts.count > 0).length;
    if (watch > 0) expect(w.get('tr.grp .to-watch').text()).toContain(String(watch));
    await w.get('tr.grp .chev').trigger('click');
    expect(rows()).toBe(4);
    expect(w.emitted('toggleGroup')![0]).toEqual(['g1', true]);
    expect(w.emitted('selectScope')).toBeUndefined();
    await w.get('tr.grp').trigger('click');
    expect(w.emitted('selectScope')![0]![0]).toEqual({ kind: 'group', id: 'g1' });
  });

  it('a row opens its bot on click and on Enter', async () => {
    const w = mountTable(world.fixture.bots);
    const first = w.get('tr.bot');
    await first.trigger('click');
    await first.trigger('keydown', { key: 'Enter' });
    const key = first.attributes('data-bot-key');
    expect(w.emitted('selectBot')).toEqual([[key], [key]]);
  });

  it('never cuts the name: the full name is in the DOM and as a tooltip', () => {
    const long = world.fixture.bots.find((b) => b.identity.name.length > 60)!;
    const w = mountTable(world.fixture.bots);
    const row = w.get(`tr[data-bot-key="${long.bot_key}"]`);
    expect(row.get('.name').text()).toBe(long.identity.name);
    expect(row.get('.name').attributes('title')).toBe(long.identity.name);
  });

  it('shows state in words for the bots that do not answer, and mutes stale figures', () => {
    const w = mountTable(world.fixture.bots);
    const offline = world.fixture.bots.find((b) => b.state.status === 'offline')!;
    const row = w.get(`tr[data-bot-key="${offline.bot_key}"]`);
    expect(row.classes()).toContain('offline');
    expect(row.text()).toMatch(/offline/i);
    // Online but with stale figures: the latent is shown muted (and left out of the sums)
    const stale = world.fixture.bots.find(
      (b) => b.state.status === 'online' && b.freshness.positions?.stale,
    )!;
    expect(w.get(`tr[data-bot-key="${stale.bot_key}"]`).findAll('.muted').length).toBeGreaterThan(
      0,
    );
    const fresh = world.fixture.bots.find(
      (b) =>
        b.state.status === 'online' && !b.freshness.positions?.stale && !b.freshness.metrics?.stale,
    )!;
    expect(w.get(`tr[data-bot-key="${fresh.bot_key}"]`).findAll('.muted')).toHaveLength(0);
  });

  it('zero, negative and unknown figures stay distinguishable', () => {
    const unknown = makeBot(90, {
      name: 'unknown_bot',
      mode: 'live',
      latent: null,
      d1: null,
      d30: null,
      capital: null,
    });
    const zero = makeBot(91, {
      name: 'zero_bot',
      mode: 'live',
      latent: 0,
      d1: 0,
      d30: 0,
      long: 0,
      short: 0,
    });
    const w = mountTable([unknown, zero]);
    const u = w.get(`tr[data-bot-key="${unknown.bot_key}"]`).text();
    const z = w.get(`tr[data-bot-key="${zero.bot_key}"]`).text();
    const row = (b: BotRow) => w.get(`tr[data-bot-key="${b.bot_key}"]`);
    // Unknown: icons that say why, never a word; zero: real zeros, no icon
    expect(row(unknown).findAll('[data-state]').length).toBeGreaterThanOrEqual(2);
    expect(row(unknown).find('[data-state="unavailable"]').exists()).toBe(true);
    expect(u).not.toMatch(/n\/a|n\/d|unknown(?!_bot)/i);
    expect(row(zero).find('[data-state]').exists()).toBe(false);
    expect(z).toContain('0.00');
  });

  it('empty scope: an empty state, not an empty table', () => {
    const w = mountTable([]);
    expect(w.find('tr.none').exists()).toBe(true);
    expect(w.findAll('tr.bot')).toHaveLength(0);
  });

  it('drops columns with the width of the panel, not of the window', () => {
    const ids = (width: number) =>
      (
        mountTable(world.fixture.bots, { containerWidth: width }).vm as unknown as {
          visibleColumnIds: () => string[];
        }
      ).visibleColumnIds();
    const narrow = ids(360);
    const wide = ids(1300);
    expect(narrow).toContain('bot');
    expect(narrow).toContain('latent');
    expect(narrow.length).toBeLessThan(wide.length);
    // The order of removal: last trade, then the curve, then positions, then the 30 days
    expect(ids(700)).toContain('last_trade');
    expect(ids(690)).not.toContain('last_trade');
    expect(ids(540)).toContain('spark24h');
    expect(ids(530)).not.toContain('spark24h');
    expect(ids(420)).toContain('trades');
    expect(ids(410)).not.toContain('trades');
    expect(ids(360)).toContain('realized_30d');
    expect(ids(350)).not.toContain('realized_30d');
  });

  it('speaks French with non breaking spaces before punctuation', () => {
    setFqLocale('fr');
    const live = world.fixture.bots.filter((b) => b.identity.mode === 'live');
    const w = mountTable(live);
    expect(w.get('thead').text()).toContain('En cours');
    expect(w.get('[data-testid=fleet-columns]').text()).toBe('Colonnes');
    setFqLocale('en');
  });
});

describe('FleetMap', () => {
  it('has one tile per bot, a title with the full name, and the same order rules', async () => {
    const w = mountFq(FleetMap, {
      props: { rows: world.fixture.bots, nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    const tiles = w.findAll('button.tile');
    expect(tiles).toHaveLength(40);
    const long = world.fixture.bots.find((b) => b.identity.name.length > 60)!;
    expect(w.get(`[data-bot-key="${long.bot_key}"] .t-name`).attributes('title')).toBe(
      long.identity.name,
    );
    await tiles[0]!.trigger('click');
    expect(w.emitted('selectBot')![0]).toEqual([tiles[0]!.attributes('data-bot-key')]);
    // Dry tiles are marked, live tiles have the live dot
    expect(w.findAll('.tile.is-live .live-dot').length).toBeGreaterThan(0);
    expect(w.findAll('.tile.is-dry').length).toBeGreaterThan(0);
  });

  it('empty scope shows the empty state', () => {
    const w = mountFq(FleetMap, {
      props: { rows: [], nowMs: FIXTURE_NOW },
      attachTo: document.body,
    });
    expect(w.text()).toContain('No bot');
  });
});
