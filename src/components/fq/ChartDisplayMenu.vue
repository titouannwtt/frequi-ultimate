<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { Popover } from '@/components/ds';
import type { ChartDisplay } from '@/composables/useChartDisplay';

/**
 * The "Affichage" menu of the Charts page: one place for what used to be eight controls (Heikin-Ashi,
 * Measure, one or two cells, Indicators, Sub-charts N/M and the overlay chips). Every row is a plain
 * sentence with a switch; the two last rows are the measuring tool and the indicators sheet. Nothing
 * here writes to a bot.
 */
const props = defineProps<{
  open: boolean;
  anchor: HTMLElement | null;
  display: ChartDisplay;
  heikinAshi: boolean;
  /** Two charts side by side; only offered when the screen has room for them. */
  twoCells: boolean;
  canSplit: boolean;
  measure: boolean;
  /** Sub-charts the strategy offers and how many are drawn, for the line under "Indicators". */
  subs: { total: number; shown: number } | null;
}>();

const emit = defineEmits<{
  close: [];
  toggle: [key: keyof ChartDisplay | 'ha' | 'cells' | 'measure', on: boolean];
  indicators: [];
}>();

const { t } = useI18n();

interface Row {
  key: keyof ChartDisplay | 'ha' | 'cells';
  on: boolean;
  label: string;
  hint?: string;
}
const rows = computed<Row[]>(() => {
  const d = props.display;
  const out: Row[] = [
    {
      key: 'levels',
      on: d.levels,
      label: t('fq.pg.charts.display.levels'),
      hint: t('fq.pg.charts.display.levelsHint'),
    },
    { key: 'fills', on: d.fills, label: t('fq.pg.charts.display.fills') },
    { key: 'pending', on: d.pending, label: t('fq.pg.charts.display.pending') },
    { key: 'gain', on: d.gain, label: t('fq.pg.charts.display.gain') },
    { key: 'closed', on: d.closed, label: t('fq.pg.charts.display.closed') },
    {
      key: 'ha',
      on: props.heikinAshi,
      label: t('fq.pg.charts.display.ha'),
      hint: t('fq.pg.charts.display.haHint'),
    },
  ];
  if (props.canSplit) {
    out.push({ key: 'cells', on: props.twoCells, label: t('fq.pg.charts.display.cells') });
  }
  return out;
});
</script>

<template>
  <Popover
    :open="open"
    :anchor="anchor"
    placement="bottom-end"
    :label="t('fq.pg.charts.display.title')"
    @close="emit('close')"
  >
    <div class="dm" data-testid="charts-display-menu">
      <button
        v-for="r in rows"
        :key="r.key"
        type="button"
        role="switch"
        class="row"
        :aria-checked="r.on"
        :data-testid="`charts-ov-${r.key}`"
        @click="emit('toggle', r.key, !r.on)"
      >
        <span class="txt">
          <span class="lab">{{ r.label }}</span>
          <small v-if="r.hint">{{ r.hint }}</small>
        </span>
        <span class="tg" :class="{ on: r.on }" aria-hidden="true"></span>
      </button>
      <hr />
      <button
        type="button"
        class="row"
        data-testid="charts-indicators"
        @click="
          emit('indicators');
          emit('close');
        "
      >
        <span class="txt">
          <span class="lab">{{ t('fq.pg.charts.display.indicators') }}</span>
          <small v-if="subs">{{
            t('fq.pg.charts.display.indicatorsHint', { shown: subs.shown, total: subs.total })
          }}</small>
        </span>
      </button>
      <button
        type="button"
        role="switch"
        class="row"
        :aria-checked="measure"
        data-testid="charts-measure"
        @click="emit('toggle', 'measure', !measure)"
      >
        <span class="txt">
          <span class="lab">{{ t('fq.pg.charts.display.measure') }}</span>
          <small>{{ t('fq.pg.charts.display.measureHint') }}</small>
        </span>
        <span class="tg" :class="{ on: measure }" aria-hidden="true"></span>
      </button>
    </div>
  </Popover>
</template>

<style scoped>
.dm {
  display: flex;
  flex-direction: column;
  width: min(300px, calc(100vw - 24px));
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 36px;
  padding: 6px 14px;
  border: 0;
  background: none;
  color: var(--fg);
  font: inherit;
  font-size: var(--t-sm);
  text-align: left;
  cursor: pointer;
}
.row:hover,
.row:focus-visible {
  background: var(--bg-2);
}
.txt {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
small {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.tg {
  flex: none;
  position: relative;
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
}
.tg::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--fg-3);
  transition: transform var(--d-fast) var(--e-out);
}
.tg.on {
  background: var(--accent-w);
  border-color: var(--accent);
}
.tg.on::after {
  transform: translateX(14px);
  background: var(--accent);
}
hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 5px 0;
}
@media (max-width: 599px), (pointer: coarse) {
  .row {
    min-height: 44px;
  }
}
</style>
