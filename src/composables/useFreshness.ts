import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import { ageMs, isStale } from '@/components/ds/lib/freshness';
import { formatAge } from '@/components/ds/lib/format';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { CADENCE_MULTIPLE } from '@/datasource/calc/freshness';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import i18n from '@/locales';

/** Staleness threshold of a channel: three times its polling cadence (03 section 6.1). */
export function staleAfterFromCadence(cadenceMs: number): number {
  return CADENCE_MULTIPLE * cadenceMs;
}

export interface FreshnessEntry {
  key: string;
  /** Server time of the value, null when the value was never observed. */
  asOfMs: number | null | undefined;
  value?: number | null;
}

/**
 * Age, staleness and wording of one value (02 section 12). The age is computed on the server
 * clock (`now + skew`), so a wrong browser clock changes nothing. A value never observed is stale.
 */
export function useFreshness(
  asOfMs: MaybeRefOrGetter<number | null | undefined>,
  staleAfterMs: MaybeRefOrGetter<number>,
) {
  const conn = useFqConnectionStore();
  const clock = useNowMs();

  const age = computed<number | null>(() => {
    const at = toValue(asOfMs);
    return at == null ? null : ageMs(at, clock.value, conn.status.clockSkewMs);
  });
  const stale = computed(() => age.value === null || isStale(age.value, toValue(staleAfterMs)));
  /** "il y a 12 s" / "12 s ago"; empty when never observed. */
  const label = computed(() =>
    age.value === null ? '' : formatAge(age.value, i18n.global.locale.value),
  );
  return { ageMs: age, stale, label };
}

/**
 * Same for a group of values summed together: a stale or missing value is excluded from the sum
 * and listed, never silently added.
 */
export function useFreshnessGroup(
  entries: MaybeRefOrGetter<readonly FreshnessEntry[]>,
  staleAfterMs: MaybeRefOrGetter<number>,
) {
  const conn = useFqConnectionStore();
  const clock = useNowMs();

  const rows = computed(() => {
    const limit = toValue(staleAfterMs);
    return toValue(entries).map((e) => {
      const age = e.asOfMs == null ? null : ageMs(e.asOfMs, clock.value, conn.status.clockSkewMs);
      const stale = age === null || isStale(age, limit);
      return { ...e, ageMs: age, stale };
    });
  });
  const excluded = computed(() =>
    rows.value
      .filter((r) => r.stale || r.value == null || !Number.isFinite(r.value))
      .map((r) => r.key),
  );
  const total = computed(() =>
    rows.value.reduce(
      (sum, r) => (r.stale || r.value == null || !Number.isFinite(r.value) ? sum : sum + r.value),
      0,
    ),
  );
  return {
    rows,
    excluded,
    total,
    included: computed(() => rows.value.length - excluded.value.length),
  };
}
