<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, Btn, EmptyState, FormRow, Skeleton } from '@/components/ds';
import { useDataSource } from '@/composables/useDataSource';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { AuditEntry } from '@/gateway/types.gen';

import { formatDateTime } from './lib/time';

/**
 * Settings > About and audit (02 section 3.6, 7): the version of this interface and of the
 * gateway, the browser keys the redesign owns (`fqu2.*`, never a secret shown), and the audit trail
 * of the writes made through the gateway. Direct mode has no trail: nothing is recorded there, and
 * the page says so instead of showing an empty table.
 */
const { t, locale } = useI18n();
const data = useDataSource();
const prefs = useFqPrefsStore();
const conn = useFqConnectionStore();

const uiVersion = typeof __FORK_VERSION__ === 'string' ? __FORK_VERSION__ : 'dev';
const commit = typeof __COMMIT_HASH__ === 'string' ? __COMMIT_HASH__ : '';
const keys = computed(() => {
  if (typeof localStorage === 'undefined') return [];
  const out: Array<{ key: string; bytes: number }> = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && k.startsWith('fqu2.')) {
      out.push({ key: k, bytes: (localStorage.getItem(k) ?? '').length });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
});

const entries = ref<AuditEntry[] | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const supported = computed(() => typeof data.source.value?.query.audit === 'function');

async function loadAudit() {
  const q = data.source.value?.query;
  if (!q?.audit) return;
  loading.value = true;
  try {
    entries.value = await q.audit({ limit: 50 });
    error.value = null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
onMounted(loadAudit);

const when = (ms: number) => formatDateTime(ms, prefs.settings.tz, locale.value);
const gatewayVersion = computed(() =>
  conn.kind === 'gateway' ? (conn.lastProbe?.version ?? null) : null,
);
</script>

<template>
  <div class="ab" data-testid="about-panel">
    <FormRow :label="t('fq.pg.settings.ab.ui')">
      <span class="num">v{{ uiVersion }}<template v-if="commit"> · {{ commit.slice(0, 8) }}</template></span>
    </FormRow>
    <FormRow :label="t('fq.pg.settings.ab.gateway')">
      <span v-if="gatewayVersion" class="num">v{{ gatewayVersion }}</span>
      <span v-else class="mut">{{ t('fq.pg.settings.ab.noGateway') }}</span>
    </FormRow>

    <h3>{{ t('fq.pg.settings.ab.keys') }}</h3>
    <p class="mut">{{ t('fq.pg.settings.ab.keysHint') }}</p>
    <ul class="keys" data-testid="about-keys">
      <li v-for="k in keys" :key="k.key">
        <code>{{ k.key }}</code>
        <span class="mut num">{{ t('fq.pg.settings.ab.bytes', { n: k.bytes }) }}</span>
      </li>
    </ul>

    <h3>
      {{ t('fq.pg.settings.ab.audit') }}
      <Btn v-if="supported" size="xs" :busy="loading" @click="loadAudit">{{ t('fq.pg.tools.refresh') }}</Btn>
    </h3>
    <EmptyState
      v-if="!supported"
      icon="file-text"
      :title="t('fq.pg.settings.ab.noAudit')"
      :hint="t('fq.pg.settings.ab.noAuditHint')"
    />
    <p v-else-if="error" class="mut">{{ t('fq.pg.settings.ab.auditFailed', { detail: error }) }}</p>
    <Skeleton v-else-if="entries === null" :count="3" />
    <EmptyState
      v-else-if="entries.length === 0"
      icon="file-text"
      :title="t('fq.pg.settings.ab.auditEmpty')"
    />
    <div v-else class="wrap">
      <table data-testid="audit-table">
        <thead>
          <tr>
            <th class="l">{{ t('fq.pg.settings.ab.when') }}</th>
            <th class="l">{{ t('fq.pg.tools.bot') }}</th>
            <th class="l">{{ t('fq.pg.settings.ab.action') }}</th>
            <th>{{ t('fq.pg.settings.ab.http') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="`${e.ts_ms}-${e.idempotency_key}`">
            <td class="l num">{{ when(e.ts_ms) }}</td>
            <td class="l">{{ e.bot_name }} <Badge :kind="e.mode === 'live' ? 'live' : 'dry'" /></td>
            <td class="l">{{ e.action }}</td>
            <td class="num">{{ e.http_status ?? t('fq.ds.dash') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.ab {
  display: grid;
  gap: var(--s2);
  min-width: 0;
}
h3 {
  display: flex;
  align-items: center;
  gap: var(--s2);
  margin: var(--s3) 0 0;
  font-size: var(--t-md);
  font-weight: 600;
  color: var(--fg-2);
}
.mut {
  color: var(--fg-3);
  font-size: var(--t-xs);
  margin: 0;
}
.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}
.keys {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}
.keys li {
  display: flex;
  justify-content: space-between;
  gap: var(--s3);
  font-size: var(--t-sm);
}
.wrap {
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--t-sm);
}
th {
  height: 30px;
  padding: 0 8px;
  color: var(--fg-3);
  font-weight: 500;
  font-size: var(--t-xs);
  text-align: right;
}
td {
  height: 30px;
  padding: 0 8px;
  text-align: right;
  border-top: 1px solid var(--line);
}
.l {
  text-align: left;
}
</style>
