import { describe, expect, it } from 'vitest';

import { defaultColumnIds, LEGACY_FLEET_DEFAULT } from '@/datasource/columns';
import { resolveColumns } from '@/composables/useColumns';
import { COLUMN_DEFAULTS_REV, defaultSettings, SETTINGS_KEY } from '@/migration/schema';
import { loadSettings, saveSettings, type KeyValueStorage } from '@/migration/storage';
import { upgradeSettings } from '@/migration/upgrade';

const memory = (): KeyValueStorage & { raw: Map<string, string> } => {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (k) => raw.get(k) ?? null,
    setItem: (k, v) => void raw.set(k, v),
  };
};

/** A document written before the revision existed, with the given fleet columns saved. */
function oldDocument(visible: string[] | null) {
  const s = defaultSettings() as unknown as Record<string, unknown>;
  delete s.columnDefaultsRev;
  if (visible) s.columns = { fleet: { visible, order: [...visible] } };
  return JSON.stringify(s);
}

describe('the default columns of the fleet table', () => {
  it('shows the profit columns by default: today, 7 days, 30 days, in total', () => {
    expect(defaultColumnIds('fleet')).toEqual([
      'bot',
      'latent',
      'realized_1d',
      'realized_7d',
      'realized_30d',
      'realized_total',
      'spark24h',
      'trades',
      'last_trade',
    ]);
    // The old default is what the table showed before: six columns, none of the profit ones
    expect(LEGACY_FLEET_DEFAULT).not.toContain('realized_7d');
  });

  it('shows them all in a wide table and drops the ones that do not fit in a narrow one', () => {
    const wide = resolveColumns('fleet', undefined, 1200, false).shown.map((c) => c.id);
    expect(wide).toEqual(defaultColumnIds('fleet'));
    const narrow = resolveColumns('fleet', undefined, 480, false).shown.map((c) => c.id);
    expect(narrow).toContain('bot');
    expect(narrow).toContain('latent');
    expect(narrow).not.toContain('realized_total');
  });
});

describe('the migration of the saved columns', () => {
  it('moves a choice equal to the old default to the new one', () => {
    const storage = memory();
    storage.setItem(SETTINGS_KEY, oldDocument([...LEGACY_FLEET_DEFAULT].reverse()));
    const s = loadSettings(storage)!;
    expect(new Set(s.columns.fleet!.visible)).toEqual(new Set(defaultColumnIds('fleet')));
    expect(s.columnDefaultsRev).toBe(COLUMN_DEFAULTS_REV);
  });

  it('keeps any other choice, even one that adds a single column to the old default', () => {
    const storage = memory();
    const mine = [...LEGACY_FLEET_DEFAULT, 'drawdown'];
    storage.setItem(SETTINGS_KEY, oldDocument(mine));
    expect(loadSettings(storage)!.columns.fleet!.visible).toEqual(mine);
    const fewer = LEGACY_FLEET_DEFAULT.filter((c) => c !== 'spark24h');
    storage.setItem(SETTINGS_KEY, oldDocument(fewer));
    expect(loadSettings(storage)!.columns.fleet!.visible).toEqual(fewer);
  });

  it('leaves a document without saved columns on the registry defaults', () => {
    const storage = memory();
    storage.setItem(SETTINGS_KEY, oldDocument(null));
    const s = loadSettings(storage)!;
    expect(s.columns.fleet).toBeUndefined();
    expect(s.columnDefaultsRev).toBe(COLUMN_DEFAULTS_REV);
  });

  it('does it once: the old default chosen again afterwards is the user choice', () => {
    const storage = memory();
    storage.setItem(SETTINGS_KEY, oldDocument([...LEGACY_FLEET_DEFAULT]));
    const first = loadSettings(storage)!;
    // The user goes back to the six columns and the document is saved
    first.columns = { fleet: { visible: [...LEGACY_FLEET_DEFAULT], order: [] } };
    saveSettings(storage, first);
    const again = loadSettings(storage)!;
    expect(again.columns.fleet!.visible).toEqual(LEGACY_FLEET_DEFAULT);
  });

  it('does not touch the other tables', () => {
    const base = defaultSettings();
    base.columns = {
      journal: { visible: ['bot', 'pair'], order: [] },
      fleet: { visible: [...LEGACY_FLEET_DEFAULT], order: [] },
    };
    const up = upgradeSettings(base, 0);
    expect(up.columns.journal).toEqual({ visible: ['bot', 'pair'], order: [] });
    expect(upgradeSettings(base, COLUMN_DEFAULTS_REV)).toBe(base);
  });
});
