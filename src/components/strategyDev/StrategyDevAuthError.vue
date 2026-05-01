<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();

const is401 = computed(() => store.errorCode === 401);
const is403 = computed(() => store.errorCode === 403);
const is404 = computed(() => store.errorCode === 404);

async function retry() {
  await store.fetchAllRuns();
}
</script>

<template>
  <div class="flex flex-col items-center justify-center h-full px-6 max-w-2xl mx-auto">
    <div
      class="w-full bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-8"
    >
      <!-- Icon -->
      <div class="flex justify-center mb-4">
        <i-mdi-shield-lock-outline v-if="is401" class="w-16 h-16 text-yellow-500 opacity-80" />
        <i-mdi-cancel v-else-if="is403" class="w-16 h-16 text-red-500 opacity-80" />
        <i-mdi-server-off v-else-if="is404" class="w-16 h-16 text-orange-500 opacity-80" />
        <i-mdi-wifi-off v-else class="w-16 h-16 text-red-500 opacity-80" />
      </div>

      <!-- 401: Not authenticated -->
      <template v-if="is401">
        <h3 class="text-xl font-bold text-center mb-2">
          {{ t('strategyDev.authRequired') }}
        </h3>
        <p class="text-surface-500 text-center mb-6">
          {{ t('strategyDev.authRequiredDesc') }}
        </p>

        <div class="space-y-4 text-sm">
          <div>
            <h4 class="font-semibold mb-1">{{ t('strategyDev.authStep1Title') }}</h4>
            <p class="text-surface-500 mb-2">{{ t('strategyDev.authStep1Desc') }}</p>
            <pre
              class="bg-surface-100 dark:bg-surface-900 p-3 rounded-lg overflow-x-auto text-xs"
            ><code>"api_server": {
    "enabled": true,
    "listen_ip_address": "0.0.0.0",
    "listen_port": 8080,
    "username": "your_username",
    "password": "your_secure_password"
}</code></pre>
          </div>

          <div>
            <h4 class="font-semibold mb-1">{{ t('strategyDev.authStep2Title') }}</h4>
            <p class="text-surface-500">{{ t('strategyDev.authStep2Desc') }}</p>
          </div>

          <div>
            <h4 class="font-semibold mb-1">{{ t('strategyDev.authStep3Title') }}</h4>
            <p class="text-surface-500">{{ t('strategyDev.authStep3Desc') }}</p>
          </div>
        </div>
      </template>

      <!-- 403: Mode not supported -->
      <template v-else-if="is403">
        <h3 class="text-xl font-bold text-center mb-2">
          {{ t('strategyDev.modeNotSupported') }}
        </h3>
        <p class="text-surface-500 text-center mb-4">
          {{ t('strategyDev.modeNotSupportedDesc') }}
        </p>
      </template>

      <!-- 404: Endpoint not found -->
      <template v-else-if="is404">
        <h3 class="text-xl font-bold text-center mb-2">
          {{ t('strategyDev.endpointNotFound') }}
        </h3>
        <p class="text-surface-500 text-center mb-4">
          {{ t('strategyDev.endpointNotFoundDesc') }}
        </p>
      </template>

      <!-- Network error -->
      <template v-else>
        <h3 class="text-xl font-bold text-center mb-2">
          {{ t('strategyDev.connectionError') }}
        </h3>
        <p class="text-surface-500 text-center mb-4">
          {{ t('strategyDev.connectionErrorDesc') }}
        </p>
      </template>

      <!-- Error details + retry -->
      <div class="mt-6 flex items-center justify-between">
        <span class="text-xs text-surface-400">
          {{ t('strategyDev.errorDetail', { code: store.errorCode, message: store.errorMessage }) }}
        </span>
        <Button size="small" severity="secondary" @click="retry">
          <i-mdi-refresh class="w-4 h-4 mr-1" />
          {{ t('strategyDev.retry') }}
        </Button>
      </div>
    </div>
  </div>
</template>
