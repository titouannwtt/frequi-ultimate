/**
 * Column registry of the tables (02 section 5.3, `useColumns`). One declaration per column, shared
 * by FleetTable and the presets of TradeTable, with the width below which a column hides itself
 * (in px of the table container, not of the window), and the mapping from the ids of the old
 * tables so that a user's choices survive the migration (unknown ids are dropped).
 */
import type { ColumnPreset } from '@/migration/schema';

export type ColumnAlign = 'left' | 'right' | 'center';

export interface ColumnSpec {
  id: string;
  /** i18n key of the header. */
  labelKey: string;
  align: ColumnAlign;
  sortable: boolean;
  /** Container width in px under which the column is hidden. */
  hideBelow: number;
  /** Presets that offer this column. */
  presets: readonly ColumnPreset[];
  /** Presets in which the column is shown by default. */
  defaultIn: readonly ColumnPreset[];
  /** The column cannot be removed (the row would lose its identity). */
  required?: boolean;
  /** Figures that only the gateway can provide: the column is unavailable in direct mode. */
  gatewayOnly?: boolean;
}

const OPEN: readonly ColumnPreset[] = ['open', 'bot'];
const TRADES: readonly ColumnPreset[] = ['open', 'bot', 'closed', 'journal'];
const CLOSED: readonly ColumnPreset[] = ['closed', 'journal'];

const c = (
  id: string,
  align: ColumnAlign,
  sortable: boolean,
  hideBelow: number,
  presets: readonly ColumnPreset[],
  defaultIn: readonly ColumnPreset[],
  extra: Partial<Pick<ColumnSpec, 'required' | 'gatewayOnly'>> = {},
): ColumnSpec => ({
  id,
  labelKey: `fq.col.${id}`,
  align,
  sortable,
  hideBelow,
  presets,
  defaultIn,
  ...extra,
});

export const COLUMN_REGISTRY: readonly ColumnSpec[] = [
  // ---- FleetTable ----
  c('bot', 'left', true, 0, ['fleet', ...TRADES], ['fleet', 'open', 'journal'], { required: true }),
  c('state', 'center', true, 0, ['fleet'], ['fleet']),
  c('mode', 'center', true, 520, ['fleet'], ['fleet']),
  c('market', 'left', true, 760, ['fleet'], ['fleet']),
  c('exchange', 'left', true, 900, ['fleet'], []),
  c('strategy', 'left', true, 900, ['fleet'], []),
  c('trades', 'right', true, 480, ['fleet'], ['fleet']),
  c('latent', 'right', true, 0, ['fleet'], ['fleet']),
  c('realized_1d', 'right', true, 640, ['fleet'], ['fleet']),
  c('realized_7d', 'right', true, 760, ['fleet'], []),
  c('realized_30d', 'right', true, 760, ['fleet'], []),
  c('realized_total', 'right', true, 880, ['fleet'], ['fleet']),
  c('drawdown', 'right', true, 820, ['fleet'], ['fleet']),
  c('exposure', 'right', true, 960, ['fleet'], ['fleet']),
  c('capital', 'right', true, 960, ['fleet'], []),
  c('winrate', 'right', true, 1000, ['fleet'], []),
  c('last_trade', 'right', true, 1000, ['fleet'], []),
  c('spark24h', 'center', false, 900, ['fleet'], ['fleet'], { gatewayOnly: true }),
  c('alerts', 'center', true, 0, ['fleet'], ['fleet']),
  c('age', 'right', true, 700, ['fleet'], ['fleet']),
  c('port', 'right', true, 1100, ['fleet'], []),
  // ---- trades (open positions, closed trades, journal) ----
  c('trade_id', 'right', true, 640, TRADES, ['open', 'bot', 'closed', 'journal']),
  c('pair', 'left', true, 0, TRADES, ['open', 'bot', 'closed', 'journal'], { required: true }),
  c('side', 'center', true, 0, TRADES, ['open', 'bot', 'closed', 'journal']),
  c('leverage', 'right', true, 760, TRADES, []),
  c('entry', 'right', false, 640, TRADES, ['open', 'bot', 'closed', 'journal']),
  c('current', 'right', true, 560, OPEN, ['open', 'bot']),
  c('pnl_pct', 'right', true, 0, TRADES, ['open', 'bot', 'closed', 'journal']),
  c('pnl_abs', 'right', true, 0, TRADES, ['open', 'bot', 'closed', 'journal']),
  c('stake', 'right', true, 700, TRADES, ['open', 'bot']),
  c('tag', 'left', true, 880, TRADES, ['open']),
  c('duration', 'right', true, 520, TRADES, ['open', 'bot', 'closed', 'journal']),
  c('duration_pct', 'right', true, 880, OPEN, ['open', 'bot'], { gatewayOnly: true }),
  c('liq_distance', 'right', true, 760, OPEN, ['open', 'bot']),
  c('stoploss', 'right', true, 960, OPEN, []),
  c('dca', 'center', true, 700, TRADES, ['open', 'bot']),
  c('replay', 'center', false, 1000, OPEN, []),
  c('opened', 'right', true, 880, TRADES, ['open', 'bot']),
  c('actions', 'center', false, 0, OPEN, ['open', 'bot'], { required: true }),
  // ---- closed trades and journal only ----
  c('exit_price', 'right', false, 760, CLOSED, ['closed', 'journal']),
  c('exit_reason', 'left', true, 560, CLOSED, ['closed', 'journal']),
  c('closed_at', 'right', true, 640, CLOSED, ['closed', 'journal']),
  c('closed_ago', 'right', true, 900, CLOSED, []),
  c('fee', 'right', true, 1000, CLOSED, []),
  c('mae_mfe', 'right', false, 1000, CLOSED, ['journal'], { gatewayOnly: true }),
];

const BY_ID = new Map(COLUMN_REGISTRY.map((col) => [col.id, col]));

export function columnSpec(id: string): ColumnSpec | undefined {
  return BY_ID.get(id);
}

export function columnsFor(preset: ColumnPreset): ColumnSpec[] {
  return COLUMN_REGISTRY.filter((col) => col.presets.includes(preset));
}

export function defaultColumnIds(preset: ColumnPreset): string[] {
  return columnsFor(preset)
    .filter((col) => col.defaultIn.includes(preset))
    .map((col) => col.id);
}

/**
 * Old trade table keys (`enhancedOpenTradeColumns`...) to the new ids. `null` means the old column
 * has no counterpart and is dropped.
 */
export const LEGACY_TRADE_COLUMNS: Readonly<Record<string, string | null>> = {
  botState: 'bot',
  botName: 'bot',
  trade_id: 'trade_id',
  pair: 'pair',
  type: 'side',
  leverage: 'leverage',
  open_rate: 'entry',
  current_rate: 'current',
  profit_pct: 'pnl_pct',
  profit_abs: 'pnl_abs',
  stake_amount: 'stake',
  enter_tag: 'tag',
  replay: 'replay',
  duration: 'duration',
  stoploss_dist: 'liq_distance',
  duration_anomaly: 'duration_pct',
  dca_info: 'dca',
  open_date: 'opened',
  actions: 'actions',
  close_rate: 'exit_price',
  exit_reason: 'exit_reason',
  close_date: 'closed_at',
  closed_ago: 'closed_ago',
  fee: 'fee',
};

/** Old fleet comparison table ids (`ftBotComparison.visibleColumnIds`) to the new ids. */
export const LEGACY_FLEET_COLUMNS: Readonly<Record<string, string | null>> = {
  botName: 'bot',
  status: 'state',
  market: 'market',
  exchange: 'exchange',
  trades: 'trades',
  openProfit: 'latent',
  closedProfit: 'realized_total',
  profitCurrent: 'latent',
  maxDrawdown: 'drawdown',
  balance: 'capital',
  winLoss: 'winrate',
  lastTrade: 'last_trade',
  stakeAmount: null,
  port: 'port',
  strategy: 'strategy',
  pairCount: null,
  stakeCurrency: null,
  availableCapital: 'capital',
  tradableBalanceRatio: null,
  availableFunds: null,
  monthlyProfit: 'realized_30d',
  yearlyProfit: null,
};
