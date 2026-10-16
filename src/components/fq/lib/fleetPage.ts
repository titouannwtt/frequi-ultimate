/**
 * Pure helpers of the calmer Fleet page (docs/redesign/05-friendly-plan.md, L4): the one-sentence
 * verdict, the alerts that belong to the scope, the five positions to watch and the facts told in
 * words ("Renforts 2", "liquidation loin"). The components only draw what is decided here.
 */
import type { BotState } from '@/components/ds/types';
import { ruleMeta } from '@/datasource/calc/alerts/rules';
import type {
  Alert,
  AlertRulesConfig,
  AlertTypeId,
  BotKey,
  BotMode,
  BotRow,
} from '@/gateway/types.gen';
import type { ScopeMode } from '@/migration/schema';

import type { AlertActionId } from './alerts';
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

/**
 * The limit of an alert rule as the owner set it (else the default one), as a positive percent:
 * the figures the page draws against a limit (the drawdown bar) and the notices below share it.
 */
export function alertLimit(rules: Pick<AlertRulesConfig, 'global'>, id: AlertTypeId): number {
  const custom = rules.global[id]?.threshold;
  return Math.abs(custom ?? ruleMeta(id).threshold?.default ?? 0);
}

// ---- what the owner must act on, beyond the alerts ----

export type NoticeKind =
  | 'authExpired'
  | 'offline'
  | 'frozen'
  | 'drawdown'
  | 'liquidation'
  | 'orphans';

/** What a notice card can offer: an action of the alerts, or "See the bots" for the fleet figures. */
export type NoticeActionId = AlertActionId | 'bots';

/**
 * A condition the owner must act on that no alert carries: the gateway emits no alert for an
 * expired session or a frozen bot, the drawdown rule is off by default and an orphan position is
 * not a rule. Same severities as the rules that do exist, so the verdict reads them like alerts.
 */
export interface FleetNotice {
  id: string;
  kind: NoticeKind;
  severity: 'critical' | 'warning';
  /** The bot it is about; null for the fleet figures and the wallet. */
  botKey: BotKey | null;
  /** Every bot a grouped notice is about (frozen bots). */
  botKeys: BotKey[];
  mode: BotMode | null;
  /** Since when the bot is silent, when the bot said so. */
  sinceMs: number | null;
  value: number | null;
  threshold: number | null;
  pair: string | null;
  /** How many positions or bots it counts. */
  n: number;
  actions: NoticeActionId[];
}

export interface NoticeInput {
  /** The bots of the shown trading mode. */
  bots: readonly BotRow[];
  stateOf: (bot: BotRow) => BotState;
  /** Every alert, acknowledged or silenced too: what an alert already says is not said twice. */
  alerts: readonly Pick<Alert, 'type_id' | 'bot_key'>[];
  /** Drawdown of the fleet in percent, per mode shown; null when unknown. */
  drawdowns: readonly { mode: BotMode; pct: number | null }[];
  drawdownLimit: number;
  /** The closest liquidation per mode shown. */
  nearest: readonly { mode: BotMode; botKey: BotKey; pair: string; distancePct: number }[];
  liquidationLimit: number;
  /** Positions on the wallet that no bot owns. */
  orphans: number;
}

const NOTICE_ORDER: Record<NoticeKind, number> = {
  authExpired: 0,
  offline: 1,
  frozen: 2,
  liquidation: 3,
  drawdown: 4,
  orphans: 5,
};

/**
 * Everything the owner must act on that the alerts do not already say, for the verdict and the
 * cards: a live bot that is offline, whose session expired or whose figures are frozen (left out
 * of the totals), a drawdown above its limit, a liquidation closer than its limit, an orphan
 * position. Worst first.
 */
export function fleetNotices(input: NoticeInput): FleetNotice[] {
  const has = (type: AlertTypeId, botKey?: BotKey | null) =>
    input.alerts.some((a) => a.type_id === type && (botKey == null || a.bot_key === botKey));
  const base = {
    botKey: null,
    botKeys: [] as BotKey[],
    mode: null,
    sinceMs: null,
    value: null,
    threshold: null,
    pair: null,
    n: 1,
  };
  const out: FleetNotice[] = [];

  const frozen: BotRow[] = [];
  for (const b of input.bots) {
    const st = input.stateOf(b);
    if (st === 'stale') {
      frozen.push(b);
      continue;
    }
    // The offline rule speaks for an offline bot; nothing speaks for an expired session
    const kind: NoticeKind | null =
      st === 'auth_expired'
        ? 'authExpired'
        : st === 'offline' && !has('botOffline', b.bot_key)
          ? 'offline'
          : null;
    if (kind === null) continue;
    out.push({
      ...base,
      id: `${kind}:${b.bot_key}`,
      kind,
      severity: kind === 'offline' ? 'critical' : 'warning',
      botKey: b.bot_key,
      botKeys: [b.bot_key],
      mode: b.identity.mode,
      sinceMs: b.state.since_ms,
      actions: kind === 'offline' ? ['logs', 'open'] : ['reconnect'],
    });
  }
  if (frozen.length > 0) {
    const keys = frozen.map((b) => b.bot_key).sort();
    out.push({
      ...base,
      id: `frozen:${keys.join(',')}`,
      kind: 'frozen',
      severity: 'warning',
      botKey: keys.length === 1 ? keys[0]! : null,
      botKeys: keys,
      n: keys.length,
      actions: keys.length === 1 ? ['open'] : ['diagnostic'],
    });
  }

  for (const d of input.nearest) {
    if (d.distancePct >= input.liquidationLimit || has('nearLiquidation', d.botKey)) continue;
    out.push({
      ...base,
      id: `liquidation:${d.botKey}`,
      kind: 'liquidation',
      severity: 'critical',
      botKey: d.botKey,
      botKeys: [d.botKey],
      mode: d.mode,
      value: d.distancePct,
      threshold: input.liquidationLimit,
      pair: d.pair,
      actions: ['pause', 'open'],
    });
  }

  // A bot-level drawdown alert (rule off by default) already says it: the fleet figure stays quiet
  if (!has('highDrawdown')) {
    for (const d of input.drawdowns) {
      if (d.pct === null || d.pct < input.drawdownLimit) continue;
      out.push({
        ...base,
        id: `drawdown:${d.mode}`,
        kind: 'drawdown',
        severity: 'warning',
        mode: d.mode,
        value: d.pct,
        threshold: input.drawdownLimit,
        actions: ['bots'],
      });
    }
  }

  if (input.orphans > 0) {
    out.push({
      ...base,
      id: 'orphans',
      kind: 'orphans',
      severity: 'warning',
      n: input.orphans,
      actions: ['reconcile'],
    });
  }

  const rank = (n: FleetNotice) => (n.severity === 'critical' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || NOTICE_ORDER[a.kind] - NOTICE_ORDER[b.kind]);
}

/** The notices the owner did not put off ("Later"): a snooze is an id and the time it lasts to. */
export function notSnoozed(
  notices: readonly FleetNotice[],
  snoozes: Readonly<Record<string, number>>,
  nowMs: number,
): FleetNotice[] {
  return notices.filter((n) => (snoozes[n.id] ?? 0) <= nowMs);
}
