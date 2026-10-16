<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn, DsIcon, Menu, SegmentedControl } from '@/components/ds';
import type { MenuItem } from '@/components/ds';

import { timeframeOptions } from './lib/chartsPage';

/**
 * The timeframes of the Charts page: the four that are used (5 min, 15 min, 1 h, 4 h) and
 * "Other" for the rest (1 min, 30 min, 2 h, 1 day and the odd one a strategy runs on). When the
 * chart is on one of the others, the button carries its name. A bot only serves the candles of
 * its own timeframe: the menu is a list of what can be asked, not a promise.
 */
const props = defineProps<{
  tf: string;
  /** The timeframe of the context bot's strategy, listed even when it is unusual. */
  ownTf?: string | null;
}>();
const emit = defineEmits<{ select: [tf: string] }>();

const { t, te } = useI18n();
const MAIN = ['5m', '15m', '1h', '4h'] as const;
const name = (v: string) => (te(`fq.pg.charts.tf.${v}`) ? t(`fq.pg.charts.tf.${v}`) : v);
const options = MAIN.map((v) => ({ value: v as string, label: name(v) }));
const onMain = computed(() => (MAIN as readonly string[]).includes(props.tf));
const others = computed(() =>
  timeframeOptions(props.ownTf).filter((v) => !(MAIN as readonly string[]).includes(v)),
);
const items = computed<MenuItem[]>(() =>
  others.value.map((v) => ({
    id: v,
    label: name(v),
    icon: v === props.tf ? 'check' : undefined,
  })),
);

const anchor = ref<HTMLElement | null>(null);
const open = ref(false);
function toggle(e: MouseEvent) {
  anchor.value = e.currentTarget as HTMLElement;
  open.value = !open.value;
}
</script>

<template>
  <div class="tfs">
    <SegmentedControl
      :model-value="onMain ? tf : ''"
      :options="options"
      size="sm"
      :label="t('fq.pg.charts.timeframe')"
      @update:model-value="(v) => emit('select', v)"
    />
    <Btn
      v-if="others.length > 0 || !onMain"
      size="sm"
      :variant="onMain ? 'ghost' : 'secondary'"
      data-testid="charts-tf-other"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    >
      {{ onMain ? t('fq.pg.charts.otherTf') : name(tf) }}
      <DsIcon name="chevron-down" :size="13" />
    </Btn>
    <Menu
      :open="open"
      :anchor="anchor"
      :items="items"
      :label="t('fq.pg.charts.otherTf')"
      @select="(v) => emit('select', v)"
      @close="open = false"
    />
  </div>
</template>

<style scoped>
.tfs {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
</style>
