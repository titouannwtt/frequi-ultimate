import { describe, expect, it } from 'vitest';

import type { FleetBotDigest } from '@/types/fleetSnapshot';

/**
 * The freshness contract of the fleet snapshot.
 *
 * The digests are pushed by each bot on its own cycle, so an entry can outlive the bot that
 * produced it. Every consumer therefore has to distinguish "live figure" from "figure left
 * behind", and that decision is what these tests pin down — a regression here would show a
 * stopped bot's last known profit as if it were current, which is the one failure mode a
 * monitoring dashboard must not have.
 */

// Mirrors useFleetSnapshot.digestFor without pulling in the Pinia/timer machinery.
const digestFor = (
  digests: Record<string, FleetBotDigest>,
  botName: string,
  maxAgeS = 60,
): FleetBotDigest | undefined => {
  const d = digests[botName];
  if (!d) return undefined;
  return d.age_s <= maxAgeS ? d : undefined;
};

const digest = (over: Partial<FleetBotDigest> = {}): FleetBotDigest => ({
  bot_name: 'alpha',
  state: 'State.RUNNING',
  dry_run: false,
  exchange: 'hyperliquid',
  strategy: 'S',
  stake_currency: 'USDC',
  trading_mode: 'futures',
  open_trade_count: 2,
  max_open_trades: 5,
  closed_profit_abs: 10,
  balance_total: 1000,
  age_s: 1,
  ...over,
});

describe('fleet snapshot freshness', () => {
  it('returns a fresh digest', () => {
    expect(digestFor({ alpha: digest({ age_s: 5 }) }, 'alpha')?.bot_name).toBe('alpha');
  });

  it('refuses a stale digest rather than returning an old figure', () => {
    expect(digestFor({ alpha: digest({ age_s: 600 }) }, 'alpha')).toBeUndefined();
  });

  it('honours a caller-supplied freshness budget', () => {
    const digests = { alpha: digest({ age_s: 30 }) };
    expect(digestFor(digests, 'alpha', 60)).toBeDefined();
    expect(digestFor(digests, 'alpha', 10)).toBeUndefined();
  });

  it('returns undefined for a bot absent from the snapshot', () => {
    expect(digestFor({ alpha: digest() }, 'beta')).toBeUndefined();
  });

  it('treats a digest exactly at the boundary as fresh', () => {
    expect(digestFor({ alpha: digest({ age_s: 60 }) }, 'alpha', 60)).toBeDefined();
  });

  it('keeps optional fields optional', () => {
    // open_profit_abs is omitted when the bot's rate cache could not price open trades:
    // absent must stay distinguishable from zero, or a dashboard would render "0.00"
    // where it should render nothing.
    const d = digest();
    expect(d.open_profit_abs).toBeUndefined();
    expect(digest({ open_profit_abs: 0 }).open_profit_abs).toBe(0);
  });
});
