/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures and decoded wire frames */
import { beforeEach, describe, expect, it } from 'vitest';

import { GatewaySocket, type SocketState } from '@/datasource/gateway/socket';

import { FakeWs, fakeWsFactory, lastWs, ManualTimers } from './helpers';

function setup(
  opts: { token?: string | null; channels?: string[]; resume?: Record<string, number> } = {},
) {
  const timers = new ManualTimers();
  const states: Array<{ s: SocketState; info: any }> = [];
  const frames: any[] = [];
  let authFailures = 0;
  const factory = fakeWsFactory();
  const sock = new GatewaySocket({
    url: () => 'wss://gw.test/gw/v1/ws',
    token: () => (opts.token === undefined ? 'session-token' : opts.token),
    deviceId: () => 'd-test',
    factory,
    timers,
    jitter: false,
    wanted: () => ({ channels: opts.channels ?? ['fleet'], resume: opts.resume ?? {} }),
    onFrame: (f) => frames.push(f),
    onState: (s, info) => states.push({ s, info }),
    onAuthFailure: () => authFailures++,
  });
  return { sock, timers, states, frames, auth: () => authFailures };
}

async function goLive(h: ReturnType<typeof setup>) {
  h.sock.start();
  lastWs().open();
  lastWs().serve({ t: 'authed', protocol: 1, ts: 1, hb_interval_s: 15 });
  lastWs().serve({ t: 'subscribed', seq: { fleet: 3 } });
}

beforeEach(() => {
  FakeWs.all = [];
});

describe('GatewaySocket', () => {
  it('authenticates with the token in the first frame, never in the URL', () => {
    const h = setup();
    h.sock.start();
    lastWs().open();
    const [auth] = lastWs().frames('auth');
    expect(auth).toEqual({ t: 'auth', token: 'session-token', device_id: 'd-test' });
    expect(lastWs().url).not.toContain('session-token');
  });

  it('subscribes with the resume points after `authed` and is live after `subscribed`', async () => {
    const h = setup({ channels: ['fleet', 'alerts'], resume: { fleet: 41 } });
    await goLive(h);
    expect(lastWs().frames('sub')).toEqual([
      { t: 'sub', ch: ['fleet', 'alerts'], resume: { fleet: 41 } },
    ]);
    expect(h.sock.current).toBe('live');
    expect(h.frames.map((f) => f.t)).toEqual(['authed', 'subscribed']);
  });

  it('backs off 1, 2, 5, 10, 30, 30 seconds, and starts over once live', async () => {
    const h = setup();
    h.sock.start();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      lastWs().drop(1006);
      waits.push(h.timers.delays()[0]!);
      h.timers.advance(h.timers.delays()[0]!);
    }
    expect(waits).toEqual([1000, 2000, 5000, 10000, 30000, 30000]);
    lastWs().open();
    lastWs().serve({ t: 'authed', protocol: 1, ts: 1, hb_interval_s: 15 });
    lastWs().serve({ t: 'subscribed', seq: {} });
    lastWs().drop(1006);
    expect(h.timers.delays()[0]).toBe(1000);
  });

  it('treats 35 s of silence as a dead link and reconnects', async () => {
    const h = setup();
    await goLive(h);
    const first = lastWs();
    h.timers.advance(34_000);
    expect(FakeWs.all).toHaveLength(1);
    h.timers.advance(1_500);
    expect(h.sock.current).toBe('backoff');
    h.timers.advance(1_000);
    expect(FakeWs.all).toHaveLength(2);
    expect(first.closedWith).not.toBeNull();
  });

  it('keeps the link alive as long as frames arrive', async () => {
    const h = setup();
    await goLive(h);
    for (let i = 0; i < 6; i++) {
      h.timers.advance(15_000);
      lastWs().serve({ t: 'hb', ts: i });
    }
    expect(FakeWs.all).toHaveLength(1);
    expect(h.sock.current).toBe('live');
  });

  it('gives up and reconnects when the server never answers the auth frame', () => {
    const h = setup();
    h.sock.start();
    lastWs().open();
    h.timers.advance(5_000);
    expect(h.sock.current).toBe('backoff');
  });

  it('hands a rejected session (4401) to the owner and does not retry by itself', async () => {
    const h = setup();
    await goLive(h);
    lastWs().drop(4401);
    expect(h.auth()).toBe(1);
    expect(h.sock.current).toBe('closed');
    h.timers.advance(120_000);
    expect(FakeWs.all).toHaveLength(1);
    // The owner renewed the session: reconnect right away, with the new token.
    h.sock.reconnectNow();
    expect(FakeWs.all).toHaveLength(2);
  });

  it.each([4403, 4429])('stops for good on close code %i', async (code) => {
    const h = setup();
    await goLive(h);
    lastWs().drop(code);
    h.timers.advance(300_000);
    expect(FakeWs.all).toHaveLength(1);
    expect(h.sock.current).toBe('closed');
    expect(h.auth()).toBe(0);
  });

  it('asks the owner for a session when there is no token', () => {
    const h = setup({ token: null });
    h.sock.start();
    expect(h.auth()).toBe(1);
    expect(FakeWs.all).toHaveLength(0);
  });

  it('sends only when live, and stop closes the socket', async () => {
    const h = setup();
    h.sock.start();
    expect(h.sock.send({ t: 'ping', ts: 1 })).toBe(false);
    lastWs().open();
    lastWs().serve({ t: 'authed', protocol: 1, ts: 1, hb_interval_s: 15 });
    lastWs().serve({ t: 'subscribed', seq: {} });
    expect(h.sock.send({ t: 'ping', ts: 1 })).toBe(true);
    const ws = lastWs();
    h.sock.stop();
    expect(ws.closedWith?.code).toBe(1000);
    expect(h.timers.count).toBe(0);
  });

  it('ignores a frame that is not JSON', async () => {
    const h = setup();
    h.sock.start();
    lastWs().open();
    lastWs().onmessage?.({ data: '{broken' });
    expect(h.frames).toEqual([]);
  });
});
