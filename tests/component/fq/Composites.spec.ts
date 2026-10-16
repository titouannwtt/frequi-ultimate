import { DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import AppShell from '../../../src/components/fq/AppShell.vue';
import BotActionBar from '../../../src/components/fq/BotActionBar.vue';
import BotHeader from '../../../src/components/fq/BotHeader.vue';
import FleetScope from '../../../src/components/fq/FleetScope.vue';
import ScopePanel from '../../../src/components/fq/ScopePanel.vue';
import TradeDrawer from '../../../src/components/fq/TradeDrawer.vue';
import { FIXTURE_NOW, scopeDetailOf } from '../../../src/components/fq/fixtures';
import { useActionDialog } from '../../../src/composables/useActionDialog';
import { useCommandPalette } from '../../../src/composables/useCommandPalette';
import { useScope } from '../../../src/composables/useScope';
import { useFqAlertsStore } from '../../../src/datasource/stores/alerts';
import { useFqHealthStore } from '../../../src/datasource/stores/health';
import { useFqPositionsStore } from '../../../src/datasource/stores/positions';
import type { BotRow } from '../../../src/gateway/types.gen';
import { mountFq, setFqLocale, setupWorld, teardownWorld, type FqWorld } from './helpers';

let world: FqWorld;
const bots = (pred: (b: BotRow) => boolean) => world.fixture.bots.find(pred)!;
beforeEach(() => {
  world = setupWorld();
});
afterEach(teardownWorld);

/** Open the "More" menu of a header or action bar and return its items (it opens in <body>). */
async function openMore(w: VueWrapper<any>) {
  await w.get('[data-action=more]').trigger('click');
  await nextTick();
  await nextTick();
  const all = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role=menuitem]'));
  return {
    all,
    item: (re: RegExp) => new DOMWrapper(all().find((i) => re.test(i.textContent ?? ''))!),
  };
}

describe('BotHeader', () => {
  const header = (bot: BotRow) =>
    mountFq(BotHeader, {
      props: { bot, nowMs: FIXTURE_NOW, canPrev: true, canNext: false },
      attachTo: document.body,
    });

  it('an online bot: name, mode, no banner, actions available', () => {
    const bot = bots(
      (b) => b.identity.mode === 'live' && b.state.status === 'online' && !b.freshness.state?.stale,
    );
    const w = header(bot);
    expect(w.get('h1').text()).toBe(bot.identity.name);
    expect(w.text()).toContain('Live');
    expect(w.find('[class*=banner]').exists()).toBe(false);
    expect(w.get('[data-action=pause]').attributes('aria-disabled')).toBeUndefined();
    // One visible action and a "More" menu: Reload, Config and Exit all are not on the bar
    expect(w.findAll('.bar [data-action]').map((b) => b.attributes('data-action'))).toEqual([
      'pause',
      'more',
    ]);
    expect(w.find('[data-action=exitAll]').exists()).toBe(false);
  });

  it('the More menu: everyday actions, the information, then Exit all and Stop apart', async () => {
    const bot = bots(
      (b) => b.identity.mode === 'live' && b.state.status === 'online' && !b.freshness.state?.stale,
    );
    const w = header(bot);
    const menu = await openMore(w);
    const labels = menu.all().map((i) => i.textContent?.trim());
    expect(labels).toEqual([
      'Resume entries',
      'Reload the config',
      'See the config',
      'Forced entry…',
      'Dry replay',
      'Exit all…',
      'Stop the bot…',
    ]);
    const text = document.body.textContent ?? '';
    // The port, the exchange and the age moved here from the header
    expect(text).toContain(`port ${bot.identity.port}`);
    expect(text.indexOf('Sensitive actions')).toBeGreaterThan(
      text.indexOf(`port ${bot.identity.port}`),
    );
    expect(text.indexOf('Sensitive actions')).toBeLessThan(text.indexOf('Exit all'));
    expect(menu.item(/Exit all/).attributes('aria-disabled')).toBeUndefined();
    // The header no longer carries the port: the meta line is strategy, timeframe, uptime
    expect(w.get('[data-testid=bot-meta]').text()).not.toContain('port');
  });

  it('exposure not read yet is not invented, the exposure is read once the book is known (B198)', () => {
    const bot = bots((b) => b.identity.mode === 'live' && b.state.status === 'online');
    const unread = {
      ...bot,
      metrics: { ...bot.metrics, exposure_long: null, exposure_short: null },
    } as BotRow;
    const w = header(unread);
    const tile = w
      .get('[data-testid=bot-header]')
      .findAll('.kpi')
      .find((e) => e.text().startsWith('Bot capital'))!;
    expect(tile).toBeDefined();
    // Four figures in the header; the exposure is the line under the capital
    expect(w.get('[data-testid=bot-header]').findAll('.kpi')).toHaveLength(4);
    // An unread position book is not a flat one: no "exposed 0 (long 0, short 0)" is invented
    expect(tile.find('.s').exists() ? tile.get('.s').text() : '').not.toMatch(/exposed/);
    expect(w.text()).not.toMatch(/not read yet|0\s*\/\s*0|exposed 0/);
  });

  it('an offline bot: frozen values, banner telling NOT to restart it, every action disabled with the reason', async () => {
    const bot = bots((b) => b.state.status === 'offline');
    const w = header(bot);
    const text = w.text();
    expect(text).toMatch(/offline/i);
    expect(text).toMatch(/frozen|figées/i);
    const pause = w.get('[data-action=pause]');
    expect(pause.attributes('aria-disabled')).toBe('true');
    expect(pause.attributes('title')).toBeTruthy();
    const menu = await openMore(w);
    for (const re of [/Resume/, /Reload/, /Exit all/, /Stop the bot/]) {
      const item = menu.item(re);
      expect(item.attributes('aria-disabled')).toBe('true');
      expect(item.attributes('title')).toBeTruthy();
    }
    // A click on a disabled danger item opens nothing
    await menu.item(/Exit all/).trigger('click');
    expect(useActionDialog().current.value).toBeNull();
  });

  it('an expired session: banner with a reconnect button, actions disabled, nothing replayed', async () => {
    const bot = bots((b) => b.state.status === 'auth_expired');
    const w = header(bot);
    expect(w.get('[data-action=pause]').attributes('aria-disabled')).toBe('true');
    const reconnect = w.findAll('button').find((b) => /reconnect/i.test(b.text()))!;
    await reconnect.trigger('click');
    expect(w.emitted('reconnect')).toHaveLength(1);
    expect(world.fake.acts).toHaveLength(0);
  });

  it('a starting bot and a stopped bot are told apart and not actionable', async () => {
    const starting = header(bots((b) => b.state.status === 'starting'));
    expect(starting.text()).toMatch(/starting/i);
    expect(starting.get('[data-action=pause]').attributes('aria-disabled')).toBe('true');
    // B300: the word was said twice ("Starting starting 0 min")
    expect(starting.text()).not.toMatch(/starting\s+starting/i);
    expect(starting.text()).toMatch(/Starting for \d+ min\./);
    const stopped = header(bots((b) => b.state.status === 'stopped'));
    expect(stopped.text()).toMatch(/stopped/i);
    const menu = await openMore(stopped);
    expect(menu.item(/Reload/).attributes('aria-disabled')).toBe('true');
  });

  it('unknown values stay unknown: no zero is invented for capital or drawdown', () => {
    const bot = bots((b) => b.metrics.starting_capital == null);
    const w = header(bot);
    const capital = w.findAll('.kpi').find((e) => e.text().startsWith('Bot capital'))!;
    expect(capital.get('.v').text()).toBe('');
    expect(capital.get('.v [data-state="unavailable"]').attributes('aria-label')).toBe(
      'Starting capital unknown',
    );
    expect(w.text()).not.toMatch(/n\/a|n\/d/i);
  });

  it('opens the destructive confirmation of THIS bot only, never sends from the header', async () => {
    const bot = bots(
      (b) => b.identity.mode === 'live' && b.state.status === 'online' && !b.freshness.state?.stale,
    );
    const w = header(bot);
    const menu = await openMore(w);
    await menu.item(/Exit all/).trigger('click');
    expect(useActionDialog().current.value).toMatchObject({
      botKey: bot.bot_key,
      action: { kind: 'forceexit', tradeId: 'all' },
    });
    expect(world.fake.acts).toHaveLength(0);
  });

  it('emits prev, next and the picker; the disabled neighbour does nothing', async () => {
    const bot = bots((b) => b.state.status === 'online');
    const w = header(bot);
    await w.get('.prev').trigger('click');
    await w.get('.next').trigger('click');
    expect(w.emitted('prev')).toHaveLength(1);
    expect(w.emitted('next')).toBeUndefined();
  });
});

describe('BotActionBar', () => {
  it('a busy action shows aria-busy on every surface and a click says "already running"', async () => {
    const bot = bots(
      (b) => b.identity.mode === 'live' && b.state.status === 'online' && !b.freshness.state?.stale,
    );
    const w = mountFq(BotActionBar, {
      props: { botKey: bot.bot_key, context: 'header' },
      attachTo: document.body,
    });
    const lock = (await import('../../../src/composables/useInflightLock')).useInflightLock();
    lock.acquire(`${bot.bot_key}:stopbuy:-`);
    await nextTick();
    const pause = w.get('[data-action=pause]');
    expect(pause.attributes('aria-busy')).toBe('true');
    await pause.trigger('click');
    expect(w.emitted('locked')![0]).toEqual(['pause']);
    expect(useActionDialog().current.value).toBeNull();
  });

  it('config navigates, it is not a mutation', async () => {
    const bot = bots((b) => b.state.status === 'online');
    const w = mountFq(BotActionBar, {
      props: { botKey: bot.bot_key, context: 'header' },
      attachTo: document.body,
    });
    const menu = await openMore(w);
    await menu.item(/See the config/).trigger('click');
    expect(w.emitted('navigate')![0]).toEqual(['config']);
    expect(useActionDialog().current.value).toBeNull();
  });

  it('the drawer foot has Exit and Add, a danger-outline exit and never a red fill', () => {
    const p = world.fixture.positions.find((x) => !x.orphan)!;
    const w = mountFq(BotActionBar, {
      props: { botKey: p.bot_key, context: 'drawer', position: p },
      attachTo: document.body,
    });
    expect(w.get('[data-action=exit]').classes()).toContain('danger-outline');
    expect(w.find('.danger').exists()).toBe(false);
  });
});

describe('TradeDrawer', () => {
  const dupes = () => world.fixture.positions.filter((p) => p.trade_id === 1180);

  it('shows the trade of the bot it is addressed to, even when another bot has the same id', () => {
    const [a, b] = dupes();
    const wa = mountFq(TradeDrawer, {
      props: { botKey: a!.bot_key, tradeId: 1180, docked: true },
      attachTo: document.body,
    });
    const wb = mountFq(TradeDrawer, {
      props: { botKey: b!.bot_key, tradeId: 1180, docked: true },
      attachTo: document.body,
    });
    const nameA = world.fixture.bots.find((x) => x.bot_key === a!.bot_key)!.identity.name;
    const nameB = world.fixture.bots.find((x) => x.bot_key === b!.bot_key)!.identity.name;
    expect(wa.text()).toContain(nameA);
    expect(wa.text()).not.toContain(nameB);
    expect(wb.text()).toContain(nameB);
    expect(a!.side).not.toBe(b!.side);
    expect(wa.text()).toContain(a!.side === 'short' ? 'S' : 'L');
  });

  it('a trade that closed while the drawer was open: says so, no action remains', async () => {
    const [a] = dupes();
    const w = mountFq(TradeDrawer, {
      props: { botKey: a!.bot_key, tradeId: 1180, docked: true },
      attachTo: document.body,
    });
    expect(w.find('[data-action=exit]').exists()).toBe(true);
    useFqPositionsStore().$patch({});
    const store = useFqPositionsStore();
    store.apply({
      kind: 'delta',
      seq: 2,
      ts: FIXTURE_NOW,
      replace: [],
      upsert: {},
      remove: { positions: [`${a!.bot_key}/1180`] },
    } as never);
    await nextTick();
    expect(w.find('[data-action=exit]').exists()).toBe(false);
    expect(w.text()).toMatch(/no longer open|n’est plus ouvert|isn.t open/i);
  });

  it('an orphan position has the reconciliation and no exit', () => {
    const o = world.fixture.positions.find((p) => p.orphan)!;
    const w = mountFq(TradeDrawer, {
      props: { botKey: o.bot_key, tradeId: o.trade_id, docked: true },
      attachTo: document.body,
    });
    expect(w.find('[data-action=exit]').exists()).toBe(false);
    expect(w.find('[data-action=reconcile]').exists()).toBe(true);
  });

  it('the foot has no share choice: it is made in the exit confirmation, and 100 % by default', async () => {
    const p = world.fixture.positions.find((x) => !x.orphan)!;
    const w = mountFq(TradeDrawer, {
      props: { botKey: p.bot_key, tradeId: p.trade_id, docked: true },
      attachTo: document.body,
    });
    await nextTick();
    expect(w.findAll('button').some((b) => /^\d+ %$/.test(b.text().trim()))).toBe(false);
    expect(w.text()).not.toMatch(/min\. 10 USDC/);
    expect(w.find('[data-action=exit]').exists()).toBe(true);
  });
});

describe('ScopePanel and FleetScope', () => {
  it('ScopePanel never adds live and dry: one block per mode, with a note', () => {
    const detail = scopeDetailOf(world.fixture, { kind: 'fleet' });
    const w = mountFq(ScopePanel, {
      props: { scope: { kind: 'fleet' }, open: true, inline: true, detail },
      attachTo: document.body,
    });
    const blocks = w.findAll('section.blk');
    expect(blocks.map((b) => b.attributes('data-mode'))).toEqual(['live', 'dry']);
    expect(w.find('.notsum').exists()).toBe(true);
  });

  it('ScopePanel positions: first five, then "See the N others"', async () => {
    const detail = scopeDetailOf(world.fixture, { kind: 'fleet' });
    const w = mountFq(ScopePanel, {
      props: { scope: { kind: 'fleet' }, open: true, inline: true, detail, positionLimit: 3 },
      attachTo: document.body,
    });
    expect(w.text()).toMatch(/See the \d+ others/);
  });

  it('FleetScope: live, dry and all are explicit, and hidden dry bots are announced', async () => {
    const w = mountFq(FleetScope, { attachTo: document.body });
    const scope = useScope();
    const live = w.findAll('[role=radio], button').find((b) => b.text().trim() === 'Live')!;
    await live.trigger('click');
    expect(scope.mode.value).toBe('live');
    expect(scope.bots.value.every((b) => b.identity.mode === 'live')).toBe(true);
    const dry = w.findAll('[role=radio], button').find((b) => b.text().trim() === 'Dry')!;
    await dry.trigger('click');
    expect(scope.mode.value).toBe('dry');
    expect(scope.bots.value.every((b) => b.identity.mode === 'dry')).toBe(true);
    const all = w.findAll('[role=radio], button').find((b) => b.text().trim() === 'All')!;
    await all.trigger('click');
    // Replay never belongs to a fleet scope
    expect(scope.bots.value.some((b) => b.identity.mode === 'replay')).toBe(false);
    scope.reset();
  });
});

describe('AppShell', () => {
  it('mounts the single confirmation host and the palette; Ctrl K opens the palette', async () => {
    const w = mountFq(AppShell, {
      props: { page: 'fleet', source: world.fake.source, inline: true, contained: true },
      slots: { default: '<div id="page">page</div>' },
      attachTo: document.body,
    });
    await nextTick();
    expect(w.find('#page').exists()).toBe(true);
    expect(document.body.querySelector('[data-testid=command-palette]')).toBeNull();
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await nextTick();
    expect(useCommandPalette().open.value).toBe(true);
    expect(document.body.querySelector('[data-testid=command-palette]')).not.toBeNull();
    useCommandPalette().hide();
  });

  const setHealth = (patch: Partial<typeof world.fixture.health>) =>
    useFqHealthStore().apply({
      kind: 'snapshot',
      seq: 2,
      ts: FIXTURE_NOW,
      replace: ['health'],
      upsert: { health: { fleet: { ...world.fixture.health, ...patch } } },
      remove: {},
    } as never);
  const shell = () =>
    mountFq(AppShell, {
      props: { page: 'fleet', source: world.fake.source, inline: true, contained: true },
      attachTo: document.body,
    });

  it('shows the connection as a dot and a word, the latency in its tooltip', () => {
    const w = shell();
    const pill = w.get('.conn');
    expect(pill.text()).toBe('Up to date');
    expect(pill.attributes('title')).toContain('38 ms');
    expect(w.text()).toMatch(/Fleet|Flotte/);
  });

  it('no longer names the product variant, nor offers the theme or the density in the bars', () => {
    const w = shell();
    expect(w.get('.logo').text()).toBe('FreqUI');
    expect(w.text()).not.toContain('Ultimate');
    expect(w.find('.top [aria-label^="Theme"]').exists()).toBe(false);
    expect(w.get('.statusbar').text()).not.toMatch(/Compact|Airy|Comfortable/);
  });

  it('the status bar says how fresh the data is, and goes amber past 30 s', () => {
    setHealth({ digest_age_s: 3 });
    const w = shell();
    const fresh = w.get('[data-testid=sb-fresh]');
    expect(fresh.text()).toBe('Up to date, 3 s ago');
    expect(fresh.classes()).not.toContain('lvl-warn');
  });

  it('a late digest is worded as late, in amber', async () => {
    setHealth({ digest_age_s: 45 });
    const fresh = shell().get('[data-testid=sb-fresh]');
    expect(fresh.text()).toBe('Last updated 45 s ago');
    expect(fresh.classes()).toContain('lvl-warn');
  });

  it('says nothing about the health when it is OK', () => {
    setHealth({ level: 'ok', reasons: [], rate_budget_pct: 20, backoff_active: false });
    const bar = shell().get('.statusbar');
    expect(bar.find('[data-testid=sb-health]').exists()).toBe(false);
    expect(bar.find('[data-testid=sb-budget]').exists()).toBe(false);
    expect(bar.find('[data-testid=sb-backoff]').exists()).toBe(false);
    expect(bar.text()).not.toMatch(/Health|OK|Live bots|Snapshot/);
  });

  it('a degraded health is worded in plain words with its reason', () => {
    const health = shell().get('[data-testid=sb-health]');
    expect(health.text()).toBe('Connection slowed: the exchange is limiting calls (backoff)');
  });

  it('the Hyperliquid quota appears only above 70 %, and the backoff has its own line', () => {
    const low = shell().get('.statusbar');
    expect(low.find('[data-testid=sb-budget]').exists()).toBe(false);
    expect(low.get('[data-testid=sb-backoff]').text()).toBe(
      'Hyperliquid is limiting calls, resuming automatically',
    );
    setHealth({ rate_budget_pct: 82 });
    const high = shell().get('.statusbar');
    expect(high.get('[data-testid=sb-budget]').text()).toBe('Hyperliquid calls: 82 % of the quota');
  });

  it('the error count of the logs appears only when it is above zero', () => {
    const alerts = useFqAlertsStore();
    const w = shell();
    const errors = alerts
      .view(FIXTURE_NOW, 'active')
      .filter((a) => a.type_id === 'logErrors' || a.type_id === 'orderFailed').length;
    const logs = w.find('[data-testid=sb-logs]');
    expect(logs.exists()).toBe(errors > 0);
    if (errors > 0) expect(logs.text()).toMatch(/error/);
  });

  it('speaks French without leaving English keys on screen', () => {
    setFqLocale('fr');
    const w = mountFq(AppShell, {
      props: { page: 'fleet', source: world.fake.source, inline: true, contained: true },
      attachTo: document.body,
    });
    expect(w.text()).toContain('Flotte');
    expect(w.text()).not.toMatch(/fq\.[a-z]+\./);
    vi.useRealTimers();
  });
});
