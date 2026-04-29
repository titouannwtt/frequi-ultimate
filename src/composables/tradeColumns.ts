import type { Trade } from '@/types';
import humanizeDuration from 'humanize-duration';

export interface TradeColumnDef {
  key: string;
  labelKey: string;
  defaultVisible: boolean;
  /** Only for closed trades */
  closedOnly?: boolean;
  /** Only for open trades */
  openOnly?: boolean;
  sortable?: boolean;
  /** MDI icon class for column header */
  icon?: string;
}

const OPEN_COLUMNS: TradeColumnDef[] = [
  { key: 'botState', labelKey: 'enhancedTrades.colBotState', defaultVisible: true, sortable: true, icon: 'i-mdi-circle' },
  { key: 'botName', labelKey: 'enhancedTrades.colBot', defaultVisible: true, sortable: true, icon: 'i-mdi-robot' },
  { key: 'trade_id', labelKey: 'enhancedTrades.colTradeId', defaultVisible: true, sortable: true, icon: 'i-mdi-identifier' },
  { key: 'pair', labelKey: 'enhancedTrades.colPair', defaultVisible: true, sortable: true, icon: 'i-mdi-swap-horizontal' },
  { key: 'type', labelKey: 'enhancedTrades.colType', defaultVisible: true, sortable: true, icon: 'i-mdi-arrow-up-down' },
  { key: 'leverage', labelKey: 'enhancedTrades.colLeverage', defaultVisible: true, sortable: true, icon: 'i-mdi-multiplication' },
  { key: 'open_rate', labelKey: 'enhancedTrades.colEntryPrice', defaultVisible: true, sortable: true, icon: 'i-mdi-login' },
  { key: 'current_rate', labelKey: 'enhancedTrades.colCurrentPrice', defaultVisible: true, sortable: true, openOnly: true, icon: 'i-mdi-currency-usd' },
  { key: 'profit_pct', labelKey: 'enhancedTrades.colProfitPct', defaultVisible: true, sortable: true, icon: 'i-mdi-percent' },
  { key: 'profit_abs', labelKey: 'enhancedTrades.colProfitAbs', defaultVisible: true, sortable: true, icon: 'i-mdi-cash' },
  { key: 'stake_amount', labelKey: 'enhancedTrades.colStake', defaultVisible: true, sortable: true, icon: 'i-mdi-wallet' },
  { key: 'enter_tag', labelKey: 'enhancedTrades.colOpenReason', defaultVisible: false, sortable: true, openOnly: true, icon: 'i-mdi-tag' },
  { key: 'duration', labelKey: 'enhancedTrades.colDuration', defaultVisible: true, sortable: true, icon: 'i-mdi-clock-outline' },
  { key: 'stoploss_dist', labelKey: 'enhancedTrades.colStoplossDist', defaultVisible: false, openOnly: true, sortable: true, icon: 'i-mdi-shield-alert' },
  { key: 'duration_anomaly', labelKey: 'enhancedTrades.colDurationAnomaly', defaultVisible: false, sortable: true, icon: 'i-mdi-alert-circle' },
  { key: 'dca_info', labelKey: 'enhancedTrades.colDca', defaultVisible: false, sortable: true, icon: 'i-mdi-layers-plus' },
  { key: 'open_date', labelKey: 'enhancedTrades.colOpenDate', defaultVisible: true, sortable: true, icon: 'i-mdi-calendar-start' },
  { key: 'actions', labelKey: 'enhancedTrades.colActions', defaultVisible: true, openOnly: true, sortable: false, icon: 'i-mdi-dots-vertical' },
];

const CLOSED_EXTRA_COLUMNS: TradeColumnDef[] = [
  { key: 'close_rate', labelKey: 'enhancedTrades.colClosePrice', defaultVisible: true, closedOnly: true, sortable: true, icon: 'i-mdi-logout' },
  { key: 'exit_reason', labelKey: 'enhancedTrades.colCloseReason', defaultVisible: true, closedOnly: true, sortable: true, icon: 'i-mdi-flag' },
  { key: 'close_date', labelKey: 'enhancedTrades.colCloseDate', defaultVisible: true, closedOnly: true, sortable: true, icon: 'i-mdi-calendar-end' },
  { key: 'closed_ago', labelKey: 'enhancedTrades.colClosedAgo', defaultVisible: false, closedOnly: true, sortable: true, icon: 'i-mdi-history' },
  { key: 'fee', labelKey: 'enhancedTrades.colFee', defaultVisible: false, closedOnly: true, sortable: true, icon: 'i-mdi-receipt' },
];

export function getOpenTradeColumns(): TradeColumnDef[] {
  return OPEN_COLUMNS.filter((c) => !c.closedOnly);
}

export function getClosedTradeColumns(): TradeColumnDef[] {
  // All open columns (except openOnly ones like current_rate and actions) + closed extras
  const base = OPEN_COLUMNS.filter((c) => !c.openOnly);
  return [...base, ...CLOSED_EXTRA_COLUMNS];
}

const STORAGE_KEY_OPEN = 'enhancedOpenTradeColumns';
const STORAGE_KEY_CLOSED = 'enhancedClosedTradeColumns';

export function useTradeColumnVisibility(mode: 'open' | 'closed') {
  const storageKey = mode === 'open' ? STORAGE_KEY_OPEN : STORAGE_KEY_CLOSED;
  const allColumns = mode === 'open' ? getOpenTradeColumns() : getClosedTradeColumns();

  const visibleKeys = ref<string[]>(loadVisibleKeys());

  function loadVisibleKeys(): string[] {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const keys: string[] = JSON.parse(stored);
        // Auto-add new defaultVisible columns that weren't in the stored list
        const newDefaults = allColumns
          .filter((c) => c.defaultVisible && !keys.includes(c.key))
          .map((c) => c.key);
        if (newDefaults.length > 0) {
          keys.push(...newDefaults);
          localStorage.setItem(storageKey, JSON.stringify(keys));
        }
        return keys;
      }
    } catch {
      // ignore
    }
    return allColumns.filter((c) => c.defaultVisible).map((c) => c.key);
  }

  function saveVisibleKeys() {
    localStorage.setItem(storageKey, JSON.stringify(visibleKeys.value));
  }

  function toggleColumn(key: string) {
    const idx = visibleKeys.value.indexOf(key);
    if (idx >= 0) {
      visibleKeys.value.splice(idx, 1);
    } else {
      visibleKeys.value.push(key);
    }
    saveVisibleKeys();
  }

  function isVisible(key: string): boolean {
    return visibleKeys.value.includes(key);
  }

  const visibleColumns = computed(() => allColumns.filter((c) => isVisible(c.key)));

  return { allColumns, visibleKeys, visibleColumns, toggleColumn, isVisible };
}

// --- Utility functions for trade display ---

export function tradeDurationMs(trade: Trade): number {
  const openTs = trade.open_timestamp;
  const closeTs = trade.close_timestamp ?? Date.now();
  return closeTs - openTs;
}

export function humanizeTradeDuration(trade: Trade): string {
  const ms = tradeDurationMs(trade);
  if (ms < 60000) return '< 1m';
  return humanizeDuration(ms, { largest: 2, round: true, units: ['d', 'h', 'm'] });
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return '< 1m ago';
  return humanizeDuration(diff, { largest: 2, round: true, units: ['d', 'h', 'm'] }) + ' ago';
}

export function stoplossDistancePct(trade: Trade): number | null {
  if (!trade.current_rate || !trade.stop_loss_abs) return null;
  if (trade.is_short) {
    return ((trade.stop_loss_abs - trade.current_rate) / trade.current_rate) * 100;
  }
  return ((trade.current_rate - trade.stop_loss_abs) / trade.current_rate) * 100;
}

export function durationAnomalyLevel(trade: Trade): 'ok' | 'warn' | 'danger' {
  const ms = tradeDurationMs(trade);
  const hours = ms / 3600000;
  if (hours > 72) return 'danger';
  if (hours > 24) return 'warn';
  return 'ok';
}

/** Returns a percentage (0-100) representing how far along the duration is.
 *  If closedTrades are provided, uses percentile ranking (consistent with popover).
 *  Otherwise falls back to fixed 72h scale. */
export function durationAnomalyPct(trade: Trade, closedTrades?: Trade[]): number {
  const ms = tradeDurationMs(trade);

  if (closedTrades && closedTrades.length >= 3) {
    // Percentile-based (same as DurationHealthPopover)
    const durations = closedTrades
      .map(t => tradeDurationMs(t))
      .filter(d => d > 0)
      .sort((a, b) => a - b);
    if (durations.length > 0) {
      const belowCount = durations.filter(d => d <= ms).length;
      return Math.round((belowCount / durations.length) * 100);
    }
  }

  // Fallback: fixed 72h scale
  const hours = ms / 3600000;
  return Math.min((hours / 72) * 100, 100);
}

/** Anomaly level based on percentile or fixed thresholds */
export function durationAnomalyLevelFromPct(pct: number): 'ok' | 'warn' | 'danger' {
  if (pct > 90) return 'danger';
  if (pct > 70) return 'warn';
  return 'ok';
}

export function exitReasonColor(reason: string | undefined): string {
  if (!reason) return 'bg-surface-400';
  const r = reason.toLowerCase();
  if (r.includes('roi') || r.includes('profit') || r.includes('tp') || r.includes('trailing')) return 'bg-green-500 text-white';
  if (r.includes('stop') || r.includes('sl') || r.includes('stoploss') || r.includes('liquidat')) return 'bg-red-500 text-white';
  if (r.includes('signal') || r.includes('exit_signal')) return 'bg-blue-500 text-white';
  if (r.includes('force')) return 'bg-orange-500 text-white';
  return 'bg-surface-500 text-white';
}

export function profitBgClass(profitPct: number | null | undefined): string {
  if (profitPct === null || profitPct === undefined) return '';
  if (profitPct > 5) return 'bg-green-500/20';
  if (profitPct > 2) return 'bg-green-500/15';
  if (profitPct > 0) return 'bg-green-500/8';
  if (profitPct > -2) return 'bg-red-500/8';
  if (profitPct > -5) return 'bg-red-500/15';
  return 'bg-red-500/20';
}

export function rowBgClass(trade: Trade): string {
  const pct = trade.profit_pct;
  if (pct === null || pct === undefined) return '';
  if (pct > 3) return 'bg-green-500/8';
  if (pct > 0) return 'bg-green-500/4';
  if (pct > -3) return 'bg-red-500/4';
  return 'bg-red-500/8';
}
