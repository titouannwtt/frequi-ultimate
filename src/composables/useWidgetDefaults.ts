import { useLayoutStore } from '@/stores/layout';

export function useWidgetDefaults<T extends Record<string, unknown>>(
  widgetId: number,
  getCurrentFilters: () => T,
  applyFilters: (defaults: Partial<T>) => void,
  hardcodedDefaults: T,
) {
  const layoutStore = useLayoutStore();

  const savedDefaults = computed<T>(() => {
    const stored = layoutStore.getWidgetDefaults(widgetId);
    return stored ? ({ ...hardcodedDefaults, ...stored } as T) : hardcodedDefaults;
  });

  const filtersChanged = computed(() => {
    const current = getCurrentFilters();
    const defaults = savedDefaults.value;
    return JSON.stringify(current) !== JSON.stringify(defaults);
  });

  function saveCurrentAsDefault() {
    layoutStore.setWidgetDefaults(widgetId, getCurrentFilters());
  }

  function loadDefaults() {
    const stored = layoutStore.getWidgetDefaults(widgetId);
    if (stored) {
      applyFilters(stored as Partial<T>);
    }
  }

  return { filtersChanged, saveCurrentAsDefault, loadDefaults };
}
