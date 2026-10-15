import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import { columnsFor, columnSpec, defaultColumnIds, type ColumnSpec } from '@/datasource/columns';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ColumnPreset, ColumnPrefs } from '@/migration/schema';

export interface ResolvedColumn extends ColumnSpec {
  /** Hidden because the container is narrower than `hideBelow`. */
  hiddenByWidth: boolean;
  /** Only the gateway can provide it and the source is the direct mode. */
  unavailable: boolean;
}

/**
 * Columns of a preset given the user's choices and the width of the table container. Pure, so it
 * is tested without a component. Unknown ids in the preferences are dropped, `required` columns
 * can never be removed, ids absent from the saved order come after, in registry order.
 */
export function resolveColumns(
  preset: ColumnPreset,
  saved: ColumnPrefs | undefined,
  containerWidth: number,
  directMode: boolean,
): { shown: ResolvedColumn[]; all: ResolvedColumn[] } {
  const available = columnsFor(preset);
  const known = new Set(available.map((c) => c.id));
  const wanted = new Set(
    (saved?.visible ?? defaultColumnIds(preset)).filter((id) => known.has(id)),
  );
  for (const c of available) if (c.required) wanted.add(c.id);

  const order = (saved?.order ?? []).filter((id) => known.has(id));
  const seen = new Set(order);
  const ordered = [...order, ...available.map((c) => c.id).filter((id) => !seen.has(id))];

  const all = ordered.map((id): ResolvedColumn => {
    const spec = columnSpec(id)!;
    return {
      ...spec,
      hiddenByWidth: !spec.required && containerWidth > 0 && containerWidth < spec.hideBelow,
      unavailable: directMode && !!spec.gatewayOnly,
    };
  });
  return { all, shown: all.filter((c) => wanted.has(c.id) && !c.hiddenByWidth) };
}

/**
 * Column registry of a table (02 section 5.3): visibility by container width (not window width),
 * the user's order, and the choices persisted in the preferences (imported from the old keys by
 * the migration).
 */
export function useColumns(preset: ColumnPreset, containerWidth: MaybeRefOrGetter<number> = 0) {
  const prefs = useFqPrefsStore();
  const conn = useFqConnectionStore();

  const saved = computed(() => prefs.settings.columns[preset]);
  const resolved = computed(() =>
    resolveColumns(preset, saved.value, toValue(containerWidth), conn.kind === 'direct'),
  );

  const visibleIds = computed(() => new Set(saved.value?.visible ?? defaultColumnIds(preset)));

  function save(next: ColumnPrefs): void {
    prefs.update('columns', { ...prefs.settings.columns, [preset]: next });
  }

  function setVisible(id: string, visible: boolean): void {
    const spec = columnSpec(id);
    if (!spec || spec.required || !spec.presets.includes(preset)) return;
    const ids = new Set(visibleIds.value);
    if (visible) ids.add(id);
    else ids.delete(id);
    save({ visible: [...ids], order: resolved.value.all.map((c) => c.id) });
  }

  /** Move a column by `delta` places in the display order. */
  function move(id: string, delta: number): void {
    const order = resolved.value.all.map((c) => c.id);
    const from = order.indexOf(id);
    if (from < 0) return;
    const to = Math.min(order.length - 1, Math.max(0, from + delta));
    order.splice(to, 0, order.splice(from, 1)[0]!);
    save({ visible: [...visibleIds.value], order });
  }

  function reset(): void {
    const rest = Object.fromEntries(
      Object.entries(prefs.settings.columns).filter(([key]) => key !== preset),
    );
    prefs.update('columns', rest);
  }

  return {
    columns: computed(() => resolved.value.shown),
    allColumns: computed(() => resolved.value.all),
    hiddenByWidth: computed(() => resolved.value.all.filter((c) => c.hiddenByWidth)),
    setVisible,
    move,
    reset,
  };
}
