<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { AdaptiveSheet, Banner, Btn, TextInput } from '@/components/ds';

import { validateBotForm, type BotForm } from './lib/registryEdit';

/**
 * Add, edit or reconnect a bot (Settings > Bots). Adding and reconnecting log in to the bot; the
 * password is only used for that call and is never stored. Editing only renames, unless a password
 * is typed (then it logs in again, for a new address or a changed password). Removing a bot only
 * removes this browser's login: nothing is sent to the bot.
 */
const props = defineProps<{
  open: boolean;
  mode: 'add' | 'edit' | 'reconnect';
  initial: Omit<BotForm, 'password'>;
  busy: boolean;
  /** Message of the last failure (login refused, bot unreachable), or null. */
  error: string | null;
  /** Addresses already registered, to refuse a duplicate when adding. */
  others: string[];
}>();

const emit = defineEmits<{ close: []; submit: [form: BotForm]; remove: [] }>();

const { t } = useI18n();
const form = ref<BotForm>({ name: '', url: '', username: '', password: '' });
const confirmRemove = ref(false);

watch(
  () => [props.open, props.initial],
  () => {
    if (props.open) {
      form.value = { ...props.initial, password: '' };
      confirmRemove.value = false;
    }
  },
  { immediate: true, deep: true },
);

const problem = computed(() =>
  validateBotForm(form.value, { editing: props.mode !== 'add', others: props.others }),
);
const renameOnly = computed(() => props.mode === 'edit' && form.value.password === '');
const canSubmit = computed(() =>
  renameOnly.value ? form.value.name.trim() !== '' : problem.value === null,
);
const shown = computed(() => (renameOnly.value ? null : problem.value));

function submit() {
  if (canSubmit.value && !props.busy) emit('submit', { ...form.value });
}
</script>

<template>
  <AdaptiveSheet :open="open" :title="t(`fq.pg.settings.bot.title.${mode}`)" :scrim-close="false" @close="emit('close')">
    <form class="be" data-testid="bot-form" @submit.prevent="submit">
      <p class="hint">{{ t(`fq.pg.settings.bot.hint.${mode}`) }}</p>
      <TextInput v-model="form.name" :label="t('fq.pg.settings.bot.name')" :invalid="shown === 'name'" />
      <TextInput
        v-model="form.url"
        :label="t('fq.pg.settings.bot.url')"
        type="url"
        mono
        :invalid="shown === 'url' || shown === 'duplicate'"
        :disabled="mode === 'edit' && renameOnly"
      />
      <TextInput
        v-model="form.username"
        :label="t('fq.pg.settings.bot.username')"
        autocomplete="username"
        :invalid="shown === 'username'"
      />
      <TextInput
        v-model="form.password"
        :label="mode === 'edit' ? t('fq.pg.settings.bot.passwordOptional') : t('fq.pg.settings.bot.password')"
        type="password"
        autocomplete="current-password"
        :invalid="shown === 'password'"
      />
      <p v-if="shown" class="err" role="alert">{{ t(`fq.pg.settings.bot.err.${shown}`) }}</p>
      <Banner v-if="error" kind="offline">{{ error }}</Banner>
      <p class="once">{{ t('fq.pg.settings.bot.noStore') }}</p>
      <div class="row">
        <Btn
          v-if="mode === 'edit'"
          :variant="confirmRemove ? 'danger' : 'danger-outline'"
          size="sm"
          data-testid="bot-remove"
          @click="confirmRemove ? emit('remove') : (confirmRemove = true)"
          >{{ confirmRemove ? t('fq.pg.settings.bot.removeConfirm') : t('fq.pg.settings.bot.remove') }}</Btn
        >
        <span class="grow"></span>
        <Btn size="sm" @click="emit('close')">{{ t('fq.ds.close') }}</Btn>
        <Btn variant="primary" size="sm" type="submit" :busy="busy" :disabled="!canSubmit" data-testid="bot-submit">{{
          t(`fq.pg.settings.bot.submit.${renameOnly ? 'rename' : mode === 'edit' ? 'reconnect' : mode}`)
        }}</Btn>
      </div>
    </form>
  </AdaptiveSheet>
</template>

<style scoped>
.be {
  display: grid;
  gap: var(--s3);
  padding: var(--s3) var(--s4) var(--s4);
  text-align: left;
}
.hint,
.once {
  margin: 0;
  color: var(--fg-3);
  font-size: var(--t-sm);
}
.once {
  font-size: var(--t-xs);
}
.err {
  margin: 0;
  color: var(--loss);
  font-size: var(--t-sm);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--s2);
}
.grow {
  flex: 1;
}
</style>
