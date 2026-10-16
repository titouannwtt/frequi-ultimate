/**
 * Pure helpers of the alert rules editor (Settings > Alerts): the rows by category, the effective
 * switch and threshold of a rule, the edited configuration. Nothing here talks to a source.
 */
import { ALERT_TYPE_IDS, RULE_CATALOG } from '@/datasource/calc/alerts/rules';
import type {
  AlertCategory,
  AlertRulesConfig,
  AlertTypeId,
  RuleConfig,
  Severity,
} from '@/gateway/types.gen';

export const CATEGORY_ORDER: readonly AlertCategory[] = ['position', 'log', 'activity', 'system'];

export interface RuleRow {
  id: AlertTypeId;
  category: AlertCategory;
  severity: Severity;
  enabled: boolean;
  /** The threshold in use, or null for a rule without one. */
  threshold: number | null;
  spec: { min: number; max: number; default: number; step: number; unit: string } | null;
  defaultEnabled: boolean;
  /** Differs from the catalog defaults. */
  changed: boolean;
}

/** Global rule configuration (what applies to every bot without an override of its own). */
export function globalRule(cfg: Partial<AlertRulesConfig>, id: AlertTypeId): RuleConfig {
  const meta = RULE_CATALOG[id];
  return (
    cfg.global?.[id] ?? {
      enabled: meta.default_enabled,
      threshold: meta.threshold?.default ?? null,
      forS: null,
    }
  );
}

export function ruleRows(cfg: Partial<AlertRulesConfig>): RuleRow[] {
  const rows = ALERT_TYPE_IDS.map((id): RuleRow => {
    const meta = RULE_CATALOG[id];
    const c = globalRule(cfg, id);
    const spec = meta.threshold;
    const threshold = spec ? (c.threshold ?? spec.default) : null;
    return {
      id,
      category: meta.category,
      severity: meta.severity,
      enabled: c.enabled,
      threshold,
      spec,
      defaultEnabled: meta.default_enabled,
      changed: c.enabled !== meta.default_enabled || (spec !== null && threshold !== spec.default),
    };
  });
  return rows.sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      ALERT_TYPE_IDS.indexOf(a.id) - ALERT_TYPE_IDS.indexOf(b.id),
  );
}

/** A threshold typed by the user, kept inside the range of the rule; null when it is not a number. */
export function clampThreshold(raw: string | number, id: AlertTypeId): number | null {
  const spec = RULE_CATALOG[id].threshold;
  if (!spec) return null;
  const n = typeof raw === 'number' ? raw : Number(raw.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(spec.max, Math.max(spec.min, n));
  // Snap to the step so 14.3 does not become a threshold nobody can reach with the arrows
  const snapped = Math.round(clamped / spec.step) * spec.step;
  return Number(snapped.toFixed(4));
}

/** The configuration with one rule edited; everything else is carried over untouched. */
export function withRule(
  cfg: AlertRulesConfig,
  id: AlertTypeId,
  patch: Partial<Pick<RuleConfig, 'enabled' | 'threshold'>>,
): AlertRulesConfig {
  const current = globalRule(cfg, id);
  return { ...cfg, global: { ...cfg.global, [id]: { ...current, ...patch } } };
}

/** The configuration with one bot muted or unmuted (`false` mutes; absent means enabled). */
export function withBotEnabled(
  cfg: AlertRulesConfig,
  botKey: string,
  enabled: boolean,
): AlertRulesConfig {
  const perBotEnabled = { ...cfg.perBotEnabled };
  if (enabled) delete perBotEnabled[botKey];
  else perBotEnabled[botKey] = false;
  return { ...cfg, perBotEnabled };
}

/** Rules of this category, for the section headings. */
export function byCategory(
  rows: readonly RuleRow[],
): Array<{ category: AlertCategory; rows: RuleRow[] }> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    rows: rows.filter((r) => r.category === category),
  })).filter((g) => g.rows.length > 0);
}
