import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryCache } from '@/datasource/cache';
import { createMemoryAuthStore } from '@/datasource/direct/auth';
import { createRuntime, type Runtime } from '@/datasource/runtime';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import { GATEWAY_PROTOCOL_VERSION } from '@/gateway/types.gen';

import { createFakeHttp, fakeWsFactory, makeJwt, ok, status } from './helpers';

const NOW = Date.now();

function entries() {
  return [
    {
      id: 'ftbot.0',
      botName: 'hippo_live',
      apiUrl: 'http://live-bot.test:9400',
      accessToken: makeJwt(NOW + 3_600_000),
      refreshToken: 'r0',
    },
  ];
}

/** Fake network: a bot at live-bot.test, and a gateway at ui.test:9399 that is up or not. */
function network(gatewayUp: () => boolean) {
  return createFakeHttp((req) => {
    const url = new URL(req.url);
    if (url.host === 'ui.test:9399') {
      if (!gatewayUp()) return 'network';
      if (url.pathname === '/gw/v1/hello') {
        return ok({ version: 't', protocol: GATEWAY_PROTOCOL_VERSION, auth_modes: ['session'] });
      }
      return status(404);
    }
    const path = url.pathname.replace('/api/v1', '');
    switch (path) {
      case '/show_config':
        return ok({
          bot_name: 'hippo_live',
          dry_run: false,
          trading_mode: 'futures',
          stake_currency: 'USDC',
          state: 'running',
        });
      case '/status':
        return ok([]);
      default:
        return status(404);
    }
  });
}

let runtime: Runtime | null = null;

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
});

afterEach(() => {
  runtime?.stop();
  runtime = null;
});

describe('data layer runtime (fake network only)', () => {
  it('falls back to the direct mode, fills the stores and never writes', async () => {
    const fake = network(() => false);
    const cache = createMemoryCache();
    runtime = createRuntime({
      auth: createMemoryAuthStore(entries()),
      http: fake.http,
      wsFactory: fakeWsFactory(),
      cache,
      protocol: 'https:',
      hostname: 'ui.test',
      selfOrigin: 'https://ui.test',
      localHosts: ['live-bot.test'],
    });
    await runtime.start();
    const conn = useFqConnectionStore();
    expect(runtime.manager.kind.value).toBe('direct');
    expect(conn.kind).toBe('direct');
    expect(conn.lastSwitch).toMatchObject({ from: null, to: 'direct', reason: 'probe_failed' });
    await vi.waitFor(() => expect(useFqFleetStore().list).toHaveLength(1), { timeout: 3_000 });
    expect(useFqFleetStore().bots['local:9400']!.identity.name).toBe('hippo_live');
    expect(fake.writes()).toEqual([]);
    // The preferences were initialised from the legacy storage (here: empty).
    expect(useFqPrefsStore().ready).toBe(true);
  });

  it('uses the gateway when it answers `hello`, with the probe on the default port', async () => {
    const fake = network(() => true);
    runtime = createRuntime({
      auth: createMemoryAuthStore(entries()),
      http: fake.http,
      wsFactory: fakeWsFactory(),
      protocol: 'https:',
      hostname: 'ui.test',
      selfOrigin: 'https://ui.test',
      localHosts: ['live-bot.test'],
    });
    // The session bootstrap is not served by this fake, so the gateway cannot start: the app must
    // stay usable on the direct mode rather than show nothing.
    await runtime.start();
    expect(fake.calls.some((c) => c.url === 'https://ui.test:9399/gw/v1/hello')).toBe(true);
    expect(runtime.manager.kind.value).toBe('direct');
  });

  it('stops everything', async () => {
    const fake = network(() => false);
    runtime = createRuntime({
      auth: createMemoryAuthStore(entries()),
      http: fake.http,
      wsFactory: fakeWsFactory(),
      protocol: 'https:',
      hostname: 'ui.test',
      selfOrigin: 'https://ui.test',
      localHosts: ['live-bot.test'],
    });
    await runtime.start();
    runtime.stop();
    const before = fake.calls.length;
    await new Promise((r) => setTimeout(r, 1_300));
    expect(fake.calls.length).toBe(before);
    runtime = null;
  });
});

describe('credentials shared with the legacy pages', () => {
  it('reads ftAuthLoginInfo live and writes back tokens only', async () => {
    const legacy = {
      'ftbot.0': {
        botName: 'one',
        apiUrl: 'http://one.test:9400',
        username: 'u',
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        autoRefresh: true,
        sortId: 1,
        createdAt: 5,
      },
      'ftbot.1': {
        botName: 'two',
        apiUrl: '',
        accessToken: 'a',
        refreshToken: 'b',
        autoRefresh: true,
        sortId: 0,
      },
    };
    localStorage.setItem('ftAuthLoginInfo', JSON.stringify(legacy));
    vi.resetModules();
    const { createLoginInfoAuthStore } = await import('@/datasource/direct/loginInfoStore');
    const store = createLoginInfoAuthStore();
    const list = store.entries();
    expect(list.map((e) => e.id)).toEqual(['ftbot.1', 'ftbot.0']);
    expect(list[0]!.apiUrl).toBeNull();
    store.patch('ftbot.0', { accessToken: 'new-access' });
    store.patch('ftbot.9', { accessToken: 'ghost' });
    const after = store.entries();
    expect(after.find((e) => e.id === 'ftbot.0')).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'old-refresh',
      botName: 'one',
      sortId: 1,
      createdAt: 5,
    });
    expect(after.find((e) => e.id === 'ftbot.9')).toBeUndefined();
  });
});
