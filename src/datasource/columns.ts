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
  // ---- FleetTable: the thresholds are the container widths of 02 section 3.1 ----
  c('bot', 'left', true, 0, ['fleet', ...TRADES], ['fleet', 'open', 'journal'], { required: true }),
  // The name cell already carries the state dot, the mode and market badges and the alert icon:
  // these columns stay available for users who want them apart.
  c('state', 'center', true, 0, ['fleet'], []),
  c('mode', 'center', true, 520, ['fleet'], []),
  c('market', 'left', true, 760, ['fleet'], []),
  c(
    'side',
    'center',
    true,
    600,
    ['fleet', ...TRADES],
    ['fleet', 'open', 'bot', 'closed', 'journal'],
  ),
  c('latent', 'right', true, 0, ['fleet'], ['fleet']),
  c('realized_1d', 'right', true, 600, ['fleet'], ['fleet']),
  c('realized_7d', 'right', true, 760, ['fleet'], []),
  c('realized_30d', 'right', true, 800, ['fleet'], ['fleet']),
  c('realized_total', 'right', true, 880, ['fleet'], []),
  c('spark24h', 'center', false, 940, ['fleet'], ['fleet'], { gatewayOnly: true }),
  c('exposure', 'right', true, 800, ['fleet'], ['fleet']),
  // Open slots (gauge), "slots" in the design
  c('trades', 'right', true, 600, ['fleet'], ['fleet']),
  c('drawdown', 'right', true, 480, ['fleet'], ['fleet']),
  c('last_trade', 'right', true, 1080, ['fleet'], ['fleet']),
  c('alerts', 'center', true, 0, ['fleet'], []),
  c('age', 'right', true, 520, ['fleet'], ['fleet']),
  c('exchange', 'left', true, 900, ['fleet'], []),
  c('strategy', 'left', true, 900, ['fleet'], []),
  c('capital', 'right', true, 960, ['fleet'], []),
  c('winrate', 'right', true, 1000, ['fleet'], []),
  c('port', 'right', true, 1100, ['fleet'], []),
  // ---- trades (open positions, closed trades, journal) ----
  c('trade_id', 'right', true, 640, TRADES, []),
  c('pair', 'left', true, 0, TRADES, ['open', 'bot', 'closed', 'journal'], { required: true }),
  c('leverage', 'right', true, 760, TRADES, []),
  c('dca', 'center', true, 700, TRADES, ['open', 'bot', 'journal']),
  c('entry', 'right', false, 640, TRADES, ['open', 'bot', 'closed']),
  c('current', 'right', true, 560, OPEN, ['open', 'bot']),
  c('pnl_abs', 'right', true, 0, TRADES, ['open', 'bot', 'closed', 'journal']),
  c('pnl_pct', 'right', true, 0, TRADES, ['open', 'bot', 'closed', 'journal']),
  c('stake', 'right', true, 700, TRADES, []),
  c('tag', 'left', true, 880, TRADES, []),
  c('liq_distance', 'right', true, 760, OPEN, ['open', 'bot']),
  c('duration', 'right', true, 520, TRADES, ['open', 'bot', 'closed', 'journal']),
  c('duration_pct', 'right', true, 880, OPEN, [], { gatewayOnly: true }),
  c('stoploss', 'right', true, 960, OPEN, []),
  c('replay', 'center', false, 1000, OPEN, []),
  c('opened', 'right', true, 880, TRADES, []),
  c('actions', 'center', false, 0, OPEN, ['open', 'bot'], { required: true }),
  // ---- closed trades and journal only ----
  // The Journal leaves the exit price to the trade sheet (05-friendly-plan.md, section 2.6)
  c('exit_price', 'right', false, 760, CLOSED, ['closed']),
  c('exit_reason', 'left', true, 560, CLOSED, ['closed', 'journal']),
  c('closed_at', 'right', true, 640, CLOSED, ['closed', 'journal']),
  c('closed_ago', 'right', true, 900, CLOSED, []),
  c('fee', 'right', true, 1000, CLOSED, []),
  c('mae_mfe', 'right', false, 860, CLOSED, ['journal'], { gatewayOnly: true }),
];

const BY_ID = new Map(COLUMN_REGISTRY.map((col) => [col.id, col]));

export function columnSpec(id: string): ColumnSpec | undefined {
  return BY_ID.get(id);
}

/**
 * Display order of the columns of a preset, when the user has not chosen one. The registry order
 * can not serve every preset (`bot` leads the fleet table but follows `pair` in the trade tables).
 */
const PRESET_ORDER: Record<ColumnPreset, readonly string[]> = {
  fleet: [],
  open: ['pair', 'bot', 'side', 'dca', 'entry', 'current', 'pnl_abs', 'pnl_pct', 'liq_distance'],
  bot: ['pair', 'bot', 'side', 'dca', 'entry', 'current', 'pnl_abs', 'pnl_pct', 'liq_distance'],
  closed: ['pair', 'bot', 'side', 'entry', 'exit_price', 'pnl_abs', 'pnl_pct', 'duration'],
  // 02 section 3.4: closed, bot, pair, side, DCA, P&L, %, MAE/MFE, reason, duration
  journal: [
    'closed_at',
    'bot',
    'pair',
    'side',
    'dca',
    'pnl_abs',
    'pnl_pct',
    'mae_mfe',
    'exit_reason',
    'duration',
  ],
};

export function columnsFor(preset: ColumnPreset): ColumnSpec[] {
  const wanted = PRESET_ORDER[preset];
  const rank = (id: string) => {
    const i = wanted.indexOf(id);
    return i < 0 ? wanted.length : i;
  };
  const all = COLUMN_REGISTRY.filter((col) => col.presets.includes(preset));
  // `actions` always closes the row; the other ids keep registry order after the listed ones
  return all
    .map((col, index) => ({ col, index }))
    .sort((a, b) => {
      if (a.col.id === 'actions' || b.col.id === 'actions') {
        return a.col.id === 'actions' ? 1 : -1;
      }
      return rank(a.col.id) - rank(b.col.id) || a.index - b.index;
    })
    .map((e) => e.col);
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
