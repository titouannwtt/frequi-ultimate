/**
 * The 14 alert rules of `useAlertDetection.ts`, ported from `fg-core::alerts::rules`. In gateway
 * mode they run server side 24/7; in direct mode they run in the open tab on the same vectors.
 *
 * Corrections with respect to the old browser implementation (see docs/redesign/04-bugs.md):
 * - `noTradeActivity` compared milliseconds with seconds and never fired (B5): timestamps are
 *   normalised to milliseconds on entry.
 * - `allFundsExposed` read a field that does not exist (B6): it compares the open stakes with the
 *   bot's starting capital.
 * - `nearLiquidation` used `1 + profit_ratio` as a distance (B22): the distance is measured
 *   between the current rate and the liquidation price.
 * - Log rules counted the whole 200-line buffer forever (B23): only the last 15 minutes count.
 * - A rule whose data is stale or unavailable is skipped, not evaluated as healthy (B26, B33).
 */
import type {
  AlertRulesConfig,
  AlertTypeId,
  BotAlertContext,
  Condition,
  Evaluation,
  LogLine,
  RuleConfig,
  RuleMeta,
  Severity,
  Side,
} from '@/gateway/types.gen';

import { normalizeTsMs } from '../time';

/** Window (ms) in which log lines count. */
export const LOG_WINDOW_MS = 15 * 60 * 1000;
/** Default delay before a non critical condition fires. */
export const DEFAULT_FOR_MS = 30_000;
/** Share of the starting capital in open stakes that triggers `allFundsExposed`. */
export const FUNDS_EXPOSED_RATIO = 0.95;

/** The 14 rules, in the order of the old catalog. */
export const ALERT_TYPE_IDS: readonly AlertTypeId[] = [
  'positionLoss',
  'positionStuck',
  'nearLiquidation',
  'logErrors',
  'orderFailed',
  'insufficientFunds',
  'exchangeError',
  'walletMismatch',
  'noTradeActivity',
  'botOffline',
  'highDrawdown',
  'capacityFull',
  'allFundsExposed',
  'liquidationBeforeStoploss',
];

const spec = (min: number, max: number, def: number, step: number, unit: string) => ({
  min,
  max,
  default: def,
  step,
  unit,
});

/** Static description of every rule. */
export const RULE_CATALOG: Readonly<Record<AlertTypeId, RuleMeta>> = {
  positionLoss: {
    id: 'positionLoss',
    category: 'position',
    severity: 'warning',
    default_enabled: true,
    threshold: spec(-100, -1, -10, 1, '%'),
    direction: 'lower_is_worse',
    re_alert_step: 5,
  },
  positionStuck: {
    id: 'positionStuck',
    category: 'position',
    severity: 'warning',
    default_enabled: false,
    threshold: spec(1.5, 10, 3, 0.5, 'x'),
    direction: 'higher_is_worse',
    re_alert_step: null,
  },
  nearLiquidation: {
    id: 'nearLiquidation',
    category: 'position',
    severity: 'critical',
    default_enabled: true,
    threshold: spec(5, 50, 15, 1, '%'),
    direction: 'lower_is_worse',
    re_alert_step: 3,
  },
  logErrors: {
    id: 'logErrors',
    category: 'log',
    severity: 'critical',
    default_enabled: true,
    threshold: null,
    direction: 'higher_is_worse',
    re_alert_step: null,
  },
  orderFailed: {
    id: 'orderFailed',
    category: 'log',
    severity: 'critical',
    default_enabled: true,
    threshold: null,
    direction: 'higher_is_worse',
    re_alert_step: null,
  },
  insufficientFunds: {
    id: 'insufficientFunds',
    category: 'log',
    severity: 'warning',
    default_enabled: true,
    threshold: null,
    direction: 'higher_is_worse',
    re_alert_step: null,
  },
  exchangeError: {
    id: 'exchangeError',
    category: 'log',
    severity: 'warning',
    default_enabled: false,
    threshold: null,
    direction: 'higher_is_worse',
    re_alert_step: null,
  },
  walletMismatch: {
    id: 'walletMismatch',
    category: 'log',
    severity: 'critical',
    default_enabled: true,
    threshold: null,
    direction: 'higher_is_worse',
    re_alert_step: null,
  },
  noTradeActivity: {
    id: 'noTradeActivity',
    category: 'activity',
    severity: 'info',
    default_enabled: false,
    threshold: spec(1, 168, 24, 1, 'h'),
    direction: 'higher_is_worse',
    re_alert_step: null,
  },
  botOffline: {
    id: 'botOffline',
    category: 'activity',
    severity: 'critical',
    default_enabled: true,
    threshold: null,
    direction: 'higher_is_worse',
    re_alert_step: null,
  },
  highDrawdown: {
    id: 'highDrawdown',
    category: 'system',
    severity: 'warning',
    default_enabled: false,
    threshold: spec(-50, -5, -15, 1, '%'),
    direction: 'lower_is_worse',
    re_alert_step: 5,
  },
  capacityFull: {
    id: 'capacityFull',
    category: 'system',
    severity: 'info',
    default_enabled: false,
    threshold: null,
    direction: 'higher_is_worse',
    re_alert_step: null,
  },
  allFundsExposed: {
    id: 'allFundsExposed',
    category: 'position',
    severity: 'warning',
    default_enabled: true,
    threshold: null,
    direction: 'higher_is_worse',
    re_alert_step: null,
  },
  liquidationBeforeStoploss: {
    id: 'liquidationBeforeStoploss',
    category: 'position',
    severity: 'critical',
    default_enabled: true,
    threshold: null,
    direction: 'lower_is_worse',
    re_alert_step: null,
  },
};

export function ruleMeta(t: AlertTypeId): RuleMeta {
  return RULE_CATALOG[t];
}

export function isAlertTypeId(v: unknown): v is AlertTypeId {
  return typeof v === 'string' && (ALERT_TYPE_IDS as readonly string[]).includes(v);
}

/** Severity order: info < warning < critical. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function defaultRuleConfig(t: AlertTypeId): RuleConfig {
  const m = RULE_CATALOG[t];
  return { enabled: m.default_enabled, threshold: m.threshold?.default ?? null, forS: null };
}

/** The default thresholds and switches of the catalog. */
export function defaultAlertRulesConfig(): AlertRulesConfig {
  const global: AlertRulesConfig['global'] = {};
  for (const t of ALERT_TYPE_IDS) {
    global[t] = defaultRuleConfig(t);
  }
  return { global, perBotEnabled: {}, perBot: {} };
}

/**
 * Effective configuration of a rule for a bot: per-bot override, then global, then the catalog
 * default. A bot muted with `perBotEnabled` has every rule disabled.
 */
export function effectiveRule(
  cfg: Partial<AlertRulesConfig>,
  botKey: string,
  t: AlertTypeId,
): RuleConfig {
  let out: RuleConfig = { ...(cfg.global?.[t] ?? defaultRuleConfig(t)) };
  const over = cfg.perBot?.[botKey]?.[t];
  if (over) {
    out = { ...over };
  }
  if (cfg.perBotEnabled?.[botKey] === false) {
    out.enabled = false;
  }
  return out;
}

/** Effective configuration of all rules for a bot. */
export function effectiveRulesFor(
  cfg: Partial<AlertRulesConfig>,
  botKey: string,
): Record<AlertTypeId, RuleConfig> {
  const out = {} as Record<AlertTypeId, RuleConfig>;
  for (const t of ALERT_TYPE_IDS) {
    out[t] = effectiveRule(cfg, botKey, t);
  }
  return out;
}

const ORDER_FAILED = [
  'Could not create',
  'InvalidOrderException',
  'Unable to exit trade',
  'Unable to create',
  'Insufficient funds',
];
const INSUFFICIENT_FUNDS = ['Insufficient', 'Not enough', 'balance too low'];
const EXCHANGE_ERROR = ['ExchangeError', 'RequestTimeout', 'NetworkError', 'rate limit'];
const WALLET_MISMATCH = ['Wallet shows a total of 0', 'Refusing to adjust'];

function containsCi(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function excerpt(lines: readonly LogLine[], n: number): string | null {
  if (lines.length === 0) {
    return null;
  }
  return lines
    .slice(0, n)
    .map((l) => Array.from(l.message).slice(0, 160).join(''))
    .join(' | ');
}

/**
 * Adverse distance in percent of the rate: how far the rate is from `level` in the direction that
 * hurts a position of the given side.
 */
export function adversePct(side: Side, rate: number, level: number): number {
  const d = side === 'long' ? rate - level : level - rate;
  return (d / rate) * 100;
}

const positive = (v: number | null | undefined): v is number => v != null && v > 0;

/**
 * Evaluate every enabled rule for one bot. `rules` is the effective configuration of the bot
 * (see `effectiveRulesFor`); a missing rule counts as disabled.
 */
export function evaluateBot(
  rules: Partial<Record<AlertTypeId, RuleConfig>>,
  ctx: BotAlertContext,
): Evaluation {
  const conditions: Condition[] = [];
  const evaluatedSet = new Set<AlertTypeId>();
  const disabledSet = new Set<AlertTypeId>();

  const forMs = (cfg: RuleConfig, sev: Severity): number =>
    cfg.forS != null ? cfg.forS * 1000 : sev === 'critical' ? 0 : DEFAULT_FOR_MS;
  const push = (
    cfg: RuleConfig,
    t: AlertTypeId,
    subject: string | null,
    severity: Severity,
    value: number | null,
    threshold: number | null,
    detail: string | null = null,
    pair: string | null = null,
  ) => {
    conditions.push({
      type_id: t,
      subject,
      pair,
      severity,
      value,
      threshold,
      detail,
      for_ms: forMs(cfg, severity),
    });
  };

  // Log lines inside the window, newest information only.
  const recent: LogLine[] | null = ctx.logs
    ? ctx.logs.filter((x) => x.ts_ms >= ctx.now_ms - LOG_WINDOW_MS && x.ts_ms <= ctx.now_ms)
    : null;

  for (const t of ALERT_TYPE_IDS) {
    const cfg: RuleConfig = rules[t] ?? { enabled: false, threshold: null, forS: null };
    if (!cfg.enabled) {
      disabledSet.add(t);
      continue;
    }
    const meta = RULE_CATALOG[t];
    const thr = cfg.threshold ?? meta.threshold?.default ?? null;
    let evaluated = true;

    switch (t) {
      case 'positionLoss': {
        if (ctx.positions_stale) {
          evaluated = false;
          break;
        }
        const thrPct = thr ?? -10;
        for (const p of ctx.positions) {
          if (p.profit_ratio == null) continue;
          const pct = p.profit_ratio * 100;
          if (pct < thrPct) {
            const sev: Severity = pct < thrPct * 2 ? 'critical' : 'warning';
            push(cfg, t, String(p.trade_id), sev, pct, thrPct, null, p.pair);
          }
        }
        break;
      }
      case 'positionStuck': {
        const median = ctx.median_closed_duration_ms;
        // Stale positions or no usable reference duration (ledger unreadable, or no closed trade
        // yet): the rule cannot judge, so a running alert is kept, not resolved.
        if (ctx.positions_stale || !positive(median)) {
          evaluated = false;
          break;
        }
        const mult = thr ?? 3;
        for (const p of ctx.positions) {
          const held = ctx.now_ms - p.open_ms;
          const ratio = held / median;
          if (ratio > mult) {
            push(cfg, t, String(p.trade_id), 'warning', ratio, mult, null, p.pair);
          }
        }
        break;
      }
      case 'nearLiquidation': {
        if (ctx.positions_stale) {
          evaluated = false;
        } else if (ctx.is_futures) {
          const thrPct = thr ?? 15;
          for (const p of ctx.positions) {
            const rate = positive(p.current_rate) ? p.current_rate : null;
            const liq = positive(p.liquidation_price) ? p.liquidation_price : null;
            if (rate === null || liq === null) continue;
            const dist = Math.max(adversePct(p.side, rate, liq), 0);
            if (dist < thrPct) {
              push(cfg, t, String(p.trade_id), 'critical', dist, thrPct, null, p.pair);
            }
          }
        }
        break;
      }
      case 'liquidationBeforeStoploss': {
        if (ctx.positions_stale) {
          evaluated = false;
        } else if (ctx.is_futures) {
          for (const p of ctx.positions) {
            const rate = positive(p.current_rate) ? p.current_rate : null;
            const liq = positive(p.liquidation_price) ? p.liquidation_price : null;
            const sl = positive(p.stoploss_abs) ? p.stoploss_abs : null;
            if (rate === null || liq === null || sl === null) continue;
            const liqD = adversePct(p.side, rate, liq);
            const slD = adversePct(p.side, rate, sl);
            if (liqD < slD) {
              push(cfg, t, String(p.trade_id), 'critical', liqD, slD, null, p.pair);
            }
          }
        }
        break;
      }
      case 'logErrors':
      case 'orderFailed':
      case 'insufficientFunds':
      case 'exchangeError':
      case 'walletMismatch': {
        if (recent === null) {
          evaluated = false;
          break;
        }
        let patterns: string[] = [];
        let nDetail = 3;
        if (t === 'orderFailed') {
          patterns = ORDER_FAILED;
          nDetail = 2;
        } else if (t === 'insufficientFunds') {
          patterns = INSUFFICIENT_FUNDS;
          nDetail = 1;
        } else if (t === 'exchangeError') {
          patterns = EXCHANGE_ERROR;
          nDetail = 1;
        } else if (t === 'walletMismatch') {
          patterns = WALLET_MISMATCH;
          nDetail = 1;
        }
        const matches = recent.filter((l) =>
          t === 'logErrors'
            ? ['ERROR', 'CRITICAL'].includes(l.level.toUpperCase())
            : patterns.some((p) => containsCi(l.message, p)),
        );
        const count = matches.length + (t === 'exchangeError' ? ctx.rate_limit_events : 0);
        if (count > 0) {
          push(cfg, t, null, meta.severity, count, null, excerpt(matches, nDetail));
        }
        break;
      }
      case 'noTradeActivity': {
        // Without a usable last-trade date the rule cannot judge: a running alert is kept.
        const last = ctx.last_trade_ts_raw != null ? normalizeTsMs(ctx.last_trade_ts_raw) : null;
        if (last === null) {
          evaluated = false;
          break;
        }
        const thrH = thr ?? 24;
        const hours = (ctx.now_ms - last) / 3_600_000;
        if (hours > thrH) {
          // Information only: an inactive long bot in a falling market is not an incident.
          push(cfg, t, null, 'info', hours, thrH);
        }
        break;
      }
      case 'botOffline': {
        if (ctx.status === 'offline') {
          push(cfg, t, null, 'critical', null, null);
        } else if (ctx.status === 'starting') {
          push(cfg, t, null, 'info', null, null);
        }
        break;
      }
      case 'highDrawdown': {
        const dd = ctx.drawdown_current_abs;
        const cap = positive(ctx.starting_capital) ? ctx.starting_capital : null;
        if (dd == null || cap === null) {
          evaluated = false;
          break;
        }
        const thrPct = thr ?? -15;
        const pct = (-dd / cap) * 100;
        if (pct < thrPct) {
          push(cfg, t, null, 'warning', pct, thrPct);
        }
        break;
      }
      case 'capacityFull': {
        if (ctx.positions_stale) {
          evaluated = false;
        } else if (positive(ctx.max_open_trades)) {
          const open = ctx.positions.length;
          if (open >= ctx.max_open_trades) {
            push(cfg, t, null, 'info', open, ctx.max_open_trades);
          }
        }
        break;
      }
      case 'allFundsExposed': {
        if (ctx.positions_stale) {
          evaluated = false;
        } else if (positive(ctx.starting_capital)) {
          const cap = ctx.starting_capital;
          const stake = ctx.positions.reduce((acc, p) => acc + p.stake_amount, 0);
          if (ctx.positions.length > 0 && stake >= cap * FUNDS_EXPOSED_RATIO) {
            push(cfg, t, null, 'warning', (stake / cap) * 100, FUNDS_EXPOSED_RATIO * 100);
          }
        } else {
          evaluated = false;
        }
        break;
      }
    }
    if (evaluated) {
      evaluatedSet.add(t);
    }
  }

  return {
    conditions,
    evaluated: ALERT_TYPE_IDS.filter((t) => evaluatedSet.has(t)),
    disabled: ALERT_TYPE_IDS.filter((t) => disabledSet.has(t)),
  };
}
