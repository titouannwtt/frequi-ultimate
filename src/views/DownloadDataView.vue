<script setup lang="ts">
import { useI18n } from 'vue-i18n';

import LegacyToolGate from '@/components/fq/LegacyToolGate.vue';

const { t } = useI18n();
</script>

<template>
  <LegacyToolGate :title="t('fq.tools.downloadData')" :subtitle="t('fq.pg.toolsHint.downloadData')">
    <DownloadDataMain />
  </LegacyToolGate>
</template>
