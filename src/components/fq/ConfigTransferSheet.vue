<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { AdaptiveSheet, Banner, Btn, SegmentedControl, Switch, TextInput } from '@/components/ds';
import {
  exportConfig,
  importConfig,
  previewConfig,
  type ConfigPreview,
} from '@/composables/useConfigExport';

/**
 * Import and export of the browser configuration (Settings > Bots, one place for both). The export
 * is format v3 (layout, `fqu2.*` preferences and, if asked, the bot logins, encrypted with a
 * password); the import reads v1, v2 and v3, shows what the file holds before applying anything and
 * asks for the password of an encrypted one. Applying writes the keys and reloads the page.
 */
const props = defineProps<{ open: boolean; initial: 'export' | 'import' }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const tab = ref<'export' | 'import'>(props.initial);
const includeAuth = ref(false);
const password = ref('');
const confirmPw = ref('');
const file = ref<File | null>(null);
const preview = ref<ConfigPreview | null>(null);
const importPw = ref('');
const error = ref<string | null>(null);
const info = ref<string | null>(null);
const busy = ref(false);

watch(
  () => props.open,
  (o) => {
    if (!o) return;
    tab.value = props.initial;
    includeAuth.value = false;
    password.value = confirmPw.value = importPw.value = '';
    file.value = null;
    preview.value = null;
    error.value = null;
    info.value = null;
  },
);

const tabs = computed(() => [
  { value: 'export' as const, label: t('fq.pg.settings.xfer.export') },
  { value: 'import' as const, label: t('fq.pg.settings.xfer.import') },
]);

const MIN_PW = 8;
const exportOk = computed(
  () =>
    !includeAuth.value || (password.value.length >= MIN_PW && password.value === confirmPw.value),
);

function doExport() {
  if (!exportOk.value) return;
  exportConfig({
    includeAuth: includeAuth.value,
    password: includeAuth.value ? password.value : undefined,
  });
  info.value = t('fq.pg.settings.xfer.exported');
}

async function pick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0] ?? null;
  file.value = f;
  preview.value = null;
  error.value = null;
  info.value = null;
  if (!f) return;
  try {
    preview.value = await previewConfig(f);
  } catch {
    error.value = t('fq.pg.settings.xfer.err.INVALID_FORMAT');
  }
}

async function doImport() {
  if (!file.value || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    const r = await importConfig(file.value, { password: importPw.value || undefined });
    info.value = t('fq.pg.settings.xfer.imported', { n: r.keysRestored, bots: r.botCount });
    // The stores read the keys at start: a reload is what makes them take effect
    window.setTimeout(() => window.location.reload(), 900);
  } catch (e) {
    const code = e instanceof Error ? e.message : '';
    error.value = [
      'PASSWORD_REQUIRED',
      'WRONG_PASSWORD',
      'INTEGRITY_FAILED',
      'INVALID_FORMAT',
    ].includes(code)
      ? t(`fq.pg.settings.xfer.err.${code}`)
      : t('fq.pg.settings.xfer.err.INVALID_FORMAT');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AdaptiveSheet :open="open" :title="t('fq.pg.settings.xfer.title')" @close="emit('close')">
    <div class="xf" data-testid="config-transfer">
      <SegmentedControl
        v-model="tab"
        :options="tabs"
        size="sm"
        :label="t('fq.pg.settings.xfer.title')"
      />

      <template v-if="tab === 'export'">
        <p class="hint">{{ t('fq.pg.settings.xfer.exportHint') }}</p>
        <Switch v-model="includeAuth" :label="t('fq.pg.settings.xfer.withLogins')" />
        <template v-if="includeAuth">
          <p class="hint">{{ t('fq.pg.settings.xfer.encryptHint') }}</p>
          <TextInput
            v-model="password"
            type="password"
            :label="t('fq.pg.settings.xfer.password')"
            autocomplete="new-password"
          />
          <TextInput
            v-model="confirmPw"
            type="password"
            :label="t('fq.pg.settings.xfer.confirmPassword')"
            autocomplete="new-password"
            :invalid="confirmPw !== '' && confirmPw !== password"
          />
          <p v-if="password !== '' && password.length < MIN_PW" class="err">
            {{ t('fq.pg.settings.xfer.pwShort', { n: MIN_PW }) }}
          </p>
        </template>
        <Btn
          variant="primary"
          size="sm"
          :disabled="!exportOk"
          data-testid="xfer-export"
          @click="doExport"
          >{{ t('fq.pg.settings.xfer.download') }}</Btn
        >
      </template>

      <template v-else>
        <p class="hint">{{ t('fq.pg.settings.xfer.importHint') }}</p>
        <input type="file" accept="application/json,.json" data-testid="xfer-file" @change="pick" />
        <dl v-if="preview" class="pv" data-testid="xfer-preview">
          <dt>{{ t('fq.pg.settings.xfer.format') }}</dt>
          <dd>v{{ preview.version }}</dd>
          <dt>{{ t('fq.pg.settings.xfer.exportedAt') }}</dt>
          <dd>{{ preview.exportedAt }}</dd>
          <template v-if="!preview.encrypted">
            <dt>{{ t('fq.pg.settings.xfer.settings') }}</dt>
            <dd>{{ preview.settingsCount }}</dd>
            <dt>{{ t('fq.pg.settings.xfer.bots') }}</dt>
            <dd>{{ preview.botCount }}</dd>
            <dt>{{ t('fq.pg.settings.xfer.integrity') }}</dt>
            <dd>
              {{
                preview.integrityValid === null
                  ? t('fq.pg.settings.xfer.integrityNone')
                  : preview.integrityValid
                    ? t('fq.pg.settings.xfer.integrityOk')
                    : t('fq.pg.settings.xfer.integrityBad')
              }}
            </dd>
          </template>
        </dl>
        <Banner v-if="preview?.isExpired" kind="degraded">{{
          t('fq.pg.settings.xfer.old', { n: preview.ageInDays })
        }}</Banner>
        <TextInput
          v-if="preview?.encrypted"
          v-model="importPw"
          type="password"
          :label="t('fq.pg.settings.xfer.password')"
          autocomplete="off"
        />
        <Btn
          variant="primary"
          size="sm"
          :busy="busy"
          :disabled="!preview"
          data-testid="xfer-import"
          @click="doImport"
          >{{ t('fq.pg.settings.xfer.apply') }}</Btn
        >
      </template>

      <p v-if="error" class="err" role="alert">{{ error }}</p>
      <p v-if="info" class="ok" role="status">{{ info }}</p>
    </div>
  </AdaptiveSheet>
</template>

<style scoped>
.xf {
  display: grid;
  gap: var(--s3);
  padding: var(--s3) var(--s4) var(--s4);
  text-align: left;
}
.hint {
  margin: 0;
  color: var(--fg-3);
  font-size: var(--t-sm);
}
.err {
  margin: 0;
  color: var(--loss);
  font-size: var(--t-sm);
}
.ok {
  margin: 0;
  color: var(--profit);
  font-size: var(--t-sm);
}
.pv {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px var(--s3);
  margin: 0;
  font-size: var(--t-sm);
}
dt {
  color: var(--fg-3);
}
dd {
  margin: 0;
}
</style>
