<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import BotPicker from '@/components/fq/BotPicker.vue';
import SystemHealth from '@/components/fq/SystemHealth.vue';
import ToolFrame from '@/components/fq/ToolFrame.vue';
import RequestTimeline from '@/components/ftbot/RequestTimeline.vue';
import { useLegacyBot } from '@/composables/useLegacyBot';
import { useShellBus } from '@/composables/useShellBus';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { BotKey } from '@/gateway/types.gen';
import { useFqFleetStore } from '@/datasource/stores/fleet';

/**
 * Tools > Diagnostic (02 sections 2.2 and 4.1 C6): the level and its reasons, the request budget,
 * the cache and the backoff of the whole fleet, then the timeline of the requests of one bot
 * (the 429 and the backoffs exist per bot only, through the bot's own `rate_metrics`). The
 * timeline is the legacy chart, kept; it runs on the legacy stores, so this route starts them.
 */
const { t } = useI18n();
const router = useRouter();
const bus = useShellBus();
const fleet = useFqFleetStore();
const prefs = useFqPrefsStore();

const first = (): BotKey | null => {
  const sel = prefs.settings.selectedBot;
  if (sel && fleet.bots[sel]) return sel;
  return fleet.list.find((b) => b.identity.mode === 'live')?.bot_key ?? fleet.list[0]?.bot_key ?? null;
};
const picked = ref<BotKey | null>(first());
useLegacyBot(() => picked.value);
</script>

<template>
  <ToolFrame
    :title="t('fq.tools.diagnostic')"
    :subtitle="t('fq.pg.tools.diagnostic.sub')"
    :tags="['perBot']"
  >
    <section class="blk">
      <h2>{{ t('fq.pg.tools.diagnostic.fleet') }}</h2>
      <SystemHealth
        detail
        @open-logs="router.push({ name: 'tools-logs' })"
        @open-alert="bus.healthOpen.value = false"
      />
    </section>

    <section class="blk">
      <div class="h">
        <h2>{{ t('fq.pg.tools.diagnostic.timeline') }}</h2>
        <BotPicker v-model="picked" />
      </div>
      <p class="hint">{{ t('fq.pg.tools.diagnostic.timelineHint') }}</p>
      <div class="legacy"><RequestTimeline /></div>
    </section>
  </ToolFrame>
</template>

<style scoped>
.blk {
  display: grid;
  gap: var(--s2);
  min-width: 0;
}
.h {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s3);
}
h2 {
  margin: 0;
  font-size: var(--t-md);
  font-weight: 600;
}
.hint {
  margin: 0;
  color: var(--fg-3);
  font-size: var(--t-sm);
}
.legacy {
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--bg-1);
  min-width: 0;
  overflow: auto;
}
</style>
