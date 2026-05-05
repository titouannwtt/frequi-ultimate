import { ref, computed, type Ref, type ComputedRef } from 'vue';

export interface RegimeTimelineEntry {
  date: string;
  regime: string;
  volatility: number;
  trend: number;
}

const REGIME_COLORS: Record<string, string> = {
  bull_quiet: '#a6e3a1',
  bull_volatile: '#f9e2af',
  bear_quiet: '#89b4fa',
  bear_volatile: '#f38ba8',
};

const REGIME_LABEL_KEYS: Record<string, string> = {
  bull_quiet: 'strategyDev.regimeBullQuiet',
  bull_volatile: 'strategyDev.regimeBullVolatile',
  bear_quiet: 'strategyDev.regimeBearQuiet',
  bear_volatile: 'strategyDev.regimeBearVolatile',
};

export { REGIME_COLORS, REGIME_LABEL_KEYS };

export function useRegimeOverlay(
  timeline: Ref<RegimeTimelineEntry[] | undefined> | ComputedRef<RegimeTimelineEntry[] | undefined>,
) {
  const showRegimes = ref(false);

  const markAreaData = computed(() => {
    if (!showRegimes.value || !timeline.value || timeline.value.length === 0) return [];

    const tl = timeline.value;
    const areas: Array<[Record<string, unknown>, Record<string, unknown>]> = [];
    let blockStart = 0;
    for (let i = 1; i <= tl.length; i++) {
      if (i === tl.length || tl[i].regime !== tl[blockStart].regime) {
        const regime = tl[blockStart].regime;
        const color = REGIME_COLORS[regime] ?? '#45475a';
        areas.push([
          { xAxis: tl[blockStart].date, itemStyle: { color: color + '25' } },
          { xAxis: tl[i - 1].date },
        ]);
        blockStart = i;
      }
    }
    return areas;
  });

  return { showRegimes, markAreaData, REGIME_COLORS, REGIME_LABEL_KEYS };
}
