import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import DataTable from '../../../src/components/ds/DataTable.vue';
import type { ColumnDef } from '../../../src/components/ds/lib/table';
import { mountDs } from './helpers';

interface Row {
  id: number;
  name: string;
  pnl: number | null;
  day: string;
}

const columns: ColumnDef<Row>[] = [
  { id: 'name', label: 'Name', align: 'left', ui: true, sortable: true },
  { id: 'pnl', label: 'P&L', sortable: true },
  { id: 'wide', label: 'Wide', hideBelow: 600, value: () => 'w' },
  { id: 'wider', label: 'Wider', hideBelow: 900, value: () => 'ww' },
];

const rows: Row[] = [
  { id: 1, name: 'beta', pnl: 5, day: 'd1' },
  { id: 2, name: 'alpha', pnl: -3, day: 'd1' },
  { id: 3, name: 'gamma', pnl: null, day: 'd2' },
  { id: 4, name: 'delta', pnl: 12, day: 'd2' },
];

const names = (wrapper: ReturnType<typeof mountDs>) =>
  wrapper.findAll('tbody tr:not(.pad):not(.grp)').map((tr) => tr.findAll('td')[0].text());

describe('DataTable sort', () => {
  it('keeps the input order until a header is clicked', () => {
    const wrapper = mountDs(DataTable, { props: { columns, rows, rowKey: 'id' } });
    expect(names(wrapper)).toEqual(['beta', 'alpha', 'gamma', 'delta']);
  });

  it('sorts a text column ascending first, then descending, then clears', async () => {
    const wrapper = mountDs(DataTable, { props: { columns, rows, rowKey: 'id' } });
    const header = () => wrapper.findAll('th')[0];
    await header().get('button').trigger('click');
    expect(names(wrapper)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    expect(header().attributes('aria-sort')).toBe('ascending');
    await header().get('button').trigger('click');
    expect(names(wrapper)).toEqual(['gamma', 'delta', 'beta', 'alpha']);
    expect(header().attributes('aria-sort')).toBe('descending');
    await header().get('button').trigger('click');
    expect(names(wrapper)).toEqual(['beta', 'alpha', 'gamma', 'delta']);
    expect(header().attributes('aria-sort')).toBe('none');
  });

  it('sorts a numeric column descending first and always puts missing values last', async () => {
    const wrapper = mountDs(DataTable, { props: { columns, rows, rowKey: 'id' } });
    const pnl = () => wrapper.findAll('th')[1].get('button');
    await pnl().trigger('click');
    expect(names(wrapper)).toEqual(['delta', 'beta', 'alpha', 'gamma']);
    await pnl().trigger('click');
    expect(names(wrapper)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });

  it('emits sort and update:sort, and follows a controlled sort prop', async () => {
    const wrapper = mountDs(DataTable, { props: { columns, rows, rowKey: 'id', sort: null } });
    await wrapper.findAll('th')[0].get('button').trigger('click');
    expect(wrapper.emitted('sort')![0]).toEqual([{ id: 'name', dir: 'asc' }]);
    expect(wrapper.emitted('update:sort')![0]).toEqual([{ id: 'name', dir: 'asc' }]);
    // Controlled: the parent has not applied it yet, the order did not change
    expect(names(wrapper)).toEqual(['beta', 'alpha', 'gamma', 'delta']);
    await wrapper.setProps({ sort: { id: 'name', dir: 'asc' } });
    expect(names(wrapper)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });

  it('leaves the order to the caller with manualSort', async () => {
    const wrapper = mountDs(DataTable, {
      props: { columns, rows, rowKey: 'id', manualSort: true, sort: { id: 'name', dir: 'asc' } },
    });
    expect(names(wrapper)).toEqual(['beta', 'alpha', 'gamma', 'delta']);
  });
});

describe('DataTable hideBelow', () => {
  const headers = (wrapper: ReturnType<typeof mountDs>) =>
    wrapper.findAll('thead tr:first-child th').map((th) => th.text());

  it('keeps every column when the width is unknown', () => {
    const wrapper = mountDs(DataTable, { props: { columns, rows, rowKey: 'id' } });
    expect(headers(wrapper)).toEqual(['Name', 'P&L', 'Wide', 'Wider']);
  });

  it('drops columns whose hideBelow is above the container width', async () => {
    const wrapper = mountDs(DataTable, {
      props: { columns, rows, rowKey: 'id', containerWidth: 1000 },
    });
    expect(headers(wrapper)).toEqual(['Name', 'P&L', 'Wide', 'Wider']);
    await wrapper.setProps({ containerWidth: 700 });
    expect(headers(wrapper)).toEqual(['Name', 'P&L', 'Wide']);
    await wrapper.setProps({ containerWidth: 400 });
    expect(headers(wrapper)).toEqual(['Name', 'P&L']);
    // Cells follow the header
    expect(wrapper.findAll('tbody tr')[0].findAll('td')).toHaveLength(2);
    expect(wrapper.attributes('data-hidden-columns')).toBe('2');
    // The threshold itself keeps the column
    await wrapper.setProps({ containerWidth: 600 });
    expect(headers(wrapper)).toEqual(['Name', 'P&L', 'Wide']);
  });
});

describe('DataTable rows', () => {
  it('renders cell slots, row classes and the sticky sum row', () => {
    const wrapper = mountDs(DataTable, {
      props: {
        columns,
        rows,
        rowKey: 'id',
        summary: { name: 'Σ live', pnl: '+14.00' },
        rowClass: (r: Row) => (r.id === 1 ? 'is-live' : undefined),
      },
      slots: {
        'cell-name': '<template #cell-name="{ row }"><b class="cn">{{ row.name }}!</b></template>',
      },
    });
    expect(wrapper.find('tr.sigma').text()).toContain('Σ live');
    expect(wrapper.find('tr.sigma').text()).toContain('+14.00');
    expect(wrapper.findAll('tbody tr')[0].classes()).toContain('is-live');
    expect(wrapper.find('.cn').text()).toBe('beta!');
  });

  it('inserts group rows when the key changes', () => {
    const wrapper = mountDs(DataTable, {
      props: { columns, rows, rowKey: 'id', groupBy: (r: Row) => r.day },
    });
    expect(wrapper.findAll('tr.grp').map((g) => g.text())).toEqual(['d1', 'd2']);
  });

  it('emits rowActivate on click and Enter', async () => {
    const wrapper = mountDs(DataTable, { props: { columns, rows, rowKey: 'id' } });
    await wrapper.findAll('tbody tr')[1].trigger('click');
    await wrapper.findAll('tbody tr')[2].trigger('keydown', { key: 'Enter' });
    const ev = wrapper.emitted('rowActivate')!;
    expect(ev[0][1]).toBe(2);
    expect(ev[1][1]).toBe(3);
  });

  it('shows the empty text', () => {
    const wrapper = mountDs(DataTable, {
      props: { columns, rows: [], rowKey: 'id', emptyText: 'No rows' },
    });
    expect(wrapper.find('tr.none').text()).toBe('No rows');
  });
});

describe('DataTable virtual scrolling', () => {
  const many: Row[] = Array.from({ length: 300 }, (_, i) => ({
    id: i,
    name: `bot${String(i).padStart(3, '0')}`,
    pnl: i,
    day: 'd',
  }));

  it('renders only a window of rows above 100 rows', () => {
    const wrapper = mountDs(DataTable, {
      props: { columns, rows: many, rowKey: 'id', rowHeight: 30 },
    });
    const rendered = wrapper.findAll('tbody tr:not(.pad)').length;
    expect(rendered).toBeLessThan(60);
    expect(rendered).toBeGreaterThan(10);
    expect(wrapper.find('tr.pad:last-child td').attributes('style')).toContain('height');
  });

  it('renders every row up to 100 rows, and when virtual is forced off', () => {
    const wrapper = mountDs(DataTable, {
      props: { columns, rows: many.slice(0, 100), rowKey: 'id' },
    });
    expect(wrapper.findAll('tbody tr:not(.pad)')).toHaveLength(100);
    const forced = mountDs(DataTable, {
      props: { columns, rows: many, rowKey: 'id', virtual: false },
    });
    expect(forced.findAll('tbody tr:not(.pad)')).toHaveLength(300);
  });

  it('moves the window with the scroll position and keeps the total height', async () => {
    const wrapper = mountDs(DataTable, {
      props: { columns, rows: many, rowKey: 'id', rowHeight: 30 },
    });
    const first = names(wrapper)[0];
    expect(first).toBe('bot000');
    const el = wrapper.element as HTMLElement;
    el.scrollTop = 30 * 150;
    await wrapper.trigger('scroll');
    await nextTick();
    const shown = names(wrapper);
    expect(shown[0]).not.toBe('bot000');
    expect(shown).toContain('bot150');
    const top = Number(
      wrapper
        .find('tr.pad td')
        .attributes('style')!
        .match(/height:\s*(\d+)px/)![1],
    );
    const bottom = Number(
      wrapper
        .find('tr.pad:last-child td')
        .attributes('style')!
        .match(/height:\s*(\d+)px/)![1],
    );
    expect(top + bottom + shown.length * 30).toBe(300 * 30);
  });
});
