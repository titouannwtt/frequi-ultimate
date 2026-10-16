import type { Component } from 'vue';

import IconLayoutGrid from '~icons/lucide/layout-grid';
import IconBot from '~icons/lucide/bot';
import IconChartCandlestick from '~icons/lucide/chart-candlestick';
import IconBookOpenText from '~icons/lucide/book-open-text';
import IconWrench from '~icons/lucide/wrench';
import IconSettings from '~icons/lucide/settings';
import IconPause from '~icons/lucide/pause';
import IconPlay from '~icons/lucide/play';
import IconRefreshCw from '~icons/lucide/refresh-cw';
import IconSquare from '~icons/lucide/square';
import IconLogOut from '~icons/lucide/log-out';
import IconPlus from '~icons/lucide/plus';
import IconLogIn from '~icons/lucide/log-in';
import IconOctagonAlert from '~icons/lucide/octagon-alert';
import IconTriangleAlert from '~icons/lucide/triangle-alert';
import IconInfo from '~icons/lucide/info';
import IconPlugZap from '~icons/lucide/plug-zap';
import IconKeyRound from '~icons/lucide/key-round';
import IconLoader from '~icons/lucide/loader';
import IconCheck from '~icons/lucide/check';
import IconBell from '~icons/lucide/bell';
import IconBellOff from '~icons/lucide/bell-off';
import IconTerminal from '~icons/lucide/terminal';
import IconActivity from '~icons/lucide/activity';
import IconSiren from '~icons/lucide/siren';
import IconGitCompareArrows from '~icons/lucide/git-compare-arrows';
import IconDatabase from '~icons/lucide/database';
import IconCable from '~icons/lucide/cable';
import IconWifiOff from '~icons/lucide/wifi-off';
import IconHistory from '~icons/lucide/history';
import IconArrowUpRight from '~icons/lucide/arrow-up-right';
import IconArrowDownRight from '~icons/lucide/arrow-down-right';
import IconLayers from '~icons/lucide/layers';
import IconHand from '~icons/lucide/hand';
import IconX from '~icons/lucide/x';
import IconSearch from '~icons/lucide/search';
import IconChevronDown from '~icons/lucide/chevron-down';
import IconChevronLeft from '~icons/lucide/chevron-left';
import IconChevronRight from '~icons/lucide/chevron-right';
import IconChevronUp from '~icons/lucide/chevron-up';
import IconEllipsis from '~icons/lucide/ellipsis';
import IconSend from '~icons/lucide/send';
import IconCircleCheck from '~icons/lucide/circle-check';
import IconCircleHelp from '~icons/lucide/circle-help';
import IconCircleX from '~icons/lucide/circle-x';
import IconClock from '~icons/lucide/clock';
import IconArrowDown from '~icons/lucide/arrow-down';
import IconArrowUp from '~icons/lucide/arrow-up';
import IconArrowUpDown from '~icons/lucide/arrow-up-down';
import IconMonitor from '~icons/lucide/monitor';
import IconMoon from '~icons/lucide/moon';
import IconSun from '~icons/lucide/sun';
import IconRuler from '~icons/lucide/ruler';
import IconDownload from '~icons/lucide/download';
import IconUpload from '~icons/lucide/upload';
import IconBookmark from '~icons/lucide/bookmark';
import IconRewind from '~icons/lucide/rewind';
import IconFileText from '~icons/lucide/file-text';
import IconChartLine from '~icons/lucide/chart-line';
import IconColumns2 from '~icons/lucide/columns-2';
import IconTrash2 from '~icons/lucide/trash-2';
import IconExternalLink from '~icons/lucide/external-link';
import IconRotateCcw from '~icons/lucide/rotate-ccw';
import IconCopy from '~icons/lucide/copy';
import IconCalendar from '~icons/lucide/calendar';
import IconShieldCheck from '~icons/lucide/shield-check';
import IconLanguages from '~icons/lucide/languages';
import IconPalette from '~icons/lucide/palette';
import IconServer from '~icons/lucide/server';
import IconPlug from '~icons/lucide/plug';
import IconPencil from '~icons/lucide/pencil';
import IconSlidersHorizontal from '~icons/lucide/sliders-horizontal';
import IconListFilter from '~icons/lucide/list-filter';

/**
 * Lucide icons used by the design system, by Lucide name. The meaning of each icon is listed in
 * utils/icons.ts (docs/redesign/02-design.md, section 7); components take either a name from this
 * map or a component.
 */
export const DS_ICONS = {
  'layout-grid': IconLayoutGrid,
  bot: IconBot,
  'chart-candlestick': IconChartCandlestick,
  'book-open-text': IconBookOpenText,
  wrench: IconWrench,
  settings: IconSettings,
  pause: IconPause,
  play: IconPlay,
  'refresh-cw': IconRefreshCw,
  square: IconSquare,
  'log-out': IconLogOut,
  plus: IconPlus,
  'log-in': IconLogIn,
  'octagon-alert': IconOctagonAlert,
  'triangle-alert': IconTriangleAlert,
  info: IconInfo,
  'plug-zap': IconPlugZap,
  'key-round': IconKeyRound,
  loader: IconLoader,
  check: IconCheck,
  bell: IconBell,
  'bell-off': IconBellOff,
  terminal: IconTerminal,
  activity: IconActivity,
  siren: IconSiren,
  'git-compare-arrows': IconGitCompareArrows,
  database: IconDatabase,
  cable: IconCable,
  'wifi-off': IconWifiOff,
  history: IconHistory,
  'arrow-up-right': IconArrowUpRight,
  'arrow-down-right': IconArrowDownRight,
  layers: IconLayers,
  hand: IconHand,
  x: IconX,
  search: IconSearch,
  'chevron-down': IconChevronDown,
  'chevron-left': IconChevronLeft,
  'chevron-right': IconChevronRight,
  'chevron-up': IconChevronUp,
  ellipsis: IconEllipsis,
  send: IconSend,
  'circle-check': IconCircleCheck,
  'circle-help': IconCircleHelp,
  'circle-x': IconCircleX,
  clock: IconClock,
  'arrow-down': IconArrowDown,
  'arrow-up': IconArrowUp,
  'arrow-up-down': IconArrowUpDown,
  monitor: IconMonitor,
  moon: IconMoon,
  sun: IconSun,
  ruler: IconRuler,
  download: IconDownload,
  upload: IconUpload,
  bookmark: IconBookmark,
  rewind: IconRewind,
  'file-text': IconFileText,
  'chart-line': IconChartLine,
  'columns-2': IconColumns2,
  'trash-2': IconTrash2,
  'external-link': IconExternalLink,
  'rotate-ccw': IconRotateCcw,
  copy: IconCopy,
  calendar: IconCalendar,
  'shield-check': IconShieldCheck,
  languages: IconLanguages,
  palette: IconPalette,
  server: IconServer,
  plug: IconPlug,
  pencil: IconPencil,
  'sliders-horizontal': IconSlidersHorizontal,
  'list-filter': IconListFilter,
} as const satisfies Record<string, Component>;

export type DsIconName = keyof typeof DS_ICONS;
