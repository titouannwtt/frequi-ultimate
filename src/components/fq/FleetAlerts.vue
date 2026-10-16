<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, DsIcon, ModeMark } from '@/components/ds';
import { useAlertControls } from '@/composables/useAlertControls';
import { SEVERITY_RANK } from '@/datasource/calc/alerts/rules';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPrefsStore } from '@/datasource/stores/prefs';
import type { Alert, BotMode, Severity } from '@/gateway/types.gen';

import {
  alertWording,
  ALERT_ACTIONS,
  detailKind,
  isWalletAlert,
  severityTone,
  type AlertActionId,
} from './lib/alerts';
import type { FleetNotice, NoticeActionId } from './lib/fleetPage';
import { formatClock, tomorrowAtMs } from './lib/time';
import { pairLabel } from './lib/trades';
import { useFormat } from '@/components/ds/lib/useFormat';

/**
 * The active alerts of the Fleet as cards under the verdict (docs/redesign/05-friendly-plan.md,
 * L4): one card per alert, worst first, with what it says in a sentence, its most useful action
 * and "Later" (silence 1 h, 4 h or until tomorrow) or "Seen" (acknowledge). The notices the page
 * derives (an expired session, a frozen bot, a drawdown above its limit, a liquidation too close,
 * an orphan position) are cards of the same kind, before the alerts of the same severity: they
 * have "Later" and no "Seen", the condition is what it is until it is fixed. Nothing here changes
 * a bot: "Pause entries" opens the confirmation of the bot like everywhere else. The rest of the
 * history (acknowledged, silenced, events) is behind the bell. A calm fleet renders nothing.
 */
const props = withDefaults(
  defineProps<{
    alerts: readonly Alert[];
    /** What no alert says but the owner must act on (derived by the page). */
    notices?: readonly FleetNotice[];
    /** Cards shown before "See the N others". */
    limit?: number;
    nowMs?: number;
  }>(),
  { limit: 3, notices: () => [] },
);

const emit = defineEmits<{
  action: [id: AlertActionId, alert: Alert];
  more: [];
  /** "See the bots" of a fleet figure. */
  bots: [];
  /** "Later" on a notice: its id and when it comes back. */
  later: [id: string, untilMs: number];
}>();

const { t } = useI18n();
const fmt = useFormat();
const fleet = useFqFleetStore();
const prefs = useFqPrefsStore();
const { ack, silence, onAction } = useAlertControls((id, a) => emit('action', id, a));

const now = computed(() => props.nowMs ?? Date.now());
const tz = computed(() => prefs.settings.tz);

/** What a card is, whether it comes from an alert or from a notice. */
interface Card {
  id: string;
  severity: Severity;
  title: string;
  /** Trading mode of the bot it is about, null for the wallet. */
  mode: BotMode | null;
  who: string;
  at: number | null;
  message: string;
  actions: { id: NoticeActionId; label: string }[];
  alert: Alert | null;
  notice: FleetNotice | null;
}

function botName(key: string | null): string {
  return (key ? fleet.bots[key]?.identity.name : undefined) ?? key ?? '';
}
function alertWho(a: Alert): string {
  return isWalletAlert(a) ? t('fq.alert.wallet') : botName(a.bot_key);
}
function alertMessage(a: Alert): string {
  const w = alertWording(a, (n) => fmt.number(n, 1));
  const kind = detailKind(a.detail);
  const summary = kind
    ? t(`fq.alert.detail.${kind}`)
    : w.messageKey === 'msg.noValue'
      ? t('fq.alert.detail.none')
      : '';
  return t(`fq.alert.${w.messageKey}`, { ...w.params, summary }).trim();
}
const actionLabel = (id: NoticeActionId) =>
  id === 'bots' ? t('fq.pg.fleet.notice.bots') : t(`fq.alert.action.${id}`);

function cardOfAlert(a: Alert): Card {
  return {
    id: a.id,
    severity: a.severity,
    title: t(`fq.alert.type.${a.type_id}`),
    mode: a.bot_key ? (fleet.bots[a.bot_key]?.identity.mode ?? null) : null,
    who: alertWho(a),
    at: a.since_ms,
    message: alertMessage(a),
    actions: ALERT_ACTIONS[a.type_id].slice(0, 2).map((id) => ({ id, label: actionLabel(id) })),
    alert: a,
    notice: null,
  };
}

function cardOfNotice(n: FleetNotice): Card {
  const name = botName(n.botKey);
  const base = {
    id: n.id,
    severity: n.severity,
    mode: n.mode,
    who: '',
    at: null,
    actions: n.actions.map((id) => ({ id, label: actionLabel(id) })),
    alert: null,
    notice: n,
  };
  const pct = (v: number | null) => fmt.number(v ?? 0, 1);
  switch (n.kind) {
    case 'authExpired':
    case 'offline':
      return {
        ...base,
        title:
          n.sinceMs !== null
            ? t('fq.pg.fleet.notice.silentSince', {
                bot: name,
                time: formatClock(n.sinceMs, tz.value),
              })
            : t('fq.pg.fleet.notice.silent', { bot: name }),
        message: t(`fq.pg.fleet.notice.${n.kind}`),
      };
    case 'frozen': {
      const names = n.botKeys.map(botName);
      return {
        ...base,
        title:
          n.n === 1
            ? t('fq.pg.fleet.notice.frozenOne', { bot: name })
            : t('fq.pg.fleet.notice.frozenMany', { n: n.n }),
        message:
          n.n === 1
            ? t('fq.pg.fleet.notice.frozenOneMsg')
            : t('fq.pg.fleet.notice.frozenManyMsg', {
                bots: names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : names.join(', '),
              }),
      };
    }
    case 'drawdown':
      return {
        ...base,
        title: t('fq.pg.fleet.notice.drawdown'),
        message: t('fq.pg.fleet.notice.drawdownMsg', {
          pct: pct(n.value),
          limit: fmt.number(n.threshold ?? 0, 0),
        }),
      };
    case 'liquidation':
      return {
        ...base,
        title: t('fq.pg.fleet.notice.liquidation'),
        who: name,
        message: t('fq.pg.fleet.notice.liquidationMsg', {
          pair: pairLabel(n.pair ?? ''),
          v: pct(n.value),
          limit: fmt.number(n.threshold ?? 0, 0),
        }),
      };
    default:
      return {
        ...base,
        title:
          n.n === 1
            ? t('fq.pg.fleet.notice.orphansOne')
            : t('fq.pg.fleet.notice.orphansMany', { n: n.n }),
        who: t('fq.alert.wallet'),
        message: t('fq.pg.fleet.notice.orphansMsg'),
      };
  }
}

// Worst first; at the same severity the notices come before the alerts (the sort is stable)
const cards = computed<Card[]>(() =>
  [...props.notices.map(cardOfNotice), ...props.alerts.map(cardOfAlert)].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  ),
);
const expanded = ref(false);
const shown = computed(() => (expanded.value ? cards.value : cards.value.slice(0, props.limit)));
const hidden = computed(() => cards.value.length - shown.value.length);
/** The alert centre lists alerts only: a hidden notice is opened here, in place. */
function more() {
  if (cards.value.slice(props.limit).some((c) => c.notice !== null)) expanded.value = true;
  else emit('more');
}

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

function later(c: Card, until: number) {
  laterFor.value = null;
  if (c.alert) void silence(c.alert, until);
  else emit('later', c.id, until);
}

/** A notice runs the same actions as an alert: a bot and no subject. */
function run(c: Card, id: NoticeActionId) {
  if (c.alert) return onAction(id as AlertActionId, c.alert);
  if (id === 'bots') return emit('bots');
  onAction(id, { bot_key: c.notice?.botKey ?? null, subject: null } as Alert);
}
</script>

<template>
  <section
    v-if="cards.length > 0"
    class="fa"
    :aria-label="t('fq.pg.fleet.alerts.label')"
    data-testid="fleet-alerts"
  >
    <article
      v-for="(c, i) in shown"
      :key="c.id"
      class="card"
      :class="severityTone(c.severity)"
      :style="{ '--i': i }"
      :data-alert-id="c.alert?.id"
      :data-notice="c.notice?.kind"
      :data-notice-id="c.notice?.id"
      :data-severity="c.severity"
    >
      <DsIcon
        class="sev"
        :name="
          c.severity === 'critical'
            ? 'octagon-alert'
            : c.severity === 'warning'
              ? 'triangle-alert'
              : 'info'
        "
        :size="18"
      />
      <div class="tx">
        <b class="title">
          {{ c.title }}
          <span v-if="c.mode || c.who" class="who"
            ><ModeMark v-if="c.mode" :mode="c.mode" /> {{ c.who }}</span
          >
          <time v-if="c.at !== null" class="at num">{{ formatClock(c.at, tz) }}</time>
        </b>
        <span class="msg">{{ c.message }}</span>
        <div
          v-if="laterFor === c.id"
          class="choices"
          role="group"
          :aria-label="t('fq.alert.silence.label')"
        >
          <Btn
            v-for="ch in choices"
            :key="ch.id"
            size="xs"
            :data-silence="ch.id"
            @click="later(c, ch.until)"
          >
            {{ ch.label }}
          </Btn>
        </div>
      </div>
      <div class="acts">
        <Btn
          v-for="(a, k) in c.actions"
          :key="a.id"
          size="sm"
          :variant="k === 0 ? 'primary' : 'ghost'"
          :data-alert-action="a.id"
          @click="run(c, a.id)"
        >
          {{ a.label }}
        </Btn>
        <Btn
          size="sm"
          variant="ghost"
          data-ctl="silence"
          :aria-pressed="laterFor === c.id"
          :title="t('fq.pg.fleet.alerts.laterHint')"
          @click="laterFor = laterFor === c.id ? null : c.id"
        >
          {{ t('fq.pg.fleet.alerts.later') }}
        </Btn>
        <Btn
          v-if="c.alert"
          size="sm"
          variant="ghost"
          data-ctl="ack"
          :title="t('fq.pg.fleet.alerts.seenHint')"
          @click="ack(c.alert.id)"
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
      @click="more"
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
