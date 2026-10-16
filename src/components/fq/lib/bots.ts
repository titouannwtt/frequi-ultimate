/**
 * Pure helpers of the fleet composites: state of a bot, attention order, group aggregates, sums
 * that leave out what is stale (docs/redesign/02-design.md, sections 3.1, 10.2 and 12).
 */
import type { BotState } from '@/components/ds/types';
import { DIGEST_STALE_MS, sumFresh, type FreshSum } from '@/datasource/calc/freshness';
import { SEVERITY_RANK } from '@/datasource/calc/alerts/rules';
import type {
  BotRow,
  DrawdownValue,
  FreshnessGroup,
  Severity,
  WalletRow,
} from '@/gateway/types.gen';
import type { BotGroupPrefs } from '@/migration/schema';

export type FleetSort = 'attention' | 'latent' | 'name';

/**
 * Drawdown of a bot or a scope in percent, or null without a starting capital. The contract carries
 * it as a ratio like every other ratio (`0.024` is 2.4 %, `abs / base`), while the alert threshold
 * (`highDrawdown`) and the display are in percent: this is the one place that converts (bug B73).
 */
export function drawdownPct(d: Pick<DrawdownValue, 'pct'> | null | undefined): number | null {
  return d?.pct == null || !Number.isFinite(d.pct) ? null : d.pct * 100;
}

/** Server clock at this instant: browser time corrected by the skew learnt from the heartbeat. */
export function serverNow(nowMs: number, skewMs: number): number {
  return nowMs + skewMs;
}

/**
 * A group of figures of a bot is stale when the server says so, or when it is a digest older than
 * its threshold (the flag was computed at publication time and the tab may have been idle since).
 */
export function isStaleGroup(
  bot: BotRow,
  group: FreshnessGroup,
  nowMs: number,
  skewMs: number,
): boolean {
  const f = bot.freshness[group];
  if (!f) return true;
  if (f.stale) return true;
  return f.source === 'digest' && serverNow(nowMs, skewMs) - f.as_of_ms > DIGEST_STALE_MS;
}

/** State dot of a bot: the status of the process, or `stale` when it is online but silent. */
export function botState(bot: BotRow, nowMs: number, skewMs: number): BotState {
  const s = bot.state.status;
  if (s === 'online' && isStaleGroup(bot, 'state', nowMs, skewMs)) return 'stale';
  return s;
}

/** Actions are possible only on a bot that answers and whose session is valid. */
export function isActionable(state: BotState): boolean {
  return state === 'online';
}

/** 3 critical, 2 warning, 1 info, 0 calm. */
export function attentionRank(bot: BotRow): number {
  const sev = bot.alerts.max_severity;
  if (!sev || bot.alerts.count === 0) return 0;
  return SEVERITY_RANK[sev] + 1;
}

/**
 * Rank of a bot in the "attention" order, problems first (the sort the Fleet announces): a bot
 * that is offline or whose session expired (nobody can act on it from here), then a critical alert,
 * then a bot whose figures are frozen (online but silent), a warning, an info and the calm ones.
 * Twice the alert rank, so that the silent states slot in between.
 */
export function attentionScore(bot: BotRow, state: BotState): number {
  if (state === 'offline' || state === 'auth_expired') return 7;
  const alert = attentionRank(bot) * 2;
  if (state === 'stale') return Math.max(alert, 5);
  return alert;
}

/** The rank the table and the tiles sort by: the state of the bot is read at the clock they use. */
export type RankOf = (bot: BotRow) => number;

const defaultRank: RankOf = (b) => attentionScore(b, b.state.status);

export function severityRank(s: Severity | null | undefined): number {
  return s ? SEVERITY_RANK[s] + 1 : 0;
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Worst latent first (a missing latent goes last). */
function byLatent(a: BotRow, b: BotRow): number {
  const x = a.metrics.open_profit_abs;
  const y = b.metrics.open_profit_abs;
  if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
  return x - y;
}

export function compareBots(
  sort: FleetSort,
  rankOf: RankOf = defaultRank,
): (a: BotRow, b: BotRow) => number {
  const name = (a: BotRow, b: BotRow) =>
    collator.compare(a.identity.name, b.identity.name) || a.bot_key.localeCompare(b.bot_key);
  switch (sort) {
    case 'attention':
      return (a, b) => rankOf(b) - rankOf(a) || byLatent(a, b) || name(a, b);
    case 'latent':
      return (a, b) => byLatent(a, b) || name(a, b);
    case 'name':
      return name;
  }
}

/**
 * Signature of what decides the "attention" order: the rank of each bot. The order of the table
 * only changes when this signature changes (an alert appears or resolves, a bot goes silent or
 * answers again), not at every tick of the latent profit.
 */
export function attentionSignature(rows: readonly BotRow[], rankOf: RankOf = defaultRank): string {
  return rows
    .map((b) => `${b.bot_key}:${rankOf(b)}`)
    .sort()
    .join('|');
}

export interface StableOrderState {
  signature: string;
  sort: FleetSort;
  keys: string[];
}

/**
 * Order of the bots, stable between ticks. `prev` is the previous result; `frozen` (hover or focus
 * in the table) keeps it as it was, new bots going last. The order is recomputed when the sort
 * changes, when the attention signature changes, and at every change for the `latent` and `name`
 * sorts (the user asked for them explicitly).
 */
export function stableOrder(
  rows: readonly BotRow[],
  sort: FleetSort,
  prev: StableOrderState | null,
  frozen: boolean,
  rankOf: RankOf = defaultRank,
): StableOrderState {
  const signature = attentionSignature(rows, rankOf);
  const reuse =
    prev !== null &&
    prev.sort === sort &&
    (frozen || (sort === 'attention' && prev.signature === signature));
  if (reuse) {
    const present = new Set(rows.map((r) => r.bot_key));
    const known = new Set(prev.keys);
    const added = rows.filter((r) => !known.has(r.bot_key)).sort(compareBots(sort, rankOf));
    // Bots that left are dropped, new ones go last until the next recompute
    return {
      signature: prev.signature,
      sort,
      keys: [...prev.keys.filter((k) => present.has(k)), ...added.map((r) => r.bot_key)],
    };
  }
  return { signature, sort, keys: [...rows].sort(compareBots(sort, rankOf)).map((r) => r.bot_key) };
}

export interface BotGroup {
  id: string;
  name: string;
  icon: string;
  collapsed: boolean;
  bots: BotRow[];
  /** Bots with an alert ("N à voir"). */
  toWatch: number;
}

export const UNGROUPED_ID = '__ungrouped';

/** Split ordered bots into the user's groups; bots in no group come last. A bot is in one group. */
export function groupBots(
  ordered: readonly BotRow[],
  groups: readonly BotGroupPrefs[],
  ungroupedName: string,
): BotGroup[] {
  const placed = new Set<string>();
  const out: BotGroup[] = [];
  for (const g of groups) {
    const members = new Set(g.botKeys);
    const bots = ordered.filter((b) => members.has(b.bot_key) && !placed.has(b.bot_key));
    if (bots.length === 0) continue;
    bots.forEach((b) => placed.add(b.bot_key));
    out.push({
      id: g.id,
      name: g.name,
      icon: g.icon,
      collapsed: g.collapsed,
      bots,
      toWatch: bots.filter((b) => b.alerts.count > 0).length,
    });
  }
  const rest = ordered.filter((b) => !placed.has(b.bot_key));
  if (rest.length > 0) {
    out.push({
      id: UNGROUPED_ID,
      name: ungroupedName,
      icon: '',
      collapsed: false,
      bots: rest,
      toWatch: rest.filter((b) => b.alerts.count > 0).length,
    });
  }
  return out;
}

/** Sum a figure of the bots, leaving out the stale and the missing: the total says how many. */
export function sumBots(
  bots: readonly BotRow[],
  group: FreshnessGroup,
  pick: (b: BotRow) => number | null | undefined,
  nowMs: number,
  skewMs: number,
): FreshSum {
  return sumFresh(
    bots.map((b) => ({
      key: b.bot_key,
      value: pick(b),
      fresh: { stale: isStaleGroup(b, group, nowMs, skewMs) },
    })),
  );
}

/** Direction of the exposure of a bot: long, short, both, or none when flat or unknown. */
export function exposureSide(bot: BotRow): 'long' | 'short' | 'both' | null {
  const l = bot.metrics.exposure_long ?? 0;
  const s = bot.metrics.exposure_short ?? 0;
  if (l > 0 && s > 0) return 'both';
  if (l > 0) return 'long';
  if (s > 0) return 'short';
  return null;
}

/** Share of the slots in use, 0 to 1; null when the maximum is unknown. */
export function slotsRatio(bot: BotRow): number | null {
  const max = bot.state.max_open_trades;
  if (max == null || max <= 0) return null;
  return Math.min(1, bot.state.open_trades / max);
}

export function isReplay(bot: BotRow): boolean {
  return bot.identity.mode === 'replay';
}

/** Minutes since a timestamp on the server clock, never negative. */
export function minutesSince(sinceMs: number | null, nowMs: number, skewMs: number): number | null {
  if (sinceMs == null) return null;
  return Math.max(0, Math.floor((serverNow(nowMs, skewMs) - sinceMs) / 60_000));
}

export interface FleetExposure {
  /** Gross exposure after netting per coin on each wallet, USDC. */
  total: number;
  /** Every bot of the scope sat on a known wallet (so the figure is netted at wallet level). */
  netted: boolean;
  /** Wallets or bots left out because their figures are stale. */
  excluded: number;
}

/**
 * Exposure of a set of bots at WALLET level (02 section 12): the positions of the bots sharing a
 * wallet net against each other per coin, so the exposure is read from the wallets, never summed
 * bot by bot. A bot without a wallet falls back to its own gross figure and the result says it is
 * not fully netted.
 */
export function fleetExposure(
  bots: readonly BotRow[],
  wallets: Readonly<Record<string, WalletRow>>,
  nowMs: number,
  skewMs: number,
): FleetExposure {
  let total = 0;
  let excluded = 0;
  let netted = true;
  const seen = new Set<string>();
  for (const b of bots) {
    const wid = b.state.wallet_id;
    const wallet = wid ? wallets[wid] : undefined;
    if (wid && wallet) {
      if (seen.has(wid)) continue;
      seen.add(wid);
      if (wallet.freshness.stale) {
        excluded += 1;
        continue;
      }
      total += Object.values(wallet.net_exposure).reduce((acc, v) => acc + Math.abs(v), 0);
      continue;
    }
    netted = false;
    if (isStaleGroup(b, 'positions', nowMs, skewMs)) {
      excluded += 1;
      continue;
    }
    total += (b.metrics.exposure_long ?? 0) + (b.metrics.exposure_short ?? 0);
  }
  return { total, netted, excluded };
}
