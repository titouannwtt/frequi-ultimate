<script setup lang="ts">
import Favico from 'favico.js';

import { useRoute } from 'vue-router';
import { breakpointsTailwind } from '@vueuse/core';
import { useI18n } from 'vue-i18n';
import { availableLocales, loadLanguage } from '@/locales';
import {
  exportConfig,
  importConfig,
  previewConfig,
  type ConfigPreview,
} from '@/composables/useConfigExport';

const { t, locale } = useI18n();
const botStore = useBotStore();

const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();
const botComparisonStore = useBotComparisonStore();
const route = useRoute();
const router = useRouter();
const favicon = ref<Favico | undefined>(undefined);
const pingInterval = ref<number>();

const breakpoints = useBreakpoints(breakpointsTailwind);

const isMobile = breakpoints.smallerOrEqual('md');

async function clickLogout() {
  botStore.removeBot(botStore.selectedBot);
  await router.push('/');
}

const setOpenTradesAsPill = (tradeCount: number) => {
  if (!favicon.value) {
    favicon.value = new Favico({
      animation: 'none',
    });
  }
  if (tradeCount !== 0 && settingsStore.openTradesInTitle === 'showPill') {
    favicon.value.badge(tradeCount);
  } else {
    favicon.value.reset();
  }
};
const resetConfirmVisible = ref(false);
const optimizeConfirmVisible = ref(false);

const confirmResetLayout = (): void => {
  resetConfirmVisible.value = true;
};

const confirmOptimizeLayout = (): void => {
  optimizeConfirmVisible.value = true;
};

const executeOptimizeLayout = (): void => {
  optimizeConfirmVisible.value = false;
  if (route?.fullPath === '/trade') {
    layoutStore.compactTradingLayout();
  } else {
    layoutStore.compactDashboardLayout();
  }
};

const resetDynamicLayout = (): void => {
  resetConfirmVisible.value = false;
  switch (route?.fullPath) {
    case '/trade':
      layoutStore.resetTradingLayout();
      break;
    case '/dashboard':
      layoutStore.resetDashboardLayout();
      botComparisonStore.resetColumns();
      break;
    default:
  }
};
const setTitle = () => {
  let title = 'freqUI';
  if (settingsStore.openTradesInTitle === OpenTradeVizOptions.asTitle) {
    title = `(${botStore.activeBotorUndefined?.openTradeCount}) ${title}`;
  }
  if (botStore.activeBotorUndefined?.botName) {
    title = `${title} - ${botStore.activeBotorUndefined?.botName}`;
  }
  document.title = title;
};

onBeforeUnmount(() => {
  if (pingInterval.value) {
    clearInterval(pingInterval.value);
  }
});

onMounted(async () => {
  await settingsStore.loadUIVersion();
  settingsStore.checkForkUpdate();
  pingInterval.value = window.setInterval(botStore.pingAll, 60000);
});

settingsStore.$subscribe((_, state) => {
  const needsUpdate = settingsStore.openTradesInTitle !== state.openTradesInTitle;
  if (needsUpdate) {
    setTitle();
    setOpenTradesAsPill(botStore.activeBotorUndefined?.openTradeCount || 0);
  }
});

watch(
  () => botStore.activeBotorUndefined?.botName,
  () => setTitle(),
);
watch(
  () => botStore.activeBotorUndefined?.openTradeCount,
  () => {
    if (settingsStore.openTradesInTitle === OpenTradeVizOptions.showPill) {
      setOpenTradesAsPill(botStore.activeBotorUndefined?.openTradeCount ?? 0);
    } else if (settingsStore.openTradesInTitle === OpenTradeVizOptions.asTitle) {
      setTitle();
    }
  },
);

const navItems = computed(() => [
  {
    label: t('nav.trade'),
    to: '/trade',
    visible: !botStore.canRunBacktest,
    icon: 'i-mdi-swap-horizontal',
  },
  {
    label: t('nav.dashboard'),
    to: '/dashboard',
    visible: !botStore.canRunBacktest,
    icon: 'i-mdi-view-dashboard',
  },
  {
    label: t('nav.journal'),
    to: '/journal',
    visible: !botStore.canRunBacktest,
    icon: 'i-mdi-notebook',
  },
  {
    label: t('nav.logs'),
    to: '/logs',
    icon: 'i-mdi-text-box',
  },
  {
    label: t('nav.settings'),
    to: '/settings',
    mobileOnly: true,
    icon: 'i-mdi-cog',
  },
  {
    label: t('nav.backtest'),
    to: '/backtest',
    visible: botStore.canRunBacktest,
    icon: 'i-mdi-flask',
  },
  {
    label: t('nav.downloadData'),
    to: '/download_data',
    visible: botStore.isWebserverMode && botStore.activeBot.botFeatures.downloadDataView,
    icon: 'i-mdi-download',
  },
  {
    label: t('nav.pairlistConfig'),
    to: '/pairlist_config',
    icon: 'i-mdi-format-list-numbered-rtl',
    visible:
      (botStore.activeBot?.isWebserverMode ?? false) &&
      botStore.activeBot.botFeatures.pairlistConfig,
  },
  {
    label: t('nav.strategyDev'),
    to: '/strategy-dev',
    icon: 'i-mdi-flask-outline',
    visible: true,
  },
]);

const drawerVisible = ref(false);
const configMenuOpen = ref(false);

// ── Export state ──
const exportDialogVisible = ref(false);
const includeAuthInExport = ref(false);
const exportPassword = ref('');
const exporting = ref(false);

function openExportDialog() {
  configMenuOpen.value = false;
  includeAuthInExport.value = false;
  exportPassword.value = '';
  exportDialogVisible.value = true;
}

const canExport = computed(() => {
  if (!includeAuthInExport.value) return true;
  return exportPassword.value.length >= 8;
});

const exportError = ref('');

function confirmExport() {
  exportError.value = '';
  try {
    exportConfig({
      includeAuth: includeAuthInExport.value,
      password: includeAuthInExport.value ? exportPassword.value : undefined,
    });
    exportDialogVisible.value = false;
  } catch (err: any) {
    exportError.value = err?.message ?? 'Export failed';
  }
}

// ── Import state ──
const importPreviewVisible = ref(false);
const importFile = ref<File | null>(null);
const configPreview = ref<ConfigPreview | null>(null);
const importPassword = ref('');
const importError = ref('');
const importLoading = ref(false);
const importSuccess = ref(false);
const fileInput = ref<HTMLInputElement>();

function openImportPicker() {
  configMenuOpen.value = false;
  importFile.value = null;
  configPreview.value = null;
  importPassword.value = '';
  importError.value = '';
  importSuccess.value = false;
  importLoading.value = false;
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
    const preview = await previewConfig(file);
    configPreview.value = preview;
    importPreviewVisible.value = true;
  } catch (err) {
    configPreview.value = null;
    importError.value = t('nav.invalidFile');
    importPreviewVisible.value = true;
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
    setTimeout(() => window.location.reload(), 1500);
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
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function changeLocale(lang: string) {
  loadLanguage(lang);
}

const isDashboard = computed(() => route?.fullPath === '/dashboard' || route?.fullPath === '/trade');

watch(() => route?.fullPath, () => {
  if (!isDashboard.value && layoutStore.editMode) {
    layoutStore.editMode = false;
    layoutStore.layoutLocked = true;
  }
});
</script>

<template>
  <header class="relative" style="z-index: 1100">
    <div class="navbar-glass flex border-b border-black/10 dark:border-white/10">
      <RouterLink class="ms-2 flex flex-row items-center pe-2 gap-2" exact to="/">
        <img class="h-[30px] align-middle" src="@/assets/freqtrade-logo.png" alt="Home Logo" />
        <span class="text-slate-200 text-xl md:hidden lg:inline text-nowrap font-semibold">Freqtrade Ultimate</span>
      </RouterLink>
      <div class="flex justify-between w-full text-center items-center ms-3">
        <div class="items-center hidden md:flex gap-1 ms-2">
          <!-- Theme (left side) -->
          <ThemeSelect />
          <div class="w-px h-5 bg-white/10 mx-2" />
          <!-- Nav links -->
          <RouterLink
            v-for="(item, index) in navItems.filter(
              (item) => (item.visible ?? true) && !item.mobileOnly,
            )"
            :key="index"
            :to="item.to"
            class="nav-link text-surface-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 hover:text-white hover:bg-black/10 dark:hover:bg-white/10"
            active-class="nav-link-active"
          >
            <i-mdi-swap-horizontal v-if="item.icon === 'i-mdi-swap-horizontal'" class="w-4 h-4" />
            <i-mdi-view-dashboard v-else-if="item.icon === 'i-mdi-view-dashboard'" class="w-4 h-4" />
            <i-mdi-notebook v-else-if="item.icon === 'i-mdi-notebook'" class="w-4 h-4" />
            <i-mdi-chart-line v-else-if="item.icon === 'i-mdi-chart-line'" class="w-4 h-4" />
            <i-mdi-text-box v-else-if="item.icon === 'i-mdi-text-box'" class="w-4 h-4" />
            <i-mdi-cog v-else-if="item.icon === 'i-mdi-cog'" class="w-4 h-4" />
            <i-mdi-flask v-else-if="item.icon === 'i-mdi-flask'" class="w-4 h-4" />
            <i-mdi-download v-else-if="item.icon === 'i-mdi-download'" class="w-4 h-4" />
            <i-mdi-format-list-numbered-rtl v-else-if="item.icon === 'i-mdi-format-list-numbered-rtl'" class="w-4 h-4" />
            <i-mdi-flask-outline v-else-if="item.icon === 'i-mdi-flask-outline'" class="w-4 h-4" />
            {{ item.label }}
          </RouterLink>
        </div>

        <!-- Right aligned nav items -->
        <div v-if="!isMobile" class="flex ms-auto items-center gap-2 whitespace-nowrap">
          <div
            v-if="!settingsStore.confirmDialog"
            class="my-auto flex text-yellow-300"
            :title="t('general.confirmDialogDeactivated')"
          >
            <i-mdi-run-fast />
            <i-mdi-alert />
          </div>

          <!-- Language selector -->
          <select
            :value="locale"
            class="bg-transparent text-surface-400 text-xs border border-black/10 dark:border-white/10 rounded px-1.5 py-1 cursor-pointer hover:text-white focus:outline-none"
            @change="changeLocale(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="loc in availableLocales"
              :key="loc.value"
              :value="loc.value"
              class="bg-surface-900 text-surface-200"
            >
              {{ loc.label }}
            </option>
          </select>

          <!-- Edit page button (dashboard only) -->
          <button
            v-if="isDashboard"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 cursor-pointer"
            :class="layoutStore.editMode
              ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-400/40'
              : 'text-surface-300 hover:text-white hover:bg-black/10 dark:hover:bg-white/10'"
            @click="layoutStore.toggleEditMode()"
          >
            <i-mdi-pencil-ruler class="w-4 h-4" />
            {{ t('nav.editPage') }}
          </button>

          <!-- Page config button (export/import) — dashboard only -->
          <div v-if="isDashboard" class="relative">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-surface-300 hover:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-all duration-200 cursor-pointer"
              @click.stop="configMenuOpen = !configMenuOpen"
            >
              <i-mdi-cog-transfer class="w-4 h-4" />
              {{ t('nav.pageConfig') }}
            </button>
            <div
              v-if="configMenuOpen"
              class="absolute right-0 top-full mt-1 min-w-[260px] rounded-xl shadow-2xl p-3 space-y-2"
              style="z-index: 9999; background: rgba(15,17,23,0.96); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.08)"
            >
              <button
                class="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs text-surface-200 hover:bg-surface-700/50 cursor-pointer transition-colors"
                @click="openExportDialog"
              >
                <i-mdi-download class="w-4 h-4 text-blue-400" />
                {{ t('nav.exportConfig') }}
              </button>
              <button
                class="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs text-surface-200 hover:bg-surface-700/50 cursor-pointer transition-colors"
                @click="openImportPicker"
              >
                <i-mdi-upload class="w-4 h-4 text-green-400" />
                {{ t('nav.importConfig') }}
              </button>
              <input ref="fileInput" type="file" accept=".json" class="hidden" @change="handleFileSelected" />

              <hr class="border-surface-700/50" />
              <p class="text-[10px] text-surface-500 px-1 leading-relaxed">
                {{ t('nav.configDesc') }}
              </p>
            </div>
            <div v-if="configMenuOpen" class="fixed inset-0 z-40" @click="configMenuOpen = false" />
          </div>

          <!-- Settings button -->
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-surface-300 hover:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-all duration-200 cursor-pointer"
            @click="router.push('/settings')"
          >
            <i-mdi-cog class="w-4 h-4" />
            {{ t('nav.settings') }}
          </button>

          <!-- Fork version badge -->
          <div class="flex flex-col items-end leading-tight">
            <span
              class="text-[11px] text-surface-500 font-mono cursor-default"
              :title="`Build ${settingsStore.commitHash}`"
            >v{{ settingsStore.forkVersion }}</span>
            <a
              v-if="settingsStore.forkUpdateAvailable"
              href="https://github.com/titouannwtt/frequi-fork/releases/latest"
              target="_blank"
              rel="noopener"
              class="fork-update-badge text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
            >
              {{ t('nav.newVersionAvailable') }}
            </a>
          </div>

          <!-- Logout -->
          <button
            v-if="botStore.hasBots && botStore.botCount === 1"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-surface-300 hover:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-all duration-200 cursor-pointer"
            @click="clickLogout"
          >
            <i-mdi-logout class="w-4 h-4" />
          </button>

          <div v-if="!botStore.hasBots">
            <LoginModal v-if="route?.path !== '/login'" />
          </div>
        </div>

        <!-- Mobile menu -->
        <div v-if="isMobile" class="ms-auto flex">
          <Button
            class="text-surface-300 text-xl"
            variant="text"
            @click="drawerVisible = !drawerVisible"
          >
            <template #icon>
              <i-mdi-menu />
            </template>
          </Button>
          <Drawer
            v-model:visible="drawerVisible"
            header="Drawer"
            position="right"
            class="bg-primary-500"
          >
            <template #container>
              <div class="flex flex-row items-center">
                <h3 class="text-xl font-bold w-full text-center text-surface-200">Freqtrade Ultimate</h3>
                <Button
                  class="float-right mt-1 me-1"
                  variant="outlined"
                  @click="drawerVisible = !drawerVisible"
                >
                  <template #icon>
                    <i-mdi-close />
                  </template>
                </Button>
              </div>
              <div class="flex flex-col gap-1 items-center mt-4">
                <RouterLink
                  v-for="(item, index) in navItems.filter((item) => item.visible ?? true)"
                  :key="index"
                  :to="item.to"
                  class="text-surface-200 p-2"
                  active-class="underline"
                >
                  {{ item.label }}
                </RouterLink>
                <Divider />
                <span
                  class="text-surface-400 text-xs font-mono"
                  :title="`Build ${settingsStore.commitHash}`"
                >v{{ settingsStore.forkVersion }}</span>
                <a
                  v-if="settingsStore.forkUpdateAvailable"
                  href="https://github.com/titouannwtt/frequi-fork/releases/latest"
                  target="_blank"
                  rel="noopener"
                  class="fork-update-badge text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                >
                  {{ t('nav.newVersionAvailable') }}
                </a>
                <div class="flex flex-row items-center justify-center gap-2">
                  <ThemeSelect show-text />
                  <select
                    :value="locale"
                    class="bg-transparent text-surface-300 text-xs border border-black/10 dark:border-white/10 rounded px-1.5 py-1"
                    @change="changeLocale(($event.target as HTMLSelectElement).value)"
                  >
                    <option
                      v-for="loc in availableLocales"
                      :key="loc.value"
                      :value="loc.value"
                      class="bg-surface-900 text-surface-200"
                    >
                      {{ loc.label }}
                    </option>
                  </select>
                </div>
              </div>
            </template>
          </Drawer>
        </div>
      </div>
    </div>

    <!-- Edit mode toolbar -->
    <Transition name="ft">
      <div
        v-if="layoutStore.editMode && isDashboard"
        class="edit-toolbar flex items-center justify-center flex-wrap gap-x-4 gap-y-1 py-2 px-4"
      >
        <span class="text-xs text-surface-400">{{ t('nav.editModeHint') }}</span>
        <div class="flex items-center gap-2">
          <i-mdi-eye-settings-outline class="w-3.5 h-3.5 text-surface-500" />
          <span class="text-xs text-surface-500">{{ t('nav.opacity') }}</span>
          <input
            type="range"
            :value="layoutStore.widgetOpacity"
            min="0.3"
            max="1"
            step="0.05"
            class="w-20 accent-indigo-500"
            @input="layoutStore.setWidgetOpacity(parseFloat(($event.target as HTMLInputElement).value))"
          />
          <span class="text-xs text-surface-500 w-8">{{ Math.round(layoutStore.widgetOpacity * 100) }}%</span>
        </div>
        <div class="w-px h-4 bg-white/10" />
        <div class="relative anim-popover-wrapper">
          <button
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer"
            :class="layoutStore.backgroundAnimation
              ? 'text-indigo-300 bg-indigo-500/15 border-indigo-400/30 hover:bg-indigo-500/25'
              : 'text-surface-500 border-surface-600 hover:text-surface-300 hover:border-surface-500'"
            @click="layoutStore.backgroundAnimation = !layoutStore.backgroundAnimation"
          >
            <i-mdi-waves class="w-3.5 h-3.5" />
            {{ t('nav.bgAnimation') }}
          </button>
          <div class="az-popover">
            <div class="az-popover-title">{{ t('nav.bgAnimation') }}</div>
            <p class="az-popover-desc">{{ t('nav.bgAnimationDesc') }}</p>
            <div class="az-demo">
              <div class="az-demo-row">
                <span class="az-demo-label">Activé</span>
                <div class="az-demo-viz anim-demo-on">
                  <div class="anim-demo-blob" />
                </div>
                <span class="az-demo-hint">Fond animé avec dégradés fluides</span>
              </div>
              <div class="az-demo-row">
                <span class="az-demo-label">Désactivé</span>
                <div class="az-demo-viz anim-demo-off">
                  <div class="anim-demo-blob" />
                </div>
                <span class="az-demo-hint">Fond statique, réduit l'utilisation GPU</span>
              </div>
            </div>
          </div>
        </div>
        <div class="w-px h-4 bg-white/10" />
        <div class="relative adaptive-zoom-wrapper">
          <button
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border transition-colors cursor-pointer"
            :class="layoutStore.adaptiveZoom
              ? 'text-indigo-300 bg-indigo-500/15 border-indigo-400/30 hover:bg-indigo-500/25'
              : 'text-surface-500 border-surface-600 hover:text-surface-300 hover:border-surface-500'"
            @click="layoutStore.adaptiveZoom = !layoutStore.adaptiveZoom"
          >
            <i-mdi-fit-to-screen class="w-3.5 h-3.5" />
            {{ t('nav.adaptiveZoom') }}
          </button>
          <div class="az-popover">
            <div class="az-popover-title">{{ t('nav.adaptiveZoom') }}</div>
            <p class="az-popover-desc">{{ t('nav.adaptiveZoomDesc') }}</p>
            <div class="az-demo">
              <div class="az-demo-row">
                <span class="az-demo-label">Activé</span>
                <div class="az-demo-viz az-demo-on">
                  <div class="az-demo-widget" />
                  <div class="az-demo-widget" />
                </div>
                <span class="az-demo-hint">Les widgets s'adaptent à la fenêtre</span>
              </div>
              <div class="az-demo-row">
                <span class="az-demo-label">Désactivé</span>
                <div class="az-demo-viz az-demo-off">
                  <div class="az-demo-widget" />
                  <div class="az-demo-widget" />
                </div>
                <span class="az-demo-hint">Taille fixe, identique sur tous les écrans</span>
              </div>
            </div>
          </div>
        </div>
        <div class="w-px h-4 bg-white/10" />
        <button
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md text-blue-300 bg-blue-500/10 border border-blue-400/20 hover:bg-blue-500/20 transition-colors cursor-pointer"
          @click="confirmOptimizeLayout"
        >
          <i-mdi-view-compact class="w-3.5 h-3.5" />
          {{ t('nav.optimizeLayout') }}
        </button>
        <button
          class="px-3 py-1 text-xs rounded-md text-surface-400 hover:text-red-300 hover:bg-red-500/10 border border-surface-600 hover:border-red-400/30 transition-colors cursor-pointer"
          @click="confirmResetLayout"
        >
          <i-mdi-lock-reset class="inline w-3.5 h-3.5 mr-1" />
          {{ t('nav.resetLayout') }}
        </button>
        <button
          class="px-3 py-1 text-xs rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 hover:bg-indigo-500/30 transition-colors cursor-pointer"
          @click="layoutStore.toggleEditMode()"
        >
          {{ t('nav.editModeDone') }}
        </button>
      </div>
    </Transition>

    <!-- ═══ Export Dialog ═══ -->
    <Dialog
      v-model:visible="exportDialogVisible"
      :header="t('nav.exportConfig')"
      modal
      :style="{ width: '420px' }"
      :pt="{ root: { class: 'config-dialog' } }"
    >
      <div class="space-y-4">
        <!-- Auth toggle -->
        <div class="flex items-start gap-3 p-3 rounded-lg bg-surface-100 dark:bg-surface-800/50">
          <input
            id="includeAuth"
            v-model="includeAuthInExport"
            type="checkbox"
            class="mt-0.5 w-4 h-4 accent-blue-500 cursor-pointer"
          />
          <div>
            <label for="includeAuth" class="text-sm font-medium cursor-pointer">
              {{ t('nav.includeAuth') }}
            </label>
            <p class="text-xs text-surface-500 mt-0.5">
              {{ includeAuthInExport ? t('nav.authIncludedDesc') : t('nav.layoutOnlyDesc') }}
            </p>
          </div>
        </div>

        <!-- Password field (required when auth is included) -->
        <div v-if="includeAuthInExport" class="space-y-3">
          <div class="flex items-start gap-1.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/15">
            <i-mdi-shield-lock class="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p class="text-xs text-amber-300/90 leading-relaxed">
              {{ t('nav.authPasswordRequired') }}
            </p>
          </div>
          <div>
            <label class="text-xs text-surface-400 mb-1 block">{{ t('nav.encryptionPassword') }}</label>
            <input
              v-model="exportPassword"
              type="password"
              :placeholder="t('nav.passwordMinChars')"
              class="w-full px-3 py-2 text-sm rounded-lg border bg-surface-50 dark:bg-surface-800 border-surface-300 dark:border-surface-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
            />
            <p v-if="exportPassword.length > 0 && exportPassword.length < 8" class="text-[11px] text-red-400 mt-1">
              {{ t('nav.passwordMinChars') }}
            </p>
          </div>
        </div>

        <!-- Export error -->
        <div v-if="exportError" class="flex items-center gap-1.5 p-2 rounded-lg bg-red-500/10 border border-red-500/15">
          <i-mdi-alert-circle class="w-4 h-4 text-red-400 flex-shrink-0" />
          <p class="text-xs text-red-400">{{ exportError }}</p>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2 pt-2">
          <Button size="small" severity="secondary" @click="exportDialogVisible = false">
            {{ t('nav.cancel') }}
          </Button>
          <Button size="small" :disabled="!canExport" @click="confirmExport">
            <i-mdi-download class="w-4 h-4 mr-1" />
            {{ t('nav.export') }}
          </Button>
        </div>
      </div>
    </Dialog>

    <!-- ═══ Import Preview Dialog ═══ -->
    <Dialog
      v-model:visible="importPreviewVisible"
      :header="t('nav.importPreview')"
      modal
      :style="{ width: '450px' }"
      :pt="{ root: { class: 'config-dialog' } }"
    >
      <!-- Parse error -->
      <div v-if="!configPreview && importError" class="p-4 text-center">
        <i-mdi-alert-circle class="w-8 h-8 text-red-400 mx-auto mb-2" />
        <p class="text-sm text-red-400">{{ importError }}</p>
      </div>

      <!-- Preview content -->
      <div v-else-if="configPreview" class="space-y-3">
        <!-- Summary rows -->
        <div class="divide-y divide-surface-200 dark:divide-surface-700 rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden text-sm">
          <!-- Export date -->
          <div class="flex justify-between px-3 py-2 bg-surface-50 dark:bg-surface-800/50">
            <span class="text-surface-500">{{ t('nav.exportDate') }}</span>
            <span>{{ formatPreviewDate(configPreview.exportedAt) }}</span>
          </div>

          <!-- File age -->
          <div class="flex justify-between px-3 py-2">
            <span class="text-surface-500">{{ t('nav.fileAge') }}</span>
            <span :class="configPreview.isExpired ? 'text-amber-400 font-medium' : ''">
              {{ configPreview.ageInDays }} {{ t('nav.daysUnit') }}
            </span>
          </div>

          <!-- Auth status -->
          <div class="flex justify-between px-3 py-2 bg-surface-50 dark:bg-surface-800/50">
            <span class="text-surface-500">{{ t('nav.containsAuth') }}</span>
            <span v-if="!configPreview.includesAuth" class="text-green-400">{{ t('nav.authNotIncluded') }}</span>
            <span v-else-if="configPreview.encrypted" class="text-blue-400">
              <i-mdi-lock class="inline w-3.5 h-3.5 mr-0.5" />{{ t('nav.authEncrypted') }}
            </span>
            <span v-else class="text-amber-400">{{ t('nav.authUnencrypted') }}</span>
          </div>

          <!-- Settings count -->
          <div v-if="!configPreview.encrypted" class="flex justify-between px-3 py-2">
            <span class="text-surface-500">{{ t('nav.settingsCount') }}</span>
            <span>{{ configPreview.settingsCount }}</span>
          </div>

          <!-- Bot count -->
          <div v-if="configPreview.botCount > 0" class="flex justify-between px-3 py-2 bg-surface-50 dark:bg-surface-800/50">
            <span class="text-surface-500">{{ t('nav.botsCount') }}</span>
            <span>{{ configPreview.botCount }}</span>
          </div>

          <!-- Integrity -->
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

        <!-- Integrity failure warning -->
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
          <Button size="small" severity="secondary" @click="importPreviewVisible = false">
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

    <!-- ═══ Optimize Layout Confirmation ═══ -->
    <Dialog
      v-model:visible="optimizeConfirmVisible"
      :header="t('nav.optimizeLayout')"
      modal
      :style="{ width: '440px' }"
      :pt="{ root: { class: 'config-dialog' } }"
    >
      <div class="space-y-4">
        <div class="flex items-start gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/15">
          <i-mdi-view-compact class="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <p class="text-sm text-surface-300 leading-relaxed">
            {{ t('nav.optimizeLayoutConfirm') }}
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <Button
            :label="t('nav.cancel')"
            severity="secondary"
            text
            @click="optimizeConfirmVisible = false"
          />
          <Button
            :label="t('nav.optimizeLayout')"
            severity="info"
            @click="executeOptimizeLayout"
          />
        </div>
      </div>
    </Dialog>

    <!-- ═══ Reset Layout Confirmation ═══ -->
    <Dialog
      v-model:visible="resetConfirmVisible"
      :header="t('nav.resetLayout')"
      modal
      :style="{ width: '420px' }"
      :pt="{ root: { class: 'config-dialog' } }"
    >
      <div class="space-y-4">
        <div class="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/15">
          <i-mdi-alert class="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <p class="text-sm text-surface-300 leading-relaxed">
            {{ t('nav.resetLayoutConfirm') }}
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <Button
            :label="t('nav.cancel')"
            severity="secondary"
            text
            @click="resetConfirmVisible = false"
          />
          <Button
            :label="t('nav.resetLayout')"
            severity="danger"
            @click="resetDynamicLayout"
          />
        </div>
      </div>
    </Dialog>

  </header>
</template>

<style scoped>
.navbar-glass {
  position: relative;
  z-index: 50;
  background: rgba(15, 15, 25, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.nav-link-active {
  color: white !important;
  background: rgba(99, 102, 241, 0.25);
  box-shadow: inset 0 -2px 0 0 rgba(99, 102, 241, 0.8);
}

.edit-toolbar {
  background: rgba(15, 15, 25, 0.9);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(99, 102, 241, 0.2);
  z-index: 49;
  overflow: visible;
}

.fork-update-badge {
  background: linear-gradient(135deg, rgba(251, 146, 60, 0.25), rgba(249, 115, 22, 0.35));
  color: #fb923c;
  border: 1px solid rgba(251, 146, 60, 0.4);
  animation: fork-pulse 2s ease-in-out 3;
  text-decoration: none;
}
.fork-update-badge:hover {
  background: linear-gradient(135deg, rgba(251, 146, 60, 0.35), rgba(249, 115, 22, 0.5));
  color: #fdba74;
}

@keyframes fork-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}

/* ── Adaptive-zoom popover ── */
.adaptive-zoom-wrapper {
  position: relative;
}
.az-popover {
  display: none;
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: 300px;
  padding: 12px 14px;
  background: rgba(20, 20, 35, 0.97);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(99, 102, 241, 0.3);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
  z-index: 9999;
  pointer-events: none;
}
:root:not(.ft-dark-theme) .az-popover {
  background: rgba(245, 242, 238, 0.97);
  border: 1px solid rgba(99, 102, 241, 0.2);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
}
.adaptive-zoom-wrapper:hover .az-popover {
  display: block;
}
.az-popover-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 4px;
}
:root:not(.ft-dark-theme) .az-popover-title {
  color: #1a1a1a;
}
.az-popover-desc {
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.4;
  margin-bottom: 10px;
}
:root:not(.ft-dark-theme) .az-popover-desc {
  color: rgba(0, 0, 0, 0.6);
}
.az-demo {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.az-demo-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.az-demo-label {
  font-size: 0.625rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  width: 56px;
  flex-shrink: 0;
}
:root:not(.ft-dark-theme) .az-demo-label {
  color: rgba(0, 0, 0, 0.7);
}
.az-demo-viz {
  display: flex;
  gap: 4px;
  align-items: flex-end;
  height: 28px;
  flex-shrink: 0;
}
.az-demo-widget {
  border-radius: 3px;
  background: rgba(99, 102, 241, 0.3);
  border: 1px solid rgba(99, 102, 241, 0.5);
}
.az-demo-on .az-demo-widget:first-child {
  width: 32px;
  height: 20px;
  animation: az-breathe 2.5s ease-in-out infinite;
}
.az-demo-on .az-demo-widget:last-child {
  width: 24px;
  height: 16px;
  animation: az-breathe 2.5s ease-in-out 0.3s infinite;
}
.az-demo-off .az-demo-widget:first-child {
  width: 28px;
  height: 18px;
}
.az-demo-off .az-demo-widget:last-child {
  width: 28px;
  height: 18px;
}
.az-demo-hint {
  font-size: 0.5625rem;
  color: rgba(255, 255, 255, 0.4);
  flex: 1;
}
:root:not(.ft-dark-theme) .az-demo-hint {
  color: rgba(0, 0, 0, 0.45);
}
@keyframes az-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}

/* ── Animation popover ── */
.anim-popover-wrapper {
  position: relative;
}
.anim-popover-wrapper:hover .az-popover {
  display: block;
}
.anim-demo-on {
  width: 60px;
  height: 28px;
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}
.anim-demo-on .anim-demo-blob {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.4), rgba(168, 85, 247, 0.3), rgba(59, 130, 246, 0.3));
  background-size: 200% 200%;
  animation: anim-gradient-move 3s ease-in-out infinite;
  border-radius: 4px;
}
.anim-demo-off {
  width: 60px;
  height: 28px;
  border-radius: 4px;
  overflow: hidden;
}
.anim-demo-off .anim-demo-blob {
  width: 100%;
  height: 100%;
  background: rgba(40, 40, 60, 0.6);
  border: 1px solid rgba(100, 100, 140, 0.2);
  border-radius: 4px;
}
:root:not(.ft-dark-theme) .anim-demo-off .anim-demo-blob {
  background: rgba(0, 0, 0, 0.08);
  border: 1px solid rgba(0, 0, 0, 0.12);
}
@keyframes anim-gradient-move {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
</style>
