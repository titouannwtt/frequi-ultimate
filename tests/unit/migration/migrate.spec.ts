/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures and decoded wire frames */
import { describe, expect, it } from 'vitest';

import { IMPORTED_KEYS, importLegacy, runMigration, SKIPPED_KEYS } from '@/migration/migrate';
import { GATEWAY_KEY, MIGRATION_KEY, SETTINGS_KEY } from '@/migration/schema';
import type { KeyValueStorage } from '@/migration/storage';

/**
 * Fixtures shaped like the real `localStorage` of the old UI (keys and layouts of the stores that
 * write them), with made up bots, tokens and ports.
 */
const LOGINS = {
  'ftbot.0': {
    botName: 'hippo_multi',
    apiUrl: 'http://localhost:9400',
    username: 'u',
    accessToken: 'access-0',
    refreshToken: 'refresh-0',
    autoRefresh: true,
    sortId: 0,
    createdAt: 1_700_000_000_000,
  },
  'ftbot.1': {
    botName: 'dry_one',
    apiUrl: 'http://127.0.0.1:9056',
    username: 'u',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    autoRefresh: true,
    sortId: 1,
  },
  'ftbot.2': {
    botName: 'remote',
    apiUrl: 'https://bots.example.org:8443',
    username: 'u',
    accessToken: 'access-2',
    refreshToken: 'refresh-2',
    autoRefresh: true,
  },
};

const COMPARISON = {
  visibleColumnIds: ['botName', 'status', 'openProfit', 'maxDrawdown', 'stakeAmount', 'unknownCol'],
  columnOrder: ['status', 'botName', 'openProfit'],
  botOrder: ['ftbot.1', 'ftbot.0', 'ftbot.9'],
  botGroups: [
    { id: 'g1', name: 'Core', icon: 'star', collapsed: true, botIds: ['ftbot.0', 'ftbot.1'] },
  ],
  customTags: [{ id: 't1', name: 'night', color: '#ff0000' }],
  botCustomTags: { 'ftbot.0': ['t1'], 'ftbot.7': ['t1'] },
  tagOrder: ['status', 'port'],
  botTagVisibility: { status: true, port: false },
  botFilters: {
    status: { live: true, dry: false, offline: true },
    exchanges: {},
    currencies: {},
    tradingMode: {},
    customTags: {},
  },
  summaryCurrency: 'USD',
  alertConfig: {
    global: {
      nearLiquidation: { enabled: false, threshold: 5 },
      not_an_alert: { enabled: true },
    },
    perBotEnabled: { 'ftbot.0': false },
  },
  notificationTypes: { liquidation: true },
  browserNotificationsEnabled: true,
};

function legacyEntries(): Record<string, string> {
  return {
    ftAuthLoginInfo: JSON.stringify(LOGINS),
    ftSelectedBot: 'ftbot.1',
    ftBotNames: JSON.stringify({ 'ftbot.0': 'hippo_multi', 'ftbot.1': 'dry_one' }),
    ftBotComparison: JSON.stringify(COMPARISON),
    ftUISettings: JSON.stringify({
      openTradesInTitle: 'showPill',
      backgroundSync: false,
      useHeikinAshiCandles: true,
      showMarkArea: false,
      chartLabelSide: 'left',
      chartDefaultCandleCount: 400,
      confirmDialog: false,
    }),
    ftUIColorSettings: JSON.stringify({ colorPreference: 'redUp' }),
    ft_locale: 'fr',
    enhancedOpenTradeColumns: JSON.stringify(['botName', 'pair', 'profit_pct', 'dca_info', 'nope']),
    enhancedOpenTradeColumnOrder: JSON.stringify(['pair', 'botName']),
    enhancedClosedTradeColumns: JSON.stringify(['pair', 'close_rate', 'exit_reason']),
    ftPlotConfig: JSON.stringify({
      customPlotConfigs: { mine: { main_plot: {} } },
      plotConfigName: 'mine',
    }),
    ftLayoutSettings: '{"x":1}',
  };
}

interface Spy extends KeyValueStorage {
  data: Map<string, string>;
  writes: string[];
}

function makeStorage(initial: Record<string, string>): Spy {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      writes.push(k);
      data.set(k, v);
    },
  };
}

const env = (storage: KeyValueStorage, now = 1_000) => ({
  storage,
  now: () => now,
  localHosts: ['localhost', '127.0.0.1'],
  selfOrigin: 'http://localhost:9400',
  browserLanguages: ['de-DE', 'fr-FR'],
});

describe('legacy key import', () => {
  it('maps ftbot.N aliases to bot_key everywhere', () => {
    const { sections, summary } = importLegacy(env(makeStorage(legacyEntries())));
    expect(sections.selectedBot).toBe('local:9056');
    expect(sections.botNames).toEqual({ 'local:9400': 'hippo_multi', 'local:9056': 'dry_one' });
    const fleet = sections.fleet as { botOrder: string[]; groups: any[]; botCustomTags: any };
    expect(fleet.botOrder).toEqual(['local:9056', 'local:9400']);
    expect(fleet.groups[0].botKeys).toEqual(['local:9400', 'local:9056']);
    expect(fleet.botCustomTags).toEqual({ 'local:9400': ['t1'] });
    // ftbot.7 and ftbot.9 are not logged in on this device.
    expect(summary.unmappedBots).toEqual(expect.arrayContaining(['ftbot.9', 'ftbot.7']));
  });

  it('keeps known alert types and drops unknown ones', () => {
    const { sections } = importLegacy(env(makeStorage(legacyEntries())));
    const rules = (sections.alerts as any).rules;
    expect(Object.keys(rules.global)).toEqual(['nearLiquidation']);
    expect(rules.global.nearLiquidation).toEqual({ enabled: false, threshold: 5, forS: null });
    expect(rules.perBotEnabled).toEqual({ 'local:9400': false });
  });

  it('translates column ids and reports the dropped ones', () => {
    const { sections, summary } = importLegacy(env(makeStorage(legacyEntries())));
    const cols = sections.columns as any;
    expect(cols.fleet.visible).toEqual(
      expect.arrayContaining(['bot', 'state', 'latent', 'drawdown']),
    );
    expect(cols.fleet.visible).not.toContain('unknownCol');
    expect(cols.open.visible).toEqual(expect.arrayContaining(['bot', 'pair', 'pnl_pct', 'dca']));
    expect(cols.open.order.slice(0, 2)).toEqual(['pair', 'bot']);
    expect(cols.closed.visible).toEqual(
      expect.arrayContaining(['pair', 'exit_price', 'exit_reason']),
    );
    expect(summary.droppedColumns).toEqual(
      expect.arrayContaining(['nope', 'unknownCol', 'stakeAmount']),
    );
  });

  it('imports display settings, the forced confirmation flag and the locale', () => {
    const { sections, summary } = importLegacy(env(makeStorage(legacyEntries())));
    expect((sections.ui as any).chartLabelSide).toBe('left');
    expect((sections.ui as any).chartDefaultCandleCount).toBe(400);
    expect(sections.colorPreference).toBe('redUp');
    expect(sections.locale).toBe('fr');
    expect(summary.forcedConfirmation).toBe(true);
    expect((sections.plot as any).plotConfigName).toBe('mine');
  });

  it('falls back to English for a removed language and says so', () => {
    const entries = { ...legacyEntries(), ft_locale: 'ru' };
    const { sections, summary } = importLegacy(env(makeStorage(entries)));
    expect(sections.locale).toBe('en');
    expect(summary.localeFallback).toBe(true);
  });

  it('records which known keys were imported and which were deliberately skipped', () => {
    const { summary } = importLegacy(env(makeStorage(legacyEntries())));
    expect(summary.imported).toContain('ftAuthLoginInfo');
    expect(summary.skipped).toEqual(['ftLayoutSettings']);
    for (const k of summary.imported) expect(IMPORTED_KEYS as readonly string[]).toContain(k);
    for (const k of summary.skipped) expect(SKIPPED_KEYS as readonly string[]).toContain(k);
  });

  it('survives corrupt values without throwing', () => {
    const entries = {
      ftAuthLoginInfo: '{not json',
      ftBotComparison: '[1,2]',
      ftUISettings: '"text"',
      ft_locale: '',
    };
    expect(() => importLegacy(env(makeStorage(entries)))).not.toThrow();
  });
});

describe('runMigration', () => {
  it('never writes, changes or deletes an old key', () => {
    const storage = makeStorage(legacyEntries());
    const before = new Map(storage.data);
    runMigration(env(storage));
    for (const [k, v] of before) expect(storage.data.get(k)).toBe(v);
    expect(storage.data.size).toBe(before.size + 2);
    expect(storage.writes.every((k) => k.startsWith('fqu2.'))).toBe(true);
    expect(storage.writes).toEqual(expect.arrayContaining([SETTINGS_KEY, MIGRATION_KEY]));
  });

  it('is idempotent: a second run writes nothing', () => {
    const storage = makeStorage(legacyEntries());
    const first = runMigration(env(storage));
    expect(first.status).toBe('migrated');
    const writes = storage.writes.length;
    const second = runMigration(env(storage, 5_000));
    expect(second.status).toBe('unchanged');
    expect(storage.writes.length).toBe(writes);
    expect(second.settings).toEqual(first.settings);
  });

  it('is not triggered again by a token refresh of ftAuthLoginInfo', () => {
    const storage = makeStorage(legacyEntries());
    runMigration(env(storage));
    const writes = storage.writes.length;
    const renewed = structuredClone(LOGINS);
    renewed['ftbot.0'].accessToken = 'renewed-access';
    renewed['ftbot.0'].refreshToken = 'renewed-refresh';
    storage.data.set('ftAuthLoginInfo', JSON.stringify(renewed));
    expect(runMigration(env(storage, 9_000)).status).toBe('unchanged');
    expect(storage.writes.length).toBe(writes);
  });

  it('replays when a source key really changed', () => {
    const storage = makeStorage(legacyEntries());
    runMigration(env(storage));
    storage.data.set('ft_locale', 'en');
    const out = runMigration(env(storage, 9_000));
    expect(out.status).toBe('migrated');
    expect(out.settings.locale).toBe('en');
  });

  it('never overwrites a section edited in the new UI', () => {
    const storage = makeStorage(legacyEntries());
    const first = runMigration(env(storage));
    const edited = { ...first.settings, locale: 'en' as const, touched: ['locale'] };
    storage.data.set(SETTINGS_KEY, JSON.stringify(edited));
    storage.data.set('ft_locale', 'fr');
    storage.data.set('ftUIColorSettings', JSON.stringify({ colorPreference: 'greenUp' }));
    const out = runMigration(env(storage, 9_000));
    expect(out.settings.locale).toBe('en');
    expect(out.settings.colorPreference).toBe('greenUp');
  });

  it('starts fresh on an empty storage and picks the browser language', () => {
    const storage = makeStorage({});
    const out = runMigration(env(storage));
    expect(out.status).toBe('fresh');
    expect(out.settings.locale).toBe('fr');
  });

  it('does not touch the gateway preferences', () => {
    const storage = makeStorage(legacyEntries());
    runMigration(env(storage));
    expect(storage.data.has(GATEWAY_KEY)).toBe(false);
  });

  it('rolls back by simply ignoring the new keys: the old ones are intact', () => {
    const storage = makeStorage(legacyEntries());
    const snapshot = JSON.stringify([...storage.data].sort());
    runMigration(env(storage));
    for (const k of [SETTINGS_KEY, MIGRATION_KEY]) storage.data.delete(k);
    expect(JSON.stringify([...storage.data].sort())).toBe(snapshot);
  });
});
