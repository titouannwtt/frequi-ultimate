<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, Btn, FormRow, SegmentedControl, TextInput } from '@/components/ds';
import type { SegmentOption } from '@/components/ds';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useDataSource } from '@/composables/useDataSource';
import { defaultGatewayUrl, type SourceMode } from '@/datasource/manager';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqPrefsStore } from '@/datasource/stores/prefs';

import { formatDateTime } from './lib/time';

/**
 * Settings > Gateway (02 section 3.6, 2): the source policy (Auto, Gateway, Direct), its address,
 * the state of the link and what the last probe found. Without a gateway the interface works in
 * direct mode against the bots; Auto probes the gateway and falls back by itself.
 */
const { t, locale } = useI18n();
const data = useDataSource();
const prefs = useFqPrefsStore();
const conn = useFqConnectionStore();
const now = useNowMs();

const mode = computed<SourceMode>(() => prefs.gateway.mode);
const modes = computed<SegmentOption<SourceMode>[]>(() => [
  { value: 'auto', label: t('fq.pg.settings.gw.auto') },
  { value: 'gateway', label: t('fq.pg.settings.gw.gateway') },
  { value: 'direct', label: t('fq.pg.settings.gw.direct') },
]);

const url = ref(prefs.gateway.url);
watch(
  () => prefs.gateway.url,
  (u) => (url.value = u),
);
const placeholder = computed(() =>
  typeof window === 'undefined'
    ? ''
    : defaultGatewayUrl(window.location.protocol, window.location.hostname),
);
const urlOk = computed(
  () => url.value.trim() === '' || /^https?:\/\/[^\s/]+/i.test(url.value.trim()),
);
const urlChanged = computed(() => url.value.trim() !== prefs.gateway.url);

const probing = ref(false);
async function setMode(m: SourceMode) {
  await data.setMode(m);
}
async function applyUrl() {
  if (!urlOk.value) return;
  prefs.updateGateway({ url: url.value.trim().replace(/\/+$/, '') });
  await probe();
}
async function probe() {
  probing.value = true;
  try {
    await data.probeNow();
  } finally {
    probing.value = false;
  }
}

const kind = computed(() => conn.kind);
const stateKey = computed(() => {
  if (kind.value === 'direct') return 'direct';
  return conn.status.state;
});
const stateKind = computed(() =>
  stateKey.value === 'live'
    ? 'info'
    : stateKey.value === 'degraded' || stateKey.value === 'connecting'
      ? 'warn'
      : stateKey.value === 'direct'
        ? 'neutral'
        : 'crit',
);
const probe_ = computed(() => conn.lastProbe);
const probeAge = computed(() =>
  probe_.value ? Math.max(0, Math.round((now.value - probe_.value.atMs) / 1000)) : null,
);
const when = (ms: number) => formatDateTime(ms, prefs.settings.tz, locale.value);
const skew = computed(() => {
  const s = conn.status.clockSkewMs;
  return Math.abs(s) < 1000 ? `${Math.round(s)} ms` : `${(s / 1000).toFixed(1)} s`;
});
</script>

<template>
  <div class="gw" data-testid="gateway-settings">
    <FormRow :label="t('fq.pg.settings.gw.source')" :hint="t('fq.pg.settings.gw.sourceHint')">
      <SegmentedControl
        :model-value="mode"
        :options="modes"
        size="sm"
        :label="t('fq.pg.settings.gw.source')"
        @update:model-value="setMode"
      />
    </FormRow>

    <FormRow :label="t('fq.pg.settings.gw.address')" :hint="t('fq.pg.settings.gw.addressHint')">
      <TextInput v-model="url" :placeholder="placeholder" type="url" mono :invalid="!urlOk" />
      <Btn size="sm" :disabled="!urlOk || !urlChanged" data-testid="gw-apply" @click="applyUrl">{{
        t('fq.pg.settings.apply')
      }}</Btn>
      <Btn size="sm" :busy="probing" data-testid="gw-probe" @click="probe">{{
        t('fq.pg.settings.gw.probe')
      }}</Btn>
    </FormRow>

    <FormRow :label="t('fq.pg.settings.gw.state')">
      <Badge :kind="stateKind" :label="t(`fq.pg.settings.gw.st.${stateKey}`)" />
    </FormRow>

    <FormRow :label="t('fq.pg.settings.gw.lastProbe')" :hint="t('fq.pg.settings.gw.lastProbeHint')">
      <span v-if="probe_" class="facts" data-testid="gw-probe-facts">
        <b :class="probe_.ok ? 'ok' : 'ko'">{{
          probe_.ok ? t('fq.pg.settings.gw.reachable') : t('fq.pg.settings.gw.unreachable')
        }}</b>
        <span class="mut"
          >{{ when(probe_.atMs) }} · {{ t('fq.pg.settings.gw.ago', { s: probeAge }) }}</span
        >
        <span v-if="probe_.ok" class="mut num">
          {{ t('fq.pg.settings.gw.protocol') }} {{ probe_.protocol }} · v{{ probe_.version }} ·
          {{ probe_.rttMs }} ms
        </span>
      </span>
      <span v-else class="mut">{{ t('fq.pg.settings.gw.noProbe') }}</span>
    </FormRow>

    <FormRow :label="t('fq.pg.settings.gw.skew')" :hint="t('fq.pg.settings.gw.skewHint')">
      <span class="num">{{ skew }}</span>
    </FormRow>
  </div>
</template>

<style scoped>
.gw {
  display: grid;
}
.facts {
  display: grid;
  gap: 2px;
  justify-items: end;
  font-size: var(--t-sm);
}
.ok {
  color: var(--profit);
}
.ko {
  color: var(--loss);
}
.mut {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}
</style>
