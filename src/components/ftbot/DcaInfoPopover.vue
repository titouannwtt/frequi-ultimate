<script setup lang="ts">
import type { Trade } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  trade: Trade;
  stakeCurrency?: string;
}>();

const botStore = useBotStore();

const currency = computed(() => {
  return props.stakeCurrency || botStore.activeBot?.stakeCurrency || 'USDC';
});

// Extract filled entry orders in chronological order
// Accept any entry order that is not open anymore, has filled amount, or has a fill timestamp
const entryOrders = computed(() => {
  if (!props.trade.orders || !Array.isArray(props.trade.orders)) return [];

  // First try: strict entry orders (ft_is_entry === true)
  const strictEntries = props.trade.orders.filter((o) => {
    if (!o.ft_is_entry) return false;
    const hasFillData = (o.filled ?? 0) > 0;
    const hasFillTs = !!o.order_filled_timestamp;
    const isClosed = o.status === 'closed' || o.status === 'filled';
    const notOpen = o.is_open === false;
    return hasFillData || hasFillTs || isClosed || notOpen;
  });

  if (strictEntries.length > 0) {
    return strictEntries.sort(
      (a, b) =>
        (a.order_filled_timestamp ?? a.order_timestamp ?? 0) -
        (b.order_filled_timestamp ?? b.order_timestamp ?? 0),
    );
  }

  // Fallback: use trade side to detect entries when ft_is_entry is missing/wrong
  const expectedSide = props.trade.is_short ? 'sell' : 'buy';
  const fallback = props.trade.orders
    .filter((o) => {
      if (o.ft_order_side !== expectedSide) return false;
      const hasFillData = (o.filled ?? 0) > 0;
      const hasFillTs = !!o.order_filled_timestamp;
      const isClosed = o.status === 'closed' || o.status === 'filled';
      const notOpen = o.is_open === false;
      return hasFillData || hasFillTs || isClosed || notOpen;
    })
    .sort(
      (a, b) =>
        (a.order_filled_timestamp ?? a.order_timestamp ?? 0) -
        (b.order_filled_timestamp ?? b.order_timestamp ?? 0),
    );

  // Debug log if fallback kicks in
  if (fallback.length > 0 && typeof window !== 'undefined') {
    console.debug('[DcaInfoPopover] Used side-based fallback for trade', props.trade.trade_id, {
      is_short: props.trade.is_short,
      expectedSide,
      ordersCount: props.trade.orders.length,
      entryCount: fallback.length,
    });
  }

  return fallback;
});

// Fallback: if orders are not available but nr_of_successful_entries > 1,
// show a message indicating DCA data is unavailable in this context
const hasOrderData = computed(
  () => props.trade.orders && Array.isArray(props.trade.orders) && props.trade.orders.length > 0,
);
const dcaCountFromTrade = computed(
  () => props.trade.nr_of_successful_entries ?? entryOrders.value.length,
);

const isDca = computed(() => dcaCountFromTrade.value > 1);
const dcaCount = computed(() => dcaCountFromTrade.value);

// Compute cumulative average price after each entry
interface DcaStep {
  index: number;
  price: number;
  amount: number;
  cost: number;
  timestamp: number;
  tag: string;
  // Cumulative
  cumAmount: number;
  cumCost: number;
  avgPriceAfter: number;
  avgPriceBefore: number;
  // Time info
  timeSincePrev: number; // ms since previous entry
}

const dcaSteps = computed<DcaStep[]>(() => {
  const orders = entryOrders.value;
  if (orders.length === 0) return [];

  // Cost is notional (price * amount). For leveraged positions, the actual margin is cost / leverage.
  const leverage = props.trade.leverage && props.trade.leverage > 1 ? props.trade.leverage : 1;

  const steps: DcaStep[] = [];
  let cumAmount = 0;
  let cumCost = 0;

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    const price = o.safe_price ?? 0;
    const amount = o.filled ?? o.amount ?? 0;
    if (amount <= 0 || price <= 0) continue; // Skip invalid orders
    const notional = o.cost ?? price * amount;
    const cost = notional / leverage; // Actual margin/stake contributed
    const ts = o.order_filled_timestamp ?? o.order_timestamp ?? 0;
    const tag = o.ft_order_tag ?? '';

    const avgBefore = cumAmount > 0 ? cumCost / cumAmount : 0;
    cumAmount += amount;
    cumCost += cost;
    const avgAfter = cumAmount > 0 ? cumCost / cumAmount : price;

    const prevTs = i > 0 ? (orders[i - 1].order_filled_timestamp ?? 0) : ts;

    steps.push({
      index: i + 1,
      price,
      amount,
      cost,
      timestamp: ts,
      tag,
      cumAmount,
      cumCost,
      avgPriceAfter: avgAfter,
      avgPriceBefore: avgBefore,
      timeSincePrev: i > 0 ? ts - prevTs : 0,
    });
  }
  return steps;
});

const lastDca = computed(() => {
  const steps = dcaSteps.value;
  return steps.length > 1 ? steps[steps.length - 1] : null;
});

const totalInvested = computed(() => {
  return props.trade.max_stake_amount ?? dcaSteps.value.reduce((s, d) => s + d.cost, 0);
});

// DCA colors — each entry gets a distinct color
const DCA_COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#c084fc', '#d8b4fe', '#e9d5ff'];

function dcaColor(index: number): string {
  return DCA_COLORS[Math.min(index, DCA_COLORS.length - 1)];
}

// SVG bar chart dimensions
const BAR_W = 350;
const BAR_H = 75;

const barData = computed(() => {
  const steps = dcaSteps.value;
  if (steps.length < 1) return [];
  const maxCost = Math.max(...steps.map((s) => s.cost), 0.001);
  const barWidth = Math.min((BAR_W - 10) / steps.length - 2, 50);
  return steps.map((s, i) => ({
    x: 5 + i * (barWidth + 2),
    height: (s.cost / maxCost) * (BAR_H - 16),
    width: barWidth,
    cost: s.cost,
    index: s.index,
    color: dcaColor(i),
  }));
});

// Stacked bar: cumulative cost segments for the bottom visualization
const stackedBar = computed(() => {
  const steps = dcaSteps.value;
  if (steps.length < 1) return [];
  const total = steps.reduce((s, d) => s + d.cost, 0);
  if (total <= 0) return [];
  let cumPct = 0;
  return steps.map((s, i) => {
    const pct = (s.cost / total) * 100;
    const segment = { index: s.index, pct, start: cumPct, color: dcaColor(i), cost: s.cost };
    cumPct += pct;
    return segment;
  });
});

function formatDurationMs(ms: number): string {
  if (ms < 60000) return '< 1m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${rh}h`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function timeAgo(ts: number): string {
  if (!ts) return '—';
  return formatDurationMs(Date.now() - ts);
}

function formatDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPrc(v: number): string {
  return v.toPrecision(6);
}
</script>

<template>
  <div class="p-4 text-xs min-w-[380px] max-w-[460px]">
    <div class="font-bold text-[13px] mb-2">
      {{ t('dcaInfo.title') }}
      <span class="text-surface-400 font-normal ml-1"
        >({{ dcaCount }} {{ t('dcaInfo.entries') }})</span
      >
    </div>

    <!-- No DCA -->
    <div v-if="!isDca" class="text-surface-400 text-center py-3">
      {{ t('dcaInfo.noDca') }}
    </div>

    <!-- DCA but no order details available -->
    <div v-else-if="!hasOrderData" class="text-surface-400 text-center py-3">
      {{ dcaCount }} DCA entries (order details not available)
    </div>

    <template v-else>
      <!-- Last DCA highlight -->
      <div
        v-if="lastDca"
        class="rounded-lg p-2.5 mb-3"
        style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.2)"
      >
        <div class="text-[11px] text-purple-300 uppercase tracking-wider mb-1">
          {{ t('dcaInfo.lastDca') }} (#{{ lastDca.index }})
        </div>
        <div class="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <span class="text-surface-400">{{ t('dcaInfo.price') }}</span>
          <span class="font-mono font-semibold text-purple-300">{{
            formatPrc(lastDca.price)
          }}</span>

          <span class="text-surface-400">{{ t('dcaInfo.amount') }}</span>
          <span class="font-mono">{{ lastDca.amount.toPrecision(5) }}</span>

          <span class="text-surface-400">{{ t('dcaInfo.cost') }}</span>
          <span class="font-mono">{{ lastDca.cost.toFixed(2) }} {{ currency }}</span>

          <span class="text-surface-400">{{ t('dcaInfo.avgBefore') }}</span>
          <span class="font-mono text-surface-300">{{ formatPrc(lastDca.avgPriceBefore) }}</span>

          <span class="text-surface-400">{{ t('dcaInfo.avgAfter') }}</span>
          <span class="font-mono text-white font-semibold">{{
            formatPrc(lastDca.avgPriceAfter)
          }}</span>

          <span class="text-surface-400">{{ t('dcaInfo.timeAgo') }}</span>
          <span class="font-mono">{{ timeAgo(lastDca.timestamp) }}</span>
        </div>
      </div>

      <!-- SVG bar chart: DCA cost escalation with distinct colors -->
      <div v-if="barData.length > 0" class="mb-3">
        <div class="text-[11px] text-surface-400 mb-1">{{ t('dcaInfo.costEscalation') }}</div>
        <svg :width="BAR_W" :height="BAR_H" class="w-full">
          <rect
            v-for="bar in barData"
            :key="bar.index"
            :x="bar.x"
            :y="BAR_H - 8 - bar.height"
            :width="bar.width"
            :height="bar.height"
            :fill="bar.color + '60'"
            :stroke="bar.color"
            stroke-width="0.8"
            rx="2"
          />
          <!-- Cost label above bar -->
          <text
            v-for="bar in barData"
            :key="'c-' + bar.index"
            :x="bar.x + bar.width / 2"
            :y="BAR_H - 10 - bar.height"
            text-anchor="middle"
            :fill="bar.color"
            font-size="9"
            font-weight="bold"
          >
            {{ bar.cost.toFixed(0) }}
          </text>
          <!-- Index label below bar -->
          <text
            v-for="bar in barData"
            :key="'l-' + bar.index"
            :x="bar.x + bar.width / 2"
            :y="BAR_H - 1"
            text-anchor="middle"
            fill="#9ca3af"
            font-size="9"
          >
            {{ bar.index === 1 ? 'Entry' : 'DCA ' + (bar.index - 1) }}
          </text>
        </svg>
      </div>

      <!-- Full DCA timeline with dates and colors -->
      <div class="space-y-1 mb-3">
        <div class="text-[11px] text-surface-400 uppercase tracking-wider mb-0.5">
          {{ t('dcaInfo.allEntries') }}
        </div>
        <div
          v-for="(step, i) in dcaSteps"
          :key="step.index"
          class="flex items-center gap-1.5 text-[12px] font-mono rounded px-2 py-1"
          :style="{
            background: dcaColor(i) + '10',
            borderLeft: '3px solid ' + dcaColor(i),
          }"
        >
          <span class="font-bold w-5 text-right" :style="{ color: dcaColor(i) }"
            >#{{ step.index }}</span
          >
          <span class="text-surface-200 w-[70px]">{{ formatPrc(step.price) }}</span>
          <span class="font-semibold w-[60px]" :style="{ color: dcaColor(i) }"
            >{{ step.cost.toFixed(1) }} {{ currency }}</span
          >
          <span class="text-surface-500 text-[11px]">{{ formatDate(step.timestamp) }}</span>
          <span class="text-surface-600 ml-auto text-[10px]">{{ timeAgo(step.timestamp) }}</span>
        </div>
      </div>

      <!-- Cumulative stacked bar -->
      <div v-if="stackedBar.length > 0" class="mb-3">
        <div class="text-[11px] text-surface-400 mb-1">
          Total invested: {{ totalInvested.toFixed(1) }} {{ currency }}
        </div>
        <div
          class="flex h-5 rounded-lg overflow-hidden"
          style="border: 1px solid rgba(255, 255, 255, 0.06)"
        >
          <div
            v-for="seg in stackedBar"
            :key="seg.index"
            class="flex items-center justify-center text-[8px] font-bold transition-all"
            :style="{
              width: seg.pct + '%',
              background: seg.color + '50',
              color: seg.color,
              borderRight: '1px solid rgba(0,0,0,0.3)',
            }"
            :title="
              '#' +
              seg.index +
              ': ' +
              seg.cost.toFixed(1) +
              ' ' +
              currency +
              ' (' +
              seg.pct.toFixed(0) +
              '%)'
            "
          >
            <span v-if="seg.pct > 8">{{ seg.cost.toFixed(0) }}</span>
          </div>
        </div>
        <!-- Legend -->
        <div class="flex flex-wrap gap-2 mt-1">
          <span
            v-for="seg in stackedBar"
            :key="'leg-' + seg.index"
            class="flex items-center gap-1 text-[10px]"
          >
            <span class="w-2 h-2 rounded-sm" :style="{ background: seg.color }" />
            {{ seg.index === 1 ? 'Entry' : 'DCA ' + (seg.index - 1) }}: {{ seg.pct.toFixed(0) }}%
          </span>
        </div>
      </div>

      <!-- Summary -->
      <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-surface-700 pt-2 text-[12px]">
        <span class="text-surface-400">{{ t('dcaInfo.totalInvested') }}</span>
        <span class="font-mono font-semibold">{{ totalInvested.toFixed(2) }} {{ currency }}</span>

        <span class="text-surface-400">{{ t('dcaInfo.avgEntry') }}</span>
        <span class="font-mono">{{ formatPrc(trade.open_rate) }}</span>

        <span class="text-surface-400">{{ t('dcaInfo.currentRate') }}</span>
        <span
          class="font-mono"
          :class="(trade.profit_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ trade.current_rate ? formatPrc(trade.current_rate) : '—' }}
        </span>
      </div>
    </template>
  </div>
</template>
