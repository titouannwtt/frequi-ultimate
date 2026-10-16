<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { AgeBadge, Badge, Btn, DsIcon, EmptyState, Meter, ValueState } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useValueSlot } from '@/composables/useValueSlot';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqHealthStore } from '@/datasource/stores/health';
import type { Health, HealthReason } from '@/gateway/types.gen';

import { unavailable } from './lib/valueState';
import { budgetTone, hasFigureDetail, hitRateTone, isKnownReason, sortReasons } from './lib/risk';

/**
 * System health (02 section 4.1 C6): the level and its reasons in words, the request budget, the
 * cache, the backoff and the freshness of the digest. The status bar shows the level in 26 px;
 * this is the sheet behind it, and the Diagnostic section of the tools (`detail`, which adds the
 * connection facts). Values are never invented: a figure the source did not give is an unavailable icon.
 */
const props = withDefaults(
  defineProps<{
    detail?: boolean;
    /** Replaces the store (previews and tests). */
    health?: Health | null;
    nowMs?: number;
  }>(),
  { detail: false },
);

const emit = defineEmits<{ openAlert: [alertId: string]; openLogs: [] }>();

const { t } = useI18n();
const fmt = useFormat();
const store = useFqHealthStore();
const conn = useFqConnectionStore();
const { vs } = useValueSlot();
// The health is loaded: a figure it does not carry is unavailable (the direct mode reads no budget)
const gap = computed(() => vs(unavailable(conn.kind === 'direct' ? 'direct' : 'noData')));

const h = computed<Health | null>(() => (props.health !== undefined ? props.health : store.health));
const reasons = computed(() => sortReasons(h.value?.reasons ?? []));
const level = computed(() => h.value?.level ?? 'degraded');

function reasonText(r: HealthReason): string {
  return isKnownReason(r.code) ? t(`fq.sysh.reason.${r.code}`) : r.code;
}
/** The detail is a bare figure for some codes (`rate_budget_low`: the percentage left): worded here. */
function reasonDetail(r: HealthReason): string | null {
  if (!r.detail) return null;
  if (!hasFigureDetail(r.code)) return r.detail;
  const n = Number(r.detail);
  return Number.isFinite(n) ? t(`fq.sysh.detail.${r.code}`, { n }, n) : r.detail;
}
const budget = computed(() => h.value?.rate_budget_pct ?? null);
const hit = computed(() => h.value?.hit_rate ?? null);
const connState = computed(() => conn.status);
</script>

<template>
  <div class="sh" data-testid="system-health">
    <EmptyState
      v-if="!h"
      icon="activity"
      :loading="!store.unavailable"
      :title="store.unavailable ? t('fq.connection.unavailableDirect') : t('fq.sysh.waiting')"
      :hint="store.unavailable ?? undefined"
    />
    <template v-else>
      <header class="lvl" :class="`l-${level}`" data-testid="health-level">
        <DsIcon :name="level === 'ok' ? 'circle-check' : 'triangle-alert'" :size="15" />
        <b>{{ t(`fq.sysh.level.${level}`) }}</b>
        <AgeBadge
          :as-of-ms="h.freshness.as_of_ms"
          :stale-after-ms="45_000"
          :clock-skew-ms="conn.status.clockSkewMs"
          :now-ms="nowMs"
        />
      </header>

      <section>
        <h4>{{ t('fq.sysh.reasons') }}</h4>
        <ul v-if="reasons.length > 0" class="reasons">
          <li v-for="r in reasons" :key="r.code" :class="r.severity">
            <DsIcon
              :name="r.severity === 'critical' ? 'octagon-alert' : 'triangle-alert'"
              :size="15"
            />
            <span class="rt">
              <b>{{ reasonText(r) }}</b>
              <span v-if="reasonDetail(r)" class="mut"> · {{ reasonDetail(r) }}</span>
            </span>
            <Btn
              v-if="r.alert_id"
              size="xs"
              variant="ghost"
              @click="emit('openAlert', r.alert_id)"
              >{{ t('fq.sysh.openAlert') }}</Btn
            >
          </li>
        </ul>
        <p v-else class="mut" data-testid="health-no-reason">{{ t('fq.sysh.noReason') }}</p>
      </section>

      <section class="gauges">
        <div class="g" data-testid="health-budget">
          <span class="k">{{ t('fq.sysh.budget') }}</span>
          <Meter
            v-if="budget !== null"
            :value="budget"
            :threshold="80"
            :tone="budgetTone(budget)"
            :label="t('fq.sysh.budget')"
          />
          <span class="v num"
            ><ValueState v-if="budget === null" v-bind="gap" /><template v-else>{{
              fmt.percent(budget, 0, false)
            }}</template></span
          >
        </div>
        <div class="g" data-testid="health-cache">
          <span class="k">{{ t('fq.sysh.cache') }}</span>
          <Meter
            v-if="hit !== null"
            :value="hit * 100"
            :tone="hitRateTone(hit)"
            :label="t('fq.sysh.cache')"
          />
          <span class="v num"
            ><ValueState v-if="hit === null" v-bind="gap" /><template v-else>{{
              fmt.percent(hit * 100, 1, false)
            }}</template></span
          >
        </div>
        <div class="g">
          <span class="k">{{ t('fq.sysh.backoff') }}</span>
          <span></span>
          <span class="v"
            ><Badge
              :kind="h.backoff_active ? 'warn' : 'neutral'"
              :label="h.backoff_active ? t('fq.sysh.backoffOn') : t('fq.sysh.backoffOff')"
          /></span>
        </div>
        <div class="g">
          <span class="k">{{ t('fq.sysh.processes') }}</span>
          <span></span>
          <span class="v num"
            ><ValueState v-if="h.bots_process === null" v-bind="gap" /><template v-else>{{
              h.bots_process
            }}</template></span
          >
        </div>
        <div class="g">
          <span class="k">{{ t('fq.sysh.digestAge') }}</span>
          <span></span>
          <span class="v num"
            ><ValueState v-if="h.digest_age_s === null" v-bind="gap" /><template v-else>{{
              fmt.age(h.digest_age_s * 1000)
            }}</template></span
          >
        </div>
      </section>

      <section v-if="detail" class="conn" data-testid="health-connection">
        <h4>{{ t('fq.sysh.connection') }}</h4>
        <dl>
          <dt>{{ t('fq.sysh.source') }}</dt>
          <dd>
            <template v-if="conn.kind">{{ t(`fq.sysh.kind.${conn.kind}`) }}</template>
            <ValueState v-else state="pending" />
          </dd>
          <dt>{{ t('fq.sysh.state') }}</dt>
          <dd>{{ t(`fq.sysh.conn.${connState.state}`) }}</dd>
          <dt>{{ t('fq.sysh.latency') }}</dt>
          <dd class="num">
            <ValueState v-if="connState.latencyMs === null" v-bind="gap" />
            <template v-else>{{ connState.latencyMs }} ms</template>
          </dd>
          <dt>{{ t('fq.sysh.skew') }}</dt>
          <dd class="num">{{ fmt.number(connState.clockSkewMs / 1000, 1) }} s</dd>
        </dl>
        <Btn size="sm" variant="ghost" icon="terminal" @click="emit('openLogs')">{{
          t('fq.sysh.openLogs')
        }}</Btn>
      </section>
    </template>
  </div>
</template>

<style scoped>
.sh {
  display: grid;
  gap: var(--s3);
  padding: var(--s3);
  min-width: 0;
  font-size: var(--t-sm);
}
h4 {
  margin: 0 0 6px;
  font-size: var(--t-xs);
  color: var(--fg-3);
  font-weight: 600;
}
.lvl {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 8px var(--s3);
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  background: var(--bg-2);
}
.lvl.l-ok {
  color: var(--profit);
  background: var(--profit-w);
}
.lvl.l-degraded {
  color: var(--warn);
  background: var(--warn-w);
}
.lvl.l-critical {
  color: var(--crit);
  background: var(--crit-w);
}
.lvl b {
  margin-right: auto;
}
.reasons {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
}
.reasons li {
  display: flex;
  align-items: flex-start;
  gap: var(--s2);
  padding: 6px 8px;
  border-radius: var(--r-1);
  background: var(--bg-2);
}
.reasons li.critical {
  box-shadow: inset 2px 0 0 var(--crit);
}
.reasons li.warning {
  box-shadow: inset 2px 0 0 var(--warn);
}
.rt {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.mut {
  color: var(--fg-3);
}
.gauges {
  display: grid;
  gap: 8px;
}
.g {
  display: grid;
  grid-template-columns: minmax(110px, 1fr) minmax(60px, 2fr) minmax(48px, auto);
  align-items: center;
  gap: var(--s2);
}
.k {
  color: var(--fg-2);
}
.v {
  text-align: right;
}
.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px var(--s3);
  margin: 0 0 var(--s2);
}
dt {
  color: var(--fg-3);
}
dd {
  margin: 0;
  text-align: right;
}
</style>
