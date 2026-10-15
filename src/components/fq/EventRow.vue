<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { DsIcon, ModeMark, PnlValue } from '@/components/ds';
import type { DsIconRef } from '@/components/ds';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { Event, EventKind } from '@/gateway/types.gen';

import { pairLabel } from './lib/trades';
import { formatClock } from './lib/time';

/**
 * One event of the feed (fills, exits, alerts, restarts, actions of this or another device):
 * time, icon, what happened and to which bot. A profit is written with its sign.
 */
const props = defineProps<{
  event: Event;
  botName?: string | null;
  botMode?: 'live' | 'dry' | 'replay' | null;
}>();

const { t } = useI18n();
const prefs = useFqPrefsStore();

const ICONS: Record<EventKind, DsIconRef> = {
  entry_fill: 'log-in',
  exit_fill: 'log-out',
  entry_cancel: 'x',
  exit_cancel: 'x',
  protection_trigger: 'triangle-alert',
  warning: 'triangle-alert',
  startup: 'play',
  strategy_msg: 'info',
  daemon_incident: 'octagon-alert',
  alert_raised: 'siren',
  alert_resolved: 'circle-check',
  bot_online: 'plug-zap',
  bot_offline: 'plug-zap',
  bot_replaced: 'refresh-cw',
  action: 'hand',
};

const icon = computed(() => ICONS[props.event.kind]);
const tone = computed(() => {
  const s = props.event.severity;
  if (s === 'critical') return 'crit';
  if (s === 'warning') return 'warn';
  return '';
});
const what = computed(() => t(`fq.events.kind.${props.event.kind}`));
const subject = computed(() => {
  const e = props.event;
  const parts: string[] = [];
  if (e.pair) parts.push(pairLabel(e.pair));
  if (e.trade_id != null) parts.push(`#${e.trade_id}`);
  return parts.join(' ');
});
const time = computed(() => formatClock(props.event.ts_ms, prefs.settings.tz));
const hasProfit = computed(
  () => props.event.kind === 'exit_fill' && props.event.profit_abs != null,
);
</script>

<template>
  <li class="ev" :class="tone" :data-kind="event.kind">
    <time class="t num">{{ time }}</time>
    <DsIcon class="ic" :name="icon" :size="13" />
    <div class="b">
      <span class="what">{{ what }}</span>
      <span v-if="subject" class="subj num">{{ subject }}</span>
      <PnlValue v-if="hasProfit" :value="event.profit_abs" unit="USDC" />
      <span v-if="botName || event.bot_key" class="bot">
        <ModeMark v-if="botMode" :mode="botMode" />{{ botName ?? event.bot_key }}
      </span>
      <span v-if="event.detail" class="detail">{{ event.detail }}</span>
    </div>
  </li>
</template>

<style scoped>
.ev {
  display: grid;
  grid-template-columns: 44px 16px 1fr;
  gap: var(--s2);
  align-items: start;
  padding: 6px var(--s3);
  border-bottom: 1px solid var(--line);
  font-size: var(--t-sm);
  list-style: none;
}
.t {
  color: var(--fg-3);
  font-size: var(--t-xs);
  padding-top: 1px;
}
.ic {
  color: var(--fg-3);
  margin-top: 2px;
}
.crit .ic {
  color: var(--crit);
}
.warn .ic {
  color: var(--warn);
}
.b {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  align-items: baseline;
  min-width: 0;
}
.what {
  font-weight: 600;
}
.subj {
  color: var(--fg-2);
}
.bot {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.detail {
  flex: 1 0 100%;
  color: var(--fg-3);
  font-size: var(--t-xs);
  overflow-wrap: anywhere;
}
</style>
