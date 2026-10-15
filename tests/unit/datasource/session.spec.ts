/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures and decoded wire frames */
import { describe, expect, it } from 'vitest';

import { createMemoryAuthStore, jwtExpiryMs } from '@/datasource/direct/auth';
import { createBotClient } from '@/datasource/direct/botClient';
import { createGatewayHttp, GatewayError, parseSeqHeader } from '@/datasource/gateway/http';
import { createSessionManager, type GatewayPrefsPort } from '@/datasource/gateway/session';
import { parseSnapshot } from '@/datasource/gateway/snapshot';
import { defaultGatewayPrefs, type GatewayPrefs } from '@/migration/schema';

import { createFakeHttp, makeJwt, ok, status } from './helpers';

const NOW = 1_800_000_000_000;

function setup(opts: { bootstrap?: () => ReturnType<typeof ok> | ReturnType<typeof status> } = {}) {
  const auth = createMemoryAuthStore([
    {
      id: 'ftbot.0',
      botName: 'on the gateway host',
      apiUrl: 'http://localhost:9400',
      accessToken: makeJwt(NOW + 3_600_000),
      refreshToken: 'LOCAL-REFRESH',
    },
    {
      id: 'ftbot.1',
      botName: 'remote',
      apiUrl: 'https://remote-bot.test:8443',
      accessToken: makeJwt(NOW + 10_000),
      refreshToken: 'REMOTE-REFRESH',
    },
  ]);
  const freshRemote = makeJwt(NOW + 3_600_000);
  const fake = createFakeHttp((req) => {
    if (req.url.endsWith('/token/refresh')) return ok({ access_token: freshRemote });
    if (req.url.endsWith('/session/bootstrap')) {
      return (
        opts.bootstrap?.() ??
        ok({
          session: 'SESSION-1',
          expires_at: Math.floor(NOW / 1000) + 3600,
          bots: [
            { ui_id: 'ftbot.0', bot_key: 'local:9400', scope: true },
            { ui_id: 'ftbot.1', bot_key: 'remote-bot.test:8443', scope: true },
          ],
        })
      );
    }
    return status(404);
  });
  let prefs: GatewayPrefs = { ...defaultGatewayPrefs(), deviceId: 'd-test' };
  const port: GatewayPrefsPort = { get: () => prefs, patch: (p) => (prefs = { ...prefs, ...p }) };
  const http = createGatewayHttp({
    http: fake.http,
    baseUrl: () => 'https://gw.test:9399',
    session: () => null,
  });
  const botClient = createBotClient({ http: fake.http, auth, now: () => NOW });
  const session = createSessionManager({
    http,
    auth,
    botClient,
    prefs: port,
    localHosts: ['localhost'],
    now: () => NOW,
  });
  return { session, fake, auth, prefs: () => prefs };
}

describe('gateway session', () => {
  it('refreshes tokens that are about to expire, then uploads them once', async () => {
    const h = setup();
    const token = await h.session.ensure();
    expect(token).toBe('SESSION-1');
    const boot = h.fake.calls.find((c) => c.url.endsWith('/session/bootstrap'))!;
    const bots = (boot.body as any).bots as any[];
    expect(bots).toHaveLength(2);
    // The short lived token of the remote bot was refreshed before the upload.
    expect(h.fake.where((c) => c.url.endsWith('/token/refresh'))).toHaveLength(1);
    const uploadedRemote = bots.find((b) => b.ui_id === 'ftbot.1').accessToken;
    expect(uploadedRemote).toBe(h.auth.data[1]!.accessToken);
    expect(jwtExpiryMs(uploadedRemote)).toBeGreaterThan(NOW + 30 * 60_000);
  });

  it('never uploads the refresh token of a bot that runs on the gateway host', async () => {
    const h = setup();
    await h.session.ensure();
    const bots = (h.fake.calls.find((c) => c.url.endsWith('/session/bootstrap'))!.body as any)
      .bots as any[];
    const local = bots.find((b) => b.ui_id === 'ftbot.0');
    const remote = bots.find((b) => b.ui_id === 'ftbot.1');
    expect(local.refreshToken).toBeUndefined();
    expect(remote.refreshToken).toBe('REMOTE-REFRESH');
  });

  it('keeps the alias map and the session in the preferences, and reuses the session', async () => {
    const h = setup();
    await h.session.ensure();
    expect(h.prefs().aliases).toEqual({
      'ftbot.0': 'local:9400',
      'ftbot.1': 'remote-bot.test:8443',
    });
    expect(h.prefs().session).toBe('SESSION-1');
    expect(h.prefs().expiresAt).toBe(NOW + 3_600_000);
    await h.session.ensure();
    expect(h.fake.where((c) => c.url.endsWith('/session/bootstrap'))).toHaveLength(1);
  });

  it('opens one bootstrap at a time', async () => {
    const h = setup();
    await Promise.all([h.session.ensure(), h.session.ensure(), h.session.ensure()]);
    expect(h.fake.where((c) => c.url.endsWith('/session/bootstrap'))).toHaveLength(1);
  });

  it('renews on demand and forgets an invalidated session', async () => {
    const h = setup();
    await h.session.ensure();
    h.session.invalidate();
    expect(h.session.token()).toBeNull();
    await h.session.renew();
    expect(h.fake.where((c) => c.url.endsWith('/session/bootstrap'))).toHaveLength(2);
  });

  it('fails with a typed error when the gateway refuses the bootstrap', async () => {
    const h = setup({
      bootstrap: () => status(401, { code: 'unauthorized', message: 'no valid bot token' }),
    });
    await expect(h.session.ensure()).rejects.toBeInstanceOf(GatewayError);
    expect(h.prefs().session).toBeNull();
  });

  it('fails when there is no bot registered in this browser', async () => {
    const h = setup();
    h.auth.data.length = 0;
    await expect(h.session.ensure()).rejects.toThrow(/no bot registered/);
  });
});

describe('gateway http', () => {
  it('turns an ApiError body into a GatewayError carrying the code', async () => {
    const fake = createFakeHttp(() =>
      status(429, { code: 'rate_limited', message: 'slow down', retry_after_ms: 2500 }),
    );
    const http = createGatewayHttp({
      http: fake.http,
      baseUrl: () => 'https://gw.test',
      session: () => 's',
    });
    const err = await http.json('GET', '/bots').catch((e) => e);
    expect(err).toMatchObject({ code: 'rate_limited', status: 429, retryAfterMs: 2500 });
  });

  it('answers `hello` with null when nothing answers', async () => {
    const fake = createFakeHttp(() => 'timeout');
    const http = createGatewayHttp({
      http: fake.http,
      baseUrl: () => 'https://gw.test',
      session: () => null,
    });
    expect(await http.hello(100)).toBeNull();
  });

  it('sends the session as a bearer token and none on public routes', async () => {
    const fake = createFakeHttp(() => ok({ version: 'x', protocol: 1, auth_modes: [] }));
    const http = createGatewayHttp({
      http: fake.http,
      baseUrl: () => 'https://gw.test',
      session: () => 'tok',
    });
    await http.hello();
    await http.json('GET', '/bots');
    expect(fake.calls[0]!.headers?.Authorization).toBeUndefined();
    expect(fake.calls[1]!.headers?.Authorization).toBe('Bearer tok');
  });
});

describe('snapshot reading', () => {
  it('parses the X-Gw-Seq header, bare or per channel', () => {
    expect(parseSeqHeader('fleet=1842, alerts=77')).toEqual({ fleet: 1842, alerts: 77 });
    expect(parseSeqHeader('9', 'fleet')).toEqual({ fleet: 9 });
    expect(parseSeqHeader('garbage')).toEqual({});
    expect(parseSeqHeader(undefined)).toEqual({});
  });

  it('splits the collections per channel and takes the sequence from the header', () => {
    const p = parseSnapshot(
      { bots: { a: 1 }, wallets: { w: 2 }, positions: { p: 3 } },
      { 'x-gw-seq': 'fleet=5, positions=7' },
      ['fleet', 'positions', 'alerts'],
    );
    expect(p.seq).toEqual({ fleet: 5, positions: 7 });
    expect(p.byChannel.fleet).toEqual({ bots: { a: 1 }, wallets: { w: 2 } });
    expect(p.byChannel.positions).toEqual({ positions: { p: 3 } });
    expect(p.byChannel.alerts).toEqual({ alerts: {} });
  });

  it('accepts a wrapped answer and explicit per channel collections', () => {
    const p = parseSnapshot(
      {
        collections: { bots: { a: 1 } },
        channels: { 'bot:local:1': { trades: { t: 1 } } },
        seq: { fleet: 2 },
      },
      undefined,
      ['fleet', 'bot:local:1'],
    );
    expect(p.seq.fleet).toBe(2);
    expect(p.byChannel.fleet.bots).toEqual({ a: 1 });
    expect(p.byChannel['bot:local:1']).toEqual({ trades: { t: 1 } });
  });
});
