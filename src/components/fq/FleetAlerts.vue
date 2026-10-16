<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, DsIcon, ModeMark } from '@/components/ds';
import { useAlertControls } from '@/composables/useAlertControls';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { Alert } from '@/gateway/types.gen';

import {
  alertWording,
  ALERT_ACTIONS,
  detailKind,
  isWalletAlert,
  severityTone,
  type AlertActionId,
} from './lib/alerts';
import { formatClock, tomorrowAtMs } from './lib/time';
import { useFormat } from '@/components/ds/lib/useFormat';

/**
 * The active alerts of the Fleet as cards under the verdict (docs/redesign/05-friendly-plan.md,
 * L4): one card per alert, worst first, with what it says in a sentence, its most useful action
 * and "Later" (silence 1 h, 4 h or until tomorrow) or "Seen" (acknowledge). Nothing here changes
 * a bot: "Pause entries" opens the confirmation of the bot like everywhere else. The rest of the
 * history (acknowledged, silenced, events) is behind the bell. A calm fleet renders nothing.
 */
const props = withDefaults(
  defineProps<{
    alerts: readonly Alert[];
    /** Cards shown before "See the N others" (which opens the alert centre). */
    limit?: number;
    nowMs?: number;
  }>(),
  { limit: 3 },
);

const emit = defineEmits<{
  action: [id: AlertActionId, alert: Alert];
  more: [];
}>();

const { t } = useI18n();
const fmt = useFormat();
const fleet = useFqFleetStore();
const prefs = useFqPrefsStore();
const { ack, silence, onAction } = useAlertControls((id, a) => emit('action', id, a));

const now = computed(() => props.nowMs ?? Date.now());
const tz = computed(() => prefs.settings.tz);
const shown = computed(() => props.alerts.slice(0, props.limit));
const hidden = computed(() => Math.max(0, props.alerts.length - props.limit));

const laterFor = ref<string | null>(null);
const choices = computed(() => [
  { id: '1h', label: t('fq.alert.silence.1h'), until: now.value + 3_600_000 },
  { id: '4h', label: t('fq.alert.silence.4h'), until: now.value + 4 * 3_600_000 },
  {
    id: 'tomorrow',
    label: t('fq.alert.silence.tomorrow'),
    until: tomorrowAtMs(now.value, tz.value),
  },
]);

function who(a: Alert): string {
  if (isWalletAlert(a)) return t('fq.alert.wallet');
  return (a.bot_key ? fleet.bots[a.bot_key]?.identity.name : undefined) ?? a.bot_key ?? '';
}
function modeOf(a: Alert) {
  return a.bot_key ? (fleet.bots[a.bot_key]?.identity.mode ?? null) : null;
}
function message(a: Alert): string {
  const w = alertWording(a, (n) => fmt.number(n, 1));
  const kind = detailKind(a.detail);
  const summary = kind
    ? t(`fq.alert.detail.${kind}`)
    : w.messageKey === 'msg.noValue'
      ? t('fq.alert.detail.none')
      : '';
  return t(`fq.alert.${w.messageKey}`, { ...w.params, summary }).trim();
}
function later(a: Alert, until: number) {
  laterFor.value = null;
  void silence(a, until);
}
</script>

<template>
  <section
    v-if="alerts.length > 0"
    class="fa"
    :aria-label="t('fq.pg.fleet.alerts.label')"
    data-testid="fleet-alerts"
  >
    <article
      v-for="(a, i) in shown"
      :key="a.id"
      class="card"
      :class="severityTone(a.severity)"
      :style="{ '--i': i }"
      :data-alert-id="a.id"
      :data-severity="a.severity"
    >
      <DsIcon
        class="sev"
        :name="
          a.severity === 'critical'
            ? 'octagon-alert'
            : a.severity === 'warning'
              ? 'triangle-alert'
              : 'info'
        "
        :size="18"
      />
      <div class="tx">
        <b class="title">
          {{ t(`fq.alert.type.${a.type_id}`) }}
          <span class="who"><ModeMark v-if="modeOf(a)" :mode="modeOf(a)!" /> {{ who(a) }}</span>
          <time class="at num">{{ formatClock(a.since_ms, tz) }}</time>
        </b>
        <span class="msg">{{ message(a) }}</span>
        <div
          v-if="laterFor === a.id"
          class="choices"
          role="group"
          :aria-label="t('fq.alert.silence.label')"
        >
          <Btn
            v-for="c in choices"
            :key="c.id"
            size="xs"
            :data-silence="c.id"
            @click="later(a, c.until)"
          >
            {{ c.label }}
          </Btn>
        </div>
      </div>
      <div class="acts">
        <Btn
          v-for="(id, k) in ALERT_ACTIONS[a.type_id].slice(0, 2)"
          :key="id"
          size="sm"
          :variant="k === 0 ? 'primary' : 'ghost'"
          :data-alert-action="id"
          @click="onAction(id, a)"
        >
          {{ t(`fq.alert.action.${id}`) }}
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          data-ctl="silence"
          :aria-pressed="laterFor === a.id"
          :title="t('fq.pg.fleet.alerts.laterHint')"
          @click="laterFor = laterFor === a.id ? null : a.id"
        >
          {{ t('fq.pg.fleet.alerts.later') }}
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          data-ctl="ack"
          :title="t('fq.pg.fleet.alerts.seenHint')"
          @click="ack(a.id)"
        >
          {{ t('fq.pg.fleet.alerts.seen') }}
        </Btn>
      </div>
    </article>
    <button
      v-if="hidden > 0"
      type="button"
      class="more"
      data-testid="fleet-alerts-more"
      @click="emit('more')"
    >
      {{ t('fq.pg.fleet.alerts.more', { n: hidden }) }}
    </button>
  </section>
</template>

<style scoped>
.fa {
  display: grid;
  gap: var(--s2);
}
.card {
  display: flex;
  align-items: center;
  gap: var(--s3);
  padding: var(--s3) var(--s4);
  border-radius: var(--r-card);
  border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
  background: var(--warn-w);
  flex-wrap: wrap;
  animation: fq-fa-in var(--d-base) var(--e-out) both;
  animation-delay: calc(var(--i, 0) * 40ms);
}
@keyframes fq-fa-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
}
.card.crit {
  border-color: color-mix(in srgb, var(--crit) 45%, transparent);
  background: var(--crit-w);
}
.card.info {
  border-color: color-mix(in srgb, var(--info) 30%, transparent);
  background: var(--info-w);
}
.sev {
  flex: none;
  color: var(--warn);
}
.crit .sev {
  color: var(--crit);
}
.info .sev {
  color: var(--info);
}
.tx {
  flex: 1 1 260px;
  min-width: 0;
  display: grid;
  gap: 2px;
}
.title {
  display: flex;
  align-items: baseline;
  gap: var(--s2);
  flex-wrap: wrap;
  font-size: var(--t-md);
  font-weight: 600;
}
.who {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--fg-2);
  font-weight: 500;
  font-size: var(--t-sm);
}
.at {
  margin-left: auto;
  color: var(--fg-3);
  font-size: var(--t-xs);
  font-weight: 400;
}
.msg {
  color: var(--fg-2);
  font-size: var(--t-sm);
  overflow-wrap: anywhere;
}
.choices {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  padding-top: 4px;
}
.acts {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex-wrap: wrap;
}
.more {
  justify-self: start;
  background: none;
  border: 0;
  padding: 4px 2px;
  color: var(--accent);
  font: inherit;
  font-size: var(--t-sm);
  cursor: pointer;
}
@media (max-width: 599px) {
  .card {
    padding: var(--s3);
    border-radius: 0;
  }
  .at {
    margin-left: 0;
  }
  .acts {
    width: 100%;
  }
}
</style>
