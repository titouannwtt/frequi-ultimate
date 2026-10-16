import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  buildAction,
  disabledReasonFor,
  drawerActionIds,
  rowActionIds,
} from '@/components/fq/lib/actions';
import {
  alertTag,
  alertTarget,
  alertWording,
  detailKind,
  plainDetail,
  railLevel,
  severityTone,
} from '@/components/fq/lib/alerts';
import {
  attentionScore,
  attentionSignature,
  botState,
  fleetExposure,
  groupBots,
  isStaleGroup,
  stableOrder,
  sumBots,
  UNGROUPED_ID,
} from '@/components/fq/lib/bots';
import { digestOf } from '@/components/fq/lib/digest';
import {
  exitPlan,
  fractionFromNotional,
  MIN_NOTIONAL,
  nettedWith,
  warningsFor,
} from '@/components/fq/lib/dialog';
import { formatClock, tomorrowAtMs } from '@/components/fq/lib/time';
import {
  compareWorstFirst,
  durationTone,
  ladderOf,
  lineFromPosition,
  liqTone,
  matchesQuickFilter,
  pairLabel,
  tradeKey,
} from '@/components/fq/lib/trades';
import { FIXTURE_NOW, makeBot, makeFixture, makePosition } from '@/components/fq/fixtures';
import type { BotRow, Event } from '@/gateway/types.gen';

const bot = (seq: number, over: Parameters<typeof makeBot>[1]) => makeBot(seq, over);

describe('bots: state, order, sums', () => {
  it('a bot that is online but silent is stale, and the digest threshold applies to the tab clock', () => {
    const b = bot(1, { name: 'a', mode: 'live' });
    expect(botState(b, FIXTURE_NOW, 0)).toBe('online');
    // The digest flag was computed at publication: a tab idle for an hour must not trust it
    const digest: BotRow = {
      ...b,
      freshness: {
        ...b.freshness,
        state: { stale: false, as_of_ms: FIXTURE_NOW, source: 'digest' } as never,
      },
    };
    expect(isStaleGroup(digest, 'state', FIXTURE_NOW + 60_000, 0)).toBe(false);
    expect(isStaleGroup(digest, 'state', FIXTURE_NOW + 3_600_000, 0)).toBe(true);
    expect(botState(digest, FIXTURE_NOW + 3_600_000, 0)).toBe('stale');
  });

  it('attention order: critical, warning, info, then worst latent, then name', () => {
    const rows = [
      bot(1, { name: 'calm_good', mode: 'live', latent: 50 }),
      bot(2, { name: 'warn', mode: 'live', latent: -5, alert: 'warning' }),
      bot(3, { name: 'crit', mode: 'live', latent: 10, alert: 'critical' }),
      bot(4, { name: 'calm_bad', mode: 'live', latent: -80 }),
      bot(5, { name: 'info', mode: 'live', latent: 0, alert: 'info' }),
    ];
    const order = stableOrder(rows, 'attention', null, false).keys.map(
      (k) => rows.find((r) => r.bot_key === k)!.identity.name,
    );
    expect(order).toEqual(['crit', 'warn', 'info', 'calm_bad', 'calm_good']);
  });

  // An online bot whose state stopped arriving: its figures are frozen
  const silent = (b: ReturnType<typeof bot>) => ({
    ...b,
    freshness: { ...b.freshness, state: { stale: true, as_of_ms: FIXTURE_NOW - 600_000 } as never },
  });

  it('attention order: the bots that are silent come first, then the alerts (B360)', () => {
    const rows = [
      bot(1, { name: 'calm', mode: 'live', latent: -80 }),
      bot(2, { name: 'warn', mode: 'live', latent: -5, alert: 'warning' }),
      bot(3, { name: 'crit', mode: 'live', latent: 10, alert: 'critical' }),
      bot(4, { name: 'expired', mode: 'live', latent: 50, status: 'auth_expired' }),
      silent(bot(5, { name: 'frozen', mode: 'live', latent: 20 })),
      bot(6, { name: 'off', mode: 'live', latent: 0, status: 'offline', alert: 'critical' }),
      bot(7, { name: 'stopped', mode: 'live', latent: -90, status: 'stopped' }),
    ];
    const state = (b: (typeof rows)[number]) => botState(b, FIXTURE_NOW, 0);
    const rankOf = (b: (typeof rows)[number]) => attentionScore(b, state(b));
    const order = stableOrder(rows, 'attention', null, false, rankOf).keys.map(
      (k) => rows.find((r) => r.bot_key === k)!.identity.name,
    );
    // Offline and expired sessions, then the critical alert, then the frozen one, then a warning;
    // a stopped bot is a decision of the owner, not a problem
    expect(order.slice(0, 5)).toEqual(['off', 'expired', 'crit', 'frozen', 'warn']);
    expect(order.slice(5).sort()).toEqual(['calm', 'stopped']);
  });

  it('a bot that goes silent changes the signature, so the order is recomputed', () => {
    const rows = [
      bot(1, { name: 'a', mode: 'live', latent: -10 }),
      bot(2, { name: 'b', mode: 'live', latent: -20 }),
    ];
    const first = stableOrder(rows, 'attention', null, false);
    const silent = rows.map((r, i) =>
      i === 0 ? { ...r, state: { ...r.state, status: 'auth_expired' as const } } : r,
    );
    expect(attentionSignature(silent)).not.toBe(attentionSignature(rows));
    expect(stableOrder(silent, 'attention', first, false).keys[0]).toBe(rows[0]!.bot_key);
  });

  it('the attention order does not move at a tick, only when an alert appears or resolves', () => {
    const rows = [
      bot(1, { name: 'a', mode: 'live', latent: -10 }),
      bot(2, { name: 'b', mode: 'live', latent: -20 }),
      bot(3, { name: 'c', mode: 'live', latent: -30 }),
    ];
    const first = stableOrder(rows, 'attention', null, false);
    expect(first.keys).toEqual([rows[2]!.bot_key, rows[1]!.bot_key, rows[0]!.bot_key]);
    // A tick makes "a" the worst: nothing moves
    const ticked = rows.map((r, i) =>
      i === 0 ? { ...r, metrics: { ...r.metrics, open_profit_abs: -99 } } : r,
    );
    const second = stableOrder(ticked, 'attention', first, false);
    expect(second.keys).toEqual(first.keys);
    // An alert appears on "a": the order is recomputed
    const alerted = ticked.map((r, i) =>
      i === 0 ? { ...r, alerts: { count: 1, max_severity: 'warning' as const } } : r,
    );
    const third = stableOrder(alerted, 'attention', second, false);
    expect(third.keys[0]).toBe(rows[0]!.bot_key);
  });

  it('frozen (hover or focus) keeps the order even when an alert appears; new bots go last', () => {
    const rows = [
      bot(1, { name: 'a', mode: 'live', latent: -10 }),
      bot(2, { name: 'b', mode: 'live', latent: -20 }),
    ];
    const first = stableOrder(rows, 'attention', null, false);
    const alerted = [
      { ...rows[0]!, alerts: { count: 1, max_severity: 'critical' as const } },
      rows[1]!,
      bot(3, { name: 'new', mode: 'live', latent: -500, alert: 'critical' }),
    ];
    const frozen = stableOrder(alerted, 'attention', first, true);
    expect(frozen.keys.slice(0, 2)).toEqual(first.keys);
    expect(frozen.keys[2]).toBe(alerted[2]!.bot_key);
    // Released: the new order applies
    const free = stableOrder(alerted, 'attention', frozen, false);
    expect(free.keys).not.toEqual(frozen.keys);
  });

  it('latent and name sorts recompute at every change (explicit user choice)', () => {
    const rows = [
      bot(1, { name: 'a', mode: 'live', latent: -10 }),
      bot(2, { name: 'b', mode: 'live', latent: -20 }),
    ];
    const first = stableOrder(rows, 'latent', null, false);
    const ticked = rows.map((r, i) =>
      i === 0 ? { ...r, metrics: { ...r.metrics, open_profit_abs: -99 } } : r,
    );
    expect(stableOrder(ticked, 'latent', first, false).keys[0]).toBe(rows[0]!.bot_key);
    expect(attentionSignature(rows)).toBe(attentionSignature(ticked));
  });

  it('a missing latent goes last, names sort naturally', () => {
    const rows = [
      bot(1, { name: 'bot10', mode: 'live', latent: null }),
      bot(2, { name: 'bot9', mode: 'live', latent: 0 }),
      bot(3, { name: 'bot2', mode: 'live', latent: 0 }),
    ];
    const byLatent = stableOrder(rows, 'latent', null, false).keys;
    expect(byLatent[2]).toBe(rows[0]!.bot_key);
    const byName = stableOrder(rows, 'name', null, false).keys.map(
      (k) => rows.find((r) => r.bot_key === k)!.identity.name,
    );
    expect(byName).toEqual(['bot2', 'bot9', 'bot10']);
  });

  it('sums leave out the stale bots and name them; a null figure is excluded, not zero', () => {
    const rows = [
      bot(1, { name: 'a', mode: 'live', latent: 10 }),
      bot(2, { name: 'b', mode: 'live', latent: 20, stale: true }),
      bot(3, { name: 'c', mode: 'live', latent: null }),
      bot(4, { name: 'd', mode: 'live', latent: -4 }),
    ];
    const s = sumBots(rows, 'positions', (b) => b.metrics.open_profit_abs, FIXTURE_NOW, 0);
    expect(s.total).toBe(6);
    expect(s.excluded.sort()).toEqual([rows[1]!.bot_key, rows[2]!.bot_key].sort());
  });

  it('exposure is read at wallet level: two bots on one wallet are not summed twice', () => {
    const rows = [
      bot(1, { name: 'a', mode: 'live', wallet: 'w1', long: 1000, short: 0 }),
      bot(2, { name: 'b', mode: 'live', wallet: 'w1', long: 1000, short: 0 }),
      bot(3, { name: 'c', mode: 'live', wallet: null, long: 500, short: 100 }),
    ];
    const wallets = {
      w1: {
        wallet_id: 'w1',
        net_exposure: { TAO: 1500, SOL: -250 },
        freshness: { stale: false },
      },
    } as never;
    const e = fleetExposure(rows, wallets, FIXTURE_NOW, 0);
    expect(e.total).toBe(1750 + 600);
    expect(e.netted).toBe(false);
    expect(e.excluded).toBe(0);
    const stale = fleetExposure(
      rows,
      {
        w1: { ...(wallets as never as Record<string, object>).w1, freshness: { stale: true } },
      } as never,
      FIXTURE_NOW,
      0,
    );
    expect(stale.total).toBe(600);
    expect(stale.excluded).toBe(1);
  });

  it('groups: a bot is in one group, the rest goes to "ungrouped", empty groups vanish', () => {
    const rows = [
      bot(1, { name: 'a', mode: 'live', alert: 'warning' }),
      bot(2, { name: 'b', mode: 'live' }),
      bot(3, { name: 'c', mode: 'live' }),
    ];
    const groups = groupBots(
      rows,
      [
        {
          id: 'g1',
          name: 'G1',
          icon: '',
          collapsed: false,
          botKeys: [rows[0]!.bot_key, rows[1]!.bot_key],
        },
        { id: 'g2', name: 'G2', icon: '', collapsed: false, botKeys: [rows[1]!.bot_key] },
        { id: 'g3', name: 'G3', icon: '', collapsed: false, botKeys: ['gone'] },
      ] as never,
      'Others',
    );
    expect(groups.map((g) => g.id)).toEqual(['g1', UNGROUPED_ID]);
    expect(groups[0]!.bots).toHaveLength(2);
    expect(groups[0]!.toWatch).toBe(1);
    expect(groups[1]!.bots.map((b) => b.identity.name)).toEqual(['c']);
  });
});

describe('actions', () => {
  it('a single exit carries the state the user saw, an orphan has no exit at all', () => {
    const f = makeFixture(6);
    const p = f.positions.find((x) => !x.orphan)!;
    expect(buildAction('exit', { position: p })).toEqual({
      kind: 'forceexit',
      tradeId: p.trade_id,
      expected: { pair: p.pair, isShort: p.side === 'short' },
    });
    const orphan = f.positions.find((x) => x.orphan)!;
    for (const id of ['exit', 'add', 'cancelOrder', 'reloadTrade', 'deleteTrade'] as const) {
      expect(buildAction(id, { position: orphan })).toBeNull();
    }
    expect(rowActionIds(true)).not.toContain('exit');
    expect(drawerActionIds(true)).not.toContain('exit');
    expect(rowActionIds(false)).toContain('exit');
  });

  it('exit all and stop are the danger actions, navigation ids build nothing', () => {
    expect(ACTIONS.exitAll.danger).toBe(true);
    expect(ACTIONS.stop.danger).toBe(true);
    expect(buildAction('exitAll')).toEqual({ kind: 'forceexit', tradeId: 'all' });
    expect(buildAction('config')).toBeNull();
    expect(ACTIONS.config.mutation).toBe(false);
  });

  it('actions are disabled when the bot does not answer, whatever the reason', () => {
    const live = { connection: 'live' as const, fromCache: false };
    expect(disabledReasonFor('online', live)).toBeNull();
    expect(disabledReasonFor('offline', live)).toBe('offline');
    expect(disabledReasonFor('stale', live)).toBe('offline');
    expect(disabledReasonFor('auth_expired', live)).toBe('authExpired');
    expect(disabledReasonFor('starting', live)).toBe('starting');
    expect(disabledReasonFor('stopped', live)).toBe('stopped');
    expect(disabledReasonFor(null, live)).toBe('unknownBot');
    expect(disabledReasonFor('online', live, { orphan: true })).toBe('orphan');
    expect(disabledReasonFor('online', { connection: 'live', fromCache: true })).toBe('cache');
    expect(disabledReasonFor('online', { connection: 'connecting', fromCache: false })).toBe(
      'connecting',
    );
    expect(disabledReasonFor('online', { connection: 'offline', fromCache: false })).toBe(
      'offline',
    );
  });
});

describe('dialog arithmetic', () => {
  const pos = { amount: 10, notional: 1000, profitAbs: -50, currentRate: 100 };

  it('a full exit sends no amount; a partial one never exceeds the position', () => {
    const full = exitPlan(pos, 1);
    expect(full.amount).toBeUndefined();
    expect(full.valid).toBe(true);
    expect(full.pnl).toBe(-50);
    const half = exitPlan(pos, 0.5);
    expect(half.amount).toBe(5);
    expect(half.pnl).toBe(-25);
    expect(half.remaining).toBe(500);
    expect(exitPlan(pos, 7).fraction).toBe(1);
    expect(exitPlan(pos, -1).valid).toBe(false);
    expect(exitPlan(pos, Number.NaN).valid).toBe(false);
  });

  it('a partial exit under the 10 USDC minimum is blocked, and so is a remainder too small to sell', () => {
    expect(MIN_NOTIONAL).toBe(10);
    const tiny = exitPlan({ ...pos, notional: 30 }, 0.25);
    expect(tiny.belowMin).toBe(true);
    expect(tiny.valid).toBe(false);
    const left = exitPlan({ ...pos, notional: 100 }, 0.95);
    expect(left.belowMin).toBe(false);
    expect(left.remainingBelowMin).toBe(true);
    expect(left.valid).toBe(true);
    // A full exit of a tiny position is allowed: the bot closes what it holds
    expect(exitPlan({ ...pos, notional: 5 }, 1).valid).toBe(true);
  });

  it('unknown figures stay unknown (no invented zero)', () => {
    const p = exitPlan({ amount: 2, notional: null, profitAbs: null, currentRate: null }, 0.5);
    expect(p.pnl).toBeNull();
    expect(p.notional).toBeNull();
    expect(p.belowMin).toBe(false);
    expect(Number.isNaN(fractionFromNotional(50, null))).toBe(true);
    expect(Number.isNaN(fractionFromNotional(Number.NaN, 100))).toBe(true);
    expect(fractionFromNotional(500, 100)).toBe(1);
  });

  it('warnings: stop always says the launch script restarts it, exit all asks to pause first', () => {
    expect(warningsFor({ kind: 'stop' }).map((w) => w.key)).toEqual(['stopLaunchScript']);
    expect(warningsFor({ kind: 'forceexit', tradeId: 'all' }).map((w) => w.key)).toEqual([
      'exitAllNoPause',
    ]);
    expect(warningsFor({ kind: 'forceexit', tradeId: 'all' }, { entriesPaused: true })).toEqual([]);
    const netted = warningsFor(
      { kind: 'forceexit', tradeId: 3, expected: { pair: 'X', isShort: false } },
      { nettedWith: ['b', 'a'] },
    );
    expect(netted[0]).toMatchObject({ key: 'netted', params: { bots: 'b, a' } });
  });

  it('netted bots: same coin, same wallet, other bot only', () => {
    const bots = {
      A: { identity: { name: 'alpha' }, state: { wallet_id: 'w1' } },
      B: { identity: { name: 'beta' }, state: { wallet_id: 'w1' } },
      C: { identity: { name: 'gamma' }, state: { wallet_id: 'w2' } },
    };
    const list = [
      { bot_key: 'A', coin: 'TAO' },
      { bot_key: 'B', coin: 'TAO' },
      { bot_key: 'B', coin: 'SOL' },
      { bot_key: 'C', coin: 'TAO' },
    ];
    expect(nettedWith(list[0]!, bots, list)).toEqual(['beta']);
    expect(nettedWith({ bot_key: 'A', coin: 'SOL' }, bots, list)).toEqual(['beta']);
    expect(
      nettedWith(
        { bot_key: 'A', coin: 'TAO' },
        { ...bots, A: { ...bots.A, state: { wallet_id: null } } },
        list,
      ),
    ).toEqual([]);
  });
});

describe('trade lines', () => {
  it('the key is bot/trade: trade 1180 on two bots gives two keys', () => {
    expect(tradeKey('local:9400', 1180)).not.toBe(tradeKey('local:9401', 1180));
    const f = makeFixture(10);
    const dupes = f.positions.filter((p) => p.trade_id === 1180);
    expect(dupes).toHaveLength(2);
    const keys = new Set(dupes.map((p) => lineFromPosition(p, undefined).key));
    expect(keys.size).toBe(2);
  });

  it('unknown profit is flagged, percent is multiplied by 100, orphan keeps its flag', () => {
    const b = bot(1, { name: 'a', mode: 'live' });
    const p = {
      ...makePosition(b, 'TAO/USDC:USDC', 5, 'long', 0.5),
      profit_abs: null,
      profit_ratio: 0.05,
    };
    const l = lineFromPosition(p, b);
    expect(l.profitUnknown).toBe(true);
    expect(l.pnlAbs).toBeNull();
    expect(l.pnlPct).toBeCloseTo(5);
    expect(lineFromPosition({ ...p, orphan: true }, b).orphan).toBe(true);
  });

  it('worst first with unknown last, quick filters, tones', () => {
    const b = bot(1, { name: 'a', mode: 'live' });
    const mk = (id: number, pnl: number | null) =>
      lineFromPosition(
        { ...makePosition(b, 'TAO/USDC:USDC', id, 'long', 0.5), profit_abs: pnl },
        b,
      );
    const lines = [mk(1, 5), mk(2, null), mk(3, -9), mk(4, -1)];
    expect(lines.sort(compareWorstFirst).map((l) => l.tradeId)).toEqual([3, 4, 1, 2]);
    expect(matchesQuickFilter(mk(1, -1), 'loss')).toBe(true);
    expect(matchesQuickFilter(mk(1, null), 'loss')).toBe(false);
    expect(durationTone(83)).toBe('ok');
    expect(durationTone(84)).toBe('warn');
    expect(durationTone(91)).toBe('crit');
    expect(durationTone(null)).toBe('ok');
    expect(liqTone(14.9)).toBe('crit');
    expect(liqTone(20)).toBe('warn');
    expect(liqTone(40)).toBe('neutral');
    expect(liqTone(null)).toBe('neutral');
  });

  it('the ladder runs from liquidation (left) to take profit (right) for both sides', () => {
    const long = ladderOf(
      { entry: 100, current: 90, liquidationPrice: 50, dcaFilled: 2, dcaMax: 4, side: 'long' },
      120,
    );
    expect(long).toMatchObject({ filled: 2, max: 4, tp: 1 });
    expect(long!.avg).toBeCloseTo((100 - 50) / 70);
    expect(long!.price).toBeCloseTo((90 - 50) / 70);
    const short = ladderOf(
      {
        entry: 100,
        current: 110,
        liquidationPrice: 150,
        dcaFilled: 1,
        dcaMax: null,
        side: 'short',
      },
      80,
    );
    expect(short!.price).toBeLessThan(short!.avg);
    // No liquidation and no TP: nothing honest to draw
    expect(
      ladderOf({
        entry: 1,
        current: 1,
        liquidationPrice: null,
        dcaFilled: 1,
        dcaMax: null,
        side: 'long',
      }),
    ).toBeNull();
    // Without a TP the marker is absent
    expect(
      ladderOf({
        entry: 100,
        current: 90,
        liquidationPrice: 50,
        dcaFilled: 1,
        dcaMax: null,
        side: 'long',
      })!.tp,
    ).toBeUndefined();
  });

  it('pair labels', () => {
    expect(pairLabel('TAO/USDC:USDC')).toBe('TAO');
    expect(pairLabel('xyz:NVDA/USDC:USDC')).toBe('NVDA');
  });
});

describe('alerts, digest, clock', () => {
  it('an alert that needs a figure but has none shows the raw detail, never "NaN"', () => {
    const num = (n: number) => String(n);
    expect(
      alertWording(
        { type_id: 'nearLiquidation', subject: 'NVDA', value: 11, threshold: 15, detail: null },
        num,
      ),
    ).toEqual({
      messageKey: 'msg.nearLiquidation',
      params: { subject: 'NVDA', detail: '', value: '11', threshold: '15' },
    });
    expect(
      alertWording(
        { type_id: 'nearLiquidation', subject: 'NVDA', value: null, threshold: 15, detail: 'x' },
        num,
      ).messageKey,
    ).toBe('msg.noValue');
    expect(
      alertWording(
        { type_id: 'botOffline', subject: null, value: null, threshold: null, detail: 'x' },
        num,
      ).messageKey,
    ).toBe('msg.botOffline');
  });

  it('classes a raw bot message and never lets an em dash through (B233)', () => {
    expect(detailKind(null)).toBeNull();
    expect(detailKind('  ')).toBeNull();
    expect(detailKind('HTTP 429 Too Many Requests from hyperliquid')).toBe('rateLimit');
    expect(detailKind('ftcache: CacheTimedOut after 10s')).toBe('timeout');
    expect(detailKind('Traceback (most recent call last):\n  File "x.py"\nValueError: boom')).toBe(
      'traceback',
    );
    expect(detailKind('Insufficient margin to open the order')).toBe('funds');
    expect(detailKind('Connection refused')).toBe('connection');
    expect(detailKind('PENGU short 212,40 USDC with no owner')).toBe('other');
    expect(plainDetail('ftcache \u2014 retry in 5 s')).toBe('ftcache - retry in 5 s');
    expect(plainDetail(null)).toBe('');
  });

  it('tells a per-position alert by its pair, never by the bare trade id (QA 2026-10-15)', () => {
    const num = (n: number) => String(n);
    const a = {
      type_id: 'nearLiquidation' as const,
      subject: '20',
      pair: 'SKY/USDC:USDC',
      value: 12.8,
      threshold: 15,
      detail: null,
    };
    expect(alertWording(a, num).params.subject).toBe('SKY');
    expect(alertWording({ ...a, pair: 'xyz:GOLD/USDC:USDC' }, num).params.subject).toBe('GOLD');
    // The trade id stays available as a tag, and as the subject that opens the position
    expect(alertTag(a)).toBe('#20');
    // An alert saved without a pair (older gateway) falls back on its subject
    expect(alertTarget({ subject: 'NVDA' })).toBe('NVDA');
    expect(alertTarget({ subject: '20', pair: null })).toBe('20');
    expect(alertTag({ subject: null })).toBeNull();
    expect(alertTag({ subject: 'NVDA' })).toBe('NVDA');
  });

  it('rail level follows the worst active alert', () => {
    expect(railLevel([])).toBe('calm');
    expect(railLevel([{ severity: 'info' }])).toBe('calm');
    expect(railLevel([{ severity: 'info' }, { severity: 'warning' }])).toBe('watch');
    expect(railLevel([{ severity: 'warning' }, { severity: 'critical' }])).toBe('critical');
    expect(severityTone('critical')).toBe('crit');
  });

  it('digest counts what happened since the marker and leaves unknown profits out', () => {
    const ev = (kind: string, ts: number, extra: object = {}): Event =>
      ({
        id: `${kind}${ts}`,
        kind,
        ts_ms: ts,
        bot_key: 'b',
        pair: 'TAO',
        ...extra,
      }) as unknown as Event;
    const events = [
      ev('exit_fill', 10, { profit_abs: 5 }),
      ev('exit_fill', 20, { profit_abs: -8 }),
      ev('exit_fill', 30, { profit_abs: null }),
      ev('entry_fill', 40),
      ev('alert_raised', 50),
      ev('alert_resolved', 60),
      ev('startup', 70),
      ev('exit_fill', 1, { profit_abs: -999 }),
    ];
    const d = digestOf(events, 5);
    expect(d).toMatchObject({
      realized: -3,
      wins: 1,
      losses: 1,
      entries: 1,
      alertsRaised: 1,
      alertsResolved: 1,
      restarts: 1,
      total: 7,
    });
    expect(d.worst?.profit_abs).toBe(-8);
    expect(digestOf([ev('exit_fill', 10, { profit_abs: 3 })], 0).worst).toBeNull();
    expect(digestOf([], 0).total).toBe(0);
  });

  it('clock helpers use the configured zone', () => {
    // 12:00 UTC on 15 Oct 2026 is 14:00 in Paris (CEST)
    expect(formatClock(FIXTURE_NOW, 'Europe/Paris')).toBe('14:00');
    expect(formatClock(FIXTURE_NOW, 'UTC')).toBe('12:00');
    // Tomorrow 08:00 Paris = 06:00 UTC the next day
    expect(tomorrowAtMs(FIXTURE_NOW, 'Europe/Paris', 8)).toBe(Date.UTC(2026, 9, 16, 6, 0, 0));
  });
});
