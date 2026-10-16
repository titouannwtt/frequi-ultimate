import { describe, expect, it } from 'vitest';

import {
  byCategory,
  clampThreshold,
  globalRule,
  ruleRows,
  withBotEnabled,
  withRule,
} from '@/components/fq/lib/alertSettings';
import {
  intentsFor,
  payloadOf,
  readWriteOutcome,
  shortWallet,
  sliceOf,
  typedMatches,
} from '@/components/fq/lib/reconWrite';
import { discoveredUrl, nextUiId, validateBotForm } from '@/components/fq/lib/registryEdit';
import {
  byMarket,
  isLiquidated,
  stressable,
  stressTest,
  type StressInput,
} from '@/components/fq/lib/stress';
import {
  COLUMN_PRESETS,
  customizedColumns,
  defaultScopeBlock,
  withoutColumns,
} from '@/components/fq/lib/workspaces';
import { ALERT_TYPE_IDS, RULE_CATALOG } from '@/datasource/calc/alerts/rules';
import type { AlertRulesConfig } from '@/gateway/types.gen';
import type { FleetviewCoin } from '@/types/fleetview';

const coin = (over: Partial<FleetviewCoin>): FleetviewCoin => ({
  coin: 'ARB',
  db_sum: 1,
  on_chain: 1,
  mark_price: 1,
  on_chain_leverage: 2,
  unrealized_pnl: 0,
  status: 'ok',
  slices: [
    {
      bot_name: 'a',
      port: 1,
      trade_id: 7,
      pair: 'ARB/USDC:USDC',
      signed_amount: 1,
      open_rate: 1,
      stake_amount: 1,
    },
  ],
  phantom_candidate: null,
  minority_slices: [],
  ...over,
});

describe('reconciliation write helpers', () => {
  it('offers one intent per actionable row and none for ok or ambiguous rows', () => {
    expect(intentsFor(coin({ status: 'ok' }))).toEqual([]);
    expect(intentsFor(coin({ status: 'ambiguous' }))).toEqual([]);
    expect(intentsFor(coin({ status: 'unowned' })).map((i) => i.action)).toEqual(['close_unowned']);
    expect(intentsFor(coin({ status: 'phantom' }))).toEqual([]);
    const ref = { bot_name: 'a', trade_id: 7 };
    expect(intentsFor(coin({ status: 'phantom', phantom_candidate: ref }))[0].action).toBe(
      'delete_phantom',
    );
    const m = intentsFor(
      coin({ status: 'minority', minority_slices: [ref, { bot_name: 'b', trade_id: 9 }] }),
    );
    expect(m).toHaveLength(2);
    expect(m.every((i) => i.action === 'close_minority')).toBe(true);
  });

  it('builds a body that always carries confirm and only names a trade when there is one', () => {
    const c = coin({ status: 'unowned' });
    expect(payloadOf({ action: 'close_unowned', coin: c, trade: null })).toEqual({
      action: 'close_unowned',
      coin: 'ARB',
      confirm: true,
    });
    expect(
      payloadOf({
        action: 'close_minority',
        coin: c,
        trade: { bot_name: 'a', trade_id: 7 },
      }),
    ).toEqual({
      action: 'close_minority',
      coin: 'ARB',
      bot_name: 'a',
      trade_id: 7,
      confirm: true,
    });
  });

  it('finds the slice of a trade reference', () => {
    const c = coin({});
    expect(sliceOf(c, { bot_name: 'a', trade_id: 7 })?.pair).toBe('ARB/USDC:USDC');
    expect(sliceOf(c, { bot_name: 'a', trade_id: 8 })).toBeNull();
    expect(sliceOf(c, null)).toBeNull();
  });

  it('checks the typed coin name, case and spaces aside, and never matches an empty name', () => {
    expect(typedMatches(' arb ', 'ARB')).toBe(true);
    expect(typedMatches('AR', 'ARB')).toBe(false);
    expect(typedMatches('', '')).toBe(false);
  });

  it('shortens a wallet address and keeps short values', () => {
    expect(shortWallet(`0x${'1234567890abcdef'.repeat(2)}12345678`)).toBe('0x1234...5678');
    expect(shortWallet('0xabc')).toBe('0xabc');
    expect(shortWallet(null)).toBe('');
  });

  it('reads the answer of the gateway and of a bot', () => {
    expect(
      readWriteOutcome('gateway', { status: 'accepted', botResponse: '{"order":{"filled":1}}' }),
    ).toEqual({
      status: 'accepted',
      data: { order: { filled: 1 } },
      text: '{"order":{"filled":1}}',
    });
    const refused = readWriteOutcome('gateway', { status: 'unauthorized', error: 'confirm' });
    expect(refused.status).toBe('unauthorized');
    expect(refused.text).toBe('confirm');
    // An unknown status is a refusal, never a success.
    expect(readWriteOutcome('gateway', { status: 'weird' }).status).toBe('rejected');
    expect(readWriteOutcome('gateway', null).status).toBe('rejected');
    expect(
      readWriteOutcome('gateway', { status: 'accepted', botResponse: 'not json' }).data,
    ).toBeNull();
    expect(readWriteOutcome('direct', { delete: 'ok' })).toMatchObject({
      status: 'accepted',
      data: { delete: 'ok' },
    });
  });
});

const pos = (over: Partial<StressInput>): StressInput => ({
  bot_key: 'b1' as StressInput['bot_key'],
  pair: 'ARB/USDC:USDC',
  coin: 'ARB',
  market: 'crypto' as StressInput['market'],
  side: 'long',
  leverage: 2,
  stake_amount: 100,
  notional: 200,
  current_rate: 1,
  profit_abs: 0,
  liquidation_price: 0.5,
  orphan: false,
  freshness: { stale: false },
  ...over,
});

describe('stress test', () => {
  it('tests the shocked price against the reported liquidation price, per side', () => {
    expect(isLiquidated('long', 0.5, 0.5)).toBe(true);
    expect(isLiquidated('long', 0.6, 0.5)).toBe(false);
    expect(isLiquidated('short', 1.6, 1.5)).toBe(true);
    expect(isLiquidated('short', 1.4, 1.5)).toBe(false);
    expect(isLiquidated('long', 0.1, null)).toBe(false);
    expect(isLiquidated('long', 0.1, 0)).toBe(false);
  });

  it('scales the result of a surviving position and loses the margin of a liquidated one', () => {
    const r = stressTest([pos({})], -10);
    expect(r.liquidated).toBe(0);
    expect(r.delta).toBeCloseTo(-20);
    const dead = stressTest([pos({ liquidation_price: 0.95, profit_abs: -5 })], -10);
    expect(dead.liquidated).toBe(1);
    expect(dead.delta).toBe(-95);
    expect(dead.marginLost).toBe(95);
    // A short gains when prices fall.
    expect(stressTest([pos({ side: 'short', liquidation_price: 2 })], -10).delta).toBeCloseTo(20);
  });

  it('counts positions it cannot test and puts liquidated rows first', () => {
    const r = stressTest(
      [
        pos({ current_rate: null }),
        pos({ pair: 'X', liquidation_price: null }),
        pos({ pair: 'DEAD', liquidation_price: 0.95 }),
      ],
      -10,
    );
    expect(r.counted).toBe(2);
    expect(r.untested).toBe(2);
    expect(r.rows[0].pair).toBe('DEAD');
  });

  it('keeps only owned, fresh positions of the requested mode', () => {
    const modeOf = (k: string) => (k === 'live1' ? 'live' : 'dry');
    const list = [
      pos({ bot_key: 'live1' as StressInput['bot_key'] }),
      pos({ bot_key: 'dry1' as StressInput['bot_key'] }),
      pos({ bot_key: 'live1' as StressInput['bot_key'], orphan: true }),
      pos({ bot_key: 'live1' as StressInput['bot_key'], freshness: { stale: true } }),
    ];
    expect(stressable(list, 'live', modeOf)).toHaveLength(1);
  });

  it('adds the exposure by market, biggest first', () => {
    const rows = byMarket([
      pos({ notional: 100 }),
      pos({ side: 'short', notional: 50 }),
      pos({ market: 'xyz' as StressInput['market'], notional: 500 }),
    ]);
    expect(rows[0].market).toBe('xyz');
    expect(rows[1]).toMatchObject({ long: 100, short: 50, positions: 2 });
  });
});

describe('registry editor helpers', () => {
  it('takes the next ftbot id above every stored one and never reuses a hole', () => {
    expect(nextUiId([])).toBe('ftbot.1');
    expect(nextUiId(['ftbot.1', 'ftbot.4'])).toBe('ftbot.5');
    expect(nextUiId(['other', 'ftbot.2'])).toBe('ftbot.3');
  });

  it('builds the address of a discovered bot, with IPv6 brackets', () => {
    expect(discoveredUrl(9401, { protocol: 'http:', hostname: 'host' })).toBe('http://host:9401');
    expect(discoveredUrl(9401, { protocol: 'http:', hostname: '::1' })).toBe('http://[::1]:9401');
    expect(discoveredUrl(null, { protocol: 'http:', hostname: 'host' })).toBe('');
  });

  it('reports the first problem of the add form and detects a duplicate address', () => {
    const ok = { name: 'a', url: 'http://h:1/', username: 'u', password: 'p' };
    const opts = { editing: false, others: [] as string[] };
    expect(validateBotForm(ok, opts)).toBeNull();
    expect(validateBotForm({ ...ok, name: ' ' }, opts)).toBe('name');
    expect(validateBotForm({ ...ok, url: 'ftp://x' }, opts)).toBe('url');
    expect(validateBotForm({ ...ok, username: '' }, opts)).toBe('username');
    expect(validateBotForm({ ...ok, password: '' }, opts)).toBe('password');
    expect(validateBotForm(ok, { editing: false, others: ['HTTP://h:1'] })).toBe('duplicate');
    expect(validateBotForm(ok, { editing: true, others: ['http://h:1'] })).toBeNull();
  });
});

const emptyCfg = (): AlertRulesConfig =>
  ({ global: {}, perBotEnabled: {}, perBot: {} }) as AlertRulesConfig;

describe('alert settings helpers', () => {
  it('lists every rule of the catalog once, by category, flagging what differs from defaults', () => {
    const rows = ruleRows(emptyCfg());
    expect(rows).toHaveLength(ALERT_TYPE_IDS.length);
    expect(rows.some((r) => r.changed)).toBe(false);
    expect(byCategory(rows).flatMap((g) => g.rows)).toHaveLength(rows.length);
  });

  it('edits one rule and keeps the others', () => {
    const id = ALERT_TYPE_IDS.find((i) => RULE_CATALOG[i].threshold)!;
    const cfg = withRule(emptyCfg(), id, { enabled: !RULE_CATALOG[id].default_enabled });
    expect(globalRule(cfg, id).enabled).toBe(!RULE_CATALOG[id].default_enabled);
    expect(ruleRows(cfg).filter((r) => r.changed)).toHaveLength(1);
  });

  it('clamps a typed threshold into the range, accepts a comma and refuses text', () => {
    const id = ALERT_TYPE_IDS.find((i) => RULE_CATALOG[i].threshold)!;
    const spec = RULE_CATALOG[id].threshold!;
    expect(clampThreshold(spec.max + 1000, id)).toBe(spec.max);
    expect(clampThreshold(spec.min - 1000, id)).toBe(spec.min);
    expect(clampThreshold('abc', id)).toBeNull();
    expect(clampThreshold(`${spec.default}`.replace('.', ','), id)).toBe(spec.default);
    const noThreshold = ALERT_TYPE_IDS.find((i) => !RULE_CATALOG[i].threshold);
    if (noThreshold) expect(clampThreshold(1, noThreshold)).toBeNull();
  });

  it('mutes and unmutes a bot without leaving a false entry behind', () => {
    const muted = withBotEnabled(emptyCfg(), 'b1', false);
    expect(muted.perBotEnabled).toEqual({ b1: false });
    expect(withBotEnabled(muted, 'b1', true).perBotEnabled).toEqual({});
  });
});

describe('workspace resets', () => {
  it('drops one preset or all of them without touching the rest', () => {
    const cols = { fleet: { order: ['a'] }, open: { order: ['b'] } } as never;
    expect(Object.keys(withoutColumns(cols, 'fleet'))).toEqual(['open']);
    expect(withoutColumns(cols, 'all')).toEqual({});
    expect(customizedColumns(cols)).toEqual(['fleet', 'open']);
    expect(COLUMN_PRESETS).toContain('journal');
    expect(defaultScopeBlock()).toEqual({ mode: 'live', workspace: 'surveillance' });
  });
});
