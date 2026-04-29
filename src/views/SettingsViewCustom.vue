<script setup lang="ts">
import { FtWsMessageTypes } from '@/types/wsMessageTypes';
import { useI18n } from 'vue-i18n';
import { availableLocales, loadLanguage } from '@/locales';
import { useBotComparisonStore } from '@/stores/botComparison';

const { locale, t } = useI18n();
const settingsStore = useSettingsStore();
const colorStore = useColorStore();
const layoutStore = useLayoutStore();
const botStore = useBotStore();
const compStore = useBotComparisonStore();

// --- Browser Notifications (from store) ---
const browserNotificationsEnabled = computed({
  get: () => compStore.browserNotificationsEnabled,
  set: (val: boolean) => { compStore.browserNotificationsEnabled = val; },
});
const notificationPermission = ref(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

const notifTypes = computed({
  get: () => compStore.notificationTypes,
  set: (val: { positionLoss: boolean; botOffline: boolean; logErrors: boolean }) => {
    compStore.notificationTypes = val;
  },
});

async function toggleBrowserNotifications(enabled: boolean) {
  if (enabled) {
    if (typeof Notification === 'undefined') {
      compStore.browserNotificationsEnabled = false;
      return;
    }
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      notificationPermission.value = perm;
      if (perm !== 'granted') {
        compStore.browserNotificationsEnabled = false;
        return;
      }
    } else if (Notification.permission === 'denied') {
      compStore.browserNotificationsEnabled = false;
      return;
    }
  }
  compStore.browserNotificationsEnabled = enabled;
}

const currentLocale = computed({
  get: () => locale.value,
  set: (val: string) => {
    loadLanguage(val);
  },
});

const timezoneOptions = ['UTC', Intl.DateTimeFormat().resolvedOptions().timeZone];
const openTradesOptions = computed(() => [
  { value: OpenTradeVizOptions.showPill, text: t('settings.showOpenTrades') },
  { value: OpenTradeVizOptions.asTitle, text: t('settings.showOpenTradesDesc') },
  { value: OpenTradeVizOptions.noOpenTrades, text: t('settings.showOpenTrades') },
]);
const colorPreferenceOptions = computed(() => [
  { value: ColorPreferences.GREEN_UP, text: t('settings.greenUpRedDown') },
  { value: ColorPreferences.RED_UP, text: t('settings.greenDownRedUp') },
]);

const resetDynamicLayout = () => {
  layoutStore.resetTradingLayout();
  layoutStore.resetDashboardLayout();
  showAlert('Layouts have been reset.');
};

const freqtradeVersion = computed(() => botStore.activeBot?.version ?? '-');
</script>

<template>
  <div class="mx-auto mt-3 max-w-4xl space-y-6 px-4 pb-8">
    <h1 class="text-2xl font-bold dark:text-surface-100 flex items-center gap-2">
      <i-mdi-cog class="inline" />
      {{ t('settings.title') }}
    </h1>

    <!-- UI Settings -->
    <div class="glass-card">
      <h2 class="section-header">
        <i-mdi-monitor-dashboard class="text-xl" />
        {{ t('settings.uiSettings') }}
      </h2>

      <div class="space-y-4">
        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-translate class="text-lg opacity-70" />
            <label>{{ t('settings.language') }}</label>
          </div>
          <Select
            v-model="currentLocale"
            :options="availableLocales"
            option-label="label"
            option-value="value"
            size="small"
            class="w-48"
          />
        </div>

        <Divider />

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-table-eye class="text-lg opacity-70" />
            <label>{{ t('settings.showOpenTrades') }}</label>
          </div>
          <Select
            v-model="settingsStore.openTradesInTitle"
            :options="openTradesOptions"
            option-label="text"
            option-value="value"
            size="small"
            class="w-64"
          />
        </div>
        <small class="text-surface-600 dark:text-surface-400 pl-8">{{ t('settings.showOpenTradesDesc') }}</small>

        <Divider />

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-clock-outline class="text-lg opacity-70" />
            <label>{{ t('settings.utcTimezone') }}</label>
          </div>
          <Select
            v-model="settingsStore.timezone"
            :options="timezoneOptions"
            class="w-48"
            size="small"
          />
        </div>
        <small class="text-surface-600 dark:text-surface-400 pl-8">{{ t('settings.utcTimezoneDesc') }}</small>

        <Divider />

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-sync class="text-lg opacity-70" />
            <span>{{ t('settings.backgroundSync') }}</span>
          </div>
          <ToggleSwitch v-model="settingsStore.backgroundSync" />
        </div>
        <small class="text-surface-600 dark:text-surface-400 pl-8">{{ t('settings.backgroundSyncDesc') }}</small>

        <Divider />

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-check-decagram class="text-lg opacity-70" />
            <span>{{ t('settings.confirmDialog') }}</span>
          </div>
          <ToggleSwitch v-model="settingsStore.confirmDialog" />
        </div>
        <small class="text-surface-600 dark:text-surface-400 pl-8">{{ t('settings.confirmDialogDesc') }}</small>

        <Divider />

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-text class="text-lg opacity-70" />
            <span>{{ t('settings.showMultiPaneText') }}</span>
          </div>
          <ToggleSwitch v-model="settingsStore.multiPaneButtonsShowText" />
        </div>
        <small class="text-surface-600 dark:text-surface-400 pl-8">{{ t('settings.showMultiPaneTextDesc') }}</small>
      </div>
    </div>

    <!-- Dashboard Settings -->
    <div class="glass-card">
      <h2 class="section-header">
        <i-mdi-view-dashboard class="text-xl" />
        {{ t('settings.dashboardSettings') }}
      </h2>

      <div class="space-y-4">
        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-lock class="text-lg opacity-70" />
            <span>{{ t('settings.lockLayouts') }}</span>
          </div>
          <ToggleSwitch v-model="layoutStore.layoutLocked" />
        </div>
        <small class="text-surface-600 dark:text-surface-400 pl-8">{{ t('settings.lockLayoutsDesc') }}</small>

        <Divider />

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-restore class="text-lg opacity-70" />
            <span>{{ t('settings.resetLayout') }}</span>
          </div>
          <Button severity="secondary" size="small" @click="resetDynamicLayout">
            {{ t('settings.resetLayout') }}
          </Button>
        </div>
        <small class="text-surface-600 dark:text-surface-400 pl-8">{{ t('settings.resetLayoutDesc') }}</small>
      </div>
    </div>

    <!-- Chart Settings -->
    <div class="glass-card">
      <h2 class="section-header">
        <i-mdi-chart-areaspline class="text-xl" />
        {{ t('settings.chartSettings') }}
      </h2>

      <div class="space-y-4">
        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-arrow-left-right class="text-lg opacity-70" />
            <label>{{ t('settings.chartScaleSide') }}</label>
          </div>
          <div class="flex gap-4">
            <div class="flex items-center">
              <RadioButton v-model="settingsStore.chartLabelSide" value="left" size="small" />
              <label class="ml-2">{{ t('settings.left') }}</label>
            </div>
            <div class="flex items-center">
              <RadioButton v-model="settingsStore.chartLabelSide" value="right" size="small" />
              <label class="ml-2">{{ t('settings.right') }}</label>
            </div>
          </div>
        </div>
        <small class="text-surface-600 dark:text-surface-400 pl-8">{{ t('settings.chartScaleDesc') }}</small>

        <Divider />

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-candelabra class="text-lg opacity-70" />
            <span>{{ t('settings.heikinAshi') }}</span>
          </div>
          <ToggleSwitch v-model="settingsStore.useHeikinAshiCandles" />
        </div>
        <small class="text-surface-600 dark:text-surface-400 pl-8">{{ t('settings.heikinAshiDesc') }}</small>

        <Divider />

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-table-column class="text-lg opacity-70" />
            <span>{{ t('settings.onlyNecessaryColumns') }}</span>
          </div>
          <ToggleSwitch v-model="settingsStore.useReducedPairCalls" />
        </div>
        <small class="text-surface-600 dark:text-surface-400 pl-8">{{ t('settings.onlyNecessaryColumnsDesc') }}</small>

        <Divider />

        <div class="space-y-2">
          <div class="setting-label">
            <i-mdi-numeric class="text-lg opacity-70" />
            <span>{{ t('settings.defaultCandles') }}</span>
          </div>
          <div class="flex flex-row gap-5 w-full items-center pl-8">
            <Slider
              v-model="settingsStore.chartDefaultCandleCount"
              class="flex-1"
              :step="50"
              :min="100"
              :max="2000"
            />
            <InputNumber
              v-model="settingsStore.chartDefaultCandleCount"
              :step="50"
              :min="100"
              :max="2000"
              size="small"
            />
          </div>
        </div>

        <Divider />

        <div class="space-y-2">
          <div class="setting-label">
            <i-mdi-palette class="text-lg opacity-70" />
            <label>{{ t('settings.candleColorPref') }}</label>
          </div>
          <div class="flex flex-row gap-5 items-center pl-8">
            <div
              v-for="option in colorPreferenceOptions"
              :key="option.value"
              class="flex items-center"
            >
              <RadioButton
                v-model="colorStore.colorPreference"
                :value="option.value"
                :input-id="`input-id${option.value}`"
                size="small"
                @change="colorStore.updateProfitLossColor"
              />
              <label :for="`input-id${option.value}`" class="ml-2 flex items-center">
                <span class="mr-2">{{ option.text }}</span>
                <i-mdi-arrow-up-thin
                  :color="
                    option.value === ColorPreferences.GREEN_UP
                      ? colorStore.colorProfit
                      : colorStore.colorLoss
                  "
                  class="-ml-2"
                />
                <i-mdi-arrow-down-thin
                  :color="
                    option.value === ColorPreferences.GREEN_UP
                      ? colorStore.colorLoss
                      : colorStore.colorProfit
                  "
                  class="-ml-2"
                />
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Notification Settings -->
    <div class="glass-card">
      <h2 class="section-header">
        <i-mdi-bell-outline class="text-xl" />
        {{ t('settings.notificationSettings') }}
      </h2>

      <div class="space-y-3">
        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-login class="text-lg opacity-70" />
            <span>{{ t('settings.entryNotifications') }}</span>
          </div>
          <ToggleSwitch v-model="settingsStore.notifications[FtWsMessageTypes.entryFill]" />
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-logout class="text-lg opacity-70" />
            <span>{{ t('settings.exitNotifications') }}</span>
          </div>
          <ToggleSwitch v-model="settingsStore.notifications[FtWsMessageTypes.exitFill]" />
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-cancel class="text-lg opacity-70" />
            <span>{{ t('settings.entryCancelNotifications') }}</span>
          </div>
          <ToggleSwitch v-model="settingsStore.notifications[FtWsMessageTypes.entryCancel]" />
        </div>

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-close-circle-outline class="text-lg opacity-70" />
            <span>{{ t('settings.exitCancelNotifications') }}</span>
          </div>
          <ToggleSwitch v-model="settingsStore.notifications[FtWsMessageTypes.exitCancel]" />
        </div>
      </div>
    </div>

    <!-- Browser Notifications -->
    <div class="glass-card">
      <h2 class="section-header">
        <i-mdi-bell-ring-outline class="text-xl" />
        {{ t('settings.browserNotifications') }}
      </h2>

      <div class="space-y-3">
        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-web class="text-lg opacity-70" />
            <span>{{ t('settings.enableBrowserNotifications') }}</span>
          </div>
          <ToggleSwitch
            :model-value="browserNotificationsEnabled"
            @update:model-value="toggleBrowserNotifications"
          />
        </div>
        <small class="text-surface-600 dark:text-surface-400 pl-8">{{ t('settings.enableBrowserNotificationsDesc') }}</small>

        <div v-if="notificationPermission === 'denied'" class="text-sm text-red-400 pl-8">
          {{ t('settings.notificationsDenied') }}
        </div>

        <template v-if="browserNotificationsEnabled">
          <Divider />
          <div class="setting-item pl-4">
            <div class="setting-label">
              <i-mdi-trending-down class="text-lg opacity-70" />
              <span>{{ t('settings.notifyPositionLoss') }}</span>
            </div>
            <ToggleSwitch v-model="notifTypes.positionLoss" />
          </div>

          <div class="setting-item pl-4">
            <div class="setting-label">
              <i-mdi-power-plug-off class="text-lg opacity-70" />
              <span>{{ t('settings.notifyBotOffline') }}</span>
            </div>
            <ToggleSwitch v-model="notifTypes.botOffline" />
          </div>

          <div class="setting-item pl-4">
            <div class="setting-label">
              <i-mdi-alert-circle-outline class="text-lg opacity-70" />
              <span>{{ t('settings.notifyLogErrors') }}</span>
            </div>
            <ToggleSwitch v-model="notifTypes.logErrors" />
          </div>
        </template>
      </div>
    </div>

    <!-- Backtest Settings -->
    <div class="glass-card">
      <h2 class="section-header">
        <i-mdi-flask class="text-xl" />
        {{ t('settings.backtestSettings') }}
      </h2>

      <div class="space-y-3">
        <div class="space-y-2">
          <div class="setting-label">
            <i-mdi-chart-bar class="text-lg opacity-70" />
            <label for="backtestMetrics">{{ t('settings.backtestMetrics') }}</label>
          </div>
          <div class="pl-8">
            <MultiSelect
              id="backtestMetrics"
              v-model="settingsStore.backtestAdditionalMetrics"
              :options="availableBacktestMetrics"
              option-label="header"
              option-value="field"
              class="w-full"
              size="small"
              display="chip"
            />
            <small class="text-surface-600 dark:text-surface-400">{{ t('settings.backtestMetricsDesc') }}</small>
          </div>
        </div>
      </div>
    </div>

    <!-- About -->
    <div class="glass-card">
      <h2 class="section-header">
        <i-mdi-information-outline class="text-xl" />
        {{ t('settings.aboutSection') }}
      </h2>

      <div class="space-y-3">
        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-application class="text-lg opacity-70" />
            <span>{{ t('settings.uiVersion') }}</span>
          </div>
          <span class="text-sm font-mono dark:text-surface-300">{{ settingsStore.uiVersion }}</span>
        </div>

        <Divider />

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-robot class="text-lg opacity-70" />
            <span>{{ t('settings.freqtradeVersion') }}</span>
          </div>
          <span class="text-sm font-mono dark:text-surface-300">{{ freqtradeVersion }}</span>
        </div>

        <Divider />

        <div class="setting-item">
          <div class="setting-label">
            <i-mdi-github class="text-lg opacity-70" />
            <span>GitHub</span>
          </div>
          <a
            href="https://github.com/titouannwtt/frequi-fork"
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm text-blue-400 hover:text-blue-300 underline"
          >
            titouannwtt/frequi-fork
          </a>
        </div>

        <Divider />

        <div class="text-center text-xs text-surface-500 dark:text-surface-500 pt-2">
          {{ t('settings.credits') }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.glass-card {
  border-radius: 0.75rem;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background: rgba(15, 17, 23, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.section-header {
  font-size: 1.125rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.setting-item {
  display: flex; align-items: center; justify-content: space-between;
}

.setting-label {
  display: flex; align-items: center; gap: 0.5rem;
}
</style>
