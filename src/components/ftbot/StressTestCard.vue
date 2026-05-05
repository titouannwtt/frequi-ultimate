<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();

// Slider: -50% to +50% (crash or pump)
const scenarioPercent = ref(-20);

interface PositionResult {
  pair: string;
  isShort: boolean;
  currentProfit: number;
  stakeAmount: number;
  leverage: number;
  // Impact of the scenario on this position
  scenarioImpact: number; // positive = gain, negative = loss
  isLiquidated: boolean;
  // Capped impact (if liquidated, loss is capped at stake)
  cappedImpact: number;
}

interface StressResult {
  botId: string;
  botName: string;
  positions: PositionResult[];
  totalImpact: number;
}

const stressResults = computed((): StressResult[] => {
  const results: StressResult[] = [];
  const scenarioRatio = scenarioPercent.value / 100; // e.g., -0.20 for -20%

  for (const [botId, botSubStore] of Object.entries(botStore.botStores)) {
    if (!botSubStore.isSelected) continue;
    const openTrades = botSubStore.openTrades || [];
    if (openTrades.length === 0) continue;

    const positions = openTrades.map((trade): PositionResult => {
      const leverage = trade.leverage ?? 1;
      const stakeAmount = trade.stake_amount ?? 0;
      const isShort = trade.is_short ?? false;

      // For longs: market crash (-%) = loss, market pump (+%) = gain
      // For shorts: market crash (-%) = gain, market pump (+%) = gain for shorts is negative scenario
      // Direction multiplier: long = +1, short = -1
      const direction = isShort ? -1 : 1;

      // Raw impact on margin: stake * leverage * scenario% * direction
      // Positive = this position gains, Negative = this position loses
      const rawImpact = stakeAmount * leverage * scenarioRatio * direction;

      // Liquidation: position is liquidated when loss exceeds margin (stake)
      // Loss = -rawImpact when rawImpact is negative
      const isLiquidated = rawImpact < 0 && Math.abs(rawImpact) >= stakeAmount;

      // Cap the loss at the stake amount (you can't lose more than your margin in isolated)
      let cappedImpact = rawImpact;
      if (isLiquidated) {
        cappedImpact = -stakeAmount; // Total loss of margin
      }

      return {
        pair: trade.pair,
        isShort,
        currentProfit: trade.profit_abs ?? 0,
        stakeAmount,
        leverage,
        scenarioImpact: rawImpact,
        isLiquidated,
        cappedImpact,
      };
    });

    const totalImpact = positions.reduce((sum, p) => sum + p.cappedImpact, 0);

    results.push({
      botId,
      botName: botSubStore.uiBotName,
      positions,
      totalImpact,
    });
  }

  return results;
});

const totalImpact = computed(() => {
  return stressResults.value.reduce((sum, r) => sum + r.totalImpact, 0);
});

const liquidationCount = computed(() => {
  return stressResults.value.reduce(
    (sum, r) => sum + r.positions.filter((p) => p.isLiquidated).length,
    0,
  );
});

const isPositiveImpact = computed(() => totalImpact.value >= 0);

const stakeCurrency = computed(() => {
  return botStore.activeBot?.stakeCurrency || 'USDC';
});
</script>

<template>
  <div class="p-2 space-y-2 h-full overflow-y-auto text-xs">
    <!-- Header with total impact -->
    <div
      class="rounded-lg p-2 text-center"
      :style="{
        background: isPositiveImpact ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        border: `1px solid ${isPositiveImpact ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
      }"
    >
      <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">
        {{ t('stressTest.estimatedImpact') }}
        <span v-if="scenarioPercent !== 0" class="normal-case">
          ({{ scenarioPercent < 0 ? t('stressTest.crashOf', { pct: Math.abs(scenarioPercent) }) : t('stressTest.pumpOf', { pct: scenarioPercent }) }})
        </span>
      </div>
      <div
        class="text-2xl font-bold"
        :class="isPositiveImpact ? 'text-green-500' : 'text-red-500'"
      >
        {{ totalImpact >= 0 ? '+' : '' }}{{ totalImpact.toFixed(2) }} {{ stakeCurrency }}
      </div>
      <div v-if="liquidationCount > 0" class="mt-1 text-amber-400 text-sm font-semibold">
        ⚠ {{ t('stressTest.liquidationWarning', { count: liquidationCount }) }}
      </div>
    </div>

    <!-- Slider: -50% to +50% -->
    <div>
      <div class="flex justify-between text-xs text-gray-400 mb-1">
        <span>{{ t('stressTest.crashScenario') }}</span>
        <span
          class="font-bold"
          :class="scenarioPercent >= 0 ? 'text-green-400' : 'text-red-400'"
        >{{ scenarioPercent >= 0 ? '+' : '' }}{{ scenarioPercent }}%</span>
      </div>
      <input
        v-model.number="scenarioPercent"
        type="range"
        :min="-50"
        :max="50"
        :step="1"
        class="w-full accent-blue-500"
      />
      <div class="flex justify-between text-[0.55rem] text-gray-500 mt-0.5">
        <span>-50% {{ t('stressTest.crash') }}</span>
        <span>0%</span>
        <span>+50% {{ t('stressTest.pump') }}</span>
      </div>
    </div>

    <!-- No positions -->
    <div
      v-if="stressResults.length === 0"
      class="text-center text-gray-400 text-sm py-4"
    >
      {{ t('stressTest.noOpenPositions') }}
    </div>

    <!-- Per-bot results -->
    <div v-for="result in stressResults" :key="result.botId" class="space-y-1">
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold text-gray-200">{{ result.botName }}</span>
        <span
          class="text-xs font-bold"
          :class="result.totalImpact >= 0 ? 'text-green-400' : 'text-red-400'"
        >{{ result.totalImpact >= 0 ? '+' : '' }}{{ result.totalImpact.toFixed(2) }} {{ stakeCurrency }}</span>
      </div>

      <div
        v-for="pos in result.positions"
        :key="pos.pair"
        class="flex items-center justify-between text-[0.65rem] px-2 py-0.5 rounded"
        :style="{
          background: pos.isLiquidated
            ? 'rgba(239, 68, 68, 0.15)'
            : pos.cappedImpact >= 0
            ? 'rgba(34, 197, 94, 0.05)'
            : 'rgba(239, 68, 68, 0.05)',
        }"
      >
        <div class="flex items-center gap-1">
          <span class="text-gray-300">{{ pos.pair.replace(/\/.*/, '') }}</span>
          <span
            class="text-[0.5rem] font-bold px-1 rounded"
            :class="pos.isShort ? 'text-red-300 bg-red-900/30' : 'text-green-300 bg-green-900/30'"
          >{{ pos.isShort ? 'S' : 'L' }}</span>
          <span v-if="pos.leverage > 1" class="text-[0.5rem] text-yellow-400">{{ pos.leverage }}x</span>
        </div>
        <div class="flex items-center gap-2">
          <span
            v-if="pos.isLiquidated"
            class="text-red-400 font-bold text-[0.6rem]"
          >💀 {{ t('stressTest.liquidation') }}</span>
          <span
            v-else
            :class="pos.cappedImpact >= 0 ? 'text-green-400' : 'text-red-400'"
          >{{ pos.cappedImpact >= 0 ? '+' : '' }}{{ pos.cappedImpact.toFixed(2) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
