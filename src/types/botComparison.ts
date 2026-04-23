export interface ComparisonTableItems {
  botId: string | undefined;
  botName: string;
  botIcon?: string;
  trades?: string;
  profitClosed: number;
  profitClosedRatio?: number;
  profitOpen: number;
  profitOpenRatio?: number;
  stakeCurrency: string;
  wins: number;
  losses: number;
  balance: number;
  stakeCurrencyDecimals?: number;
  isDryRun?: boolean;
  isOnline?: boolean;
  lastSeenOnline?: number;
  balanceAppendix: string;
  capitalWithdrawal?: number;
  exchange?: string;
  tradingMode?: string;
  stakeAmount?: string;
  port?: number;
  strategy?: string;
  monthlyProfit?: number;
  yearlyProfit?: number;
  /** Summary row: total open positions count */
  summaryTradesCount?: number;
  /** Summary row: total max_open_trades across all bots */
  summaryTradesMax?: number;
  /** Summary row: per-currency balance breakdown */
  perCurrencyBalances?: Record<string, number>;
  /** Summary row: per-currency profit breakdown (open) */
  perCurrencyProfitOpen?: Record<string, number>;
  /** Summary row: per-currency profit breakdown (closed) */
  perCurrencyProfitClosed?: Record<string, number>;
  /** Summary row: per-currency monthly profit breakdown */
  perCurrencyMonthlyProfit?: Record<string, number>;
  /** Summary row: per-currency yearly profit breakdown */
  perCurrencyYearlyProfit?: Record<string, number>;
  /** Whether the summary row has multiple currencies */
  isMultiCurrency?: boolean;
  /** Whether the summary values are approximate (converted via exchange rates) */
  isConverted?: boolean;
  /** Group row marker */
  isGroupRow?: boolean;
  groupId?: string;
  groupIcon?: string;
  groupCollapsed?: boolean;
  groupBotCount?: number;
}

export interface ColumnDefinition {
  id: string;
  labelKey: string;
  icon?: string;
  default: boolean;
  removable: boolean;
}

/** @deprecated Use AlertConfigV2 instead */
export interface BotAlertConfig {
  enabled: boolean;
  lossThreshold: number; // e.g., -0.05 for -5%
}

export type AlertCategory = 'position' | 'log' | 'activity' | 'system';
export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface AlertTypeDefinition {
  id: string;
  category: AlertCategory;
  labelKey: string;
  descriptionKey: string;
  icon: string;
  severity: AlertSeverity;
  defaultEnabled: boolean;
  hasThreshold?: boolean;
  thresholdMin?: number;
  thresholdMax?: number;
  thresholdDefault?: number;
  thresholdUnit?: string;
  thresholdStep?: number;
  hasLeverageOption?: boolean;
}

export interface AlertSettingConfig {
  enabled: boolean;
  threshold?: number;
  includeLeverage?: boolean;
}

export interface AlertConfigV2 {
  global: Record<string, AlertSettingConfig>;
  perBotEnabled: Record<string, boolean>; // botId -> enabled (true = alerts active for this bot)
}

export interface DetectedAlert {
  typeId: string;
  severity: AlertSeverity;
  message: string;
  details?: string;
}

export interface BotGroup {
  id: string;
  name: string;
  icon: string; // emoji
  collapsed: boolean;
  botIds: string[];
}

export interface CustomTag {
  id: string;
  name: string;
  color: string; // hex color like #3b82f6
}
