<script setup lang="ts">
import type { DetectedAlert } from '@/types';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

const { t } = useI18n();
const router = useRouter();
const botStore = useBotStore();

function goToLogs(highlightText?: string) {
  router.push({
    name: 'Freqtrade Logs',
    query: { bot: props.botId, highlight: highlightText ?? '' },
  });
}

const props = defineProps<{
  botId: string;
  alerts: DetectedAlert[];
}>();

const severityColorMap: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
};

const maxSeverity = computed(() => {
  if (props.alerts.some((a) => a.severity === 'critical')) return 'critical';
  if (props.alerts.some((a) => a.severity === 'warning')) return 'warning';
  return 'info';
});

const botName = computed(() => {
  const store = botStore.botStores[props.botId];
  return store?.uiBotName || store?.botId || props.botId;
});

const openTrades = computed(() => botStore.allOpenTrades[props.botId] || []);
const profit = computed(() => botStore.allProfit[props.botId]);
const state = computed(() => botStore.allBotState[props.botId]);
const store = computed(() => botStore.botStores[props.botId]);
const balance = computed(() => botStore.allBalance[props.botId]);

// --- Grouping logic ---
const positionTypeIds = ['positionLoss', 'positionStuck', 'nearLiquidation'];

const groupedAlerts = computed(() => {
  const positionAlerts: Record<string, DetectedAlert[]> = {};
  const generalAlerts: DetectedAlert[] = [];

  for (const alert of props.alerts) {
    const pairMatch = alert.message.match(/^(.+?\/[^:]+(?::[^:]+)?)\s*:/);
    if (pairMatch && positionTypeIds.includes(alert.typeId)) {
      const pair = pairMatch[1];
      if (!positionAlerts[pair]) positionAlerts[pair] = [];
      positionAlerts[pair].push(alert);
    } else {
      generalAlerts.push(alert);
    }
  }

  return { positionAlerts, generalAlerts };
});

function getPositionMaxSeverity(alerts: DetectedAlert[]): string {
  if (alerts.some((a) => a.severity === 'critical')) return 'critical';
  if (alerts.some((a) => a.severity === 'warning')) return 'warning';
  return 'info';
}

function getTradeForPair(pair: string) {
  return openTrades.value.find((t) => t.pair === pair);
}

// --- Duration helpers ---
function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function getAvgDurationMs(): number {
  const avgDurationStr = profit.value?.avg_duration || '';
  let avgMs = 0;
  const dayMatch = avgDurationStr.match(/(\d+)\s*day/);
  const timeMatch = avgDurationStr.match(/(\d+):(\d+):(\d+)/);
  if (dayMatch) avgMs += parseInt(dayMatch[1]) * 86400000;
  if (timeMatch)
    avgMs +=
      parseInt(timeMatch[1]) * 3600000 +
      parseInt(timeMatch[2]) * 60000 +
      parseInt(timeMatch[3]) * 1000;
  return avgMs;
}

// Per-alert detail data helpers
function getPositionLossDetail(alert: DetectedAlert) {
  const pairMatch = alert.message.match(/^(.+?):\s*(-?[\d.]+)%$/);
  if (!pairMatch) return null;
  const pair = pairMatch[1];
  const lossPct = parseFloat(pairMatch[2]);
  const trade = openTrades.value.find((t) => t.pair === pair);
  if (!trade) return { pair, lossPct, direction: '', leverage: 1, entryPrice: 0, currentPrice: 0, stakeAtRisk: 0, exitValue: 0, threshold: -10, liqDistance: null as number | null };
  const direction = trade.is_short ? 'Short' : 'Long';
  const leverage = trade.leverage ?? 1;
  const currentPrice = trade.open_rate * (1 + (trade.profit_ratio ?? 0));
  const stakeAtRisk = trade.stake_amount ?? 0;
  const exitValue = stakeAtRisk + (trade.profit_abs ?? trade.total_profit_abs ?? 0);
  const liqDistance = trade.liquidation_price && trade.liquidation_price > 0
    ? Math.abs(currentPrice - trade.liquidation_price) / currentPrice
    : null;
  return { pair, lossPct, direction, leverage, entryPrice: trade.open_rate, currentPrice, stakeAtRisk, exitValue, threshold: -10, liqDistance };
}

function getPositionStuckDetail(alert: DetectedAlert) {
  const pairMatch = alert.message.match(/^(.+?):\s*(\d+)h$/);
  if (!pairMatch) return null;
  const pair = pairMatch[1];
  const heldHours = parseInt(pairMatch[2]);
  const avgMs = getAvgDurationMs();
  const avgHours = Math.round(avgMs / 3600000);
  const multiplier = avgHours > 0 ? heldHours / avgHours : 0;
  return { pair, heldHours, avgHours, multiplier };
}

function getLogErrorsDetail(alert: DetectedAlert) {
  const logs = store.value?.lastLogs || [];
  const recentErrors = logs.filter((l) => l[3] === 'ERROR' || l[3] === 'CRITICAL');
  const lastThree = recentErrors.slice(0, 3);
  const lastTimestamp = lastThree.length > 0 ? lastThree[0][0] : '';
  return {
    messages: lastThree.map((l) => (l[4] || '').substring(0, 120)),
    lastTimestamp,
    count: recentErrors.length,
  };
}

function getNearLiquidationDetail(alert: DetectedAlert) {
  const pairMatch = alert.message.match(/^(.+?):\s*([\d.]+)% away$/);
  if (!pairMatch) return null;
  const pair = pairMatch[1];
  const distancePct = parseFloat(pairMatch[2]);
  const trade = openTrades.value.find((t) => t.pair === pair);
  if (!trade) return { pair, distancePct, currentPrice: 0, liqPrice: 0 };
  const currentPrice = trade.open_rate * (1 + (trade.profit_ratio ?? 0));
  return { pair, distancePct, currentPrice, liqPrice: trade.liquidation_price ?? 0 };
}

function getAllFundsExposedDetail() {
  const bal = state.value?.balance ?? 0;
  const totalStake = openTrades.value.reduce((sum, t) => sum + (t.stake_amount ?? 0), 0);
  const free = Math.max(0, bal - totalStake);
  const pct = bal > 0 ? (totalStake / bal) * 100 : 0;
  return { totalStake, free, bal, pct };
}

function getBotOfflineDetail() {
  const lastSeen = store.value?.lastSeenOnline ?? 0;
  const now = Date.now();
  const offlineDuration = lastSeen > 0 ? now - lastSeen : 0;
  return { lastSeen, offlineDuration };
}

function getHighDrawdownDetail() {
  const currentDD = profit.value?.current_drawdown ?? 0;
  const peakValue = balance.value?.total_bot ?? balance.value?.total ?? 0;
  const currentValue = peakValue * (1 + currentDD);
  return { drawdownPct: currentDD * 100, peakValue, currentValue };
}

/** Get the "main" profit % for a position group header */
function getPositionProfitPct(pair: string): number | null {
  const trade = getTradeForPair(pair);
  if (!trade) return null;
  return (trade.profit_ratio ?? 0) * 100;
}

function getPositionDirection(pair: string): string {
  const trade = getTradeForPair(pair);
  if (!trade) return '';
  return trade.is_short ? 'S' : 'L';
}

function getPositionLeverage(pair: string): number {
  const trade = getTradeForPair(pair);
  return trade?.leverage ?? 1;
}

function getPositionIsShort(pair: string): boolean {
  const trade = getTradeForPair(pair);
  return trade?.is_short ?? false;
}

/** Tree connector: last item gets corner, others get tee */
function treeConnector(index: number, total: number): string {
  return index === total - 1 ? '\u2514\u2500' : '\u251C\u2500';
}
</script>

<template>
  <div
    class="alert-detail-card"
    style="
      width: 560px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      background: rgba(15, 17, 23, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    "
  >
    <!-- Severity color bar -->
    <div :style="{ height: '3px', background: severityColorMap[maxSeverity] || '#3b82f6' }" />

    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-black/10 dark:border-white/10">
      <div class="flex items-center gap-2">
        <i-mdi-robot class="text-lg opacity-70" />
        <span class="font-bold text-sm">{{ botName }}</span>
      </div>
      <span
        class="px-2 py-0.5 rounded-full text-xs font-bold"
        :style="{
          background: severityColorMap[maxSeverity] + '22',
          color: severityColorMap[maxSeverity],
        }"
      >
        {{ alerts.length }} {{ t('alertDetailCard.alert', alerts.length) }}
      </span>
    </div>

    <!-- Content -->
    <div class="max-h-[500px] overflow-y-auto p-3 flex flex-col gap-3">

      <!-- ===== POSITION GROUPS ===== -->
      <template v-if="Object.keys(groupedAlerts.positionAlerts).length > 0">
        <div
          v-for="(posAlerts, pair) in groupedAlerts.positionAlerts"
          :key="pair"
          class="rounded-lg overflow-hidden"
          :style="{
            borderLeft: `3px solid ${severityColorMap[getPositionMaxSeverity(posAlerts)]}`,
            background: 'rgba(255, 255, 255, 0.03)',
          }"
        >
          <!-- Position header -->
          <div class="flex items-center justify-between p-3">
            <div class="flex items-center gap-2">
              <span
                class="w-2 h-2 rounded-full"
                :style="{ background: severityColorMap[getPositionMaxSeverity(posAlerts)] }"
              />
              <span class="font-bold text-sm">{{ pair }}</span>
              <span
                class="px-1.5 py-0.5 rounded text-[0.85rem] font-bold"
                :class="getPositionIsShort(String(pair))
                  ? 'bg-red-500/20 text-red-300'
                  : 'bg-green-500/20 text-green-300'"
              >
                {{ getPositionDirection(String(pair)) }}
              </span>
              <span
                v-if="getPositionLeverage(String(pair)) > 1"
                class="text-[0.85rem] opacity-50"
              >
                {{ getPositionLeverage(String(pair)) }}x
              </span>
            </div>
            <span
              v-if="getPositionProfitPct(String(pair)) !== null"
              class="text-lg font-black tracking-tight"
              :class="getPositionProfitPct(String(pair))! < 0 ? 'text-red-400' : 'text-green-400'"
            >
              {{ getPositionProfitPct(String(pair))!.toFixed(1) }}%
            </span>
          </div>

          <!-- Sub-alerts with tree connectors -->
          <div class="px-3 pb-3 space-y-1.5">
            <div
              v-for="(alert, aIdx) in posAlerts"
              :key="aIdx"
              class="flex gap-2"
            >
              <!-- Tree connector -->
              <span class="text-white/20 font-mono text-xs select-none shrink-0 leading-5">
                {{ treeConnector(aIdx, posAlerts.length) }}
              </span>

              <!-- Sub-alert content -->
              <div class="flex-1 min-w-0">
                <!-- Position Loss sub-alert -->
                <template v-if="alert.typeId === 'positionLoss'">
                  <div v-if="getPositionLossDetail(alert)" class="space-y-1">
                    <div class="flex items-center gap-1.5">
                      <i-mdi-trending-down class="text-red-400 text-sm shrink-0" />
                      <span class="text-xs opacity-70">{{ t('botComparison.alertPositionLoss') }}: {{ getPositionLossDetail(alert)!.lossPct.toFixed(1) }}%</span>
                    </div>
                    <div class="text-[0.85rem] opacity-50">
                      {{ t('alertDetailCard.entry') }}: {{ getPositionLossDetail(alert)!.entryPrice.toPrecision(5) }}
                      <span class="mx-1 text-white/30">→</span>
                      {{ t('alertDetailCard.current') }}: {{ getPositionLossDetail(alert)!.currentPrice.toPrecision(5) }}
                    </div>
                    <div class="text-[0.85rem] opacity-50">
                      {{ t('alertDetailCard.stakeAtRisk') }}: {{ getPositionLossDetail(alert)!.stakeAtRisk.toFixed(2) }} USDC
                    </div>
                    <div class="text-[0.85rem] font-bold text-amber-300">
                      {{ t('alertDetailCard.ifClosedNow') }}: → {{ getPositionLossDetail(alert)!.exitValue.toFixed(2) }} USDC
                    </div>
                  </div>
                </template>

                <!-- Position Stuck sub-alert -->
                <template v-else-if="alert.typeId === 'positionStuck'">
                  <div v-if="getPositionStuckDetail(alert)" class="space-y-1">
                    <div class="flex items-center gap-1.5">
                      <i-mdi-timer-sand class="text-amber-400 text-sm shrink-0" />
                      <span class="text-xs opacity-70">{{ t('botComparison.alertPositionStuck') }}: {{ getPositionStuckDetail(alert)!.heldHours }}h</span>
                    </div>
                    <div class="text-[0.85rem] opacity-50">
                      {{ t('alertDetailCard.heldFor') }} {{ getPositionStuckDetail(alert)!.heldHours }}h
                      ({{ t('alertDetailCard.avgDuration') }}: {{ getPositionStuckDetail(alert)!.avgHours }}h)
                    </div>
                  </div>
                </template>

                <!-- Near Liquidation sub-alert -->
                <template v-else-if="alert.typeId === 'nearLiquidation'">
                  <div v-if="getNearLiquidationDetail(alert)" class="space-y-1">
                    <div class="flex items-center gap-1.5">
                      <i-mdi-skull-crossbones class="text-red-500 text-sm shrink-0" />
                      <span class="text-xs opacity-70">{{ t('botComparison.alertNearLiquidation') }}: {{ getNearLiquidationDetail(alert)!.distancePct.toFixed(1) }}% {{ t('alertDetailCard.remaining') }}</span>
                    </div>
                    <div class="text-[0.85rem] opacity-50">
                      {{ t('alertDetail.currentPrice') }}: {{ getNearLiquidationDetail(alert)!.currentPrice.toPrecision(5) }}
                      <span class="mx-1 text-white/30">→</span>
                      {{ t('alertDetail.liqPrice') }}: {{ getNearLiquidationDetail(alert)!.liqPrice.toPrecision(5) }}
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== GENERAL ALERTS ===== -->
      <template v-if="groupedAlerts.generalAlerts.length > 0">
        <!-- Divider if there were position alerts -->
        <div
          v-if="Object.keys(groupedAlerts.positionAlerts).length > 0"
          class="flex items-center gap-2 opacity-40"
        >
          <div class="flex-1 h-px bg-white/20" />
          <span class="text-[0.8rem] uppercase tracking-wider whitespace-nowrap">{{ t('alertDetailCard.generalAlerts') }}</span>
          <div class="flex-1 h-px bg-white/20" />
        </div>

        <div
          v-for="(alert, idx) in groupedAlerts.generalAlerts"
          :key="'g-' + idx"
          class="rounded-lg p-3"
          :style="{
            borderLeft: `3px solid ${severityColorMap[alert.severity]}`,
            background: 'rgba(255, 255, 255, 0.03)',
          }"
        >
          <!-- Log Errors -->
          <template v-if="alert.typeId === 'logErrors' || alert.typeId === 'orderFailed' || alert.typeId === 'exchangeError' || alert.typeId === 'walletMismatch' || alert.typeId === 'insufficientFunds'">
            <div class="space-y-2">
              <div class="flex items-center gap-1.5">
                <i-mdi-alert-octagon class="text-red-400" />
                <span class="text-xs font-medium opacity-60">{{ alert.message }}</span>
              </div>
              <div v-if="alert.typeId === 'logErrors'" class="space-y-1">
                <div
                  v-for="(msg, mi) in getLogErrorsDetail(alert).messages"
                  :key="mi"
                  class="text-[0.85rem] px-2 py-1 rounded bg-white/5 truncate max-w-[380px]"
                >
                  {{ msg }}
                </div>
                <div class="text-[0.8rem] opacity-30 mt-1">
                  {{ t('alertDetail.lastError') }}: {{ getLogErrorsDetail(alert).lastTimestamp }}
                </div>
              </div>
              <div v-else-if="alert.details" class="text-[0.85rem] px-2 py-1 rounded bg-white/5 truncate max-w-[380px]">
                {{ alert.details }}
              </div>
              <button
                class="text-[0.8rem] text-blue-400 hover:text-blue-300 cursor-pointer mt-0.5"
                @click.stop="goToLogs(alert.details ? alert.details.split(' | ')[0]?.slice(0, 60) : 'ERROR')"
              >{{ t('alertDetail.viewLogs') }} →</button>
            </div>
          </template>

          <!-- All Funds Exposed -->
          <template v-else-if="alert.typeId === 'allFundsExposed'">
            <div class="space-y-2">
              <div class="flex items-center gap-1.5">
                <i-mdi-cash-lock class="text-amber-400" />
                <span class="text-xs font-medium opacity-60">{{ t('botComparison.alertAllFundsExposed') }}</span>
              </div>
              <div class="flex items-center gap-4">
                <div class="relative w-14 h-14">
                  <svg viewBox="0 0 36 36" class="w-14 h-14 -rotate-90">
                    <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="3" />
                    <circle
                      cx="18" cy="18" r="15" fill="none"
                      stroke="#f59e0b" stroke-width="3"
                      :stroke-dasharray="`${getAllFundsExposedDetail().pct * 0.942} 94.2`"
                      stroke-linecap="round"
                    />
                  </svg>
                  <div class="absolute inset-0 flex items-center justify-center text-xs font-bold">
                    {{ getAllFundsExposedDetail().pct.toFixed(0) }}%
                  </div>
                </div>
                <div class="space-y-1 text-xs">
                  <div><span class="opacity-50">{{ t('alertDetail.locked') }}:</span> {{ getAllFundsExposedDetail().totalStake.toFixed(2) }}</div>
                  <div><span class="opacity-50">{{ t('alertDetail.free') }}:</span> {{ getAllFundsExposedDetail().free.toFixed(2) }}</div>
                </div>
              </div>
            </div>
          </template>

          <!-- Bot Offline -->
          <template v-else-if="alert.typeId === 'botOffline'">
            <div class="space-y-2 text-center py-2">
              <i-mdi-robot-off class="text-4xl text-red-500 mx-auto" />
              <div class="text-sm font-bold text-red-400">{{ t('botComparison.alertBotOffline') }}</div>
              <div v-if="getBotOfflineDetail().lastSeen > 0" class="text-xs opacity-50">
                {{ t('alertDetail.lastSeen') }}: {{ new Date(getBotOfflineDetail().lastSeen).toLocaleString() }}
              </div>
              <div v-if="getBotOfflineDetail().offlineDuration > 0" class="text-xs opacity-40">
                {{ t('alertDetail.offlineFor') }} {{ formatDuration(getBotOfflineDetail().offlineDuration) }}
              </div>
            </div>
          </template>

          <!-- High Drawdown -->
          <template v-else-if="alert.typeId === 'highDrawdown'">
            <div class="space-y-2">
              <div class="flex items-center gap-1.5">
                <i-mdi-chart-line-variant class="text-amber-400" />
                <span class="text-xs font-medium opacity-60">{{ t('botComparison.alertHighDrawdown') }}</span>
              </div>
              <div class="relative h-3 bg-white/5 rounded-full overflow-hidden">
                <div
                  class="absolute h-full bg-red-500/70 rounded-full"
                  :style="{ width: Math.min(100, Math.abs(getHighDrawdownDetail().drawdownPct) * 2) + '%' }"
                />
              </div>
              <div class="text-xl font-bold text-red-400 text-center">
                {{ getHighDrawdownDetail().drawdownPct.toFixed(1) }}%
              </div>
              <div class="flex justify-between text-xs">
                <div>
                  <div class="opacity-40 text-[0.8rem]">{{ t('alertDetail.peakValue') }}</div>
                  <div>{{ getHighDrawdownDetail().peakValue.toFixed(2) }}</div>
                </div>
                <div class="text-right">
                  <div class="opacity-40 text-[0.8rem]">{{ t('alertDetail.currentValue') }}</div>
                  <div class="text-red-400">{{ getHighDrawdownDetail().currentValue.toFixed(2) }}</div>
                </div>
              </div>
            </div>
          </template>

          <!-- Generic fallback -->
          <template v-else>
            <div class="space-y-1">
              <div class="flex items-center gap-1.5">
                <i-mdi-alert-octagon v-if="alert.severity === 'critical'" class="text-red-500" />
                <i-mdi-alert v-else-if="alert.severity === 'warning'" class="text-amber-400" />
                <i-mdi-information v-else class="text-blue-400" />
                <span class="text-xs font-medium">{{ alert.message }}</span>
              </div>
              <div v-if="alert.details" class="text-[0.85rem] opacity-50 truncate max-w-[380px]">
                {{ alert.details }}
              </div>
            </div>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>
