// ── Bot config editor types ──
// Backed by the fork's /stratdev/editor/bot-config and /stratdev/editor/config-fields
// endpoints. The config editor reads the running bot's effective (merged) config and
// writes overrides back to the bot's own entry file.

export interface BotConfigResponse {
  /** Path (relative to project root) of the bot's launch config file — the write target. */
  entry_file: string;
  /** Whether the entry file lives in a writable directory (live_configs/ etc.). */
  entry_editable: boolean;
  /** All config files merged at runtime (entry file first, then add_config_files). */
  config_files: string[];
  strategy: string | null;
  bot_name: string | null;
  /** Full effective merged config, secrets redacted. */
  merged: Record<string, unknown>;
  /** Raw text of the entry file. */
  entry_content: string;
  /** Parsed entry file — the keys explicitly set for this bot (the write target). */
  own: Record<string, unknown>;
}

/** A flattened schema field, used by the "add a parameter" discovery picker. */
export interface ConfigSchemaField {
  path: string;
  type?: string | null;
  description?: string;
  enum?: (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
}

export type ConfigFieldWidget =
  | 'integer'
  | 'number'
  | 'text'
  | 'toggle'
  | 'select'
  | 'taglist'
  | 'roi'
  | 'pairlist';

export interface ConfigFieldOption {
  value: string | number;
  /** i18n key for the option label; falls back to the raw value if absent. */
  labelKey?: string;
}

/** A curated, presentation-level descriptor for one editable config field. */
export interface CatalogField {
  /** Dotted path in the config object, e.g. "entry_pricing.price_side". */
  path: string;
  /** i18n key under configEditor.fields.* for the human label. */
  labelKey: string;
  widget: ConfigFieldWidget;
  /** Required to start the bot — renders a "*" marker. */
  required?: boolean;
  /** Read-only: shown for context but edited manually in the file (db_url, dry_run…). */
  locked?: boolean;
  /** Normally provided by the strategy file — read-only unless the user opts in to override. */
  strategySourced?: boolean;
  /** Changing this needs a full bot restart (reload_config is not enough). */
  restartRequired?: boolean;
  options?: ConfigFieldOption[];
  min?: number;
  max?: number;
  step?: number;
  fractionDigits?: number;
  /** Offers an "unlimited" switch mapping to unlimitedValue (max_open_trades=-1, stake="unlimited"). */
  unlimitedValue?: number | string;
  /** Client-side validation pattern for text fields. */
  pattern?: string;
  /** Max string length for text fields. */
  maxLength?: number;
  placeholder?: string;
}

export interface CatalogSection {
  id: string;
  labelKey: string;
  /** mdi icon component name, e.g. "i-mdi-cash". */
  icon: string;
  fields: CatalogField[];
}

/** A single pending change, surfaced in the diff bar before saving. */
export interface ConfigChange {
  path: string;
  labelKey: string;
  before: unknown;
  after: unknown;
  restartRequired: boolean;
}
