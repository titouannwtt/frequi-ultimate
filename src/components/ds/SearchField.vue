<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import DsIcon from './DsIcon.vue';

defineProps<{
  modelValue: string;
  placeholder?: string;
  /** Accessible name; defaults to the placeholder. */
  label?: string;
  /** Keyboard hint shown when empty, for example `/`. */
  shortcut?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const { t } = useI18n();

function onInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="search">
    <DsIcon name="search" />
    <input
      type="search"
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="label ?? placeholder ?? t('fq.ds.search')"
      autocomplete="off"
      spellcheck="false"
      @input="onInput"
      @keydown.esc="modelValue && emit('update:modelValue', '')"
    />
    <button
      v-if="modelValue"
      type="button"
      class="clear"
      :aria-label="t('fq.ds.clear')"
      @click="emit('update:modelValue', '')"
    >
      <DsIcon name="x" :size="13" />
    </button>
    <kbd v-else-if="shortcut">{{ shortcut }}</kbd>
  </div>
</template>

<style scoped>
.search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--ctl);
  padding: 0 8px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  background: var(--bg);
  color: var(--fg-3);
  min-width: 0;
}
.search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-w);
}
input {
  border: 0;
  background: none;
  outline: none;
  min-width: 0;
  width: 100%;
  color: var(--fg);
  font-family: var(--font-ui);
  font-size: var(--t-sm);
  -webkit-appearance: none;
  appearance: none;
}
input::placeholder {
  color: var(--fg-3);
}
input::-webkit-search-cancel-button {
  display: none;
}
.clear {
  background: none;
  border: 0;
  color: var(--fg-3);
  padding: 0;
  display: inline-grid;
  place-items: center;
  cursor: pointer;
}
.clear:hover {
  color: var(--fg);
}
kbd {
  font: 600 10.5px var(--font-num);
  padding: 1px 4px;
  border: 1px solid var(--line-2);
  border-bottom-width: 2px;
  border-radius: 3px;
  color: var(--fg-3);
  background: var(--bg-2);
}
</style>
