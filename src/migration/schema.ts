/**
 * Shape of the preferences of the redesigned UI (`fqu2.settings`, docs/redesign/03 section 9.2 and
 * 02 section 15).
 *
 * Everything that belongs to a bot is indexed by its `bot_key` (`local:9056`), never by the
 * per-device `ftbot.N` alias, so the same preferences read the same on the phone and on the
 * computer once they are synchronised through the gateway. The old keys are only ever read.
 */
import type { AlertRulesConfig, BotKey, Tz } from '@/gateway/types.gen';

export const SETTINGS_KEY = 'fqu2.settings';
export const GATEWAY_KEY = 'fqu2.gateway';
export const MIGRATION_KEY = 'fqu2.migration';
export const SETTINGS_VERSION = 1;
/** Revision of the default columns of the tables (see `FqSettings.columnDefaultsRev`). */
export const COLUMN_DEFAULTS_REV = 1;
export const MIGRATION_VERSION = 1;

export type Locale = 'fr' | 'en';

export type ColumnPreset = 'fleet' | 'open' | 'bot' | 'closed' | 'journal';

export interface ColumnPrefs {
  /** Ids shown, in no particular order (the order list decides). */
  visible: string[];
  /** Display order of the known ids; ids missing here come after, in registry order. */
  order: string[];
}

export interface BotGroupPrefs {
  id: string;
  name: string;
  icon: string;
  collapsed: boolean;
  botKeys: BotKey[];
}

export interface CustomTagPrefs {
  id: string;
  name: string;
  color: string;
}

export interface FleetFilterPrefs {
  status: { live: boolean; dry: boolean; offline: boolean };
  exchanges: Record<string, boolean>;
  currencies: Record<string, boolean>;
  tradingMode: Record<string, boolean>;
  customTags: Record<string, boolean>;
}

export interface NotificationPrefs {
  browser: boolean;
  types: Record<string, boolean>;
}

export type ScopeMode = 'live' | 'dry' | 'all';
export type Workspace = 'surveillance' | 'incident' | 'analysis';

export interface FqSettings {
  v: typeof SETTINGS_VERSION;
  locale: Locale;
  /** Time zone that cuts days, weeks and months of the P&L. */
  tz: Tz;
  /** `bot_key` last selected on the page of a bot. */
  selectedBot: BotKey | null;
  /** `bot_name` each bot reported, by `bot_key` (the join key of the fleet digest). */
  botNames: Record<BotKey, string>;
  /** Browser-only display options imported from `ftUISettings`. */
  ui: {
    openTradesInTitle: string;
    backgroundSync: boolean;
    useHeikinAshiCandles: boolean;
    showMarkArea: boolean;
    chartLabelSide: 'left' | 'right';
    chartDefaultCandleCount: number;
  };
  /** Candle colour preference of the old UI (long/short colours are fixed by the design). */
  colorPreference: 'greenUp' | 'redUp';
  columns: Partial<Record<ColumnPreset, ColumnPrefs>>;
  fleet: {
    botOrder: BotKey[];
    groups: BotGroupPrefs[];
    customTags: CustomTagPrefs[];
    botCustomTags: Record<BotKey, string[]>;
    tagOrder: string[];
    tagVisibility: Record<string, boolean>;
    filters: FleetFilterPrefs | null;
    summaryCurrency: string;
  };
  alerts: {
    rules: AlertRulesConfig;
    notifications: NotificationPrefs;
  };
  /** Indicator presets, imported as is. */
  plot: { customPlotConfigs: Record<string, unknown>; plotConfigName: string } | null;
  scope: {
    mode: ScopeMode;
    workspace: Workspace;
    /**
     * Bots unticked in the "Bots N/M" list of the Fleet. Kept as the exceptions, not as the ticked
     * ones, so that a bot that appears later is ticked.
     */
    excluded: BotKey[];
  };
  /**
   * Revision of the default columns the stored column choices were last compared with: a choice
   * equal to an older default follows the new one (`upgradeSettings`), a different one is kept.
   */
  columnDefaultsRev: number;
  /**
   * Sections the user edited in the new UI. A later migration replay (because an old key changed)
   * never overwrites them.
   */
  touched: string[];
}

/** Top-level sections of the settings that `touched` can name. */
export const SETTINGS_SECTIONS = [
  'locale',
  'tz',
  'selectedBot',
  'botNames',
  'ui',
  'colorPreference',
  'columns',
  'fleet',
  'alerts',
  'plot',
  'scope',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Sections shared between devices through the gateway (the rest is per device). */
export const SYNCED_SECTIONS: readonly SettingsSection[] = [
  'tz',
  'columns',
  'fleet',
  'alerts',
  'plot',
];

/** What the migration recorded: enough to know whether an old key changed since. */
export interface MigrationRecord {
  v: typeof MIGRATION_VERSION;
  at: number;
  sourceHashes: Record<string, string>;
  report: MigrationSummary;
}

export interface MigrationSummary {
  /** Old keys read. */
  imported: string[];
  /** Old keys deliberately not imported (layout refondu). */
  skipped: string[];
  /** Per-bot entries that could not be mapped to a `bot_key`. */
  unmappedBots: string[];
  /** Column ids of the old tables that have no counterpart. */
  droppedColumns: string[];
  /** The old forceexit confirmation was off: the new UI forces it on for live bots. */
  forcedConfirmation: boolean;
  /** The old locale was a removed language and became English. */
  localeFallback: boolean;
}

export function defaultAlertRules(): AlertRulesConfig {
  // Same defaults as `defaultAlertRulesConfig()`; kept literal here so that this module has no
  // dependency on the calculation code.
  return { global: {}, perBotEnabled: {}, perBot: {} };
}

export function defaultSettings(): FqSettings {
  return {
    v: SETTINGS_VERSION,
    locale: 'en',
    tz: 'Europe/Paris',
    selectedBot: null,
    botNames: {},
    ui: {
      openTradesInTitle: 'showPill',
      backgroundSync: true,
      useHeikinAshiCandles: false,
      showMarkArea: true,
      chartLabelSide: 'right',
      chartDefaultCandleCount: 250,
    },
    colorPreference: 'greenUp',
    columns: {},
    fleet: {
      botOrder: [],
      groups: [],
      customTags: [],
      botCustomTags: {},
      tagOrder: ['status', 'tradingMode', 'market', 'exchange', 'stakeCurrency', 'port'],
      tagVisibility: {},
      filters: null,
      summaryCurrency: 'auto',
    },
    alerts: {
      rules: defaultAlertRules(),
      notifications: { browser: false, types: {} },
    },
    plot: null,
    scope: { mode: 'live', workspace: 'surveillance', excluded: [] },
    columnDefaultsRev: COLUMN_DEFAULTS_REV,
    touched: [],
  };
}

/** Connection settings of the gateway (`fqu2.gateway`). */
export interface GatewayPrefs {
  /** Base URL of the gateway; empty means "same host, port 9399". */
  url: string;
  /** Opaque session token. Never logged. */
  session: string | null;
  expiresAt: number | null;
  /** Stable random id of this browser, `d-xxxxxxxx`. */
  deviceId: string;
  mode: 'auto' | 'gateway' | 'direct';
  /** `ftbot.N` of this device to `bot_key`, as answered by the bootstrap. */
  aliases: Record<string, BotKey>;
}

export function defaultGatewayPrefs(): GatewayPrefs {
  return { url: '', session: null, expiresAt: null, deviceId: '', mode: 'auto', aliases: {} };
}
