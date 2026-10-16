/**
 * Wording and contextual actions of the alerts (02 sections 3.1 and 13.3). The rules themselves
 * (thresholds, severities, deduplication) live in `datasource/calc/alerts`; here only the way an
 * alert is told: a sentence with its figure and its threshold, and what can be done about it.
 */
import type { Alert, AlertTypeId, Severity } from '@/gateway/types.gen';

import { pairLabel } from './trades';

export type AlertActionId = 'pause' | 'open' | 'logs' | 'reconcile' | 'diagnostic' | 'reconnect';

/** Actions offered next to an alert, in order. The first is the most useful one. */
export const ALERT_ACTIONS: Readonly<Record<AlertTypeId, readonly AlertActionId[]>> = {
  positionLoss: ['pause', 'open'],
  positionStuck: ['open', 'pause'],
  nearLiquidation: ['pause', 'open'],
  logErrors: ['logs', 'open'],
  orderFailed: ['logs', 'open'],
  insufficientFunds: ['logs', 'open'],
  exchangeError: ['logs', 'diagnostic'],
  walletMismatch: ['reconcile', 'diagnostic'],
  noTradeActivity: ['open', 'logs'],
  botOffline: ['logs', 'open'],
  highDrawdown: ['pause', 'open'],
  capacityFull: ['open'],
  allFundsExposed: ['pause', 'open'],
  liquidationBeforeStoploss: ['open', 'pause'],
};

/** Types whose sentence quotes the measured value; without it the raw detail is shown. */
const NEEDS_VALUE: ReadonlySet<AlertTypeId> = new Set([
  'positionLoss',
  'positionStuck',
  'nearLiquidation',
  'noTradeActivity',
  'highDrawdown',
]);

export interface AlertWording {
  /** i18n key under `fq.alert.`. */
  messageKey: string;
  params: Record<string, string | number>;
}

/**
 * What an alert is about, in words: the pair of its position, else its subject. The subject of a
 * per-position alert is the trade id, which says nothing to the reader.
 */
export function alertTarget(a: Pick<Alert, 'subject'> & { pair?: string | null }): string {
  if (a.pair) return pairLabel(a.pair);
  return a.subject ?? '';
}

/** Short tag next to the title: `#310` for a trade id, the subject as it is otherwise. */
export function alertTag(a: Pick<Alert, 'subject'>): string | null {
  if (!a.subject) return null;
  return /^\d+$/.test(a.subject) ? `#${a.subject}` : a.subject;
}

/** Sentence of an alert with its figure and threshold, or the detail when the figure is missing. */
export function alertWording(
  a: Pick<Alert, 'type_id' | 'subject' | 'value' | 'threshold' | 'detail'> & {
    pair?: string | null;
  },
  num: (n: number) => string,
): AlertWording {
  const params: Record<string, string | number> = {
    subject: alertTarget(a),
    detail: a.detail ?? '',
  };
  if (a.value != null) params.value = num(a.value);
  if (a.threshold != null) params.threshold = num(a.threshold);
  if (NEEDS_VALUE.has(a.type_id) && (a.value == null || a.threshold == null)) {
    return { messageKey: 'msg.noValue', params };
  }
  return { messageKey: `msg.${a.type_id}`, params };
}

/** Whether the alert is about the wallet and not about one bot. */
export function isWalletAlert(a: Pick<Alert, 'bot_key'>): boolean {
  return a.bot_key === null;
}

export function severityTone(s: Severity): 'crit' | 'warn' | 'info' {
  return s === 'critical' ? 'crit' : s === 'warning' ? 'warn' : 'info';
}

export type RailLevel = 'calm' | 'watch' | 'critical';

export function railLevel(active: readonly Pick<Alert, 'severity'>[]): RailLevel {
  if (active.some((a) => a.severity === 'critical')) return 'critical';
  if (active.some((a) => a.severity === 'warning')) return 'watch';
  return 'calm';
}
