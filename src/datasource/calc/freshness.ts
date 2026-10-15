/**
 * Freshness: every figure carries its age, a stale figure is neither shown as current nor summed.
 * Port of `fg-core::calc::freshness`.
 *
 * Staleness rules (03 section 6.1): a digest older than 120 s; a REST or SQLite or Python figure
 * older than three times its polling cadence; a WebSocket silent for more than 2 minutes while
 * the bot has open positions (a bot with nothing open has nothing to say).
 */
import type { Freshness, FreshnessSource } from '@/gateway/types.gen';

export const DIGEST_STALE_MS = 120_000;
export const WS_STALE_MS = 120_000;
export const CADENCE_MULTIPLE = 3;

/** Build the freshness of a figure observed at `asOfMs`, evaluated at `nowMs`. */
export function computeFreshness(
  source: FreshnessSource,
  asOfMs: number,
  nowMs: number,
  cadenceMs = 0,
  hasPositions = false,
): Freshness {
  const age = nowMs - asOfMs;
  let stale: boolean;
  switch (source) {
    case 'digest':
      stale = age > DIGEST_STALE_MS;
      break;
    case 'ws':
      stale = hasPositions && age > WS_STALE_MS;
      break;
    default:
      stale = age > CADENCE_MULTIPLE * cadenceMs;
  }
  return { as_of_ms: asOfMs, source, stale };
}

/** Age in ms at server time `serverNowMs` (never negative). */
export function freshnessAgeMs(f: Pick<Freshness, 'as_of_ms'>, serverNowMs: number): number {
  return Math.max(0, serverNowMs - f.as_of_ms);
}

export interface FreshSum {
  total: number;
  included: number;
  /** Keys of the excluded items, in input order. */
  excluded: string[];
}

export interface FreshItem {
  key: string;
  value: number | null | undefined;
  fresh: Pick<Freshness, 'stale'>;
}

/** Sum values, excluding those whose freshness is stale or whose value is missing. */
export function sumFresh(items: Iterable<FreshItem>): FreshSum {
  const s: FreshSum = { total: 0, included: 0, excluded: [] };
  for (const { key, value, fresh } of items) {
    if (value != null && Number.isFinite(value) && !fresh.stale) {
      s.total += value;
      s.included += 1;
    } else {
      s.excluded.push(key);
    }
  }
  return s;
}
