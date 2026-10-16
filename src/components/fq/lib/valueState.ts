/**
 * State of a value slot: `ready` (a figure), `pending` (not received yet) or `unavailable` (loaded,
 * but there is no figure and the reason says why). Pure: decided from what the stores already
 * carry (status of the bot, freshness groups, counts), never from a new flag of the data layer.
 * The component `ValueState` draws it (docs/redesign/02-design.md, section 10.1).
 *
 * The rule of honesty is unchanged (section 12): a stale or unknown figure is never shown as a
 * number and a sum leaves it out. What changes is only the wording: an icon, never "n/a".
 */
import type { BotRow, FreshnessGroup } from '@/gateway/types.gen';

import { isStaleGroup } from './bots';

export type SlotState = 'ready' | 'pending' | 'unavailable';

/** Short machine reason of an unavailable figure; the text lives in `fq.value.reason.*`. */
export type SlotReason =
  | 'offline'
  | 'authExpired'
  | 'stopped'
  | 'stale'
  | 'prices'
  | 'noData'
  | 'noApi'
  | 'direct'
  | 'capital'
  | 'exitReason'
  | 'profit'
  | 'noPercentile'
  | 'noTrades'
  | 'noSample'
  | 'flat';

export interface Slot {
  state: SlotState;
  reason?: SlotReason;
  /** Count the reason talks about (positions without a price). */
  n?: number;
}

export const READY: Slot = Object.freeze({ state: 'ready' }) as Slot;
export const PENDING: Slot = Object.freeze({ state: 'pending' }) as Slot;
export const unavailable = (reason: SlotReason, n?: number): Slot => ({
  state: 'unavailable',
  reason,
  ...(n === undefined ? {} : { n }),
});

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export interface SlotCtx {
  nowMs: number;
  skewMs: number;
  /** The figure is a price based one (latent profit, drawdown with open): see `botSlot`. */
  prices?: boolean;
  /**
   * The figure comes with a group that is read once (the registry: capital, slots): when the group
   * is there and the figure is not, it is missing for good (this reason), not "still loading".
   */
  settled?: SlotReason;
}

/**
 * Slot of a figure of one bot (`value`, read from the freshness group `group`):
 * - a figure: ready (a stale one stays visible, muted, as before);
 * - no figure and the bot is offline, expired or stopped: unavailable, for that reason;
 * - no figure and the bot is starting, or the group was never received: pending;
 * - no figure on a stale group: unavailable (stale);
 * - no figure on a price based figure of a bot that has open positions: unavailable, the exchange
 *   prices are missing (429 backoff of the daemon, exchange down);
 * - otherwise the figure is still being computed (history not read yet): pending, and the
 *   component turns it into "no answer for N s" past 45 s.
 */
export function botSlot(
  bot: BotRow | undefined,
  group: FreshnessGroup,
  value: number | null | undefined,
  ctx: SlotCtx,
): Slot {
  if (finite(value)) return READY;
  if (!bot) return PENDING;
  switch (bot.state.status) {
    case 'offline':
      return unavailable('offline');
    case 'auth_expired':
      return unavailable('authExpired');
    case 'stopped':
      return unavailable('stopped');
    case 'starting':
      return PENDING;
    default:
  }
  if (!bot.freshness[group]) return PENDING;
  if (isStaleGroup(bot, group, ctx.nowMs, ctx.skewMs)) return unavailable('stale');
  if (ctx.prices && bot.state.open_trades > 0) return unavailable('prices', bot.state.open_trades);
  return ctx.settled ? unavailable(ctx.settled) : PENDING;
}

export interface AggregateArgs {
  bots: readonly BotRow[];
  /** The figure of one bot that goes into the sum. */
  pick: (b: BotRow) => number | null | undefined;
  group: FreshnessGroup;
  /** The sum has a figure at all (the source returned one). */
  hasValue: boolean;
  /** Price based figure: see `botSlot`. */
  prices?: boolean;
  nowMs: number;
  skewMs: number;
}

/**
 * Slot of a sum over bots. A bot contributes when its figure is known and fresh (the rule of
 * `sumBots`). The sum is a figure only when something contributes to it:
 * - nothing is open and the sum has a value: a true zero (ready);
 * - some of the open positions are priced: the partial sum, with its "N excluded" counter (ready);
 * - every open position of the scope is excluded (prices unknown, bots silent): never 0.00, the
 *   sum is unavailable, or pending while a bot is still being read.
 * A bot without open position adds a true zero to a latent sum, but it does not make the sum a
 * figure when all the open positions are excluded: that is what the position count tells.
 */
export function aggregateSlot(a: AggregateArgs): Slot {
  const bots = a.bots;
  if (bots.length === 0) return READY;
  const ctx = { nowMs: a.nowMs, skewMs: a.skewMs, prices: a.prices };
  const contributes = (b: BotRow) =>
    finite(a.pick(b)) && !isStaleGroup(b, a.group, a.nowMs, a.skewMs);
  const open = bots.reduce((n, b) => n + b.state.open_trades, 0);
  const contributing = bots.filter(contributes);
  const contributingOpen = contributing.reduce((n, b) => n + b.state.open_trades, 0);

  if (a.hasValue && contributing.length > 0) {
    if (!a.prices || open === 0 || contributingOpen > 0) return READY;
  }
  // Nothing contributes: why?
  const slots = bots.filter((b) => !contributes(b)).map((b) => botSlot(b, a.group, null, ctx));
  // Open positions known to be unpriced settle it: a bot still being read can only add to them
  if (a.prices && open > 0 && slots.some((s) => s.reason === 'prices')) {
    return unavailable('prices', open);
  }
  if (slots.some((s) => s.state === 'pending')) return PENDING;
  const reasons = new Set(slots.map((s) => s.reason));
  if (reasons.size === 1) {
    const only = slots[0]!;
    return only.reason === 'prices' ? unavailable('prices', open) : only;
  }
  return a.prices && open > 0 ? unavailable('prices', open) : unavailable('stale');
}

/**
 * Slot of a figure of an open position (price, profit, distance to liquidation): the position is
 * loaded, so a missing figure is never "loading". A stale position says stale; a missing price
 * says prices (the exchange tickers are blocked by the 429 backoff, the bot returns null).
 */
export function positionSlot(
  p: { freshness: { stale: boolean } },
  value: number | null | undefined,
  reason: SlotReason = 'prices',
): Slot {
  if (finite(value)) return READY;
  if (p.freshness.stale) return unavailable('stale');
  return unavailable(reason, 1);
}

/**
 * Slot of a figure of a trade line (open position or closed trade): the line is loaded, so a
 * missing figure is never "loading". Open: stale says stale, a missing price says prices. Closed:
 * the figure was never recorded (`reason`, default no data).
 */
export function lineSlot(
  line: { open: boolean; stale: boolean },
  value: number | null | undefined,
  reason: SlotReason = 'prices',
): Slot {
  if (finite(value)) return READY;
  if (!line.open) return unavailable(reason === 'prices' ? 'noData' : reason);
  if (line.stale) return unavailable('stale');
  return unavailable(reason, 1);
}
