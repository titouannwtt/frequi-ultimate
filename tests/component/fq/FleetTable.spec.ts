import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import FleetMap from '../../../src/components/fq/FleetMap.vue';
import FleetTable from '../../../src/components/fq/FleetTable.vue';
import { FIXTURE_NOW, makeBot, makeFleet } from '../../../src/components/fq/fixtures';
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

  it('puts the critical bots first, calm ones last, whatever the input order', () => {
    const rows = [...world.fixture.bots].reverse();
    const w = mountTable(rows);
    const order = names(w).map((k) => rows.find((r) => r.bot_key === k)!);
    const rank = (b: BotRow) =>
      b.alerts.count === 0 ? 0 : { info: 1, warning: 2, critical: 3 }[b.alerts.max_severity!];
    const ranks = order.map(rank);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    expect(ranks[0]).toBe(3);
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

  it('a mixed live and dry scope shows one sum per mode and never a combined one', () => {
    const w = mountTable(world.fixture.bots.filter((b) => b.identity.mode !== 'replay'));
    const sigma = w.findAll('tr.sigma');
    expect(sigma.map((r) => r.attributes('data-sigma'))).toEqual(['live', 'dry']);
    expect(sigma[0]!.text()).toContain('Live');
    expect(sigma[1]!.text()).toContain('Dry');
  });

  it('a single-mode scope has a single Σ row; replay is never summed with the rest', () => {
    const live = world.fixture.bots.filter((b) => b.identity.mode === 'live');
    expect(mountTable(live).findAll('tr.sigma')).toHaveLength(1);
    const withReplay = world.fixture.bots.filter((b) => b.identity.mode !== 'dry');
    const modes = mountTable(withReplay)
      .findAll('tr.sigma')
      .map((r) => r.attributes('data-sigma'));
    expect(modes).toEqual(['live']);
  });

  it('the Σ row says how many bots it leaves out (stale, offline)', () => {
    const live = world.fixture.bots.filter((b) => b.identity.mode === 'live');
    const text = mountTable(live).get('tr.sigma').text();
    expect(text).toMatch(/\d+\s+excluded/i);
  });

  it('the Σ latent equals the sum of the fresh live bots only', () => {
    const live = world.fixture.bots.filter((b) => b.identity.mode === 'live');
    const fresh = live.filter(
      (b) => !b.freshness.positions?.stale && b.metrics.open_profit_abs != null,
    );
    const expected = fresh.reduce((a, b) => a + (b.metrics.open_profit_abs ?? 0), 0);
    const w = mountTable(live);
    const cell = w
      .get('tr.sigma th:nth-child(3)')
      .text()
      .replace(/[\s\u202f\u00a0]/g, '');
    const digits = Math.abs(expected).toFixed(2).replace('.', ',');
    const asDot = Math.abs(expected).toFixed(2);
    expect(cell.includes(digits) || cell.includes(asDot)).toBe(true);
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

  it('a row opens its bot on click and on Enter; Σ opens the fleet scope', async () => {
    const w = mountTable(world.fixture.bots);
    const first = w.get('tr.bot');
    await first.trigger('click');
    await first.trigger('keydown', { key: 'Enter' });
    const key = first.attributes('data-bot-key');
    expect(w.emitted('selectBot')).toEqual([[key], [key]]);
    await w.get('tr.sigma').trigger('click');
    expect(w.emitted('selectScope')![0]![0]).toEqual({ kind: 'fleet' });
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
    expect(row(unknown).findAll('[data-state]').length).toBeGreaterThan(2);
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
    // 02 section 3.1: the order of removal (last trade, sparkline, 30 d and exposure, then the rest)
    expect(ids(1100)).toContain('last_trade');
    expect(ids(1000)).not.toContain('last_trade');
    expect(ids(800)).toContain('realized_30d');
    expect(ids(790)).not.toContain('realized_30d');
    expect(ids(790)).not.toContain('exposure');
    expect(ids(590)).not.toContain('realized_1d');
    expect(ids(590)).not.toContain('trades');
    expect(ids(590)).not.toContain('side');
  });

  it('speaks French with non breaking spaces before punctuation', () => {
    setFqLocale('fr');
    const live = world.fixture.bots.filter((b) => b.identity.mode === 'live');
    const w = mountTable(live);
    expect(w.get('tr.sigma').text()).toContain('Flotte');
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
