import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { FIXTURE_NOW, makeFixture, resetStores, seedStores } from '@/components/fq/fixtures';
import { TradeDrawer } from '@/components/fq';
import { resetActionDialog, useActionDialog } from '@/composables/useActionDialog';
import { useToaster } from '@/composables/useToaster';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import i18n from '@/locales';
import BotPage from '@/views/fq/BotPage.vue';
import FleetPage from '@/views/fq/FleetPage.vue';

// Charts need a canvas; the pages are checked for what they wire, not for pixels.
const stubs = {
  BaseChart: true,
  EquityCurve: true,
  PnlCalendar: true,
  Leaderboard: true,
  CandleChart: true,
  Teleport: true,
};

function pageRouter(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/dashboard', name: 'fleet', component: { render: () => null } },
      { path: '/bot/:botKey', name: 'bot', component: { render: () => null } },
      { path: '/journal', component: { render: () => null } },
      { path: '/charts', component: { render: () => null } },
    ],
  });
  void router.push(path);
  return router;
}

const fixture = makeFixture(12);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
  seedStores(fixture);
});
afterEach(() => {
  resetStores();
  vi.useRealTimers();
});

describe('FleetPage', () => {
  it('shows the fleet, the open positions and the "needs attention" rail from the stores', async () => {
    const router = pageRouter('/dashboard');
    await router.isReady();
    const w = mount(FleetPage, {
      global: { plugins: [i18n, router], stubs },
      attachTo: document.body,
    });
    await flushPromises();
    expect(w.find('[data-testid="fleet-page"]').exists()).toBe(true);
    expect(w.find('[data-testid="alert-rail"]').exists()).toBe(true);
    // One row per bot of the scope (live by default), named like in the fleet store.
    const live = fixture.bots.filter((b) => b.identity.mode === 'live');
    expect(live.length).toBeGreaterThan(0);
    for (const b of live.slice(0, 3)) expect(w.text()).toContain(b.identity.name);
    w.unmount();
  });

  it('counts the open positions of the scope, the number the table shows', async () => {
    // A fleet with dry bots too, so that the scope and the whole differ
    const fixture = makeFixture(40);
    resetStores();
    seedStores(fixture);
    const router = pageRouter('/dashboard');
    await router.isReady();
    const w = mount(FleetPage, { global: { plugins: [i18n, router], stubs } });
    await flushPromises();
    const live = new Set(
      fixture.bots.filter((b) => b.identity.mode === 'live').map((b) => b.bot_key),
    );
    const expected = fixture.positions.filter((p) => p.orphan || live.has(p.bot_key)).length;
    expect(expected).toBeLessThan(fixture.positions.length);
    const metas = w.findAll('.meta').map((m) => m.text());
    // The positions pane says "<n> · worst first": n is the scoped count, not every mode
    expect(metas).toContain(`${expected} · worst first`);
    expect(metas).not.toContain(`${fixture.positions.length} · worst first`);
    w.unmount();
  });

  it('/open_trades lands on the positions pane: it scrolls to it, without an error (B169)', async () => {
    const scrolled = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    try {
      const router = pageRouter('/dashboard?view=positions');
      await router.isReady();
      const w = mount(FleetPage, {
        global: { plugins: [i18n, router], stubs },
        attachTo: document.body,
      });
      await flushPromises();
      expect(scrolled).toHaveBeenCalled();
      expect((scrolled.mock.contexts[0] as HTMLElement).classList.contains('positions')).toBe(true);
      w.unmount();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('keeps the live and the dry figures apart in the All scope', async () => {
    const router = pageRouter('/dashboard?scope=all');
    await router.isReady();
    const w = mount(FleetPage, { global: { plugins: [i18n, router], stubs } });
    await flushPromises();
    expect(w.findAll('[data-testid="fleet-kpis"] .row').length).toBeLessThanOrEqual(2);
    w.unmount();
  });
});

describe('BotPage', () => {
  it('opens the bot of the URL with its header and its positions', async () => {
    const bot = fixture.bots.find((b) => b.identity.mode === 'live')!;
    const router = pageRouter(`/bot/${encodeURIComponent(bot.bot_key)}`);
    await router.isReady();
    const w = mount(BotPage, { global: { plugins: [i18n, router], stubs } });
    await flushPromises();
    expect(w.text()).toContain(bot.identity.name);
    w.unmount();
  });

  it('has no second list of the positions: three tabs, a More menu, one header action', async () => {
    const bot = fixture.bots.find((b) => b.identity.mode === 'live')!;
    const router = pageRouter(`/bot/${encodeURIComponent(bot.bot_key)}`);
    await router.isReady();
    const w = mount(BotPage, {
      global: { plugins: [i18n, router], stubs },
      attachTo: document.body,
    });
    await flushPromises();
    // The pair navigator only exists inside the "Pairs and locks" tab, never beside the chart
    expect(w.find('[data-testid="pair-navigator"]').exists()).toBe(false);
    expect(w.findAll('[role="tab"]').map((t) => t.text().replace(/\d+$/, '').trim())).toEqual([
      'Positions',
      'History',
      'Performance',
    ]);
    expect(w.find('[data-testid="bot-tabs-more"]').exists()).toBe(true);
    // The header: Pause entries and More, nothing else on the bar
    expect(
      w
        .findAll('[data-testid="bot-header"] .bar [data-action]')
        .map((b) => b.attributes('data-action')),
    ).toEqual(['pause', 'more']);
    w.unmount();
  });

  it('a tab behind More takes a place in the bar while it is open', async () => {
    const bot = fixture.bots.find((b) => b.identity.mode === 'live')!;
    const router = pageRouter(`/bot/${encodeURIComponent(bot.bot_key)}?tab=logs`);
    await router.isReady();
    const w = mount(BotPage, { global: { plugins: [i18n, router], stubs } });
    await flushPromises();
    const tabs = w.findAll('[role="tab"]').map((t) => t.text().replace(/\d+$/, '').trim());
    expect(tabs).toEqual(['Positions', 'History', 'Performance', 'Logs']);
    expect(w.find('[role="tab"][aria-selected="true"]').text()).toContain('Logs');
    w.unmount();
  });

  it('never falls back on another trade when the chosen one has closed', async () => {
    // A bot with at least two open positions: the chosen one is not the worst
    const byBot = new Map<string, number[]>();
    for (const p of fixture.positions) {
      byBot.set(p.bot_key, [...(byBot.get(p.bot_key) ?? []), p.trade_id]);
    }
    const [botKey, ids] = [...byBot.entries()].find(([, v]) => v.length >= 2)!;
    const positions = useFqPositionsStore();
    const worst = positions
      .byBot(botKey)
      .slice()
      .sort((a, b) => (a.profit_abs ?? Infinity) - (b.profit_abs ?? Infinity))[0]!;
    const chosen = ids.find((id) => id !== worst.trade_id)!;

    const router = pageRouter(`/bot/${encodeURIComponent(botKey)}?trade=${chosen}`);
    await router.isReady();
    const w = mount(BotPage, { global: { plugins: [i18n, router], stubs } });
    await flushPromises();
    expect(w.findComponent(TradeDrawer).props('tradeId')).toBe(chosen);

    positions.apply({
      kind: 'delta',
      seq: 2,
      ts: FIXTURE_NOW,
      replace: [],
      upsert: {},
      remove: { positions: [`${botKey}/${chosen}`] },
    });
    await flushPromises();
    // The drawer and the sheet are gone: no exit button on a trade nobody picked
    expect(w.findComponent(TradeDrawer).exists()).toBe(false);
    w.unmount();
  });

  it('lifts a pair lock through the confirmation, whatever the trades of the bot', async () => {
    const bot = fixture.bots.find((b) => b.identity.mode === 'live')!;
    const first = fixture.positions.find((p) => p.bot_key === bot.bot_key);
    // A lock id equal to the id of an open trade of the same bot
    const lockId = first?.trade_id ?? 1;
    const PairNavigatorStub = {
      emits: ['liftLock'],
      template: `<button data-testid="lift" @click="$emit('liftLock', { lockId: ${lockId}, tradeId: null, botKey: null, pair: 'ETH/USDC:USDC' })">lift</button>`,
    };
    const router = pageRouter(`/bot/${encodeURIComponent(bot.bot_key)}?tab=pairs`);
    await router.isReady();
    resetActionDialog();
    const w = mount(BotPage, {
      global: { plugins: [i18n, router], stubs: { ...stubs, PairNavigator: PairNavigatorStub } },
    });
    await flushPromises();
    await w.find('[data-testid="lift"]').trigger('click');
    const req = useActionDialog().current.value;
    expect(req?.action).toEqual({ kind: 'lock_delete', lockId });
    expect(req?.botKey).toBe(bot.bot_key);
    // The confirmation is about the lock, not about a trade that happens to share its number
    expect(req?.context.position).toBeNull();
    resetActionDialog();
    w.unmount();
  });

  it('says so when a lock removal is refused, instead of doing nothing', async () => {
    const bot = fixture.bots.find((b) => b.identity.mode === 'live')!;
    const PairNavigatorStub = {
      emits: ['liftLock'],
      template: `<button data-testid="lift" @click="$emit('liftLock', { lockId: 5, tradeId: null, botKey: null, pair: 'ETH/USDC:USDC' })">lift</button>`,
    };
    const router = pageRouter(`/bot/${encodeURIComponent(bot.bot_key)}?tab=pairs`);
    await router.isReady();
    resetActionDialog();
    const toaster = useToaster();
    toaster.clear();
    const w = mount(BotPage, {
      global: { plugins: [i18n, router], stubs: { ...stubs, PairNavigator: PairNavigatorStub } },
    });
    await flushPromises();
    // What is on screen is a cached snapshot: actions wait for a live one
    useFqConnectionStore().fromCache = true;
    await w.find('[data-testid="lift"]').trigger('click');
    expect(useActionDialog().current.value).toBeNull();
    expect(toaster.toasts.value).toHaveLength(1);
    expect(toaster.toasts.value[0]!.kind).toBe('err');
    expect(toaster.toasts.value[0]!.body).toContain('Cached data');
    toaster.clear();
    w.unmount();
  });

  it('X opens the exit confirmation of the selected row, for its bot, and sends nothing', async () => {
    const bot = fixture.bots.find(
      (b) => b.identity.mode === 'live' && fixture.positions.some((p) => p.bot_key === b.bot_key),
    )!;
    const router = pageRouter(`/bot/${encodeURIComponent(bot.bot_key)}`);
    await router.isReady();
    resetActionDialog();
    const w = mount(BotPage, {
      global: { plugins: [i18n, router], stubs },
      attachTo: document.body,
    });
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    await flushPromises();
    const req = useActionDialog().current.value;
    expect(req?.botKey).toBe(bot.bot_key);
    expect(req?.action.kind).toBe('forceexit');
    // The row selected by default is the worst position of THIS bot
    const worst = useFqPositionsStore()
      .byBot(bot.bot_key)
      .slice()
      .sort((a, b) => (a.profit_abs ?? Infinity) - (b.profit_abs ?? Infinity))[0]!;
    expect(req?.action).toMatchObject({ kind: 'forceexit', tradeId: worst.trade_id });
    resetActionDialog();
    w.unmount();
  });

  it('J moves the selection to the next row of the table', async () => {
    const bot = fixture.bots.find(
      (b) =>
        b.identity.mode === 'live' &&
        fixture.positions.filter((p) => p.bot_key === b.bot_key).length >= 2,
    )!;
    const router = pageRouter(`/bot/${encodeURIComponent(bot.bot_key)}`);
    await router.isReady();
    const w = mount(BotPage, {
      global: { plugins: [i18n, router], stubs },
      attachTo: document.body,
    });
    await flushPromises();
    const before = w.findComponent({ name: 'TradeDrawer' }).props('tradeId');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    await flushPromises();
    const after = w.findComponent({ name: 'TradeDrawer' }).props('tradeId');
    expect(after).not.toBe(before);
    w.unmount();
  });

  it('phone: the sensitive actions sit at the foot of the page, not under the everyday tiles', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width: 599px'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const bot = fixture.bots.find((b) => b.identity.mode === 'live')!;
      const router = pageRouter(`/bot/${encodeURIComponent(bot.bot_key)}`);
      await router.isReady();
      const w = mount(BotPage, { global: { plugins: [i18n, router], stubs } });
      await flushPromises();
      // Two tiles in the header (Pause entries, More), and no folded section there any more
      expect(w.find('.phone .tiles').exists()).toBe(true);
      expect(w.findAll('.phone .tiles .tile').map((t) => t.attributes('data-action'))).toEqual([
        'pause',
        'more',
      ]);
      expect(w.find('.phone .tiles ~ .sens').exists()).toBe(false);
      // The section is below the tabs, in the foot, with both actions
      const foot = w.find('.foot-sens [data-testid="sensitive-actions"]');
      expect(foot.exists()).toBe(true);
      expect(foot.find('[data-action="exitAll"]').exists()).toBe(true);
      expect(foot.find('[data-action="stop"]').exists()).toBe(true);
      const html = w.html();
      expect(html.indexOf('foot-sens')).toBeGreaterThan(html.indexOf('tabbody'));
      w.unmount();
    } finally {
      window.matchMedia = original;
    }
  });
});
