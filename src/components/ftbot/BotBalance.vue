<script setup lang="ts">
import type { BalanceValues } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();
const hideSmallBalances = ref(true);
const showBotOnly = ref(true);

const smallBalance = computed<number>(() => {
  return Number((1.1 ** botStore.activeBot.stakeCurrencyDecimals).toFixed(8));
});

const canUseBotBalance = computed(() => {
  return botStore.activeBot.botFeatures.hasBotBalance;
});

const balanceCurrencies = computed(() => {
  return botStore.activeBot.balance.currencies?.filter(
    (v) =>
      (!hideSmallBalances.value || v.est_stake >= smallBalance.value) &&
      (!canUseBotBalance.value || !showBotOnly.value || (v.is_bot_managed ?? true) === true),
  );
});

const formatCurrency = (value) => {
  return value ? formatPrice(value, botStore.activeBot.stakeCurrencyDecimals) : '';
};

const chartValues = computed<BalanceValues[]>(() => {
  return balanceCurrencies.value?.map((v) => {
    return {
      balance:
        showBotOnly.value && canUseBotBalance.value && v.bot_owned != undefined
          ? v.bot_owned
          : v.is_position === true
            ? v.position
            : v.balance,
      currency: v.currency,
      est_stake:
        showBotOnly.value && canUseBotBalance.value
          ? (v.est_stake_bot ?? v.est_stake)
          : v.est_stake,
      free: showBotOnly.value && canUseBotBalance.value ? (v.bot_owned ?? v.free) : v.free,
      used: v.used,
      stake: v.stake,
    };
  });
});

const tableFields = computed(() => {
  return [
    { field: 'currency', header: t('balance.currency') },
    {
      field: showBotOnly.value && canUseBotBalance.value ? 'bot_owned' : 'free',
      header: t('balance.available'),
      asCurrency: true,
    },
    {
      field: showBotOnly.value && canUseBotBalance.value ? 'est_stake_bot' : 'est_stake',
      header: `${t('balance.in')} ${botStore.activeBot.balance.stake}`,
      asCurrency: true,
    },
  ];
});

async function refreshBalance() {
  botStore.activeBot.getBalance();
}

onMounted(() => {
  refreshBalance();
});
</script>

<script lang="ts">
function balanceValueBgClass(val: number): string {
  if (val > 100) return 'bg-green-500/15';
  if (val > 10) return 'bg-green-500/10';
  if (val > 0) return 'bg-green-500/5';
  return 'bg-surface-500/10';
}
</script>

<template>
  <div>
    <div class="flex flex-wrap flex-row mb-2 justify-end items-center">
      <label class="text-xl ms-1 me-auto mb-0">{{ t('balance.title') }}</label>
      <div class="flex flex-row gap-1">
        <Button
          v-if="canUseBotBalance"
          severity="secondary"
          :tooltip="!showBotOnly ? t('balance.showingAccount') : t('balance.showingBot')"
          @click="showBotOnly = !showBotOnly"
        >
          <template #icon>
            <i-mdi-robot v-if="showBotOnly" />
            <i-mdi-bank v-else />
          </template>
        </Button>
        <Button
          severity="secondary"
          :tooltip="!hideSmallBalances ? t('balance.hideSmall') : t('balance.showAll')"
          @click="hideSmallBalances = !hideSmallBalances"
        >
          <template #icon>
            <i-mdi-eye-off v-if="hideSmallBalances" />
            <i-mdi-eye v-else />
          </template>
        </Button>
        <Button severity="secondary" @click="refreshBalance">
          <template #icon>
            <i-mdi-refresh />
          </template>
        </Button>
      </div>
    </div>
    <BalanceChart v-if="balanceCurrencies" :currencies="chartValues" />
    <div>
      <p v-if="botStore.activeBot.balance.note">
        <strong>{{ botStore.activeBot.balance.note }}</strong>
      </p>
      <DataTable size="small" :value="balanceCurrencies" scrollable scroll-height="flex" footer>
        <Column field="currency" :header="t('balance.currency')" sortable>
          <template #body="{ data }">
            <span class="font-semibold text-xs">{{ data.currency }}</span>
          </template>
        </Column>
        <Column
          :field="showBotOnly && canUseBotBalance ? 'bot_owned' : 'free'"
          :header="t('balance.available')"
          sortable
        >
          <template #body="{ data }">
            <span class="font-mono text-xs">
              {{ formatCurrency(data[showBotOnly && canUseBotBalance ? 'bot_owned' : 'free']) }}
            </span>
          </template>
        </Column>
        <Column
          :field="showBotOnly && canUseBotBalance ? 'est_stake_bot' : 'est_stake'"
          :header="`${t('balance.in')} ${botStore.activeBot.balance.stake}`"
          sortable
        >
          <template #body="{ data }">
            <span
              class="inline-block px-1.5 py-0.5 rounded text-xs font-mono font-semibold"
              :class="
                balanceValueBgClass(
                  data[showBotOnly && canUseBotBalance ? 'est_stake_bot' : 'est_stake'],
                )
              "
            >
              {{
                formatCurrency(
                  data[showBotOnly && canUseBotBalance ? 'est_stake_bot' : 'est_stake'],
                )
              }}
            </span>
          </template>
        </Column>
        <ColumnGroup type="footer">
          <Row>
            <Column :footer="t('balance.total')" />
            <Column>
              <template #footer>
                <span
                  class="inline-block px-1.5 py-0.5 rounded text-xs font-mono font-semibold"
                  :class="
                    botStore.activeBot.balance.starting_capital_ratio >= 0
                      ? 'bg-green-500/15 text-green-400'
                      : 'bg-red-500/15 text-red-400'
                  "
                  :title="`${t('balance.increaseOverCapital')} ${formatCurrency(
                    botStore.activeBot.balance.starting_capital,
                  )} ${botStore.activeBot.balance.stake}`"
                >
                  {{ botStore.activeBot.balance.starting_capital_ratio >= 0 ? '+' : ''
                  }}{{ formatPercent(botStore.activeBot.balance.starting_capital_ratio) }}
                </span>
              </template>
            </Column>
            <Column>
              <template #footer>
                <span class="font-mono text-xs font-bold">
                  {{
                    showBotOnly && canUseBotBalance
                      ? formatCurrency(botStore.activeBot.balance.total_bot)
                      : formatCurrency(botStore.activeBot.balance.total)
                  }}
                </span>
              </template>
            </Column>
          </Row>
        </ColumnGroup>
      </DataTable>
    </div>
  </div>
</template>
