import { DOMWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import JournalFilterBar from '../../../src/components/fq/JournalFilterBar.vue';
import JournalTotals from '../../../src/components/fq/JournalTotals.vue';
import { makeClosedTrades } from '../../../src/components/fq/fixtures/charts';
import {
  defaultJournalFilters,
  journalStats,
  type JournalFilters,
} from '../../../src/components/fq/lib/journalPage';
import { mountFq, setFqLocale, setupWorld, teardownWorld, type FqWorld } from './helpers';

/** L7: four totals and "More figures", one "Filters (n)" button, the "..." menu. */
let world: FqWorld;
beforeEach(() => {
  localStorage.clear();
  world = setupWorld();
});
afterEach(() => {
  localStorage.clear();
  teardownWorld();
});

const stats = () => journalStats(makeClosedTrades(world.fixture.bots));

describe('JournalTotals', () => {
  it('shows four figures, and the other five only after "More figures"', async () => {
    const w = mountFq(JournalTotals, { props: { stats: stats() } });
    for (const id of ['jt-net', 'jt-winrate', 'jt-avg', 'jt-worst']) {
      expect(w.find(`[data-testid=${id}]`).exists(), id).toBe(true);
    }
    expect(w.findAll('.kpi')).toHaveLength(4);
    expect(w.find('[data-testid=jt-extra]').exists()).toBe(false);

    await w.get('[data-testid=jt-more]').trigger('click');
    expect(w.get('[data-testid=jt-more]').attributes('aria-expanded')).toBe('true');
    for (const id of ['jt-factor', 'jt-expectancy', 'jt-worstdd', 'jt-duration', 'jt-perday']) {
      expect(w.find(`[data-testid=${id}]`).exists(), id).toBe(true);
    }
    expect(w.findAll('.kpi')).toHaveLength(9);

    // The choice is kept for the next visit
    expect(localStorage.getItem('fqu2.journal.moreTotals')).toBe('true');
    await w.get('[data-testid=jt-more]').trigger('click');
    expect(w.find('[data-testid=jt-extra]').exists()).toBe(false);
  });

  it('puts the average win and the average loss in one tile', () => {
    const s = stats();
    expect(s.avgWin).not.toBeNull();
    expect(s.avgLoss).not.toBeNull();
    const w = mountFq(JournalTotals, { props: { stats: s } });
    const tile = w.get('[data-testid=jt-avg]');
    expect(tile.text()).toContain('Average win / average loss');
    const fmt = (v: number) => Math.abs(v).toFixed(2);
    expect(tile.text()).toContain(fmt(s.avgWin as number));
    expect(tile.text()).toContain(fmt(s.avgLoss as number));
  });

  it('hides "dont 0 sans résultat" and says it in plain words otherwise (B382)', () => {
    setFqLocale('fr');
    const s = stats();
    const none = mountFq(JournalTotals, {
      props: { stats: { ...s, unknown: 0 }, totals: null },
    });
    expect(none.get('[data-testid=jt-net]').text()).toMatch(/\d+ trades?$/);
    expect(none.get('[data-testid=jt-net]').text()).not.toMatch(/dont|P&L/);
    const some = mountFq(JournalTotals, { props: { stats: { ...s, unknown: 3 } } });
    expect(some.get('[data-testid=jt-net]').text()).toMatch(/dont 3 sans résultat/);
    expect(some.get('[data-testid=jt-net]').text()).not.toContain('P&L');
  });

  it('the longest duration reads in words, the technical term only in the tooltip (B382)', async () => {
    setFqLocale('fr');
    localStorage.setItem('fqu2.journal.moreTotals', 'true');
    const w = mountFq(JournalTotals, { props: { stats: stats() } });
    const tile = w.get('[data-testid=jt-duration]');
    expect(tile.text()).toMatch(/9 sur 10 durent moins de/);
    expect(tile.text()).not.toMatch(/P90/);
    expect(tile.get('.k').attributes('title')).toMatch(/P90/);
  });

  it('says it in French and keeps the definition in a tooltip', () => {
    setFqLocale('fr');
    const w = mountFq(JournalTotals, { props: { stats: stats() } });
    expect(w.get('[data-testid=jt-net]').text()).toContain('Résultat net');
    expect(w.get('[data-testid=jt-avg]').text()).toContain('Gain moyen / perte moyenne');
    expect(w.get('[data-testid=jt-net] .k').attributes('title')).toMatch(/frais/);
    expect(w.get('[data-testid=jt-more]').text()).toBe('Plus de chiffres');
  });
});

function bar(
  filters: JournalFilters = defaultJournalFilters(),
  extra: Record<string, unknown> = {},
) {
  return mountFq(JournalFilterBar, {
    attachTo: document.body,
    props: {
      modelValue: filters,
      mode: 'live',
      botOptions: [
        { key: 'local:1', name: 'alpha', mode: 'live' },
        { key: 'local:2', name: 'beta', mode: 'live' },
      ],
      reasons: [{ value: 'roi', label: 'ROI', trades: 3 }],
      depthAvailable: true,
      exportScope: 'all',
      ...extra,
    },
  });
}

describe('JournalFilterBar', () => {
  it('keeps period, mode, replay and pair on the bar, the rest behind one button', () => {
    const w = bar();
    for (const id of ['jf-period', 'jf-mode', 'jf-noreplay', 'jf-filters', 'jf-more']) {
      expect(w.find(`[data-testid=${id}]`).exists(), id).toBe(true);
    }
    expect(w.get('[data-testid=jf-filters]').text()).toBe('Filters');
    // No chip while no filter is on: the calm stays quiet
    for (const id of ['jf-bots', 'jf-side', 'jf-reason', 'jf-depth']) {
      expect(w.find(`[data-testid=${id}]`).exists(), id).toBe(false);
    }
  });

  it('counts the active filters on the button and shows each as a removable chip', async () => {
    const w = bar({
      ...defaultJournalFilters(),
      bots: ['local:1', 'local:2'],
      side: 'short',
      exitReason: 'roi',
      depth: { kind: 'min', n: 4 },
    });
    expect(w.get('[data-testid=jf-filters]').text()).toBe('Filters (4)');
    expect(w.get('[data-testid=jf-bots]').text()).toContain('2');
    expect(w.get('[data-testid=jf-side]').text()).toContain('Short');
    expect(w.get('[data-testid=jf-reason]').text()).toContain('ROI');
    expect(w.get('[data-testid=jf-depth]').text()).toContain('4');

    await w.get('[data-testid=jf-side] .x').trigger('click');
    const last = w.emitted('update:modelValue')!.at(-1)![0] as JournalFilters;
    expect(last.side).toBeNull();
    expect(last.bots).toEqual(['local:1', 'local:2']);
  });

  it('opens the filters sheet and edits the side, the reason and the bots there', async () => {
    const w = bar();
    await w.get('[data-testid=jf-filters]').trigger('click');
    await nextTick();
    const body = new DOMWrapper(document.body);
    expect(body.find('[data-testid=jf-sheet]').exists()).toBe(true);

    const radios = body.findAll('[data-testid=jf-side-pick] [role=radio]');
    await radios.find((r) => r.text() === 'Long')!.trigger('click');
    expect((w.emitted('update:modelValue')!.at(-1)![0] as JournalFilters).side).toBe('long');

    await body.get('[data-testid=jf-reason-pick]').setValue('roi');
    expect((w.emitted('update:modelValue')!.at(-1)![0] as JournalFilters).exitReason).toBe('roi');

    const boxes = body.findAll('[data-testid=jf-bot-list] input[type=checkbox]');
    expect(boxes).toHaveLength(2);
    await boxes[1]!.trigger('change');
    expect((w.emitted('update:modelValue')!.at(-1)![0] as JournalFilters).bots).toEqual([
      'local:2',
    ]);
  });

  it('clears every sheet filter at once and leaves the replay chip and the pair alone', async () => {
    const w = bar({
      ...defaultJournalFilters(),
      side: 'long',
      exitReason: 'roi',
      pair: 'BTC',
      sansReplay: true,
    });
    await w.get('[data-testid=jf-filters]').trigger('click');
    await nextTick();
    const clear = new DOMWrapper(document.body)
      .findAll('button')
      .find((b) => b.text() === 'Clear all')!;
    await clear.trigger('click');
    const last = w.emitted('update:modelValue')!.at(-1)![0] as JournalFilters;
    expect(last).toMatchObject({
      side: null,
      exitReason: null,
      bots: [],
      depth: null,
      pair: 'BTC',
      sansReplay: true,
    });
  });

  it('disables the depth filter, and says why, when the source has no depth', async () => {
    const w = bar(defaultJournalFilters(), { depthAvailable: false });
    await w.get('[data-testid=jf-filters]').trigger('click');
    await nextTick();
    const body = new DOMWrapper(document.body);
    expect(body.get('[data-testid=jf-depth-pick]').attributes('disabled')).toBeDefined();
    expect(body.text()).toContain('does not give the number of top-ups');
  });

  it('keeps Views and Export in the "..." menu, and exports from there', async () => {
    const w = bar();
    await w.get('[data-testid=jf-more]').trigger('click');
    await nextTick();
    const body = new DOMWrapper(document.body);
    const items = body.findAll('[role=menuitem]').map((i) => i.text());
    expect(items).toEqual(['Views', 'CSV of the whole filtered set']);
    await body
      .findAll('[role=menuitem]')
      .find((i) => i.text().startsWith('CSV'))!
      .trigger('click');
    expect(w.emitted('exportCsv')).toHaveLength(1);
  });

  it('says in the menu that without the gateway only the shown rows are exported', async () => {
    const w = bar(defaultJournalFilters(), { exportScope: 'page' });
    await w.get('[data-testid=jf-more]').trigger('click');
    await nextTick();
    const body = new DOMWrapper(document.body);
    expect(body.text()).toContain('CSV of the rows shown');
    expect(body.text()).toContain('Without the gateway');
  });
});
