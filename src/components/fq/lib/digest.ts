import type { Event } from '@/gateway/types.gen';

export interface Digest {
  realized: number;
  wins: number;
  losses: number;
  /** Entry fills, which include the DCA reinforcements (the event does not tell them apart). */
  entries: number;
  alertsRaised: number;
  alertsResolved: number;
  restarts: number;
  worst: { profit_abs: number; pair: string | null; bot_key: string | null } | null;
  /** Number of events counted, to tell "nothing happened" from "no data". */
  total: number;
}

/**
 * Digest of the events since a marker (02 section 3.1, "Since your last visit"). An exit whose
 * profit is unknown counts as neither a win nor a loss and is left out of the realised sum.
 */
export function digestOf(events: readonly Event[], sinceMs: number): Digest {
  const d: Digest = {
    realized: 0,
    wins: 0,
    losses: 0,
    entries: 0,
    alertsRaised: 0,
    alertsResolved: 0,
    restarts: 0,
    worst: null,
    total: 0,
  };
  for (const e of events) {
    if (e.ts_ms < sinceMs) continue;
    switch (e.kind) {
      case 'exit_fill': {
        d.total += 1;
        const p = e.profit_abs;
        if (p == null || !Number.isFinite(p)) break;
        d.realized += p;
        if (p > 0) d.wins += 1;
        else if (p < 0) d.losses += 1;
        if (d.worst === null || p < d.worst.profit_abs) {
          d.worst = { profit_abs: p, pair: e.pair, bot_key: e.bot_key };
        }
        break;
      }
      case 'entry_fill':
        d.total += 1;
        d.entries += 1;
        break;
      case 'alert_raised':
        d.total += 1;
        d.alertsRaised += 1;
        break;
      case 'alert_resolved':
        d.total += 1;
        d.alertsResolved += 1;
        break;
      case 'startup':
      case 'bot_replaced':
        d.total += 1;
        d.restarts += 1;
        break;
      default:
        break;
    }
  }
  // A "worst trade" that made money is not the worst of anything: leave it out
  if (d.worst && d.worst.profit_abs >= 0) d.worst = null;
  return d;
}
