import type { CatalogField, CatalogSection } from '@/types';

// Curated, presentation-level catalog of editable freqtrade config fields.
// Constraints (enums / bounds) mirror freqtrade's CONF_SCHEMA; the source of truth for
// discovery of *additional* fields is the backend /stratdev/editor/config-fields endpoint.
//
// Status flags drive the UI:
//   required        → renders a "*" marker
//   locked          → read-only (lock icon); edit manually in the file
//   strategySourced → read-only unless the user opts in to override from config
//   restartRequired → reload_config is not enough; the bot must be restarted

const orderTypeOptions = [{ value: 'limit' }, { value: 'market' }];
const priceSideOptions = [
  { value: 'ask' },
  { value: 'bid' },
  { value: 'same' },
  { value: 'other' },
];
const tifOptions = [{ value: 'GTC' }, { value: 'FOK' }, { value: 'IOC' }, { value: 'PO' }];
const notifyOptions = [{ value: 'on' }, { value: 'off' }, { value: 'silent' }];
const fiatOptions = [
  '',
  'USD',
  'EUR',
  'GBP',
  'CHF',
  'JPY',
  'CNY',
  'AUD',
  'CAD',
  'BTC',
  'ETH',
  'BNB',
  'XRP',
  'LTC',
  'BCH',
  'BRL',
  'KRW',
  'INR',
  'RUB',
  'TRY',
  'ZAR',
  'SGD',
  'HKD',
].map((v) => ({ value: v }));

export const CONFIG_CATALOG: CatalogSection[] = [
  {
    id: 'capital',
    labelKey: 'configEditor.sections.capital',
    icon: 'i-mdi-cash-multiple',
    fields: [
      {
        path: 'max_open_trades',
        labelKey: 'configEditor.fields.max_open_trades',
        widget: 'integer',
        required: true,
        min: 1,
        unlimitedValue: -1,
      },
      {
        path: 'stake_amount',
        labelKey: 'configEditor.fields.stake_amount',
        widget: 'number',
        required: true,
        min: 0.0001,
        fractionDigits: 6,
        unlimitedValue: 'unlimited',
      },
      {
        path: 'tradable_balance_ratio',
        labelKey: 'configEditor.fields.tradable_balance_ratio',
        widget: 'number',
        required: true,
        min: 0,
        max: 1,
        step: 0.01,
        fractionDigits: 4,
      },
      {
        path: 'capital_withdrawal',
        labelKey: 'configEditor.fields.capital_withdrawal',
        widget: 'number',
        min: 0,
        fractionDigits: 4,
        restartRequired: true,
      },
      {
        path: 'available_capital',
        labelKey: 'configEditor.fields.available_capital',
        widget: 'number',
        min: 0,
        fractionDigits: 4,
        restartRequired: true,
      },
      {
        path: 'last_stake_amount_min_ratio',
        labelKey: 'configEditor.fields.last_stake_amount_min_ratio',
        widget: 'number',
        required: true,
        min: 0,
        max: 1,
        step: 0.01,
        fractionDigits: 4,
      },
      {
        path: 'amount_reserve_percent',
        labelKey: 'configEditor.fields.amount_reserve_percent',
        widget: 'number',
        min: 0,
        max: 0.5,
        step: 0.01,
        fractionDigits: 4,
      },
      {
        path: 'amend_last_stake_amount',
        labelKey: 'configEditor.fields.amend_last_stake_amount',
        widget: 'toggle',
      },
      {
        path: 'position_adjustment_enable',
        labelKey: 'configEditor.fields.position_adjustment_enable',
        widget: 'toggle',
      },
      {
        path: 'max_entry_position_adjustment',
        labelKey: 'configEditor.fields.max_entry_position_adjustment',
        widget: 'integer',
        min: -1,
      },
    ],
  },
  {
    id: 'trading',
    labelKey: 'configEditor.sections.trading',
    icon: 'i-mdi-cog',
    fields: [
      {
        path: 'bot_name',
        labelKey: 'configEditor.fields.bot_name',
        widget: 'text',
        maxLength: 50,
      },
      {
        path: 'strategy',
        labelKey: 'configEditor.fields.strategy',
        widget: 'select',
        required: true,
        restartRequired: true,
      },
      {
        path: 'internals.process_throttle_secs',
        labelKey: 'configEditor.fields.process_throttle_secs',
        widget: 'integer',
        min: 1,
        restartRequired: true,
      },
      {
        path: 'process_only_new_candles',
        labelKey: 'configEditor.fields.process_only_new_candles',
        widget: 'toggle',
      },
      {
        path: 'force_entry_enable',
        labelKey: 'configEditor.fields.force_entry_enable',
        widget: 'toggle',
      },
      {
        path: 'cancel_open_orders_on_exit',
        labelKey: 'configEditor.fields.cancel_open_orders_on_exit',
        widget: 'toggle',
      },
      {
        path: 'initial_state',
        labelKey: 'configEditor.fields.initial_state',
        widget: 'select',
        options: [{ value: 'running' }, { value: 'paused' }, { value: 'stopped' }],
        restartRequired: true,
      },
      {
        path: 'fiat_display_currency',
        labelKey: 'configEditor.fields.fiat_display_currency',
        widget: 'select',
        options: fiatOptions,
      },
    ],
  },
  {
    id: 'risk',
    labelKey: 'configEditor.sections.risk',
    icon: 'i-mdi-shield-alert',
    fields: [
      {
        path: 'stoploss',
        labelKey: 'configEditor.fields.stoploss',
        widget: 'number',
        required: true,
        max: 0,
        step: 0.01,
        fractionDigits: 4,
        strategySourced: true,
      },
      {
        path: 'minimal_roi',
        labelKey: 'configEditor.fields.minimal_roi',
        widget: 'roi',
        required: true,
        strategySourced: true,
      },
      {
        path: 'trailing_stop',
        labelKey: 'configEditor.fields.trailing_stop',
        widget: 'toggle',
        strategySourced: true,
      },
      {
        path: 'trailing_stop_positive',
        labelKey: 'configEditor.fields.trailing_stop_positive',
        widget: 'number',
        min: 0,
        max: 1,
        step: 0.01,
        fractionDigits: 4,
        strategySourced: true,
      },
      {
        path: 'trailing_stop_positive_offset',
        labelKey: 'configEditor.fields.trailing_stop_positive_offset',
        widget: 'number',
        min: 0,
        max: 1,
        step: 0.01,
        fractionDigits: 4,
        strategySourced: true,
      },
      {
        path: 'trailing_only_offset_is_reached',
        labelKey: 'configEditor.fields.trailing_only_offset_is_reached',
        widget: 'toggle',
        strategySourced: true,
      },
      {
        path: 'use_exit_signal',
        labelKey: 'configEditor.fields.use_exit_signal',
        widget: 'toggle',
        strategySourced: true,
      },
      {
        path: 'exit_profit_only',
        labelKey: 'configEditor.fields.exit_profit_only',
        widget: 'toggle',
        strategySourced: true,
      },
      {
        path: 'ignore_roi_if_entry_signal',
        labelKey: 'configEditor.fields.ignore_roi_if_entry_signal',
        widget: 'toggle',
        strategySourced: true,
      },
    ],
  },
  {
    id: 'orders',
    labelKey: 'configEditor.sections.orders',
    icon: 'i-mdi-format-list-checks',
    fields: [
      {
        path: 'order_types.entry',
        labelKey: 'configEditor.fields.order_types_entry',
        widget: 'select',
        options: orderTypeOptions,
        strategySourced: true,
      },
      {
        path: 'order_types.exit',
        labelKey: 'configEditor.fields.order_types_exit',
        widget: 'select',
        options: orderTypeOptions,
        strategySourced: true,
      },
      {
        path: 'order_types.stoploss',
        labelKey: 'configEditor.fields.order_types_stoploss',
        widget: 'select',
        options: orderTypeOptions,
        strategySourced: true,
      },
      {
        path: 'order_types.stoploss_on_exchange',
        labelKey: 'configEditor.fields.stoploss_on_exchange',
        widget: 'toggle',
        strategySourced: true,
      },
      {
        path: 'order_types.stoploss_price_type',
        labelKey: 'configEditor.fields.stoploss_price_type',
        widget: 'select',
        options: [{ value: 'last' }, { value: 'mark' }, { value: 'index' }],
        strategySourced: true,
      },
      {
        path: 'order_time_in_force.entry',
        labelKey: 'configEditor.fields.tif_entry',
        widget: 'select',
        options: tifOptions,
        strategySourced: true,
      },
      {
        path: 'order_time_in_force.exit',
        labelKey: 'configEditor.fields.tif_exit',
        widget: 'select',
        options: tifOptions,
        strategySourced: true,
      },
      {
        path: 'unfilledtimeout.entry',
        labelKey: 'configEditor.fields.unfilledtimeout_entry',
        widget: 'integer',
        min: 1,
      },
      {
        path: 'unfilledtimeout.exit',
        labelKey: 'configEditor.fields.unfilledtimeout_exit',
        widget: 'integer',
        min: 1,
      },
      {
        path: 'unfilledtimeout.unit',
        labelKey: 'configEditor.fields.unfilledtimeout_unit',
        widget: 'select',
        options: [{ value: 'minutes' }, { value: 'seconds' }],
      },
    ],
  },
  {
    id: 'pricing',
    labelKey: 'configEditor.sections.pricing',
    icon: 'i-mdi-tag',
    fields: [
      {
        path: 'entry_pricing.price_side',
        labelKey: 'configEditor.fields.entry_price_side',
        widget: 'select',
        options: priceSideOptions,
      },
      {
        path: 'entry_pricing.price_last_balance',
        labelKey: 'configEditor.fields.entry_price_last_balance',
        widget: 'number',
        min: 0,
        max: 1,
        step: 0.1,
        fractionDigits: 4,
      },
      {
        path: 'entry_pricing.use_order_book',
        labelKey: 'configEditor.fields.entry_use_order_book',
        widget: 'toggle',
      },
      {
        path: 'entry_pricing.order_book_top',
        labelKey: 'configEditor.fields.entry_order_book_top',
        widget: 'integer',
        min: 1,
        max: 50,
      },
      {
        path: 'exit_pricing.price_side',
        labelKey: 'configEditor.fields.exit_price_side',
        widget: 'select',
        options: priceSideOptions,
      },
      {
        path: 'exit_pricing.price_last_balance',
        labelKey: 'configEditor.fields.exit_price_last_balance',
        widget: 'number',
        min: 0,
        max: 1,
        step: 0.1,
        fractionDigits: 4,
      },
      {
        path: 'exit_pricing.use_order_book',
        labelKey: 'configEditor.fields.exit_use_order_book',
        widget: 'toggle',
      },
      {
        path: 'exit_pricing.order_book_top',
        labelKey: 'configEditor.fields.exit_order_book_top',
        widget: 'integer',
        min: 1,
        max: 50,
      },
    ],
  },
  {
    id: 'pairlists',
    labelKey: 'configEditor.sections.pairlists',
    icon: 'i-mdi-format-list-bulleted',
    fields: [
      {
        path: 'pairlists',
        labelKey: 'configEditor.fields.pairlists',
        widget: 'pairlist',
        required: true,
      },
      {
        path: 'exchange.pair_blacklist',
        labelKey: 'configEditor.fields.pair_blacklist',
        widget: 'taglist',
      },
      {
        path: 'exchange.pair_whitelist',
        labelKey: 'configEditor.fields.pair_whitelist',
        widget: 'taglist',
      },
    ],
  },
  {
    id: 'notifications',
    labelKey: 'configEditor.sections.notifications',
    icon: 'i-mdi-bell',
    fields: [
      {
        path: 'telegram.enabled',
        labelKey: 'configEditor.fields.telegram_enabled',
        widget: 'toggle',
        restartRequired: true,
      },
      {
        path: 'telegram.notification_settings.status',
        labelKey: 'configEditor.fields.notify_status',
        widget: 'select',
        options: notifyOptions,
      },
      {
        path: 'telegram.notification_settings.entry',
        labelKey: 'configEditor.fields.notify_entry',
        widget: 'select',
        options: notifyOptions,
      },
      {
        path: 'telegram.notification_settings.exit',
        labelKey: 'configEditor.fields.notify_exit',
        widget: 'select',
        options: notifyOptions,
      },
      {
        path: 'telegram.notification_settings.protection_trigger',
        labelKey: 'configEditor.fields.notify_protection',
        widget: 'select',
        options: notifyOptions,
      },
    ],
  },
  {
    id: 'system',
    labelKey: 'configEditor.sections.system',
    icon: 'i-mdi-lock',
    fields: [
      { path: 'db_url', labelKey: 'configEditor.fields.db_url', widget: 'text', locked: true },
      {
        path: 'trading_mode',
        labelKey: 'configEditor.fields.trading_mode',
        widget: 'text',
        locked: true,
      },
      {
        path: 'margin_mode',
        labelKey: 'configEditor.fields.margin_mode',
        widget: 'text',
        locked: true,
      },
      {
        path: 'stake_currency',
        labelKey: 'configEditor.fields.stake_currency',
        widget: 'text',
        required: true,
        locked: true,
      },
      { path: 'dry_run', labelKey: 'configEditor.fields.dry_run', widget: 'toggle', locked: true },
      {
        path: 'dry_run_wallet',
        labelKey: 'configEditor.fields.dry_run_wallet',
        widget: 'number',
        locked: true,
      },
      {
        path: 'exchange.name',
        labelKey: 'configEditor.fields.exchange_name',
        widget: 'text',
        required: true,
        locked: true,
      },
      {
        path: 'api_server.listen_port',
        labelKey: 'configEditor.fields.api_listen_port',
        widget: 'integer',
        locked: true,
      },
    ],
  },
];

/** Flattened map path → CatalogField for quick lookup (e.g. diff labels). */
export const CATALOG_BY_PATH: Record<string, CatalogField> = Object.fromEntries(
  CONFIG_CATALOG.flatMap((s) => s.fields).map((f) => [f.path, f]),
);

/** Paths that are part of the curated catalog (so "add a parameter" can exclude them). */
export const CATALOG_PATHS = new Set(Object.keys(CATALOG_BY_PATH));
