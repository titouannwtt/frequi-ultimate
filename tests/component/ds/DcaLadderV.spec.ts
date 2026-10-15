import { describe, expect, it } from 'vitest';
import DcaLadderV from '../../../src/components/ds/DcaLadderV.vue';
import type { LadderOrder } from '../../../src/components/ds/lib/ladder';
import { mountDs } from './helpers';

const orders: LadderOrder[] = [
  { id: 'e', label: 'Entry', price: 184.2, stake: 14, state: 'filled' },
  { id: 's1', label: 'SO1', price: 179.6, stake: 20, state: 'filled' },
  { id: 's2', label: 'SO2', price: 175.1, stake: 29, state: 'next' },
  { id: 's3', label: 'SO3', price: 170.7, stake: 42, state: 'pending' },
];

function labelPositions(wrapper: ReturnType<typeof mountDs>) {
  return wrapper.findAll('.ln').map((ln) => {
    const lineTop = parseFloat(ln.attributes('style')!.match(/top:\s*([\d.-]+)px/)![1]);
    const labelOffset = parseFloat(
      ln
        .get('span')
        .attributes('style')!
        .match(/top:\s*([\d.-]+)px/)![1],
    );
    return {
      kind: ln.classes().find((c) => ['tp', 'avg', 'px'].includes(c))!,
      lineTop,
      labelTop: lineTop + labelOffset,
    };
  });
}

describe('DcaLadderV', () => {
  it('renders one row per order with filled, next and pending states', () => {
    const wrapper = mountDs(DcaLadderV, {
      props: { orders, position: { price: 176, avg: 180, tp: 183 } },
    });
    const rows = wrapper.findAll('.lvl');
    expect(rows).toHaveLength(4);
    expect(rows[0].classes()).not.toContain('pend');
    expect(rows[2].classes()).toContain('next');
    expect(rows[3].classes()).toContain('pend');
    expect(rows[3].text()).toContain('pending');
  });

  it('keeps the three level labels at least 15 px apart when the prices are almost equal', () => {
    // price, average and TP within 0.1 of each other: the lines collide, the labels must not
    const wrapper = mountDs(DcaLadderV, {
      props: { orders, position: { price: 179.0, avg: 179.05, tp: 179.1 } },
    });
    const pos = labelPositions(wrapper);
    expect(pos).toHaveLength(3);
    const sorted = [...pos].sort((a, b) => a.labelTop - b.labelTop);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].labelTop - sorted[i - 1].labelTop).toBeGreaterThanOrEqual(15 - 1e-6);
    }
    // The lines themselves keep their exact positions
    const lineTops = pos.map((p) => p.lineTop);
    expect(new Set(lineTops).size).toBeLessThanOrEqual(3);
  });

  it('leaves labels where they are when they are already far apart', () => {
    const wrapper = mountDs(DcaLadderV, {
      props: { orders, position: { price: 172, avg: 180, tp: 190 } },
    });
    for (const p of labelPositions(wrapper)) {
      expect(p.labelTop).toBeCloseTo(p.lineTop, 5);
    }
  });

  it('shows the liquidation footer with the distance', () => {
    const wrapper = mountDs(DcaLadderV, {
      props: {
        orders,
        position: {
          price: 176,
          avg: 180,
          tp: 183,
          liquidation: 112.4,
          liquidationDistancePct: 36.9,
        },
      },
    });
    expect(wrapper.get('.liqf').text()).toContain('112.40');
    expect(wrapper.get('.liqf').text()).toContain('36.9%');
  });
});
