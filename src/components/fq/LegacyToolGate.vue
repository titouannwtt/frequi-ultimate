<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { Btn, EmptyState, Skeleton } from '@/components/ds';
import { useBotStore } from '@/stores/ftbotwrapper';

import ToolFrame from './ToolFrame.vue';

/**
 * The frame of the tools that still run on the legacy stores and need a bot in webserver mode
 * (Backtest, Download data, Pairlist config). A trading bot answers 503 to their endpoints: instead
 * of an unhandled error and a form that can only fail, the page says so, offers the way back to the
 * Tools and, when another bot is a webserver, a way to switch to it. The tool itself is only
 * mounted once the bot is known to be able to serve it, so it never asks a trading bot for
 * strategies, exchanges or pairlists.
 */
defineProps<{ title: string; subtitle?: string }>();

const { t } = useI18n();
const router = useRouter();
const botStore = useBotStore();

const bot = computed(() => (botStore.hasBots ? botStore.activeBot : undefined));
const loaded = computed(() => bot.value?.botStatusAvailable === true);
const runmode = computed(() => bot.value?.botState?.runmode ?? null);
const usable = computed(() => bot.value?.isWebserverMode === true);
const alternatives = computed(() =>
  botStore.allBotStores.filter(
    (b) => b.botId !== botStore.selectedBot && b.botStatusAvailable && b.isWebserverMode,
  ),
);

// A bot that never answers must not leave the page on a skeleton forever
const waitedLong = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  loaded,
  (ok) => {
    clearTimeout(timer);
    waitedLong.value = false;
    if (!ok) timer = setTimeout(() => (waitedLong.value = true), 12_000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));

type Phase = 'noBot' | 'loading' | 'silent' | 'unavailable' | 'ready';
const phase = computed<Phase>(() => {
  if (!bot.value) return 'noBot';
  if (!loaded.value) return waitedLong.value ? 'silent' : 'loading';
  return usable.value ? 'ready' : 'unavailable';
});

// The run mode, or empty when the bot did not say: the hint then goes without it
const modeLabel = computed(() => {
  const m = String(runmode.value ?? '');
  return m === 'dry_run' ? 'dry-run' : m;
});
</script>

<template>
  <ToolFrame :title="title" :subtitle="subtitle" :tags="['python']">
    <div v-if="phase === 'loading'" data-testid="legacy-loading">
      <Skeleton shape="row" :count="4" />
    </div>
    <EmptyState
      v-else-if="phase === 'noBot'"
      icon="bot"
      :title="t('fq.pg.legacy.noBot')"
      :hint="t('fq.pg.legacy.noBotHint')"
      data-testid="legacy-no-bot"
    >
      <Btn size="sm" @click="router.push({ name: 'settings' })">{{ t('fq.nav.settings') }}</Btn>
    </EmptyState>
    <EmptyState
      v-else-if="phase === 'silent'"
      icon="triangle-alert"
      :title="t('fq.pg.legacy.silent', { name: bot?.botName })"
      :hint="t('fq.pg.legacy.silentHint')"
      data-testid="legacy-silent"
    >
      <Btn size="sm" @click="router.push({ name: 'tools' })">{{ t('fq.nav.tools') }}</Btn>
    </EmptyState>
    <EmptyState
      v-else-if="phase === 'unavailable'"
      icon="info"
      :title="t('fq.pg.legacy.unavailable')"
      :hint="
        modeLabel
          ? t('fq.pg.legacy.unavailableHint', { name: bot?.botName, mode: modeLabel })
          : t('fq.pg.legacy.unavailableHintNoMode', { name: bot?.botName })
      "
      data-testid="legacy-unavailable"
    >
      <div class="acts">
        <Btn
          v-for="b in alternatives"
          :key="b.botId"
          size="sm"
          variant="primary"
          @click="botStore.selectBot(b.botId)"
        >
          {{ t('fq.pg.legacy.use', { name: b.botName }) }}
        </Btn>
        <Btn size="sm" @click="router.push({ name: 'tools' })">{{ t('fq.nav.tools') }}</Btn>
      </div>
    </EmptyState>
    <slot v-else />
  </ToolFrame>
</template>

<style scoped>
.acts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s2);
  justify-content: center;
}
</style>
