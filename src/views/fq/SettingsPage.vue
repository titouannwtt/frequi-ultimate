<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import axios from 'axios';
import { useI18n } from 'vue-i18n';
import { useMediaQuery } from '@vueuse/core';
import { useRoute, useRouter } from 'vue-router';

import { DsIcon, EmptyState } from '@/components/ds';
import type { DsIconRef } from '@/components/ds';
import AboutPanel from '@/components/fq/AboutPanel.vue';
import AlertSettings from '@/components/fq/AlertSettings.vue';
import BotEditSheet from '@/components/fq/BotEditSheet.vue';
import BotRegistry from '@/components/fq/BotRegistry.vue';
import ConfigTransferSheet from '@/components/fq/ConfigTransferSheet.vue';
import DisplaySettings from '@/components/fq/DisplaySettings.vue';
import GatewaySettings from '@/components/fq/GatewaySettings.vue';
import SecurityPanel from '@/components/fq/SecurityPanel.vue';
import SettingsSection from '@/components/fq/SettingsSection.vue';
import WorkspacesPanel from '@/components/fq/WorkspacesPanel.vue';
import { discoveredUrl, type BotForm } from '@/components/fq/lib/registryEdit';
import { readLoginInfos } from '@/composables/loginInfo';
import { useBotRegistryEdit } from '@/composables/useBotRegistryEdit';
import { useDataSource } from '@/composables/useDataSource';
import { useToaster } from '@/composables/useToaster';
import { botKeyFromApiUrl } from '@/datasource/protocol/identity';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { DiscoveredBot, RegistryBot } from '@/datasource/types';
import type { BotKey } from '@/gateway/types.gen';

/**
 * The Settings page (02 section 3.6): bots first (the registry, the way in for a first bot and the
 * single import and export), then the gateway, display, alerts, action security, workspaces and
 * the about and audit section. It is also `/login`: with no bot registered the add form opens at
 * once, and after the first bot is registered the user goes back where they were headed.
 */
const SECTIONS: Array<{ id: string; icon: DsIconRef }> = [
  { id: 'bots', icon: 'bot' },
  { id: 'gateway', icon: 'plug' },
  { id: 'display', icon: 'palette' },
  { id: 'alerts', icon: 'bell' },
  { id: 'security', icon: 'shield-check' },
  { id: 'workspaces', icon: 'columns-2' },
  { id: 'about', icon: 'info' },
];

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const data = useDataSource();
const prefs = useFqPrefsStore();
const fleet = useFqFleetStore();
const toaster = useToaster();
const reg = useBotRegistryEdit();

const wide = useMediaQuery('(min-width: 1024px)');

// ---- section navigation ----
const active = ref<string>('bots');
function goTo(id: string) {
  active.value = id;
  document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  void router.replace({ query: { ...route.query, section: id === 'bots' ? undefined : id } });
}
let observer: IntersectionObserver | null = null;
onMounted(() => {
  const wanted = typeof route.query.section === 'string' ? route.query.section : null;
  if (wanted && SECTIONS.some((s) => s.id === wanted)) {
    void nextTick(() =>
      document.getElementById(`set-${wanted}`)?.scrollIntoView({ block: 'start' }),
    );
    active.value = wanted;
  }
  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        const id = top?.target.getAttribute('data-section');
        if (id) active.value = id;
      },
      { rootMargin: '0px 0px -70% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(`set-${s.id}`);
      if (el) observer.observe(el);
    }
  }
});
onBeforeUnmount(() => observer?.disconnect());

// ---- the registry ----
const bots = ref<RegistryBot[]>([]);
const discovered = ref<DiscoveredBot[]>([]);

/** What this browser holds, for when no source is running yet (first run, no bot). */
function localBots(): RegistryBot[] {
  const hostname = window.location.hostname;
  const hosts = [hostname, 'localhost', '127.0.0.1', '::1'];
  return Object.entries(readLoginInfos()).flatMap(([uiId, e]) => {
    if (!e) return [];
    const url = e.apiUrl || window.location.origin;
    const botKey = botKeyFromApiUrl(url, hosts);
    return botKey ? [{ botKey, uiId, name: e.botName, icon: e.botIcon ?? null }] : [];
  });
}

async function refreshRegistry() {
  const source = data.source.value;
  try {
    bots.value = source ? await source.registry.list() : localBots();
  } catch {
    bots.value = localBots();
  }
  try {
    discovered.value = source ? await source.registry.discovered() : [];
  } catch {
    discovered.value = [];
  }
}
onMounted(refreshRegistry);
watch(data.source, refreshRegistry);
// A bot that appears or goes in the fleet changes the registry rows
watch(() => fleet.list.length, refreshRegistry);

// ---- add, edit, reconnect ----
type SheetMode = 'add' | 'edit' | 'reconnect';
const sheet = ref<{
  mode: SheetMode;
  uiId: string | null;
  initial: Omit<BotForm, 'password'>;
} | null>(null);
const sheetBusy = ref(false);
const sheetError = ref<string | null>(null);
const pending = ref<DiscoveredBot[]>([]);

const knownUrls = computed(() =>
  Object.values(readLoginInfos())
    .map((e) => e?.apiUrl ?? '')
    .filter(Boolean),
);

function openAdd(initial: Partial<Omit<BotForm, 'password'>> = {}) {
  sheetError.value = null;
  sheet.value = {
    mode: 'add',
    uiId: null,
    initial: {
      name: initial.name ?? '',
      url: initial.url ?? window.location.origin,
      username: initial.username ?? '',
    },
  };
}
function openFor(botKey: BotKey, mode: 'edit' | 'reconnect') {
  const row = bots.value.find((b) => b.botKey === botKey);
  const entry = row?.uiId ? readLoginInfos()[row.uiId] : undefined;
  if (!row?.uiId || !entry) return;
  sheetError.value = null;
  sheet.value = {
    mode,
    uiId: row.uiId,
    initial: { name: entry.botName, url: entry.apiUrl, username: entry.username ?? '' },
  };
}
function addDiscovered(list: DiscoveredBot[]) {
  pending.value = list.slice(1);
  const first = list[0];
  if (!first) return;
  openAdd({
    name: first.name,
    url: discoveredUrl(first.port, window.location),
  });
}

/** The gateway only knows the bots proven in the session: a new session lists the new set. */
async function restartGateway() {
  if (data.kind.value !== 'gateway') return;
  prefs.updateGateway({ session: null, expiresAt: null });
  data.stop();
  await data.start();
}

function loginError(e: unknown): string {
  if (axios.isAxiosError(e) && e.response?.status === 401) return t('fq.pg.settings.bot.err.login');
  return t('fq.pg.settings.bot.err.unreachable');
}

async function submit(form: BotForm) {
  const s = sheet.value;
  if (!s) return;
  sheetBusy.value = true;
  sheetError.value = null;
  try {
    if (s.mode === 'add') {
      await reg.addBot(form);
    } else if (s.uiId) {
      if (form.password === '') reg.rename(s.uiId, form.name);
      else await reg.relogin(s.uiId, form);
    }
    const next = pending.value.shift();
    sheet.value = null;
    await restartGateway();
    await refreshRegistry();
    toaster.push({ kind: 'ok', title: t('fq.pg.settings.bot.saved') });
    if (next) {
      openAdd({ name: next.name, url: discoveredUrl(next.port, window.location) });
    } else {
      leaveLogin();
    }
  } catch (e) {
    sheetError.value = loginError(e);
  } finally {
    sheetBusy.value = false;
  }
}

async function removeBot() {
  const s = sheet.value;
  if (!s?.uiId) return;
  reg.remove(s.uiId);
  sheet.value = null;
  await restartGateway();
  await refreshRegistry();
}

/** `/login?redirect=...`: once a bot exists, go where the user was headed. */
function leaveLogin() {
  if (
    route.name !== 'login' ||
    (bots.value.length === 0 && Object.keys(readLoginInfos()).length === 0)
  )
    return;
  const to = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard';
  const resolved = router.resolve(to);
  void router.push(resolved.name === '404' ? '/dashboard' : to);
}

// First run: no bot at all, the form opens by itself
onMounted(async () => {
  await refreshRegistry();
  if (route.name === 'login' && bots.value.length === 0 && !sheet.value) openAdd();
});

// ---- import and export ----
const xfer = ref<'export' | 'import' | null>(null);

const needsFirstBot = computed(() => bots.value.length === 0);
</script>

<template>
  <div class="set" :class="{ wide }" data-testid="settings-page">
    <nav class="nav" :aria-label="t('fq.pg.settings.nav')">
      <button
        v-for="s in SECTIONS"
        :key="s.id"
        type="button"
        class="ni"
        :class="{ on: active === s.id }"
        :aria-current="active === s.id ? 'true' : undefined"
        :data-nav="s.id"
        @click="goTo(s.id)"
      >
        <DsIcon :name="s.icon" :size="15" />
        {{ t(`fq.pg.settings.sec.${s.id}`) }}
      </button>
    </nav>

    <div class="main">
      <SettingsSection
        id="bots"
        icon="bot"
        :title="t('fq.pg.settings.sec.botsTitle')"
        :subtitle="t('fq.pg.settings.sec.botsSub')"
      >
        <EmptyState
          v-if="needsFirstBot && route.name === 'login'"
          icon="plug"
          :title="t('fq.pg.settings.bot.first')"
          :hint="t('fq.pg.settings.bot.firstHint')"
        />
        <BotRegistry
          :bots="bots"
          :discovered="discovered"
          :migration="prefs.migration"
          @add="addDiscovered"
          @add-manual="openAdd()"
          @edit="(k) => openFor(k, 'edit')"
          @reconnect="(k) => openFor(k, 'reconnect')"
          @import-file="xfer = 'import'"
          @export-file="xfer = 'export'"
        />
      </SettingsSection>

      <SettingsSection
        id="gateway"
        icon="plug"
        :title="t('fq.pg.settings.sec.gatewayTitle')"
        :subtitle="t('fq.pg.settings.sec.gatewaySub')"
      >
        <GatewaySettings />
      </SettingsSection>

      <SettingsSection
        id="display"
        icon="palette"
        :title="t('fq.pg.settings.sec.displayTitle')"
        :subtitle="t('fq.pg.settings.sec.displaySub')"
      >
        <DisplaySettings />
      </SettingsSection>

      <SettingsSection
        id="alerts"
        icon="bell"
        :title="t('fq.pg.settings.sec.alertsTitle')"
        :subtitle="t('fq.pg.settings.sec.alertsSub')"
      >
        <AlertSettings />
      </SettingsSection>

      <SettingsSection
        id="security"
        icon="shield-check"
        :title="t('fq.pg.settings.sec.securityTitle')"
        :subtitle="t('fq.pg.settings.sec.securitySub')"
      >
        <SecurityPanel />
      </SettingsSection>

      <SettingsSection
        id="workspaces"
        icon="columns-2"
        :title="t('fq.pg.settings.sec.workspacesTitle')"
        :subtitle="t('fq.pg.settings.sec.workspacesSub')"
      >
        <WorkspacesPanel />
      </SettingsSection>

      <SettingsSection
        id="about"
        icon="info"
        :title="t('fq.pg.settings.sec.aboutTitle')"
        :subtitle="t('fq.pg.settings.sec.aboutSub')"
      >
        <AboutPanel />
      </SettingsSection>
    </div>

    <BotEditSheet
      v-if="sheet"
      :open="sheet !== null"
      :mode="sheet.mode"
      :initial="sheet.initial"
      :busy="sheetBusy"
      :error="sheetError"
      :others="knownUrls"
      @close="sheet = null"
      @submit="submit"
      @remove="removeBot"
    />
    <ConfigTransferSheet :open="xfer !== null" :initial="xfer ?? 'export'" @close="xfer = null" />
  </div>
</template>

<style scoped>
.set {
  display: grid;
  gap: var(--s4);
  padding: var(--s4);
  align-content: start;
  min-width: 0;
  text-align: left;
}
.set.wide {
  grid-template-columns: 200px minmax(0, 1fr);
  align-items: start;
  max-width: 1200px;
}
.nav {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
  padding-bottom: 2px;
}
.nav::-webkit-scrollbar {
  display: none;
}
.wide .nav {
  position: sticky;
  top: var(--s4);
  flex-direction: column;
  overflow: visible;
}
.ni {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--r-1);
  background: none;
  color: var(--fg-2);
  font: inherit;
  font-size: var(--t-sm);
  white-space: nowrap;
  cursor: pointer;
}
.ni:hover {
  background: var(--bg-2);
  color: var(--fg);
}
.ni.on {
  background: var(--bg-3);
  color: var(--fg);
}
.main {
  display: grid;
  gap: var(--s6);
  min-width: 0;
}
@media (max-width: 599px) {
  .set {
    padding: var(--s3);
  }
}
</style>
