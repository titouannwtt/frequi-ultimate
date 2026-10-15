<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BadgeKind } from './types';

const props = defineProps<{
  kind: BadgeKind;
  /** Text of the badge; the mode and origin kinds have a translated default. */
  label?: string;
}>();

const { t } = useI18n();

const DEFAULT_LABELS: Partial<Record<BadgeKind, string>> = {
  live: 'fq.ds.badge.live',
  dry: 'fq.ds.badge.dry',
  replay: 'fq.ds.badge.replay',
  xyz: 'fq.ds.badge.xyz',
  orphan: 'fq.ds.badge.orphan',
  manual: 'fq.origin.manual',
};

const text = computed(() => {
  if (props.label) {
    return props.label;
  }
  const key = DEFAULT_LABELS[props.kind];
  return key ? t(key) : '';
});
</script>

<template>
  <span class="badge" :class="kind">{{ text }}<slot /></span>
</template>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--r-1);
  font: 600 var(--t-xs) / 1 var(--font-ui);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
  flex: none;
  border: 1px solid transparent;
}
.live {
  color: var(--live);
  background: var(--live-w);
  border-color: color-mix(in srgb, var(--live) 40%, transparent);
}
.live::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--live);
}
.dry {
  color: var(--dry);
  border: 1px dashed var(--dry);
}
.replay {
  color: var(--info);
  border: 1px dashed var(--info);
}
.xyz {
  color: var(--info);
  background: var(--info-w);
}
.orphan {
  color: var(--crit);
  background: var(--crit-w);
  border-color: color-mix(in srgb, var(--crit) 40%, transparent);
}
.warn {
  color: var(--warn);
  background: var(--warn-w);
}
.crit {
  color: var(--crit);
  background: var(--crit-w);
}
.info {
  color: var(--info);
  background: var(--info-w);
}
.neutral {
  color: var(--fg-2);
  background: var(--bg-3);
}
.manual {
  color: var(--fg-2);
  border: 1px solid var(--line-2);
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}
</style>
