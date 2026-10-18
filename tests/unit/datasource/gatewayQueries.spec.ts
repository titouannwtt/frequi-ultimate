import { describe, expect, it, vi } from 'vitest';

import { GatewaySource, toGatewayActions } from '@/datasource/gateway/GatewaySource';
import { createGatewayHttp } from '@/datasource/gateway/http';
import type { SessionManager } from '@/datasource/gateway/session';
import { GATEWAY_PROTOCOL_VERSION } from '@/gateway/types.gen';

import { createFakeHttp, fakeWsFactory, ManualTimers, ok, status } from './helpers';

/** The real shapes of the gateway (fg-server routes/data.rs, alerts.rs), not the ones we hoped for. */
const row = (key: string, mode: 'live' | 'dry', extra: Record<string, unknown> = {}) => ({
  bot_key: key,
  identity: { name: key, mode },
  freshness: { metrics: { stale: false }, positions: { stale: false } },
  metrics: {
    realized_1d: 1,
    realized_7d: 2,
    realized_30d: 3,
    realized_total: 4,
    open_profit_abs: -1,
    starting_capital: { value: 100, source: 'config' },
  },
  state: { open_trades: 1, max_open_trades: 2, wallet_id: mode === 'live' ? 'w1' : null },
  ...extra,
});
const pos = (
  key: string,
  tradeId: number,
  coin: string,
  side: 'long' | 'short',
  notional: number,
) => ({
  bot_key: key,
  trade_id: tradeId,
  coin,
  pair: `${coin}/USDC:USDC`,
  side,
  notional,
  orphan: false,
  open_ms: 1,
  open_rate: 1,
  amount: 1,
  stake_amount: notional / 2,
  leverage: 2,
  profit_abs: -1,
  profit_ratio: -0.01,
  market: 'crypto',
  freshness: { stale: false },
});
const dd = { realized: { abs: 1 }, with_open: { abs: 9, pct: 0.09 }, has_open: true, base: 100 };
const gwTotals = (mode: string, extra: Record<string, unknown> = {}) => ({
  scope: mode,
  mode,
  bots: 2,
  bots_online: 2,
  open_trades: 2,
  max_open_trades: 4,
  realized_today: 0,
  realized_1d: 10,
  realized_7d: 20,
  realized_30d: 30,
  realized_total: 40,
  open_profit_abs: -5,
  starting_capital: 200,
  capital_unknown_bots: 1,
  wallet_equity: 235,
  wallets: 1,
  exposure_long: 300,
  exposure_short: 100,
  exposure_net: 200,
  drawdown_realized: null,
  drawdown_with_open: null,
  excluded_bots: ['local:2'],
  alerts: { count: 0, max_severity: null },
  freshness: { stale: false },
  ...extra,
});

const NOW = 1_800_000_000_000;

function setup(
  routes: Record<string, (req: { params?: Record<string, unknown>; body?: unknown }) => unknown>,
) {
  const fake = createFakeHttp((req) => {
    const path = new URL(req.url).pathname.replace('/gw/v1', '');
    if (path === '/hello')
      return ok({ version: 't', protocol: GATEWAY_PROTOCOL_VERSION, auth_modes: ['session'] });
    const h = routes[`${req.method} ${path}`];
    return h ? ok(h(req)) : status(404);
  });
  const session = {
    ensure: vi.fn(async () => 's'),
    token: vi.fn(() => 's'),
    invalidate: vi.fn(),
    renew: vi.fn(async () => 's2'),
  } satisfies SessionManager;
  const src = new GatewaySource({
    http: createGatewayHttp({
      http: fake.http,
      baseUrl: () => 'https://gw.test:9399',
      session: () => 's',
    }),
    session,
    baseUrl: () => 'https://gw.test:9399',
    deviceId: () => 'd-test',
    wsFactory: fakeWsFactory(),
    aliases: () => ({ 'ftbot.0': 'local:1' }),
    getGroups: () => [{ id: 'g', botKeys: ['local:1', 'local:2'] }],
    now: () => NOW,
    timers: new ManualTimers(),
    jitter: false,
  });
  return { src, fake };
}

const scopeRoutes = {
  'GET /scope/fleet': () => ({ kind: 'fleet', totals: [gwTotals('live'), gwTotals('dry')] }),
  'GET /scope/live': () => ({
    kind: 'mode',
    totals: gwTotals('live'),
    bots: [row('local:1', 'live'), row('local:2', 'live')],
    positions: [pos('local:1', 1, 'BTC', 'long', 300), pos('local:2', 2, 'BTC', 'short', 100)],
    drawdown: dd,
    generated_ms: NOW - 1000,
  }),
  'GET /scope/dry': () => ({
    kind: 'mode',
    totals: gwTotals('dry', { excluded_bots: [], capital_unknown_bots: 0 }),
    bots: [row('local:9', 'dry')],
    positions: [],
    drawdown: null,
    generated_ms: NOW,
  }),
};

describe('GatewaySource.query.scope', () => {
  it('builds the fleet from one request per mode and never adds the modes', async () => {
    const h = setup(scopeRoutes);
    const d = await h.src.query.scope({ kind: 'fleet' });
    expect(d.totals.map((t) => t.mode)).toEqual(['live', 'dry']);
    const live = d.totals[0]!;
    expect(live).toMatchObject({
      bots: 2,
      realized_1d: 10,
      open_profit_abs: -5,
      starting_capital: { total: 200, known: 1, unknown: 1 },
      excluded: ['local:2'],
    });
    // Gateway gross figures kept; netting per coin at wallet level is computed from the positions
    // of the bots whose figures are in the sums (local:2 is excluded: only the long remains).
    expect(live.exposure).toMatchObject({ long: 300, short: 100, net: 200, gross_netted: 300 });
    expect(live.drawdown?.with_open.abs).toBe(9);
    expect(d.bots).toHaveLength(3);
    // Two modes: no drawdown of "the fleet".
    expect(d.drawdown).toBeNull();
    expect(d.asOfMs).toBe(NOW);
  });

  it('computes a group from the fleet rows and leaves out the bots outside it', async () => {
    const h = setup(scopeRoutes);
    const d = await h.src.query.scope({ kind: 'group', id: 'g' });
    expect(d.bots.map((b) => b.bot_key)).toEqual(['local:1', 'local:2']);
    expect(d.totals).toHaveLength(1);
    expect(d.totals[0]).toMatchObject({ mode: 'live', bots: 2, realized_1d: 2, open_trades: 2 });
    // The group's drawdown is asked with `bots=`; the gateway refuses mixed modes (not the case here).
    expect(h.fake.where((r) => r.url.includes('/drawdown'))[0]!.params).toEqual({
      bots: 'local:1,local:2',
    });
  });

  it('asks a bot with `bot:<key>` and totals it from its row', async () => {
    const h = setup({
      'GET /scope/bot:local%3A1': () => ({
        kind: 'bot',
        totals: null,
        bots: [row('local:1', 'live')],
        positions: [pos('local:1', 1, 'BTC', 'long', 300)],
        drawdown: dd,
        generated_ms: NOW,
      }),
    });
    const d = await h.src.query.scope({ kind: 'bot', botKey: 'local:1' });
    expect(d.totals[0]).toMatchObject({ mode: 'live', bots: 1, realized_30d: 3 });
    expect(d.drawdown?.base).toBe(100);
  });
});

describe('GatewaySource curves, journal, logs, events, registry', () => {
  it('asks a mode, never "fleet", and maps the buckets of /pnl/periods', async () => {
    const h = setup({
      'GET /pnl/periods': () => ({ tz: 'Europe/Paris', unit: 'day', buckets: [{ label: 'x' }] }),
    });
    const r = await h.src.query.periods({
      unit: 'day',
      scope: { kind: 'fleet' },
      tz: 'Europe/Paris',
      n: 7,
      tradingMode: 'dry',
    });
    expect(r).toEqual([{ label: 'x' }]);
    expect(h.fake.calls[0]!.params).toEqual({
      unit: 'day',
      n: 7,
      scope: 'dry',
      tz: 'Europe/Paris',
    });
  });

  it('takes the gateway time zone when it refuses another one', async () => {
    let n = 0;
    const fake = createFakeHttp((req) => {
      const path = new URL(req.url).pathname.replace('/gw/v1', '');
      if (path !== '/pnl/periods') return status(404);
      return ++n === 1
        ? status(400, { code: 'bad_request', message: 'this gateway cuts periods in Europe/Paris' })
        : ok({ tz: 'Europe/Paris', buckets: [] });
    });
    const src = new GatewaySource({
      http: createGatewayHttp({
        http: fake.http,
        baseUrl: () => 'https://gw.test:9399',
        session: () => 's',
      }),
      session: {
        ensure: async () => 's',
        token: () => 's',
        invalidate() {},
        renew: async () => 's',
      },
      baseUrl: () => 'https://gw.test:9399',
      deviceId: () => 'd',
      wsFactory: fakeWsFactory(),
      aliases: () => ({}),
      timers: new ManualTimers(),
    });
    const r = await src.query.periods({
      unit: 'day',
      scope: { kind: 'bot', botKey: 'local:1' },
      tz: 'UTC',
      n: 3,
    });
    expect(r).toEqual([]);
    expect(fake.calls[0]!.params).toMatchObject({ tz: 'UTC', scope: 'bot:local:1' });
    expect(fake.calls[1]!.params).not.toHaveProperty('tz');
  });

  it('turns the {ts_ms, value} points of the equity into tuples', async () => {
    const h = setup({
      'GET /equity': () => ({
        points: [
          { ts_ms: 1, value: 2 },
          { ts_ms: 3, value: 4 },
        ],
      }),
    });
    const r = await h.src.query.equity({ scope: { kind: 'fleet' }, mode: 'with_open', points: 50 });
    expect(r.points).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(h.fake.calls[0]!.params).toMatchObject({ scope: 'live', mode: 'with_open', points: 50 });
  });

  it('reads the local candle history at /candles with the pair, the timeframe, the end and the limit', async () => {
    const h = setup({
      'GET /candles': () => ({
        pair: 'BTC/USDC:USDC',
        tf: '1h',
        candles: [
          [1000, 1, 2, 0.5, 1.5, 10],
          [2000, 1.5, 2.5, 1, 2, 12],
        ],
        has_more: true,
        first_available_ms: 500,
        resampled_from: '5m',
      }),
    });
    const r = await h.src.query.candles!({
      pair: 'BTC/USDC:USDC',
      timeframe: '1h',
      endMs: 3000,
      limit: 2,
    });
    expect(h.fake.calls[0]!.params).toEqual({
      pair: 'BTC/USDC:USDC',
      tf: '1h',
      end: 3000,
      limit: 2,
    });
    expect(r).toEqual({
      pair: 'BTC/USDC:USDC',
      timeframe: '1h',
      candles: [
        [1000, 1, 2, 0.5, 1.5, 10],
        [2000, 1.5, 2.5, 1, 2, 12],
      ],
      hasMore: true,
      firstAvailableMs: 500,
      resampledFrom: '5m',
    });
  });

  it('asks the latest candles without an end, and reads empty data as no candle and no more', async () => {
    const h = setup({
      'GET /candles': () => ({
        pair: 'X/USDC:USDC',
        tf: '15m',
        candles: [],
        has_more: false,
        first_available_ms: null,
        resampled_from: null,
      }),
    });
    const r = await h.src.query.candles!({ pair: 'X/USDC:USDC', timeframe: '15m' });
    expect(h.fake.calls[0]!.params).toEqual({ pair: 'X/USDC:USDC', tf: '15m' });
    expect(r).toMatchObject({
      candles: [],
      hasMore: false,
      firstAvailableMs: null,
      resampledFrom: null,
    });
  });

  it('asks a group of its bots and answers nothing for an empty one', async () => {
    const h = setup({ 'GET /equity': () => ({ points: [] }) });
    await h.src.query.equity({ scope: { kind: 'group', id: 'g' }, mode: 'realized' });
    expect(h.fake.calls[0]!.params).toMatchObject({ bots: 'local:1,local:2' });
    const none = await h.src.query.equity({
      scope: { kind: 'group', id: 'missing' },
      mode: 'realized',
    });
    expect(none.points).toEqual([]);
    expect(h.fake.calls).toHaveLength(1);
  });

  it('reads closed trades from `rows`, with the gateway sort names, and keeps the totals', async () => {
    const h = setup({
      'GET /trades': () => ({
        rows: [{ pair: 'B' }, { pair: 'A' }],
        next_cursor: 'c2',
        matched: 9,
        totals: { count: 9 },
      }),
    });
    const r = await h.src.query.trades({
      status: 'closed',
      sort: 'profit_abs',
      mode: ['live'],
      limit: 2,
    });
    expect(r).toMatchObject({ nextCursor: 'c2', totals: { count: 9 }, complete: true });
    expect(h.fake.calls[0]!.params).toMatchObject({
      status: 'closed',
      sort: 'profit',
      mode: 'live',
      limit: 2,
    });
    // The gateway cannot sort by pair: the loaded rows are sorted here and the params carry no sort.
    const byPair = await h.src.query.trades({ status: 'closed', sort: 'pair', order: 'asc' });
    expect(byPair.items.map((x) => x.pair)).toEqual(['A', 'B']);
    expect(h.fake.calls[1]!.params).not.toHaveProperty('sort');
  });

  it('reads the open trades from `open` and shows them as rows', async () => {
    const h = setup({
      'GET /trades': () => ({ open: [pos('local:1', 5, 'ETH', 'short', 50)], matched: 1 }),
    });
    const r = await h.src.query.trades({ status: 'open' });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ trade_id: 5, side: 'short', close_ms: null });
  });

  it('reads `lines` and `events`, and gives the gateway a lower-case level floor', async () => {
    const h = setup({
      'GET /logs': () => ({ lines: [{ ts_ms: 1, level: 'ERROR', message: 'm' }], next_cursor: 7 }),
      'GET /events': () => ({ events: [{ kind: 'warning', ts_ms: 1 }] }),
    });
    const logs = await h.src.query.logs({ botKey: 'local:1', level: 'WARNING', limit: 5 });
    expect(logs.items).toHaveLength(1);
    expect(logs.nextCursor).toBe('7');
    expect(h.fake.calls[0]!.params).toMatchObject({ bot: 'local:1', level: 'warning' });
    const ev = await h.src.query.events({ sinceMs: 5, kinds: ['warning', 'startup'] });
    expect(ev.items).toHaveLength(1);
    expect(h.fake.calls[1]!.params).toMatchObject({ since: 5, kinds: 'warning,startup' });
  });

  it('maps the registry and hides the bots this device already has', async () => {
    const h = setup({
      'GET /bots': () => ({ bots: [{ bot_key: 'local:1', name: 'a', ui_ids: ['ftbot.0'] }] }),
      'GET /bots/discovered': () => ({
        discovered: [
          { bot_key: 'local:1', name: 'a', port: 1, mode: 'live', registered_on_device: true },
          { bot_key: 'local:2', name: 'b', port: 2, mode: 'dry', registered_on_device: false },
        ],
      }),
    });
    expect(await h.src.registry.list()).toEqual([
      { botKey: 'local:1', uiId: 'ftbot.0', name: 'a', icon: null },
    ]);
    expect(await h.src.registry.discovered()).toEqual([
      { botKey: 'local:2', name: 'b', port: 2, mode: 'dry' },
    ]);
  });
});

describe('GatewaySource alerts', () => {
  it('builds the silence from the answer {id, until_ms} and lists the ones of this tab', async () => {
    const h = setup({
      'POST /alerts/silence': () => ({ id: 's1', until_ms: NOW + 1000 }),
    });
    const s = await h.src.alerts.silence({
      typeId: 'botOffline',
      botKey: 'local:1',
      untilMs: NOW + 5000,
    });
    expect(s).toEqual({
      id: 's1',
      type_id: 'botOffline',
      bot_key: 'local:1',
      subject: null,
      until_ms: NOW + 1000,
    });
    expect(await h.src.alerts.silences()).toHaveLength(1);
  });
});

describe('toGatewayActions: the fields the Rust `Params` accepts', () => {
  it('names the entry tag `enter_tag` and sends one blacklist call per pair', () => {
    expect(
      toGatewayActions({
        kind: 'forceentry',
        pair: 'BTC/USDC:USDC',
        side: 'long',
        entryTag: 'x',
      })[0]!.body,
    ).toEqual({ pair: 'BTC/USDC:USDC', side: 'long', enter_tag: 'x' });
    expect(toGatewayActions({ kind: 'blacklist_add', pairs: ['A', 'B'] })).toEqual([
      { name: 'blacklist_add', body: { pair: 'A' } },
      { name: 'blacklist_add', body: { pair: 'B' } },
    ]);
  });
});

describe('GatewaySource: audit, CSV export and confirmed proxy writes', () => {
  it('reads the audit newest first with the limit and the bot filter', async () => {
    const h = setup({
      'GET /audit': () => ({ entries: [{ ts_ms: 1 }, { ts_ms: 3 }, { ts_ms: 2 }] }),
    });
    const rows = await h.src.query.audit({ botKey: 'local:1', limit: 20 });
    expect(rows.map((r) => r.ts_ms)).toEqual([3, 2, 1]);
    const call = h.fake.calls.find((c) => c.url.includes('/audit'))!;
    expect(call.params).toMatchObject({ limit: 20, bot: 'local:1' });
  });

  it('exports the CSV with the filters of the Journal and returns the text as is', async () => {
    const h = setup({ 'GET /trades/export.csv': () => 'bot_key,trade_id\nlocal:1,1\n' });
    const csv = await h.src.query.exportTradesCsv({
      status: 'closed',
      bots: ['local:1', 'local:2'],
      side: 'short',
      mode: ['live'],
      exitReason: 'roi',
      fromMs: 5,
      sort: 'close_ms',
      order: 'desc',
    });
    expect(csv).toBe('bot_key,trade_id\nlocal:1,1\n');
    const call = h.fake.calls.find((c) => c.url.includes('export.csv'))!;
    expect(call.params).toEqual({
      bots: 'local:1,local:2',
      side: 'short',
      mode: 'live',
      exit_reason: 'roi',
      from: 5,
      sort: 'close_date',
      order: 'desc',
    });
  });

  it('sends the name of the bot in X-Confirm-Bot for a write that asks for it, and an idempotency key', async () => {
    const h = setup({
      'POST /bots/local%3A1/proxy/fleetview/resolve': () => ({ status: 'accepted' }),
    });
    await h.src.proxy(
      'local:1',
      'POST',
      'fleetview/resolve',
      { confirm: true },
      { confirmBot: 'hippo_1' },
    );
    const w = h.fake.writes();
    expect(w).toHaveLength(1);
    expect(w[0].headers?.['X-Confirm-Bot']).toBe('hippo_1');
    expect(w[0].headers?.['Idempotency-Key']).toMatch(/^proxy-/);
    await h.src.proxy('local:1', 'POST', 'fleetview/resolve', { confirm: true });
    expect(h.fake.writes()[1].headers?.['X-Confirm-Bot']).toBeUndefined();
  });
});
