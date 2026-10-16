<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  Badge,
  DirectionChip,
  EmptyState,
  KpiStrip,
  KpiTile,
  PnlValue,
  SegmentedControl,
} from '@/components/ds';
import type { SegmentOption } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useFqFleetStore } from '@/datasource/stores/fleet';

import { pairLabel } from './lib/trades';
import { byMarket, SHOCKS, stressable, stressTest, type StressInput } from './lib/stress';
import type { BotMode } from '@/gateway/types.gen';

/**
 * The stress test (02 sections 4.1 C5 and 12): every price moves by the same percentage and each
 * open position is tested against the liquidation price the exchange reports for it. It lists what
 * the model leaves out instead of pretending to be a forecast.
 */
const props = defineProps<{
  positions: readonly StressInput[];
  mode: BotMode;
}>();

const { t } = useI18n();
const fmt = useFormat();
const fleet = useFqFleetStore();

const shock = ref<number>(-10);
const options = computed<SegmentOption<number>[]>(() =>
  SHOCKS.map((s) => ({ value: s, label: `${s > 0 ? '+' : ''}${s} %` })),
);

const counted = computed(() =>
  stressable(props.positions, props.mode, (k) => fleet.bots[k]?.identity.mode ?? null),
);
const result = computed(() => stressTest(counted.value, shock.value));
const markets = computed(() => byMarket(counted.value));
const nameOf = (k: string) => fleet.bots[k]?.identity.name ?? k;
const shown = computed(() => result.value.rows.slice(0, 12));
</script>

<template>
  <div class="st" data-testid="stress-test">
    <div class="bar">
      <SegmentedControl
        v-model="shock"
        :options="options"
        :label="t('fq.stress.shock')"
        size="sm"
      />
      <span class="note">{{ t('fq.stress.allPrices') }}</span>
    </div>

    <EmptyState
      v-if="result.counted === 0"
      icon="shield-check"
      :title="t('fq.stress.empty')"
      :hint="t('fq.stress.emptyHint')"
    />
    <template v-else>
      <KpiStrip>
        <KpiTile
          :label="t('fq.stress.delta')"
          :sub="t('fq.stress.deltaSub', { n: result.counted })"
        >
          <template #value><PnlValue :value="result.delta" :decimals="0" unit="USDC" /></template>
        </KpiTile>
        <KpiTile
          :label="t('fq.stress.liquidated')"
          :value="String(result.liquidated)"
          :sub="t('fq.stress.liquidatedSub', { n: result.counted })"
          :alert="result.liquidated > 0"
        />
        <KpiTile
          :label="t('fq.stress.marginLost')"
          :value="fmt.number(result.marginLost, 0)"
          sub="USDC"
        />
      </KpiStrip>

      <p v-if="result.untested > 0" class="caveat">
        {{ t('fq.stress.untested', { n: result.untested }) }}
      </p>

      <div class="wrap">
        <table>
          <thead>
            <tr>
              <th class="l">{{ t('fq.stress.pair') }}</th>
              <th class="l">{{ t('fq.stress.bot') }}</th>
              <th>{{ t('fq.stress.price') }}</th>
              <th>{{ t('fq.stress.liq') }}</th>
              <th>{{ t('fq.stress.deltaCol') }}</th>
              <th class="l"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in shown" :key="`${r.botKey}|${r.pair}|${r.side}`">
              <td class="l"><DirectionChip :side="r.side" /> {{ pairLabel(r.pair) }}</td>
              <td class="l mut">{{ nameOf(r.botKey) }}</td>
              <td class="num">{{ fmt.price(r.shockedPrice) }}</td>
              <td class="num">
                {{
                  r.liquidationPrice === null ? t('fq.stress.na') : fmt.price(r.liquidationPrice)
                }}
              </td>
              <td class="num" :class="r.delta >= 0 ? 'pos' : 'neg'">
                {{ r.delta >= 0 ? '+' : '' }}{{ fmt.number(r.delta, 0) }}
              </td>
              <td class="l">
                <Badge v-if="r.liquidated" kind="crit" :label="t('fq.stress.liquidatedBadge')" />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="result.rows.length > shown.length" class="more">
          {{ t('fq.stress.more', { n: result.rows.length - shown.length }) }}
        </p>
      </div>

      <h3>{{ t('fq.stress.byMarket') }}</h3>
      <div class="wrap">
        <table>
          <thead>
            <tr>
              <th class="l">{{ t('fq.stress.market') }}</th>
              <th>{{ t('fq.side.longLetter') }}</th>
              <th>{{ t('fq.side.shortLetter') }}</th>
              <th>{{ t('fq.stress.positions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in markets" :key="m.market">
              <td class="l">{{ t(`fq.stress.mk.${m.market}`) }}</td>
              <td class="num">{{ fmt.number(m.long, 0) }}</td>
              <td class="num">{{ fmt.number(m.short, 0) }}</td>
              <td class="num">{{ m.positions }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="caveat">{{ t('fq.stress.limits') }}</p>
    </template>
  </div>
</template>

<style scoped>
.st {
  display: grid;
  gap: var(--s3);
  min-width: 0;
  text-align: left;
}
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s2);
}
.note {
  color: var(--fg-3);
  font-size: var(--t-xs);
}
h3 {
  margin: var(--s2) 0 0;
  font-size: var(--t-md);
  font-weight: 600;
}
.wrap {
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  background: var(--bg-1);
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--t-sm);
}
th {
  text-align: right;
  height: 30px;
  padding: 0 8px;
  color: var(--fg-3);
  font-weight: 500;
  font-size: var(--t-xs);
}
td {
  height: 30px;
  padding: 0 8px;
  text-align: right;
  border-top: 1px solid var(--line);
}
.l {
  text-align: left;
}
.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
}
.mut {
  color: var(--fg-3);
}
.pos {
  color: var(--profit);
}
.neg {
  color: var(--loss);
}
.caveat,
.more {
  margin: 0;
  color: var(--fg-3);
  font-size: var(--t-xs);
  padding: 0 2px;
}
.more {
  padding: var(--s2);
}
</style>
