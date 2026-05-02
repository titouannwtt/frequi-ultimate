<script setup lang="ts">
import { computed, ref } from 'vue';
import type { GlossaryEntry } from '@/types';

type VerdictLevel = 'good' | 'ok' | 'warn' | 'bad' | 'neutral';

const props = withDefaults(
  defineProps<{
    metricKey?: string;
    label?: string;
    value?: string | number;
    verdict?: VerdictLevel;
    verdictText?: string;
    glossary?: GlossaryEntry;
    position?: 'top' | 'bottom' | 'left' | 'right';
  }>(),
  { position: 'top', verdict: 'neutral' },
);

const store = useStrategyDevStore();
const showExpanded = ref(false);
const visible = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function show() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  visible.value = true;
}

function hide() {
  hideTimer = setTimeout(() => {
    visible.value = false;
    showExpanded.value = false;
  }, 150);
}

const entry = computed<GlossaryEntry | null>(() => {
  if (props.glossary) return props.glossary;
  if (!props.metricKey || !store.glossary) return null;
  const g = store.glossary;
  return g.metrics[props.metricKey] ?? g.samplers[props.metricKey] ?? g.losses[props.metricKey] ?? null;
});

const displayLabel = computed(() => props.label ?? entry.value?.label ?? props.metricKey ?? '');

const verdictColors: Record<VerdictLevel, { text: string; bg: string; border: string }> = {
  good: { text: 'var(--sd-success)', bg: 'var(--sd-success-dim)', border: 'rgba(166,227,161,0.3)' },
  ok: { text: 'var(--sd-info)', bg: 'var(--sd-info-dim)', border: 'rgba(137,180,250,0.3)' },
  warn: { text: 'var(--sd-warning)', bg: 'var(--sd-warning-dim)', border: 'rgba(249,226,175,0.3)' },
  bad: { text: 'var(--sd-danger)', bg: 'var(--sd-danger-dim)', border: 'rgba(243,139,168,0.3)' },
  neutral: { text: 'var(--sd-subtext)', bg: 'rgba(166,173,200,0.08)', border: 'var(--sd-border-subtle)' },
};

const verdictStyle = computed(() => verdictColors[props.verdict]);
</script>

<template>
  <span
    class="metric-popover-trigger"
    @mouseenter="show"
    @mouseleave="hide"
  >
    <slot />

    <Transition name="sd-pop">
      <div
        v-if="visible && (entry || verdictText)"
        class="metric-popover"
        :class="`metric-popover--${position}`"
        @mouseenter="show"
        @mouseleave="hide"
      >
        <!-- Header -->
        <div class="pop-header">
          <span class="pop-label">{{ displayLabel }}</span>
          <span
            v-if="value != null"
            class="pop-value"
            :style="{ color: verdictStyle.text }"
          >
            {{ value }}
          </span>
        </div>

        <!-- One-liner -->
        <p v-if="entry?.one_liner" class="pop-desc">{{ entry.one_liner }}</p>

        <!-- Verdict badge -->
        <div
          v-if="verdictText"
          class="pop-verdict"
          :style="{
            color: verdictStyle.text,
            background: verdictStyle.bg,
            borderColor: verdictStyle.border,
          }"
        >
          {{ verdictText }}
        </div>

        <!-- Range & Good values -->
        <div v-if="entry?.range || entry?.good" class="pop-meta">
          <span v-if="entry?.range" class="pop-meta-item">
            <span class="pop-meta-label">Range:</span> {{ entry.range }}
          </span>
          <span v-if="entry?.good" class="pop-meta-item">
            <span class="pop-meta-label">Good:</span> {{ entry.good }}
          </span>
        </div>

        <!-- Expandable explanation -->
        <button
          v-if="entry?.explanation && !showExpanded"
          class="pop-expand"
          @click.stop="showExpanded = true"
        >
          En savoir plus...
        </button>
        <p v-if="entry?.explanation && showExpanded" class="pop-explanation">
          {{ entry.explanation }}
        </p>
      </div>
    </Transition>
  </span>
</template>

<style scoped>
.metric-popover-trigger {
  position: relative;
  display: inline-flex;
  cursor: help;
}

.metric-popover {
  position: absolute;
  z-index: 50;
  min-width: 220px;
  max-width: 320px;
  padding: 10px 12px;
  background: var(--sd-base);
  border: 1px solid var(--sd-border);
  border-radius: var(--sd-radius-md);
  box-shadow: var(--sd-shadow-lg);
  pointer-events: auto;
}

.metric-popover--top {
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
}
.metric-popover--bottom {
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
}
.metric-popover--left {
  right: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
}
.metric-popover--right {
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
}

.pop-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.pop-label {
  font-size: var(--sd-text-sm);
  font-weight: 600;
  color: var(--sd-text);
}

.pop-value {
  font-size: var(--sd-text-base);
  font-weight: 700;
  font-family: var(--sd-font-mono);
}

.pop-desc {
  font-size: var(--sd-text-xs);
  color: var(--sd-subtext);
  line-height: 1.4;
  margin: 0 0 6px;
}

.pop-verdict {
  display: inline-block;
  font-size: var(--sd-text-2xs);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--sd-radius-sm);
  border: 1px solid;
  margin-bottom: 6px;
}

.pop-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--sd-text-2xs);
  color: var(--sd-overlay);
}

.pop-meta-label {
  font-weight: 600;
  color: var(--sd-subtext);
}

.pop-expand {
  font-size: var(--sd-text-2xs);
  color: var(--sd-info);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  margin-top: 4px;
}
.pop-expand:hover {
  text-decoration: underline;
}

.pop-explanation {
  font-size: var(--sd-text-2xs);
  color: var(--sd-subtext);
  line-height: 1.4;
  margin: 4px 0 0;
  padding-top: 4px;
  border-top: 1px solid var(--sd-border-subtle);
}

/* ── Transition ── */
.sd-pop-enter-active {
  transition: opacity 150ms ease, transform 150ms ease;
}
.sd-pop-leave-active {
  transition: opacity 100ms ease, transform 100ms ease;
}
.sd-pop-enter-from {
  opacity: 0;
  transform: translateX(-50%) scale(0.97);
}
.sd-pop-leave-to {
  opacity: 0;
}
.metric-popover--top.sd-pop-enter-from {
  transform: translateX(-50%) translateY(4px) scale(0.97);
}
.metric-popover--bottom.sd-pop-enter-from {
  transform: translateX(-50%) translateY(-4px) scale(0.97);
}
</style>
