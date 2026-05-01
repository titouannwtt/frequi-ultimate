<script setup lang="ts">
import Favico from 'favico.js';

import { useRoute } from 'vue-router';
import Menu from 'primevue/menu';
import type { MenuItem } from 'primevue/menuitem';
import { breakpointsTailwind } from '@vueuse/core';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const botStore = useBotStore();

const settingsStore = useSettingsStore();
const layoutStore = useLayoutStore();
const route = useRoute();
const router = useRouter();
const favicon = ref<Favico | undefined>(undefined);
const pingInterval = ref<number>();

const breakpoints = useBreakpoints(breakpointsTailwind);

const isMobile = breakpoints.smallerOrEqual('md');

async function clickLogout() {
  botStore.removeBot(botStore.selectedBot);
  // TODO: This should be per bot
  await router.push('/');
}

const setOpenTradesAsPill = (tradeCount: number) => {
  if (!favicon.value) {
    favicon.value = new Favico({
      animation: 'none',
      // position: 'up',
      // fontStyle: 'normal',
      // bgColor: '#',
      // textColor: '#FFFFFF',
    });
  }
  if (tradeCount !== 0 && settingsStore.openTradesInTitle === 'showPill') {
    favicon.value.badge(tradeCount);
  } else {
    favicon.value.reset();
    console.log('reset');
  }
};
const resetDynamicLayout = (): void => {
  console.log(`resetLayout called for ${route?.fullPath}`);
  switch (route?.fullPath) {
    case '/trade':
      layoutStore.resetTradingLayout();
      break;
    case '/dashboard':
      layoutStore.resetDashboardLayout();
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

// Navigation items array
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
    label: t('nav.chart'),
    to: '/graph',
    icon: 'i-mdi-chart-line',
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
    visible: botStore.activeBot?.isBotOnline ?? false,
  },
]);

const menuItems = computed<MenuItem[]>(() => [
  {
    label: `V: ${settingsStore.uiVersion}`,
    disabled: true,
  },
  {
    label: t('nav.settings'),
    icon: 'i-mdi-cog',
    command: () => router.push('/settings'),
  },
  {
    label: t('nav.lockLayout'),
    checkbox: true,
    checked: layoutStore.layoutLocked,
    command: () => {
      layoutStore.layoutLocked = !layoutStore.layoutLocked;
    },
  },
  {
    label: t('nav.resetLayout'),
    icon: 'i-mdi-lock-reset',
    command: resetDynamicLayout,
  },
  {
    label: t('nav.logout'),
    icon: 'i-mdi-logout',
    command: clickLogout,
    visible: botStore.hasBots && botStore.botCount === 1,
  },
]);
const menu = ref<InstanceType<typeof Menu> | null>();
function toggleMenu(event) {
  menu.value?.toggle(event);
}
const drawerVisible = ref(false);

function exportPDF() {
  window.print();
}
</script>

<template>
  <header>
    <div class="navbar-glass flex border-b border-white/10">
      <RouterLink class="ms-2 flex flex-row items-center pe-2 gap-2" exact to="/">
        <img class="h-[30px] align-middle" src="@/assets/freqtrade-logo.png" alt="Home Logo" />
        <span class="text-slate-200 text-xl md:hidden lg:inline text-nowrap font-semibold">Freqtrade UI</span>
      </RouterLink>
      <div class="flex justify-between w-full text-center items-center ms-3">
        <div class="items-center hidden md:flex gap-1 ms-5">
          <RouterLink
            v-for="(item, index) in navItems.filter(
              (item) => (item.visible ?? true) && !item.mobileOnly,
            )"
            :key="index"
            :to="item.to"
            class="nav-link text-surface-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 hover:text-white hover:bg-white/10"
            active-class="nav-link-active"
          >
            <i-mdi-swap-horizontal v-if="item.icon === 'i-mdi-swap-horizontal'" class="w-4 h-4" />
            <i-mdi-view-dashboard v-else-if="item.icon === 'i-mdi-view-dashboard'" class="w-4 h-4" />
            <i-mdi-chart-line v-else-if="item.icon === 'i-mdi-chart-line'" class="w-4 h-4" />
            <i-mdi-text-box v-else-if="item.icon === 'i-mdi-text-box'" class="w-4 h-4" />
            <i-mdi-cog v-else-if="item.icon === 'i-mdi-cog'" class="w-4 h-4" />
            <i-mdi-flask v-else-if="item.icon === 'i-mdi-flask'" class="w-4 h-4" />
            <i-mdi-download v-else-if="item.icon === 'i-mdi-download'" class="w-4 h-4" />
            <i-mdi-format-list-numbered-rtl v-else-if="item.icon === 'i-mdi-format-list-numbered-rtl'" class="w-4 h-4" />
            <i-mdi-flask-outline v-else-if="item.icon === 'i-mdi-flask-outline'" class="w-4 h-4" />
            {{ item.label }}
          </RouterLink>
          <button
            class="nav-link text-surface-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 hover:text-white hover:bg-white/10 cursor-pointer"
            :title="t('nav.exportPdf')"
            @click="exportPDF"
          >
            <i-mdi-file-pdf class="w-4 h-4" />
          </button>
          <ConfigExportButton />
          <ThemeSelect />
        </div>

        <!-- Right aligned nav items -->
        <div v-if="!isMobile" class="flex ms-auto">
          <!-- TODO This should show outside of the dropdown in XS mode -->
          <div
            v-if="!settingsStore.confirmDialog"
            class="my-auto me-5 flex text-yellow-300"
            :title="t('general.confirmDialogDeactivated')"
          >
            <i-mdi-run-fast />
            <i-mdi-alert />
          </div>
          <div class="flex justify-between">
            <Select
              v-if="botStore.botCount > 1"
              :model-value="botStore.selectedBotObj"
              size="small"
              class="m-1"
              no-caret
              severity="info"
              toggle-class="flex align-items-center "
              menu-class="my-0 py-0"
              :options="botStore.availableBotsSorted"
              @update:model-value="botStore.selectBot($event.botId)"
            >
              <template #value="{ value }">
                <BotEntry :bot="value" :no-buttons="true" />
              </template>

              <template #option="{ option }">
                <BotEntry :bot="option" :no-buttons="true" />
              </template>
            </Select>
            <ReloadControl class="me-3" title="Confirm Dialog deactivated." />
          </div>
          <div
            class="hidden md:flex md:flex-wrap lg:flex-nowrap items-center nav-item text-surface-300 me-2"
          >
            <span class="text-sm me-2">
              {{
                (botStore.activeBotorUndefined && botStore.activeBotorUndefined.botName) ||
                t('general.noBotSelected')
              }}
            </span>
            <span v-if="botStore.botCount === 1">
              {{
                botStore.activeBotorUndefined && botStore.activeBotorUndefined.isBotOnline
                  ? t('general.online')
                  : t('general.offline')
              }}
            </span>
          </div>
          <div v-if="botStore.hasBots" class="flex items-center">
            <!-- Hide dropdown on xs, instead show below  -->
            <Button severity="contrast" variant="text" size="small" @click="toggleMenu">
              <div class="flex items-center">
                <Avatar shape="circle" severity="contrast">
                  <!-- <Avatar label="FT" shape="circle"></Avatar> -->
                  FT
                </Avatar>
                <i-mdi-chevron-down />
              </div>
            </Button>
            <Menu ref="menu" :model="menuItems" popup class="w-56">
              <template #item="{ item }">
                <div
                  class="flex flex-row items-center gap-2 p-1"
                  :class="{
                    'cursor-pointer': !item.disabled,
                  }"
                >
                  <i-mdi-cog v-if="item.icon === 'i-mdi-cog'" />
                  <i-mdi-logout v-if="item.icon === 'i-mdi-logout'" />
                  <i-mdi-lock-reset v-if="item.icon === 'i-mdi-lock-reset'" />
                  <BaseCheckbox v-if="item.checkbox" v-model="item.checked" />
                  <span>{{ item.label }}</span>
                </div>
              </template>
            </Menu>
          </div>
          <div v-else>
            <!-- should open Modal window! -->
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
                <h3 class="text-xl font-bold w-full text-center text-surface-200">Freqtrade UI</h3>
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
                <span class="text-surface-200 text-center"
                  >{{ t('general.version') }}: {{ settingsStore.uiVersion }}</span
                >

                <div class="flex flex-row items-center justify-center">
                  <ThemeSelect show-text />
                </div>
                <Select
                  v-if="botStore.botCount > 1"
                  :model-value="botStore.selectedBotObj"
                  size="small"
                  class="m-1"
                  no-caret
                  severity="info"
                  toggle-class="flex align-items-center "
                  menu-class="my-0 py-0"
                  :options="botStore.availableBotsSorted"
                  @update:model-value="botStore.selectBot($event.botId)"
                >
                  <template #value="{ value }">
                    <BotEntry :bot="value" :no-buttons="true" />
                  </template>

                  <template #option="{ option }">
                    <BotEntry :bot="option" :no-buttons="true" />
                  </template>
                </Select>
                <ReloadControl class="justify-center w-full" title="Confirm Dialog deactivated." />
              </div>
            </template>
          </Drawer>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.navbar-glass {
  background: rgba(15, 15, 25, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.nav-link-active {
  color: white !important;
  background: rgba(99, 102, 241, 0.25);
  box-shadow: inset 0 -2px 0 0 rgba(99, 102, 241, 0.8);
}

@media print {
  header {
    display: none !important;
  }
}
</style>
