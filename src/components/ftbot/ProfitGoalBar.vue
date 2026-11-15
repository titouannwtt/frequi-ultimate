<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();

interface ProfitGoal {
  amount: number;
  currency: string;
  period: 'monthly' | 'yearly';
}

const LS_KEY = 'ft_profit_goal';

const showSettings = ref(false);
const settingsPopover = ref();

function loadGoal(): ProfitGoal | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveGoal(goal: ProfitGoal) {
  localStorage.setItem(LS_KEY, JSON.stringify(goal));
}

const goal = ref<ProfitGoal>(loadGoal() || { amount: 1000, currency: 'USDC', period: 'monthly' });
const goalAmount = ref(goal.value.amount);
const goalPeriod = ref(goal.value.period);

function applyGoal() {
  goal.value = {
    amount: goalAmount.value,
    currency: goal.value.currency,
    period: goalPeriod.value,
  };
  saveGoal(goal.value);
  settingsPopover.value?.hide();
}

const periodOptions = computed(() => [
  { value: 'monthly', label: t('profitGoal.monthly') },
  { value: 'yearly', label: t('profitGoal.yearly') },
]);

// Calculate current month/year closed profit from all selected bots
const currentProfit = computed(() => {
  let total = 0;
  const now = new Date();
  const periodStart =
    goal.value.period === 'monthly'
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : new Date(now.getFullYear(), 0, 1);

  for (const botSubStore of Object.values(botStore.botStores)) {
    if (!botSubStore.isSelected) continue;
    const trades = botSubStore.trades || [];
    for (const trade of trades) {
      if (trade.close_timestamp && trade.close_timestamp * 1000 >= periodStart.getTime()) {
        total += trade.profit_abs ?? 0;
      }
    }
  }
  return total;
});

const progressPercent = computed(() => {
  if (goal.value.amount <= 0) return 0;
  return Math.min((currentProfit.value / goal.value.amount) * 100, 100);
});

// Expected progress based on time elapsed in period
const expectedPercent = computed(() => {
  const now = new Date();
  if (goal.value.period === 'monthly') {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return (now.getDate() / daysInMonth) * 100;
  } else {
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear() + 1, 0, 1);
    return ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100;
  }
});

const barColor = computed(() => {
  const ratio = progressPercent.value / expectedPercent.value;
  if (ratio >= 0.9) return 'bg-green-500';
  if (ratio >= 0.5) return 'bg-amber-500';
  return 'bg-red-500';
});

const textColor = computed(() => {
  const ratio = progressPercent.value / expectedPercent.value;
  if (ratio >= 0.9) return 'text-green-400';
  if (ratio >= 0.5) return 'text-amber-400';
  return 'text-red-400';
});

function showSettingsPopover(event: Event) {
  goalAmount.value = goal.value.amount;
  goalPeriod.value = goal.value.period;
  settingsPopover.value?.toggle(event);
}
</script>

<template>
  <div class="flex items-center gap-2 px-3 py-1.5 text-xs">
    <div class="flex items-center gap-1">
      <i-mdi-target class="text-surface-400" />
      <span class="text-surface-400">{{ t('profitGoal.title') }}:</span>
    </div>

    <!-- Progress bar -->
    <div class="flex-1 relative h-4 bg-surface-700 rounded-full overflow-hidden min-w-[120px]">
      <div
        class="h-full rounded-full transition-all duration-500"
        :class="barColor"
        :style="{ width: `${progressPercent}%` }"
      />
      <!-- Expected progress marker -->
      <div
        class="absolute top-0 h-full w-0.5 bg-surface-400 opacity-50"
        :style="{ left: `${expectedPercent}%` }"
      />
    </div>

    <!-- Text -->
    <span :class="textColor" class="font-mono whitespace-nowrap">
      {{ currentProfit.toFixed(1) }} / {{ goal.amount }}
      {{ goal.currency }}
      ({{ progressPercent.toFixed(0) }}%)
    </span>

    <!-- Settings button -->
    <button
      class="p-0.5 rounded hover:bg-surface-600 cursor-pointer"
      :title="t('profitGoal.settings')"
      @click="showSettingsPopover"
    >
      <i-mdi-cog class="text-surface-400 text-xs" />
    </button>

    <!-- Settings popover -->
    <Popover ref="settingsPopover">
      <div class="p-3 space-y-3 min-w-[220px]">
        <h4 class="text-sm font-semibold">{{ t('profitGoal.settings') }}</h4>
        <div class="space-y-1">
          <label class="text-xs text-surface-400">{{ t('profitGoal.targetAmount') }}</label>
          <InputNumber v-model="goalAmount" :min="1" :max="1000000" size="small" class="w-full" />
        </div>
        <div class="space-y-1">
          <label class="text-xs text-surface-400">{{ t('profitGoal.period') }}</label>
          <Select
            v-model="goalPeriod"
            :options="periodOptions"
            option-label="label"
            option-value="value"
            size="small"
            class="w-full"
          />
        </div>
        <Button size="small" class="w-full" @click="applyGoal">
          {{ t('profitGoal.apply') }}
        </Button>
      </div>
    </Popover>
  </div>
</template>
