<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { Banner, Btn, EmptyState, Skeleton } from '@/components/ds';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import ReconcileDialog from '@/components/fq/ReconcileDialog.vue';
import ReconciliationTable from '@/components/fq/ReconciliationTable.vue';
import ToolFrame from '@/components/fq/ToolFrame.vue';
import { nextSweepInMs } from '@/components/fq/lib/recon';
import { shortWallet, type WriteOutcome } from '@/components/fq/lib/reconWrite';
import { useReconciliation } from '@/composables/useReconciliation';
import type { FleetviewCoin, FleetviewResolvePayload } from '@/types/fleetview';

/**
 * Tools > Reconciliation (02 section 3.5): the wallet against the bots' databases. Reading is a
 * sweep of the wallet at most once a minute; writing is a preview that asks for the destructive
 * confirmation (coin typed, 1 s hold) and sends one request, once. A position without an owner bot
 * is never closed by a forced exit from here, only by the Python resolution after the preview.
 */
const { t } = useI18n();
const rec = useReconciliation();
const clock = useNowMs();

const preview = ref<FleetviewCoin | null>(null);
const sending = ref(false);
const outcome = ref<WriteOutcome | null>(null);
const failure = ref<string | null>(null);

const checkedMs = computed(() =>
  rec.response.value ? rec.response.value.generated_at * 1000 : null,
);
const wait = computed(() => nextSweepInMs(checkedMs.value, clock.value));
const wallet = computed(() => shortWallet(rec.response.value?.wallet));

const errorText = computed(() => {
  const kind = rec.error.value;
  if (!kind) return '';
  const s = Math.ceil((rec.retryAfterMs.value ?? 0) / 1000);
  return t(`fq.pg.tools.reconciliation.err.${kind}`, { s });
});

// The fleet may not be loaded yet when the page opens: read as soon as a bot can answer
watch(
  () => rec.candidates.value.join(','),
  () => {
    if (!rec.response.value) void rec.load();
  },
  { immediate: true },
);

function open(row: FleetviewCoin) {
  outcome.value = null;
  failure.value = null;
  sending.value = false;
  preview.value = row;
}

function close() {
  const wrote = outcome.value !== null || failure.value !== null;
  preview.value = null;
  // The view the write was about has changed: read it again
  if (wrote) void rec.load();
}

async function send(payload: FleetviewResolvePayload) {
  sending.value = true;
  try {
    outcome.value = await rec.resolve(payload);
  } catch (e) {
    failure.value = e instanceof Error ? e.message : String(e);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <ToolFrame
    :title="t('fq.tools.reconciliation')"
    :subtitle="t('fq.pg.tools.reconciliation.sub')"
    :tags="['python']"
  >
    <template #actions>
      <Btn
        size="sm"
        icon="refresh-cw"
        :busy="rec.loading.value"
        :disabled="wait > 0"
        :disabled-reason="t('fq.pg.tools.reconciliation.tooSoon', { s: Math.ceil(wait / 1000) })"
        data-testid="recon-refresh"
        @click="rec.load()"
        >{{ t('fq.pg.tools.refresh') }}</Btn
      >
    </template>

    <Banner
      v-if="rec.error.value"
      :kind="rec.response.value ? 'degraded' : 'offline'"
      :action="rec.loading.value ? undefined : t('fq.result.retry')"
      data-testid="recon-error"
      @action="rec.load()"
    >
      {{ errorText }}
    </Banner>

    <Skeleton v-if="rec.loading.value && !rec.response.value && !rec.error.value" :count="4" />
    <ReconciliationTable
      v-else-if="rec.response.value"
      :wallet="wallet"
      :rows="rec.response.value.coins"
      :checked-ms="checkedMs"
      :busy="preview !== null"
      @preview="open"
    />
    <EmptyState
      v-else-if="rec.error.value"
      icon="git-compare-arrows"
      :title="t('fq.recon.unavailable')"
      :hint="t('fq.recon.unavailableHint')"
      data-testid="recon-unavailable"
    />

    <ReconcileDialog
      :open="preview !== null"
      :row="preview"
      :via-bot="rec.viaName.value"
      :busy="sending"
      :outcome="outcome"
      :failure="failure"
      @close="close"
      @confirm="send"
    />
  </ToolFrame>
</template>
