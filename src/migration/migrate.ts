/**
 * Migration of the `localStorage` of the old UI to the preferences of the redesigned one
 * (docs/redesign/03 section 9.2). Properties that the tests pin down:
 *
 * - Read only: the old keys are never written, rewritten or deleted (v1), so going back to the old
 *   UI on the same origin finds everything as it left it. `ftAuthLoginInfo` stays the source of the
 *   direct mode and is still refreshed by it in its own format.
 * - Idempotent: the result is a pure function of the old keys. Running it again with the same keys
 *   writes nothing. It runs again only if the hash of a source key changed (the tokens of
 *   `ftAuthLoginInfo` are left out of its hash: they change every 15 minutes).
 * - Respectful of the new UI: a replay never overwrites a section the user edited since
 *   (`settings.touched`).
 * - Per bot data moves from the per-device `ftbot.N` ids to the canonical `bot_key`.
 */
import { botKeyFromApiUrl } from '@/datasource/protocol/identity';
import { COLUMN_REGISTRY, LEGACY_FLEET_COLUMNS, LEGACY_TRADE_COLUMNS } from '@/datasource/columns';
import { isAlertTypeId } from '@/datasource/calc/alerts/rules';
import { isSupportedLocale } from '@/locales/localePolicy';
import type { AlertRulesConfig, BotKey, RuleConfig } from '@/gateway/types.gen';

import { hashString } from './hash';
import {
  defaultSettings,
  MIGRATION_VERSION,
  type BotGroupPrefs,
  type ColumnPrefs,
  type CustomTagPrefs,
  type FleetFilterPrefs,
  type FqSettings,
  type Locale,
  type MigrationRecord,
  type MigrationSummary,
  type SettingsSection,
} from './schema';
import {
  loadMigrationRecord,
  loadSettings,
  saveMigrationRecord,
  saveSettings,
  type KeyValueStorage,
} from './storage';

/** Old keys that are read. */
export const IMPORTED_KEYS = [
  'ftAuthLoginInfo',
  'ftSelectedBot',
  'ftBotNames',
  'ftBotComparison',
  'ftUISettings',
  'ftUIColorSettings',
  'ft_locale',
  'enhancedOpenTradeColumns',
  'enhancedClosedTradeColumns',
  'enhancedOpenTradeColumnOrder',
  'enhancedClosedTradeColumnOrder',
  'ftPlotConfig',
] as const;

/** Old keys that the layout refondu does not import (left intact). */
export const SKIPPED_KEYS = [
  'ftLayoutSettings',
  'ftUIChartSettings',
  'ftPairlistConfig',
  'ftBotListGrouped',
  'ftBotComparisonRecentIcons',
  'ft_benchmarks_enabled',
  'ft_benchmark_show_latent',
  'ft_benchmark_show_realized',
  'ft_benchmark_show_dd',
  'ft_market_overview_settings',
  'ft_profit_goal',
  'ft_dismissed_correlations',
  'ftForkUpdateCheck',
] as const;

export interface MigrationEnv {
  storage: KeyValueStorage;
  now?: () => number;
  /** Host names that mean "this machine" for the bots (the host serving the UI). */
  localHosts?: readonly string[];
  /** Origin of the UI, for the bots whose `apiUrl` is empty (same origin). */
  selfOrigin?: string;
  /** `navigator.languages`, to pick the language when none was stored. */
  browserLanguages?: readonly string[];
}

export interface MigrationOutcome {
  /** `fresh`: nothing to import; `unchanged`: already up to date; `migrated`: written. */
  status: 'fresh' | 'unchanged' | 'migrated';
  settings: FqSettings;
  record: MigrationRecord;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

function readRaw(storage: KeyValueStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * What identifies the bots in `ftAuthLoginInfo`, without the tokens (they change every 15
 * minutes and would make the migration replay all the time).
 */
function authIdentityProjection(raw: string): string {
  const parsed = parseJson(raw);
  if (!isObject(parsed)) return raw;
  const rows = Object.keys(parsed)
    .sort()
    .map((id) => {
      const e = parsed[id];
      return isObject(e)
        ? [id, e.apiUrl ?? null, e.botName ?? null, e.botIcon ?? null, e.sortId ?? null]
        : [id];
    });
  return JSON.stringify(rows);
}

function sourceHashes(storage: KeyValueStorage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of IMPORTED_KEYS) {
    const raw = readRaw(storage, key);
    if (raw !== null) {
      out[key] = hashString(key === 'ftAuthLoginInfo' ? authIdentityProjection(raw) : raw);
    }
  }
  return out;
}

function sameHashes(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/** Old column ids to new ones; unknown or dropped ids are reported, never kept. */
function mapColumns(
  ids: unknown,
  table: Readonly<Record<string, string | null>>,
  dropped: Set<string>,
): string[] | null {
  if (!isStringArray(ids)) return null;
  const out: string[] = [];
  for (const id of ids) {
    const mapped = table[id];
    if (mapped) {
      out.push(mapped);
    } else {
      dropped.add(id);
    }
  }
  return uniq(out);
}

function columnPrefs(
  visible: string[] | null,
  order: string[] | null,
  preset: 'open' | 'bot' | 'closed' | 'journal' | 'fleet',
): ColumnPrefs | null {
  if (!visible && !order) return null;
  const known = new Set(COLUMN_REGISTRY.filter((c) => c.presets.includes(preset)).map((c) => c.id));
  const keep = (xs: string[] | null) => (xs ?? []).filter((id) => known.has(id));
  const v = keep(visible);
  const o = keep(order);
  if (v.length === 0 && o.length === 0) return null;
  return { visible: v, order: o };
}

interface Imported {
  sections: Partial<Record<SettingsSection, unknown>>;
  summary: MigrationSummary;
}

export function importLegacy(env: MigrationEnv): Imported {
  const { storage } = env;
  const summary: MigrationSummary = {
    imported: [],
    skipped: SKIPPED_KEYS.filter((k) => readRaw(storage, k) !== null),
    unmappedBots: [],
    droppedColumns: [],
    forcedConfirmation: false,
    localeFallback: false,
  };
  const sections: Imported['sections'] = {};
  const dropped = new Set<string>();
  const localHosts = [...(env.localHosts ?? [])];

  // ---- ftAuthLoginInfo: the alias map ftbot.N -> bot_key ----
  const aliasToKey = new Map<string, BotKey>();
  const auth = parseJson(readRaw(storage, 'ftAuthLoginInfo'));
  if (isObject(auth)) {
    summary.imported.push('ftAuthLoginInfo');
    for (const [uiId, entry] of Object.entries(auth)) {
      const apiUrl = isObject(entry) && typeof entry.apiUrl === 'string' ? entry.apiUrl : '';
      const url = apiUrl || env.selfOrigin || '';
      const key = url ? botKeyFromApiUrl(url, localHosts) : null;
      if (key) {
        aliasToKey.set(uiId, key);
      } else {
        summary.unmappedBots.push(uiId);
      }
    }
  }
  const keyOf = (uiId: string): BotKey | null => {
    const k = aliasToKey.get(uiId);
    if (!k && !summary.unmappedBots.includes(uiId)) summary.unmappedBots.push(uiId);
    return k ?? null;
  };
  const mapKeyedRecord = <T>(rec: unknown): Record<BotKey, T> => {
    const out: Record<BotKey, T> = {};
    if (isObject(rec)) {
      for (const [uiId, v] of Object.entries(rec)) {
        const k = keyOf(uiId);
        if (k) out[k] = v as T;
      }
    }
    return out;
  };

  // ---- ftSelectedBot (a plain string, not JSON) and ftBotNames ----
  const selected = readRaw(storage, 'ftSelectedBot');
  if (selected !== null) {
    summary.imported.push('ftSelectedBot');
    const k = aliasToKey.get(selected);
    if (k) sections.selectedBot = k;
  }
  const names = parseJson(readRaw(storage, 'ftBotNames'));
  if (isObject(names)) {
    summary.imported.push('ftBotNames');
    const out: Record<BotKey, string> = {};
    for (const [uiId, name] of Object.entries(names)) {
      const k = aliasToKey.get(uiId);
      if (k && typeof name === 'string') out[k] = name;
    }
    sections.botNames = out;
  }

  // ---- ftBotComparison: groups, tags, order, columns, filters, alerts, notifications ----
  const cmp = parseJson(readRaw(storage, 'ftBotComparison'));
  if (isObject(cmp)) {
    summary.imported.push('ftBotComparison');
    const base = defaultSettings();
    const fleet = { ...base.fleet };
    if (Array.isArray(cmp.botOrder)) {
      fleet.botOrder = uniq(
        cmp.botOrder
          .filter((x): x is string => typeof x === 'string')
          .map(keyOf)
          .filter((k): k is BotKey => !!k),
      );
    }
    if (Array.isArray(cmp.botGroups)) {
      fleet.groups = cmp.botGroups.filter(isObject).map(
        (g): BotGroupPrefs => ({
          id: String(g.id ?? ''),
          name: String(g.name ?? ''),
          icon: String(g.icon ?? ''),
          collapsed: g.collapsed === true,
          botKeys: uniq(
            (Array.isArray(g.botIds) ? g.botIds : [])
              .filter((x): x is string => typeof x === 'string')
              .map(keyOf)
              .filter((k): k is BotKey => !!k),
          ),
        }),
      );
    }
    if (Array.isArray(cmp.customTags)) {
      fleet.customTags = cmp.customTags.filter(isObject).map(
        (t): CustomTagPrefs => ({
          id: String(t.id ?? ''),
          name: String(t.name ?? ''),
          color: String(t.color ?? ''),
        }),
      );
    }
    if (isObject(cmp.botCustomTags)) {
      fleet.botCustomTags = mapKeyedRecord<string[]>(cmp.botCustomTags);
    }
    if (isStringArray(cmp.tagOrder)) fleet.tagOrder = cmp.tagOrder;
    if (isObject(cmp.botTagVisibility)) {
      fleet.tagVisibility = Object.fromEntries(
        Object.entries(cmp.botTagVisibility).filter(([, v]) => typeof v === 'boolean'),
      ) as Record<string, boolean>;
    }
    if (isObject(cmp.botFilters)) {
      fleet.filters = cmp.botFilters as unknown as FleetFilterPrefs;
    }
    if (typeof cmp.summaryCurrency === 'string') fleet.summaryCurrency = cmp.summaryCurrency;
    sections.fleet = fleet;

    // Fleet table columns share the `columns` section with the trade tables.
    const fleetCols = columnPrefs(
      mapColumns(cmp.visibleColumnIds, LEGACY_FLEET_COLUMNS, dropped),
      mapColumns(cmp.columnOrder, LEGACY_FLEET_COLUMNS, dropped),
      'fleet',
    );
    if (fleetCols) {
      sections.columns = { ...(sections.columns as Json | undefined), fleet: fleetCols };
    }

    // Alert thresholds, switches and per-bot mutes.
    const rules: AlertRulesConfig = { global: {}, perBotEnabled: {}, perBot: {} };
    const ac = isObject(cmp.alertConfig) ? cmp.alertConfig : null;
    if (ac && isObject(ac.global)) {
      for (const [typeId, cfg] of Object.entries(ac.global)) {
        if (!isAlertTypeId(typeId) || !isObject(cfg)) continue;
        const rc: RuleConfig = {
          enabled: cfg.enabled !== false,
          threshold: typeof cfg.threshold === 'number' ? cfg.threshold : null,
          forS: null,
        };
        rules.global[typeId] = rc;
      }
    }
    if (ac && isObject(ac.perBotEnabled)) {
      rules.perBotEnabled = mapKeyedRecord<boolean>(ac.perBotEnabled);
    }
    const notifTypes = isObject(cmp.notificationTypes)
      ? (Object.fromEntries(
          Object.entries(cmp.notificationTypes).filter(([, v]) => typeof v === 'boolean'),
        ) as Record<string, boolean>)
      : {};
    sections.alerts = {
      rules,
      notifications: { browser: cmp.browserNotificationsEnabled === true, types: notifTypes },
    };
  }

  // ---- ftUISettings, ftUIColorSettings ----
  const ui = parseJson(readRaw(storage, 'ftUISettings'));
  if (isObject(ui)) {
    summary.imported.push('ftUISettings');
    const base = defaultSettings().ui;
    const out = { ...base };
    if (typeof ui.openTradesInTitle === 'string') out.openTradesInTitle = ui.openTradesInTitle;
    if (typeof ui.backgroundSync === 'boolean') out.backgroundSync = ui.backgroundSync;
    if (typeof ui.useHeikinAshiCandles === 'boolean')
      out.useHeikinAshiCandles = ui.useHeikinAshiCandles;
    if (typeof ui.showMarkArea === 'boolean') out.showMarkArea = ui.showMarkArea;
    if (ui.chartLabelSide === 'left' || ui.chartLabelSide === 'right')
      out.chartLabelSide = ui.chartLabelSide;
    if (typeof ui.chartDefaultCandleCount === 'number')
      out.chartDefaultCandleCount = ui.chartDefaultCandleCount;
    sections.ui = out;
    // The confirmation of a live exit can no longer be switched off: say so.
    summary.forcedConfirmation = ui.confirmDialog === false;
  }
  const colors = parseJson(readRaw(storage, 'ftUIColorSettings'));
  if (isObject(colors)) {
    summary.imported.push('ftUIColorSettings');
    if (colors.colorPreference === 'greenUp' || colors.colorPreference === 'redUp') {
      sections.colorPreference = colors.colorPreference;
    }
  }

  // ---- ft_locale ----
  const locale = readRaw(storage, 'ft_locale');
  if (locale !== null) {
    summary.imported.push('ft_locale');
    if (isSupportedLocale(locale)) {
      sections.locale = locale as Locale;
    } else {
      sections.locale = 'en';
      summary.localeFallback = true;
    }
  }

  // ---- trade table columns ----
  const tradeCols: Partial<Record<'open' | 'closed', ColumnPrefs>> = {};
  for (const mode of ['open', 'closed'] as const) {
    const visKey = mode === 'open' ? 'enhancedOpenTradeColumns' : 'enhancedClosedTradeColumns';
    const ordKey =
      mode === 'open' ? 'enhancedOpenTradeColumnOrder' : 'enhancedClosedTradeColumnOrder';
    const visRaw = parseJson(readRaw(storage, visKey));
    const ordRaw = parseJson(readRaw(storage, ordKey));
    if (visRaw !== undefined) summary.imported.push(visKey);
    if (ordRaw !== undefined) summary.imported.push(ordKey);
    const cp = columnPrefs(
      mapColumns(visRaw, LEGACY_TRADE_COLUMNS, dropped),
      mapColumns(ordRaw, LEGACY_TRADE_COLUMNS, dropped),
      mode,
    );
    if (cp) tradeCols[mode] = cp;
  }
  if (tradeCols.open || tradeCols.closed) {
    const prev = (sections.columns as Json | undefined) ?? {};
    sections.columns = {
      ...prev,
      ...(tradeCols.open ? { open: tradeCols.open, bot: tradeCols.open } : {}),
      ...(tradeCols.closed ? { closed: tradeCols.closed, journal: tradeCols.closed } : {}),
    };
  }

  // ---- ftPlotConfig: indicator presets are the user's work, imported as is ----
  const plot = parseJson(readRaw(storage, 'ftPlotConfig'));
  if (isObject(plot)) {
    summary.imported.push('ftPlotConfig');
    sections.plot = {
      customPlotConfigs: isObject(plot.customPlotConfigs) ? plot.customPlotConfigs : {},
      plotConfigName: typeof plot.plotConfigName === 'string' ? plot.plotConfigName : 'default',
    };
  }

  summary.droppedColumns = [...dropped].sort();
  return { sections, summary };
}

/** A new document built from the defaults and the imported sections not edited in the new UI. */
function applySections(base: FqSettings, sections: Imported['sections']): FqSettings {
  const out: FqSettings = structuredClone(base);
  const target = out as unknown as Record<string, unknown>;
  for (const [section, value] of Object.entries(sections)) {
    if (!out.touched.includes(section)) {
      target[section] = structuredClone(value);
    }
  }
  return out;
}

/**
 * Bring `fqu2.settings` up to date with the old keys. Safe to call on every start.
 */
export function runMigration(env: MigrationEnv): MigrationOutcome {
  const { storage } = env;
  const now = env.now ?? Date.now;
  const hashes = sourceHashes(storage);
  const existing = loadSettings(storage);
  const record = loadMigrationRecord(storage);

  if (
    existing &&
    record &&
    record.v === MIGRATION_VERSION &&
    sameHashes(record.sourceHashes, hashes)
  ) {
    return { status: 'unchanged', settings: existing, record };
  }

  const imported = importLegacy(env);
  const base = existing ?? defaultSettings();
  if (!existing && !imported.sections.locale) {
    for (const lang of env.browserLanguages ?? []) {
      const primary = lang.toLowerCase().split('-')[0];
      if (isSupportedLocale(primary)) {
        base.locale = primary as Locale;
        break;
      }
    }
  }
  const settings = applySections(base, imported.sections);
  const next: MigrationRecord = {
    v: MIGRATION_VERSION,
    at: now(),
    sourceHashes: hashes,
    report: imported.summary,
  };
  saveSettings(storage, settings);
  saveMigrationRecord(storage, next);
  return {
    status: Object.keys(hashes).length === 0 ? 'fresh' : 'migrated',
    settings,
    record: next,
  };
}
