<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import BotPicker from '@/components/fq/BotPicker.vue';
import ToolFrame from '@/components/fq/ToolFrame.vue';
import VolumeComparatorChart from '@/components/ftbot/VolumeComparatorChart.vue';
import { useLegacyBot } from '@/composables/useLegacyBot';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { BotKey } from '@/gateway/types.gen';

/**
 * Tools > Volume comparator: the traded volume of the pairs of one bot over time (the bot
 * answers once and the gateway keeps the answer for five minutes). The chart is the legacy one,
 * kept; it runs on the legacy stores, so this route starts them.
 */
const { t } = useI18n();
const fleet = useFqFleetStore();
const prefs = useFqPrefsStore();

const start = (): BotKey | null => {
  const sel = prefs.settings.selectedBot;
  if (sel && fleet.bots[sel]) return sel;
  return fleet.list.find((b) => b.identity.mode === 'live')?.bot_key ?? fleet.list[0]?.bot_key ?? null;
};
const picked = ref<BotKey | null>(start());
useLegacyBot(() => picked.value);
</script>

<template>
  <ToolFrame :title="t('fq.tools.volume')" :subtitle="t('fq.pg.tools.volume.sub')" :tags="['perBot']">
    <template #actions><BotPicker v-model="picked" /></template>
    <div class="legacy"><VolumeComparatorChart /></div>
  </ToolFrame>
</template>

<style scoped>
.legacy {
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--bg-1);
  min-width: 0;
  overflow: auto;
}
</style>
