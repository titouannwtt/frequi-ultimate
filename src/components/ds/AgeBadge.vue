<script setup lang="ts">
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ageMs, isStale } from './lib/freshness';
import { useFormat } from './lib/useFormat';
import { useNowMs } from './lib/useNowMs';

const props = withDefaults(
  defineProps<{
    /** Server time of the value (`freshness.as_of_ms`). */
    asOfMs: number;
    /** Stale once older than this (3 times the cadence of the channel). */
    staleAfterMs: number;
    /** `serverNow - clientNow` from the heartbeat. */
    clockSkewMs?: number;
    /** Frozen "now" (tests, screenshots); defaults to a shared 1 s clock. */
    nowMs?: number;
  }>(),
  { clockSkewMs: 0 },
);

const emit = defineEmits<{ stale: [value: boolean] }>();

const { t } = useI18n();
const fmt = useFormat();
const clock = useNowMs();

const age = computed(() => ageMs(props.asOfMs, props.nowMs ?? clock.value, props.clockSkewMs));
const stale = computed(() => isStale(age.value, props.staleAfterMs));
const text = computed(() => fmt.age(age.value));

watch(stale, (v) => emit('stale', v), { immediate: true });
</script>

<template>
  <span class="age num" :class="{ stale }" :title="stale ? t('fq.status.stale') : undefined">
    {{ text }}
    <span v-if="stale" class="sr">{{ t('fq.status.stale') }}</span>
  </span>
</template>

<style scoped>
.age {
  font: 500 var(--t-xs) var(--font-num);
  color: var(--fg-3);
  white-space: nowrap;
}
/* Amber age plus the hatch: stale never relies on colour alone */
.stale {
  color: var(--warn);
  background-image: var(--stale-hatch);
  border-radius: var(--r-1);
  padding: 0 3px;
}
</style>
