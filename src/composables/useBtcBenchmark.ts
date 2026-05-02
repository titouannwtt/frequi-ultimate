import { ref, watch, type Ref } from 'vue';
import { fetchBenchmarkHistory, normalizeToPercent } from '@/utils/benchmarkData';

export interface BenchmarkPoint {
  date: string;
  balance: number;
}

export function useBtcBenchmark(
  equity: Ref<{ date: string; balance: number }[] | undefined>,
  startingBalance: Ref<number>,
) {
  const benchmarkEquity = ref<BenchmarkPoint[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const alpha = ref<number | null>(null);
  const enabled = ref(true);

  async function fetchBenchmark() {
    const eq = equity.value;
    if (!eq?.length || !enabled.value) {
      benchmarkEquity.value = [];
      alpha.value = null;
      return;
    }

    const firstDate = new Date(eq[0].date);
    const lastDate = new Date(eq[eq.length - 1].date);
    const daySpan = Math.ceil((lastDate.getTime() - firstDate.getTime()) / 86400000) + 2;
    if (daySpan < 2) return;

    loading.value = true;
    error.value = null;

    try {
      const result = await fetchBenchmarkHistory('BTC', Math.min(daySpan + 30, 365));
      if (result.error) {
        error.value = result.error;
      }
      if (!result.data.length) {
        loading.value = false;
        return;
      }

      const dateMap = new Map<string, number>();
      for (const p of result.data) {
        const d = new Date(p.timestamp);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        dateMap.set(key, p.price);
      }

      const bal = startingBalance.value;
      const equityDates = eq.map((e) => e.date);
      const firstPrice = dateMap.get(equityDates[0]);
      if (!firstPrice) {
        let closest: number | null = null;
        for (const [, price] of dateMap) {
          closest = price;
          break;
        }
        if (!closest) {
          loading.value = false;
          return;
        }
      }

      let basePrice: number | null = null;
      const aligned: BenchmarkPoint[] = [];

      for (const date of equityDates) {
        const price = dateMap.get(date);
        if (price != null) {
          if (basePrice === null) basePrice = price;
          aligned.push({
            date,
            balance: Math.round((bal * price / basePrice) * 100) / 100,
          });
        } else if (basePrice !== null && aligned.length > 0) {
          aligned.push({ date, balance: aligned[aligned.length - 1].balance });
        }
      }

      benchmarkEquity.value = aligned;

      if (aligned.length > 0 && eq.length > 0) {
        const stratReturn = ((eq[eq.length - 1].balance - bal) / bal) * 100;
        const btcReturn = ((aligned[aligned.length - 1].balance - bal) / bal) * 100;
        alpha.value = Math.round((stratReturn - btcReturn) * 100) / 100;
      }
    } catch {
      error.value = 'fetch_failed';
    } finally {
      loading.value = false;
    }
  }

  watch([equity, enabled], () => fetchBenchmark(), { immediate: true });

  return { benchmarkEquity, loading, error, alpha, enabled };
}
