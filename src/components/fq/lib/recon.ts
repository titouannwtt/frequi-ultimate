/**
 * Reading of the wallet reconciliation (`GET /fleetview/reconciliation` of the bot, cached 60 s).
 * Pure: how a coin is classified, what is proposed for it, and when a new sweep is allowed. Nothing
 * here writes; the "Preview" of a row only asks the page for a destructive confirmation.
 */
import type { FleetviewCoin, FleetviewCoinStatus, FleetviewHintCode } from '@/types/fleetview';

/** Minimum time between two sweeps of the same wallet (03 section 6, 60 s). */
export const RECON_MIN_INTERVAL_MS = 60_000;

export type ReconTone = 'neutral' | 'orphan' | 'warn' | 'crit';

export interface ReconView {
  tone: ReconTone;
  /** Message key suffix: `fq.recon.class.<key>`. */
  classKey: FleetviewCoinStatus;
  /** Message key suffix of the proposal: `fq.recon.proposal.<key>`. */
  proposalKey: 'none' | 'closeUnowned' | 'deletePhantom' | 'closeMinority' | 'review';
  /** A write can be previewed for this row (never for "ok" or an ambiguous row). */
  actionable: boolean;
  /** Distinct bots holding a slice of the coin. */
  bots: number;
  /** Hint codes of an ambiguous row. */
  hints: FleetviewHintCode[];
}

export function reconView(c: FleetviewCoin): ReconView {
  const bots = new Set(c.slices.map((s) => s.bot_name)).size;
  const hints = (c.hints ?? []).map((h) => h.code);
  switch (c.status) {
    case 'ok':
      return {
        tone: 'neutral',
        classKey: 'ok',
        proposalKey: 'none',
        actionable: false,
        bots,
        hints,
      };
    case 'unowned':
      return {
        tone: 'orphan',
        classKey: 'unowned',
        proposalKey: 'closeUnowned',
        actionable: true,
        bots,
        hints,
      };
    case 'phantom':
      return {
        tone: 'warn',
        classKey: 'phantom',
        proposalKey: c.phantom_candidate ? 'deletePhantom' : 'review',
        actionable: c.phantom_candidate !== null,
        bots,
        hints,
      };
    case 'minority':
      return {
        tone: 'warn',
        classKey: 'minority',
        proposalKey: c.minority_slices.length > 0 ? 'closeMinority' : 'review',
        actionable: c.minority_slices.length > 0,
        bots,
        hints,
      };
    case 'ambiguous':
      return {
        tone: 'crit',
        classKey: 'ambiguous',
        proposalKey: 'review',
        actionable: false,
        bots,
        hints,
      };
  }
}

/** Problems first (orphans, then ambiguous), healthy rows last, then by coin. */
export function sortRecon(rows: readonly FleetviewCoin[]): FleetviewCoin[] {
  const rank: Record<FleetviewCoinStatus, number> = {
    unowned: 0,
    ambiguous: 1,
    phantom: 2,
    minority: 3,
    ok: 4,
  };
  return rows
    .slice()
    .sort((a, b) => rank[a.status] - rank[b.status] || a.coin.localeCompare(b.coin));
}

/** Notional of the on-chain position, USDC; null without a mark price. */
export function onChainNotional(c: FleetviewCoin): number | null {
  return c.mark_price == null ? null : Math.abs(c.on_chain) * c.mark_price;
}

/** Milliseconds before a new sweep is allowed; 0 when it is. */
export function nextSweepInMs(checkedMs: number | null | undefined, nowMs: number): number {
  if (checkedMs == null) return 0;
  return Math.max(0, checkedMs + RECON_MIN_INTERVAL_MS - nowMs);
}
