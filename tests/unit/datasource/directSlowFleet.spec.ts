/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */
/**
 * B230: in direct mode the positions were never read on a fleet of slow bots. The requests of the
 * whole fleet shared four slots served in the order of the registry, the first bots took them
 * again and again, and a bot that took more than 8 s was given up. The fake network below has a
 * virtual clock and a latency per request, so the scenario of the real fleet (24 bots answering in
 * seconds, a quarter of them with an expired token) runs in a few milliseconds.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryAuthStore } from '@/datasource/direct/auth';
import { DirectSource } from '@/datasource/direct/DirectSource';
import { HttpTransportError, type HttpRequest, type HttpResponse } from '@/datasource/direct/http';
import type { StateUpdate } from '@/datasource/types';

import { makeJwt, ok, status, tick } from './helpers';

const NOW = 1_800_000_000_000;
const FRESH = makeJwt(NOW + 3_600_000);
const EXPIRED = makeJwt(NOW - 60_000);
const BOTS = 24;

interface Pending {
  dueMs: number;
  settle: () => void;
}

/** A network where every request takes `latency(req)` virtual milliseconds. */
function slowNetwork(opts: {
  latency: (path: string, host: string) => number;
  trades: (idx: number) => unknown[];
  /** Hosts that refuse the stale token with a 401 until a refresh gave a new one. */
  staleTokens?: Set<string>;
}) {
  const clock = { t: NOW };
  const pending: Pending[] = [];
  const calls: Array<{ path: string; host: string; method: string; at: number }> = [];
  const fresh = new Set<string>();
  const http = (req: HttpRequest): Promise<HttpResponse> => {
    const url = new URL(req.url);
    const host = url.host;
    const path = url.pathname.replace('/api/v1', '');
    calls.push({ path, host, method: req.method, at: clock.t });
    const idx = Number(host.match(/^bot(\d+)\./)![1]);
    let answer: HttpResponse;
    if (path === '/token/refresh') {
      fresh.add(host);
      answer = ok({ access_token: FRESH });
    } else if (opts.staleTokens?.has(host) && !fresh.has(host)) {
      answer = status(401, { detail: 'Token expired' });
    } else {
      switch (path) {
        case '/status':
          answer = ok(opts.trades(idx));
          break;
        case '/show_config':
          answer = ok({
            bot_name: `bot_${idx}`,
            dry_run: false,
            trading_mode: 'futures',
            stake_currency: 'USDC',
            exchange: 'hyperliquid',
            strategy: 'S',
            timeframe: '15m',
            max_open_trades: 5,
            state: 'running',
          });
          break;
        case '/profit_all':
          answer = ok({ all: { profit_closed_coin: 1, closed_trade_count: 0 } });
          break;
        case '/balance':
          answer = ok({ total: 1000, free: 900, used: 100, currencies: [] });
          break;
        case '/whitelist':
          answer = ok({ whitelist: ['BTC/USDC:USDC'] });
          break;
        case '/logs':
          answer = ok({ logs: [] });
          break;
        case '/trades':
          answer = ok({ trades: [], total_trades: opts.trades(idx).length });
          break;
        default:
          answer = status(404);
      }
    }
    const wanted = opts.latency(path, host);
    const late = wanted > req.timeoutMs;
    return new Promise<HttpResponse>((resolve, reject) => {
      pending.push({
        dueMs: clock.t + Math.min(wanted, req.timeoutMs),
        settle: () => (late ? reject(new HttpTransportError('timeout')) : resolve(answer)),
      });
    });
  };
  /** Move the virtual clock by `ms`, answering what is due and running the scheduler each second. */
  const advance = async (src: DirectSource, ms: number) => {
    const end = clock.t + ms;
    while (clock.t < end) {
      clock.t = Math.min(end, clock.t + 250);
      for (const p of pending.filter((x) => x.dueMs <= clock.t)) {
        pending.splice(pending.indexOf(p), 1);
        p.settle();
      }
      await tick();
      if ((clock.t - NOW) % 1000 === 0) (src as any).tick();
      await tick();
    }
  };
  return { http, clock, calls, advance };
}

const trade = (id: number, n: number) => ({
  trade_id: n * 100 + id,
  pair: 'BTC/USDC:USDC',
  is_short: false,
  is_open: true,
  amount: 0.1,
  stake_amount: 100,
  open_rate: 50_000,
  current_rate: 51_000,
  profit_abs: 1,
  profit_ratio: 0.01,
  leverage: 2,
  open_timestamp: NOW - 3_600_000,
  nr_of_successful_entries: 1,
});

const tradesOf = (idx: number) => Array.from({ length: idx % 3 }, (_, i) => trade(i + 1, idx));
const expectedPositions = Array.from({ length: BOTS }, (_, i) => tradesOf(i).length).reduce(
  (a, b) => a + b,
  0,
);

function entries(stale: Set<string>) {
  return Array.from({ length: BOTS }, (_, i) => ({
    id: `ftbot.${i}`,
    botName: `bot_${i}`,
    apiUrl: `http://bot${i}.test:${9100 + i}`,
    accessToken: stale.has(`bot${i}.test:${9100 + i}`) ? EXPIRED : FRESH,
    refreshToken: `refresh-${i}`,
    sortId: i,
  }));
}

let src: DirectSource | null = null;
afterEach(() => {
  src?.stop();
  src = null;
});

async function run(opts: {
  latency: (path: string, host: string) => number;
  stale?: Set<string>;
  focus?: string;
  seconds: number;
}) {
  const stale = opts.stale ?? new Set<string>();
  const net = slowNetwork({ latency: opts.latency, trades: tradesOf, staleTokens: stale });
  src = new DirectSource({
    auth: createMemoryAuthStore(entries(stale)),
    http: net.http,
    now: () => net.clock.t,
    localHosts: Array.from({ length: BOTS }, (_, i) => `bot${i}.test`),
    // The scheduler is driven by `advance`, not by real timers
    setTimeout: () => 0,
    clearTimeout: () => undefined,
  });
  const positions = new Map<string, unknown>();
  src.subscribe('positions', undefined, (u) => {
    const s = u as StateUpdate;
    if (s.kind !== 'snapshot' && s.kind !== 'delta') return;
    for (const [k, v] of Object.entries(s.upsert?.positions ?? {})) positions.set(k, v);
    for (const k of s.remove?.positions ?? []) positions.delete(k);
  });
  const states = new Map<string, string>();
  src.subscribe('fleet', undefined, (u) => {
    const s = u as StateUpdate;
    if (s.kind !== 'snapshot' && s.kind !== 'delta') return;
    for (const [k, v] of Object.entries(s.upsert?.bots ?? {})) {
      states.set(k, (v as { state: { status: string } }).state.status);
    }
  });
  if (opts.focus) src.subscribe('bot', { botKey: opts.focus }, () => undefined);
  await src.start();
  await net.advance(src, opts.seconds * 1000);
  src.flush();
  await tick();
  return { positions, states, net };
}

describe('direct mode on a slow fleet (B230)', () => {
  it('reads the positions of 24 bots that take 5 s to answer, within 30 s', async () => {
    const { positions } = await run({ latency: () => 5_000, seconds: 30 });
    expect(expectedPositions).toBeGreaterThan(20);
    expect(positions.size).toBe(expectedPositions);
  });

  it('waits for a bot that takes 12 s for /status, longer than the old 8 s limit', async () => {
    const { positions } = await run({
      latency: (path) => (path === '/status' ? 12_000 : 2_000),
      seconds: 45,
    });
    expect(positions.size).toBe(expectedPositions);
  });

  it('waits 10 s per position when the exchange is in backoff (60 s for six positions)', async () => {
    const { positions } = await run({
      latency: (path, host) => {
        if (path !== '/status') return 1_000;
        const idx = Number(host.match(/^bot(\d+)\./)![1]);
        return 10_000 * tradesOf(idx).length;
      },
      seconds: 60,
    });
    expect(positions.size).toBe(expectedPositions);
  });

  it('does not leave bots "starting" while their config waits behind the slow reads (B231)', async () => {
    const { states } = await run({
      latency: (path) => (path === '/status' ? 3_000 : path === '/show_config' ? 2_000 : 14_000),
      seconds: 30,
    });
    expect(states.size).toBe(BOTS);
    expect([...states.values()].filter((s) => s !== 'online')).toEqual([]);
  });

  it('replays /status after a 401 and the token refresh', async () => {
    const stale = new Set(Array.from({ length: 8 }, (_, i) => `bot${i * 3}.test:${9100 + i * 3}`));
    const { positions, net } = await run({ latency: () => 3_000, stale, seconds: 30 });
    expect(positions.size).toBe(expectedPositions);
    expect(net.calls.filter((c) => c.path === '/token/refresh').length).toBeGreaterThanOrEqual(8);
    expect(net.calls.every((c) => c.method === 'GET' || c.path === '/token/refresh')).toBe(true);
  });

  it('serves the bot on screen first, even when it is the last of the registry', async () => {
    const last = `local:${9100 + BOTS - 1}`;
    const { net } = await run({ latency: () => 6_000, focus: last, seconds: 2 });
    const first = net.calls.find(
      (c) => c.path === '/status' && c.host === `bot${BOTS - 1}.test:${9100 + BOTS - 1}`,
    );
    expect(first).toBeDefined();
    expect(first!.at - NOW).toBeLessThanOrEqual(1_000);
  });

  it('does not let the background reads take the slots of the positions', async () => {
    // Everything but /status is very slow: the positions still come in time
    const { positions } = await run({
      latency: (path) => (path === '/status' ? 3_000 : path === '/show_config' ? 2_000 : 14_000),
      seconds: 30,
    });
    expect(positions.size).toBe(expectedPositions);
  });
});
