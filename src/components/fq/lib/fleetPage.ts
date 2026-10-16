/**
 * Pure helpers of the calmer Fleet page (docs/redesign/05-friendly-plan.md, L4): the one-sentence
 * verdict, the alerts that belong to the scope, the five positions to watch and the facts told in
 * words ("Renforts 2", "liquidation loin"). The components only draw what is decided here.
 */
import type { Alert, BotMode } from '@/gateway/types.gen';
import type { ScopeMode } from '@/migration/schema';

import { compareWorstFirst, durationTone, liqTone, type TradeLine } from './trades';

export type VerdictLevel = 'calm' | 'one' | 'many' | 'critical';

export interface Verdict {
  level: VerdictLevel;
  /** Alerts the sentence counts: the critical ones, else the warnings and worse. */
  n: number;
}

/**
 * The sentence of the Fleet: calm, one thing to see, several, or something critical. An `info`
 * alert is shown as a card but does not make the fleet "not fine" (it asks for no decision).
 */
export function verdictOf(active: readonly Pick<Alert, 'severity'>[]): Verdict {
  const critical = active.filter((a) => a.severity === 'critical').length;
  if (critical > 0) return { level: 'critical', n: critical };
  const n = active.filter((a) => a.severity === 'warning').length;
  if (n === 0) return { level: 'calm', n: 0 };
  return { level: n === 1 ? 'one' : 'many', n };
}

/**
 * The alerts of the scope: those of a bot of the shown trading mode, and the wallet ones (no bot).
 * The bell keeps counting every alert; here a dry bot's problem does not speak on the live view.
 */
export function alertsInScope(
  alerts: readonly Alert[],
  modeOf: (botKey: string) => BotMode | null,
  scope: ScopeMode,
): Alert[] {
  return alerts.filter((a) => {
    if (a.bot_key === null) return true;
    const m = modeOf(a.bot_key);
    if (m === null) return true;
    return scope === 'all' ? m === 'live' || m === 'dry' : m === scope;
  });
}

export interface WatchSelection {
  /** The worst positions, worst first. */
  top: TradeLine[];
  /** All the positions considered. */
  total: number;
  /** The worst one really loses: the title says "lose the most", else "gain the least". */
  losing: boolean;
}

/** The `n` positions that do the worst, an unknown result going last. */
export function watchSelection(lines: readonly TradeLine[], n = 5): WatchSelection {
  const top = [...lines].sort(compareWorstFirst).slice(0, n);
  const worst = top[0]?.pnlAbs ?? null;
  return { top, total: lines.length, losing: worst !== null && worst < 0 };
}

/** Safety orders filled (the contract counts the first entry too). */
export function safetyOrders(l: Pick<TradeLine, 'dcaFilled'>): number {
  return Math.max(0, l.dcaFilled - 1);
}

/** Safety orders allowed, when the bot said how many entries it takes. */
export function safetyOrdersMax(l: Pick<TradeLine, 'dcaMax'>): number | null {
  return l.dcaMax == null ? null : Math.max(0, l.dcaMax - 1);
}

export type LiqWord = 'far' | 'watch' | 'near';

/** The liquidation distance in a word: under 15 % near, under 25 % to watch, else far. */
export function liqWord(distancePct: number | null): LiqWord | null {
  const tone = liqTone(distancePct);
  if (tone === 'neutral') return distancePct == null ? null : 'far';
  return tone === 'crit' ? 'near' : tone === 'warn' ? 'watch' : 'far';
}

/** A duration that is long for this bot (from p84): the sentence says so. */
export function isLongerThanUsual(l: Pick<TradeLine, 'percentile'>): boolean {
  return durationTone(l.percentile) !== 'ok';
}
