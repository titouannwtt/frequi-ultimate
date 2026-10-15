<script setup lang="ts">
import { useId } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label?: string;
    placeholder?: string;
    type?: 'text' | 'password' | 'number' | 'url' | 'email';
    /** Monospace digits, for identifiers and numbers. */
    mono?: boolean;
    invalid?: boolean;
    disabled?: boolean;
    autocomplete?: string;
  }>(),
  { type: 'text', autocomplete: 'off' },
);

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const id = useId();

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="ti">
    <label v-if="label" :for="id" class="lab">{{ label }}</label>
    <input
      :id="id"
      class="input"
      :class="{ mono, invalid }"
      :type="props.type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :autocomplete="autocomplete"
      :aria-invalid="invalid || undefined"
      spellcheck="false"
      @input="onInput"
    />
  </div>
</template>

<style scoped>
.ti {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.input {
  height: var(--ctl);
  border-radius: var(--r-2);
  border: 1px solid var(--line-2);
  background: var(--bg);
  padding: 0 9px;
  color: var(--fg);
  font-family: var(--font-ui);
  font-size: var(--t-sm);
  min-width: 0;
  width: 100%;
}
.input.mono {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
.input::placeholder {
  color: var(--fg-3);
}
.input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-w);
}
.input.invalid {
  border-color: var(--loss);
}
.input:disabled {
  opacity: 0.45;
}
</style>
