import { computed } from 'vue';
import { useBotComparisonStore } from '@/stores/botComparison';

/**
 * Thin wrapper around the botComparison store for summary currency.
 * Keeps the same API so existing consumers don't need changes.
 */
export function useSummaryCurrency() {
  const store = useBotComparisonStore();

  const summaryCurrency = computed({
    get: () => store.summaryCurrency,
    set: (val: string) => store.setSummaryCurrency(val),
  });

  function setSummaryCurrency(val: string) {
    store.setSummaryCurrency(val);
  }

  return { summaryCurrency, setSummaryCurrency };
}
