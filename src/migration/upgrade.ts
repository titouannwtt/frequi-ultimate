/**
 * Upgrades of a stored `fqu2.settings` document that need no new document version: a default that
 * moved. A saved choice is only ever replaced when it is exactly the old default (the user never
 * chose it, it was just saved by a click on "Columns"); any other choice is theirs and stays.
 */
import { defaultColumnIds, LEGACY_FLEET_DEFAULT } from '@/datasource/columns';

import { COLUMN_DEFAULTS_REV, type FqSettings } from './schema';

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));

/**
 * Settings with the default columns of the current revision. `storedRev` is the revision the
 * document was last compared with (0 for a document written before the field existed). A fleet
 * table saved with exactly the old six columns takes the new defaults (the saved order is kept: the
 * new columns come where the registry puts them); any other choice is left alone.
 */
export function upgradeSettings(settings: FqSettings, storedRev: number): FqSettings {
  if (storedRev >= COLUMN_DEFAULTS_REV) return settings;
  const next: FqSettings = { ...settings, columnDefaultsRev: COLUMN_DEFAULTS_REV };
  const fleet = settings.columns.fleet;
  if (fleet && sameSet(fleet.visible, LEGACY_FLEET_DEFAULT)) {
    next.columns = {
      ...settings.columns,
      fleet: { ...fleet, visible: defaultColumnIds('fleet') },
    };
  }
  return next;
}
