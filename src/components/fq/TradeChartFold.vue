<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { Btn } from '@/components/ds';
import type { DataSource } from '@/datasource/types';
import type { Position } from '@/gateway/types.gen';

import type { ChartTrade } from './lib/chartTrades';
import TradeChart from './TradeChart.vue';

/**
 * "Show the chart" in a drawer: the chart of the trade is folded until asked for, so that opening
 * a drawer does not read candles nobody looks at. One click opens it, one click folds it again.
 */
defineProps<{
  trade: ChartTrade;
  position?: Position | null;
  /** A source to use instead of the active one (previews, tests). */
  source?: DataSource | null;
}>();

const { t } = useI18n();
const open = ref(false);
</script>

<template>
  <section class="fold" data-testid="trade-chart-fold">
    <Btn
      size="sm"
      variant="secondary"
      icon="chart-candlestick"
      :aria-expanded="open"
      data-testid="trade-chart-toggle"
      @click="open = !open"
    >
      {{ open ? t('fq.tradeChart.hide') : t('fq.tradeChart.show') }}
    </Btn>
    <TradeChart v-if="open" :trade="trade" :position="position" :source="source" />
  </section>
</template>

<style scoped>
.fold {
  display: grid;
  gap: var(--s2);
  padding: var(--s3);
  border-top: 1px solid var(--line);
}
</style>
