import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';

import { buildEquityOption, tickDecimals } from '../../src/components/fq/lib/equity';
import { useVolumeComparator } from '../../src/composables/useVolumeComparator';

const hoisted = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../src/stores/ftbotwrapper', () => ({ useBotStore: () => hoisted.store }));

describe('equity axis ticks (B207)', () => {
  it('picks the decimals of an axis from its span, never mixing "5 000" and "-300,00"', () => {
    expect(tickDecimals(5000)).toBe(0);
    expect(tickDecimals(20)).toBe(0);
    expect(tickDecimals(5)).toBe(1);
    expect(tickDecimals(0.4)).toBe(2);
    expect(tickDecimals(Number.NaN)).toBe(0);
  });

  it('gives every label of one axis the same number of decimals', () => {
    const seen: Array<number | undefined> = [];
    const opt = buildEquityOption({
      points: [
        [1_000, 1000],
        [2_000, 5000],
        [3_000, 4700],
      ],
      tokens: new Proxy({}, { get: () => '#888' }) as never,
      fmtValue: (v, d) => {
        seen.push(d);
        return v.toFixed(d ?? 2);
      },
      fmtDate: () => '',
      labels: { equity: 'Equity', drawdown: 'Drawdown' },
    });
    const axes = opt.yAxis as Array<{ axisLabel: { formatter: (v: number) => string } }>;
    expect(axes[0].axisLabel.formatter(1000)).toBe('1000');
    expect(axes[1].axisLabel.formatter(-300)).toBe('-300');
    expect(seen.every((d) => d === 0)).toBe(true);
  });
});

describe('equity chart: the drawdown axis is named (B236)', () => {
  it('names the lower scale so that "-300" is not read as a tick of the curve', () => {
    const opt = buildEquityOption({
      points: [
        [1_000, 5000],
        [2_000, 5600],
        [3_000, 5300],
      ],
      tokens: new Proxy({}, { get: () => '#888' }) as never,
      fmtValue: (v, d) => v.toFixed(d ?? 2),
      fmtDate: () => '',
      labels: { equity: 'Equity', drawdown: 'Drawdown' },
    });
    const axes = opt.yAxis as Array<{ name?: string }>;
    expect(axes[0]!.name).toBeUndefined();
    expect(axes[1]!.name).toBe('Drawdown');
  });
});

describe('Volume page loads at once (B203)', () => {
  afterEach(() => {
    hoisted.store = null;
    vi.useRealTimers();
  });

  it('fetches on mount without a delay and is loading until the answer', async () => {
    vi.useFakeTimers();
    const getVolumeHistory = vi.fn(() =>
      Promise.resolve({
        buckets: [
          { date: '2026-10-01', exchange_volume: 10, bot_volume: 1, trade_count: 1, abs_profit: 0 },
        ],
        exchange_name: 'hyperliquid',
        stake_currency: 'USDC',
        whitelist_count: 1,
        data_coverage_pct: 100,
        anomaly_threshold_high: 100,
        anomaly_threshold_low: 0,
      }),
    );
    const store = reactive({
      selectedBot: 'ftbot.0',
      botStores: {},
      activeBot: { getVolumeHistory },
    });
    hoisted.store = store;
    let api!: ReturnType<typeof useVolumeComparator>;
    const C = defineComponent({
      setup() {
        api = useVolumeComparator({ multiBotView: false });
        return () => null;
      },
    });
    mount(C);
    // No timer advanced: the first request is already out
    expect(getVolumeHistory).toHaveBeenCalledTimes(1);
    expect(api.loading.value).toBe(true);
    await flushPromises();
    expect(api.loading.value).toBe(false);
    expect(api.hasData.value).toBe(true);

    // Another bot picked: its own history is read
    store.selectedBot = 'ftbot.1';
    await flushPromises();
    expect(getVolumeHistory).toHaveBeenCalledTimes(2);
  });
});
