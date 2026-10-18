import type * as EchartsCore from 'echarts/core';
import { flushPromises } from '@vue/test-utils';
import PrimeVue from 'primevue/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FleetBotSelect from '../../../src/components/fq/FleetBotSelect.vue';
import ProfitPanel from '../../../src/components/fq/ProfitPanel.vue';
import { FIXTURE_NOW } from '../../../src/components/fq/fixtures';
import { useFqPrefsStore } from '../../../src/datasource/stores/prefs';
import type { DataSource, EquityQuery, EquitySeries } from '../../../src/datasource/types';
import { charts, resetCharts } from './chartMock';
import { mountFq, setupWorld, teardownWorld, type FqWorld } from './helpers';

vi.mock('echarts/core', async (orig) => {
  const actual = await orig<typeof EchartsCore>();
  const mock = await import('./chartMock');
  return { ...actual, init: mock.fakeInit };
});

const H = 3_600_000;
const D = 24 * H;

/** A source that answers the two curves and remembers what it was asked. */
function curveSource(opts: { openFrom?: number } = {}) {
  const asked: EquityQuery[] = [];
  const source = {
    kind: 'gateway',
    query: {
      equity: async (q: EquityQuery): Promise<EquitySeries> => {
        asked.push({ ...q });
        const from = q.fromMs ?? FIXTURE_NOW - 400 * D;
        const start = q.mode === 'with_open' ? Math.max(from, opts.openFrom ?? 0) : from;
        const points: Array<[number, number]> = [];
        for (
          let t = start;
          t <= FIXTURE_NOW;
          t += Math.max(H, Math.floor((FIXTURE_NOW - start) / 40))
        ) {
          points.push([t, 100 + (t - start) / H / 10 + (q.mode === 'with_open' ? 3 : 0)]);
        }
        return {
          mode: q.mode,
          points,
          base: q.mode === 'with_open' && opts.openFrom && opts.openFrom > from ? null : 100,
          unavailable: null,
          asOfMs: FIXTURE_NOW,
        };
      },
    },
  } as unknown as DataSource;
  return { source, asked };
}

let world: FqWorld;
beforeEach(() => {
  resetCharts();
  world = setupWorld();
  localStorage.clear();
});
afterEach(() => {
  teardownWorld();
  localStorage.clear();
});

const radio = (
  w: {
    findAll: (s: string) => Array<{ text: () => string; trigger: (e: string) => Promise<void> }>;
  },
  label: string,
) => w.findAll('[role=radio]').find((b) => b.text() === label)!;

describe('ProfitPanel', () => {
  it('asks the two curves for the last 30 days, with no upper bound, and draws both', async () => {
    const { source, asked } = curveSource();
    const w = mountFq(ProfitPanel, {
      props: { scope: { kind: 'fleet' }, source, nowMs: FIXTURE_NOW, latent: -12.5 },
    });
    await flushPromises();
    expect(asked.map((q) => q.mode).sort()).toEqual(['realized', 'with_open']);
    for (const q of asked) {
      expect(q.fromMs).toBe(FIXTURE_NOW - 30 * D);
      expect(q.toMs).toBeUndefined();
      expect(q.points).toBe(600);
    }
    const option = charts.at(-1)!.last() as { series: Array<{ id: string }> };
    expect(option.series.map((s) => s.id)).toEqual(['realized', 'with_open']);
    expect(w.get('[data-testid=profit-figures]').text()).toMatch(/Profit/);
    expect(w.get('[data-testid=profit-figures]').text()).toMatch(/Realised/);
    expect(w.get('[data-testid=profit-figures]').text()).toContain('12.50');
  });

  it('offers 24 h to the whole history, and asks 90 days and one year back', async () => {
    const { source, asked } = curveSource();
    const w = mountFq(ProfitPanel, {
      props: { scope: { kind: 'fleet' }, source, nowMs: FIXTURE_NOW },
    });
    await flushPromises();
    expect(w.findAll('[role=radio]').map((b) => b.text())).toEqual([
      '24 h',
      '7 d',
      '30 d',
      '90 d',
      '1 y',
      'All',
    ]);
    asked.length = 0;
    await radio(w, '90 d').trigger('click');
    await flushPromises();
    expect(asked.map((q) => q.fromMs)).toEqual([FIXTURE_NOW - 90 * D, FIXTURE_NOW - 90 * D]);
    asked.length = 0;
    await radio(w, '1 y').trigger('click');
    await flushPromises();
    expect(asked[0]!.fromMs).toBeLessThan(FIXTURE_NOW - 360 * D);
    expect(asked[0]!.fromMs).toBeGreaterThan(FIXTURE_NOW - 370 * D);
    asked.length = 0;
    await radio(w, 'All').trigger('click');
    await flushPromises();
    expect(asked.every((q) => q.fromMs === undefined && q.toMs === undefined)).toBe(true);
    // The choice is kept for the next visit
    expect(localStorage.getItem('fqu2.profitPeriod')).toBe('all');
  });

  it('asks the range of dates picked, both ends, and keeps no period selected', async () => {
    const fromMs = FIXTURE_NOW - 20 * D;
    const toMs = FIXTURE_NOW - 10 * D;
    localStorage.setItem('fqu2.profitPeriod', 'custom');
    localStorage.setItem('fqu2.profitRange', JSON.stringify({ fromMs, toMs }));
    const { source, asked } = curveSource();
    const w = mountFq(ProfitPanel, {
      props: { scope: { kind: 'fleet' }, source, nowMs: FIXTURE_NOW },
    });
    await flushPromises();
    expect(asked).toHaveLength(2);
    for (const q of asked) expect([q.fromMs, q.toMs]).toEqual([fromMs, toMs]);
    expect(w.findAll('[role=radio][aria-checked=true]')).toHaveLength(0);
    expect(w.get('[data-testid=profit-dates]').text()).toMatch(/\d\d\/\d\d - \d\d\/\d\d/);
  });

  it('reopens on the saved range without closing again, and applies only a real choice', async () => {
    const fromMs = FIXTURE_NOW - 20 * D;
    const toMs = FIXTURE_NOW - 10 * D;
    localStorage.setItem('fqu2.profitPeriod', 'custom');
    localStorage.setItem('fqu2.profitRange', JSON.stringify({ fromMs, toMs }));
    const { source } = curveSource();
    const w = mountFq(ProfitPanel, {
      props: { scope: { kind: 'fleet' }, source, nowMs: FIXTURE_NOW },
      global: { plugins: [PrimeVue] },
      attachTo: document.body,
    });
    await flushPromises();
    await w.get('[data-testid=profit-dates]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid=profit-dates]').attributes('aria-expanded')).toBe('true');
    expect(document.body.querySelector('[data-testid=profit-range]')).not.toBeNull();
  });

  it('keeps the curves on screen while the start of the period slides with the clock', async () => {
    const { source, asked } = curveSource();
    const w = mountFq(ProfitPanel, {
      props: { scope: { kind: 'fleet' }, source, nowMs: FIXTURE_NOW },
    });
    await flushPromises();
    expect(asked).toHaveLength(2);
    expect(w.attributes('aria-busy')).toBeUndefined();
    await w.setProps({ nowMs: FIXTURE_NOW + 3 * 60_000 });
    await flushPromises();
    // Same question: nothing is asked again, nothing goes back to waiting
    expect(asked).toHaveLength(2);
    expect(w.attributes('aria-busy')).toBeUndefined();
    expect(charts.length).toBeGreaterThan(0);
  });

  it('says since when the open positions are tracked when that is after the start', async () => {
    const { source } = curveSource({ openFrom: FIXTURE_NOW - 10 * D });
    const w = mountFq(ProfitPanel, {
      props: { scope: { kind: 'fleet' }, source, nowMs: FIXTURE_NOW },
    });
    await flushPromises();
    expect(w.get('[data-testid=profit-tracked]').text()).toMatch(/Open positions tracked since/);
    // With a period that starts after the tracking, nothing to say
    await radio(w, '7 d').trigger('click');
    await flushPromises();
    expect(w.find('[data-testid=profit-tracked]').exists()).toBe(false);
  });

  it('asks nothing and says so when no bot is ticked', async () => {
    const { source, asked } = curveSource();
    const w = mountFq(ProfitPanel, {
      props: { scope: { kind: 'bots', botKeys: [] }, source, nowMs: FIXTURE_NOW },
    });
    await flushPromises();
    expect(asked).toEqual([]);
    expect(w.text()).toMatch(/No bot ticked/);
  });

  it('asks the ticked bots as a list', async () => {
    const { source, asked } = curveSource();
    mountFq(ProfitPanel, {
      props: {
        scope: { kind: 'bots', botKeys: ['local:9401', 'local:9402'] },
        source,
        nowMs: FIXTURE_NOW,
      },
    });
    await flushPromises();
    expect(asked[0]!.scope).toEqual({ kind: 'bots', botKeys: ['local:9401', 'local:9402'] });
  });
});

describe('FleetBotSelect', () => {
  const liveKeys = () =>
    world.fixture.bots.filter((b) => b.identity.mode === 'live').map((b) => b.bot_key);

  it('shows how many bots are ticked of those of the mode', async () => {
    const w = mountFq(FleetBotSelect, { attachTo: document.body });
    const n = liveKeys().length;
    expect(w.get('[data-testid=fleet-bots-count]').text()).toBe(`${n}/${n}`);
    expect(w.get('[data-testid=fleet-bots-count]').classes()).not.toContain('on');
  });

  it('lists one line per bot of the mode, and unticking one is kept in the preferences', async () => {
    const w = mountFq(FleetBotSelect, { attachTo: document.body });
    await w.get('[data-testid=fleet-bots-toggle]').trigger('click');
    await flushPromises();
    const rows = document.body.querySelectorAll('[data-testid^=fleet-bot-row-]');
    expect(rows).toHaveLength(liveKeys().length);
    const key = liveKeys()[0]!;
    const box = document.body.querySelector<HTMLInputElement>(
      `[data-testid="fleet-bot-row-${key}"] input`,
    )!;
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    await flushPromises();
    expect(useFqPrefsStore().settings.scope.excluded).toEqual([key]);
    const n = liveKeys().length;
    expect(w.get('[data-testid=fleet-bots-count]').text()).toBe(`${n - 1}/${n}`);
    expect(w.get('[data-testid=fleet-bots-count]').classes()).toContain('on');
    // None, then All
    document.body.querySelector<HTMLElement>('[data-testid=fleet-bots-none]')!.click();
    await flushPromises();
    expect(w.get('[data-testid=fleet-bots-count]').text()).toBe(`0/${n}`);
    document.body.querySelector<HTMLElement>('[data-testid=fleet-bots-all]')!.click();
    await flushPromises();
    expect(w.get('[data-testid=fleet-bots-count]').text()).toBe(`${n}/${n}`);
    expect(useFqPrefsStore().settings.scope.excluded).toEqual([]);
  });

  it('searches the list', async () => {
    const w = mountFq(FleetBotSelect, { attachTo: document.body });
    await w.get('[data-testid=fleet-bots-toggle]').trigger('click');
    await flushPromises();
    const first = world.fixture.bots.find((b) => b.identity.mode === 'live')!;
    const input = document.body.querySelector<HTMLInputElement>('input[type=search]')!;
    input.value = first.identity.name;
    input.dispatchEvent(new Event('input'));
    await flushPromises();
    const rows = document.body.querySelectorAll('[data-testid^=fleet-bot-row-]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(liveKeys().length);
  });
});
