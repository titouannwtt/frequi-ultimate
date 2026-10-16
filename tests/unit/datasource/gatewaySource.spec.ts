import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewaySource } from '@/datasource/gateway/GatewaySource';
import { createGatewayHttp } from '@/datasource/gateway/http';
import type { SessionManager } from '@/datasource/gateway/session';
import type { StateUpdate } from '@/datasource/types';
import { GATEWAY_PROTOCOL_VERSION } from '@/gateway/types.gen';

import {
  createFakeHttp,
  FakeWs,
  fakeWsFactory,
  lastWs,
  ManualTimers,
  ok,
  status,
  tick,
  type FakeHandler,
} from './helpers';

const NOW = 1_800_000_000_000;

const bot = (key: string, extra: Record<string, unknown> = {}) => ({
  bot_key: key,
  identity: { name: key, mode: 'live' },
  ...extra,
});

interface Net {
  /** Answer for GET /snapshot (the handler can change it between calls). */
  snapshot: () => { body: unknown; seq: string };
  action?: FakeHandler;
  /** Answer for GET /trades (the open positions of the bot). */
  trades?: () => unknown;
  snapshots: number;
}

function setup(net: Partial<Net> = {}) {
  const state = {
    snapshots: 0,
    snapshot: () => ({
      body: {
        bots: { 'local:1': bot('local:1') },
        wallets: {},
        positions: { 'local:1/1': { bot_key: 'local:1', trade_id: 1 } },
      },
      seq: 'fleet=10, positions=5',
    }),
    ...net,
  };
  const fake = createFakeHttp((req, n) => {
    const path = new URL(req.url).pathname.replace('/gw/v1', '');
    if (path === '/snapshot') {
      state.snapshots++;
      const s = state.snapshot();
      return ok(s.body, { 'x-gw-seq': s.seq });
    }
    if (path === '/hello')
      return ok({ version: 'test', protocol: GATEWAY_PROTOCOL_VERSION, auth_modes: ['session'] });
    if (path === '/trades' && net.trades) return ok(net.trades());
    if (path.includes('/actions/'))
      return net.action ? net.action(req, n) : ok({ status: 'accepted' });
    return status(404);
  });
  const timers = new ManualTimers();
  const session = {
    ensure: vi.fn(async () => 'sess-1'),
    token: vi.fn(() => 'sess-1'),
    invalidate: vi.fn(),
    renew: vi.fn(async () => 'sess-2'),
  } satisfies SessionManager;
  const unusable: string[] = [];
  const http = createGatewayHttp({
    http: fake.http,
    baseUrl: () => 'https://gw.test:9399',
    session: () => 'sess-1',
  });
  const src = new GatewaySource({
    http,
    session,
    baseUrl: () => 'https://gw.test:9399',
    deviceId: () => 'd-test',
    wsFactory: fakeWsFactory(),
    aliases: () => ({ 'ftbot.0': 'local:1' }),
    now: () => NOW,
    timers,
    jitter: false,
    onUnusable: (r) => unusable.push(r),
  });
  const updates: StateUpdate[] = [];
  return { src, fake, timers, session, unusable, updates, state };
}

async function live(
  h: ReturnType<typeof setup>,
  channels: Array<'fleet' | 'positions'> = ['fleet'],
) {
  for (const ch of channels) {
    h.src.subscribe(ch, undefined, (u) => h.updates.push(u as StateUpdate));
  }
  await h.src.start();
  await tick();
  lastWs().open();
  lastWs().serve({
    t: 'authed',
    protocol: GATEWAY_PROTOCOL_VERSION,
    ts: NOW + 250,
    hb_interval_s: 15,
  });
  await tick();
  lastWs().serve({ t: 'subscribed', seq: {} });
  await tick();
}

beforeEach(() => {
  FakeWs.all = [];
});

describe('GatewaySource: snapshot then subscribe with resume', () => {
  it('loads the snapshot first, then subscribes from its sequence numbers', async () => {
    const h = setup();
    await live(h, ['fleet', 'positions']);
    expect(h.state.snapshots).toBe(1);
    const snap = h.updates.find((u) => u.kind === 'snapshot')!;
    expect(snap.seq).toBe(10);
    expect(Object.keys(snap.upsert.bots ?? {})).toEqual(['local:1']);
    const subs = lastWs().frames('sub');
    expect(subs.at(-1)).toEqual({
      t: 'sub',
      ch: expect.arrayContaining(['fleet', 'positions']),
      resume: { fleet: 10, positions: 5 },
    });
    expect(h.src.status.value.state).toBe('live');
    // The clock skew comes from the server timestamp.
    expect(h.src.status.value.clockSkewMs).toBe(250);
  });

  it('applies deltas in order and ignores a duplicate', async () => {
    const h = setup();
    await live(h);
    const up = (seq: number, name: string) => ({
      t: 'up',
      ch: 'fleet',
      seq,
      ts: NOW,
      upsert: { bots: { 'local:1': { identity: { name } } } },
      remove: {},
    });
    lastWs().serve(up(11, 'a'));
    lastWs().serve(up(11, 'dup'));
    lastWs().serve(up(12, 'b'));
    const deltas = h.updates.filter((u) => u.kind === 'delta');
    expect(deltas.map((d) => d.seq)).toEqual([11, 12]);
    expect(h.state.snapshots).toBe(1);
  });

  it('reloads the snapshot when a delta is missing (gap), without touching the sinks with a partial state', async () => {
    const h = setup();
    await live(h);
    h.state.snapshot = () => ({
      body: { bots: { 'local:1': bot('local:1'), 'local:2': bot('local:2') }, wallets: {} },
      seq: 'fleet=20',
    });
    lastWs().serve({ t: 'up', ch: 'fleet', seq: 15, ts: NOW, upsert: {}, remove: {} });
    await tick();
    expect(h.state.snapshots).toBe(2);
    const last = h.updates.at(-1)!;
    expect(last.kind).toBe('snapshot');
    expect(last.seq).toBe(20);
    expect(Object.keys(last.upsert.bots ?? {}).sort()).toEqual(['local:1', 'local:2']);
  });

  it('reloads on a `resync` frame', async () => {
    const h = setup();
    await live(h);
    lastWs().serve({ t: 'resync', ch: 'fleet', reason: 'overflow' });
    await tick();
    expect(h.state.snapshots).toBe(2);
  });

  it('applies the frames that arrived while the snapshot was loading, after it', async () => {
    const h = setup();
    await live(h);
    h.state.snapshot = () => ({ body: { bots: {}, wallets: {} }, seq: 'fleet=30' });
    // The delta 31 reaches the browser while the snapshot 30 is still on its way.
    lastWs().serve({ t: 'resync', ch: 'fleet', reason: 'gap' });
    lastWs().serve({
      t: 'up',
      ch: 'fleet',
      seq: 31,
      ts: NOW,
      upsert: { bots: { 'local:3': bot('local:3') } },
      remove: {},
    });
    await tick();
    expect(h.updates.slice(-2).map((u) => `${u.kind}:${u.seq}`)).toEqual([
      'snapshot:30',
      'delta:31',
    ]);
  });

  it('hands a late subscriber the current state at once', async () => {
    const h = setup();
    await live(h);
    const late: StateUpdate[] = [];
    h.src.subscribe('fleet', undefined, (u) => late.push(u as StateUpdate));
    expect(late[0]!.kind).toBe('snapshot');
    expect(Object.keys(late[0]!.upsert.bots ?? {})).toEqual(['local:1']);
  });

  it('refuses a malformed channel key (an ftbot alias is not a bot_key)', () => {
    const h = setup();
    expect(() => h.src.subscribe('bot', { botKey: 'ftbot.3' }, () => undefined)).toThrow(
      /invalid channel/,
    );
  });
});

describe('GatewaySource: connection life cycle', () => {
  it('goes offline when the link drops and live again after the resume', async () => {
    const h = setup();
    await live(h);
    lastWs().drop(1006);
    expect(h.src.status.value.state).toBe('offline');
    h.timers.advance(1_000);
    lastWs().open();
    lastWs().serve({ t: 'authed', protocol: GATEWAY_PROTOCOL_VERSION, ts: NOW, hb_interval_s: 15 });
    // Reconnect resumes from the last applied sequence number, no new snapshot needed.
    expect(lastWs().frames('sub').at(-1)).toMatchObject({ resume: { fleet: 10 } });
    lastWs().serve({ t: 'subscribed', seq: {} });
    expect(h.src.status.value.state).toBe('live');
    expect(h.state.snapshots).toBe(1);
  });

  it('opens a NEW session when the server rejects the old one (legacy bug B14) and reconnects', async () => {
    const h = setup();
    await live(h);
    lastWs().drop(4401);
    await tick();
    expect(h.session.invalidate).toHaveBeenCalled();
    expect(h.session.ensure.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(FakeWs.all.length).toBe(2);
  });

  it('declares the gateway unusable when a new session cannot be obtained', async () => {
    const h = setup();
    await live(h);
    h.session.ensure.mockRejectedValue(new Error('refused'));
    lastWs().drop(4401);
    await tick();
    expect(h.unusable).toEqual(['auth']);
    expect(h.src.status.value.state).toBe('offline');
  });

  it('declares the gateway unusable on a protocol mismatch', async () => {
    const h = setup();
    h.src.subscribe('fleet', undefined, () => undefined);
    await h.src.start();
    await tick();
    lastWs().open();
    lastWs().serve({
      t: 'authed',
      protocol: GATEWAY_PROTOCOL_VERSION + 1,
      ts: NOW,
      hb_interval_s: 15,
    });
    expect(h.unusable).toEqual(['protocol']);
  });

  it('turns degraded, not silently wrong, when channels keep losing frames', async () => {
    const h = setup();
    await live(h);
    for (let i = 0; i < 5; i++) {
      lastWs().serve({ t: 'resync', ch: 'fleet', reason: 'overflow' });
      await tick();
    }
    expect(h.src.status.value.state).toBe('degraded');
    expect(h.src.status.value.reason).toBe('resync_storm');
  });

  it('reports itself offline with a reason when no session can be opened at start', async () => {
    const h = setup();
    h.session.ensure.mockRejectedValue(new Error('refused'));
    await expect(h.src.start()).rejects.toThrow();
    expect(h.src.status.value).toMatchObject({ state: 'offline', reason: 'session' });
  });
});

describe('GatewaySource actions', () => {
  const exit = {
    kind: 'forceexit',
    tradeId: 7,
    expected: { pair: 'BTC/USDC:USDC', isShort: false },
  } as const;

  it('sends one POST with the idempotency key and maps `accepted`', async () => {
    const h = setup();
    const r = await h.src.act('local:1', exit, 'idem-1');
    expect(r.status).toBe('accepted');
    const writes = h.fake.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.url).toContain('/bots/local%3A1/actions/forceexit');
    expect(writes[0]!.headers?.['Idempotency-Key']).toBe('idem-1');
    expect(writes[0]!.body).toMatchObject({
      trade_id: 7,
      expected: { pair: 'BTC/USDC:USDC', is_short: false },
    });
  });

  it('does not replay after a 401: it renews the session and tells the user nothing ran', async () => {
    const h = setup({ action: () => status(401, { code: 'unauthorized' }) });
    const r = await h.src.act('local:1', exit, 'idem-2');
    expect(r.status).toBe('unauthorized');
    expect(h.fake.writes()).toHaveLength(1);
    await tick();
    expect(h.session.renew).toHaveBeenCalled();
  });

  it('maps 409 to state_mismatch or in_progress and never retries', async () => {
    const mismatch = setup({ action: () => status(409, { code: 'state_mismatch' }) });
    expect((await mismatch.src.act('local:1', exit, 'k1')).status).toBe('state_mismatch');
    const busy = setup({ action: () => status(409, { code: 'in_progress' }) });
    expect((await busy.src.act('local:1', exit, 'k2')).status).toBe('in_progress');
    expect(mismatch.fake.writes()).toHaveLength(1);
    expect(busy.fake.writes()).toHaveLength(1);
  });

  it('reports `unknown` after a timeout and does not send again', async () => {
    const h = setup({ action: () => 'timeout' });
    const r = await h.src.act('local:1', exit, 'k3');
    expect(r.status).toBe('unknown');
    expect(r.verify).not.toBeNull();
    expect(h.fake.writes()).toHaveLength(1);
  });

  it('maps a refusal to `rejected` with the reason of the bot', async () => {
    const h = setup({
      action: () => status(422, { code: 'bad_request', message: 'confirm_trade_exit refused' }),
    });
    const r = await h.src.act('local:1', exit, 'k4');
    expect(r).toMatchObject({
      status: 'rejected',
      error: 'bad_request',
      botResponse: 'confirm_trade_exit refused',
    });
  });

  it('sends nothing when no session can be opened', async () => {
    const h = setup();
    h.session.ensure.mockRejectedValue(new Error('refused'));
    const r = await h.src.act('local:1', exit, 'k5');
    expect(r.status).toBe('unauthorized');
    expect(h.fake.calls).toEqual([]);
  });

  it('expands an exit of everything into one forceexit per open position, each with its own key', async () => {
    const h = setup({
      trades: () => ({
        open: [
          { bot_key: 'local:1', trade_id: 4, pair: 'BTC/USDC:USDC', side: 'long', orphan: false },
          { bot_key: 'local:1', trade_id: 9, pair: 'ETH/USDC:USDC', side: 'short', orphan: false },
          { bot_key: 'local:1', trade_id: 11, pair: 'XRP/USDC:USDC', side: 'long', orphan: true },
        ],
        matched: 3,
      }),
    });
    const r = await h.src.act(
      'local:1',
      { kind: 'forceexit', tradeId: 'all', confirm: 'hippo' },
      'k6',
    );
    expect(r.status).toBe('accepted');
    const writes = h.fake.writes();
    // The gateway has no "all": 2 owned positions, the orphan is left to the reconciliation.
    expect(writes).toHaveLength(2);
    expect(writes.map((w) => w.headers?.['Idempotency-Key'])).toEqual(['k6:4', 'k6:9']);
    expect(writes[0]!.body).toEqual({
      trade_id: 4,
      expected: { pair: 'BTC/USDC:USDC', is_short: false },
      confirm: 'hippo',
    });
    expect(writes[1]!.body).toMatchObject({ trade_id: 9, expected: { is_short: true } });
  });

  it('reports `unknown` when only some of the exits of a bot were accepted', async () => {
    let n = 0;
    const h = setup({
      trades: () => ({
        open: [
          { bot_key: 'local:1', trade_id: 4, pair: 'A', side: 'long', orphan: false },
          { bot_key: 'local:1', trade_id: 9, pair: 'B', side: 'long', orphan: false },
        ],
      }),
      action: () => (++n === 1 ? ok({ status: 'accepted' }) : status(422, { code: 'bad_request' })),
    });
    const r = await h.src.act('local:1', { kind: 'forceexit', tradeId: 'all' }, 'k7');
    expect(r.status).toBe('unknown');
    expect(r.botResponse).toBe('1/2');
  });

  it('sends nothing for an exit of everything when there is nothing open', async () => {
    const h = setup({ trades: () => ({ open: [] }) });
    const r = await h.src.act('local:1', { kind: 'forceexit', tradeId: 'all' }, 'k8');
    expect(r.status).toBe('state_mismatch');
    expect(h.fake.writes()).toEqual([]);
  });
});
