import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { CandleChart, ClosedTradePanel, TradeDrawer, TradeTable } from '@/components/fq';
import { FIXTURE_NOW, makeFixture, resetStores, seedStores } from '@/components/fq/fixtures';
import type { Overlays } from '@/components/fq/lib/candles';
import i18n from '@/locales';
import BotPage from '@/views/fq/BotPage.vue';

// The page reads trades through the active source: a double that answers the closed trade
const hoisted = vi.hoisted(() => ({
  holder: { source: null as unknown },
}));
vi.mock('@/composables/useDataSource', async () => {
  const { computed } = await import('vue');
  return { useDataSource: () => ({ source: computed(() => hoisted.holder.source) }) };
});

const stubs = {
  BaseChart: true,
  EquityCurve: true,
  PnlCalendar: true,
  Leaderboard: true,
  CandleChart: true,
  Teleport: true,
};

const fixture = makeFixture(12);
const H = 3_600_000;
const CLOSED_ID = 987_654;
const CLOSE = FIXTURE_NOW - 40 * 24 * H;
const OPEN = CLOSE - 30 * H;

function router(path: string) {
  const r = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/dashboard', name: 'fleet', component: { render: () => null } },
      { path: '/bot/:botKey', name: 'bot', component: { render: () => null } },
      { path: '/journal', component: { render: () => null } },
      { path: '/charts', component: { render: () => null } },
    ],
  });
  void r.push(path);
  return r;
}

/** What freqtrade answers at `/trade/{id}` for a closed trade. */
const raw = (pair: string, id = CLOSED_ID) => ({
  trade_id: id,
  pair,
  is_short: false,
  leverage: 1,
  open_timestamp: OPEN,
  close_timestamp: CLOSE,
  open_rate: 9.8,
  close_rate: 11,
  amount: 10,
  stake_amount: 98,
  profit_abs: 12,
  profit_ratio: 0.12,
  exit_reason: 'roi',
  enter_tag: null,
});

function source(over: { proxy?: (path: string) => unknown; closedRows?: unknown[] } = {}) {
  const proxy = vi.fn(async (_k: string, _m: string, path: string) => {
    if (over.proxy) return over.proxy(path);
    throw new Error('not found');
  });
  hoisted.holder.source = {
    kind: 'gateway',
    proxy,
    subscribe: () => () => undefined,
    registry: { botKeyOf: () => null },
    query: {
      tradeOrders: vi.fn(async () => []),
      trades: vi.fn(async () => ({
        items: over.closedRows ?? [],
        nextCursor: null,
        complete: true,
        totals: {},
      })),
    },
  };
  return proxy;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
  seedStores(fixture);
});
afterEach(() => {
  resetStores();
  vi.useRealTimers();
  hoisted.holder.source = null;
});

const live = () => fixture.bots.find((b) => b.identity.mode === 'live')!;

describe('BotPage on a closed trade', () => {
  it('draws a closed trade of the URL: its pair, its segment and the history around its end', async () => {
    const bot = live();
    const pair = 'TAO/USDC:USDC';
    const proxy = source({ proxy: (p) => (p === `/trade/${CLOSED_ID}` ? raw(pair) : null) });
    const r = router(`/bot/${encodeURIComponent(bot.bot_key)}?trade=${CLOSED_ID}`);
    await r.isReady();
    const w = mount(BotPage, { global: { plugins: [i18n, r], stubs }, attachTo: document.body });
    await flushPromises();

    expect(proxy).toHaveBeenCalledWith(bot.bot_key, 'GET', `/trade/${CLOSED_ID}`, undefined, {
      timeoutMs: 10_000,
    });
    // The card of the trade replaces the drawer of an open position, and no "closed" dead end
    expect(w.findComponent(ClosedTradePanel).exists()).toBe(true);
    expect(w.findComponent(TradeDrawer).exists()).toBe(false);
    expect(w.find('[data-testid="trade-closed"]').exists()).toBe(false);
    const chart = w.findComponent(CandleChart);
    expect(chart.props('pair')).toBe(pair);
    expect(chart.props('anchorEndMs')).toBe(CLOSE);
    const overlays = chart.props('overlays') as Overlays;
    expect(overlays.closed).toHaveLength(1);
    expect(overlays.closed![0]).toMatchObject({ openTs: OPEN, closeTs: CLOSE, closePrice: 11 });
    expect(overlays.openTs).toBe(OPEN);
    w.unmount();
  });

  it('a trade that is neither open nor closed in the bot is still said to be gone', async () => {
    const bot = live();
    source();
    const r = router(`/bot/${encodeURIComponent(bot.bot_key)}?trade=${CLOSED_ID}`);
    await r.isReady();
    const w = mount(BotPage, { global: { plugins: [i18n, r], stubs }, attachTo: document.body });
    await flushPromises();
    expect(w.findComponent(ClosedTradePanel).exists()).toBe(false);
    expect(w.find('[data-testid="trade-closed"]').exists()).toBe(true);
    w.unmount();
  });

  it('a row of the History tab shows its trade on the chart, with no second request', async () => {
    const bot = live();
    const pair = 'SOL/USDC:USDC';
    const row = {
      bot_key: bot.bot_key,
      trade_id: CLOSED_ID,
      pair,
      market: 'crypto',
      side: 'long',
      mode: bot.identity.mode,
      leverage: 1,
      open_ms: OPEN,
      close_ms: CLOSE,
      open_rate: 9.8,
      close_rate: 11,
      amount: 10,
      stake_amount: 98,
      profit_abs: 12,
      profit_ratio: 0.12,
      profit_unknown: false,
      exit_reason: { kind: 'roi', raw: 'roi' },
      enter_tag: null,
      manual: false,
    };
    const proxy = source({ closedRows: [row] });
    const r = router(`/bot/${encodeURIComponent(bot.bot_key)}?tab=history`);
    await r.isReady();
    const w = mount(BotPage, { global: { plugins: [i18n, r], stubs }, attachTo: document.body });
    await flushPromises();
    expect(w.findComponent(ClosedTradePanel).exists()).toBe(false);

    w.findComponent(TradeTable).vm.$emit('open', bot.bot_key, CLOSED_ID);
    await flushPromises();
    expect(w.findComponent(ClosedTradePanel).exists()).toBe(true);
    expect(w.findComponent(CandleChart).props('pair')).toBe(pair);
    expect(w.findComponent(CandleChart).props('anchorEndMs')).toBe(CLOSE);
    expect(proxy).not.toHaveBeenCalled();
    w.unmount();
  });

  it('an open position keeps the drawer and the chart of the latest candles', async () => {
    const p = fixture.positions.find((x) => !x.orphan)!;
    source();
    const r = router(`/bot/${encodeURIComponent(p.bot_key)}?trade=${p.trade_id}`);
    await r.isReady();
    const w = mount(BotPage, { global: { plugins: [i18n, r], stubs }, attachTo: document.body });
    await flushPromises();
    expect(w.findComponent(TradeDrawer).exists()).toBe(true);
    expect(w.findComponent(ClosedTradePanel).exists()).toBe(false);
    expect(w.findComponent(CandleChart).props('anchorEndMs')).toBeNull();
    // The page has its own chart: the drawer does not offer a second one
    expect(w.findComponent(TradeDrawer).props('chart')).toBe(false);
    w.unmount();
  });
});
