/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures and decoded wire frames */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

import { resolveColumns, useColumns } from '@/composables/useColumns';
import { staleAfterFromCadence, useFreshness, useFreshnessGroup } from '@/composables/useFreshness';
import { matchShortcut, useShortcuts, type Shortcut } from '@/composables/useShortcuts';
import { matchesQuery, modeAllows, useScope } from '@/composables/useScope';
import { defaultColumnIds } from '@/datasource/columns';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { KeyValueStorage } from '@/migration/storage';

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

function initPrefs() {
  const prefs = useFqPrefsStore();
  prefs.init({ storage: memoryStorage(), localHosts: ['localhost'], browserLanguages: ['en'] });
  return prefs;
}

const botRow = (key: string, name: string, mode: string, alerts = 0, strategy = 'S1') => ({
  bot_key: key,
  identity: { name, mode, strategy, exchange: 'hyperliquid' },
  alerts: { count: alerts, max_severity: null },
});

function seedFleet() {
  useFqFleetStore().apply({
    kind: 'snapshot',
    seq: 1,
    ts: 1,
    replace: ['bots'],
    upsert: {
      bots: {
        'local:1': botRow('local:1', 'hippo_live', 'live', 2),
        'local:2': botRow('local:2', 'dynv1_live', 'live', 0, 'Dyn'),
        'local:3': botRow('local:3', 'dry_one', 'dry'),
        'local:4': botRow('local:4', 'replay_run', 'replay'),
      },
    } as any,
    remove: {},
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('useFreshness', () => {
  it('computes the age on the server clock and flags a stale value', () => {
    const conn = useFqConnectionStore();
    conn.setStatus({ ...conn.status, clockSkewMs: 10_000 });
    const asOf = ref<number | null>(Date.now());
    const scope = effectScope();
    const f = scope.run(() => useFreshness(asOf, staleAfterFromCadence(5_000)))!;
    // The server is 10 s ahead of this browser: the value is already 10 s old.
    expect(f.ageMs.value).toBeGreaterThanOrEqual(10_000);
    expect(f.stale.value).toBe(false);
    asOf.value = Date.now() - 6_000;
    expect(f.stale.value).toBe(true);
    expect(f.label.value).not.toBe('');
    scope.stop();
  });

  it('treats a value never observed as stale', () => {
    const scope = effectScope();
    const f = scope.run(() => useFreshness(null, 1_000))!;
    expect(f.stale.value).toBe(true);
    expect(f.ageMs.value).toBeNull();
    expect(f.label.value).toBe('');
    scope.stop();
  });

  it('excludes stale and missing values from a sum and lists them', () => {
    const now = Date.now();
    const scope = effectScope();
    const g = scope.run(() =>
      useFreshnessGroup(
        [
          { key: 'a', asOfMs: now, value: 10 },
          { key: 'b', asOfMs: now - 60_000, value: 100 },
          { key: 'c', asOfMs: now, value: null },
          { key: 'd', asOfMs: null, value: 5 },
          { key: 'e', asOfMs: now, value: 1.5 },
        ],
        30_000,
      ),
    )!;
    expect(g.total.value).toBeCloseTo(11.5, 9);
    expect(g.excluded.value).toEqual(['b', 'c', 'd']);
    expect(g.included.value).toBe(2);
    scope.stop();
  });
});

describe('useScope', () => {
  it('filters by mode: live alone by default, live and dry side by side in "all", never replay', () => {
    initPrefs();
    seedFleet();
    const scope = effectScope();
    const s = scope.run(() => useScope())!;
    expect(s.mode.value).toBe('live');
    expect(s.botKeys.value).toEqual(['local:1', 'local:2']);
    s.mode.value = 'dry';
    expect(s.botKeys.value).toEqual(['local:3']);
    s.mode.value = 'all';
    expect(s.botKeys.value).toEqual(['local:1', 'local:2', 'local:3']);
    scope.stop();
    s.reset();
  });

  it('keeps the mode in the preferences, marked as edited', () => {
    const prefs = initPrefs();
    const scope = effectScope();
    const s = scope.run(() => useScope())!;
    s.mode.value = 'dry';
    s.workspace.value = 'incident';
    expect(prefs.settings.scope).toEqual({ mode: 'dry', workspace: 'incident', excluded: [] });
    expect(prefs.settings.touched).toContain('scope');
    scope.stop();
  });

  it('combines search, groups, tags and "needs attention"', () => {
    const prefs = initPrefs();
    seedFleet();
    prefs.update('fleet', {
      ...prefs.settings.fleet,
      groups: [{ id: 'g', name: 'G', icon: '', collapsed: false, botKeys: ['local:2'] }],
      botCustomTags: { 'local:1': ['night'] },
    });
    const scope = effectScope();
    const s = scope.run(() => useScope())!;
    s.filters.query = 'hippo';
    expect(s.botKeys.value).toEqual(['local:1']);
    s.filters.query = 'dyn';
    expect(s.botKeys.value).toEqual(['local:2']);
    s.filters.query = '';
    s.filters.groups = ['g'];
    expect(s.botKeys.value).toEqual(['local:2']);
    expect(s.scopeRef.value).toEqual({ kind: 'group', id: 'g' });
    s.filters.groups = [];
    s.filters.tags = ['night'];
    expect(s.botKeys.value).toEqual(['local:1']);
    s.filters.tags = [];
    s.filters.attentionOnly = true;
    expect(s.botKeys.value).toEqual(['local:1']);
    s.reset();
    expect(s.botKeys.value).toHaveLength(2);
    scope.stop();
  });

  it('refers to the selected bot, else the fleet', () => {
    initPrefs();
    const scope = effectScope();
    const s = scope.run(() => useScope())!;
    expect(s.scopeRef.value).toEqual({ kind: 'fleet' });
    s.selectBot('local:1');
    expect(s.scopeRef.value).toEqual({ kind: 'bot', botKey: 'local:1' });
    s.selectBot(null);
    expect(s.scopeRef.value).toEqual({ kind: 'fleet' });
    scope.stop();
  });

  it('matches every word of the query on name, key, strategy and exchange', () => {
    const row: any = botRow('local:9', 'Big Fish', 'live');
    expect(matchesQuery(row, 'fish big')).toBe(true);
    expect(matchesQuery(row, 'fish tiny')).toBe(false);
    expect(matchesQuery(row, 'hyperliquid')).toBe(true);
    expect(modeAllows(row, 'dry')).toBe(false);
  });
});

describe('useColumns', () => {
  it('starts from the defaults of the preset and never drops a required column', () => {
    const { shown } = resolveColumns('open', { visible: ['pair'], order: [] }, 2000, false);
    expect(shown.map((c) => c.id)).toEqual(expect.arrayContaining(['bot', 'pair', 'actions']));
    const defaults = resolveColumns('fleet', undefined, 2000, false)
      .shown.map((c) => c.id)
      .sort();
    expect(defaults).toEqual([...new Set([...defaultColumnIds('fleet')])].sort());
  });

  it('hides columns by container width, not window width', () => {
    const wide = resolveColumns('fleet', undefined, 1400, false);
    const narrow = resolveColumns('fleet', undefined, 500, false);
    expect(narrow.shown.length).toBeLessThan(wide.shown.length);
    expect(narrow.shown.map((c) => c.id)).toContain('bot');
    expect(narrow.all.filter((c) => c.hiddenByWidth).length).toBeGreaterThan(0);
  });

  it('applies the saved order, drops unknown ids and appends the rest in registry order', () => {
    const { all } = resolveColumns(
      'open',
      { visible: ['pair'], order: ['pnl_abs', 'ghost', 'pair'] },
      2000,
      false,
    );
    expect(all.slice(0, 2).map((c) => c.id)).toEqual(['pnl_abs', 'pair']);
    expect(all.map((c) => c.id)).not.toContain('ghost');
  });

  it('flags the gateway-only columns as unavailable in direct mode instead of inventing figures', () => {
    const { all } = resolveColumns('fleet', undefined, 2000, true);
    expect(all.find((c) => c.id === 'spark24h')!.unavailable).toBe(true);
    expect(all.find((c) => c.id === 'trades')!.unavailable).toBe(false);
  });

  it('persists choices in the preferences', async () => {
    const prefs = initPrefs();
    const scope = effectScope();
    const width = ref(2000);
    const c = scope.run(() => useColumns('fleet', width))!;
    const before = c.columns.value.map((x) => x.id);
    expect(before).not.toContain('port');
    c.setVisible('port', true);
    await nextTick();
    expect(c.columns.value.map((x) => x.id)).toContain('port');
    expect(prefs.settings.columns.fleet?.visible).toContain('port');
    c.setVisible('bot', false); // required: ignored
    expect(c.columns.value.map((x) => x.id)).toContain('bot');
    const at = c.allColumns.value.findIndex((x) => x.id === 'port');
    c.move('port', -3);
    expect(c.allColumns.value.findIndex((x) => x.id === 'port')).toBe(at - 3);
    expect(prefs.settings.columns.fleet?.order.indexOf('port')).toBe(at - 3);
    c.reset();
    expect(prefs.settings.columns.fleet).toBeUndefined();
    scope.stop();
  });
});

describe('shortcuts', () => {
  const calls: string[] = [];
  const sc = (id: string, keys: string, extra: Partial<Shortcut> = {}): Shortcut => ({
    id,
    keys,
    labelKey: `fq.x.${id}`,
    group: 'general',
    run: () => void calls.push(id),
    ...extra,
  });
  const key = (k: string, extra: Record<string, unknown> = {}) =>
    ({
      key: k,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: document.body,
      ...extra,
    }) as any;

  beforeEach(() => {
    calls.length = 0;
  });

  it('matches a single key and ignores a modifier that was not asked for', () => {
    const list = [sc('theme', 't')];
    expect(matchShortcut(list, key('t'), null).hit?.id).toBe('theme');
    expect(matchShortcut(list, key('t', { ctrlKey: true }), null).hit).toBeNull();
    expect(matchShortcut(list, key('T'), null).hit?.id).toBe('theme');
  });

  it('never acts without a modifier while a field has the focus', () => {
    const input = document.createElement('input');
    const list = [sc('theme', 't'), sc('palette', 'k', { mod: true }), sc('close', 'Escape')];
    expect(matchShortcut(list, key('t', { target: input }), null).hit).toBeNull();
    expect(matchShortcut(list, key('k', { ctrlKey: true, target: input }), null).hit?.id).toBe(
      'palette',
    );
    expect(matchShortcut(list, key('Escape', { target: input }), null).hit?.id).toBe('close');
  });

  it('handles two key sequences like `g d`', () => {
    const list = [sc('go-fleet', 'g d'), sc('go-bot', 'g b')];
    const first = matchShortcut(list, key('g'), null);
    expect(first.hit).toBeNull();
    expect(first.pending).toBe('g');
    expect(matchShortcut(list, key('b'), first.pending).hit?.id).toBe('go-bot');
    expect(matchShortcut(list, key('d'), null).hit).toBeNull();
  });

  it('skips a disabled shortcut', () => {
    const list = [sc('exit', 'x', { enabled: () => false })];
    expect(matchShortcut(list, key('x'), null).hit).toBeNull();
  });

  it('registers on a target, runs the handler and cleans up with its scope', () => {
    const target = new EventTarget() as unknown as Window;
    const scope = effectScope();
    const api = scope.run(() => useShortcuts([sc('theme', 't')], target))!;
    const fire = (k: string) =>
      (target as unknown as EventTarget).dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), {
          key: k,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
          isComposing: false,
        }),
      );
    fire('t');
    expect(calls).toEqual(['theme']);
    expect(api.shortcuts.value.map((s) => s.id)).toContain('theme');
    scope.stop();
    fire('t');
    expect(calls).toEqual(['theme']);
    expect(api.shortcuts.value.map((s) => s.id)).not.toContain('theme');
  });

  it('prevents the default only when the handler did not let the key through', () => {
    const target = new EventTarget() as unknown as Window;
    const scope = effectScope();
    scope.run(() => useShortcuts([sc('pass', 'p', { run: () => false }), sc('eat', 'e')], target));
    const ev = (k: string) =>
      Object.assign(new Event('keydown', { cancelable: true }), {
        key: k,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        isComposing: false,
      });
    const a = ev('p');
    (target as unknown as EventTarget).dispatchEvent(a);
    const b = ev('e');
    (target as unknown as EventTarget).dispatchEvent(b);
    expect(a.defaultPrevented).toBe(false);
    expect(b.defaultPrevented).toBe(true);
    scope.stop();
  });
});
