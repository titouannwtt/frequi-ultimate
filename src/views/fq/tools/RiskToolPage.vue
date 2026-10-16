<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { SegmentedControl } from '@/components/ds';
import RiskPanel from '@/components/fq/RiskPanel.vue';
import StressTest from '@/components/fq/StressTest.vue';
import ToolFrame from '@/components/fq/ToolFrame.vue';
import { useActionNav } from '@/composables/useActionNav';
import { useScopeDetail } from '@/composables/useScopeDetail';
import type { ScopeRef } from '@/datasource/types';
import type { BotMode } from '@/gateway/types.gen';

/**
 * Tools > Advanced risk (02 sections 4.1 C5 and 12): the wallet-level panel in full (every coin
 * held by several bots) and the stress test against the real liquidation prices. One trading mode
 * at a time, live first: live, dry and replay are never added together.
 */
const { t } = useI18n();
const router = useRouter();
const nav = useActionNav();

const mode = ref<BotMode>('live');
const modes = computed(() =>
  (['live', 'dry'] as const).map((m) => ({ value: m, label: t(`fq.scope.${m}`) })),
);
const scope: ScopeRef = { kind: 'fleet' };
const loaded = useScopeDetail(() => scope);
</script>

<template>
  <ToolFrame :title="t('fq.tools.risk')" :subtitle="t('fq.pg.tools.risk.sub')">
    <template #actions>
      <SegmentedControl v-model="mode" :options="modes" size="sm" :label="t('fq.pg.tools.mode')" />
    </template>
    <RiskPanel
      detail
      :scope="scope"
      :mode="mode"
      :scope-detail="loaded.detail.value"
      @open-bot="(k) => nav.openBot(k)"
      @open-reconciliation="router.push({ name: 'tools-reconciliation' })"
    />
    <section class="blk">
      <h2>{{ t('fq.stress.title') }}</h2>
      <StressTest :positions="loaded.detail.value?.positions ?? []" :mode="mode" />
    </section>
  </ToolFrame>
</template>

<style scoped>
.blk {
  display: grid;
  gap: var(--s2);
}
h2 {
  margin: 0;
  font-size: var(--t-md);
  font-weight: 600;
}
</style>
