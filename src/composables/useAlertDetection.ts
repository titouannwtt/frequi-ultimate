/**
 * Alert detection logic extracted from BotComparisonList.
 * Pure computation — no UI, no popovers, no DOM.
 */
import type { DetectedAlert, AlertConfigV2 } from '@/types/botComparison';
import type { ProfitStats } from '@/types';
import type { Trade } from '@/types/trades';
import { useBotComparisonStore, ALERT_TYPES } from '@/stores/botComparison';
import { checkAndNotifyAlerts, pruneNotifiedAlerts } from '@/utils/browserNotifications';

// Log pattern matchers
const ORDER_FAILED_PATTERNS = ['Could not create', 'InvalidOrderException', 'Unable to exit trade', 'Unable to create', 'Insufficient funds'];
const INSUFFICIENT_FUNDS_PATTERNS = ['Insufficient', 'Not enough', 'balance too low'];
const EXCHANGE_ERROR_PATTERNS = ['ExchangeError', 'RequestTimeout', 'NetworkError', 'rate limit'];
const WALLET_MISMATCH_PATTERNS = ['Wallet shows a total of 0', 'Refusing to adjust'];

const alertTooltipMap: Record<string, string> = {
  positionLoss: 'tooltips.alertTooltipPositionLoss',
  positionStuck: 'tooltips.alertTooltipPositionStuck',
  nearLiquidation: 'tooltips.alertTooltipNearLiquidation',
  logErrors: 'tooltips.alertTooltipLogErrors',
  orderFailed: 'tooltips.alertTooltipOrderFailed',
  insufficientFunds: 'tooltips.alertTooltipInsufficientFunds',
  exchangeError: 'tooltips.alertTooltipExchangeError',
  walletMismatch: 'tooltips.alertTooltipWalletMismatch',
  noTradeActivity: 'tooltips.alertTooltipNoTradeActivity',
  botOffline: 'tooltips.alertTooltipBotOffline',
  highDrawdown: 'tooltips.alertTooltipHighDrawdown',
  capacityFull: 'tooltips.alertTooltipCapacityFull',
  allFundsExposed: 'tooltips.alertTooltipAllFundsExposed',
  liquidationBeforeStoploss: 'tooltips.alertTooltipLiquidationBeforeStoploss',
};

interface BotAlertContext {
  state: any;
  openTrades: Trade[];
  profit: ProfitStats | undefined;
  lastLogs: any[];
  isBotOnline: boolean;
  isBotStarting: boolean;
}

function detectBotAlerts(
  config: AlertConfigV2['global'],
  ctx: BotAlertContext,
): DetectedAlert[] {
  const alerts: DetectedAlert[] = [];
  const { state, openTrades, profit, lastLogs: logs, isBotOnline, isBotStarting } = ctx;
  const isFutures = (state?.trading_mode as string)?.toLowerCase() === 'futures';

  if (config.positionLoss?.enabled) {
    const threshold = (config.positionLoss.threshold ?? -10) / 100;
    for (const trade of openTrades) {
      const lossRatio = trade.profit_ratio ?? 0;
      if (lossRatio < threshold) {
        alerts.push({ typeId: 'positionLoss', severity: lossRatio < threshold * 2 ? 'critical' : 'warning', message: `${trade.pair}: ${(lossRatio * 100).toFixed(1)}%` });
      }
    }
  }

  if (config.positionStuck?.enabled && profit) {
    const avgDurationStr = profit.avg_duration || '';
    let avgMs = 0;
    const dayMatch = avgDurationStr.match(/(\d+)\s*day/);
    const timeMatch = avgDurationStr.match(/(\d+):(\d+):(\d+)/);
    if (dayMatch) avgMs += parseInt(dayMatch[1]) * 86400000;
    if (timeMatch) avgMs += parseInt(timeMatch[1]) * 3600000 + parseInt(timeMatch[2]) * 60000 + parseInt(timeMatch[3]) * 1000;
    if (avgMs > 0) {
      const multiplier = config.positionStuck.threshold ?? 3;
      const maxMs = avgMs * multiplier;
      const now = Date.now();
      for (const trade of openTrades) {
        const held = now - new Date(trade.open_date).getTime();
        if (held > maxMs) {
          alerts.push({ typeId: 'positionStuck', severity: 'warning', message: `${trade.pair}: ${Math.round(held / 3600000)}h` });
        }
      }
    }
  }

  if (config.nearLiquidation?.enabled && isFutures) {
    const distThreshold = (config.nearLiquidation.threshold ?? 15) / 100;
    for (const trade of openTrades) {
      if (trade.liquidation_price && trade.liquidation_price > 0) {
        const profitRatio = trade.profit_ratio ?? 0;
        const remainingMarginPct = 1 + profitRatio;
        if (remainingMarginPct < distThreshold) {
          const currentRate = trade.current_rate ?? (trade.open_rate * (1 + profitRatio));
          alerts.push({
            typeId: 'nearLiquidation',
            severity: 'critical',
            message: `${trade.pair}: ${(remainingMarginPct * 100).toFixed(1)}% margin remaining`,
            details: `Current: ${currentRate.toFixed(6)} → Liq: ${trade.liquidation_price.toFixed(6)}`,
          });
        }
      }
    }
  }

  if (config.logErrors?.enabled) {
    const recentErrors = logs.filter((l) => l[3] === 'ERROR' || l[3] === 'CRITICAL');
    if (recentErrors.length > 0) {
      alerts.push({ typeId: 'logErrors', severity: 'critical', message: `${recentErrors.length} error(s)`, details: recentErrors.slice(0, 3).map((l: any) => l[4]).join(' | ') });
    }
  }

  if (config.orderFailed?.enabled) {
    const matches = logs.filter((l) => ORDER_FAILED_PATTERNS.some((p) => l[4]?.includes(p)));
    if (matches.length > 0) {
      alerts.push({ typeId: 'orderFailed', severity: 'critical', message: `${matches.length} failed order(s)`, details: matches.slice(0, 2).map((l: any) => l[4]).join(' | ') });
    }
  }

  if (config.insufficientFunds?.enabled) {
    const matches = logs.filter((l) => INSUFFICIENT_FUNDS_PATTERNS.some((p) => l[4]?.toLowerCase().includes(p.toLowerCase())));
    if (matches.length > 0) {
      alerts.push({ typeId: 'insufficientFunds', severity: 'warning', message: `${matches.length} fund warning(s)` });
    }
  }

  if (config.exchangeError?.enabled) {
    const matches = logs.filter((l) => EXCHANGE_ERROR_PATTERNS.some((p) => l[4]?.includes(p)));
    if (matches.length > 0) {
      alerts.push({ typeId: 'exchangeError', severity: 'warning', message: `${matches.length} exchange error(s)` });
    }
  }

  if (config.walletMismatch?.enabled) {
    const matches = logs.filter((l) => WALLET_MISMATCH_PATTERNS.some((p) => l[4]?.includes(p)));
    if (matches.length > 0) {
      alerts.push({ typeId: 'walletMismatch', severity: 'critical', message: 'Wallet desync detected', details: matches.slice(0, 1).map((l: any) => l[4]).join('') });
    }
  }

  if (config.noTradeActivity?.enabled && profit) {
    const thresholdHours = config.noTradeActivity.threshold ?? 24;
    const lastTradeTs = profit.latest_trade_timestamp;
    if (lastTradeTs) {
      const hoursSince = (Date.now() / 1000 - lastTradeTs) / 3600;
      if (hoursSince > thresholdHours) {
        alerts.push({ typeId: 'noTradeActivity', severity: 'info', message: `${Math.round(hoursSince)}h since last trade` });
      }
    }
  }

  if (config.botOffline?.enabled) {
    if (!isBotOnline && !isBotStarting) {
      alerts.push({ typeId: 'botOffline', severity: 'critical', message: 'Bot is offline' });
    } else if (isBotStarting) {
      alerts.push({ typeId: 'botOffline', severity: 'info', message: 'Bot is starting up' });
    }
  }

  if (config.highDrawdown?.enabled && profit) {
    const threshold = (config.highDrawdown.threshold ?? -15) / 100;
    const currentDD = profit.current_drawdown;
    if (currentDD !== undefined && currentDD < threshold) {
      alerts.push({ typeId: 'highDrawdown', severity: 'warning', message: `Drawdown: ${(currentDD * 100).toFixed(1)}%` });
    }
  }

  if (config.capacityFull?.enabled && state) {
    const maxTrades = state.max_open_trades;
    const currentCount = openTrades.length;
    if (maxTrades > 0 && currentCount >= maxTrades) {
      alerts.push({ typeId: 'capacityFull', severity: 'info', message: `${currentCount}/${maxTrades} slots used` });
    }
  }

  if (config.allFundsExposed?.enabled && state) {
    const balance = state.balance ?? 0;
    if (balance > 0 && openTrades.length > 0) {
      const totalStake = openTrades.reduce((sum, t) => sum + (t.stake_amount ?? 0), 0);
      if (totalStake >= balance * 0.95) {
        const pct = ((totalStake / balance) * 100).toFixed(0);
        alerts.push({ typeId: 'allFundsExposed', severity: 'warning', message: `${pct}% of balance in trades` });
      }
    }
  }

  if (config.liquidationBeforeStoploss?.enabled && isFutures) {
    for (const trade of openTrades) {
      const liqPrice = trade.liquidation_price;
      const slPrice = trade.stop_loss_abs;
      if (liqPrice && liqPrice > 0 && slPrice && slPrice > 0) {
        const currentRate = trade.current_rate ?? (trade.open_rate * (1 + (trade.profit_ratio ?? 0)));
        if (currentRate > 0) {
          const liqDist = Math.abs(currentRate - liqPrice);
          const slDist = Math.abs(currentRate - slPrice);
          if (liqDist < slDist) {
            const liqPct = ((liqDist / currentRate) * 100).toFixed(1);
            const slPct = ((slDist / currentRate) * 100).toFixed(1);
            alerts.push({ typeId: 'liquidationBeforeStoploss', severity: 'critical', message: `${trade.pair}: liq ${liqPct}% vs SL ${slPct}%` });
          }
        }
      }
    }
  }

  return alerts;
}

/**
 * Composable providing reactive alert detection for all bots.
 */
export function useAlertDetection() {
  const botStore = useBotStore();
  const compStore = useBotComparisonStore();

  function isBotAlertEnabled(botId: string): boolean {
    return compStore.alertConfig.perBotEnabled[botId] !== false;
  }

  const allBotAlerts = computed(() => {
    const result: Record<string, DetectedAlert[]> = {};
    const config = compStore.alertConfig.global;
    for (const botId of Object.keys(botStore.botStores)) {
      if (!isBotAlertEnabled(botId)) {
        result[botId] = [];
        continue;
      }
      const store = botStore.botStores[botId];
      const alerts = detectBotAlerts(config, {
        state: botStore.allBotState[botId],
        openTrades: botStore.allOpenTrades[botId] || [],
        profit: botStore.allProfit[botId],
        lastLogs: store?.lastLogs || [],
        isBotOnline: store?.isBotOnline ?? false,
        isBotStarting: store?.isBotStarting ?? false,
      });
      // Warn if data is stale (no update for > 2 minutes while bot claims online)
      if (store?.isBotOnline && store?.lastSeenOnline) {
        const staleMs = Date.now() - store.lastSeenOnline;
        if (staleMs > 120_000) {
          alerts.push({
            typeId: 'botOffline',
            severity: 'warning',
            message: `Data stale (${Math.round(staleMs / 60_000)}min since last update)`,
          });
        }
      }
      result[botId] = alerts;
    }
    return result;
  });

  // Fire browser notifications on new alerts
  watch(allBotAlerts, (alerts) => {
    checkAndNotifyAlerts(alerts, botStore.botStores);
    pruneNotifiedAlerts(alerts);
  }, { deep: true });

  function hasBotAlert(botId: string): boolean {
    return (allBotAlerts.value[botId]?.length ?? 0) > 0;
  }

  function getBotAlertCount(botId: string): number {
    return allBotAlerts.value[botId]?.length ?? 0;
  }

  function getMaxSeverity(alerts: DetectedAlert[]): string {
    if (alerts.some((a) => a.severity === 'critical')) return 'critical';
    if (alerts.some((a) => a.severity === 'warning')) return 'warning';
    return 'info';
  }

  function hasBotOfflineAlert(botId: string): boolean {
    const store = botStore.botStores[botId];
    if (!store) return false;
    return !store.isBotOnline && !store.isBotStarting && compStore.alertConfig.global.botOffline?.enabled !== false;
  }

  function getAlertTooltip(alertId: string, t: (key: string) => string): string {
    const key = alertTooltipMap[alertId];
    return key ? t(key) : '';
  }

  function getAlertTypeIcon(typeId: string): string {
    return ALERT_TYPES.find((a) => a.id === typeId)?.icon ?? 'i-mdi-alert';
  }

  function enabledAlertCount(): number {
    return Object.values(compStore.alertConfig.global).filter((c) => c.enabled).length;
  }

  const totalAlertCount = computed(() => {
    let count = 0;
    for (const botId of Object.keys(botStore.botStores)) {
      count += getBotAlertCount(botId);
    }
    return count;
  });

  return {
    allBotAlerts,
    totalAlertCount,
    isBotAlertEnabled,
    hasBotAlert,
    getBotAlertCount,
    getMaxSeverity,
    hasBotOfflineAlert,
    getAlertTooltip,
    getAlertTypeIcon,
    enabledAlertCount,
  };
}
