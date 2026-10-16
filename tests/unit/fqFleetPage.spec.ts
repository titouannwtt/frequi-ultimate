import { describe, expect, it } from 'vitest';

import { buildEquityOption } from '../../src/components/fq/lib/equity';
import {
  alertsInScope,
  isLongerThanUsual,
  liqWord,
  safetyOrders,
  safetyOrdersMax,
  verdictOf,
  watchSelection,
} from '../../src/components/fq/lib/fleetPage';
import { riskLevel } from '../../src/components/fq/lib/risk';
import type { TradeLine } from '../../src/components/fq/lib/trades';
import type { Alert } from '../../src/gateway/types.gen';

const alert = (severity: Alert['severity'], bot: string | null = 'b1'): Alert =>
  ({ id: `${severity}-${bot}`, severity, bot_key: bot }) as Alert;

const line = (key: string, pnl: number | null): TradeLine =>
  ({ key, pnlAbs: pnl }) as unknown as TradeLine;

describe('the verdict of the Fleet', () => {
  it('is calm without an alert, and an info alert does not trouble it', () => {
    expect(verdictOf([])).toEqual({ level: 'calm', n: 0 });
    expect(verdictOf([alert('info')])).toEqual({ level: 'calm', n: 0 });
  });
  it('counts the warnings: one, or several', () => {
    expect(verdictOf([alert('warning')])).toEqual({ level: 'one', n: 1 });
    expect(verdictOf([alert('warning'), alert('warning', 'b2'), alert('info')])).toEqual({
      level: 'many',
      n: 2,
    });
  });
  it('a critical alert wins and counts only the critical ones', () => {
    expect(verdictOf([alert('warning'), alert('critical'), alert('critical', 'b2')])).toEqual({
      level: 'critical',
      n: 2,
    });
  });
});

describe('the alerts of the scope', () => {
  const modes: Record<string, 'live' | 'dry'> = { l: 'live', d: 'dry' };
  const list = [alert('warning', 'l'), alert('warning', 'd'), alert('critical', null)];
  it('keeps the wallet alerts and those of the bots of the mode', () => {
    const modeOf = (k: string) => modes[k] ?? null;
    expect(alertsInScope(list, modeOf, 'live').map((a) => a.bot_key)).toEqual(['l', null]);
    expect(alertsInScope(list, modeOf, 'dry').map((a) => a.bot_key)).toEqual(['d', null]);
    expect(alertsInScope(list, modeOf, 'all')).toHaveLength(3);
  });
  it('never hides an alert whose bot is not known yet', () => {
    expect(alertsInScope([alert('warning', 'x')], () => null, 'live')).toHaveLength(1);
  });
});

describe('the positions to watch', () => {
  it('takes the worst five, an unknown result last', () => {
    const lines = [line('a', 3), line('b', -4), line('c', null), line('d', -1), line('e', 0)];
    const sel = watchSelection(lines, 3);
    expect(sel.top.map((l) => l.key)).toEqual(['b', 'd', 'e']);
    expect(sel.total).toBe(5);
    expect(sel.losing).toBe(true);
  });
  it('says "gain the least" when nothing loses', () => {
    expect(watchSelection([line('a', 3), line('b', 1)], 5).losing).toBe(false);
    expect(watchSelection([], 5)).toEqual({ top: [], total: 0, losing: false });
  });
});

describe('the facts in words', () => {
  it('counts the safety orders without the first entry', () => {
    expect(safetyOrders({ dcaFilled: 1 })).toBe(0);
    expect(safetyOrders({ dcaFilled: 3 })).toBe(2);
    expect(safetyOrdersMax({ dcaMax: null })).toBeNull();
    expect(safetyOrdersMax({ dcaMax: 5 })).toBe(4);
  });
  it('words the liquidation distance with the thresholds of the alert', () => {
    expect(liqWord(null)).toBeNull();
    expect(liqWord(49)).toBe('far');
    expect(liqWord(24.9)).toBe('watch');
    expect(liqWord(14.9)).toBe('near');
  });
  it('flags a duration that is long for this bot', () => {
    expect(isLongerThanUsual({ percentile: 50 })).toBe(false);
    expect(isLongerThanUsual({ percentile: 90 })).toBe(true);
    expect(isLongerThanUsual({ percentile: null })).toBe(false);
  });
});

describe('the wallet risk in one word', () => {
  const base = {
    nearest: { pair: 'OP', botKey: 'b', distancePct: 47 },
    orphans: [],
    exposure: { long: 100, short: 50, net: 50, grossNetted: 150, netted: true },
  };
  it('is flat without any exposure', () => {
    expect(
      riskLevel({ ...base, nearest: null, exposure: { ...base.exposure, long: 0, short: 0 } }, 0),
    ).toBe('flat');
  });
  it('is moderate when everything is far', () => {
    expect(riskLevel(base, 30)).toBe('moderate');
  });
  it('is high for a close liquidation, an orphan or a margin at 85 %', () => {
    expect(riskLevel({ ...base, nearest: { ...base.nearest, distancePct: 20 } }, 30)).toBe('high');
    expect(
      riskLevel({ ...base, orphans: [{ pair: 'X', coin: 'X', side: 'long', notional: 1 }] }, 30),
    ).toBe('high');
    expect(riskLevel(base, 85)).toBe('high');
  });
  it('is critical under 15 % of the liquidation', () => {
    expect(riskLevel({ ...base, nearest: { ...base.nearest, distancePct: 10 } }, 30)).toBe(
      'critical',
    );
  });
});

describe('the capital curve of the Fleet', () => {
  const tokens = {
    fg3: '#888',
    line: '#222',
    line2: '#333',
    accent: '#58f',
    loss: '#f55',
  } as never;
  const input = {
    points: [
      [1, 1],
      [2, 3],
      [3, 2],
    ] as Array<[number, number]>,
    tokens,
    fmtValue: (v: number) => String(v),
    fmtDate: (t: number) => String(t),
    labels: { equity: 'Capital', drawdown: 'Drop' },
  };
  it('has two grids with the drawdown, one without it', () => {
    const full = buildEquityOption(input);
    expect(full.series).toHaveLength(2);
    const calm = buildEquityOption({ ...input, withDrawdown: false });
    expect(calm.series).toHaveLength(1);
    expect(Array.isArray(calm.grid)).toBe(false);
  });
});
