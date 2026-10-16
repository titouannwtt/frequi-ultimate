import { describe, expect, it } from 'vitest';

import { buildEquityOption } from '../../src/components/fq/lib/equity';
import {
  alertLimit,
  alertsInScope,
  fleetNotices,
  isLongerThanUsual,
  liqWord,
  notSnoozed,
  safetyOrders,
  safetyOrdersMax,
  type NoticeInput,
  verdictOf,
  watchSelection,
} from '../../src/components/fq/lib/fleetPage';
import { makeBot } from '../../src/components/fq/fixtures';
import { riskLevel } from '../../src/components/fq/lib/risk';
import type { TradeLine } from '../../src/components/fq/lib/trades';
import type { Alert, BotRow, BotStatus } from '../../src/gateway/types.gen';

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

describe('what the owner must act on, beyond the alerts', () => {
  const live = (seq: number, status: BotStatus = 'online') =>
    makeBot(seq, { name: `bot${seq}`, mode: 'live', status, slots: 2, latent: 0 });
  const calm = (over: Partial<NoticeInput> = {}): NoticeInput => ({
    bots: [live(1), live(2)],
    stateOf: (b) => b.state.status,
    alerts: [],
    drawdowns: [{ mode: 'live', pct: 3 }],
    drawdownLimit: 15,
    nearest: [{ mode: 'live', botKey: 'local:9401', pair: 'BTC/USDC:USDC', distancePct: 40 }],
    liquidationLimit: 15,
    orphans: 0,
    ...over,
  });
  const level = (input: NoticeInput, alerts: Alert[] = []) =>
    verdictOf([...alerts, ...fleetNotices(input)]);

  it('a calm fleet has nothing to say', () => {
    expect(fleetNotices(calm())).toEqual([]);
    expect(level(calm())).toEqual({ level: 'calm', n: 0 });
  });

  it('a live bot whose session expired is a point to see, with its way back', () => {
    const bots = [live(1), live(2, 'auth_expired')];
    const notices = fleetNotices(calm({ bots }));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      kind: 'authExpired',
      severity: 'warning',
      botKey: bots[1]!.bot_key,
      actions: ['reconnect'],
    });
    expect(level(calm({ bots }))).toEqual({ level: 'one', n: 1 });
  });

  it('an offline bot is critical, unless its offline alert already says it', () => {
    const bots = [live(1), live(2, 'offline')];
    expect(fleetNotices(calm({ bots }))[0]).toMatchObject({
      kind: 'offline',
      severity: 'critical',
    });
    expect(level(calm({ bots }))).toEqual({ level: 'critical', n: 1 });
    const said = [{ type_id: 'botOffline', bot_key: bots[1]!.bot_key }] as Alert[];
    expect(fleetNotices(calm({ bots, alerts: said }))).toEqual([]);
  });

  it('the bots whose figures are frozen are one notice, however many they are', () => {
    const bots = [live(1), live(2), live(3)];
    const stateOf = (b: BotRow) => (b.bot_key === bots[0]!.bot_key ? 'online' : 'stale');
    const notices = fleetNotices(calm({ bots, stateOf }));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'frozen', n: 2, botKey: null });
    expect(notices[0]!.botKeys).toEqual([bots[1]!.bot_key, bots[2]!.bot_key].sort());
  });

  it('a drawdown above its limit is a point to see, at the limit included', () => {
    expect(fleetNotices(calm({ drawdowns: [{ mode: 'live', pct: 14.9 }] }))).toEqual([]);
    const over = fleetNotices(calm({ drawdowns: [{ mode: 'live', pct: 15 }] }));
    expect(over[0]).toMatchObject({ kind: 'drawdown', value: 15, threshold: 15 });
    // An unknown drawdown says nothing; a drawdown alert already says it
    expect(fleetNotices(calm({ drawdowns: [{ mode: 'live', pct: null }] }))).toEqual([]);
    const said = [{ type_id: 'highDrawdown', bot_key: 'local:9401' }] as Alert[];
    expect(fleetNotices(calm({ drawdowns: [{ mode: 'live', pct: 123 }], alerts: said }))).toEqual(
      [],
    );
  });

  it('a liquidation closer than its limit is critical, unless its alert says it', () => {
    const near = [
      { mode: 'live' as const, botKey: 'local:9401', pair: 'ETH/USDC:USDC', distancePct: 9 },
    ];
    const notices = fleetNotices(calm({ nearest: near }));
    expect(notices[0]).toMatchObject({
      kind: 'liquidation',
      severity: 'critical',
      pair: 'ETH/USDC:USDC',
    });
    expect(level(calm({ nearest: near }))).toEqual({ level: 'critical', n: 1 });
    const said = [{ type_id: 'nearLiquidation', bot_key: 'local:9401' }] as Alert[];
    expect(fleetNotices(calm({ nearest: near, alerts: said }))).toEqual([]);
  });

  it('orphan positions are a point to see, reconciled from the card', () => {
    const notices = fleetNotices(calm({ orphans: 2 }));
    expect(notices[0]).toMatchObject({ kind: 'orphans', n: 2, actions: ['reconcile'] });
    expect(level(calm({ orphans: 2 }))).toEqual({ level: 'one', n: 1 });
  });

  it('an active alert still speaks, and several things add up, the critical ones first', () => {
    expect(level(calm(), [alert('warning')])).toEqual({ level: 'one', n: 1 });
    const input = calm({
      bots: [live(1), live(2, 'auth_expired'), live(3, 'offline')],
      drawdowns: [{ mode: 'live', pct: 40 }],
      orphans: 1,
    });
    const notices = fleetNotices(input);
    expect(notices.map((n) => n.kind)).toEqual(['offline', 'authExpired', 'drawdown', 'orphans']);
    expect(level(input, [alert('warning')])).toEqual({ level: 'critical', n: 1 });
    // Without the critical one: all the warnings count
    const warn = fleetNotices({ ...input, bots: [live(1), live(2, 'auth_expired')] });
    expect(verdictOf([...warn, alert('warning')])).toEqual({ level: 'many', n: 4 });
  });

  it('"Later" hides a notice until its time, and only that one', () => {
    const notices = fleetNotices(calm({ bots: [live(1, 'auth_expired')], orphans: 1 }));
    const authId = notices.find((n) => n.kind === 'authExpired')!.id;
    expect(notSnoozed(notices, { [authId]: 2_000 }, 1_000).map((n) => n.kind)).toEqual(['orphans']);
    expect(notSnoozed(notices, { [authId]: 2_000 }, 2_000)).toHaveLength(2);
  });

  it('reads the limit of a rule as the owner set it, else its default', () => {
    const rules = { global: { highDrawdown: { threshold: -25 } } } as never;
    expect(alertLimit(rules, 'highDrawdown')).toBe(25);
    expect(alertLimit({ global: {} } as never, 'highDrawdown')).toBe(15);
    expect(alertLimit({ global: {} } as never, 'nearLiquidation')).toBe(15);
  });
});
