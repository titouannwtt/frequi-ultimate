<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import Badge from './Badge.vue';
import type { TradingMode } from './types';

defineProps<{
  mode: TradingMode;
  /**
   * Full badge. Only the headers, drawers and dialogs show the full LIVE badge; in tables and
   * tiles the real-money mark is a violet dot (02-design.md, section 6.1).
   */
  full?: boolean;
}>();

const { t } = useI18n();
</script>

<template>
  <Badge v-if="mode !== 'live' || full" :kind="mode" />
  <span
    v-else
    class="livemark"
    role="img"
    :aria-label="t('fq.ds.badge.live')"
    :title="t('fq.ds.realMoney')"
  ></span>
</template>

<style scoped>
.livemark {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--live);
  display: inline-block;
  flex: none;
}
</style>
