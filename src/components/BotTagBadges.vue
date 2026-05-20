<script setup lang="ts">
/**
 * BotTagBadges — compact status/metadata badges for a single bot.
 * Reads everything from the bot stores given a botId, so it can be dropped into
 * any bot list (Available bots, comparison table, popovers) and stay consistent.
 */
import { getExchangeStyle, capitalizeExchange, getCurrencyStyle } from '@/utils/botPresentation';

type TagKind = 'status' | 'tradingMode' | 'exchange' | 'stakeCurrency';

const props = withDefaults(
  defineProps<{
    botId: string;
    show?: TagKind[];
  }>(),
  {
    show: () => ['status', 'tradingMode', 'exchange'],
  },
);

const botStore = useBotStore();

const sub = computed(() => botStore.botStores[props.botId]);
const state = computed(() => botStore.allBotState[props.botId]);

const isOnline = computed(() => sub.value?.isBotOnline ?? false);
const isStarting = computed(() => sub.value?.isBotStarting ?? false);
const isDryRun = computed(() => state.value?.dry_run);
const tradingMode = computed(() => (state.value?.trading_mode as string) || '');
const exchange = computed(() => state.value?.exchange || '');
const stakeCurrency = computed(() => state.value?.stake_currency || '');

function wants(kind: TagKind): boolean {
  return props.show.includes(kind);
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <!-- Status: Starting / Dry / Live / Offline -->
    <template v-if="wants('status')">
      <Badge
        v-if="isStarting"
        class="text-[0.65rem] font-bold animate-pulse"
        style="padding: 1px 6px; line-height: 1.3"
        severity="info"
        >{{ $t('general.starting') }}</Badge
      >
      <Badge
        v-else-if="isOnline && isDryRun"
        class="text-[0.65rem] font-bold"
        style="padding: 1px 6px; line-height: 1.3"
        severity="success"
        :title="$t('botList.dryTooltip')"
        >{{ $t('botList.dry') }}</Badge
      >
      <Badge
        v-else-if="isOnline && !isDryRun"
        class="text-[0.65rem] font-bold"
        style="padding: 1px 6px; line-height: 1.3"
        severity="warning"
        :title="$t('botList.liveTooltip')"
        >{{ $t('botList.live') }}</Badge
      >
      <Badge
        v-else
        class="text-[0.65rem] font-bold"
        style="padding: 1px 6px; line-height: 1.3"
        severity="secondary"
        >{{ $t('botComparison.offline') }}</Badge
      >
    </template>

    <!-- Trading mode: Spot / Futures -->
    <span
      v-if="wants('tradingMode') && tradingMode"
      class="inline-flex items-center rounded-sm text-[0.65rem] font-bold"
      style="padding: 1px 6px; line-height: 1.3"
      :style="
        tradingMode === 'futures'
          ? { background: '#1a1a2e', color: '#e94560' }
          : { background: '#1a2e1a', color: '#4ade80' }
      "
      :title="tradingMode === 'futures' ? $t('botList.futuresTooltip') : $t('botList.spotTooltip')"
      >{{ tradingMode === 'futures' ? 'Futures' : 'Spot' }}</span
    >

    <!-- Exchange -->
    <span
      v-if="wants('exchange') && exchange"
      class="inline-flex items-center rounded-sm text-[0.65rem] font-bold"
      style="padding: 1px 6px; line-height: 1.3"
      :style="getExchangeStyle(exchange)"
      >{{ capitalizeExchange(exchange) }}</span
    >

    <!-- Stake currency -->
    <span
      v-if="wants('stakeCurrency') && stakeCurrency"
      class="inline-flex items-center rounded-sm text-[0.65rem] font-bold"
      style="padding: 1px 6px; line-height: 1.3"
      :style="
        getCurrencyStyle(stakeCurrency) ?? {
          background: 'var(--p-surface-700)',
          color: 'var(--p-surface-200)',
        }
      "
      >{{ stakeCurrency }}</span
    >
  </div>
</template>
