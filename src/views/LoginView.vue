<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { importConfig, previewConfig, type ConfigPreview } from '@/composables/useConfigExport';

const { t } = useI18n();

const fileInput = ref<HTMLInputElement>();
const importFile = ref<File | null>(null);
const previewVisible = ref(false);
const configPreview = ref<ConfigPreview | null>(null);
const importPassword = ref('');
const importError = ref('');
const importLoading = ref(false);
const importSuccess = ref(false);

function triggerImport() {
  fileInput.value?.click();
}

async function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  importFile.value = file;
  importPassword.value = '';
  importError.value = '';
  importSuccess.value = false;
  configPreview.value = null;

  try {
    configPreview.value = await previewConfig(file);
    previewVisible.value = true;
  } catch {
    configPreview.value = null;
    importError.value = t('nav.invalidFile');
  }
}

async function confirmImport() {
  if (!importFile.value) return;
  importLoading.value = true;
  importError.value = '';

  try {
    await importConfig(importFile.value, {
      password: importPassword.value || undefined,
    });
    importSuccess.value = true;
    setTimeout(() => { window.location.href = '/dashboard'; }, 1500);
  } catch (err: any) {
    const msg = err?.message ?? '';
    if (msg === 'WRONG_PASSWORD') {
      importError.value = t('nav.wrongPassword');
    } else if (msg === 'INTEGRITY_FAILED') {
      importError.value = t('nav.integrityFailedImport');
    } else if (msg === 'PASSWORD_REQUIRED') {
      importError.value = t('nav.passwordNeeded');
    } else {
      importError.value = t('nav.invalidFile');
    }
  } finally {
    importLoading.value = false;
  }
}

function formatPreviewDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
</script>

<template>
  <div class="border max-w-xl mx-auto p-4">
    <DraggableContainer header="Freqtrade bot Login">
      <BotLogin ref="loginForm" />
    </DraggableContainer>

    <!-- Import configuration -->
    <div class="mt-6 max-w-xl mx-auto text-center">
      <div class="border border-dashed border-surface-500 rounded-lg p-6">
        <i-mdi-cog-transfer class="w-8 h-8 text-surface-400 mx-auto mb-2" />
        <p class="text-sm text-surface-400 mb-3">
          {{ t('nav.configDesc') }}
        </p>
        <button
          class="px-4 py-2 rounded-lg text-sm font-medium text-blue-400 border border-blue-500/40 hover:bg-blue-500/10 transition-colors cursor-pointer"
          @click="triggerImport"
        >
          <i-mdi-upload class="w-4 h-4 inline mr-1 align-text-bottom" />
          {{ t('nav.importConfig') }}
        </button>

        <input ref="fileInput" type="file" accept=".json" class="hidden" @change="handleFileSelected" />

        <div v-if="importError && !previewVisible" class="mt-2 text-xs text-red-400">
          {{ importError }}
        </div>
      </div>
    </div>

    <!-- Import preview dialog -->
    <Dialog
      v-model:visible="previewVisible"
      :header="t('nav.importPreview')"
      modal
      :style="{ width: '450px' }"
    >
      <div v-if="configPreview" class="space-y-3">
        <!-- Summary rows -->
        <div class="divide-y divide-surface-200 dark:divide-surface-700 rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden text-sm">
          <div class="flex justify-between px-3 py-2 bg-surface-50 dark:bg-surface-800/50">
            <span class="text-surface-500">{{ t('nav.exportDate') }}</span>
            <span>{{ formatPreviewDate(configPreview.exportedAt) }}</span>
          </div>
          <div class="flex justify-between px-3 py-2">
            <span class="text-surface-500">{{ t('nav.fileAge') }}</span>
            <span :class="configPreview.isExpired ? 'text-amber-400 font-medium' : ''">
              {{ configPreview.ageInDays }} {{ t('nav.daysUnit') }}
            </span>
          </div>
          <div class="flex justify-between px-3 py-2 bg-surface-50 dark:bg-surface-800/50">
            <span class="text-surface-500">{{ t('nav.containsAuth') }}</span>
            <span v-if="!configPreview.includesAuth" class="text-green-400">{{ t('nav.authNotIncluded') }}</span>
            <span v-else-if="configPreview.encrypted" class="text-blue-400">
              <i-mdi-lock class="inline w-3.5 h-3.5 mr-0.5" />{{ t('nav.authEncrypted') }}
            </span>
            <span v-else class="text-amber-400">{{ t('nav.authUnencrypted') }}</span>
          </div>
          <div v-if="!configPreview.encrypted" class="flex justify-between px-3 py-2">
            <span class="text-surface-500">{{ t('nav.settingsCount') }}</span>
            <span>{{ configPreview.settingsCount }}</span>
          </div>
          <div v-if="configPreview.botCount > 0" class="flex justify-between px-3 py-2 bg-surface-50 dark:bg-surface-800/50">
            <span class="text-surface-500">{{ t('nav.botsCount') }}</span>
            <span>{{ configPreview.botCount }}</span>
          </div>
          <div class="flex justify-between px-3 py-2">
            <span class="text-surface-500">{{ t('nav.integrityCheck') }}</span>
            <span v-if="configPreview.integrityValid === true" class="text-green-400">
              <i-mdi-check-circle class="inline w-3.5 h-3.5 mr-0.5" />{{ t('nav.integrityValid') }}
            </span>
            <span v-else-if="configPreview.integrityValid === false" class="text-red-400 font-medium">
              <i-mdi-alert class="inline w-3.5 h-3.5 mr-0.5" />{{ t('nav.integrityFailed') }}
            </span>
            <span v-else class="text-surface-400">{{ t('nav.integrityNA') }}</span>
          </div>
        </div>

        <!-- Expiration warning -->
        <div v-if="configPreview.isExpired" class="flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/15">
          <i-mdi-clock-alert class="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p class="text-xs text-amber-300/90 leading-relaxed">{{ t('nav.expiredWarning') }}</p>
        </div>

        <!-- Integrity failure -->
        <div v-if="configPreview.integrityValid === false" class="flex items-start gap-1.5 p-2.5 rounded-lg bg-red-500/10 border border-red-500/15">
          <i-mdi-shield-alert class="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <p class="text-xs text-red-300/90 leading-relaxed">{{ t('nav.integrityFailedDetail') }}</p>
        </div>

        <!-- Password field for encrypted files -->
        <div v-if="configPreview.encrypted" class="space-y-1">
          <label class="text-xs text-surface-400 block">{{ t('nav.enterPassword') }}</label>
          <input
            v-model="importPassword"
            type="password"
            :placeholder="t('nav.encryptionPassword')"
            class="w-full px-3 py-2 text-sm rounded-lg border bg-surface-50 dark:bg-surface-800 border-surface-300 dark:border-surface-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            @keydown.enter="confirmImport"
          />
        </div>

        <!-- Import error -->
        <div v-if="importError" class="flex items-center gap-1.5 p-2 rounded-lg bg-red-500/10 border border-red-500/15">
          <i-mdi-alert-circle class="w-4 h-4 text-red-400 flex-shrink-0" />
          <p class="text-xs text-red-400">{{ importError }}</p>
        </div>

        <!-- Import success -->
        <div v-if="importSuccess" class="flex items-center gap-1.5 p-2 rounded-lg bg-green-500/10 border border-green-500/15">
          <i-mdi-check-circle class="w-4 h-4 text-green-400 flex-shrink-0" />
          <p class="text-xs text-green-400">{{ t('nav.importSuccess') }} — {{ t('nav.reloading') }}</p>
        </div>

        <!-- Actions -->
        <div v-if="!importSuccess" class="flex justify-end gap-2 pt-2">
          <Button size="small" severity="secondary" @click="previewVisible = false">
            {{ t('nav.cancel') }}
          </Button>
          <Button
            size="small"
            :disabled="importLoading || (configPreview.encrypted && !importPassword) || configPreview.integrityValid === false"
            :loading="importLoading"
            @click="confirmImport"
          >
            <i-mdi-check class="w-4 h-4 mr-1" />
            {{ t('nav.applyConfig') }}
          </Button>
        </div>
      </div>
    </Dialog>
  </div>
</template>
