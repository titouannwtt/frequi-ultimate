import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

import TradeDrawer from '../../../src/components/fq/TradeDrawer.vue';
import TradeTable from '../../../src/components/fq/TradeTable.vue';
import { useFqFleetStore } from '../../../src/datasource/stores/fleet';
import { useFqPositionsStore } from '../../../src/datasource/stores/positions';
import type { OrderRow } from '../../../src/datasource/types';
import { mountFq, setFqLocale, setupWorld, teardownWorld, type FqWorld } from './helpers';

// The drawer reads its orders through the active data source: give it one that counts the reads
const hoisted = vi.hoisted(() => ({ holder: { source: null as unknown } }));
vi.mock('../../../src/composables/useDataSource', async () => {
  const { computed } = await import('vue');
  return {
    useDataSource: () => ({
      source: computed(() => hoisted.holder.source),
    }),
  };
});

const ORDERS: OrderRow[] = [
  {
    id: 0,
    side: 'buy',
    is_entry: true,
    status: 'closed',
    is_open: false,
    filled: 1,
    amount: 1,
    average: 10,
    cost: 100,
    filled_ms: 1_000,
    tag: null,
  },
  {
    id: 1,
    side: 'buy',
    is_entry: true,
    status: 'closed',
    is_open: false,
    filled: 1,
    amount: 1,
    average: 9,
    cost: 90,
    filled_ms: 2_000,
    tag: null,
  },
];

let world: FqWorld;
beforeEach(() => {
  world = setupWorld();
});
afterEach(() => {
  teardownWorld();
  hoisted.holder.source = null;
});

function sourceWith(tradeOrders: (k: string, id: number) => Promise<OrderRow[] | null>) {
  const spy = vi.fn(tradeOrders);
  hoisted.holder.source = { query: { tradeOrders: spy }, registry: { botKeyOf: () => null } };
  return spy;
}

describe('TradeDrawer opened from the fleet table (B194)', () => {
  const target = () => world.fixture.positions.find((p) => !p.orphan)!;

  it('reads the orders of its own trade when the page gives none, and draws the ladder', async () => {
    const spy = sourceWith(async () => ORDERS);
    const p = target();
    const w = mountFq(TradeDrawer, {
      props: { botKey: p.bot_key, tradeId: p.trade_id, docked: true },
      attachTo: document.body,
    });
    await flushPromises();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(p.bot_key, p.trade_id);
    expect(w.text()).not.toContain('not available');
    expect(w.text()).toContain('SO1');
  });

  it('one request serves the drawer and the page that asks for the same trade', async () => {
    const spy = sourceWith(async () => ORDERS);
    const p = target();
    const props = { botKey: p.bot_key, tradeId: p.trade_id, docked: true };
    mountFq(TradeDrawer, { props, attachTo: document.body });
    mountFq(TradeDrawer, { props, attachTo: document.body });
    await flushPromises();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('says the orders are not available, in the singular for one entry, when the source cannot read them', async () => {
    sourceWith(async () => null);
    const p = { ...target(), dca_entries: 1 };
    useFqPositionsStore().apply({
      kind: 'delta',
      seq: 9,
      ts: 0,
      replace: [],
      upsert: { positions: { [`${p.bot_key}/${p.trade_id}`]: p } as never },
      remove: {},
    });
    const w = mountFq(TradeDrawer, {
      props: { botKey: p.bot_key, tradeId: p.trade_id, docked: true },
      attachTo: document.body,
    });
    await flushPromises();
    expect(w.text()).toContain('1 of 1 entry filled. The orders are not available.');
  });
});

describe('TradeDrawer: the bot name (B199)', () => {
  it('wraps a long name after _ or -, never in the middle of a word, and keeps it in the title', async () => {
    sourceWith(async () => ORDERS);
    const p = world.fixture.positions.find((q) => !q.orphan)!;
    const long = 'hyperliquid_hippo_dynv1_short_sharpe-v2';
    const { useFqFleetStore: fleetStore } = await import('../../../src/datasource/stores/fleet');
    fleetStore().bots[p.bot_key]!.identity.name = long;
    const w = mountFq(TradeDrawer, {
      props: { botKey: p.bot_key, tradeId: p.trade_id, docked: true },
      attachTo: document.body,
    });
    await flushPromises();
    const nm = w.find('.nm');
    expect(nm.attributes('title')).toBe(long);
    expect(nm.text()).toBe(long);
    expect(nm.findAll('wbr').length).toBeGreaterThanOrEqual(4);
  });
});

describe('positions announced and not read yet (direct mode first render)', () => {
  function awaitingWorld(status: 'online' | 'starting' = 'online') {
    const fleet = useFqFleetStore();
    const bot = world.fixture.bots.find((b) => b.state.status === 'online')!;
    // The bot says 3 open trades; none has been read from it yet
    const row = reactive({ ...bot, state: { ...bot.state, status, open_trades: 3 } });
    fleet.$patch({});
    useFqPositionsStore().apply({
      kind: 'snapshot',
      seq: 1,
      ts: 0,
      replace: ['positions'],
      upsert: {},
      remove: {},
    });
    fleet.apply({
      kind: 'delta',
      seq: 5,
      ts: 0,
      replace: [],
      upsert: { bots: { [bot.bot_key]: row } as never },
      remove: {},
    });
    return bot;
  }

  it('does not say "no open position" for a bot that announces some (B198)', async () => {
    const bot = awaitingWorld();
    const w = mountFq(TradeTable, {
      props: { preset: 'bot', botKey: bot.bot_key },
      attachTo: document.body,
    });
    await flushPromises();
    expect(w.text()).toContain('3 positions announced, not read yet');
    expect(w.text()).not.toContain('No open position');
  });

  it('a bot that is still starting counts too: its announced positions are not "none"', async () => {
    const bot = awaitingWorld('starting');
    const w = mountFq(TradeTable, {
      props: { preset: 'bot', botKey: bot.bot_key },
      attachTo: document.body,
    });
    await flushPromises();
    expect(w.text()).toContain('3 positions announced, not read yet');
  });

  it('a partial table says how many positions are still to come', async () => {
    const bot = awaitingWorld();
    const store = useFqPositionsStore();
    const first = world.fixture.positions.find((p) => p.bot_key === bot.bot_key);
    const one = { ...(first ?? world.fixture.positions[0]!), bot_key: bot.bot_key, trade_id: 99 };
    store.apply({
      kind: 'delta',
      seq: 2,
      ts: 0,
      replace: [],
      upsert: { positions: { [`${bot.bot_key}/99`]: one } as never },
      remove: {},
    });
    const w = mountFq(TradeTable, {
      props: { preset: 'bot', botKey: bot.bot_key },
      attachTo: document.body,
    });
    await flushPromises();
    expect(w.find('[data-testid=positions-awaiting]').text()).toContain(
      '2 more positions announced, not read yet',
    );
  });

  it('is silent when every announced position was read', async () => {
    const bot = world.fixture.bots.find((b) => b.state.status === 'online')!;
    const w = mountFq(TradeTable, {
      props: { preset: 'bot', botKey: bot.bot_key },
      attachTo: document.body,
    });
    await flushPromises();
    expect(w.find('[data-testid=positions-awaiting]').exists()).toBe(false);
    setFqLocale('fr');
    await flushPromises();
  });
});
