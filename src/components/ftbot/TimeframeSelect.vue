<script setup lang="ts">
import { useI18n } from 'vue-i18n';

interface Props {
  value?: string;
  belowTimeframe?: string;
  size?: undefined | 'small' | 'large';
}

const props = withDefaults(defineProps<Props>(), {
  value: '',
  belowTimeframe: '',
  size: undefined,
});
const emit = defineEmits<{ input: [value: string] }>();

const { t } = useI18n();
const selectedTimeframe = ref('');
// The below list must always remain sorted correctly!
const availableTimeframesBase = computed(() => [
  // Placeholder value
  { value: '', text: t('backtest.useStrategyDefault') },
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
  '3d',
  '1w',
  '2w',
  '1M',
  '1y',
]);

const availableTimeframes = computed(() => {
  if (!props.belowTimeframe) {
    return availableTimeframesBase.value;
  }
  const idx = availableTimeframesBase.value.findIndex((v) => v === props.belowTimeframe);

  return [...availableTimeframesBase.value].splice(0, idx);
});

const emitSelectedTimeframe = () => {
  emit('input', selectedTimeframe.value);
};
</script>

<template>
  <Select
    v-model="selectedTimeframe"
    :placeholder="t('backtest.useStrategyDefault')"
    :option-label="(option) => option.text || option"
    :option-value="(option) => option.value ?? option"
    :size="size"
    :options="availableTimeframes"
    @change="emitSelectedTimeframe"
  ></Select>
</template>
