/**
 * Layout helpers of the DCA ladders (docs/redesign/02-design.md, section 5.1).
 */

export interface LabelInput {
  id: string;
  y: number;
}

export interface LabelOutput extends LabelInput {
  /** Final vertical position of the label, never closer than `minGap` to its neighbour. */
  labelY: number;
}

/**
 * Anti-overlap of labels along a vertical axis. The lines keep their exact `y`; the labels are
 * pushed down so two neighbours are always at least `minGap` px apart (15 px in the design).
 * When `maxY` is given and the stack would run past it, it is shifted back up.
 * The result keeps the order of the input.
 */
export function spreadLabels(items: LabelInput[], minGap = 15, maxY?: number): LabelOutput[] {
  const sorted = items.map((item, index) => ({ item, index })).sort((a, b) => a.item.y - b.item.y);
  const placed = sorted.map(({ item }) => item.y);
  for (let i = 1; i < placed.length; i++) {
    if (placed[i] - placed[i - 1] < minGap) {
      placed[i] = placed[i - 1] + minGap;
    }
  }
  if (maxY !== undefined && placed.length > 0 && placed[placed.length - 1] > maxY) {
    placed[placed.length - 1] = maxY;
    for (let i = placed.length - 2; i >= 0; i--) {
      placed[i] = Math.min(placed[i], placed[i + 1] - minGap);
    }
  }
  const out: LabelOutput[] = new Array(items.length);
  sorted.forEach(({ item, index }, k) => {
    out[index] = { ...item, labelY: placed[k] };
  });
  return out;
}

export type LadderOrderState = 'filled' | 'next' | 'pending';

export interface LadderOrder {
  id: string;
  label: string;
  price: number;
  stake: number;
  state: LadderOrderState;
}

export type LadderLineKind = 'tp' | 'avg' | 'px';

export interface LadderLineInput {
  kind: LadderLineKind;
  price: number;
  text: string;
}

export interface LadderLayout {
  height: number;
  rows: (LadderOrder & { y: number; widthPct: number })[];
  lines: { kind: LadderLineKind; y: number; labelY: number; text: string }[];
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export const LADDER_ROW_H = 28;
export const LADDER_TOP = 4;
export const LADDER_LABEL_GAP = 15;

/**
 * Vertical position of a price: piecewise-linear over the row centres of the orders (prices run
 * away from the entry, up for a short and down for a long), clamped inside the ladder.
 */
export function priceToY(price: number, orders: LadderOrder[], rowH = LADDER_ROW_H): number {
  const top = LADDER_TOP;
  const centre = (k: number) => top + rowH / 2 + k * rowH;
  const lo = 2;
  const hi = top + orders.length * rowH - 2;
  if (orders.length === 0) {
    return lo;
  }
  if (orders.length === 1) {
    return centre(0);
  }
  const prices = orders.map((o) => o.price);
  let k = 0;
  // Pick the segment containing the price, otherwise the end segment on the closer side
  const ascending = prices[prices.length - 1] >= prices[0];
  const first = ascending ? prices[0] : prices[prices.length - 1];
  const last = ascending ? prices[prices.length - 1] : prices[0];
  if (price <= first) {
    k = ascending ? 0 : prices.length - 2;
  } else if (price >= last) {
    k = ascending ? prices.length - 2 : 0;
  } else {
    for (let i = 0; i < prices.length - 1; i++) {
      const a = prices[i];
      const b = prices[i + 1];
      if ((price >= a && price <= b) || (price <= a && price >= b)) {
        k = i;
        break;
      }
    }
  }
  const a = prices[k];
  const b = prices[k + 1];
  const t = b === a ? 0 : (price - a) / (b - a);
  const y = centre(k) + t * rowH;
  return Math.max(lo, Math.min(hi, y));
}

/** Full layout of the vertical ladder: rows, bar widths, level lines and de-overlapped labels. */
export function layoutLadderV(
  orders: LadderOrder[],
  lines: LadderLineInput[],
  rowH = LADDER_ROW_H,
): LadderLayout {
  const maxStake = Math.max(1e-9, ...orders.map((o) => o.stake));
  const rows = orders.map((o, k) => ({
    ...o,
    y: LADDER_TOP + rowH / 2 + k * rowH,
    widthPct: Math.max(4, Math.round((o.stake / maxStake) * 48)),
  }));
  const placed = lines.map((l) => ({
    kind: l.kind,
    text: l.text,
    y: round2(priceToY(l.price, orders, rowH)),
  }));
  const spread = spreadLabels(
    placed.map((p) => ({ id: p.kind, y: p.y })),
    LADDER_LABEL_GAP,
    LADDER_TOP + orders.length * rowH,
  );
  return {
    height: LADDER_TOP * 2 + orders.length * rowH,
    rows,
    lines: placed.map((p, i) => ({ ...p, labelY: round2(spread[i].labelY) })),
  };
}
