import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ logins: {} as Record<string, unknown> }));
// The stored logins are a module-level `useStorage` ref: the test owns them directly.
vi.mock('@/composables/loginInfo', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readLoginInfos: () => mocked.logins,
}));
// The legacy polling is not under test: only that it is asked for on legacy pages.
vi.mock('@/stores/ftbotwrapper', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  initBots: vi.fn(),
}));

// The pages are not under test, only where the paths lead: stub them (they are heavy).
vi.mock('@/views/fq/FleetPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/BotPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/PlaceholderPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/ChartsPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/JournalPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/SettingsPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/tools/DiagnosticPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/tools/ReconciliationPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/tools/RiskToolPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/tools/LogsPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/tools/ReplayPage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/tools/VolumePage.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/fq/ToolsIndex.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/TradeJournalView.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/LogView.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/StrategyDevView.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/BacktestingView.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/DownloadDataView.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/PairlistConfigView.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/SettingsViewCustom.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/LoginView.vue', () => ({ default: { render: () => null } }));
vi.mock('@/views/Error404View.vue', () => ({ default: { render: () => null } }));

import router from '@/router';
import { carryQuery, LEGACY_REDIRECTS, resolveBotParam, TOOL_PATHS } from '@/router/legacy';

const lookup = {
  logins: {
    'ftbot.0': { botName: 'hippo', apiUrl: 'http://127.0.0.1:8080' },
    'ftbot.1': { botName: 'dyn', apiUrl: 'https://bots.example.org:9001' },
  },
  fleetNames: { 'local:8080': 'hippo' },
  aliases: { 'ftbot.5': 'local:9005' },
  selfOrigin: 'http://localhost:9400',
  localHosts: ['localhost', '127.0.0.1'],
};

describe('resolveBotParam', () => {
  it('keeps a canonical key, whatever the case of the host', () => {
    expect(resolveBotParam('local:8080', lookup)).toBe('local:8080');
    expect(resolveBotParam('url:https://bots.example.org:9001', lookup)).toBe(
      'url:https://bots.example.org:9001',
    );
  });

  it('resolves a per-device alias, first from the gateway, then from the stored logins', () => {
    expect(resolveBotParam('ftbot.5', lookup)).toBe('local:9005');
    expect(resolveBotParam('ftbot.0', lookup)).toBe('local:8080');
    expect(resolveBotParam('ftbot.1', lookup)).toBe('url:https://bots.example.org:9001');
  });

  it('resolves a bot name, the fleet first', () => {
    expect(resolveBotParam('hippo', lookup)).toBe('local:8080');
    expect(resolveBotParam('dyn', lookup)).toBe('url:https://bots.example.org:9001');
  });

  it('answers null for anything unknown or empty', () => {
    expect(resolveBotParam('nobody', lookup)).toBeNull();
    expect(resolveBotParam('', lookup)).toBeNull();
    expect(resolveBotParam(undefined, lookup)).toBeNull();
    expect(resolveBotParam(['a'], lookup)).toBeNull();
  });
});

describe('carryQuery', () => {
  it('keeps the query except the dropped keys', () => {
    expect(carryQuery({ bot: 'x', q: 'btc', highlight: '3' }, ['bot'])).toEqual({
      q: 'btc',
      highlight: '3',
    });
  });
});

describe('the table of old paths', () => {
  const OLD_PATHS = [
    '/',
    '/dashboard',
    '/trade',
    '/open_trades',
    '/trade_history',
    '/balance',
    '/pairlist',
    '/logs',
    '/backtest',
    '/download_data',
    '/pairlist_config',
    '/strategy-dev',
    '/settings',
    '/login',
  ];

  beforeEach(() => {
    setActivePinia(createPinia());
    mocked.logins = { 'ftbot.0': { botName: 'hippo', apiUrl: 'http://127.0.0.1:8080' } };
  });

  it('has a route for every old path: none ends in the 404 page', () => {
    for (const path of OLD_PATHS) {
      const resolved = router.resolve(path);
      expect(resolved.name, path).not.toBe('404');
    }
  });

  it('redirects every old path that moved to its new home', async () => {
    for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) {
      await router.push(from);
      expect(router.currentRoute.value.path, from).toBe(to);
    }
  });

  it('sends /trade?bot=<name> to the page of that bot, query kept', async () => {
    await router.push('/trade?bot=ftbot.0&pair=BTC');
    expect(router.currentRoute.value.path).toBe('/bot/local:8080');
    expect(router.currentRoute.value.query).toEqual({ pair: 'BTC' });
  });

  it('turns the old Balance and Pairlist pages into tabs of the Bot page', async () => {
    await router.push('/balance?bot=ftbot.0');
    expect(router.currentRoute.value.fullPath).toContain('/bot/local:8080');
    expect(router.currentRoute.value.query.tab).toBe('performance');
    await router.push('/pairlist?bot=ftbot.0');
    expect(router.currentRoute.value.query.tab).toBe('pairs');
  });

  it('opens the positions view of the Fleet for the old open trades page', async () => {
    await router.push('/open_trades');
    expect(router.currentRoute.value.path).toBe('/dashboard');
    expect(router.currentRoute.value.query.view).toBe('positions');
  });

  it('points every tool to a /tools path', () => {
    for (const p of Object.values(TOOL_PATHS)) expect(p.startsWith('/tools/')).toBe(true);
  });

  it('gives every tool its own page, and only the legacy ones start the legacy polling', () => {
    const legacy = new Set([
      'strategyDev',
      'backtest',
      'downloadData',
      'pairlistConfig',
      'diagnostic',
      'replay',
      'volume',
    ]);
    for (const [id, path] of Object.entries(TOOL_PATHS)) {
      const r = router.resolve(path);
      expect(r.name, path).not.toBe('tools-placeholder');
      expect(r.name, path).not.toBe('404');
      expect(Boolean(r.meta.legacy), id).toBe(legacy.has(id));
    }
  });

  it('serves Settings at /settings and, open to anonymous visitors, at /login', () => {
    expect(router.resolve('/settings').meta.allowAnonymous).toBeFalsy();
    expect(router.resolve('/login').meta.allowAnonymous).toBe(true);
    expect(router.resolve('/charts').name).toBe('charts');
    expect(router.resolve('/journal').name).toBe('journal');
  });

  it('forwards to the login page when no bot is known', async () => {
    mocked.logins = {};
    await router.push('/dashboard');
    expect(router.currentRoute.value.path).toBe('/login');
    expect(router.currentRoute.value.query.redirect).toBe('/dashboard');
  });
});
