<script setup lang="ts">
/**
 * "Composites (batch B)" section of the /__ds showcase (docs/redesign/02-design.md, section 5.2):
 * curves, calendar, Journal analysis, risk, health, logs, pair navigator, candle chart, registry
 * and reconciliation, on fixtures that cover the edge cases (an unknown profit, an unknown, a custom
 * and a manual exit reason, a heavy left tail, a 23 hour day, stale bots, a pair held by two bots,
 * an orphan coin). The data source is a double that only reads: nothing here can reach a bot.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { Btn, SegmentedControl } from '@/components/ds';
import {
  BotRegistry,
  CandleChart,
  ClosedTradeSheet,
  DcaDepthTable,
  DistributionChart,
  EquityCurve,
  ExitReasonTable,
  Leaderboard,
  LogStream,
  MaeMfeBar,
  PairNavigator,
  PnlCalendar,
  ReconciliationTable,
  RiskPanel,
  SystemHealth,
} from '@/components/fq';
import {
  FIXTURE_NOW,
  makeFixture,
  resetStores,
  scopeDetailOf,
  seedStores,
} from '@/components/fq/fixtures';
import {
  closedPnlOf,
  makeCandles,
  makeClosedTrades,
  makeDailyPnl,
  makeDrawdown,
  makeEquity,
  makeRecon,
  makeRegistry,
  sourceB,
} from '@/components/fq/fixtures/charts';
import type { FillMark, Overlays } from '@/components/fq/lib/candles';
import type { EquityDefinition, EquityPeriod } from '@/components/fq/lib/equity';
import type { LeaderboardPeriod } from '@/components/fq/lib/leaderboard';
import type { PairFilter } from '@/components/fq/lib/pairs';
import { pnlPeriods } from '@/datasource/calc/periods';
import type { Health } from '@/gateway/types.gen';

const fixture = makeFixture(40);
const sb = sourceB(fixture);
const trades = makeClosedTrades(fixture.bots);
const botKey = fixture.bots[0]!.bot_key;

onMounted(() => seedStores(fixture));
onBeforeUnmount(() => resetStores());

// ---- equity ----
const period = ref<EquityPeriod>('7d');
const definition = ref<EquityDefinition>('with_open');
const eqSeries = computed(() =>
  makeEquity(
    definition.value,
    FIXTURE_NOW - { '24h': 1, '7d': 7, '30d': 30, all: 60 }[period.value] * 86_400_000,
  ),
);
const eqDd = makeDrawdown(closedPnlOf(trades));
const eqPartial = { ...makeEquity('realized'), unavailable: 'partial_history' };
const eqEmpty = { mode: 'realized' as const, points: [], unavailable: null, asOfMs: FIXTURE_NOW };

// ---- leaderboard ----
const lbPeriod = ref<LeaderboardPeriod>('30d');
const lbOptions = [
  { value: '1d' as LeaderboardPeriod, label: '1d' },
  { value: '7d' as LeaderboardPeriod, label: '7d' },
  { value: '30d' as LeaderboardPeriod, label: '30d' },
  { value: 'total' as LeaderboardPeriod, label: 'Total' },
];

// ---- calendar ----
const daily = makeDailyPnl();
const octBuckets = pnlPeriods(daily, 'day', 'Europe/Paris', FIXTURE_NOW, 120);
const marBuckets = pnlPeriods(daily, 'day', 'Europe/Paris', FIXTURE_NOW, 230);
const calMonth = ref('2026-10');

// ---- health ----
const health = fixture.health;
const healthOk: Health = {
  ...health,
  level: 'ok',
  reasons: [],
  rate_budget_pct: 22,
  backoff_active: false,
  hit_rate: 0.99,
};
const healthCrit: Health = {
  ...health,
  level: 'critical',
  reasons: [
    { code: 'bots_offline', severity: 'critical', detail: 'hippo_short_sharpe', alert_id: 'a2' },
    { code: 'rate_budget_low', severity: 'warning', detail: '12', alert_id: null },
    { code: 'mystery_code', severity: 'warning', detail: null, alert_id: null },
  ],
  rate_budget_pct: 88,
  hit_rate: 0.7,
  digest_age_s: null,
};

// ---- logs ----
const logBot = ref<string | null>(null);

// ---- pairs ----
const pairFilter = ref<PairFilter>('positions');
const pairKey = ref<string | null>(null);

// ---- candles ----
const candles = makeCandles(400);
const last = candles.data[candles.data.length - 1]![4]!;
const fill = (
  idx: number,
  kind: FillMark['kind'],
  price: number,
  label: string,
  win?: boolean,
): FillMark => ({
  ts: candles.data[idx]![0]!,
  price,
  kind,
  side: 'long',
  label,
  win,
});
const overlays: Overlays = {
  average: last * 0.97,
  tp: last * 1.03,
  liquidation: last * 0.8,
  safetyOrders: [
    { price: last * 0.95, state: 'filled', label: 'SO1' },
    { price: last * 0.92, state: 'next', label: 'SO2' },
    { price: last * 0.89, state: 'pending', label: 'SO3' },
  ],
  fills: [
    fill(300, 'entry', last * 1.0, 'Entry'),
    fill(340, 'dca', last * 0.95, 'SO1'),
    fill(380, 'exit', last * 1.02, 'Exit', true),
  ],
};
const ha = ref(false);

// ---- registry ----
const reg = makeRegistry(fixture);

// ---- sheet ----
const sheet = ref(false);
const sheetTrade = trades[0]!;
const sheetUnknown = trades.find((t) => t.profit_unknown)!;
const sheetNoExc = trades.find((t) => t.mae == null)!;
const sheetKind = ref<'full' | 'unknown' | 'noexc'>('full');
function openSheet(kind: 'full' | 'unknown' | 'noexc') {
  sheetKind.value = kind;
  sheet.value = true;
}
const sheetRow = computed(() =>
  sheetKind.value === 'unknown'
    ? sheetUnknown
    : sheetKind.value === 'noexc'
      ? sheetNoExc
      : sheetTrade,
);

const dsDetail = scopeDetailOf(fixture, { kind: 'fleet' });
const directTrades = trades.map((t) => ({
  ...t,
  dca_entries: undefined,
  mae: undefined,
  mfe: undefined,
}));
const noTrades: typeof trades = [];
const onlyOne = trades.filter((t) => !t.profit_unknown).slice(0, 1);
const recon = makeRecon();
</script>

<template>
  <section class="blk" aria-labelledby="s-comp-b" data-testid="composites-b">
    <h2 id="s-comp-b">Composites (batch B)</h2>

    <h3>EquityCurve (with open, realized, partial history, empty)</h3>
    <div class="grid2">
      <div class="frame">
        <EquityCurve
          v-model:period="period"
          v-model:definition="definition"
          :scope="{ kind: 'fleet' }"
          :series="eqSeries"
          :drawdown="eqDd"
          :now-ms="FIXTURE_NOW"
        />
      </div>
      <div class="frame">
        <EquityCurve
          :scope="{ kind: 'fleet' }"
          definition="realized"
          :series="eqPartial"
          :drawdown="null"
          :now-ms="FIXTURE_NOW"
        />
      </div>
      <div class="frame">
        <EquityCurve
          :scope="{ kind: 'fleet' }"
          :series="eqEmpty"
          :drawdown="null"
          :now-ms="FIXTURE_NOW"
        />
      </div>
    </div>

    <h3>Leaderboard (live; dry; stale and unknown bots excluded)</h3>
    <div class="row">
      <SegmentedControl v-model="lbPeriod" :options="lbOptions" size="sm" label="Period" />
    </div>
    <div class="grid2">
      <div class="frame">
        <Leaderboard
          :scope="{ kind: 'fleet' }"
          :period="lbPeriod"
          :now-ms="FIXTURE_NOW"
          :limit="14"
        />
      </div>
      <div class="frame">
        <Leaderboard
          :scope="{ kind: 'fleet' }"
          :period="lbPeriod"
          mode="dry"
          :now-ms="FIXTURE_NOW"
        />
      </div>
      <div class="frame">
        <Leaderboard
          :scope="{ kind: 'fleet' }"
          :period="lbPeriod"
          mode="replay"
          :now-ms="FIXTURE_NOW"
          :items="[]"
        />
      </div>
    </div>

    <h3>PnlCalendar (October, a 23 hour day in March, UTC, empty month)</h3>
    <div class="grid2">
      <div class="frame">
        <PnlCalendar
          v-model:month="calMonth"
          :scope="{ kind: 'fleet' }"
          :buckets="octBuckets"
          :now-ms="FIXTURE_NOW"
          tz="Europe/Paris"
        />
      </div>
      <div class="frame">
        <PnlCalendar
          :scope="{ kind: 'fleet' }"
          month="2026-03"
          :buckets="marBuckets"
          :now-ms="FIXTURE_NOW"
          tz="Europe/Paris"
        />
      </div>
      <div class="frame">
        <PnlCalendar
          :scope="{ kind: 'fleet' }"
          month="2026-10"
          :buckets="pnlPeriods(daily, 'day', 'UTC', FIXTURE_NOW, 120)"
          :now-ms="FIXTURE_NOW"
          tz="UTC"
        />
      </div>
      <div class="frame">
        <PnlCalendar
          :scope="{ kind: 'fleet' }"
          month="2026-10"
          :buckets="pnlPeriods([], 'day', 'Europe/Paris', FIXTURE_NOW, 40)"
          :now-ms="FIXTURE_NOW"
          tz="Europe/Paris"
        />
      </div>
    </div>

    <h3>Journal analysis: DistributionChart, DcaDepthTable, ExitReasonTable</h3>
    <div class="grid3">
      <div class="frame"><DistributionChart :trades="trades" /></div>
      <div class="frame"><DcaDepthTable :trades="trades" /></div>
      <div class="frame"><ExitReasonTable :trades="trades" /></div>
    </div>
    <div class="grid3">
      <div class="frame"><DistributionChart :trades="noTrades" /></div>
      <div class="frame"><DcaDepthTable :trades="directTrades" /></div>
      <div class="frame"><ExitReasonTable :trades="onlyOne" /></div>
    </div>

    <h3>ClosedTradeSheet and MaeMfeBar</h3>
    <div class="row">
      <Btn size="sm" @click="openSheet('full')">Closed trade</Btn>
      <Btn size="sm" @click="openSheet('unknown')">Unknown profit</Btn>
      <Btn size="sm" @click="openSheet('noexc')">No excursion</Btn>
      <MaeMfeBar :mae="-0.034" :mfe="0.021" :exit="0.012" />
      <MaeMfeBar :mae="-0.2" :mfe="0.3" :exit="-0.1" />
      <MaeMfeBar :mae="null" :mfe="null" />
    </div>
    <ClosedTradeSheet
      :open="sheet"
      :bot-key="sheetRow.bot_key"
      :trade-id="sheetRow.trade_id"
      :trade="sheetRow"
      @close="sheet = false"
    />

    <h3>RiskPanel (summary, detail with every coin, empty)</h3>
    <div class="grid3">
      <div class="frame"><RiskPanel :scope="{ kind: 'fleet' }" :scope-detail="dsDetail" /></div>
      <div class="frame">
        <RiskPanel :scope="{ kind: 'fleet' }" :scope-detail="dsDetail" detail />
      </div>
      <div class="frame">
        <RiskPanel
          :scope="{ kind: 'fleet' }"
          :scope-detail="{ ...dsDetail, positions: [], totals: [] }"
        />
      </div>
    </div>

    <h3>SystemHealth (degraded, ok, critical in detail, waiting)</h3>
    <div class="grid3">
      <div class="frame"><SystemHealth :health="health" :now-ms="FIXTURE_NOW" /></div>
      <div class="frame"><SystemHealth :health="healthOk" :now-ms="FIXTURE_NOW" /></div>
      <div class="frame"><SystemHealth :health="healthCrit" detail :now-ms="FIXTURE_NOW" /></div>
      <div class="frame"><SystemHealth :health="null" /></div>
    </div>

    <h3>LogStream (compact, page, a bot)</h3>
    <div class="grid2">
      <div class="frame"><LogStream :source="sb.source" mode="compact" /></div>
      <div class="frame tall">
        <LogStream v-model:bot="logBot" :source="sb.source" mode="page" />
      </div>
      <div class="frame">
        <LogStream :source="sb.source" mode="compact" :bot="botKey" level="INFO" />
      </div>
    </div>

    <h3>PairNavigator (list, chips, bot signals and locks)</h3>
    <div class="grid3">
      <div class="frame tall">
        <PairNavigator
          :selected-key="pairKey"
          :source="sb.source"
          @select="(i) => (pairKey = i.key)"
        />
      </div>
      <div class="frame tall">
        <PairNavigator
          :bot-key="botKey"
          :filter="pairFilter"
          :selected-key="pairKey"
          :source="sb.source"
          @update:filter="(f) => (pairFilter = f)"
          @select="(i) => (pairKey = i.key)"
        />
      </div>
      <div class="frame">
        <PairNavigator
          layout="chips"
          :selected-key="pairKey"
          :source="sb.source"
          @select="(i) => (pairKey = i.key)"
        />
      </div>
    </div>

    <h3>CandleChart (overlays, Heikin-Ashi, no data)</h3>
    <div class="row">
      <Btn size="sm" @click="ha = !ha">Heikin-Ashi: {{ ha ? 'on' : 'off' }}</Btn>
    </div>
    <div class="grid2">
      <div class="frame chart">
        <CandleChart
          :bot-key="botKey"
          pair="NEAR/USDC:USDC"
          tf="15m"
          :candles="candles"
          :overlays="overlays"
          :heikin-ashi="ha"
          :plot-config="{ main_plot: { ema_50: { color: '#4cbbe9' } }, subplots: {} }"
          :visible-candles="140"
        />
      </div>
      <div class="frame chart">
        <CandleChart bot-key="local:9999" pair="NEAR/USDC:USDC" tf="15m" :source="null" />
      </div>
    </div>

    <h3>BotRegistry (migration, discovered bots, expired session) and ReconciliationTable</h3>
    <div class="grid2">
      <div class="frame pad">
        <BotRegistry
          :bots="reg.bots"
          :discovered="reg.discovered"
          :migration="reg.migration"
          :now-ms="FIXTURE_NOW"
        />
      </div>
      <div class="frame pad">
        <ReconciliationTable
          wallet="0xAbCd...1234"
          :rows="recon"
          :checked-ms="FIXTURE_NOW - 41_000"
          :now-ms="FIXTURE_NOW"
        />
        <ReconciliationTable wallet="0xAbCd...1234" :rows="[]" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.blk {
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  padding: var(--s3);
  display: grid;
  gap: var(--s3);
  min-width: 0;
}
h2 {
  margin: 0;
  font-size: var(--t-md);
  color: var(--fg-2);
}
h3 {
  margin: var(--s2) 0 0;
  font-size: var(--t-sm);
  color: var(--fg-2);
}
.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s2);
}
.grid2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
  gap: var(--s2);
}
.grid3 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
  gap: var(--s2);
}
.frame {
  border: 1px dashed var(--line-2);
  border-radius: var(--r-2);
  overflow: hidden;
  min-width: 0;
  background: var(--bg-1);
}
.frame.tall {
  height: 420px;
  display: flex;
  flex-direction: column;
  overflow: auto;
}
.frame.chart {
  height: 420px;
}
.frame.pad {
  padding: var(--s2);
  display: grid;
  gap: var(--s2);
  align-content: start;
}
</style>
