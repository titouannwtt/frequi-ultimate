/**
 * Rule of the browser notifications of the alerts (01 #120, Settings #55). Pure: which alerts of
 * the book deserve a system notification now. The browser API, the preference and the wording
 * live in `composables/useBrowserNotifications`.
 */
import { alertView } from '@/datasource/calc/alerts/book';
import { SEVERITY_RANK } from '@/datasource/calc/alerts/rules';
import type { Alert, AlertTypeId } from '@/gateway/types.gen';

/** The three switches of the old settings, which the migration keeps under `types`. */
export type NotifyCategory = 'positionLoss' | 'botOffline' | 'logErrors';

const CATEGORY: Partial<Record<AlertTypeId, NotifyCategory>> = {
  positionLoss: 'positionLoss',
  nearLiquidation: 'positionLoss',
  highDrawdown: 'positionLoss',
  botOffline: 'botOffline',
  logErrors: 'logErrors',
  orderFailed: 'logErrors',
  exchangeError: 'logErrors',
};

/** Identity of one occurrence of an alert: the same alert coming back later is a new one. */
export function notifyKey(a: Pick<Alert, 'id' | 'since_ms'>): string {
  return `${a.id}@${a.since_ms}`;
}

/**
 * The alerts to notify: firing, neither acknowledged nor silenced, warning or critical (the ones
 * of the bell), of a type the user did not switch off, and not notified yet.
 * A type with no entry in `types` is on; only an explicit `false` turns it off.
 */
export function alertsToNotify(
  alerts: readonly Alert[],
  nowMs: number,
  seen: ReadonlySet<string>,
  types: Readonly<Record<string, boolean>>,
): Alert[] {
  return alerts.filter((a) => {
    if (alertView(a, nowMs) !== 'active') return false;
    if (SEVERITY_RANK[a.severity] < SEVERITY_RANK.warning) return false;
    const cat = CATEGORY[a.type_id];
    if (cat && types[cat] === false) return false;
    return !seen.has(notifyKey(a));
  });
}

/** The keys to forget: occurrences no longer active, so a later return notifies again. */
export function staleKeys(
  seen: ReadonlySet<string>,
  alerts: readonly Alert[],
  nowMs: number,
): string[] {
  const live = new Set(alerts.filter((a) => alertView(a, nowMs) === 'active').map(notifyKey));
  return [...seen].filter((k) => !live.has(k));
}
