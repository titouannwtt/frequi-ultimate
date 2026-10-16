import { describe, expect, it } from 'vitest';

import { makeCandles } from '@/components/fq/fixtures/charts';
import { FIXTURE_NOW } from '@/components/fq/fixtures';
import {
  ALL_OVERLAYS,
  buildCandleOption,
  fillPlan,
  levelLines,
  overlaysFromPosition,
  priceBounds,
  toCandleSet,
  type CandleOptionInput,
  type ClosedMark,
  type FillMark,
  type PendingOrder,
} from '@/components/fq/lib/candles';
import {
  closedMarks,
  entryEdge,
  frameCandles,
  gainFromPosition,
  pendingOrders,
  recentreOn,
  visibleClosed,
} from '@/components/fq/lib/chartTrades';
import { orderModel } from '@/components/fq/lib/orders';
import type { OrderRow } from '@/datasource/types';
import type { TradeRow } from '@/gateway/types.gen';

const TF = 15 * 60_000;
const tokens = new Proxy({}, { get: (_t, k) => `#${String(k)}` }) as CandleOptionInput['tokens'];

const labels = {
  average: 'Moy.',
  tp: 'TP',
  liquidation: 'Liq.',
  candles: 'Bougies',
  volume: 'Volume',
  entry: 'Entrée',
  dca: 'Ordre de sécurité',
  exit: 'Sortie',
  dcaTag: 'R',
  closedTrade: 'Trade fermé',
  pending: { dca: 'Ordre', tp: 'Take profit', stop: 'Stop', exit: 'Sortie', entry: 'Entrée' },
};

function input(over: Partial<CandleOptionInput> = {}): CandleOptionInput {
  return {
    set: toCandleSet(makeCandles(300)),
    heikinAshi: false,
    plotConfig: { main_plot: {}, subplots: {} } as never,
    rsi: false,
    overlays: {},
    toggles: ALL_OVERLAYS,
    tokens,
    labels,
    fmtPrice: (v) => v.toFixed(3),
    visibleCandles: 100,
    initialZoom: true,
    labelSide: 'right',
    heightPx: 500,
    ...over,
  };
}

type Opt = {
  series: Array<Record<string, any>>;
  yAxis: Array<Record<string, any>>;
  dataZoom: Array<Record<string, any>>;
};
const build = (over: Partial<CandleOptionInput> = {}) =>
  buildCandleOption(input(over)) as unknown as Opt;
const serie = (o: Opt, id: string) => o.series.find((s) => s.id === id);
const ts = (candlesAgo: number) => FIXTURE_NOW - candlesAgo * TF;

describe('framing of the open position', () => {
  it('widens the window to the open date with a margin, never under the default', () => {
    const f = frameCandles({ openTs: ts(300), lastTs: FIXTURE_NOW, timeframeMs: TF, base: 250 });
    expect(f.framed).toBe(true);
    expect(f.visible).toBeGreaterThanOrEqual(300 + 6);
    // A recent trade keeps the user's default window
    const recent = frameCandles({
      openTs: ts(20),
      lastTs: FIXTURE_NOW,
      timeframeMs: TF,
      base: 250,
    });
    expect(recent).toEqual({ visible: 250, framed: true });
  });

  it('leaves the window alone past a sane candle count: the edge marker takes over', () => {
    const f = frameCandles({ openTs: ts(900), lastTs: FIXTURE_NOW, timeframeMs: TF, base: 250 });
    expect(f).toEqual({ visible: 250, framed: false });
  });

  it('survives an orphan position without a date', () => {
    for (const openTs of [null, undefined, 0, Number.NaN]) {
      expect(frameCandles({ openTs, lastTs: FIXTURE_NOW, timeframeMs: TF, base: 250 }).framed).toBe(
        false,
      );
    }
  });

  it('the edge marker shows when the entry is left of the window, with its age', () => {
    const e = entryEdge(ts(900), ts(250), FIXTURE_NOW);
    expect(e?.ageMs).toBe(900 * TF);
    expect(entryEdge(ts(100), ts(250), FIXTURE_NOW)).toBeNull();
    expect(entryEdge(null, ts(250), FIXTURE_NOW)).toBeNull();
  });

  it('recentres on the entry inside the loaded candles', () => {
    const w = recentreOn({
      openTs: ts(500),
      firstTs: ts(999),
      lastTs: FIXTURE_NOW,
      spanMs: 250 * TF,
    });
    expect(w.startTs).toBeLessThan(ts(500));
    expect(w.endTs - w.startTs).toBe(250 * TF);
    // An entry older than the first candle goes to the first candle
    const old = recentreOn({
      openTs: ts(5000),
      firstTs: ts(999),
      lastTs: FIXTURE_NOW,
      spanMs: 250 * TF,
    });
    expect(old.startTs).toBe(ts(999));
  });

  it('the option starts the zoom where the caller framed it', () => {
    const narrow = build({ visibleCandles: 50 });
    const wide = build({ visibleCandles: 280 });
    expect(wide.dataZoom[0]!.start).toBeLessThan(narrow.dataZoom[0]!.start);
  });
});

describe('price range and labels', () => {
  it('keeps a margin around the lines so a label is never clipped', () => {
    const [lo, hi] = priceBounds({ min: 4.8, max: 5.0 }, [5.2, 4.8], 400);
    expect(lo).toBeLessThan(4.8);
    expect(hi).toBeGreaterThan(5.2);
    // At least the height of a label (about 30 px of 400) above the highest line
    expect((hi - 5.2) / (hi - lo)).toBeGreaterThanOrEqual(30 / 400 / 1.3);
  });

  it('puts the average entry strictly inside the axis', () => {
    const o = build({ overlays: { average: 5.6 } });
    const y = o.yAxis[0]!;
    const ext = { min: 4.6, max: 5.2 };
    expect(y.max(ext)).toBeGreaterThan(5.6);
    expect(y.min(ext)).toBeLessThan(4.6);
  });

  it('brings the orders that wait into range, a far liquidation does not stretch it', () => {
    const o = build({
      overlays: {
        pending: [{ id: 'p1', price: 4.4, kind: 'dca', n: 1 }],
        liquidation: 0.5,
      },
    });
    const y = o.yAxis[0]!;
    const ext = { min: 4.8, max: 5.2 };
    expect(y.min(ext)).toBeLessThan(4.4);
    expect(y.min(ext)).toBeGreaterThan(3);
  });

  it('writes the labels on the side of the line chosen for them', () => {
    const lines = levelLines(
      { average: 5, pending: [{ id: 'a', price: 4.5, kind: 'dca', n: 2 }] },
      ALL_OVERLAYS,
      tokens,
      labels,
    );
    expect(lines.map((l) => [l.id, l.label, l.side])).toEqual([
      ['pend:a', 'Ordre R2', 'start'],
      ['avg', 'Moy.', 'end'],
    ]);
  });
});

const row = (o: Partial<OrderRow> & { id: number }): OrderRow => ({
  side: 'buy',
  is_entry: true,
  status: 'closed',
  is_open: false,
  filled: 1,
  amount: 1,
  average: 5,
  cost: 5,
  filled_ms: ts(10),
  tag: null,
  price: null,
  ...o,
});

describe('filled orders of the open trade', () => {
  const rows: OrderRow[] = [
    row({ id: 1, average: 5.0, cost: 100, filled_ms: ts(120) }),
    row({ id: 2, average: 4.8, cost: 150, filled_ms: ts(80) }),
    row({ id: 3, average: 4.6, cost: 225, filled_ms: ts(40) }),
  ];

  it('draws the entry and each DCA numbered R1, R2 with amount, price and cost', () => {
    const model = orderModel(rows, 'long');
    const o = build({ overlays: { fills: model.fills, average: 4.8 } });
    const data = serie(o, 'fills')!.data as Array<Record<string, any>>;
    expect(data.map((d) => d.name)).toEqual(['E', 'R1', 'R2']);
    expect(data.map((d) => d.value[1])).toEqual([5.0, 4.8, 4.6]);
    // A long buys: triangles pointing up, the label under the marker
    expect(new Set(data.map((d) => d.symbol)).size).toBe(1);
    expect(data[0]!.label.position).toBe('bottom');
    expect(data[1]!.tip).toContain('150.00');
    expect(data[1]!.tip).toContain('4.800');
  });

  it('mirrors a short: sells are triangles pointing down, labels above', () => {
    const shortRows = rows.map((r) => ({ ...r, side: 'sell' }));
    const longModel = orderModel(rows, 'long');
    const shortModel = orderModel(shortRows, 'short');
    const l = serie(build({ overlays: { fills: longModel.fills } }), 'fills')!.data[0];
    const s = serie(build({ overlays: { fills: shortModel.fills } }), 'fills')!.data[0];
    expect(s.symbol).not.toBe(l.symbol);
    expect(s.label.position).toBe('top');
  });

  it('a partial exit is green past the average entry, red under it (long), the other way for a short', () => {
    const fills: FillMark[] = [
      { ts: ts(5), price: 5.5, kind: 'exit', side: 'long', label: 'S' },
      { ts: ts(4), price: 4.2, kind: 'exit', side: 'long', label: 'S' },
    ];
    const pos = { pair: 'X', open_rate: 4.8, liquidation_price: null, side: 'long' as const };
    const o = overlaysFromPosition(pos as never, 'X', { fills });
    expect(o.fills!.map((f) => f.win)).toEqual([true, false]);
    const s = overlaysFromPosition({ ...pos, side: 'short' } as never, 'X', { fills });
    expect(s.fills!.map((f) => f.win)).toEqual([false, true]);
  });

  it('the Fills chip hides the markers', () => {
    const model = orderModel(rows, 'long');
    const o = build({
      overlays: { fills: model.fills },
      toggles: { ...ALL_OVERLAYS, fills: false },
    });
    expect(serie(o, 'fills')).toBeUndefined();
  });
});

describe('orders that wait', () => {
  const filled = [row({ id: 1 }), row({ id: 2, filled_ms: ts(5) })];

  it('names a DCA, a take profit and a stop', () => {
    const rows = [
      ...filled,
      row({
        id: 3,
        is_open: true,
        filled: null,
        status: 'open',
        average: null,
        price: 4.5,
        filled_ms: null,
      }),
      row({
        id: 4,
        side: 'sell',
        is_entry: false,
        is_open: true,
        filled: null,
        status: 'open',
        average: null,
        price: 5.4,
        filled_ms: null,
      }),
      row({
        id: 5,
        side: 'stoploss',
        is_entry: false,
        is_open: true,
        filled: null,
        status: 'open',
        average: null,
        price: 4.0,
        filled_ms: null,
      }),
    ];
    const p = pendingOrders(rows, 'long', 4.9);
    expect(p.map((x) => [x.kind, x.price, x.n])).toEqual([
      ['dca', 4.5, 2],
      ['tp', 5.4, undefined],
      ['stop', 4.0, undefined],
    ]);
  });

  it('a short take profit sits under the average', () => {
    const rows = [
      row({ id: 1, side: 'sell' }),
      row({
        id: 2,
        side: 'buy',
        is_entry: false,
        is_open: true,
        filled: null,
        average: null,
        price: 4.4,
      }),
    ];
    expect(pendingOrders(rows, 'short', 5)[0]!.kind).toBe('tp');
  });

  it('drops an open order whose price nobody knows, never guesses one', () => {
    const rows = [row({ id: 1, is_open: true, filled: null, average: null, price: null })];
    expect(pendingOrders(rows, 'long', 5)).toEqual([]);
  });

  it('draws one dashed line per pending order and no duplicate ladder level', () => {
    const pending: PendingOrder[] = [{ id: 'p3', price: 4.5, kind: 'dca', n: 2 }];
    const pos = { pair: 'X', open_rate: 4.9, liquidation_price: null };
    const ladder = [
      { id: 'o1', label: 'E', price: 5, stake: 1, state: 'filled' },
      { id: 'o2', label: 'SO1', price: 4.8, stake: 1, state: 'filled' },
      { id: 'o3', label: 'SO2', price: 4.5, stake: 1, state: 'next' },
    ] as never;
    const o = overlaysFromPosition(pos as never, 'X', { orders: ladder, pending });
    expect(o.safetyOrders!.map((s) => s.label)).toEqual(['SO1']);
    // Until the prices are known, the ladder keeps its pending levels
    const before = overlaysFromPosition(pos as never, 'X', { orders: ladder, pending: null });
    expect(before.safetyOrders!.map((s) => s.label)).toEqual(['SO1', 'SO2']);
    const line = serie(build({ overlays: o }), 'candles')!.markLine.data.find(
      (d: any) => d.name === 'pend:p3',
    );
    expect(line.lineStyle.type).toBe('dashed');
    expect(line.label.formatter).toContain('Ordre R2');
  });
});

describe('current gain', () => {
  const position = {
    open_rate: 4.9,
    current_rate: 4.75,
    profit_abs: -12.34,
    profit_ratio: -0.0306,
    open_ms: ts(200),
  };

  it('reads the profit of the position at its current price', () => {
    expect(gainFromPosition(position, null)).toEqual({
      price: 4.75,
      entry: 4.9,
      sinceTs: ts(200),
      profitAbs: -12.34,
      profitPct: -3.06,
    });
    expect(
      gainFromPosition({ ...position, profit_abs: null, profit_ratio: null } as never, 5),
    ).toBeNull();
    expect(gainFromPosition(null, 5)).toBeNull();
  });

  it('draws the figure at the last price and a band to the average entry, red when it loses', () => {
    const g = gainFromPosition(position, null)!;
    const o = build({ overlays: { average: 4.9, gain: g } });
    const candles = serie(o, 'candles')!;
    const label = candles.markPoint.data[0];
    expect(label.label.formatter).toBe('-12.34 USDC · -3.06%');
    expect(label.label.backgroundColor).toBe('#loss');
    expect(candles.markPoint.data[0].coord[1]).toBe(4.75);
    const [from, to] = candles.markArea.data[0];
    expect(from.yAxis).toBe(4.9);
    expect(to.yAxis).toBe(4.75);
    expect(to.xAxis).toBeGreaterThan(from.xAxis);
  });

  it('is green when the position makes money, and the chip hides it', () => {
    const g = { ...gainFromPosition(position, null)!, profitAbs: 3, profitPct: 1 };
    const o = build({ overlays: { gain: g } });
    expect(serie(o, 'candles')!.markPoint.data[0].label.backgroundColor).toBe('#profit');
    const off = build({ overlays: { gain: g }, toggles: { ...ALL_OVERLAYS, gain: false } });
    expect(serie(off, 'candles')!.markPoint).toBeUndefined();
  });

  it('falls back on the last close when the position has no current rate', () => {
    const g = gainFromPosition({ ...position, current_rate: null } as never, null)!;
    expect(g.price).toBeNull();
    const o = build({ overlays: { gain: g } });
    expect(serie(o, 'candles')!.markPoint.data[0].coord[1]).toBeGreaterThan(0);
  });
});

describe('closed trades', () => {
  const trade = (id: number, over: Partial<TradeRow>): TradeRow =>
    ({
      bot_key: 'local:9400',
      trade_id: id,
      pair: 'X',
      market: 'perp',
      side: 'long',
      mode: 'live',
      leverage: 2,
      open_ms: ts(120),
      close_ms: ts(100),
      open_rate: 5,
      close_rate: 5.2,
      amount: 1,
      stake_amount: 10,
      profit_abs: 1.5,
      profit_ratio: 0.04,
      profit_unknown: false,
      exit_reason: { raw: 'roi', kind: 'roi', class: 'profit' },
      enter_tag: null,
      ...over,
    }) as TradeRow;
  const reason = (r: { kind: string; raw: string }) => (r.kind === 'roi' ? 'Objectif' : r.raw);

  const marks = closedMarks(
    [
      trade(1, {}),
      trade(2, {
        open_ms: ts(90),
        close_ms: ts(60),
        close_rate: 4.8,
        profit_abs: -2,
        profit_ratio: -0.05,
        exit_reason: { raw: 'my_stop', kind: 'custom', class: 'other' },
      }),
      trade(3, { pair: 'OTHER' }),
      trade(4, { close_ms: null }),
      trade(5, { close_rate: null }),
      trade(6, {
        profit_unknown: true,
        profit_abs: null,
        profit_ratio: null,
        open_ms: ts(50),
        close_ms: ts(40),
      }),
    ],
    'X',
    reason as never,
  );

  it('keeps the closed trades of this pair with a time and a price, oldest first', () => {
    expect(marks.map((m) => m.id)).toEqual(['local:9400/1', 'local:9400/2', 'local:9400/6']);
    expect(marks[0]).toMatchObject({ profitAbs: 1.5, profitPct: 4, exitReason: 'Objectif' });
    expect(marks[1]!.exitReason).toBe('my_stop');
    expect(marks[2]).toMatchObject({ profitAbs: null, profitPct: null });
  });

  it('draws entry and exit joined by a dashed segment, green for a win and red for a loss', () => {
    const o = build({ overlays: { closed: marks } });
    const s = serie(o, 'closed')!;
    expect(s.data).toHaveLength(6);
    expect(s.markLine.data).toHaveLength(3);
    const style = (i: number) => s.markLine.data[i][0].lineStyle;
    expect(style(0)).toMatchObject({ color: '#profit', type: 'dashed' });
    expect(style(1)).toMatchObject({ color: '#loss', type: 'dashed' });
    // The unknown result is neither green nor red
    expect(style(2).color).toBe('#fg3');
    const exit = s.data[1];
    expect(exit.label.formatter).toBe('+1.50');
    expect(exit.tip).toContain('Objectif');
    expect(exit.tip).toContain('Trade fermé');
  });

  it('a short is mirrored: it enters on a sell and exits on a buy', () => {
    const long = serie(build({ overlays: { closed: marks } }), 'closed')!.data[0].symbol;
    const sm = closedMarks([trade(9, { side: 'short', close_rate: 4.8 })], 'X', reason as never);
    const short = serie(build({ overlays: { closed: sm } }), 'closed')!.data[0].symbol;
    expect(short).not.toBe(long);
  });

  it('cuts a trade that started before the loaded candles and drops one outside', () => {
    const m = (o: Partial<ClosedMark>): ClosedMark => ({ ...marks[0]!, ...o });
    const cut = visibleClosed(m({ openTs: 0 + 1000, closeTs: 3000 }), 2000, 5000)!;
    expect(cut.showOpen).toBe(false);
    expect(cut.showClose).toBe(true);
    expect(cut.a[0]).toBe(2000);
    expect(visibleClosed(m({ openTs: 1000, closeTs: 1500 }), 2000, 5000)).toBeNull();
    expect(visibleClosed(m({ openTs: 6000, closeTs: 7000 }), 2000, 5000)).toBeNull();
  });

  it('the Closed trades chip hides them, and a custom reason is escaped in the tooltip', () => {
    const off = build({ overlays: { closed: marks }, toggles: { ...ALL_OVERLAYS, closed: false } });
    expect(serie(off, 'closed')).toBeUndefined();
    const evil = closedMarks(
      [trade(7, { exit_reason: { raw: '<img src=x>', kind: 'custom', class: 'other' } })],
      'X',
      reason as never,
    );
    const tip = serie(build({ overlays: { closed: evil } }), 'closed')!.data[0].tip as string;
    expect(tip).not.toContain('<img');
  });

  it('closed trades alone are drawn on a pair without an open position', () => {
    const o = overlaysFromPosition(null, 'X', { closed: marks });
    expect(o).toEqual({ closed: marks });
    expect(overlaysFromPosition(null, 'X')).toEqual({});
  });
});

describe('open position of an orphan or netted wallet', () => {
  it('does not break the chart without a date, a rate or an order', () => {
    const pos = { pair: 'X', open_rate: 0, liquidation_price: null, open_ms: 0, side: 'short' };
    const o = overlaysFromPosition(pos as never, 'X', {
      orders: [],
      fills: [],
      pending: [],
      gain: gainFromPosition(
        { open_rate: 0, current_rate: null, profit_abs: null, profit_ratio: 0.01, open_ms: 0 },
        null,
      ),
    });
    expect(o.openTs).toBeNull();
    const opt = build({ overlays: o });
    expect(serie(opt, 'candles')).toBeDefined();
  });
});

describe('closed trades off the price scale', () => {
  it('leaves out a trade priced outside every loaded candle', () => {
    const base: ClosedMark = {
      id: 'b/1',
      side: 'long',
      openTs: ts(80),
      openPrice: 4.9,
      closeTs: ts(60),
      closePrice: 5,
      profitAbs: 1,
      profitPct: 2,
      exitReason: '',
    };
    const off: ClosedMark = { ...base, id: 'b/2', openPrice: 390, closePrice: 380 };
    const o = build({ overlays: { closed: [base, off] } });
    expect(serie(o, 'closed')!.markLine.data).toHaveLength(1);
  });
});

type FillData = { tip: string; label: { formatter: string; show: boolean; offset: number[] } };

describe('merged execution markers keep every top-up on hover (B394)', () => {
  const fill = (n: number, candlesAgo: number, price: number): FillMark => ({
    ts: ts(candlesAgo),
    price,
    kind: 'dca',
    side: 'long',
    label: `SO${n}`,
    n,
    amount: n,
    cost: 10 * n,
  });
  it('the first marker writes "R1-2" and its tooltip lists both; the second writes nothing', () => {
    const fills = [fill(1, 20, 100), fill(2, 12, 103)];
    const px = [
      { x: 900, y: 300 },
      { x: 906, y: 296 },
    ];
    const plan = fillPlan(fills, 'R', TF, 4, px);
    const o = build({ overlays: { fills }, fillPlan: plan });
    const data = serie(o, 'fills')!.data as FillData[];
    expect(data[0]!.label.formatter).toBe('R1-2');
    expect(data[1]!.label.show).toBe(false);
    // Each top-up is still readable: both ranks and both prices are in the first marker's tooltip
    expect(data[0]!.tip).toContain('R1');
    expect(data[0]!.tip).toContain('R2');
    expect(data[0]!.tip).toContain('100.000');
    expect(data[0]!.tip).toContain('103.000');
    // The marker that wrote nothing keeps its own tooltip
    expect(data[1]!.tip).toContain('R2');
  });
  it('a top-up merged by time and price also writes nothing on its own (no fallback to its tag)', () => {
    const fills = [fill(1, 20, 100), fill(2, 20, 100)];
    const data = serie(build({ overlays: { fills } }), 'fills')!.data as FillData[];
    expect(data[0]!.label.formatter).toBe('R1-2');
    expect(data[1]!.label.show).toBe(false);
  });
  it('an entry hidden under a top-up is named in its tooltip and its tag is pushed away', () => {
    const fills: FillMark[] = [
      { ts: ts(20), price: 100, kind: 'entry', side: 'long', label: 'E', amount: 1, cost: 10 },
      fill(1, 20, 100),
    ];
    const px = [
      { x: 900, y: 300 },
      { x: 900, y: 300 },
    ];
    const o = build({ overlays: { fills }, fillPlan: fillPlan(fills, 'R', TF, 4, px) });
    const data = serie(o, 'fills')!.data as FillData[];
    expect(data[0]!.tip).toContain('R1');
    expect(data[1]!.tip).toContain('E');
    expect(data[0]!.label.offset).toEqual([0, 0]);
    expect(data[1]!.label.offset).toEqual([0, 12]);
  });
});
