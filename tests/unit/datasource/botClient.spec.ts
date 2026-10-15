import { describe, expect, it } from 'vitest';

import { createMemoryAuthStore, jwtExpiryMs } from '@/datasource/direct/auth';
import {
  baseUrlOf,
  BotRequestError,
  createBotClient,
  WRITE_MIN_TOKEN_TTL_MS,
} from '@/datasource/direct/botClient';

import { createFakeHttp, makeJwt, ok, status } from './helpers';

const NOW = 1_800_000_000_000;

function setup(opts: { access?: string; refresh?: string } = {}) {
  const auth = createMemoryAuthStore([
    {
      id: 'ftbot.0',
      botName: 'bot a',
      apiUrl: 'http://bot-a.test:8080',
      accessToken: opts.access ?? makeJwt(NOW + 600_000),
      refreshToken: opts.refresh ?? 'refresh-ok',
    },
  ]);
  return auth;
}

describe('jwt expiry', () => {
  it('reads exp in ms and tolerates garbage', () => {
    expect(jwtExpiryMs(makeJwt(NOW))).toBe(NOW);
    expect(jwtExpiryMs('nope')).toBeNull();
    expect(jwtExpiryMs('a.b.c')).toBeNull();
  });
});

describe('reads (legacy bug B4: no replay after a failed refresh)', () => {
  it('refreshes on 401 and replays the read once with the NEW token', async () => {
    const auth = setup();
    const fresh = makeJwt(NOW + 900_000);
    let first = true;
    const fake = createFakeHttp((req) => {
      if (req.url.endsWith('/token/refresh')) return ok({ access_token: fresh });
      if (first) {
        first = false;
        return status(401);
      }
      return ok({ ok: true });
    });
    const client = createBotClient({ http: fake.http, auth, now: () => NOW });
    const res = await client.get('ftbot.0', '/status');
    expect(res.status).toBe(200);
    const reads = fake.where((c) => c.url.endsWith('/status'));
    expect(reads).toHaveLength(2);
    expect(reads[1]!.headers?.Authorization).toBe(`Bearer ${fresh}`);
    // The new token went back to the shared storage.
    expect(auth.data[0]!.accessToken).toBe(fresh);
  });

  it('does not replay when the refresh token is dead, and never sends an empty token', async () => {
    const auth = setup();
    const fake = createFakeHttp((req) =>
      req.url.endsWith('/token/refresh') ? status(401) : status(401),
    );
    const client = createBotClient({ http: fake.http, auth, now: () => NOW });
    await expect(client.get('ftbot.0', '/status')).rejects.toMatchObject({
      failure: { kind: 'auth_expired' },
    });
    expect(fake.where((c) => c.url.endsWith('/status'))).toHaveLength(1);
    for (const c of fake.calls)
      expect(c.headers?.Authorization ?? 'Bearer x').not.toMatch(/Bearer\s*$/);
  });

  it('shares one refresh between concurrent reads', async () => {
    const auth = setup();
    const fresh = makeJwt(NOW + 900_000);
    const seen = new Set<string>();
    const fake = createFakeHttp(async (req) => {
      if (req.url.endsWith('/token/refresh')) {
        await new Promise((r) => setTimeout(r, 5));
        return ok({ access_token: fresh });
      }
      const key = req.url + (req.headers?.Authorization ?? '');
      if (!seen.has(req.url)) {
        seen.add(req.url);
        return status(401);
      }
      return ok({ k: key.length });
    });
    const client = createBotClient({ http: fake.http, auth, now: () => NOW });
    await Promise.all([client.get('ftbot.0', '/a'), client.get('ftbot.0', '/b')]);
    expect(fake.where((c) => c.url.endsWith('/token/refresh'))).toHaveLength(1);
  });

  it('maps a timeout to a transport failure', async () => {
    const fake = createFakeHttp(() => 'timeout');
    const client = createBotClient({ http: fake.http, auth: setup(), now: () => NOW });
    const err = await client.get('ftbot.0', '/status').catch((e) => e);
    expect(err).toBeInstanceOf(BotRequestError);
    expect(err.failure).toEqual({ kind: 'transport', transport: 'timeout' });
  });
});

describe('writes are sent once', () => {
  it('sends exactly one request and returns a 401 as is (no refresh, no replay)', async () => {
    const auth = setup();
    const fake = createFakeHttp(() => status(401));
    const client = createBotClient({ http: fake.http, auth, now: () => NOW });
    const res = await client.write('ftbot.0', 'POST', '/forceexit', { body: { tradeid: '1' } });
    expect(res.status).toBe(401);
    expect(res.sent).toBe(true);
    expect(fake.writes()).toHaveLength(1);
    expect(fake.where((c) => c.url.endsWith('/token/refresh'))).toHaveLength(0);
  });

  it('refreshes BEFORE sending when the token is about to expire', async () => {
    const auth = setup({ access: makeJwt(NOW + WRITE_MIN_TOKEN_TTL_MS - 1_000) });
    const fresh = makeJwt(NOW + 900_000);
    const fake = createFakeHttp((req) =>
      req.url.endsWith('/token/refresh') ? ok({ access_token: fresh }) : ok({ status: 'ok' }),
    );
    const client = createBotClient({ http: fake.http, auth, now: () => NOW });
    const res = await client.write('ftbot.0', 'POST', '/stopbuy');
    expect(res.sent).toBe(true);
    const write = fake.writes().find((c) => c.url.endsWith('/stopbuy'))!;
    expect(write.headers?.Authorization).toBe(`Bearer ${fresh}`);
  });

  it('sends nothing when the token cannot be made fresh', async () => {
    const auth = setup({ access: makeJwt(NOW + 5_000) });
    const fake = createFakeHttp(() => status(401));
    const client = createBotClient({ http: fake.http, auth, now: () => NOW });
    const res = await client.write('ftbot.0', 'POST', '/forceexit', { body: {} });
    expect(res).toMatchObject({ status: 401, sent: false });
    expect(fake.calls.filter((c) => c.url.endsWith('/forceexit'))).toHaveLength(0);
  });

  it('does not replay a write that timed out', async () => {
    const fake = createFakeHttp(() => 'timeout');
    const client = createBotClient({ http: fake.http, auth: setup(), now: () => NOW });
    await expect(client.write('ftbot.0', 'POST', '/forceexit', { body: {} })).rejects.toMatchObject(
      {
        failure: { kind: 'transport', transport: 'timeout' },
      },
    );
    expect(fake.writes()).toHaveLength(1);
  });
});

describe('legacy loginInfo defects, fixed in the new path', () => {
  it('B70: the API prefix is added once whatever the stored apiUrl looks like', () => {
    expect(baseUrlOf({ apiUrl: 'http://bot-a.test:8080' })).toBe('http://bot-a.test:8080/api/v1');
    expect(baseUrlOf({ apiUrl: 'http://bot-a.test:8080/' })).toBe('http://bot-a.test:8080/api/v1');
    expect(baseUrlOf({ apiUrl: 'http://bot-a.test:8080/api/v1' })).toBe(
      'http://bot-a.test:8080/api/v1',
    );
    expect(baseUrlOf({ apiUrl: null })).toBe('/api/v1');
  });

  it('B71: a refresh answer without access token settles (it does not hang forever)', async () => {
    const auth = setup();
    const fake = createFakeHttp((req) =>
      req.url.endsWith('/token/refresh') ? ok({}) : status(401),
    );
    const client = createBotClient({ http: fake.http, auth, now: () => NOW });
    await expect(client.refresh('ftbot.0')).resolves.toBe('transport');
  });
});
