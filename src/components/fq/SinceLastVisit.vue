<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, DsIcon, PnlValue } from '@/components/ds';
import { useLastVisit } from '@/composables/useLastVisit';
import { useFqConnectionStore } from '@/datasource/stores/connection';
import { useFqEventsStore } from '@/datasource/stores/events';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';

import { digestOf } from './lib/digest';
import { formatDateTime } from './lib/time';
import { pairLabel } from './lib/trades';

/**
 * "Since your last visit" (02 section 3.1): what happened on the fleet while you were away,
 * computed from the events of the store: realised profit, winning and losing trades, entries and
 * reinforcements, alerts raised and resolved, restarts, the worst trade. The marker is per device
 * (`fqu2.lastVisit`); "Mark as seen" moves it to now.
 */
const props = defineProps<{ since?: number; nowMs?: number }>();
const emit = defineEmits<{ seen: [atMs: number] }>();

const { t, locale } = useI18n();
const events = useFqEventsStore();
const fleet = useFqFleetStore();
const conn = useFqConnectionStore();
const prefs = useFqPrefsStore();
const visit = useLastVisit();

const sinceMs = computed(() => props.since ?? visit.since());
const digest = computed(() => digestOf(events.events, sinceMs.value));
const worstBot = computed(() =>
  digest.value.worst?.bot_key ? (fleet.bots[digest.value.worst.bot_key]?.identity.name ?? '') : '',
);

function markSeen() {
  const at = props.nowMs ?? Date.now();
  visit.markSeen(at);
  emit('seen', at);
}
</script>

<template>
  <section class="slv" :aria-label="t('fq.attention.sinceLastVisit')">
    <header class="hd">
      <h4>{{ t('fq.attention.sinceLastVisit') }}</h4>
      <span class="since">{{ formatDateTime(sinceMs, prefs.settings.tz, locale) }}</span>
      <Btn size="xs" icon="check" @click="markSeen">{{ t('fq.attention.markSeen') }}</Btn>
    </header>
    <p v-if="conn.kind === 'direct'" class="note">{{ t('fq.events.directNote') }}</p>
    <p v-if="digest.total === 0" class="none">
      <DsIcon name="circle-check" :size="15" /> {{ t('fq.since.nothing') }}
    </p>
    <dl v-else class="grid">
      <div>
        <dt>{{ t('fq.since.realized') }}</dt>
        <dd><PnlValue :value="digest.realized" unit="USDC" /></dd>
      </div>
      <div>
        <dt>{{ t('fq.since.trades') }}</dt>
        <dd class="num">{{ t('fq.since.winLoss', { w: digest.wins, l: digest.losses }) }}</dd>
      </div>
      <div>
        <dt>{{ t('fq.since.entries') }}</dt>
        <dd class="num">{{ digest.entries }}</dd>
      </div>
      <div>
        <dt>{{ t('fq.since.alerts') }}</dt>
        <dd class="num">
          {{ t('fq.since.raisedResolved', { r: digest.alertsRaised, s: digest.alertsResolved }) }}
        </dd>
      </div>
      <div>
        <dt>{{ t('fq.since.restarts') }}</dt>
        <dd class="num">{{ digest.restarts }}</dd>
      </div>
      <div v-if="digest.worst">
        <dt>{{ t('fq.since.worst') }}</dt>
        <dd>
          <PnlValue :value="digest.worst.profit_abs" unit="USDC" />
          <span class="sub"
            >{{ digest.worst.pair ? pairLabel(digest.worst.pair) : '' }} {{ worstBot }}</span
          >
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.slv {
  border-bottom: 1px solid var(--line);
  background: var(--bg-2);
}
.hd {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 8px var(--s3);
}
h4 {
  margin: 0;
  font-size: var(--t-md);
}
.since {
  color: var(--fg-3);
  font-size: var(--t-xs);
  margin-right: auto;
}
.note {
  margin: 0;
  padding: 0 var(--s3) 6px;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.none {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0;
  padding: 4px var(--s3) 10px;
  color: var(--fg-2);
  font-size: var(--t-sm);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: var(--s2) var(--s3);
  margin: 0;
  padding: 0 var(--s3) var(--s3);
}
dt {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
dd {
  margin: 0;
  font: 600 var(--t-md) var(--font-num);
  display: grid;
}
.sub {
  color: var(--fg-3);
  font: 400 var(--t-xs) var(--font-ui);
}
</style>
