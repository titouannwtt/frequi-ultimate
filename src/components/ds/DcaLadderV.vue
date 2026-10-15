<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import DsIcon from './DsIcon.vue';
import { layoutLadderV, type LadderOrder } from './lib/ladder';
import { useFormat } from './lib/useFormat';

export interface DcaLadderVPosition {
  /** Current price. */
  price: number;
  /** Average entry price. */
  avg: number;
  /** Take-profit price. */
  tp: number;
  /** Liquidation price, shown under the ladder. */
  liquidation?: number;
  /** Distance to liquidation, in percent. */
  liquidationDistancePct?: number;
}

const props = defineProps<{
  position: DcaLadderVPosition;
  /** Orders in execution order: the entry first, then each safety order. */
  orders: LadderOrder[];
}>();

const { t } = useI18n();
const fmt = useFormat();

const layout = computed(() =>
  layoutLadderV(props.orders, [
    {
      kind: 'tp',
      price: props.position.tp,
      text: `${t('fq.ds.ladder.tp')} ${fmt.price(props.position.tp)}`,
    },
    {
      kind: 'avg',
      price: props.position.avg,
      text: `${t('fq.ds.ladder.avg')} ${fmt.price(props.position.avg)}`,
    },
    {
      kind: 'px',
      price: props.position.price,
      text: `${t('fq.ds.ladder.price')} ${fmt.price(props.position.price)}`,
    },
  ]),
);

function barLabel(o: LadderOrder): string {
  const pending = o.state === 'filled' ? '' : ` (${t('fq.ds.ladder.pending')})`;
  return `${o.label} · ${fmt.number(o.stake, 0)}${pending}`;
}
</script>

<template>
  <div class="lad-v" role="list" :aria-label="t('fq.ds.ladder.title')">
    <div
      v-for="row in layout.rows"
      :key="row.id"
      class="lvl"
      :class="{ pend: row.state !== 'filled', next: row.state === 'next' }"
      role="listitem"
    >
      <span class="pr">{{ fmt.price(row.price) }}</span>
      <span class="bar" :style="{ width: row.widthPct + '%' }">
        <span class="bl">{{ barLabel(row) }}</span>
      </span>
    </div>
    <div
      v-for="line in layout.lines"
      :key="line.kind"
      class="ln"
      :class="line.kind"
      :style="{ top: line.y + 'px' }"
    >
      <span :style="{ top: line.labelY - line.y + 'px' }">{{ line.text }}</span>
    </div>
    <div v-if="position.liquidation !== undefined" class="liqf">
      <DsIcon name="arrow-down" :size="13" />
      {{ t('fq.ds.ladder.liquidation') }} {{ fmt.price(position.liquidation) }}
      <template v-if="position.liquidationDistancePct !== undefined">
        &middot; {{ t('fq.ds.ladder.at') }}
        {{ fmt.percent(position.liquidationDistancePct, 1, false) }}
      </template>
    </div>
  </div>
</template>

<style scoped>
.lad-v {
  position: relative;
  padding: 4px 0;
}
.lvl {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  height: 28px;
  gap: 8px;
}
.pr {
  font: 500 var(--t-xs) var(--font-num);
  color: var(--fg-3);
  text-align: right;
}
.bar {
  height: 12px;
  border-radius: 2px;
  background: var(--fg-3);
  position: relative;
}
.pend .bar {
  background: none;
  border: 1px dashed var(--fg-3);
}
.next .bar {
  border-color: var(--warn);
}
.bl {
  position: absolute;
  left: calc(100% + 6px);
  top: -2px;
  background: var(--bg-1);
  padding: 0 3px;
  font: 500 var(--t-xs) var(--font-num);
  color: var(--fg-2);
  white-space: nowrap;
}
.ln {
  position: absolute;
  left: 72px;
  right: 0;
  height: 0;
  border-top: 1px solid;
  pointer-events: none;
  transition: top var(--d-slow) var(--e-out);
}
.ln span {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  font: 600 var(--t-xs) var(--font-num);
  padding: 0 4px;
  background: var(--bg-1);
  white-space: nowrap;
  z-index: 3;
  transition: top var(--d-slow) var(--e-out);
}
.ln.avg {
  border-color: var(--accent);
}
.ln.avg span {
  color: var(--accent);
}
.ln.tp {
  border-color: var(--profit);
  border-top-style: dashed;
}
.ln.tp span {
  color: var(--profit);
}
.ln.px {
  border-color: var(--fg);
}
.ln.px span {
  color: var(--fg);
}
.liqf {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 0 0 72px;
  font: 600 var(--t-xs) var(--font-num);
  color: var(--crit);
}
</style>
