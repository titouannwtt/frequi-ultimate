<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import LogStream from '@/components/fq/LogStream.vue';
import ToolFrame from '@/components/fq/ToolFrame.vue';
import { useActionNav } from '@/composables/useActionNav';
import type { BotKey } from '@/gateway/types.gen';

/** Tools > Logs (02 section 4.1 C7): the log stream in page mode (level, search, bot, older lines). */
const { t } = useI18n();
const nav = useActionNav();
const bot = ref<BotKey | null>(null);
</script>

<template>
  <ToolFrame :title="t('fq.tools.logs')" :subtitle="t('fq.pg.tools.logs.sub')">
    <LogStream
      mode="page"
      :bot="bot"
      @update:bot="(k) => (bot = k)"
      @open-bot="(k) => nav.openBot(k)"
    />
  </ToolFrame>
</template>
