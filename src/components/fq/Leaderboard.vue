<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { EmptyState, ExcludedCount, ModeMark, PnlValue } from '@/components/ds';
import type { BotRef } from '@/components/ds';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { ScopeRef } from '@/datasource/types';
import type { BotKey, BotMode } from '@/gateway/types.gen';

import {
  itemsFromBots,
  rank,
  type LeaderboardItem,
  type LeaderboardPeriod,
} from './lib/leaderboard';

/**
 * Realised result per bot over a period, as bars centred on zero (02 section 5.2). One mode at a
 * time (live by default): live, dry and replay are never added together. Bots whose figure is stale
 * or unknown are listed as excluded and neither drawn nor summed. Pure DOM, no chart instance.
 */
const props = withDefaults(
  defineProps<{
    scope: ScopeRef;
    period: LeaderboardPeriod;
    mode?: BotMode;
    /** Replaces the figures read from the fleet (the Journal feeds its filtered set). */
    items?: LeaderboardItem[];
    limit?: number;
    nowMs?: number;
  }>(),
  { mode: 'live' },
);

const emit = defineEmits<{ select: [botKey: BotKey] }>();

const { t } = useI18n();
const fleet = useFqFleetStore();
const prefs = useFqPrefsStore();
const conn = useFqConnectionStore();
const clock = useNowMs();
const now = computed(() => props.nowMs ?? clock.value);

const scopedBots = computed(() => {
  const s = props.scope;
  if (s.kind === 'bot') return fleet.list.filter((b) => b.bot_key === s.botKey);
  if (s.kind === 'group') {
    const keys = new Set(prefs.settings.fleet.groups.find((g) => g.id === s.id)?.botKeys ?? []);
    return fleet.list.filter((b) => keys.has(b.bot_key));
  }
  return fleet.list;
});

const items = computed(
  () =>
    props.items ??
    itemsFromBots(scopedBots.value, props.period, now.value, conn.status.clockSkewMs),
);
const ranking = computed(() => rank(items.value, props.mode));
const shown = computed(() => {
  const r = ranking.value.rows;
  return props.limit ? r.slice(0, props.limit) : r;
});
const hidden = computed(() => ranking.value.rows.length - shown.value.length);
const excludedRefs = computed<BotRef[]>(() =>
  ranking.value.excluded.map((r) => ({
    key: r.key,
    name: r.name,
    reason: r.stale ? t('fq.status.stale') : t('fq.lb.unknown'),
  })),
);
</script>

<template>
  <div class="lb" data-testid="leaderboard">
    <div class="head">
      <span class="ttl">{{ t(`fq.lb.title.${period}`) }}</span>
      <span class="meta">{{ t('fq.lb.centered') }}</span>
      <ExcludedCount :bots="excludedRefs" @select="(b) => emit('select', b.key)" />
    </div>
    <ul v-if="shown.length > 0" class="rows">
      <li v-for="r in shown" :key="r.key" class="row" :class="{ off: !r.counted }">
        <button type="button" class="nm" :title="r.name" @click="emit('select', r.key)">
          <ModeMark :mode="r.mode" />
          <span class="t">{{ r.name }}</span>
        </button>
        <span class="track" aria-hidden="true">
          <span class="axis"></span>
          <i
            v-if="r.counted && r.ratio > 0"
            class="bar"
            :class="(r.value as number) >= 0 ? 'p' : 'n'"
            :style="{ width: `${r.ratio * 50}%` }"
          ></i>
          <i v-else-if="!r.counted" class="hatch"></i>
        </span>
        <span class="val">
          <PnlValue v-if="r.value !== null" :value="r.value" :muted="!r.counted" :decimals="2" />
          <span v-else class="unk">{{ t('fq.lb.unknown') }}</span>
        </span>
      </li>
    </ul>
    <EmptyState v-else icon="activity" :title="t('fq.lb.empty')" :hint="t('fq.lb.emptyHint')" />
    <p v-if="hidden > 0" class="more">{{ t('fq.lb.more', { n: hidden }) }}</p>
    <div v-if="shown.length > 0" class="sum">
      <span>{{ t('fq.lb.total', { n: ranking.counted }) }}</span>
      <PnlValue :value="ranking.total" :decimals="2" />
    </div>
  </div>
</template>

<style scoped>
.lb {
  display: grid;
  min-width: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 6px var(--s3);
  border-bottom: 1px solid var(--line);
  font-size: var(--t-xs);
  flex-wrap: wrap;
}
.ttl {
  font-weight: 600;
  color: var(--fg);
}
.meta {
  color: var(--fg-3);
  margin-right: auto;
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.row {
  display: grid;
  grid-template-columns: minmax(90px, 1.1fr) minmax(80px, 1.6fr) minmax(64px, auto);
  align-items: center;
  gap: var(--s2);
  padding: 0 var(--s3);
  height: var(--row);
  border-bottom: 1px solid var(--line);
  font-size: var(--t-sm);
}
.row.off {
  background-image: var(--stale-hatch);
}
.nm {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  background: none;
  border: 0;
  padding: 0;
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.nm:hover .t {
  text-decoration: underline;
}
.t {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track {
  position: relative;
  height: 10px;
  display: block;
}
.axis {
  position: absolute;
  left: 50%;
  top: -3px;
  bottom: -3px;
  width: 1px;
  background: var(--line-2);
}
.bar {
  position: absolute;
  top: 2px;
  height: 6px;
  border-radius: 1px;
  min-width: 2px;
}
.bar.p {
  left: 50%;
  background: var(--profit);
}
.bar.n {
  right: 50%;
  background: var(--loss);
}
.hatch {
  position: absolute;
  inset: 2px 0;
  background-image: var(--stale-hatch);
  opacity: 0.8;
}
.val {
  text-align: right;
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
.unk {
  color: var(--fg-3);
  font-family: var(--font-ui);
}
.more {
  margin: 0;
  padding: 6px var(--s3);
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.sum {
  display: flex;
  justify-content: space-between;
  padding: 6px var(--s3);
  font-size: var(--t-sm);
  font-weight: 600;
  background: var(--bg-2);
  font-family: var(--font-num);
}
.sum > span:first-child {
  font-family: var(--font-ui);
  color: var(--fg-2);
  font-weight: 500;
}
</style>
