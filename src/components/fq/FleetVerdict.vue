<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { useNowMs } from '@/components/ds/lib/useNowMs';
import { modeAllows, useScope } from '@/composables/useScope';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { Alert } from '@/gateway/types.gen';

import { botState } from './lib/bots';
import { verdictOf } from './lib/fleetPage';

/**
 * The answer to "is everything fine?" in one sentence (docs/redesign/05-friendly-plan.md, L4),
 * and under it the facts that back it: how many bots of the shown mode are running and how many
 * positions are open. The sentence counts the active alerts of the scope; the alerts themselves
 * are the cards right under it.
 */
const props = defineProps<{
  /** The active alerts of the scope (the page decides which ones belong to it). */
  alerts: readonly Alert[];
  nowMs?: number;
}>();

const { t } = useI18n();
const scope = useScope();
const fleet = useFqFleetStore();
const positions = useFqPositionsStore();
const conn = useFqConnectionStore();
const clock = useNowMs();
const now = computed(() => props.nowMs ?? clock.value);

const verdict = computed(() => verdictOf(props.alerts));
/** The bots of the shown mode: the search box and the chips do not change the answer. */
const inMode = computed(() => fleet.list.filter((b) => modeAllows(b, scope.mode.value)));
const online = computed(
  () =>
    inMode.value.filter((b) => botState(b, now.value, conn.status.clockSkewMs) === 'online').length,
);
const openCount = computed(() => {
  const keys = new Set(inMode.value.map((b) => b.bot_key));
  return positions.list.filter((p) => !p.orphan && keys.has(p.bot_key)).length;
});

const sentence = computed(() => {
  if (!fleet.loaded) return t('fq.pg.fleet.verdict.loading');
  if (inMode.value.length === 0) return t('fq.pg.fleet.verdict.empty');
  const v = verdict.value;
  switch (v.level) {
    case 'critical':
      return t('fq.pg.fleet.verdict.critical', { n: v.n }, v.n);
    case 'many':
      return t('fq.pg.fleet.verdict.many', { n: v.n });
    case 'one':
      return t('fq.pg.fleet.verdict.one');
    default:
      return t('fq.pg.fleet.verdict.calm');
  }
});
const sub = computed(() => {
  if (!fleet.loaded || inMode.value.length === 0) return '';
  const key =
    scope.mode.value === 'live' ? 'subLive' : scope.mode.value === 'dry' ? 'subDry' : 'subAll';
  return [
    t(
      `fq.pg.fleet.verdict.${key}`,
      { online: online.value, total: inMode.value.length },
      online.value,
    ),
    t('fq.pg.fleet.verdict.positions', { n: openCount.value }, openCount.value),
  ].join(' · ');
});
const level = computed(() => (fleet.loaded ? verdict.value.level : 'loading'));
</script>

<template>
  <div class="v" role="status" :data-level="level" data-testid="fleet-verdict">
    <h1 class="big">
      <span class="dot" aria-hidden="true"></span>
      {{ sentence }}
    </h1>
    <p v-if="sub" class="sub">{{ sub }}</p>
  </div>
</template>

<style scoped>
.v {
  min-width: 0;
}
.big {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: var(--t-xl);
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.25;
}
.dot {
  flex: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--profit);
}
[data-level='one'] .dot,
[data-level='many'] .dot {
  background: var(--warn);
}
[data-level='critical'] .dot {
  background: var(--crit);
}
[data-level='loading'] .dot {
  background: var(--fg-4);
}
.sub {
  margin: 2px 0 0;
  color: var(--fg-2);
  font-size: var(--t-md);
}
@media (max-width: 599px) {
  .big {
    font-size: 19px;
  }
  .sub {
    font-size: 13.5px;
  }
}
</style>
