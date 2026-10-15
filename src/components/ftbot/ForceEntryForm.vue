<script setup lang="ts">
import { resolveTargetBot } from '@/utils/targetBot';
import type { ForceEnterPayload } from '@/types';
import { OrderSides } from '@/types';
import { useI18n } from 'vue-i18n';

const props = withDefaults(
  defineProps<{
    pair?: string;
    positionIncrease?: boolean;
    /** Bot receiving the order. Defaults to the active bot; multi-bot views must pass it. */
    botId?: string;
    /** Side of the position being increased, so the order never flips it. */
    side?: OrderSides;
  }>(),
  {
    pair: '',
    positionIncrease: false,
    botId: undefined,
    side: undefined,
  },
);
const model = defineModel<boolean>();
const { t } = useI18n();
const botStore = useBotStore();
const targetBot = computed(() =>
  resolveTargetBot(botStore.botStores, props.botId, botStore.activeBot),
);
const submitting = ref(false);

const form = ref<HTMLFormElement>();
const selectedPair = ref('');
const price = ref<number | undefined>(undefined);
const stakeAmount = ref<number | undefined>(undefined);
const leverage = ref<number | undefined>(undefined);

const ordertype = ref('');
const orderSide = ref<OrderSides>(OrderSides.long);
const enterTag = ref('force_entry');

const orderTypeOptions = computed(() => [
  { value: 'market', text: t('forceEntry.market') },
  { value: 'limit', text: t('forceEntry.limit') },
]);
const orderSideOptions = [
  { value: 'long', text: 'Long' },
  { value: 'short', text: 'Short' },
];

const checkFormValidity = () => {
  const valid = form.value?.checkValidity();

  return valid;
};

const handleSubmit = async () => {
  // Exit when the form isn't valid
  if (!checkFormValidity() || submitting.value) {
    return;
  }
  submitting.value = true;

  // call forceentry
  const payload: ForceEnterPayload = { pair: selectedPair.value };
  if (price.value) {
    payload.price = Number(price.value);
  }
  if (ordertype.value) {
    payload.ordertype = ordertype.value;
  }
  if (stakeAmount.value) {
    payload.stakeamount = stakeAmount.value;
  }
  if (targetBot.value.botFeatures.forceEnterShort && targetBot.value.shortAllowed) {
    payload.side = orderSide.value;
  }
  if (targetBot.value.botFeatures.forceEntryTag && enterTag.value) {
    payload.entry_tag = enterTag.value;
  }

  if (leverage.value) {
    payload.leverage = leverage.value;
  }
  try {
    await targetBot.value.forceentry(payload);
  } finally {
    submitting.value = false;
  }
  await nextTick();
  model.value = false;
};
const resetForm = () => {
  console.log('resetForm');
  selectedPair.value = props.pair;
  price.value = undefined;
  stakeAmount.value = undefined;
  if (props.side) {
    orderSide.value = props.side;
  }
  ordertype.value =
    targetBot.value.botState?.order_types?.forcebuy ||
    targetBot.value.botState?.order_types?.force_entry ||
    targetBot.value.botState?.order_types?.buy ||
    targetBot.value.botState?.order_types?.entry ||
    'limit';
};

const handleEntry = () => {
  // Trigger submit handler
  handleSubmit();
};
</script>

<template>
  <Dialog
    v-model:visible="model"
    :header="
      positionIncrease ? t('forceEntry.increasingPosition', { pair }) : t('forceEntry.title')
    "
    modal
    @show="resetForm"
    @hide="resetForm"
  >
    <form ref="form" class="space-y-4 md:min-w-[32rem]" @submit.prevent="handleSubmit">
      <div v-if="targetBot.botFeatures.forceEnterShort && targetBot.shortAllowed">
        <label class="block font-medium mb-1">{{ t('forceEntry.orderDirection') }}</label>
        <SelectButton
          v-model="orderSide"
          :options="orderSideOptions"
          :allow-empty="false"
          option-label="text"
          option-value="value"
          size="small"
          class="w-full"
        />
      </div>

      <div>
        <label for="pair-input" class="block font-medium mb-1">{{ t('forceEntry.pair') }}</label>
        <InputText
          id="pair-input"
          v-model="selectedPair"
          :disabled="positionIncrease"
          required
          class="w-full"
          @keydown.enter="handleEntry"
          @focus="($event.target as HTMLInputElement).select()"
        />
      </div>

      <div>
        <label for="price-input" class="block font-medium mb-1">{{ t('forceEntry.price') }}</label>
        <InputNumber
          id="price-input"
          v-model="price"
          show-buttons
          :min="0"
          :max-fraction-digits="8"
          :step="0.1"
          class="w-full"
          @keydown.enter="handleEntry"
        />
      </div>

      <div>
        <label for="stake-input" class="block font-medium mb-1"
          >* {{ t('forceEntry.stakeAmount', { stake: targetBot.stakeCurrency }) }}</label
        >
        <InputNumber
          id="stake-input"
          v-model="stakeAmount"
          show-buttons
          :min="0"
          :step="targetBot.stakeCurrency === 'USDT' ? 10 : 1"
          :max-fraction-digits="5"
          fluid
        />
      </div>

      <div v-if="targetBot.botFeatures.forceEnterShort && targetBot.shortAllowed">
        <label for="leverage-input" class="block font-medium mb-1">{{
          t('forceEntry.leverage')
        }}</label>
        <InputNumber
          id="leverage-input"
          v-model="leverage"
          show-buttons
          :min="0"
          :step="1"
          :max-fraction-digits="1"
          class="w-full"
          @keydown.enter="handleEntry"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">{{ t('forceEntry.orderType') }}</label>
        <SelectButton
          v-model="ordertype"
          :options="orderTypeOptions"
          option-label="text"
          option-value="value"
          size="small"
          class="w-full"
        />
      </div>

      <div v-if="targetBot.botFeatures.forceEntryTag">
        <label for="enterTag-input" class="block text-sm font-medium mb-1"
          >* {{ t('forceEntry.entryTag') }}</label
        >
        <InputText id="enterTag-input" v-model="enterTag" class="w-full" />
      </div>
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button severity="secondary" size="small" @click="model = false">
          {{ t('forceEntry.cancel') }}
        </Button>
        <Button severity="primary" size="small" @click="handleEntry">
          {{ t('forceEntry.enterPosition') }}
        </Button>
      </div>
    </template>
  </Dialog>
</template>
