<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  AdaptiveSheet,
  Banner,
  Btn,
  ConnectionPill,
  DsIcon,
  IconBtn,
  Menu,
  StatusBar,
  TabBar,
  Toaster,
} from '@/components/ds';
import type { Density, MenuItem, TabBarItem } from '@/components/ds';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useActionDialog } from '@/composables/useActionDialog';
import { useCommandPalette } from '@/composables/useCommandPalette';
import { useDataSource } from '@/composables/useDataSource';
import { useShortcuts } from '@/composables/useShortcuts';
import { useTheme } from '@/composables/useTheme';
import { useFqAlertsStore } from '@/datasource/stores/alerts';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqHealthStore } from '@/datasource/stores/health';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { DataSource } from '@/datasource/types';

import ActionDialogHost from './ActionDialogHost.vue';
import CommandPalette, { type PalettePage } from './CommandPalette.vue';
import { formatClockSeconds } from './lib/time';

export type ShellPage = 'fleet' | 'bot' | 'charts' | 'journal' | 'tools' | 'settings';

/**
 * The shell shared by every page (02 sections 2.3 to 2.5): the top bar (logo, the four pages,
 * "Tools", the palette, the connection pill, the bell, the theme, the settings), the global
 * banners derived from the connection (cache, degraded, offline, direct mode), a strip and a
 * scope bar from the page, the content, then the status bar on a desktop or the tab bar below
 * 1024 px. It also mounts the three things that must exist exactly once: the command palette,
 * the confirmation dialog and the toasts.
 */
const props = defineProps<{
  page: ShellPage;
  /** Previews and tests: where confirmed actions go; by default the active data source. */
  source?: DataSource | null;
  inline?: boolean;
  /** Fill the box it is in instead of the window (previews). */
  contained?: boolean;
  /** Bot of the page, for the actions of the palette (Bot page). */
  currentBotKey?: string | null;
}>();

const emit = defineEmits<{
  navigate: [target: string];
  bell: [];
  openBot: [botKey: string];
  openPair: [pair: string, botKey: string];
  openTrade: [botKey: string, tradeId: number];
  toastAction: [actionId: string];
  openHealth: [];
  openLogs: [];
  help: [];
  /** A "Display" command of the palette that the page owns (`view`, `language`). */
  display: [command: 'view' | 'language'];
}>();

const { t } = useI18n();
const conn = useFqConnectionStore();
const alerts = useFqAlertsStore();
const health = useFqHealthStore();
const fleetStore = useFqFleetStore();
const prefs = useFqPrefsStore();
const theme = useTheme();
const data = useDataSource();
const palette = useCommandPalette();
const dialog = useActionDialog();
const clock = useNowMs();

// ---- navigation ----
const PAGES: Array<{
  id: ShellPage;
  icon: 'layout-grid' | 'bot' | 'chart-candlestick' | 'book-open-text';
}> = [
  { id: 'fleet', icon: 'layout-grid' },
  { id: 'bot', icon: 'bot' },
  { id: 'charts', icon: 'chart-candlestick' },
  { id: 'journal', icon: 'book-open-text' },
];
const TOOLS_PRIMARY = ['diagnostic', 'reconciliation', 'risk', 'logs'] as const;
const TOOLS_LAB = [
  'strategyDev',
  'backtest',
  'downloadData',
  'pairlistConfig',
  'replay',
  'volume',
] as const;

const toolsOpen = ref(false);
const toolsAnchor = ref<HTMLElement | null>(null);
const toolsItems = computed<MenuItem[]>(() => [
  ...TOOLS_PRIMARY.map((id) => ({ id, label: t(`fq.tools.${id}`) })),
  { id: '__sep', kind: 'separator' as const },
  ...TOOLS_LAB.map((id) => ({ id, label: t(`fq.tools.${id}`) })),
]);
function toggleTools(e: MouseEvent) {
  toolsAnchor.value = e.currentTarget as HTMLElement;
  toolsOpen.value = !toolsOpen.value;
}

function go(target: string) {
  emit('navigate', target);
}

// ---- connection ----
const now = computed(() => clock.value);
const connKind = computed(() => conn.kind ?? 'gateway');
const frozenAt = computed(() =>
  conn.status.lastSyncMs > 0 ? formatClockSeconds(conn.status.lastSyncMs, prefs.settings.tz) : '',
);
const cacheAgeMin = computed(() =>
  conn.cachedAtMs == null ? 0 : Math.max(0, Math.floor((now.value - conn.cachedAtMs) / 60_000)),
);
const probeIn = computed(() =>
  conn.nextProbeAtMs == null ? 0 : Math.max(0, Math.ceil((conn.nextProbeAtMs - now.value) / 1000)),
);

type Banners = Array<{
  kind: 'cache' | 'degraded' | 'offline' | 'direct';
  text: string;
  action?: string;
}>;
const banners = computed<Banners>(() => {
  const out: Banners = [];
  if (conn.fromCache) {
    out.push({ kind: 'cache', text: t('fq.freshness.dataFrom', { n: cacheAgeMin.value }) });
  }
  if (conn.status.state === 'degraded')
    out.push({ kind: 'degraded', text: t('fq.banner.degraded') });
  if (conn.status.state === 'offline') {
    out.push({ kind: 'offline', text: t('fq.banner.offline', { time: frozenAt.value }) });
  }
  if (conn.kind === 'direct') {
    out.push({
      kind: 'direct',
      text: t('fq.banner.direct', { n: probeIn.value }),
      action: t('fq.banner.probeNow'),
    });
  }
  return out;
});

// ---- bell ----
const bell = computed(() => alerts.bellCount(now.value));

// ---- status bar and density ----
const healthLevel = computed(() => {
  const l = health.health?.level;
  return l === 'critical'
    ? ('crit' as const)
    : l === 'degraded'
      ? ('degraded' as const)
      : ('ok' as const);
});
const liveBots = computed(() => {
  const live = fleetStore.list.filter((b) => b.identity.mode === 'live');
  return {
    online: live.filter((b) => b.state.status === 'online').length,
    // Bots being read for the first time (direct mode reads them in turn): the count is partial
    starting: live.filter((b) => b.state.status === 'starting').length,
    total: live.length,
  };
});
const logErrors = computed(
  () =>
    alerts
      .view(now.value, 'active')
      .filter((a) => a.type_id === 'logErrors' || a.type_id === 'orderFailed').length,
);
const ageLabel = computed(() => {
  const s = health.health?.digest_age_s;
  return s == null ? null : s < 120 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`;
});
const density = useLocalStorage<Density>('fqu2.density', 'compact');
watch(
  density,
  (d) => {
    if (typeof document === 'undefined') return;
    if (d === 'comfortable') document.documentElement.setAttribute('data-density', 'comfortable');
    else document.documentElement.removeAttribute('data-density');
  },
  { immediate: true },
);

// ---- phone: tab bar and "More" ----
const moreOpen = ref(false);
const tabItems = computed<TabBarItem[]>(() => [
  ...PAGES.map((p) => ({
    id: p.id,
    label: t(`fq.nav.${p.id}`),
    icon: p.icon,
    count: p.id === 'fleet' && bell.value > 0 ? bell.value : undefined,
  })),
  { id: 'more', label: t('fq.nav.more'), icon: 'ellipsis' as const },
]);
function onTab(id: string) {
  if (id === 'more') moreOpen.value = true;
  else go(id);
}

const themeIcon = computed(() =>
  theme.mode.value === 'dark'
    ? ('moon' as const)
    : theme.mode.value === 'light'
      ? ('sun' as const)
      : ('monitor' as const),
);

// ---- shortcuts ----
const GOTO: Record<string, string> = {
  d: 'fleet',
  b: 'bot',
  c: 'charts',
  j: 'journal',
  s: 'settings',
};
useShortcuts([
  ...Object.entries(GOTO).map(([k, target]) => ({
    id: `goto.${k}`,
    keys: `g ${k}`,
    labelKey: `fq.nav.${target}`,
    group: 'goto' as const,
    run: () => go(target),
  })),
  {
    id: 'theme.cycle',
    keys: 't',
    labelKey: 'fq.shortcut.theme',
    group: 'display',
    run: () => theme.cycle(),
  },
  {
    id: 'help',
    keys: '?',
    labelKey: 'fq.shortcut.help',
    group: 'general',
    run: () => emit('help'),
  },
]);

function onToastAction(_id: number, actionId: string) {
  // "Retry" opens a NEW confirmation (a new idempotency key): it never replays the request
  if (actionId === 'retry') dialog.retryLast();
  else emit('toastAction', actionId);
}

function onPaletteDisplay(command: 'view' | 'density' | 'language') {
  if (command === 'density')
    density.value = density.value === 'compact' ? 'comfortable' : 'compact';
  else emit('display', command);
}

function onPaletteNavigate(page: PalettePage) {
  go(page);
}

function openPalette() {
  palette.show();
}
</script>

<template>
  <div class="shell fq-app" :class="{ contained }" :data-page="page">
    <header class="top">
      <button type="button" class="logo" :aria-label="t('fq.shell.home')" @click="go('fleet')">
        <DsIcon name="activity" :size="20" />
        <b>FreqUI</b><span class="sub">Ultimate</span>
      </button>
      <nav class="nav" :aria-label="t('fq.shell.navigation')">
        <button
          v-for="p in PAGES"
          :key="p.id"
          type="button"
          class="nl"
          :class="{ on: page === p.id }"
          :aria-current="page === p.id ? 'page' : undefined"
          :data-nav="p.id"
          @click="go(p.id)"
        >
          <DsIcon :name="p.icon" />
          {{ t(`fq.nav.${p.id}`) }}
        </button>
        <button
          type="button"
          class="nl tools"
          :class="{ on: page === 'tools' }"
          :aria-expanded="toolsOpen"
          aria-haspopup="menu"
          data-nav="tools"
          @click="toggleTools"
        >
          <DsIcon name="wrench" />
          {{ t('fq.nav.tools') }}
          <DsIcon name="chevron-down" :size="13" />
        </button>
        <Menu
          :open="toolsOpen"
          :anchor="toolsAnchor"
          :items="toolsItems"
          :label="t('fq.nav.tools')"
          :inline="inline"
          @select="(id) => go(`tools:${id}`)"
          @close="toolsOpen = false"
        />
      </nav>
      <button type="button" class="palbtn" :aria-label="t('fq.palette.label')" @click="openPalette">
        <DsIcon name="search" />
        <span class="ph">{{ t('fq.palette.placeholder') }}</span>
        <kbd>Ctrl K</kbd>
      </button>
      <div class="right">
        <IconBtn
          class="only-phone"
          icon="search"
          :label="t('fq.palette.label')"
          @click="openPalette"
        />
        <ConnectionPill
          :kind="connKind"
          :state="conn.status.state"
          :latency-ms="conn.status.latencyMs ?? undefined"
          :resyncing="conn.status.resyncing"
          :frozen-at="frozenAt || undefined"
          :beat="conn.beat"
        />
        <IconBtn icon="bell" :label="t('fq.shell.alerts')" :count="bell" @click="emit('bell')" />
        <IconBtn
          class="no-phone"
          :icon="themeIcon"
          :label="t('fq.theme.cycle', { mode: t(`fq.theme.${theme.mode.value}`) })"
          shortcut="T"
          @click="theme.cycle()"
        />
        <IconBtn
          class="no-phone"
          icon="settings"
          :label="t('fq.nav.settings')"
          shortcut="G S"
          @click="go('settings')"
        />
      </div>
    </header>

    <div id="fq-shell-banner" class="banners">
      <Banner
        v-for="b in banners"
        :key="b.kind"
        :kind="b.kind"
        :action="b.action"
        @action="data.probeNow()"
      >
        {{ b.text }}
      </Banner>
      <slot name="banner" />
    </div>
    <!-- The pages put their strip and scope bar here (ShellSlot): the shell mounts only once -->
    <div id="fq-shell-strip" class="strip"><slot name="strip" /></div>
    <div id="fq-shell-scope" class="scope"><slot name="scope" /></div>

    <main class="content"><slot /></main>

    <div class="statusbar">
      <StatusBar
        :health="healthLevel"
        :logs-error-count="logErrors"
        :density="density"
        @open-health="emit('openHealth')"
        @open-logs="emit('openLogs')"
        @update:density="(d) => (density = d)"
      >
        <span class="si" data-testid="sb-live">
          {{ t('fq.shell.sb.liveBots') }}
          <b class="num">{{ liveBots.online }}/{{ liveBots.total }}</b>
          <span v-if="liveBots.starting > 0" class="mut"
            >· {{ t('fq.shell.sb.liveStarting', { n: liveBots.starting }) }}</span
          >
        </span>
        <button
          v-if="
            health.health?.rate_budget_pct !== null && health.health?.rate_budget_pct !== undefined
          "
          type="button"
          class="si"
          data-testid="sb-budget"
          @click="emit('openHealth')"
        >
          {{ t('fq.shell.sb.budget') }}
          <b class="num">{{ Math.round(health.health.rate_budget_pct) }} %</b>
        </button>
        <button
          v-if="health.health?.backoff_active"
          type="button"
          class="si lvl-warn"
          data-testid="sb-backoff"
          @click="emit('openHealth')"
        >
          {{ t('fq.shell.sb.backoff') }}
        </button>
        <span v-if="ageLabel" class="si" data-testid="sb-snapshot">
          {{ t('fq.shell.sb.snapshot') }} <b class="num">{{ ageLabel }}</b>
        </span>
      </StatusBar>
    </div>
    <div class="tabbar">
      <TabBar
        :items="tabItems"
        :model-value="page"
        :label="t('fq.shell.navigation')"
        @select="onTab"
      />
    </div>

    <AdaptiveSheet
      :open="moreOpen"
      :title="t('fq.nav.more')"
      :inline="inline"
      @close="moreOpen = false"
    >
      <div class="more">
        <Btn icon="wrench" @click="((moreOpen = false), go('tools'))">{{ t('fq.nav.tools') }}</Btn>
        <Btn icon="settings" @click="((moreOpen = false), go('settings'))">{{
          t('fq.nav.settings')
        }}</Btn>
        <Btn :icon="themeIcon" @click="theme.cycle()">{{ t(`fq.theme.${theme.mode.value}`) }}</Btn>
        <Btn icon="activity" @click="((moreOpen = false), emit('openHealth'))">{{
          t('fq.ds.health.title')
        }}</Btn>
      </div>
    </AdaptiveSheet>

    <CommandPalette
      :current-bot-key="currentBotKey ?? null"
      @navigate="onPaletteNavigate"
      @open-bot="(k) => emit('openBot', k)"
      @open-pair="(p, k) => emit('openPair', p, k)"
      @open-trade="(k, id) => emit('openTrade', k, id)"
      @display="onPaletteDisplay"
    />
    <ActionDialogHost :source="props.source" :inline="inline" />
    <Toaster :inline="inline" @action="onToastAction" />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-ui);
}
.top {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: var(--s3);
  height: var(--hdr);
  padding: 0 var(--s3);
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
  flex: none;
}
.logo {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 0;
  background: none;
  color: var(--fg);
  font: inherit;
  cursor: pointer;
}
.logo .sub {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
@media (max-width: 599px), (pointer: coarse) {
  .logo {
    min-height: 44px;
    min-width: 44px;
  }
}
.nav {
  display: flex;
  align-items: center;
  gap: 2px;
}
.nl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: calc(var(--hdr) - 8px);
  padding: 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--fg-2);
  font: 500 var(--t-md) var(--font-ui);
  cursor: pointer;
}
.nl:hover {
  color: var(--fg);
}
.nl.on {
  color: var(--fg);
  border-bottom-color: var(--accent);
}
.nl.tools {
  color: var(--fg-3);
}
.palbtn {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  max-width: 420px;
  margin: 0 auto;
  height: var(--ctl);
  padding: 0 10px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  background: var(--bg);
  color: var(--fg-3);
  font: inherit;
  font-size: var(--t-sm);
  cursor: pointer;
}
.palbtn .ph {
  flex: 1;
  text-align: left;
}
kbd {
  font: 500 10.5px var(--font-num);
  padding: 1px 5px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-1);
}
.right {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.only-phone {
  display: none;
}
.banners,
.strip,
.scope {
  flex: none;
  min-width: 0;
}
.strip:empty,
.scope:empty,
.banners:empty {
  display: none;
}
.content {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.statusbar {
  position: sticky;
  bottom: 0;
}
/* Items the shell adds to the status bar (the bar styles only its own buttons) */
.statusbar .si {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: var(--r-1);
  background: none;
  color: var(--fg-2);
  font: inherit;
}
.statusbar button.si {
  cursor: pointer;
}
.statusbar button.si:hover {
  background: var(--bg-2);
  color: var(--fg);
}
.statusbar .si b {
  font-weight: 600;
  color: var(--fg);
}
.statusbar .si.lvl-warn {
  color: var(--warn);
}
.tabbar {
  display: none;
}
.more {
  display: grid;
  gap: var(--s2);
  padding: var(--s3);
}
@media (max-width: 1023px) {
  .nav,
  .palbtn,
  .no-phone {
    display: none;
  }
  .only-phone {
    display: inline-grid;
  }
  .statusbar {
    display: none;
  }
  .tabbar {
    display: flex;
    position: sticky;
    bottom: 0;
  }
  .tabbar > :deep(*) {
    flex: 1;
    min-width: 0;
  }
}
@media (max-width: 599px) {
  .top {
    height: 52px;
  }
  .logo .sub {
    display: none;
  }
}
@media (min-width: 1024px) {
  .shell {
    height: 100dvh;
  }
  .content {
    overflow: auto;
  }
}
.shell.contained {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.shell.contained .top {
  position: static;
}
.shell.contained .content {
  overflow: auto;
}
.mut {
  color: var(--fg-3);
}
</style>
