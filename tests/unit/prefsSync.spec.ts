import { describe, expect, it } from 'vitest';

import {
  buildDoc,
  mergeSections,
  PrefsSync,
  sectionHash,
  SYNC_KEY,
  type PrefsRemote,
  type RemotePrefs,
} from '@/datasource/prefsSync';
import { defaultSettings, type FqSettings, type SettingsSection } from '@/migration/schema';

const group = (id: string, keys: string[]) => ({
  id,
  name: id,
  icon: '',
  collapsed: false,
  botKeys: keys,
});

function settings(over: Partial<FqSettings> = {}): FqSettings {
  return { ...defaultSettings(), ...over };
}

const withGroups = (...gs: ReturnType<typeof group>[]): FqSettings => {
  const s = settings();
  s.fleet = { ...s.fleet, groups: gs };
  return s;
};

/** A gateway in memory: one document, `If-Match` honoured. */
function fakeRemote(initial?: { settings: Partial<FqSettings>; groups?: unknown }) {
  let doc: RemotePrefs | null = initial
    ? { version: 3, data: { v: 1, settings: initial.settings, groups: initial.groups ?? {} } }
    : null;
  const puts: Array<{ data: unknown; ifMatch: number | null }> = [];
  let conflictOnce = false;
  const remote: PrefsRemote = {
    get: async () => (doc ? structuredClone(doc) : null),
    put: async (data, ifMatch) => {
      puts.push({ data: structuredClone(data), ifMatch });
      if (conflictOnce) {
        conflictOnce = false;
        // Somebody else wrote between our read and our write.
        doc = { version: (doc?.version ?? 0) + 1, data: doc?.data };
        throw Object.assign(new Error('conflict'), { code: 'state_mismatch' });
      }
      if (ifMatch !== (doc?.version ?? null)) {
        throw Object.assign(new Error('conflict'), { code: 'state_mismatch' });
      }
      doc = { version: (doc?.version ?? 0) + 1, data };
      return { version: doc.version };
    },
  };
  return {
    remote,
    puts,
    doc: () => doc,
    conflictOnce: () => (conflictOnce = true),
  };
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

function harness(local: FqSettings, remote: PrefsRemote, storage = memoryStorage()) {
  const state = { settings: local };
  const sync = new PrefsSync({
    remote,
    storage,
    prefs: {
      settings: () => state.settings,
      applyRemote: (section, value) => {
        (state.settings as unknown as Record<string, unknown>)[section] = value;
      },
    },
  });
  return { sync, state, storage };
}

describe('mergeSections (three-way, per section)', () => {
  const sections = (s: FqSettings) => ({ tz: s.tz, fleet: s.fleet });

  it('adopts what changed remotely only', () => {
    const local = settings();
    const remote = { ...sections(local), tz: 'UTC' };
    const base = { tz: sectionHash(local.tz), fleet: sectionHash(local.fleet) };
    const r = mergeSections(local, remote, base);
    expect(r.adopt).toEqual([['tz', 'UTC']]);
    expect(r.push).toBe(false);
  });

  it('pushes what changed here only', () => {
    const local = settings({ tz: 'UTC' });
    const base = { tz: sectionHash('Europe/Paris') };
    const r = mergeSections(local, { tz: 'Europe/Paris' }, base);
    expect(r.adopt).toEqual([]);
    expect(r.push).toBe(true);
  });

  it('lets the gateway win when both sides changed the same section', () => {
    const local = settings({ tz: 'UTC' });
    const base = { tz: sectionHash('Europe/Paris') };
    const r = mergeSections(local, { tz: 'Europe/London' as never }, base);
    expect(r.adopt).toEqual([['tz', 'Europe/London']]);
  });

  it('a new device does not overwrite an imported section with a blank one', () => {
    // Never synced; fleet imported from the old UI (not blank), the document has no fleet yet.
    const local = withGroups(group('g', ['local:1']));
    const r = mergeSections(local, { tz: 'Europe/Paris' }, {});
    expect(r.push).toBe(true);
    expect(r.adopt.find(([s]) => s === 'fleet')).toBeUndefined();
  });

  it('a blank device adopts the remote section instead of pushing its defaults', () => {
    const local = settings();
    const remoteFleet = withGroups(group('g', ['local:1'])).fleet;
    const r = mergeSections(local, { fleet: remoteFleet }, {});
    expect(r.adopt.map(([s]) => s)).toEqual(['fleet']);
    expect(r.push).toBe(false);
  });

  it('writes nothing for a blank install and a blank document', () => {
    const r = mergeSections(settings(), null, {});
    expect(r.push).toBe(false);
    expect(r.adopt).toEqual([]);
  });
});

describe('buildDoc', () => {
  it('shares only the synced sections and derives the groups the gateway reads', () => {
    const s = withGroups(group('g1', ['local:1', 'local:2']));
    s.selectedBot = 'local:1';
    s.locale = 'fr';
    const doc = buildDoc(s) as { settings: Record<string, unknown>; groups: unknown };
    expect(Object.keys(doc.settings).sort()).toEqual(['alerts', 'columns', 'fleet', 'plot', 'tz']);
    expect(doc.groups).toEqual({ g1: ['local:1', 'local:2'] });
  });
});

describe('PrefsSync', () => {
  it('does not create a document for a device with nothing to share', async () => {
    const g = fakeRemote();
    const h = harness(settings(), g.remote);
    await h.sync.sync();
    expect(g.puts).toEqual([]);
    expect(h.sync.status).toBe('synced');
  });

  it('creates the document from what the user edited, without If-Match', async () => {
    const g = fakeRemote();
    const s = withGroups(group('g1', ['local:1']));
    s.touched = ['fleet'];
    const h = harness(s, g.remote);
    await h.sync.sync();
    expect(g.puts).toHaveLength(1);
    expect(g.puts[0]!.ifMatch).toBeNull();
    expect((g.doc()!.data as { groups: unknown }).groups).toEqual({ g1: ['local:1'] });
  });

  it('adopts the shared sections of another device and keeps the per-device ones', async () => {
    const g = fakeRemote({
      settings: { tz: 'UTC' as never, fleet: withGroups(group('g', ['local:9'])).fleet },
      groups: { g: ['local:9'] },
    });
    const local = settings({ locale: 'fr' });
    const h = harness(local, g.remote);
    await h.sync.sync();
    expect(h.state.settings.tz).toBe('UTC');
    expect(h.state.settings.fleet.groups.map((x) => x.id)).toEqual(['g']);
    expect(h.state.settings.locale).toBe('fr');
    expect(g.puts).toEqual([]);
    // Next time, a remote change is seen as a remote change (the base was saved).
    expect(JSON.parse(h.storage.getItem(SYNC_KEY)!).version).toBe(3);
  });

  it('writes a local edit with the version it read, then follows the new version', async () => {
    const g = fakeRemote({ settings: { tz: 'Europe/Paris' as never } });
    const h = harness(settings(), g.remote);
    await h.sync.sync();
    h.state.settings.tz = 'UTC';
    h.state.settings.touched = ['tz'];
    await h.sync.sync();
    expect(g.puts).toHaveLength(1);
    expect(g.puts[0]!.ifMatch).toBe(3);
    expect(JSON.parse(h.storage.getItem(SYNC_KEY)!).version).toBe(4);
  });

  it('reads again and merges again after a conflict (409)', async () => {
    const g = fakeRemote({ settings: { tz: 'Europe/Paris' as never } });
    const h = harness(settings(), g.remote);
    await h.sync.sync();
    h.state.settings.tz = 'UTC';
    h.state.settings.touched = ['tz'];
    g.conflictOnce();
    await h.sync.sync();
    expect(g.puts.length).toBe(2);
    expect(g.puts[1]!.ifMatch).toBe(4);
    expect(h.sync.status).toBe('synced');
  });

  it('reports an error and keeps the local settings when the gateway fails', async () => {
    const h = harness(settings({ tz: 'UTC' }), {
      get: async () => {
        throw new Error('down');
      },
      put: async () => ({ version: 1 }),
    });
    await h.sync.sync();
    expect(h.sync.status).toBe('error');
    expect(h.state.settings.tz).toBe('UTC');
  });

  it('folds the edits of a quiet period into one write', async () => {
    const g = fakeRemote({ settings: { tz: 'Europe/Paris' as never } });
    const timers: Array<() => void> = [];
    const storage = memoryStorage();
    const state = { settings: settings() };
    const sync = new PrefsSync({
      remote: g.remote,
      storage,
      prefs: {
        settings: () => state.settings,
        applyRemote: (s: SettingsSection, v: unknown) => {
          (state.settings as unknown as Record<string, unknown>)[s] = v;
        },
      },
      setTimer: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clearTimer: (h) => {
        timers[(h as number) - 1] = () => undefined;
      },
    });
    await sync.sync();
    state.settings.tz = 'UTC';
    state.settings.touched = ['tz'];
    sync.schedulePush();
    sync.schedulePush();
    sync.schedulePush();
    for (const t of timers) t();
    await sync.sync();
    expect(g.puts).toHaveLength(1);
  });
});
