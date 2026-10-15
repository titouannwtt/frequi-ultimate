<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useFormat } from './lib/useFormat';
import type { ConnectionKind, ConnectionState } from './types';

const props = defineProps<{
  kind: ConnectionKind;
  state: ConnectionState;
  latencyMs?: number;
  /** A resynchronisation is running: a small ring, nothing else. */
  resyncing?: boolean;
  /** Time the values froze (offline), already formatted HH:MM:SS. */
  frozenAt?: string;
  /** Bump on every delta: plays one beat of the dot. */
  beat?: number;
}>();

const emit = defineEmits<{ click: [] }>();

const { t } = useI18n();
const fmt = useFormat();

const label = computed(() => {
  if (props.state === 'connecting') {
    return t('fq.connection.connecting');
  }
  if (props.state === 'degraded') {
    return t('fq.connection.degraded');
  }
  if (props.state === 'offline') {
    return props.frozenAt
      ? t('fq.ds.pill.offlineFrozen', { time: props.frozenAt })
      : t('fq.status.offline');
  }
  if (props.kind === 'direct') {
    return t('fq.ds.pill.direct');
  }
  return props.latencyMs !== undefined
    ? `${t('fq.connection.gateway')} ${fmt.number(Math.round(props.latencyMs), 0)} ms`
    : t('fq.connection.gateway');
});

// What the live region says: the state, not the changing latency
const announcement = computed(() => {
  const base =
    props.state === 'live'
      ? props.kind === 'direct'
        ? t('fq.ds.pill.direct')
        : t('fq.connection.gateway')
      : label.value;
  return props.resyncing ? `${base}, ${t('fq.ds.pill.resync')}` : base;
});

// One-shot beat on each delta; restarted by toggling the class on the next frame
const beating = ref(false);
watch(
  () => props.beat,
  () => {
    beating.value = false;
    requestAnimationFrame(() => {
      beating.value = true;
    });
  },
);
</script>

<template>
  <span class="conn-wrap">
    <button
      type="button"
      class="conn"
      :class="{ beat: beating, resync: resyncing }"
      :data-state="state"
      :data-kind="kind"
      @click="emit('click')"
      @animationend="beating = false"
    >
      <span class="d" aria-hidden="true"></span>
      <b class="lbl">{{ label }}</b>
      <span class="sync" aria-hidden="true"></span>
    </button>
    <!-- The state is announced from a separate live region: a role on the button would hide that it
         can be activated. The latency is left out so it does not announce on every tick. -->
    <span class="sr" role="status" aria-live="polite">{{ announcement }}</span>
  </span>
</template>

<style scoped>
.conn-wrap {
  display: inline-flex;
  position: relative;
}
.conn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 10px 0 9px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line-2);
  background: var(--bg);
  font-family: var(--font-ui);
  font-size: var(--t-sm);
  white-space: nowrap;
  color: var(--fg-2);
  cursor: pointer;
}
b {
  font-weight: 600;
  color: var(--fg);
}
.d {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--profit);
  position: relative;
  flex: none;
}
.conn[data-state='live'] .d::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1.5px solid var(--profit);
  opacity: 0;
}
.conn.beat .d::after {
  animation: fq-beat 700ms var(--e-out);
}
.conn[data-state='connecting'] .d {
  background: transparent;
  border: 2px solid var(--fg-3);
  border-top-color: var(--fg);
  animation: fq-spin 900ms linear infinite;
}
.conn[data-state='degraded'] {
  border-color: color-mix(in srgb, var(--warn) 55%, transparent);
}
.conn[data-state='degraded'] .d {
  background: var(--warn);
}
.conn[data-state='offline'] {
  border-color: color-mix(in srgb, var(--crit) 55%, transparent);
}
.conn[data-state='offline'] .d {
  background: var(--crit);
}
/* The direct source is a square, the gateway a circle: never colour alone */
.conn[data-kind='direct'] .d {
  border-radius: 2px;
}
.conn[data-kind='direct'][data-state='live'] .d {
  background: var(--warn);
}
.sync {
  display: none;
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--fg-3);
  border-right-color: transparent;
  border-radius: 50%;
  animation: fq-spin 800ms linear infinite;
}
.conn.resync .sync {
  display: inline-block;
}
@media (max-width: 599px), (pointer: coarse) {
  /* 44 px touch target around the 30 px pill */
  .conn::before {
    content: '';
    position: absolute;
    inset: -7px 0;
  }
}
@media (max-width: 599px) {
  .conn {
    padding: 0 8px;
    height: 30px;
    min-width: 44px;
  }
  /* On a phone the live gateway is a bare dot; "Direct" stays written */
  .conn[data-state='live'][data-kind='gateway'] .lbl {
    display: none;
  }
}
</style>
