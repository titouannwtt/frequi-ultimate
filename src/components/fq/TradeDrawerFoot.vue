<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { SegmentedControl } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import type { Position } from '@/gateway/types.gen';

import BotActionBar from './BotActionBar.vue';
import { MIN_NOTIONAL } from './lib/dialog';
import type { ActionId } from './lib/actions';

/**
 * Sticky foot of the trade drawer: the share to exit (25, 50, 100 %), the notional it represents
 * and the minimum, then "Exit at market..." and "Add to position...". The share only pre-selects
 * the quantity in the confirmation: nothing is sent from here.
 */
const props = defineProps<{ position: Position; modelValue: number }>();
const emit = defineEmits<{
  'update:modelValue': [value: number];
  navigate: [id: ActionId];
}>();

const { t } = useI18n();
const fmt = useFormat();

const options = computed(() => [
  { value: 0.25, label: '25 %' },
  { value: 0.5, label: '50 %' },
  { value: 1, label: '100 %' },
]);
const notional = computed(() => props.position.notional * props.modelValue);
const tooSmall = computed(() => props.modelValue < 1 && notional.value < MIN_NOTIONAL);
</script>

<template>
  <div class="foot">
    <div v-if="!position.orphan" class="qty">
      <SegmentedControl
        :options="options"
        :model-value="modelValue"
        size="sm"
        :label="t('fq.dialog.quantity')"
        @update:model-value="(v: number) => emit('update:modelValue', v)"
      />
      <span class="amt num" :class="{ warn: tooSmall }">{{ fmt.number(notional, 2) }} USDC</span>
      <span class="min">{{ t('fq.drawer.minNotional', { min: MIN_NOTIONAL }) }}</span>
    </div>
    <BotActionBar
      context="drawer"
      :bot-key="position.bot_key"
      :position="position"
      :fraction="modelValue"
      @navigate="(id) => emit('navigate', id)"
    />
  </div>
</template>

<style scoped>
.foot {
  display: grid;
  gap: var(--s2);
}
.qty {
  display: flex;
  align-items: center;
  gap: var(--s3);
  flex-wrap: wrap;
}
.amt {
  font-weight: 600;
}
.amt.warn {
  color: var(--warn);
}
.min {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
</style>
