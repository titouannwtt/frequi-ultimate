import { afterEach, describe, expect, it } from 'vitest';

import { applyImportData, collectExportData, FQU2_KEYS } from '@/composables/useConfigExport';
import { applyDisplayPrefs } from '@/composables/useDisplayPrefs';
import { mapClosedTrade } from '@/datasource/direct/mappers';
import { prefersReducedMotion } from '@/utils/motion';

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    map: m,
  };
};

describe('config export v3', () => {
  it('carries the new device options and every fqu2 key that exists', () => {
    expect(FQU2_KEYS).toEqual(expect.arrayContaining(['fqu2.cvd', 'fqu2.motion', 'fqu2.settings']));
    const s = store({ 'fqu2.cvd': 'true', 'fqu2.motion': '"reduce"' });
    expect(collectExportData(false, s)).toEqual({ 'fqu2.cvd': 'true', 'fqu2.motion': '"reduce"' });
  });

  it('never exports the session or the device id of the gateway, only its address and mode', () => {
    const s = store({
      'fqu2.gateway': JSON.stringify({
        url: 'https://gw.test',
        mode: 'auto',
        session: 'SECRET',
        deviceId: 'dev',
      }),
    });
    const out = collectExportData(false, s);
    expect(JSON.parse(out['fqu2.gateway'])).toEqual({ url: 'https://gw.test', mode: 'auto' });
    expect(out['fqu2.gateway']).not.toContain('SECRET');
    // Unreadable value: left out, not copied.
    expect(
      collectExportData(false, store({ 'fqu2.gateway': '{nope' }))['fqu2.gateway'],
    ).toBeUndefined();
  });

  it('only exports the logins when asked for', () => {
    const s = store({ ftAuthLoginInfo: '{"ftbot.0":{}}' });
    expect(Object.keys(collectExportData(false, s))).not.toContain('ftAuthLoginInfo');
    expect(Object.keys(collectExportData(true, s))).toContain('ftAuthLoginInfo');
  });

  it('merges the gateway address into what the device has and ignores unknown keys', () => {
    const s = store({ 'fqu2.gateway': JSON.stringify({ session: 'keep', url: 'old' }) });
    const n = applyImportData(
      {
        'fqu2.gateway': JSON.stringify({
          url: 'https://new.test',
          mode: 'direct',
          session: 'EVIL',
        }),
        'fqu2.density': '"compact"',
        'unrelated.key': 'x',
      },
      s,
    );
    expect(n).toBe(2);
    expect(JSON.parse(s.map.get('fqu2.gateway')!)).toEqual({
      session: 'keep',
      url: 'https://new.test',
      mode: 'direct',
    });
    expect(s.map.get('fqu2.density')).toBe('"compact"');
    expect(s.map.has('unrelated.key')).toBe(false);
  });
});

describe('display options', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-cvd');
    document.documentElement.removeAttribute('data-motion');
  });

  it('writes and removes the two attributes of <html>', () => {
    const root = document.documentElement;
    applyDisplayPrefs({ cvd: true, motion: 'reduce' });
    expect(root.getAttribute('data-cvd')).toBe('1');
    expect(root.getAttribute('data-motion')).toBe('reduce');
    expect(prefersReducedMotion()).toBe(true);
    applyDisplayPrefs({ cvd: false, motion: 'system' });
    expect(root.hasAttribute('data-cvd')).toBe(false);
    expect(root.hasAttribute('data-motion')).toBe(false);
  });
});

describe('closed trade of the direct source', () => {
  const closed = {
    trade_id: 4,
    pair: 'ARB/USDC:USDC',
    is_short: false,
    amount: 1,
    open_rate: 1,
    stake_amount: 10,
    open_timestamp: 1_700_000_000_000,
    close_timestamp: 1_700_000_360_000,
    profit_abs: 1,
    profit_ratio: 0.1,
    exit_reason: 'roi',
  };

  it('keeps the depth of the ladder and leaves it unknown instead of a zero', () => {
    const known = mapClosedTrade(
      { ...closed, nr_of_successful_entries: 3 } as never,
      'ftbot.0' as never,
      'live',
    );
    expect(known.dca_entries).toBe(3);
    const unknown = mapClosedTrade(closed as never, 'ftbot.0' as never, 'live');
    expect(unknown.dca_entries).toBeNull();
  });
});
