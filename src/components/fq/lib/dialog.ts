/**
 * Computations of the confirmation dialog (02 section 11.3 and 11.6): what a partial exit would
 * leave, what it is expected to realise, the minimum notional, and the contextual warnings.
 * Pure, so the money arithmetic is tested without a component.
 */
import type { BotAction } from '@/datasource/types';

/** Hyperliquid minimum order notional in USDC (measured live: the floor is 10, not 15). */
export const MIN_NOTIONAL = 10;

export const FRACTIONS = [1, 0.5, 0.25] as const;
export type QuantityChoice = 100 | 50 | 25 | 'other';

export interface ExitPosition {
  amount: number;
  notional: number | null;
  profitAbs: number | null;
  currentRate: number | null;
}

export interface ExitPlan {
  /** Share of the position to exit, 0 to 1. */
  fraction: number;
  /** Contracts to exit; undefined for a full exit (the bot closes everything it holds). */
  amount: number | undefined;
  /** Notional exited, USDC; null when the position notional is unknown. */
  notional: number | null;
  /** Estimated realised P&L; null when the P&L is unknown. */
  pnl: number | null;
  /** Notional left after a partial exit. */
  remaining: number | null;
  /** A partial exit under the minimum would be refused by the exchange: the form blocks it. */
  belowMin: boolean;
  /** What would remain is too small to be sold later. */
  remainingBelowMin: boolean;
  valid: boolean;
}

/** Contract amounts are sent with at most 8 decimals; rounding never exceeds the position. */
function roundAmount(v: number): number {
  return Math.floor(v * 1e8) / 1e8;
}

export function exitPlan(p: ExitPosition, fraction: number): ExitPlan {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const full = f >= 1;
  const notional = p.notional == null ? null : p.notional * f;
  const remaining = p.notional == null ? null : p.notional * (1 - f);
  const belowMin = !full && notional !== null && notional < MIN_NOTIONAL;
  const remainingBelowMin =
    !full && remaining !== null && remaining > 0 && remaining < MIN_NOTIONAL;
  return {
    fraction: f,
    amount: full ? undefined : roundAmount(p.amount * f),
    notional,
    pnl: p.profitAbs == null ? null : p.profitAbs * f,
    remaining,
    belowMin,
    remainingBelowMin,
    valid: f > 0 && !belowMin && (full || roundAmount(p.amount * f) > 0),
  };
}

/** Fraction of a notional typed in USDC; NaN when the field is empty or not a number. */
export function fractionFromNotional(usdc: number, notional: number | null): number {
  if (notional == null || notional <= 0 || !Number.isFinite(usdc)) return NaN;
  return Math.min(1, usdc / notional);
}

export type WarningKey =
  | 'netted'
  | 'belowMin'
  | 'remainingBelowMin'
  | 'stopLaunchScript'
  | 'exitAllNoPause'
  | 'reload'
  | 'deleteOrphans'
  | 'leverageCoin'
  | 'liveOrder';

export interface DialogWarning {
  key: WarningKey;
  tone: 'info' | 'warn';
  params?: Record<string, string | number>;
}

export interface WarningContext {
  /** Names of the other bots holding the same coin on the same wallet. */
  nettedWith?: string[];
  /** `false` or unknown: entries are not known to be paused. */
  entriesPaused?: boolean | null;
  plan?: ExitPlan | null;
  /** The bot was launched by `launch_bot.sh`: a `/stop` through the API restarts it. */
  viaLaunchScript?: boolean;
}

/** Contextual warnings of 02 section 11.6, in the order they should be read. */
export function warningsFor(action: BotAction, ctx: WarningContext = {}): DialogWarning[] {
  const out: DialogWarning[] = [];
  switch (action.kind) {
    case 'forceexit':
      if (action.tradeId === 'all') {
        if (ctx.entriesPaused !== true) out.push({ key: 'exitAllNoPause', tone: 'warn' });
      } else {
        if (ctx.nettedWith && ctx.nettedWith.length > 0) {
          out.push({ key: 'netted', tone: 'warn', params: { bots: ctx.nettedWith.join(', ') } });
        }
        if (ctx.plan?.belowMin) {
          out.push({ key: 'belowMin', tone: 'warn', params: { min: MIN_NOTIONAL } });
        } else if (ctx.plan?.remainingBelowMin) {
          out.push({
            key: 'remainingBelowMin',
            tone: 'warn',
            params: { min: MIN_NOTIONAL, rest: Math.round(ctx.plan.remaining ?? 0) },
          });
        }
      }
      break;
    case 'forceentry':
      out.push({ key: 'leverageCoin', tone: 'info' });
      if (ctx.nettedWith && ctx.nettedWith.length > 0) {
        out.push({ key: 'netted', tone: 'warn', params: { bots: ctx.nettedWith.join(', ') } });
      }
      break;
    case 'stop':
      // Always shown: the owner launches bots with `launch_bot.sh`, which relaunches after /stop
      out.push({ key: 'stopLaunchScript', tone: 'warn' });
      break;
    case 'reload_config':
      out.push({ key: 'reload', tone: 'warn' });
      break;
    case 'delete_trade':
      out.push({ key: 'deleteOrphans', tone: 'warn' });
      break;
    default:
      break;
  }
  return out;
}

/** Whether the action is an exit of one trade (not "all"). */
export function isSingleExit(a: BotAction): a is Extract<BotAction, { kind: 'forceexit' }> & {
  tradeId: number;
} {
  return a.kind === 'forceexit' && a.tradeId !== 'all';
}

/**
 * Other bots holding the same coin on the same wallet (Hyperliquid nets them): an exit of this
 * trade only reduces this trade's quantity, the figures of the wallet move with the others.
 */
export function nettedWith(
  position: { bot_key: string; coin: string },
  bots: Readonly<
    Record<string, { identity: { name: string }; state: { wallet_id: string | null } }>
  >,
  positions: ReadonlyArray<{ bot_key: string; coin: string }>,
): string[] {
  const walletId = bots[position.bot_key]?.state.wallet_id ?? null;
  if (walletId === null) return [];
  const names = new Set<string>();
  for (const other of positions) {
    if (other.bot_key === position.bot_key || other.coin !== position.coin) continue;
    const b = bots[other.bot_key];
    if (b && b.state.wallet_id === walletId) names.add(b.identity.name);
  }
  return [...names].sort();
}
