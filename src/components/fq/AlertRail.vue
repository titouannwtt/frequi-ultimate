<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, Btn, EmptyState, Tabs } from '@/components/ds';
import type { TabItem } from '@/components/ds';
import { requestAction } from '@/composables/useActionDialog';
import { useDataSource } from '@/composables/useDataSource';
import { useToaster } from '@/composables/useToaster';
import { useFqAlertsStore } from '@/datasource/stores/alerts';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { Alert, AlertView } from '@/gateway/types.gen';

import AlertItem from './AlertItem.vue';
import EventFeed from './EventFeed.vue';
import { railLevel, type AlertActionId } from './lib/alerts';
import SinceLastVisit from './SinceLastVisit.vue';

export type AlertTab = 'active' | 'acked' | 'silenced' | 'events';

/**
 * "Needs attention" (02 sections 3.1 and 5.2): the level (Calm, Watch, Critical), the tabs Active,
 * Acknowledged, Silenced and Events (with "Since your last visit" on top), and the alerts, worst
 * first. Critical alerts are never in a carousel; on a phone the first 4 show and "See the N
 * others" opens the rest. Acknowledge and Silence go through the data source (shared between
 * devices on the gateway; local to this tab in direct mode, and the rail says so). "Pause
 * entries" goes through the confirmation of the bot, like every mutation.
 */
const props = withDefaults(
  defineProps<{
    tab?: AlertTab;
    /** Alerts shown before "See the N others" (4 on a phone). */
    limit?: number;
    /** Only the alerts of this bot (the Bot page). */
    botKey?: string;
    nowMs?: number;
  }>(),
  { tab: 'active' },
);

const emit = defineEmits<{
  'update:tab': [tab: AlertTab];
  action: [id: AlertActionId, alert: Alert];
}>();

const { t } = useI18n();
const alerts = useFqAlertsStore();
const fleet = useFqFleetStore();
const data = useDataSource();
const toaster = useToaster();

const now = computed(() => props.nowMs ?? Date.now());
const local = ref<AlertTab>(props.tab);
watch(
  () => props.tab,
  (v) => (local.value = v),
);
const current = computed<AlertTab>({
  get: () => local.value,
  set: (v) => {
    local.value = v;
    emit('update:tab', v);
  },
});

function forTab(v: AlertView): Alert[] {
  const all = alerts.view(now.value, v);
  return props.botKey ? all.filter((a) => a.bot_key === props.botKey) : all;
}
const active = computed(() => forTab('active'));
const acked = computed(() => forTab('acked'));
const silenced = computed(() => forTab('silenced'));
const level = computed(() => railLevel(active.value));

const tabs = computed<TabItem[]>(() => [
  {
    id: 'active',
    label: t('fq.attention.active'),
    count: active.value.length,
    tone: level.value === 'critical' ? 'crit' : level.value === 'watch' ? 'warn' : undefined,
  },
  { id: 'acked', label: t('fq.attention.acknowledged'), count: acked.value.length },
  { id: 'silenced', label: t('fq.attention.silenced'), count: silenced.value.length },
  { id: 'events', label: t('fq.attention.events') },
]);

const shown = computed(() => {
  switch (current.value) {
    case 'active':
      return active.value;
    case 'acked':
      return acked.value;
    case 'silenced':
      return silenced.value;
    default:
      return [];
  }
});
const expanded = ref(false);
const visible = computed(() =>
  props.limit && !expanded.value ? shown.value.slice(0, props.limit) : shown.value,
);
const hidden = computed(() => shown.value.length - visible.value.length);

const bot = (a: Alert) => (a.bot_key ? fleet.bots[a.bot_key] : undefined);

function fail(message: string) {
  toaster.push({ kind: 'err', title: t('fq.alert.failed'), body: message });
}

async function ack(id: string) {
  const source = data.source.value;
  if (!source) return fail(t('fq.result.noSource'));
  try {
    await source.alerts.ack(id);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

async function silence(a: Alert, untilMs: number) {
  const source = data.source.value;
  if (!source) return fail(t('fq.result.noSource'));
  try {
    await source.alerts.silence({
      typeId: a.type_id,
      ...(a.bot_key ? { botKey: a.bot_key } : {}),
      ...(a.subject ? { subject: a.subject } : {}),
      untilMs,
    });
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

function onAction(id: AlertActionId, a: Alert) {
  if (id === 'pause' && a.bot_key) {
    // A mutation: the confirmation of THIS bot opens, nothing is sent from the rail
    requestAction(a.bot_key, { kind: 'stopbuy' });
    return;
  }
  emit('action', id, a);
}

const levelLabel = computed(() => t(`fq.attention.level.${level.value}`));
const levelKind = computed(() =>
  level.value === 'critical'
    ? ('crit' as const)
    : level.value === 'watch'
      ? ('warn' as const)
      : ('neutral' as const),
);
</script>

<template>
  <section class="rail" :aria-label="t('fq.attention.title')" data-testid="alert-rail">
    <header class="hd">
      <h3>{{ t('fq.attention.title') }}</h3>
      <Badge :kind="levelKind" :label="levelLabel" />
    </header>
    <Tabs v-model="current" :tabs="tabs" :label="t('fq.attention.title')" />
    <p v-if="alerts.loaded && !alerts.shared && current !== 'events'" class="note">
      {{ t('fq.alert.notShared') }}
    </p>
    <p v-if="alerts.unavailable" class="note">{{ t('fq.connection.unavailableDirect') }}</p>

    <div v-if="current === 'events'" class="events">
      <SinceLastVisit :now-ms="nowMs" />
      <EventFeed :bot="botKey" />
    </div>
    <template v-else>
      <div v-if="visible.length > 0" class="list">
        <AlertItem
          v-for="(a, i) in visible"
          :key="a.id"
          :style="{ '--i': i }"
          :alert="a"
          :bot-name="bot(a)?.identity.name ?? null"
          :bot-mode="bot(a)?.identity.mode ?? null"
          :view="current"
          :now-ms="nowMs"
          @ack="ack"
          @silence="(id, until) => silence(a, until)"
          @action="onAction"
        />
        <Btn v-if="hidden > 0" class="more" @click="expanded = true">
          {{ t('fq.trade.seeOthers', { n: hidden }) }}
        </Btn>
      </div>
      <EmptyState
        v-else
        icon="circle-check"
        :title="t('fq.attention.allClear')"
        :hint="current === 'active' ? t('fq.alert.allClearHint') : undefined"
      />
    </template>
  </section>
</template>

<style scoped>
.rail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  overflow: hidden;
}
.hd {
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: 8px var(--s3);
}
h3 {
  margin: 0;
  font-size: var(--t-md);
}
.note {
  margin: 0;
  padding: 5px var(--s3);
  color: var(--fg-3);
  font-size: var(--t-xs);
  border-bottom: 1px solid var(--line);
}
.list,
.events {
  overflow: auto;
  min-height: 0;
}
.more {
  margin: var(--s2) var(--s3);
  width: calc(100% - 2 * var(--s3));
}
</style>
