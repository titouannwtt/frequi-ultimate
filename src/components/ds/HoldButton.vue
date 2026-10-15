<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { useInflightLock } from '@/composables/useInflightLock';
import { HOLD_MS } from '@/utils/motion';
import DsIcon from './DsIcon.vue';

/**
 * Hold-to-confirm button for real-money actions (docs/redesign/02-design.md, sections 8 and 11).
 *
 * The delay is ONE constant, `HOLD_MS` (1000 ms): it is not a prop, it is never shortened, and it
 * does not depend on reduced motion (only the fill animation could, and it does not: the fill is
 * linear over the same `--hold` token). Works with the pointer and with Enter or Space held.
 * A release before the end emits `tooShort` and shows the help text.
 */
const props = withDefaults(
  defineProps<{
    /** The gesture written on the button, for example "Hold to exit with real money". */
    label: string;
    tone?: 'danger' | 'go';
    disabled?: boolean;
    /** Why the button is disabled (type the bot name first, offline...). */
    disabledReason?: string;
    /** In-flight lock key (`bot_key:action:trade_id`): a second completion is refused until released. */
    lockKey?: string;
  }>(),
  { tone: 'danger' },
);

const emit = defineEmits<{
  /** The hold went to the end. */
  complete: [];
  /** Released early; `heldMs` is how long it was held. */
  tooShort: [heldMs: number];
  /** Completed while the lock key was already held (duplicate submit); nothing was sent. */
  blocked: [key: string];
}>();

const { t } = useI18n();
const lock = useInflightLock();
const hintId = useId();

type Phase = 'idle' | 'holding' | 'done';
const phase = ref<Phase>('idle');
const hint = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
let resetTimer: ReturnType<typeof setTimeout> | undefined;
let startedAt = 0;

const locked = computed(() => lock.isLocked(props.lockKey));
const inactive = computed(() => props.disabled || locked.value);

function clearTimers() {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
}

function start(event?: Event) {
  if (props.disabled || locked.value || phase.value !== 'idle') {
    return;
  }
  event?.preventDefault();
  if (resetTimer !== undefined) {
    clearTimeout(resetTimer);
    resetTimer = undefined;
  }
  hint.value = '';
  startedAt = performance.now();
  phase.value = 'holding';
  timer = setTimeout(finish, HOLD_MS);
}

function finish() {
  timer = undefined;
  phase.value = 'done';
  if (props.lockKey && !lock.acquire(props.lockKey)) {
    emit('blocked', props.lockKey);
  } else {
    emit('complete');
  }
  // The button goes back to idle shortly after; the owner of the action closes the dialog
  resetTimer = setTimeout(() => {
    phase.value = 'idle';
    resetTimer = undefined;
  }, 600);
}

function stop() {
  if (phase.value !== 'holding') {
    return;
  }
  clearTimers();
  phase.value = 'idle';
  const heldMs = Math.max(0, performance.now() - startedAt);
  hint.value = t('fq.ds.hold.hint');
  emit('tooShort', heldMs);
}

function onKeydown(event: KeyboardEvent) {
  if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
    start(event);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
  }
}

function onKeyup(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    stop();
  }
}

function onPointerdown(event: PointerEvent) {
  // Primary button or touch only
  if (event.button !== undefined && event.button !== 0) {
    return;
  }
  start(event);
}

onBeforeUnmount(() => {
  clearTimers();
  if (resetTimer !== undefined) {
    clearTimeout(resetTimer);
  }
});
</script>

<template>
  <div class="hold-wrap">
    <button
      type="button"
      class="hold"
      :class="[tone, phase]"
      :aria-disabled="inactive || undefined"
      :aria-busy="locked || undefined"
      :aria-describedby="hint ? hintId : undefined"
      :title="disabled ? disabledReason : undefined"
      @pointerdown="onPointerdown"
      @pointerup="stop"
      @pointerleave="stop"
      @pointercancel="stop"
      @keydown="onKeydown"
      @keyup="onKeyup"
      @blur="stop"
      @click.prevent
      @contextmenu.prevent
    >
      <span class="fill" aria-hidden="true"></span>
      <span class="lbl">
        <DsIcon name="hand" :size="13" />
        {{ label }}
      </span>
    </button>
    <div :id="hintId" class="hold-hint" role="status" aria-live="polite">{{ hint }}</div>
  </div>
</template>

<style scoped>
.hold-wrap {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.hold {
  --h: 38px;
  height: var(--h);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  border-radius: var(--r-2);
  border: 1px solid var(--line-2);
  background: var(--bg-2);
  color: var(--fg);
  font-family: var(--font-ui);
  font-size: var(--t-md);
  font-weight: 600;
  white-space: nowrap;
  position: relative;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
  cursor: pointer;
}
@media (max-width: 599px), (pointer: coarse) {
  .hold {
    --h: 52px;
  }
}
.hold.danger {
  background: color-mix(in srgb, var(--loss) 22%, var(--bg-2));
  border-color: var(--loss);
}
.hold.go {
  background: color-mix(in srgb, var(--fg) 12%, var(--bg-2));
  border-color: var(--fg-3);
}
.fill {
  position: absolute;
  inset: 0;
  transform-origin: left;
  transform: scaleX(0);
  background: var(--loss);
  /* Fast reset when released */
  transition: transform var(--d-fast) var(--e-out);
}
.go .fill {
  background: var(--fg-3);
}
/* The fill is linear over --hold, a safety delay that reduced motion never shortens */
.holding .fill {
  transition: transform var(--hold) linear;
  transform: scaleX(1);
}
.done .fill {
  transform: scaleX(1);
  transition: none;
}
.lbl {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.hold[aria-disabled='true'] {
  opacity: 0.45;
  cursor: not-allowed;
}
.hold[aria-busy='true'] {
  cursor: progress;
}
.hold-hint {
  font-size: var(--t-xs);
  color: var(--warn);
  min-height: 15px;
  text-align: center;
}
</style>
