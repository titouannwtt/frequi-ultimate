import { useLocalStorage } from '@vueuse/core';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import type { OverlayToggles } from '@/components/fq/lib/candles';

/**
 * What the Charts page draws over the candles, as the "Affichage" menu words it. The four level
 * lines (average entry, take profit, safety orders, liquidation) are one switch: "Niveaux de la
 * position". Everything is on at first; the choice is remembered on this device.
 */
export interface ChartDisplay {
  levels: boolean;
  fills: boolean;
  pending: boolean;
  gain: boolean;
  closed: boolean;
}

export const DEFAULT_DISPLAY: ChartDisplay = {
  levels: true,
  fills: true,
  pending: true,
  gain: true,
  closed: true,
};

export const DISPLAY_KEY = 'fqu2.charts.display.v1';
export const SUBPLOTS_KEY = 'fqu2.charts.subplots.v1';

/** The overlay switches of the chart for a display choice. */
export function overlayToggles(d: ChartDisplay): OverlayToggles {
  return {
    average: d.levels,
    tp: d.levels,
    safetyOrders: d.levels,
    liquidation: d.levels,
    fills: d.fills,
    pending: d.pending,
    gain: d.gain,
    closed: d.closed,
  };
}

export function useChartDisplay() {
  const display = useLocalStorage<ChartDisplay>(
    DISPLAY_KEY,
    { ...DEFAULT_DISPLAY },
    { mergeDefaults: true },
  );
  const toggles = computed(() => overlayToggles(display.value));
  function set(key: keyof ChartDisplay, on: boolean) {
    display.value = { ...display.value, [key]: on };
  }
  return { display, toggles, set };
}

/**
 * The sub-charts the user keeps for each strategy (ids as in `subplotCandidates`). A strategy with
 * no entry shows its default one; an empty list is a choice too (none). Shared by every cell and by
 * the indicators sheet, remembered on this device.
 */
export function useSubplotChoice(strategy: MaybeRefOrGetter<string | null>) {
  const store = useLocalStorage<Record<string, string[]>>(SUBPLOTS_KEY, {});
  const choice = computed<string[] | null>(() => {
    const key = toValue(strategy);
    return key ? (store.value[key] ?? null) : null;
  });
  function set(ids: string[]) {
    const key = toValue(strategy);
    if (key) store.value = { ...store.value, [key]: ids };
  }
  return { choice, set };
}
