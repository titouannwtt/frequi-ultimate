<script setup lang="ts">
import type { CatalogField, ConfigFieldOption } from '@/types';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  field: CatalogField;
  value: unknown;
  source: 'own' | 'inherited' | 'strategy' | 'default';
  editable: boolean;
  overrideEnabled?: boolean;
  error?: string | null;
  options?: ConfigFieldOption[];
  label?: string;
  description?: string;
  docUrl?: string;
}>();

const emit = defineEmits<{
  update: [value: unknown];
  reset: [];
  'toggle-override': [value: boolean];
}>();

const { t, te } = useI18n();

const labelText = computed(
  () => props.label ?? (te(props.field.labelKey) ? t(props.field.labelKey) : props.field.path),
);

const hasUnlimited = computed(() => props.field.unlimitedValue !== undefined);
const isUnlimited = computed(
  () => hasUnlimited.value && props.value === props.field.unlimitedValue,
);

const selectOptions = computed(() => props.options ?? props.field.options ?? []);
function optionLabel(o: ConfigFieldOption): string {
  if (o.value === '') return t('configEditor.none');
  return o.labelKey && te(o.labelKey) ? t(o.labelKey) : String(o.value);
}

const numberValue = computed({
  get: () => (typeof props.value === 'number' ? props.value : undefined),
  set: (v) => emit('update', v ?? undefined),
});
const textValue = computed({
  get: () => (props.value == null ? '' : String(props.value)),
  set: (v) => emit('update', v === '' ? undefined : v),
});
const boolValue = computed({
  get: () => props.value === true,
  set: (v) => emit('update', v),
});
const selectValue = computed({
  get: () => props.value ?? null,
  set: (v) => emit('update', v),
});

function setUnlimited(on: boolean) {
  emit('update', on ? props.field.unlimitedValue : (props.field.min ?? 0));
}

const sourceBadge = computed(() => {
  switch (props.source) {
    case 'own':
      return { text: t('configEditor.source.own'), cls: 'bg-primary-500/15 text-primary-300' };
    case 'strategy':
      return { text: t('configEditor.source.strategy'), cls: 'bg-purple-500/15 text-purple-300' };
    case 'inherited':
      return {
        text: t('configEditor.source.inherited'),
        cls: 'bg-surface-500/15 text-surface-400',
      };
    default:
      return { text: t('configEditor.source.default'), cls: 'bg-surface-500/10 text-surface-500' };
  }
});

const inputDisabled = computed(() => !props.editable);
</script>

<template>
  <div
    class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] gap-x-4 gap-y-1 py-2 border-b border-surface-200/60 dark:border-surface-700/60"
  >
    <!-- Label column -->
    <div class="flex flex-col justify-center min-w-0">
      <div class="flex items-center gap-1.5 flex-wrap">
        <i-mdi-lock
          v-if="field.locked"
          class="text-amber-400 shrink-0"
          :title="t('configEditor.lockedHint')"
        />
        <span class="text-sm font-medium truncate" :title="field.path">
          {{ labelText }}<span v-if="field.required" class="text-red-400">&nbsp;*</span>
        </span>
        <span
          class="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
          :class="sourceBadge.cls"
          >{{ sourceBadge.text }}</span
        >
        <span
          v-if="field.restartRequired"
          class="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-orange-500/15 text-orange-300 shrink-0"
          :title="t('configEditor.restartHint')"
          >{{ t('configEditor.restart') }}</span
        >
        <button
          v-if="source === 'own' && editable && !field.required"
          class="text-surface-400 hover:text-primary-400 cursor-pointer shrink-0"
          :title="t('configEditor.revert')"
          @click="emit('reset')"
        >
          <i-mdi-undo-variant class="text-xs" />
        </button>
        <a
          v-if="docUrl"
          :href="docUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-surface-400 hover:text-primary-400 cursor-pointer shrink-0"
          :title="t('configEditor.help')"
          @click.stop
        >
          <i-mdi-help-circle-outline class="text-xs" />
        </a>
      </div>
      <div class="flex items-center gap-2 mt-0.5">
        <p
          v-if="description || field.path"
          class="text-xs text-surface-400 truncate"
          :title="description || field.path"
        >
          {{ description || field.path }}
        </p>
      </div>
      <!-- strategy override opt-in -->
      <label
        v-if="field.strategySourced && !field.locked"
        class="flex items-center gap-1.5 mt-1 text-xs text-purple-300 cursor-pointer w-fit"
      >
        <ToggleSwitch
          :model-value="overrideEnabled"
          @update:model-value="(v) => emit('toggle-override', v as boolean)"
        />
        {{ t('configEditor.overrideFromConfig') }}
      </label>
    </div>

    <!-- Input column -->
    <div class="flex flex-col justify-center">
      <div class="flex items-center gap-2">
        <!-- unlimited toggle -->
        <label
          v-if="hasUnlimited"
          class="flex items-center gap-1 text-xs whitespace-nowrap cursor-pointer"
          :class="inputDisabled ? 'opacity-50' : ''"
        >
          <Checkbox
            :model-value="isUnlimited"
            binary
            :disabled="inputDisabled"
            @update:model-value="(v) => setUnlimited(v as boolean)"
          />
          {{ t('configEditor.unlimited') }}
        </label>

        <template v-if="field.widget === 'toggle'">
          <ToggleSwitch v-model="boolValue" :disabled="inputDisabled" />
        </template>

        <template v-else-if="field.widget === 'select'">
          <Select
            v-model="selectValue"
            :options="selectOptions"
            option-label="value"
            option-value="value"
            :disabled="inputDisabled"
            class="w-full"
            size="small"
          >
            <template #option="{ option }">{{ optionLabel(option) }}</template>
            <template #value="{ value }">
              {{ value === '' ? t('configEditor.none') : (value ?? t('configEditor.choose')) }}
            </template>
          </Select>
        </template>

        <template v-else-if="field.widget === 'integer' || field.widget === 'number'">
          <InputNumber
            v-if="!isUnlimited"
            v-model="numberValue"
            :min="field.min"
            :max="field.max"
            :step="field.step ?? (field.widget === 'integer' ? 1 : undefined)"
            :max-fraction-digits="field.widget === 'integer' ? 0 : (field.fractionDigits ?? 8)"
            :disabled="inputDisabled"
            show-buttons
            fluid
            size="small"
            class="w-full"
          />
          <span v-else class="text-sm text-surface-400 italic">{{ field.unlimitedValue }}</span>
        </template>

        <template v-else>
          <InputText
            v-model="textValue"
            :disabled="inputDisabled"
            :maxlength="field.maxLength"
            :placeholder="field.placeholder"
            class="w-full"
            size="small"
            fluid
          />
        </template>
      </div>
      <p v-if="error" class="text-xs text-red-400 mt-1">{{ error }}</p>
    </div>
  </div>
</template>
