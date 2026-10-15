<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, Btn, DsIcon, IconBtn, ModeMark } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { Alert } from '@/gateway/types.gen';

import {
  alertWording,
  ALERT_ACTIONS,
  isWalletAlert,
  severityTone,
  type AlertActionId,
} from './lib/alerts';
import { formatClock, tomorrowAtMs } from './lib/time';

/**
 * One alert (02 sections 3.1 and 13.3): severity, title, the bot (violet dot for live, DRY badge)
 * or "wallet", a sentence with the measured value and its threshold, the time, the contextual
 * actions, then Acknowledge and Silence (1 h, 4 h, until tomorrow 08:00). Acknowledging and
 * silencing only reduce noise; they never touch a bot. The silence choices open inline, not in a
 * popover.
 */
const props = withDefaults(
  defineProps<{
    alert: Alert;
    botName?: string | null;
    botMode?: 'live' | 'dry' | 'replay' | null;
    actions?: readonly AlertActionId[];
    /** Where the alert is in its life: only an active one offers Acknowledge and Silence. */
    view?: 'active' | 'acked' | 'silenced';
    nowMs?: number;
  }>(),
  { botName: null, botMode: null, view: 'active' },
);

const emit = defineEmits<{
  ack: [alertId: string];
  silence: [alertId: string, untilMs: number];
  action: [id: AlertActionId, alert: Alert];
}>();

const { t } = useI18n();
const fmt = useFormat();
const prefs = useFqPrefsStore();

const wording = computed(() => alertWording(props.alert, (n) => fmt.number(n, 1)));
const message = computed(() => t(`fq.alert.${wording.value.messageKey}`, wording.value.params));
const title = computed(() => t(`fq.alert.type.${props.alert.type_id}`));
const tone = computed(() => severityTone(props.alert.severity));
const icon = computed(() =>
  props.alert.severity === 'critical'
    ? ('octagon-alert' as const)
    : props.alert.severity === 'warning'
      ? ('triangle-alert' as const)
      : ('info' as const),
);
const offered = computed(() => props.actions ?? ALERT_ACTIONS[props.alert.type_id]);
const tz = computed(() => prefs.settings.tz);
const time = computed(() => formatClock(props.alert.since_ms, tz.value));
const now = computed(() => props.nowMs ?? Date.now());

const silenceOpen = ref(false);
const silenceChoices = computed(() => [
  { id: '1h', label: t('fq.alert.silence.1h'), until: now.value + 3_600_000 },
  { id: '4h', label: t('fq.alert.silence.4h'), until: now.value + 4 * 3_600_000 },
  {
    id: 'tomorrow',
    label: t('fq.alert.silence.tomorrow'),
    until: tomorrowAtMs(now.value, tz.value),
  },
]);

function silence(until: number) {
  silenceOpen.value = false;
  emit('silence', props.alert.id, until);
}

const status = computed(() => {
  if (props.view === 'acked' && props.alert.acked_at_ms != null) {
    return t('fq.alert.ackedAt', { time: formatClock(props.alert.acked_at_ms, tz.value) });
  }
  if (props.view === 'silenced' && props.alert.silenced_until_ms != null) {
    return t('fq.alert.silencedUntil', {
      time: `${formatClock(props.alert.silenced_until_ms, tz.value)}`,
    });
  }
  return '';
});
</script>

<template>
  <article class="al" :class="[tone]" :data-alert-id="alert.id" :data-severity="alert.severity">
    <DsIcon class="sev" :name="icon" :size="18" />
    <div class="main">
      <header class="top">
        <h4>{{ title }}</h4>
        <span v-if="isWalletAlert(alert)" class="who">{{ t('fq.alert.wallet') }}</span>
        <span v-else class="who">
          <ModeMark v-if="botMode" :mode="botMode" />
          {{ botName ?? alert.bot_key }}
        </span>
        <Badge
          v-if="alert.subject && !isWalletAlert(alert)"
          kind="neutral"
          :label="alert.subject"
        />
        <time class="t num">{{ time }}</time>
      </header>
      <p class="msg num">{{ message }}</p>
      <p v-if="status" class="status">{{ status }}</p>
      <div v-if="view === 'active'" class="row">
        <div class="ctx">
          <Btn
            v-for="(id, i) in offered"
            :key="id"
            size="xs"
            :variant="i === 0 ? 'secondary' : 'ghost'"
            :data-alert-action="id"
            @click="emit('action', id, alert)"
          >
            {{ t(`fq.alert.action.${id}`) }}
          </Btn>
        </div>
        <div class="ctl">
          <IconBtn
            icon="check"
            :label="t('fq.alert.ack')"
            data-ctl="ack"
            @click="emit('ack', alert.id)"
          />
          <IconBtn
            icon="bell-off"
            :label="t('fq.alert.silence.label')"
            :pressed="silenceOpen"
            data-ctl="silence"
            @click="silenceOpen = !silenceOpen"
          />
        </div>
      </div>
      <div
        v-if="silenceOpen"
        class="choices"
        role="group"
        :aria-label="t('fq.alert.silence.label')"
      >
        <Btn
          v-for="c in silenceChoices"
          :key="c.id"
          size="xs"
          :data-silence="c.id"
          @click="silence(c.until)"
        >
          {{ c.label }}
        </Btn>
      </div>
    </div>
  </article>
</template>

<style scoped>
.al {
  display: flex;
  gap: var(--s2);
  padding: var(--s2) var(--s3);
  border-bottom: 1px solid var(--line);
  animation: fq-al-in var(--d-base) var(--e-out) both;
  animation-delay: calc(var(--i, 0) * 40ms);
}
@keyframes fq-al-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
.sev {
  flex: none;
  margin-top: 2px;
}
.crit .sev {
  color: var(--crit);
}
.warn .sev {
  color: var(--warn);
}
.info .sev {
  color: var(--info);
}
.main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 3px;
}
.top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
h4 {
  margin: 0;
  font-size: var(--t-md);
  font-weight: 600;
}
.who {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--fg-2);
  font-size: var(--t-sm);
}
.t {
  margin-left: auto;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.msg {
  margin: 0;
  color: var(--fg-2);
  font-size: var(--t-sm);
  overflow-wrap: anywhere;
}
.status {
  margin: 0;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--s2);
  justify-content: space-between;
}
.ctx,
.ctl,
.choices {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.choices {
  padding-top: 2px;
}
</style>
