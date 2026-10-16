/**
 * What the browser remembers about the layout (Settings > Workspaces): one entry per thing that
 * can be reset on its own. A reset is a pure function of the settings, so it can be tested; the
 * panel only applies its result and clears the local keys.
 */
import type { ColumnPreset, FqSettings, Workspace } from '@/migration/schema';

export const COLUMN_PRESETS: readonly ColumnPreset[] = ['fleet', 'open', 'bot', 'closed', 'journal'];
export const WORKSPACES: readonly Workspace[] = ['surveillance', 'incident', 'analysis'];

/** Local keys cleared by the resets that live outside the settings document. */
export const FLEET_VIEW_KEY = 'fqu2.fleetView';
export const JOURNAL_VIEWS_KEY = 'fqu2.journal.views';

/** The settings without the saved columns of one preset (or of all of them). */
export function withoutColumns(columns: FqSettings['columns'], preset: ColumnPreset | 'all') {
  if (preset === 'all') return {};
  const next = { ...columns };
  delete next[preset];
  return next;
}

/** Number of table presets that have a saved layout. */
export function customizedColumns(columns: FqSettings['columns']): ColumnPreset[] {
  return COLUMN_PRESETS.filter((p) => columns[p] !== undefined);
}

/** The scope block back to its defaults: live, Surveillance. */
export function defaultScopeBlock(): FqSettings['scope'] {
  return { mode: 'live', workspace: 'surveillance' };
}
