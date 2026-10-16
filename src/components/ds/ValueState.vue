<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import DsIcon from './DsIcon.vue';
import { formatAge } from './lib/format';
import { beginPending, endPending, PENDING_TIMEOUT_MS } from './lib/pending';
import { useNowMs } from './lib/useNowMs';

/**
 * What a value slot shows when there is no figure (docs/redesign/02-design.md, section 10.1). Never
 * a word ("n/a", "latent", "unknown"): an icon.
 *
 * - `ready`: the default slot (the figure).
 * - `pending`: not received yet, the source is loading or retrying. A small spinner in `--fg-3`
 *   (a slow opacity pulse under reduced motion). After `timeoutMs` (45 s) it becomes
 *   `unavailable` with "no answer for N s", so it never spins forever.
 * - `unavailable`: loaded, but the figure does not exist or cannot be known now. A static muted
 *   icon, the reason in the tooltip and in the accessible name.
 *
 * The slot keeps the width of a short number, so the row does not move when the figure arrives.
 */
const props = withDefaults(
  defineProps<{
    state?: 'ready' | 'pending' | 'unavailable';
    /** Why the figure is unavailable, already translated. */
    reason?: string;
    /** Identity of the wait (for example `bot:port/latent`): the 45 s survive a remount. */
    pendingKey?: string;
    /** Start of the wait, ms on the client clock; wins over `pendingKey`. */
    since?: number;
    timeoutMs?: number;
    /** Frozen clock (tests); otherwise the shared 1 s clock. */
    nowMs?: number;
    /** A live region: one per panel (a KPI tile), never one per table cell. */
    announce?: boolean;
  }>(),
  { state: 'ready', timeoutMs: PENDING_TIMEOUT_MS },
);

const { t, locale } = useI18n();
const clock = useNowMs();
const now = computed(() => props.nowMs ?? clock.value);

// ---- the wait ----
const started = ref<number>(Date.now());
let key: string | null = null;
function join() {
  if (props.state === 'pending' && key === null) {
    key = props.pendingKey ?? null;
    started.value = key ? beginPending(key, now.value) : now.value;
  } else if (props.state !== 'pending' && key !== null) {
    leave();
  }
}
function leave() {
  if (key !== null) endPending(key, now.value);
  key = null;
}
watch(() => [props.state, props.pendingKey], join, { immediate: true });
onBeforeUnmount(leave);

const waitedMs = computed(() => Math.max(0, now.value - (props.since ?? started.value)));
const timedOut = computed(() => props.state === 'pending' && waitedMs.value >= props.timeoutMs);
const phase = computed(() =>
  props.state === 'ready'
    ? 'ready'
    : props.state === 'pending' && !timedOut.value
      ? 'pending'
      : 'unavailable',
);
const text = computed(() =>
  timedOut.value
    ? t('fq.value.noAnswer', {
        age: formatAge(waitedMs.value, locale.value === 'fr' ? 'fr' : 'en'),
      })
    : props.reason || t('fq.value.unavailable'),
);

// The tooltip is `position: fixed`: a table cell or a scrolling panel cannot clip it
const anchor = ref<HTMLElement | null>(null);
const tipOpen = ref(false);
const tipStyle = ref<Record<string, string>>({});
function show() {
  const el = anchor.value;
  if (el) {
    const r = el.getBoundingClientRect();
    tipStyle.value = {
      '--tx': `${Math.round(r.left + r.width / 2)}px`,
      '--ty': `${Math.round(r.bottom + 6)}px`,
    };
  }
  tipOpen.value = true;
}
const hide = () => (tipOpen.value = false);
</script>

<template>
  <slot v-if="phase === 'ready'" />
  <span
    v-else-if="phase === 'pending'"
    class="vs vs-pending"
    data-state="pending"
    :role="announce ? 'status' : 'img'"
    :aria-label="t('fq.ds.loading')"
    ><DsIcon name="loader-circle" class="vs-ico vs-spin"
  /></span>
  <span
    v-else
    ref="anchor"
    class="vs vs-na"
    data-state="unavailable"
    :data-timeout="timedOut ? '' : undefined"
    role="img"
    tabindex="-1"
    :aria-label="text"
    @pointerenter="show"
    @pointerleave="hide"
    @focus="show"
    @blur="hide"
    ><DsIcon :name="timedOut ? 'clock-alert' : 'circle-slash'" class="vs-ico" /><span
      v-if="tipOpen"
      class="vs-tip"
      aria-hidden="true"
      :style="tipStyle"
      >{{ text }}</span
    ></span
  >
</template>

<style scoped>
.vs {
  display: inline-block;
  min-width: 2.4ch;
  color: var(--fg-3);
  font-weight: 400;
  letter-spacing: 0;
  line-height: 1;
  text-align: inherit;
  white-space: nowrap;
  vertical-align: baseline;
}
.vs-ico {
  width: 0.85em;
  height: 0.85em;
  vertical-align: -0.1em;
}
.vs-spin {
  animation: fq-spin 900ms linear infinite;
}
.vs-na {
  position: relative;
  cursor: help;
  opacity: 0.8;
  outline: none;
}
.vs-na:hover,
.vs-na:focus-visible {
  opacity: 1;
}
.vs-tip {
  position: fixed;
  left: clamp(108px, var(--tx, 0px), calc(100vw - 108px));
  top: var(--ty, 0px);
  transform: translateX(-50%);
  z-index: 60;
  width: max-content;
  max-width: 200px;
  padding: 4px 8px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  background: var(--bg-3);
  box-shadow: var(--shadow-float);
  color: var(--fg);
  font: 400 var(--t-xs) / 1.35 var(--font-ui);
  text-align: left;
  white-space: normal;
  pointer-events: none;
}
</style>
