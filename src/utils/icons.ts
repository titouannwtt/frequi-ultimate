/**
 * Icon vocabulary of the redesign (docs/redesign/02-design.md, section 7).
 *
 * Icons are Lucide, used as `<i-lucide-NAME class="ico" />` through unplugin-icons (stroke 1.75
 * is set by the `.ico` class). Components import by tag, so this map is the reference of which icon
 * means what; tests/unit/icons.spec.ts checks every name exists in @iconify-json/lucide.
 * An icon never replaces the label of a real-money action; icon-only buttons need an aria-label.
 */
export const FQ_ICONS = {
  fleet: 'layout-grid',
  bot: 'bot',
  charts: 'chart-candlestick',
  journal: 'book-open-text',
  tools: 'wrench',
  settings: 'settings',
  pause: 'pause',
  resume: 'play',
  reload: 'refresh-cw',
  stop: 'square',
  exit: 'log-out',
  add: 'plus',
  forceEntry: 'log-in',
  critical: 'octagon-alert',
  warning: 'triangle-alert',
  info: 'info',
  offline: 'plug-zap',
  sessionExpired: 'key-round',
  starting: 'loader',
  acknowledge: 'check',
  silence: 'bell-off',
  logs: 'terminal',
  health: 'activity',
  attention: 'siren',
  reconcile: 'git-compare-arrows',
  botDatabase: 'database',
  directMode: 'cable',
  networkOffline: 'wifi-off',
  cache: 'history',
  long: 'arrow-up-right',
  short: 'arrow-down-right',
  dcaLadder: 'layers',
  hold: 'hand',
  // Theme selector
  themeSystem: 'monitor',
  themeDark: 'moon',
  themeLight: 'sun',
} as const;

export type FqIconMeaning = keyof typeof FQ_ICONS;

/** Pixel sizes: tables 13, default 15, empty states 18, mobile bar 20. */
export const FQ_ICON_SIZES = { table: 13, default: 15, empty: 18, mobileBar: 20 } as const;
