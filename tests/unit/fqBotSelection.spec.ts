import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { makeBot } from '../../src/components/fq/fixtures';
import {
  figuresScope,
  isExactly,
  selectedAmong,
  selectionLabel,
  withBotToggled,
  withSelection,
} from '../../src/components/fq/lib/botSelection';
import { useScope } from '../../src/composables/useScope';
import { useFqFleetStore } from '../../src/datasource/stores/fleet';
import { useFqPrefsStore } from '../../src/datasource/stores/prefs';
import { scopeKey, type StateUpdate } from '../../src/datasource/types';
import { loadSettings } from '../../src/migration/storage';

const snapshot = (rows: Record<string, unknown>, seq = 1): StateUpdate => ({
  kind: 'snapshot',
  seq,
  ts: 1,
  replace: ['bots'],
  upsert: { bots: rows } as StateUpdate['upsert'],
  remove: {},
});

describe('the pure rules of the bot selection', () => {
  it('reads the ticked bots as the bots of the mode minus the exceptions', () => {
    expect(selectedAmong(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c']);
    expect(selectedAmong(['a', 'b'], new Set())).toEqual(['a', 'b']);
    expect(selectionLabel(2, 5)).toBe('2/5');
  });

  it('stores what is unticked, leaves the bots of another mode alone and forgets unknown keys', () => {
    // Live mode shows a and b; d (dry) was unticked earlier; gone no longer exists
    const out = withSelection(['d', 'gone'], ['a', 'b'], new Set(['a']), new Set(['a', 'b', 'd']));
    expect(out.sort()).toEqual(['b', 'd']);
    // Without the fleet loaded nothing is forgotten (the list is just empty yet)
    expect(withSelection(['d', 'gone'], ['a', 'b'], new Set(['a', 'b'])).sort()).toEqual([
      'd',
      'gone',
    ]);
  });

  it('toggles one bot', () => {
    expect(withBotToggled([], 'a', false)).toEqual(['a']);
    expect(withBotToggled(['a'], 'a', true)).toEqual([]);
    expect(withBotToggled(['a'], 'a', false)).toEqual(['a']);
  });

  it('recognises a group that is exactly what is ticked', () => {
    expect(isExactly(['a', 'b'], ['b', 'a', 'x'], ['a', 'b', 'c'])).toBe(true);
    expect(isExactly(['a'], ['a', 'b'], ['a', 'b'])).toBe(false);
    expect(isExactly([], ['x'], ['a'])).toBe(false);
  });

  it('asks the whole mode when every bot of it is ticked, the list otherwise, one mode at a time', () => {
    const modes: Record<string, 'live' | 'dry'> = { a: 'live', b: 'live', c: 'live', d: 'dry' };
    const modeOf = (k: string) => modes[k] ?? null;
    const ref = { kind: 'bots' as const, botKeys: ['a', 'b', 'c', 'd'] };
    // All live bots are in: the fleet of the mode, and the dry bot is not mixed in
    expect(figuresScope(ref, 'live', modeOf, ['a', 'b', 'c'])).toEqual({ kind: 'fleet' });
    expect(figuresScope(ref, 'dry', modeOf, ['d'])).toEqual({ kind: 'fleet' });
    // One live bot unticked: explicit list, live only
    expect(
      figuresScope({ kind: 'bots', botKeys: ['a', 'c', 'd'] }, 'live', modeOf, ['a', 'b', 'c']),
    ).toEqual({ kind: 'bots', botKeys: ['a', 'c'] });
    // Nothing of that mode is ticked: an empty list, not the fleet
    expect(figuresScope({ kind: 'bots', botKeys: ['a'] }, 'dry', modeOf, ['d'])).toEqual({
      kind: 'bots',
      botKeys: [],
    });
    // Other scopes pass through
    expect(figuresScope({ kind: 'fleet' }, 'live', modeOf, ['a'])).toEqual({ kind: 'fleet' });
  });

  it('keys a list of bots by its members, whatever their order', () => {
    expect(scopeKey({ kind: 'bots', botKeys: ['b', 'a'] })).toBe(
      scopeKey({ kind: 'bots', botKeys: ['a', 'b'] }),
    );
    expect(scopeKey({ kind: 'bots', botKeys: ['a'] })).not.toBe(scopeKey({ kind: 'fleet' }));
  });
});

describe('useScope: the bots ticked', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  const bots = {
    live1: makeBot(1, { name: 'alpha', mode: 'live' }),
    live2: makeBot(2, { name: 'beta', mode: 'live' }),
    live3: makeBot(3, { name: 'gamma', mode: 'live' }),
    dry1: makeBot(4, { name: 'delta', mode: 'dry' }),
  };
  const key = (b: { bot_key: string }) => b.bot_key;

  function setup() {
    setActivePinia(createPinia());
    const prefs = useFqPrefsStore();
    prefs.init({ storage });
    const fleet = useFqFleetStore();
    fleet.apply(snapshot(Object.fromEntries(Object.values(bots).map((b) => [b.bot_key, b]))));
    return { prefs, fleet };
  }

  beforeEach(() => store.clear());

  it('ticks every bot of the mode by default and asks the whole fleet', () => {
    setup();
    const scope = useScope();
    expect(scope.mode.value).toBe('live');
    expect(scope.pickable.value.map(key).sort()).toEqual(
      [bots.live1, bots.live2, bots.live3].map(key).sort(),
    );
    expect(scope.selectedKeys.value).toHaveLength(3);
    expect(scope.narrowed.value).toBe(false);
    expect(scope.bots.value).toHaveLength(3);
    expect(scope.fleetScopeRef.value).toEqual({ kind: 'fleet' });
  });

  it('unticking a bot narrows the table, the positions and the scope sent to the source', () => {
    setup();
    const scope = useScope();
    scope.toggleBot(bots.live2.bot_key, false);
    expect(scope.narrowed.value).toBe(true);
    expect(scope.bots.value.map(key)).not.toContain(bots.live2.bot_key);
    expect(scope.botKeys.value).toHaveLength(2);
    expect(scope.fleetScopeRef.value).toEqual({
      kind: 'bots',
      botKeys: [bots.live1.bot_key, bots.live3.bot_key],
    });
    // Live figures are asked for the ticked live bots only
    expect(scope.figuresScopeRef('live')).toEqual(scope.fleetScopeRef.value);
    // The Journal has its own bot filter: the selection does not narrow it silently
    const journal = useScope({ selection: false });
    expect(journal.bots.value).toHaveLength(3);
    expect(journal.fleetScopeRef.value).toEqual({ kind: 'fleet' });
  });

  it('keeps the selection in the preferences, as the exceptions', () => {
    const { prefs } = setup();
    const scope = useScope();
    scope.toggleBot(bots.live1.bot_key, false);
    expect(prefs.settings.scope.excluded).toEqual([bots.live1.bot_key]);
    // A reload reads the same document
    const reloaded = loadSettings(storage);
    expect(reloaded?.scope.excluded).toEqual([bots.live1.bot_key]);
    setup();
    expect(useScope().selectedKeys.value).toHaveLength(2);
  });

  it('ticks a bot that appears after the selection was made', () => {
    const { fleet } = setup();
    const scope = useScope();
    scope.toggleBot(bots.live1.bot_key, false);
    const fresh = makeBot(7, { name: 'newcomer', mode: 'live' });
    fleet.apply(snapshot({ [fresh.bot_key]: fresh }, 2));
    fleet.apply({
      kind: 'delta',
      seq: 3,
      ts: 2,
      replace: [],
      upsert: { bots: { [fresh.bot_key]: fresh } } as StateUpdate['upsert'],
      remove: {},
    });
    expect(scope.selectedKeys.value).toContain(fresh.bot_key);
    expect(scope.selectedKeys.value).not.toContain(bots.live1.bot_key);
  });

  it('sets a whole selection (none, all, a group) without touching the other mode', () => {
    const { prefs } = setup();
    const scope = useScope();
    scope.selectNone();
    expect(scope.selectedKeys.value).toEqual([]);
    expect(scope.fleetScopeRef.value).toEqual({ kind: 'bots', botKeys: [] });
    expect(scope.bots.value).toEqual([]);
    scope.setSelected([bots.live3.bot_key]);
    expect(scope.selectedKeys.value).toEqual([bots.live3.bot_key]);
    // Dry mode: its bot was never unticked, and the live exceptions stay for later
    scope.mode.value = 'dry';
    expect(scope.selectedKeys.value).toEqual([bots.dry1.bot_key]);
    expect(prefs.settings.scope.excluded).toHaveLength(2);
    scope.mode.value = 'live';
    scope.selectAll();
    expect(prefs.settings.scope.excluded).toEqual([]);
    expect(scope.narrowed.value).toBe(false);
  });

  it('never mixes live and dry in the figures of "All"', () => {
    setup();
    const scope = useScope();
    scope.mode.value = 'all';
    scope.toggleBot(bots.live1.bot_key, false);
    // The detail of the page covers both modes (one block each), the curves one mode at a time
    expect(scope.fleetScopeRef.value.kind).toBe('bots');
    expect(scope.figuresScopeRef('live')).toEqual({
      kind: 'bots',
      botKeys: [bots.live2.bot_key, bots.live3.bot_key],
    });
    // Every dry bot is ticked: the whole dry fleet
    expect(scope.figuresScopeRef('dry')).toEqual({ kind: 'fleet' });
  });

  it('keeps a group filter inside the selection', () => {
    const { prefs } = setup();
    prefs.update('fleet', {
      ...prefs.settings.fleet,
      groups: [
        {
          id: 'g1',
          name: 'G1',
          icon: '',
          collapsed: false,
          botKeys: [bots.live1.bot_key, bots.live2.bot_key],
        },
      ],
    });
    const scope = useScope();
    scope.filters.groups = ['g1'];
    expect(scope.fleetScopeRef.value).toEqual({ kind: 'group', id: 'g1' });
    scope.toggleBot(bots.live2.bot_key, false);
    expect(scope.fleetScopeRef.value).toEqual({ kind: 'bots', botKeys: [bots.live1.bot_key] });
    scope.reset();
  });
});
