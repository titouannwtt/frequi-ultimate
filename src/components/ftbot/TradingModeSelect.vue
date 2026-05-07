<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { TradingModeFilter } from '@/composables/useTradingModeFilter';

const { t } = useI18n();

const model = defineModel<TradingModeFilter>({ required: true });

defineProps<{
  show?: boolean;
}>();
</script>

<template>
  <select
    v-if="show"
    v-model="model"
    class="rounded-lg px-2 py-1 text-xs text-surface-200 cursor-pointer"
    style="
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      outline: none;
    "
  >
    <option value="all">{{ t('tradingModeFilter.allModes') }}</option>
    <option value="live">{{ t('tradingModeFilter.liveOnly') }}</option>
    <option value="dry">{{ t('tradingModeFilter.dryOnly') }}</option>
  </select>
</template>
