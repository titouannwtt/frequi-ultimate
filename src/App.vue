<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';

import { AdaptiveSheet } from '@/components/ds';
import { AppShell, LogStream, ShortcutHelp, SystemHealth } from '@/components/fq';
import type { ShellPage } from '@/components/fq';
import { useDataSource } from '@/composables/useDataSource';
import { useShellBus } from '@/composables/useShellBus';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import { loadLanguage } from '@/locales';
import { defaultBotKey } from '@/router';
import { TOOL_PATHS, type ToolId } from '@/router/legacy';

const settingsStore = useSettingsStore();
const colorStore = useColorStore();
const route = useRoute();
const router = useRouter();
const { locale } = useI18n();
const data = useDataSource();
const fleet = useFqFleetStore();
const prefs = useFqPrefsStore();
const bus = useShellBus();

onMounted(() => {
  setTimezone(settingsStore.timezone);
  colorStore.updateProfitLossColor();
});
watch(
  () => settingsStore.timezone,
  (tz) => setTimezone(tz),
);

// ---- the data layer starts once, with the shell (not for the design system showcase) ----
const bare = computed(() => route.meta.bare === true);
const shellPage = computed<ShellPage>(() => (route.meta.page as ShellPage | undefined) ?? 'fleet');
const legacy = computed(() => route.meta.legacy === true);
const currentBotKey = computed(() => (route.name === 'bot' ? String(route.params.botKey) : null));

let started = false;
watch(
  bare,
  (isBare) => {
    if (!isBare && !started) {
      started = true;
      void data.start();
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (started) data.stop();
});

// ---- hand over from the static splash of index.html once something is on screen ----
function dropSplash() {
  document.getElementById('ft-boot-splash')?.remove();
}
watch(
  () => fleet.loaded,
  (loaded) => loaded && dropSplash(),
);
onMounted(() => {
  window.setTimeout(dropSplash, bare.value ? 0 : 2500);
});

// ---- navigation of the shell ----
function go(target: string) {
  if (target.startsWith('tools:')) {
    const id = target.slice('tools:'.length) as ToolId;
    void router.push(TOOL_PATHS[id] ?? '/tools');
    return;
  }
  switch (target) {
    case 'fleet':
      void router.push({ name: 'fleet' });
      break;
    case 'bot': {
      const key = currentBotKey.value ?? defaultBotKey();
      void router.push(key ? { name: 'bot', params: { botKey: key } } : { name: 'login' });
      break;
    }
    case 'charts':
    case 'journal':
    case 'tools':
    case 'settings':
      void router.push({ name: target });
      break;
  }
}

function openBot(botKey: string) {
  void router.push({ name: 'bot', params: { botKey } });
}
function openPair(pair: string, botKey: string) {
  // On the Charts page a pair stays on the Charts page
  if (route.name === 'charts') {
    void router.replace({ name: 'charts', query: { ...route.query, pair, bot: botKey } });
    return;
  }
  void router.push({ name: 'bot', params: { botKey }, query: { pair } });
}
function openTrade(botKey: string, tradeId: number) {
  void router.push({ name: 'bot', params: { botKey }, query: { trade: String(tradeId) } });
}
function onBell() {
  if (route.name === 'fleet') bus.focusAttention();
  else void router.push({ name: 'fleet', hash: '#attention' });
}
function onDisplay(command: 'view' | 'language') {
  if (command === 'language') {
    const next = locale.value === 'fr' ? 'en' : 'fr';
    void loadLanguage(next);
    prefs.update('locale', next);
  } else {
    bus.toggleView();
  }
}
</script>

<template>
  <div id="app" :style="colorStore.cssVars">
    <RouterView v-if="bare" />
    <template v-else>
      <AppShell
        :page="shellPage"
        :current-bot-key="currentBotKey"
        @navigate="go"
        @open-bot="openBot"
        @open-pair="openPair"
        @open-trade="openTrade"
        @bell="onBell"
        @open-health="bus.healthOpen.value = true"
        @open-logs="((bus.logsBot.value = null), (bus.logsOpen.value = true))"
        @help="bus.helpOpen.value = true"
        @display="onDisplay"
      >
        <RouterView v-slot="{ Component }">
          <!-- Pages that still run on the legacy stores keep the look their styles expect -->
          <div v-if="legacy" class="legacy-host">
            <component :is="Component" />
          </div>
          <component :is="Component" v-else />
        </RouterView>
      </AppShell>
      <AdaptiveSheet
        :open="bus.healthOpen.value"
        :title="$t('fq.ds.health.title')"
        @close="bus.healthOpen.value = false"
      >
        <SystemHealth
          detail
          @open-logs="((bus.healthOpen.value = false), (bus.logsOpen.value = true))"
        />
      </AdaptiveSheet>
      <AdaptiveSheet
        :open="bus.logsOpen.value"
        :title="$t('fq.ds.logs')"
        @close="bus.logsOpen.value = false"
      >
        <LogStream
          mode="compact"
          :bot="bus.logsBot.value"
          @update:bot="(k) => (bus.logsBot.value = k)"
          @open-bot="(k) => ((bus.logsOpen.value = false), openBot(k))"
        />
      </AdaptiveSheet>
      <ShortcutHelp :open="bus.helpOpen.value" @close="bus.helpOpen.value = false" />
    </template>
    <Toast />
  </div>
</template>

<style scoped>
#app {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.legacy-host {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  text-align: center;
  min-height: 100%;
  /* The old tools are not built for a phone: scroll them sideways instead of clipping them */
  overflow-x: auto;
}
</style>

<style scoped>
/* Toast container must not intercept clicks on elements below it (navbar).
   PrimeVue sets position:fixed + high z-index on .p-toast, which can cover
   the navbar and swallow click events even when no messages are visible. */
:global(.p-toast) {
  pointer-events: none !important;
}
:global(.p-toast-message) {
  pointer-events: auto;
}
</style>
