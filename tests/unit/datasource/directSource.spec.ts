/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures and decoded wire frames */
import { describe, expect, it } from 'vitest';

import { createMemoryAuthStore } from '@/datasource/direct/auth';
import { DirectSource } from '@/datasource/direct/DirectSource';
import type { Collections } from '@/datasource/protocol/apply';
import { applyStateUpdate } from '@/datasource/stores/apply';
import type { StateUpdate, UnavailableUpdate } from '@/datasource/types';

import { createFakeHttp, makeJwt, ok, status, tick, type FakeHandler } from './helpers';

const NOW = 1_800_000_000_000;
const TOKEN = makeJwt(NOW + 3_600_000);

const LOCAL = ['live-bot.test', 'dry-bot.test'];

function entries() {
  return [
    {
      id: 'ftbot.0',
      botName: 'hippo_live',
      apiUrl: 'http://live-bot.test:9400',
      accessToken: TOKEN,
      refreshToken: 'refresh-0',
    },
    {
      id: 'ftbot.1',
      botName: 'dry_one',
      apiUrl: 'http://dry-bot.test:9056',
      accessToken: TOKEN,
      refreshToken: 'refresh-1',
    },
  ];
}

const trade = (over: Record<string, unknown> = {}) => ({
  trade_id: 1,
  pair: 'BTC/USDC:USDC',
  is_short: false,
  is_open: true,
  amount: 0.1,
  stake_amount: 100,
  open_rate: 50_000,
  current_rate: 51_000,
  profit_abs: 10,
  profit_ratio: 0.1,
  leverage: 2,
  liquidation_price: 30_000,
  stop_loss_abs: 45_000,
  open_timestamp: NOW - 3_600_000,
  nr_of_successful_entries: 1,
  min_rate: 49_000,
  max_rate: 52_000,
  ...over,
});

const closed = (id: number, profit: number, hoursAgo: number) => ({
  trade_id: id,
  pair: 'ETH/USDC:USDC',
  is_short: false,
  is_open: false,
  amount: 1,
  stake_amount: 100,
  open_rate: 100,
  close_rate: 101,
  profit_abs: profit,
  profit_ratio: profit / 100,
  leverage: 1,
  open_timestamp: NOW - (hoursAgo + 2) * 3_600_000,
  close_timestamp: NOW - hoursAgo * 3_600_000,
  close_date: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  exit_reason: 'roi',
});

interface World {
  openTrades: Record<string, unknown[]>;
  closedTrades: Record<string, unknown[]>;
  /** Answer for POST /forcesell, per host. */
  forceSell?: (host: string) => ReturnType<FakeHandler>;
  offline?: Set<string>;
  /** Answer of GET /fleetview/profit_history (404 when absent, like an upstream bot). */
  history?: unknown;
  /** Hosts whose /show_config is not readable yet (the mode of the bot is then unknown). */
  noConfig?: Set<string>;
}

function bot(host: string, world: World): FakeHandler {
  return (req) => {
    const url = new URL(req.url);
    if (url.host !== host) return status(404);
    if (world.offline?.has(host)) return 'network';
    const path = url.pathname.replace('/api/v1', '');
    const dry = host.startsWith('dry');
    if (req.method === 'POST' && path === '/forcesell') {
      return world.forceSell
        ? world.forceSell(host)
        : ok({ result: 'Created exit order for trade 1.' });
    }
    if (req.method !== 'GET') return ok({ status: 'ok' });
    switch (path) {
      case '/show_config':
        if (world.noConfig?.has(host)) return status(404);
        return ok({
          bot_name: dry ? 'dry_one' : 'hippo_live',
          dry_run: dry,
          trading_mode: 'futures',
          stake_currency: 'USDC',
          exchange: 'hyperliquid',
          strategy: 'TestStrat',
          timeframe: '30m',
          max_open_trades: 3,
          state: 'running',
        });
      // freqtrade serves ONE trade at /trade/{id}; /trades/{id} is a 404 (B190)
      case '/trade/1':
        return ok({
          trade_id: 1,
          orders: [
            {
              ft_order_side: 'buy',
              ft_is_entry: true,
              status: 'closed',
              is_open: false,
              filled: 0.1,
              amount: 0.1,
              safe_price: 50_000,
              cost: 5000,
              order_filled_timestamp: NOW - 3_600_000,
            },
            {
              ft_order_side: 'buy',
              ft_is_entry: true,
              status: 'open',
              is_open: true,
              filled: 0,
              amount: 0.1,
              price: 47_500,
            },
            {
              ft_order_side: 'stoploss',
              ft_is_entry: false,
              status: 'open',
              is_open: true,
              amount: 0.2,
              stop_price: 40_000,
              price: 39_900,
            },
          ],
        });
      case '/status':
        return ok(world.openTrades[host] ?? []);
      case '/profit_all':
        return ok({
          all: {
            profit_closed_coin: 5,
            closed_trade_count: (world.closedTrades[host] ?? []).length,
            winning_trades: 1,
            losing_trades: 0,
            latest_trade_timestamp: NOW - 3_600_000,
            avg_duration: '1:30:00',
          },
        });
      case '/balance':
        return ok({ total: 1000, free: 900, used: 100, starting_capital: 1000, currencies: [] });
      case '/whitelist':
        return ok({ whitelist: ['BTC/USDC:USDC'] });
      case '/logs':
        return ok({ logs: [] });
      case '/fleetview/profit_history':
        return world.history ? ok(world.history) : status(404);
      case '/trades':
        return ok({
          trades: world.closedTrades[host] ?? [],
          total_trades:
            (world.closedTrades[host] ?? []).length + (world.openTrades[host] ?? []).length,
        });
      default:
        return status(404);
    }
  };
}

function makeWorld(): World {
  return {
    openTrades: { 'live-bot.test:9400': [trade()], 'dry-bot.test:9056': [] },
    closedTrades: {
      'live-bot.test:9400': [closed(10, 4, 5), closed(11, -2, 30)],
      'dry-bot.test:9056': [],
    },
  };
}

function router(world: World): FakeHandler {
  const handlers = ['live-bot.test:9400', 'dry-bot.test:9056'].map((h) => bot(h, world));
  return (req, n) => {
    const host = new URL(req.url).host;
    const h = handlers.find((_, i) => host === ['live-bot.test:9400', 'dry-bot.test:9056'][i]);
    return h ? h(req, n) : status(404);
  };
}

async function started(world: World = makeWorld(), clock = { t: NOW }) {
  const fake = createFakeHttp(router(world));
  const auth = createMemoryAuthStore(entries());
  const src = new DirectSource({
    auth,
    http: fake.http,
    now: () => clock.t,
    localHosts: LOCAL,
    maxConcurrent: 100,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  const fleet: Array<StateUpdate | UnavailableUpdate> = [];
  src.subscribe('fleet', undefined, (u) => fleet.push(u));
  await src.start();
  await src.settle();
  src.flush();
  return { src, fake, auth, fleet, clock, world };
}

/** Replay the updates the way the stores do and return the resulting `bots` collection. */
const botsOf = (fleet: Array<StateUpdate | UnavailableUpdate>): Record<string, any> => {
  const collections: Collections = { bots: {}, wallets: {} };
  for (const u of fleet) {
    if (u.kind === 'snapshot' || u.kind === 'delta')
      applyStateUpdate(collections, ['bots', 'wallets'], u);
  }
  return collections.bots as Record<string, any>;
};

describe('DirectSource polling', () => {
  it('only reads while polling: no write ever leaves during start-up', async () => {
    const { fake, src } = await started();
    expect(fake.calls.length).toBeGreaterThan(4);
    expect(fake.writes()).toEqual([]);
    src.stop();
  });

  it('publishes one entity per bot keyed by bot_key, with the mode read from the bot', async () => {
    const { src, fleet } = await started();
    const snap = fleet.find((u): u is StateUpdate => u.kind === 'snapshot')!;
    expect(snap.replace).toEqual(expect.arrayContaining(['bots', 'wallets']));
    const rows = botsOf(fleet);
    expect(Object.keys(rows).sort()).toEqual(['local:9056', 'local:9400']);
    expect(rows['local:9400'].identity.mode).toBe('live');
    expect(rows['local:9056'].identity.mode).toBe('dry');
    src.stop();
  });

  it('carries the strategy timeframe of each bot: a bot only serves candles of that one (B191)', async () => {
    const { src, fleet } = await started();
    const rows = botsOf(fleet);
    expect(rows['local:9400'].identity.timeframe).toBe('30m');
    src.stop();
  });

  it('has no local candle history: the other timeframes and the older candles need the gateway', async () => {
    const { src } = await started();
    expect(src.query.candles).toBeUndefined();
    src.stop();
  });

  it('reads the orders of a trade at /trade/{id}, the route freqtrade serves (B190)', async () => {
    const { src, fake } = await started();
    const orders = await src.query.tradeOrders!('local:9400', 1);
    expect(orders).toHaveLength(3);
    expect(orders![0]).toMatchObject({ side: 'buy', is_entry: true, average: 50_000, cost: 5000 });
    // The price of an order that waits is the bot's own: the limit, or the trigger of a stop
    expect(orders![1]).toMatchObject({ is_open: true, price: 47_500 });
    expect(orders![2]).toMatchObject({ side: 'stoploss', price: 40_000 });
    const paths = fake.calls.map((c) => new URL(c.url).pathname);
    expect(paths).toContain('/api/v1/trade/1');
    expect(paths).not.toContain('/api/v1/trades/1');
    src.stop();
  });

  it('serves positions with the liquidation distance and no invented percentile', async () => {
    const { src } = await started();
    const page = await src.query.trades({ status: 'open', mode: ['live'] });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.bot_key).toBe('local:9400');
    const seen: any[] = [];
    src.subscribe('positions', undefined, (u) => seen.push(u));
    const pos = Object.values((seen[0] as StateUpdate).upsert.positions as any)[0] as any;
    expect(pos.percentile).toBeNull();
    expect(pos.liq_distance_pct).toBeCloseTo(((51_000 - 30_000) / 51_000) * 100, 6);
    src.stop();
  });

  it('answers the channels it cannot serve with `unavailable`, never an empty success', async () => {
    const { src } = await started();
    const got: any[] = [];
    src.subscribe('recon', undefined, (u) => got.push(u));
    src.subscribe('chart', { botKey: 'local:9400', pair: 'BTC/USDC:USDC', timeframe: '15m' }, (u) =>
      got.push(u),
    );
    expect(got.map((u) => u.kind)).toEqual(['unavailable', 'unavailable']);
    src.stop();
  });

  it('loads closed trades once and marks the totals complete when everything is loaded', async () => {
    const { src, fake } = await started();
    const page = await src.query.trades({ status: 'closed', mode: ['live'] });
    expect(page.items.map((r) => r.trade_id)).toEqual([10, 11]);
    expect(page.complete).toBe(true);
    expect(page.totals.sum).toBeCloseTo(2, 9);
    const before = fake.calls.length;
    await src.query.trades({ status: 'closed', mode: ['live'] });
    expect(fake.calls.length).toBe(before);
    src.stop();
  });

  it('computes realized periods from the loaded history', async () => {
    const { src } = await started();
    const rows = await src.query.periods({
      unit: 'day',
      scope: { kind: 'fleet' },
      tz: 'UTC',
      n: 3,
    });
    const total = rows.reduce((a, r) => a + r.profit_abs, 0);
    expect(total).toBeCloseTo(2, 9);
    src.stop();
  });

  it('cuts the day figure at the Paris midnight, not 24 hours back', async () => {
    // NOW is 09:00 in Paris: closed 5 h ago is today, closed 12 h ago (21:00) and 30 h ago are not
    const world = makeWorld();
    world.closedTrades['live-bot.test:9400'] = [
      closed(10, 4, 5),
      closed(12, -1.5, 12),
      closed(11, -2, 30),
    ];
    const { src, fleet } = await started(world);
    await src.query.trades({ status: 'closed', mode: ['live'] });
    for (let i = 0; i < 3; i++) {
      src.flush();
      await src.settle();
    }
    const m = botsOf(fleet)['local:9400'].metrics;
    expect(m.realized_1d).toBeCloseTo(4, 9);
    expect(m.realized_7d).toBeCloseTo(0.5, 9);
    src.stop();
  });

  it('draws no with-open equity curve without the sampled ledgers', async () => {
    const { src } = await started();
    const eq = await src.query.equity({ scope: { kind: 'fleet' }, mode: 'with_open' });
    expect(eq.points).toEqual([]);
    expect(eq.unavailable).toBe('no_history');
    src.stop();
  });

  it('draws the with-open curve from the sampled ledgers when every bot has one', async () => {
    const world = makeWorld();
    world.history = {
      bots: [
        {
          bot_name: 'hippo_live',
          data: [
            [NOW - 3 * 3_600_000, 0, 0, 0],
            [NOW - 2 * 3_600_000, 5, 3, 1],
            [NOW - 1 * 3_600_000, 5, -2, 1],
          ],
        },
      ],
    };
    const { src, fake } = await started(world);
    const eq = await src.query.equity({ scope: { kind: 'fleet' }, mode: 'with_open' });
    expect(eq.unavailable).toBeNull();
    expect(eq.points.map((p) => p[1])).toEqual([0, 8, 3]);
    // The ledger is read once (cached), and only with GET.
    await src.query.drawdown({ scope: { kind: 'fleet' }, def: 'with_open' } as any);
    expect(fake.where((c) => c.url.endsWith('/fleetview/profit_history'))).toHaveLength(1);
    expect(fake.writes()).toEqual([]);
    src.stop();
  });

  it('draws nothing when a bot of the scope has no ledger (no silent under-count)', async () => {
    const world = makeWorld();
    world.history = { bots: [{ bot_name: 'someone_else', data: [[NOW, 0, 0, 0]] }] };
    const { src } = await started(world);
    const eq = await src.query.equity({ scope: { kind: 'fleet' }, mode: 'with_open' });
    expect(eq.points).toEqual([]);
    expect(eq.unavailable).toBe('no_history');
    src.stop();
  });

  it('keeps going when one bot is unreachable and reports it offline after repeated failures', async () => {
    const world = makeWorld();
    world.offline = new Set(['dry-bot.test:9056']);
    const { src, fleet } = await started(world);
    for (let i = 0; i < 4; i++) {
      src.flush();
      await src.settle();
    }
    const rows = botsOf(fleet);
    expect(rows['local:9400'].state.status).toBe('online');
    expect(rows['local:9056'].metrics.realized_total).toBeNull();
    src.stop();
  });
});

describe('DirectSource: positions whose prices are blocked (bug B250)', () => {
  it('a bot whose positions have no profit has an unknown latent profit, never a 0 or a partial sum', async () => {
    const world = makeWorld();
    const LIVE = Object.keys(world.openTrades).find((k) => k !== 'dry-bot.test:9056')!;
    // The exchange ticker is blocked by the 429 backoff: the bot answers profit_abs: null
    world.openTrades[LIVE] = [
      trade({ trade_id: 1, profit_abs: null as never }),
      trade({ trade_id: 2, profit_abs: 5 }),
    ];
    const { src, fleet } = await started(world);
    const row = botsOf(fleet)['local:9400'];
    expect(row.state.open_trades).toBe(2);
    expect(row.metrics.open_profit_abs).toBeNull();
    src.stop();
  });
});

describe('DirectSource: a bot whose mode is not read yet', () => {
  const DRY = 'dry-bot.test:9056';

  it('is starting, in no total and no table, until its config is read (B158)', async () => {
    const world = makeWorld();
    // The dry bot holds a position and a profit: they must not land in the Live figures
    world.openTrades[DRY] = [trade({ trade_id: 7, profit_abs: 99 })];
    world.noConfig = new Set([DRY]);
    const { src, fleet } = await started(world);
    let rows = botsOf(fleet);
    // Answering, but not online: the mode (live confirmation level) is not known
    expect(rows['local:9056'].state.status).toBe('starting');
    expect(rows['local:9056'].metrics.open_profit_abs).toBeNull();
    expect(rows['local:9056'].metrics.realized_total).toBeNull();
    // The strict assumption holds for what is confirmed
    expect(rows['local:9056'].identity.mode).toBe('live');
    expect(rows['local:9400'].state.status).toBe('online');

    // Positions and fleet totals only carry the bot that is known to be live
    const seen: any[] = [];
    src.subscribe('positions', undefined, (u) => seen.push(u));
    const keys = Object.keys((seen[0] as StateUpdate).upsert.positions as any);
    expect(keys.every((k) => k.startsWith('local:9400/'))).toBe(true);
    const detail = await src.query.scope({ kind: 'fleet' });
    // The bot is listed (starting) and named among the excluded; its position is in no exposure
    expect(detail.bots.map((b) => b.bot_key).sort()).toEqual(['local:9056', 'local:9400']);
    expect(detail.positions.map((p) => p.bot_key)).toEqual(['local:9400']);
    const live = detail.totals.find((t) => t.mode === 'live')!;
    expect(live.excluded).toContain('local:9056');
    expect(live.open_profit_abs).toBeCloseTo(10, 6);
    const page = await src.query.trades({ status: 'open', mode: ['live'] });
    expect(page.items.map((r) => r.bot_key)).toEqual(['local:9400']);

    // Once the config is read the bot is dry, online, and in the dry figures only
    world.noConfig = new Set();
    (src as any).due((src as any).rts.get('local:9056'), 'slow');
    (src as any).dispatchDue();
    await src.settle();
    src.flush();
    rows = botsOf(fleet);
    expect(rows['local:9056'].identity.mode).toBe('dry');
    expect(rows['local:9056'].state.status).toBe('online');
    const dry = await src.query.trades({ status: 'open', mode: ['dry'] });
    expect(dry.items.map((r) => r.bot_key)).toEqual(['local:9056']);
    src.stop();
  });
});

describe('DirectSource actions (real money rules, against fakes only)', () => {
  const exit = (over: Record<string, unknown> = {}) =>
    ({
      kind: 'forceexit',
      tradeId: 1,
      expected: { pair: 'BTC/USDC:USDC', isShort: false },
      ...over,
    }) as any;

  it('sends one POST for a confirmed exit and reports `accepted`, not "closed"', async () => {
    const { src, fake } = await started();
    const r = await src.act('local:9400', exit(), 'key-1');
    expect(r.status).toBe('accepted');
    expect(r.verify?.expectedState).toBe('trade_closing');
    const writes = fake.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.url).toContain('live-bot.test:9400');
    expect(writes[0]!.url).toContain('/forcesell');
    expect(writes[0]!.body).toEqual({ tradeid: '1' });
    src.stop();
  });

  it('returns the first result for a repeated idempotency key without sending again', async () => {
    const { src, fake } = await started();
    const a = await src.act('local:9400', exit(), 'key-dup');
    const b = await src.act('local:9400', exit(), 'key-dup');
    expect(b).toEqual(a);
    expect(fake.writes()).toHaveLength(1);
    src.stop();
  });

  it('refuses an identical action while the first is still in flight', async () => {
    const world = makeWorld();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    world.forceSell = () => gate.then(() => ok({ result: 'ok' }));
    const { src, fake } = await started(world);
    const first = src.act('local:9400', exit(), 'k-a');
    await tick();
    const second = await src.act('local:9400', exit(), 'k-b');
    expect(second.status).toBe('in_progress');
    release();
    expect((await first).status).toBe('accepted');
    expect(fake.writes()).toHaveLength(1);
    src.stop();
  });

  it('sends nothing when the trade changed since it was displayed (state_mismatch)', async () => {
    const { src, fake } = await started();
    const r = await src.act(
      'local:9400',
      exit({ expected: { pair: 'ETH/USDC:USDC', isShort: false } }),
      'k-m',
    );
    expect(r.status).toBe('state_mismatch');
    expect(fake.writes()).toEqual([]);
    const gone = await src.act('local:9400', exit({ tradeId: 99 }), 'k-gone');
    expect(gone.status).toBe('state_mismatch');
    expect(fake.writes()).toEqual([]);
    src.stop();
  });

  it('refuses an exit that does not carry the state the user saw', async () => {
    const { src, fake } = await started();
    const r = await src.act('local:9400', { kind: 'forceexit', tradeId: 1 }, 'k-ns');
    expect(r.status).toBe('rejected');
    expect(fake.writes()).toEqual([]);
    src.stop();
  });

  it('treats a timeout as `unknown` and never replays the write', async () => {
    const world = makeWorld();
    world.forceSell = () => 'timeout';
    const { src, fake } = await started(world);
    const r = await src.act('local:9400', exit(), 'k-to');
    expect(r.status).toBe('unknown');
    expect(r.verify).not.toBeNull();
    expect(fake.writes()).toHaveLength(1);
    // The same intent again (same key) does not send either.
    expect((await src.act('local:9400', exit(), 'k-to')).status).toBe('unknown');
    expect(fake.writes()).toHaveLength(1);
    src.stop();
  });

  it('does not replay after a 401 on a write (legacy bug B4) and says nothing was executed', async () => {
    const world = makeWorld();
    world.forceSell = () => status(401);
    const { src, fake } = await started(world);
    const r = await src.act('local:9400', exit(), 'k-401');
    expect(r.status).toBe('unauthorized');
    expect(r.error).toBe('unauthorized');
    expect(fake.writes()).toHaveLength(1);
    expect(fake.where((c) => c.url.endsWith('/token/refresh'))).toHaveLength(0);
    src.stop();
  });

  it('maps a refusal of the bot to `rejected` with its reason', async () => {
    const world = makeWorld();
    world.forceSell = () => status(400, { detail: 'confirm_trade_exit refused' });
    const { src } = await started(world);
    const r = await src.act('local:9400', exit(), 'k-rej');
    expect(r.status).toBe('rejected');
    expect(r.botResponse).toContain('confirm_trade_exit');
    src.stop();
  });

  it('requires the typed bot name for a destructive live action, before any request', async () => {
    const { src, fake } = await started();
    const all = { kind: 'forceexit', tradeId: 'all' } as const;
    expect((await src.act('local:9400', { ...all }, 'k-n1')).status).toBe('rejected');
    expect((await src.act('local:9400', { ...all, confirm: 'wrong' }, 'k-n2')).status).toBe(
      'rejected',
    );
    expect((await src.act('local:9400', { kind: 'stop' }, 'k-n3')).status).toBe('rejected');
    expect(fake.writes()).toEqual([]);
    const okAll = await src.act('local:9400', { ...all, confirm: 'hippo_live' }, 'k-n4');
    expect(okAll.status).toBe('accepted');
    expect(fake.writes()).toHaveLength(1);
    // "Exit all" is a SINGLE request, not one per position.
    expect(fake.writes()[0]!.body).toEqual({ tradeid: 'all' });
    src.stop();
  });

  it('does not ask for the name on a dry bot', async () => {
    const { src, fake } = await started();
    const r = await src.act('local:9056', { kind: 'stop' }, 'k-dry');
    expect(r.status).toBe('accepted');
    expect(fake.writes()).toHaveLength(1);
    expect(fake.writes()[0]!.url).toContain('dry-bot.test:9056');
    src.stop();
  });

  it('never sends to a bot it cannot reach', async () => {
    const world = makeWorld();
    world.offline = new Set(['live-bot.test:9400']);
    const { src, fake } = await started(world);
    for (let i = 0; i < 4; i++) {
      src.flush();
      await src.settle();
    }
    const r = await src.act('local:9400', { kind: 'stopbuy' }, 'k-off');
    expect(['rejected', 'unauthorized']).toContain(r.status);
    expect(fake.writes()).toEqual([]);
    src.stop();
  });

  it('refuses an unknown bot', async () => {
    const { src, fake } = await started();
    const r = await src.act('local:1', { kind: 'stopbuy' }, 'k-unk');
    expect(r.status).toBe('rejected');
    expect(r.error).toBe('not_found');
    expect(fake.writes()).toEqual([]);
    src.stop();
  });

  it('records the action in the local event feed', async () => {
    const { src } = await started();
    const items: any[] = [];
    src.subscribe('events', undefined, (u) => {
      if (u.kind === 'item') items.push(u.item);
    });
    await src.act('local:9056', { kind: 'stopbuy' }, 'k-ev');
    expect(items.some((e) => e.kind === 'action' && e.bot_key === 'local:9056')).toBe(true);
    src.stop();
  });
});

describe('DirectSource alerts', () => {
  it('keeps acknowledgements local and says they are not shared', async () => {
    const { src } = await started();
    expect(src.alerts.shared).toBe(false);
    const until = NOW + 3_600_000;
    const s = await src.alerts.silence({ typeId: 'positionLoss', untilMs: until });
    expect(s.until_ms).toBe(until);
    expect(await src.alerts.silences()).toHaveLength(1);
    await src.alerts.unsilence(s.id);
    expect(await src.alerts.silences()).toHaveLength(0);
    src.stop();
  });
});

describe('DirectSource day figure (B177)', () => {
  // The background read spaces the bots out by a few seconds of the client clock.
  const settleCycles = async (src: DirectSource, clock: { t: number }, n = 12) => {
    for (let i = 0; i < n; i++) {
      clock.t += 4_000;
      (src as any).tick();
      await src.settle();
      src.flush();
    }
  };

  it('reads the closed history of every bot without any page asking, dry bots included', async () => {
    const world = makeWorld();
    world.closedTrades['dry-bot.test:9056'] = [closed(20, 2, 3)];
    const clock = { t: NOW };
    const { src, fleet } = await started(world, clock);
    // No query.* call: nothing a page does loads the history.
    await settleCycles(src, clock);
    const b = botsOf(fleet);
    expect(b['local:9400'].metrics.realized_1d).toBe(4);
    expect(b['local:9056'].metrics.realized_1d).toBe(2);
    src.stop();
  });

  it('counts a trade closed after the history was read on the next cycle', async () => {
    const world = makeWorld();
    const clock = { t: NOW };
    const { src, fleet } = await started(world, clock);
    await settleCycles(src, clock);
    expect(botsOf(fleet)['local:9400'].metrics.realized_1d).toBe(4);

    // Five minutes later (inside the 10 min cache) the open trade closed at +7.
    clock.t += 5 * 60_000;
    world.openTrades['live-bot.test:9400'] = [];
    world.closedTrades['live-bot.test:9400'].push({
      ...closed(1, 7, 0),
      close_timestamp: clock.t - 60_000,
      close_date: new Date(clock.t - 60_000).toISOString(),
    });
    await settleCycles(src, clock);
    expect(botsOf(fleet)['local:9400'].metrics.realized_1d).toBe(11);
    src.stop();
  });

  it('does not read the history again while the closed count is unchanged', async () => {
    const world = makeWorld();
    const clock = { t: NOW };
    const { src, fake } = await started(world, clock);
    await settleCycles(src, clock);
    const trades = () => fake.calls.filter((c) => c.url.includes('/trades')).length;
    const before = trades();
    expect(before).toBeGreaterThan(0);
    clock.t += 5 * 60_000;
    await settleCycles(src, clock);
    expect(trades()).toBe(before);
    src.stop();
  });
});
