import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LadderOrder } from '../../../src/components/ds';
import TradeDrawerBody from '../../../src/components/fq/TradeDrawerBody.vue';
import type { Position } from '../../../src/gateway/types.gen';
import { mountFq, setFqLocale, setupWorld, teardownWorld, type FqWorld } from './helpers';

/**
 * The trade drawer says three things in sentences (target exit, next top-up, liquidation), each
 * with its distance in percent, and the top-up bar says how much of the ladder is used and how
 * much money it commits (05 section 2.4).
 */
let world: FqWorld;
let base: Position;

beforeEach(() => {
  world = setupWorld();
  base = world.fixture.positions.find((p) => !p.orphan && p.current_rate != null)!;
});
afterEach(teardownWorld);

const position = (over: Partial<Position>): Position =>
  ({
    ...base,
    current_rate: 100,
    dca_entries: 2,
    liquidation_price: 60,
    liq_distance_pct: 40,
    ...over,
  }) as Position;

const ladder: LadderOrder[] = [
  { id: 'o1', label: 'E', price: 100, stake: 100, state: 'filled' },
  { id: 'o2', label: 'SO1', price: 97, stake: 150, state: 'filled' },
  { id: 'o3', label: 'SO2', price: 94, stake: 225, state: 'next' },
  { id: 'o4', label: 'SO3', price: 91, stake: 337.5, state: 'pending' },
];

function mountBody(p: Position, extra: Record<string, unknown> = {}) {
  return mountFq(TradeDrawerBody, {
    props: { position: p, orders: ladder, ...extra },
    attachTo: document.body,
  });
}
const row = (w: ReturnType<typeof mountBody>, k: string) =>
  w.get(`[data-sentence=${k}]`).text().replace(/\s+/g, ' ');

describe('trade drawer sentences', () => {
  it('a long: the target is above, the next top-up below, the liquidation below', () => {
    const w = mountBody(position({ side: 'long' }), { tp: 102.7, nextSo: 94 });
    expect(row(w, 'target')).toContain('Target exit at 102.7');
    expect(row(w, 'target')).toContain('the price has to rise by 2.70%');
    expect(row(w, 'refill')).toContain('Next top-up at 94');
    expect(row(w, 'refill')).toContain('if the price falls by another 6.0%');
    expect(row(w, 'liq')).toContain('Liquidation far away');
    expect(row(w, 'liq')).toContain('at 60.000, 40.0% below the price');
  });

  it('a short: the target is below, the next top-up above, the liquidation above', () => {
    const w = mountBody(position({ side: 'short', liquidation_price: 140 }), {
      tp: 97.3,
      nextSo: 106,
    });
    expect(row(w, 'target')).toContain('the price has to fall by 2.70%');
    expect(row(w, 'refill')).toContain('if the price rises by another 6.0%');
    expect(row(w, 'liq')).toContain('40.0% above the price');
  });

  it('the liquidation is told apart as far, to watch or close', () => {
    expect(row(mountBody(position({ liq_distance_pct: 45 })), 'liq')).toContain(
      'Liquidation far away',
    );
    expect(row(mountBody(position({ liq_distance_pct: 22 })), 'liq')).toContain(
      'Liquidation to watch',
    );
    const near = mountBody(position({ liq_distance_pct: 9 }));
    expect(row(near, 'liq')).toContain('Liquidation close');
    expect(near.get('[data-sentence=liq]').classes()).toContain('crit');
  });

  it('a level the price has already passed is said so, never shown as a negative distance', () => {
    const w = mountBody(position({ side: 'long' }), { tp: 98 });
    expect(row(w, 'target')).toContain('already past this level');
    expect(row(w, 'target')).not.toMatch(/-\d/);
  });

  it('an unknown level is an icon with its reason, not an invented number', () => {
    const w = mountBody(position({}), { tp: null, orders: [], ordersLoading: false });
    expect(w.get('[data-sentence=target]').find('[data-state="unavailable"]').exists()).toBe(true);
    expect(row(w, 'target')).toBe('Target exitNot provided by this bot');
  });

  it('is written in French too', () => {
    setFqLocale('fr');
    try {
      const w = mountBody(position({ side: 'long' }), { tp: 102.7, nextSo: 94 });
      expect(row(w, 'target')).toContain('Sortie visée à');
      expect(row(w, 'refill')).toContain('Prochain renfort à');
      expect(row(w, 'liq')).toContain('Liquidation loin');
    } finally {
      setFqLocale('en');
    }
  });

  it('the top-up bar: used out of planned, committed out of the maximum', () => {
    const w = mountBody(position({ dca_entries: 2 }), { tp: 102 });
    const bar = w.get('[data-testid=drawer-refills]');
    // The entry and one top-up are filled: one top-up used out of three
    expect(bar.text()).toContain('Top-ups used: 1 of 3');
    expect(bar.findAll('.rail i')).toHaveLength(4);
    expect(bar.findAll('.rail i.f')).toHaveLength(2);
    expect(bar.text()).toContain('250.00 committed');
    expect(bar.text()).toContain('up to 812.50 if everything fills');
  });

  it('a ladder of filled orders only says what happened, not an invented maximum', () => {
    const filled = ladder.slice(0, 2).map((o) => ({ ...o, state: 'filled' as const }));
    const w = mountBody(position({ dca_entries: 2 }), { orders: filled });
    const bar = w.get('[data-testid=drawer-refills]');
    expect(bar.text()).toContain('Top-ups used: 1');
    expect(bar.text()).not.toContain(' of ');
    expect(bar.find('.rail').exists()).toBe(false);
    expect(bar.text()).toContain('250.00 committed');
    expect(bar.text()).not.toContain('up to');
  });

  it('notional, stake and the orders are folded under Details', () => {
    const w = mountBody(position({}));
    const details = w.get('[data-testid=drawer-details]');
    expect(details.element.tagName).toBe('DETAILS');
    expect(details.attributes('open')).toBeUndefined();
    expect(details.text()).toContain('Notional');
    expect(details.text()).toContain('Stake');
    expect(details.text()).toContain('Top-up 2');
  });
});

describe('trade drawer wording (QA of the friendlier build)', () => {
  it('a level the bot does not give is a visible phrase, not only an icon', () => {
    const w = mountBody(position({}), { tp: null, nextSo: null, orders: [], ordersLoading: false });
    const t = w.get('[data-sentence=target]');
    expect(t.get('[data-testid=drawer-missing]').text()).toBe('Not provided by this bot');
    const r = w.get('[data-sentence=refill]');
    expect(r.get('[data-testid=drawer-missing]').text()).toBe('Not provided by this bot');
  });

  it('is said in French too', () => {
    setFqLocale('fr');
    try {
      const w = mountBody(position({}), { tp: null, orders: [], ordersLoading: false });
      expect(w.get('[data-sentence=target] [data-testid=drawer-missing]').text()).toBe(
        'Non fourni par ce bot',
      );
    } finally {
      setFqLocale('en');
    }
  });

  it('the next top-up comes with its price and its distance when the ladder knows it', () => {
    const w = mountBody(position({ side: 'long' }), { tp: null });
    expect(row(w, 'refill')).toContain('Next top-up at 94');
    expect(row(w, 'refill')).toContain('6.0%');
  });

  it('a long duration says "long", never P98', () => {
    const w = mountBody(position({ percentile: 98 }));
    const d = w.get('[data-testid=drawer-long]');
    expect(d.text()).toBe('longer than usual');
    expect(w.text()).not.toMatch(/\bP9\d\b/i);
    expect(d.attributes('title')).toContain('98');
  });

  it('the orders of the details say Top-up 2, not SO2', () => {
    const w = mountBody(position({}));
    const details = w.get('[data-testid=drawer-details]').text();
    expect(details).toContain('Top-up 2');
    expect(details).not.toContain('SO2');
  });
});
