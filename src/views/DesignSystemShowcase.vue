<script setup lang="ts">
/**
 * Dev showcase of the design system primitives (docs/redesign/02-design.md, section 5): every
 * component in every variant, in dark and light, FR and EN. Only routed in development or with
 * the `?ds` flag (see router/index.ts). All data is fake and frozen so screenshots are stable.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ActionToast,
  AdaptiveSheet,
  AgeBadge,
  Badge,
  Banner,
  BaseChart,
  Btn,
  ConnectionPill,
  DataTable,
  DcaLadderH,
  DcaLadderV,
  DcaPips,
  DirectionChip,
  EmptyState,
  ExcludedCount,
  FilterChip,
  FormRow,
  HoldButton,
  IconBtn,
  KpiStrip,
  KpiTile,
  Menu,
  Meter,
  ModeMark,
  Pane,
  PnlValue,
  SearchField,
  SegmentedControl,
  Skeleton,
  Sparkline,
  SplitBar,
  StatusBar,
  StatusDot,
  Switch,
  TabBar,
  Tabs,
  TextInput,
  Toaster,
} from '@/components/ds';
import type {
  BotRef,
  BotState,
  ColumnDef,
  Density,
  LadderOrder,
  MenuItem,
  PaneState,
  SortState,
} from '@/components/ds';
import { formatAge } from '@/components/ds/lib/format';
import { useToaster } from '@/composables/useToaster';
import { useTheme } from '@/composables/useTheme';
import { loadLanguage } from '@/locales';

const { t, locale } = useI18n();
const theme = useTheme();
const toaster = useToaster();

// Fixed clock: ages and screenshots do not move
const NOW = Date.now();

// --- controls -------------------------------------------------------------------------------
const density = ref<Density>('compact');
function applyDensity(value: Density) {
  density.value = value;
  if (value === 'comfortable') {
    document.documentElement.setAttribute('data-density', 'comfortable');
  } else {
    document.documentElement.removeAttribute('data-density');
  }
}
// The showcase sits above the legacy navbar (z-index 1100); the overlays follow it
onMounted(() => document.documentElement.style.setProperty('--z-base', '1200'));
onBeforeUnmount(() => {
  document.documentElement.removeAttribute('data-density');
  document.documentElement.style.removeProperty('--z-base');
});

const themeOptions = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];
const langOptions = [
  { value: 'fr', label: 'FR' },
  { value: 'en', label: 'EN' },
];

// --- primitives state -----------------------------------------------------------------------
const seg = ref('7d');
const segOptions = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 d' },
  { value: '30d', label: '30 d' },
  { value: 'all', label: 'All', count: 18 },
];
const chips = reactive({ live: true, dry: false, xyz: false });
const sw = reactive({ a: true, b: false });
const text = ref('hippo_multi');
const search = ref('');
const tab = ref('active');
const tabs = computed(() => [
  { id: 'active', label: t('fq.attention.active'), count: 3, tone: 'crit' as const },
  { id: 'acked', label: t('fq.attention.acknowledged'), count: 2 },
  { id: 'silenced', label: t('fq.attention.silenced') },
  { id: 'events', label: t('fq.attention.events'), count: 14 },
]);

const botStates: BotState[] = ['online', 'starting', 'offline', 'stopped', 'auth_expired', 'stale'];

const pnlSamples = [42.5, -18.07, 0, 1234.567, -0.004, 3.2];
const pnlLive = ref(42.5);
const pnlTween = ref(1234.56);
function bumpPnl() {
  pnlLive.value = pnlLive.value + 17.3;
  pnlTween.value = pnlTween.value - 83.21;
}

const excluded: BotRef[] = [
  { key: 'b1', name: 'hippo_dynv1_short', reason: t('fq.status.stale') + ' 4 min' },
  { key: 'b2', name: 'dry_scalper_03', reason: t('fq.status.offline') + ' 12 min' },
];

// --- DCA --------------------------------------------------------------------------------------
const ladderOrders = computed<LadderOrder[]>(() => [
  {
    id: 'e',
    label: t('fq.ds.ladder.avg') === 'Avg' ? 'Entry' : 'Entrée',
    price: 184.2,
    stake: 14,
    state: 'filled',
  },
  { id: 's1', label: 'SO1', price: 179.6, stake: 20, state: 'filled' },
  { id: 's2', label: 'SO2', price: 175.1, stake: 29, state: 'filled' },
  { id: 's3', label: 'SO3', price: 170.7, stake: 42, state: 'next' },
  { id: 's4', label: 'SO4', price: 166.4, stake: 61, state: 'pending' },
  { id: 's5', label: 'SO5', price: 162.2, stake: 88, state: 'pending' },
]);
// Price, average and TP are very close on purpose: the labels must not overlap
const ladderPosition = {
  price: 178.3,
  avg: 178.9,
  tp: 181.4,
  liquidation: 112.4,
  liquidationDistancePct: 36.9,
};
const ladderH = { filled: 3, max: 6, avg: 0.58, tp: 0.67, price: 0.44, liqText: 'liq. 37 %' };

// --- Pane / table ------------------------------------------------------------------------------
const paneStates: PaneState[] = ['ready', 'loading', 'empty', 'error', 'stale', 'unavailable'];

interface Row {
  key: string;
  bot: string;
  mode: 'live' | 'dry';
  pair: string;
  side: 'long' | 'short';
  lev: number;
  pnl: number;
  pct: number;
  liq: number;
  filled: number;
  age: number;
  spark: number[];
  state: BotState;
}
const pairs = ['TAO', 'HYPE', 'WIF', 'SOL', 'ETH', 'PENGU', 'ENA', 'AAVE'];
function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry(20261015);
function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => {
    const pnl = (rnd() - 0.45) * 220;
    const walk: number[] = [];
    let v = pnl - (rnd() - 0.5) * 40;
    for (let k = 0; k < 24; k++) {
      walk.push(v);
      v += (rnd() - 0.5) * 12;
    }
    walk.push(pnl);
    return {
      key: `r${i}`,
      bot: i % 3 === 0 ? 'hippo_multi' : i % 3 === 1 ? 'hippo_dynv1_long' : 'dry_scalper_03',
      mode: i % 3 === 2 ? 'dry' : 'live',
      pair: pairs[i % pairs.length],
      side: i % 4 === 3 ? 'short' : 'long',
      lev: 2 + (i % 2),
      pnl,
      pct: pnl / 14,
      liq: 12 + rnd() * 60,
      filled: 1 + Math.floor(rnd() * 5),
      age: 2 + Math.floor(rnd() * 200),
      spark: walk,
      state: i === 4 ? 'stale' : 'online',
    } as Row;
  });
}
const rows = makeRows(9);
const bigRows = makeRows(320);
const sortState = ref<SortState | null>({ id: 'pnl', dir: 'desc' });

const columns = computed<ColumnDef<Row>[]>(() => [
  { id: 'bot', label: 'Bot', align: 'left', ui: true, sortable: true, width: '190px' },
  { id: 'pair', label: 'Pair', align: 'left', ui: true, sortable: true },
  { id: 'side', label: 'Side', align: 'left', ui: true, hideBelow: 420 },
  { id: 'pnl', label: 'P&L', sortable: true },
  { id: 'pct', label: '%', sortable: true, hideBelow: 520 },
  { id: 'liq', label: 'Liq.', sortable: true, hideBelow: 640 },
  { id: 'filled', label: 'DCA', hideBelow: 740 },
  { id: 'spark', label: '24 h', hideBelow: 840 },
  { id: 'age', label: 'Age', sortable: true, hideBelow: 940 },
]);
const summary = { bot: 'Σ live', pnl: '+247,19', pct: '+1,31 %' };
const tableWidth = ref(960);

// --- Menu / popover / sheet ----------------------------------------------------------------------
const menuAnchor = ref<HTMLElement | null>(null);
const menuOpen = ref(false);
const menuItems = computed<MenuItem[]>(() => [
  { id: 'pause', label: t('fq.action.pauseEntries'), icon: 'pause' },
  { id: 'reload', label: t('fq.action.reload'), icon: 'refresh-cw', shortcut: 'R' },
  { id: 'delete', label: 'Delete from database', icon: 'database', danger: true },
  {
    id: 'exit',
    label: t('fq.action.exitMarket'),
    icon: 'log-out',
    disabled: true,
    disabledReason: t('fq.connection.connecting'),
  },
  { id: 'stop', label: 'Stop', icon: 'square', danger: true },
]);
const sheetOpen = ref(false);

// --- Hold / toasts ---------------------------------------------------------------------------------
const holdLog = ref('');
function pushToasts() {
  toaster.clear();
  toaster.push({
    kind: 'sent',
    title: t('fq.result.sent'),
    body: 'hippo_multi · TAO #1180',
    meta: 'idem 3f9a1c20',
  });
  toaster.push({
    kind: 'ok',
    title: t('fq.result.filled'),
    body: '12,4 TAO @ 184,20',
    meta: '+4,18 USDC · 0,8 s',
    ttl: 60000,
  });
  toaster.push({
    kind: 'verify',
    title: t('fq.result.needsChecking'),
    body: 'hippo_multi · WIF #1181',
    actions: [
      { id: 'trade', label: 'Open trade' },
      { id: 'logs', label: 'Logs' },
    ],
  });
  toaster.push({
    kind: 'err',
    title: t('fq.result.rejected'),
    body: 'confirm_trade_exit',
    meta: '429',
  });
}

// --- Chart -------------------------------------------------------------------------------------------
const chartPoints = computed(() => {
  const r = mulberry(7);
  const out: [number, number][] = [];
  let v = 1000;
  for (let i = 0; i < 60; i++) {
    v += (r() - 0.42) * 14;
    out.push([NOW - (60 - i) * 3600_000, v]);
  }
  return out;
});
const chartOption = computed(() => ({
  grid: { left: 8, right: 8, top: 10, bottom: 8, containLabel: true },
  xAxis: { type: 'time' as const },
  yAxis: { type: 'value' as const, scale: true },
  tooltip: { trigger: 'axis' as const },
  series: [{ id: 'equity', type: 'line' as const, showSymbol: false, data: chartPoints.value }],
}));

// --- Connection ----------------------------------------------------------------------------------------
const beat = ref(0);
let beatTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  beatTimer = setInterval(() => (beat.value += 1), 4000);
});
onBeforeUnmount(() => beatTimer && clearInterval(beatTimer));

const tabBarItems = computed(() => [
  { id: 'fleet', label: t('fq.nav.fleet'), icon: 'layout-grid' as const, count: 2 },
  { id: 'bot', label: t('fq.nav.bot'), icon: 'bot' as const },
  { id: 'charts', label: t('fq.nav.charts'), icon: 'chart-candlestick' as const },
  { id: 'journal', label: t('fq.nav.journal'), icon: 'book-open-text' as const },
  { id: 'more', label: 'Plus', icon: 'ellipsis' as const },
]);
const tabBar = ref('fleet');
const density2 = ref<Density>('compact');

function ageLabel(ms: number) {
  return formatAge(ms, locale.value);
}
</script>

<template>
  <div class="ds fq-app" data-testid="ds-showcase">
    <header class="ds-top">
      <h1>FreqUI Ultimate 2 design system</h1>
      <div class="ctl">
        <SegmentedControl
          size="sm"
          label="Theme"
          :model-value="theme.mode.value"
          :options="themeOptions"
          @update:model-value="(v) => theme.setMode(v as 'dark' | 'light' | 'system')"
        />
        <SegmentedControl
          size="sm"
          label="Language"
          :model-value="locale"
          :options="langOptions"
          @update:model-value="(v) => loadLanguage(String(v))"
        />
        <Switch
          :model-value="density === 'comfortable'"
          label="Comfortable"
          @update:model-value="(v) => applyDensity(v ? 'comfortable' : 'compact')"
        />
      </div>
    </header>

    <main class="ds-main">
      <!-- 1. Buttons -->
      <section class="blk" aria-labelledby="s-btn">
        <h2 id="s-btn">Btn, IconBtn, HoldButton</h2>
        <div class="row">
          <Btn variant="secondary">Secondary</Btn>
          <Btn variant="ghost">Ghost</Btn>
          <Btn variant="primary">Primary</Btn>
          <Btn variant="danger-outline">Danger outline</Btn>
          <Btn variant="danger">Danger</Btn>
          <Btn icon="pause">{{ t('fq.action.pauseEntries') }}</Btn>
          <Btn busy>Busy</Btn>
          <Btn disabled disabled-reason="Offline">Disabled</Btn>
        </div>
        <div class="row">
          <Btn size="xs" icon="refresh-cw">xs</Btn>
          <Btn size="sm" icon="refresh-cw">sm</Btn>
          <Btn size="md" icon="refresh-cw">md</Btn>
          <Btn size="lg" icon="refresh-cw">lg</Btn>
          <IconBtn icon="settings" label="Settings" shortcut="G S" />
          <IconBtn icon="siren" label="Alerts" :count="3" />
          <IconBtn icon="pause" label="Pause" pressed />
          <IconBtn icon="x" label="Close" size="sm" />
        </div>
        <div class="row hold-row">
          <div class="hold-box">
            <HoldButton
              :label="t('fq.action.holdToExitLive')"
              lock-key="ds:demo:1"
              @complete="holdLog = 'complete'"
              @too-short="(ms) => (holdLog = `tooShort ${Math.round(ms)} ms`)"
            />
          </div>
          <div class="hold-box">
            <HoldButton :label="t('fq.action.resumeEntries')" tone="go" />
          </div>
          <div class="hold-box">
            <HoldButton
              :label="t('fq.action.holdToExitLive')"
              disabled
              disabled-reason="Type the bot name first"
            />
          </div>
          <span class="muted num" data-testid="hold-log">{{ holdLog }}</span>
        </div>
      </section>

      <!-- 2. Controls -->
      <section class="blk" aria-labelledby="s-ctl">
        <h2 id="s-ctl">
          SegmentedControl, FilterChip, Switch, TextInput, SearchField, Tabs, FormRow
        </h2>
        <div class="row">
          <SegmentedControl v-model="seg" :options="segOptions" label="Period" />
          <SegmentedControl v-model="seg" size="sm" :options="segOptions" label="Period" />
          <FilterChip
            :label="t('fq.ds.badge.live')"
            :count="12"
            :active="chips.live"
            @toggle="chips.live = !chips.live"
          />
          <FilterChip
            :label="t('fq.ds.badge.dry')"
            :count="6"
            :active="chips.dry"
            @toggle="chips.dry = !chips.dry"
          />
          <FilterChip
            label="HIP-3"
            icon="layers"
            :active="chips.xyz"
            removable
            @toggle="chips.xyz = !chips.xyz"
          />
          <Switch v-model="sw.a" label="Notify me" />
          <Switch v-model="sw.b" label="Daily digest" />
        </div>
        <div class="row">
          <TextInput v-model="text" label="Bot name" mono placeholder="hippo_multi" />
          <TextInput model-value="wrong" label="Invalid" invalid />
          <SearchField v-model="search" :placeholder="t('fq.ds.search')" shortcut="/" />
          <Tabs v-model="tab" :tabs="tabs" label="Alerts" />
        </div>
        <div class="form">
          <FormRow label="Timezone" hint="Daily P&L is cut at midnight in this zone."
            ><SegmentedControl
              model-value="paris"
              size="sm"
              :options="[
                { value: 'paris', label: 'Europe/Paris' },
                { value: 'utc', label: 'UTC' },
              ]"
          /></FormRow>
          <FormRow label="Colour-blind palette"
            ><Switch :model-value="false" label="Off"
          /></FormRow>
        </div>
      </section>

      <!-- 3. Marks -->
      <section class="blk" aria-labelledby="s-mark">
        <h2 id="s-mark">Badge, ModeMark, StatusDot, DirectionChip, AgeBadge, ExcludedCount</h2>
        <div class="row">
          <Badge kind="live" /><Badge kind="dry" /><Badge kind="replay" /><Badge kind="xyz" /><Badge
            kind="orphan"
          />
          <Badge kind="crit" label="Critical" /><Badge kind="warn" label="Warning" /><Badge
            kind="info"
            label="Info"
          />
          <Badge kind="neutral" label="Stoploss" /><Badge kind="manual" />
        </div>
        <div class="row">
          <ModeMark mode="live" full /><ModeMark mode="live" /><ModeMark mode="dry" /><ModeMark
            mode="replay"
          />
          <span v-for="s in botStates" :key="s" class="lbl-item"
            ><StatusDot :state="s" />{{ s }}</span
          >
        </div>
        <div class="row">
          <DirectionChip side="long" :leverage="3" /><DirectionChip
            side="short"
            :leverage="2"
          /><DirectionChip side="both" />
          <span class="lbl-item"
            ><AgeBadge :as-of-ms="NOW - 12_000" :stale-after-ms="360_000" :now-ms="NOW" />
            fresh</span
          >
          <span class="lbl-item"
            ><AgeBadge :as-of-ms="NOW - 25 * 60_000" :stale-after-ms="360_000" :now-ms="NOW" />
            stale</span
          >
          <span class="lbl-item"
            ><AgeBadge
              :as-of-ms="NOW - 90_000"
              :stale-after-ms="360_000"
              :clock-skew-ms="-80_000"
              :now-ms="NOW"
            />
            skew</span
          >
          <ExcludedCount :bots="excluded" />
          <span class="muted">{{ ageLabel(5000) }} / {{ ageLabel(7_500_000) }}</span>
        </div>
      </section>

      <!-- 4. Numbers -->
      <section class="blk" aria-labelledby="s-num">
        <h2 id="s-num">PnlValue, Meter, SplitBar, DcaPips, Sparkline, KpiTile</h2>
        <div class="row num-row">
          <span v-for="v in pnlSamples" :key="v" class="cell"
            ><PnlValue :value="v" unit="USDC"
          /></span>
          <span class="cell"><PnlValue :value="3.2" :decimals="1" muted /></span>
          <span class="cell"><PnlValue :value="null" unknown /></span>
          <span class="cell"><PnlValue :value="pnlLive" tween flash data-testid="pnl-live" /></span>
          <span class="cell"><PnlValue :value="pnlTween" tween flash :decimals="2" /></span>
          <Btn size="sm" @click="bumpPnl">Tick</Btn>
        </div>
        <div class="row">
          <div class="w120">
            <Meter :value="22" tone="crit" :threshold="30" label="Liquidation distance" />
          </div>
          <div class="w120"><Meter :value="40" tone="warn" /></div>
          <div class="w120"><Meter :value="64" tone="ok" /></div>
          <div class="w120"><Meter :value="52" tone="info" /></div>
          <div class="w120"><Meter :value="30" /></div>
          <div class="w120"><SplitBar :long="62" :short="38" /></div>
          <DcaPips :filled="2" :max="6" show-count /><DcaPips
            :filled="5"
            :max="6"
            show-count
          /><DcaPips :filled="6" :max="6" />
          <Sparkline :values="rows[0].spark" label="24 h" /><Sparkline
            :values="[...rows[1].spark].reverse()"
          /><Sparkline :values="[]" />
        </div>
        <KpiStrip label="KPI">
          <KpiTile :label="t('fq.kpi.equityOpen')" sub="USDC · 18 live" wide>
            <template #value><PnlValue :value="2728.41" :decimals="2" /></template>
          </KpiTile>
          <KpiTile :label="t('fq.kpi.pnlOpen')" sub="12 positions">
            <template #value><PnlValue :value="-84.2" /></template>
          </KpiTile>
          <KpiTile :label="t('fq.kpi.realizedToday')" sub="Europe/Paris">
            <template #value><PnlValue :value="31.07" /></template>
          </KpiTile>
          <KpiTile
            :label="t('fq.kpi.drawdownOpen')"
            value="−7,4 %"
            :meter="{ value: 7.4, max: 20, tone: 'warn', threshold: 15 }"
          />
          <KpiTile
            :label="t('fq.attention.title')"
            value="3"
            sub="1 critical"
            alert
            @click="() => undefined"
          />
        </KpiStrip>
      </section>

      <!-- 5. DCA -->
      <section class="blk" aria-labelledby="s-dca">
        <h2 id="s-dca">DcaLadderH, DcaLadderV</h2>
        <div class="two">
          <div>
            <DcaLadderH :position="ladderH" />
            <div class="spacer"></div>
            <DcaLadderH
              :position="{
                ...ladderH,
                filled: 5,
                avg: 0.4,
                tp: 0.5,
                price: 0.74,
                liqText: 'liq. 21 %',
              }"
            />
          </div>
          <div class="ladder-box">
            <DcaLadderV :position="ladderPosition" :orders="ladderOrders" />
          </div>
        </div>
      </section>

      <!-- 6. Panes -->
      <section class="blk" aria-labelledby="s-pane">
        <h2 id="s-pane">Pane (WidgetShell), Skeleton, EmptyState</h2>
        <div class="panes">
          <Pane
            v-for="s in paneStates"
            :key="s"
            :title="`State: ${s}`"
            icon="layers"
            meta="meta"
            :state="s"
            :freshness="
              s === 'stale' ? { asOfMs: NOW - 30 * 60_000, staleAfterMs: 360_000 } : undefined
            "
            error-message="timeout 20 s"
            unavailable-reason="Needs the gateway."
            :empty-title="t('fq.attention.allClear')"
            empty-hint="The bot waits for a signal."
            empty-icon="check"
            padded
          >
            <template #tools><IconBtn icon="refresh-cw" label="Refresh" size="sm" /></template>
            <div class="kept">
              <div><span class="muted">Open P&L</span> <PnlValue :value="-84.2" /></div>
              <div><span class="muted">Realized</span> <PnlValue :value="31.07" /></div>
            </div>
          </Pane>
        </div>
        <div class="row">
          <div class="w200"><Skeleton shape="line" :count="3" /></div>
          <div class="w200"><Skeleton shape="kpi" /></div>
          <div class="w320"><Skeleton shape="row" :count="2" /></div>
        </div>
      </section>

      <!-- 7. Table -->
      <section class="blk" aria-labelledby="s-tbl">
        <h2 id="s-tbl">DataTable</h2>
        <p class="muted">
          Container width {{ tableWidth }} px: columns drop out below their <code>hideBelow</code>.
          Resize the box (bottom right handle), or use the buttons.
        </p>
        <div class="row">
          <Btn size="sm" @click="tableWidth = 380">380</Btn
          ><Btn size="sm" @click="tableWidth = 640">640</Btn>
          <Btn size="sm" @click="tableWidth = 960">960</Btn>
        </div>
        <div class="tbox" :style="{ width: `min(${tableWidth}px, 100%)` }">
          <DataTable
            v-model:sort="sortState"
            :columns="columns"
            :rows="rows"
            row-key="key"
            :summary="summary"
            :row-class="
              (r) => [r.mode === 'live' ? 'is-live' : 'is-dry', r.state === 'stale' ? 'stale' : '']
            "
            caption="Open positions"
          >
            <template #cell-bot="{ row }"
              ><span class="botcell"
                ><ModeMark :mode="row.mode" /><span class="nm">{{ row.bot }}</span></span
              ></template
            >
            <template #cell-pair="{ row }"
              ><b>{{ row.pair }}</b></template
            >
            <template #cell-side="{ row }"
              ><DirectionChip :side="row.side" :leverage="row.lev"
            /></template>
            <template #cell-pnl="{ row }"
              ><PnlValue :value="row.pnl" :muted="row.state === 'stale'"
            /></template>
            <template #cell-pct="{ row }"
              ><PnlValue :value="row.pct" :muted="row.state === 'stale'"
            /></template>
            <template #cell-liq="{ row }">
              <span class="cm"
                ><span class="mw"
                  ><Meter
                    :value="row.liq * 1.6"
                    :tone="row.liq < 20 ? 'crit' : row.liq < 30 ? 'warn' : 'neutral'" /></span
                >{{ Math.round(row.liq) }}&#8239;%</span
              >
            </template>
            <template #cell-filled="{ row }"><DcaPips :filled="row.filled" :max="6" /></template>
            <template #cell-spark="{ row }"><Sparkline :values="row.spark" /></template>
            <template #cell-age="{ row }"
              ><AgeBadge :as-of-ms="NOW - row.age * 1000" :stale-after-ms="360_000" :now-ms="NOW"
            /></template>
          </DataTable>
        </div>
        <h3>Virtual scrolling ({{ bigRows.length }} rows)</h3>
        <div class="tbox full">
          <DataTable
            :columns="columns.slice(0, 5)"
            :rows="bigRows"
            row-key="key"
            max-height="260px"
            :row-class="(r) => (r.mode === 'live' ? 'is-live' : 'is-dry')"
          >
            <template #cell-bot="{ row }"
              ><span class="botcell"
                ><ModeMark :mode="row.mode" /><span class="nm">{{ row.bot }}</span></span
              ></template
            >
            <template #cell-side="{ row }"
              ><DirectionChip :side="row.side" :leverage="row.lev"
            /></template>
            <template #cell-pnl="{ row }"><PnlValue :value="row.pnl" /></template>
            <template #cell-pct="{ row }"><PnlValue :value="row.pct" /></template>
          </DataTable>
        </div>
      </section>

      <!-- 8. Overlays -->
      <section class="blk" aria-labelledby="s-ovl">
        <h2 id="s-ovl">AdaptiveSheet, Menu, Toaster</h2>
        <div class="row">
          <Btn @click="sheetOpen = true">Open sheet</Btn>
          <button
            ref="menuAnchor"
            class="anchor"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="menuOpen"
            @click="menuOpen = !menuOpen"
          >
            Menu
          </button>
          <Menu
            :open="menuOpen"
            :anchor="menuAnchor"
            :items="menuItems"
            label="Actions"
            @close="menuOpen = false"
          />
          <Btn @click="pushToasts">Show toasts</Btn>
          <Btn variant="ghost" @click="toaster.clear()">Clear</Btn>
        </div>
        <div class="toast-static">
          <ActionToast
            kind="sent"
            :title="t('fq.result.sent')"
            body="hippo_multi · TAO #1180"
            meta="idem 3f9a1c20"
          />
          <ActionToast
            kind="ok"
            :title="t('fq.result.filled')"
            body="12,4 TAO @ 184,20"
            meta="+4,18 USDC · 0,8 s"
          />
          <ActionToast
            kind="verify"
            :title="t('fq.result.needsChecking')"
            body="WIF #1181"
            :actions="[{ id: 'a', label: 'Open trade' }]"
          />
          <ActionToast kind="err" :title="t('fq.result.rejected')" body="confirm_trade_exit" />
        </div>
        <AdaptiveSheet :open="sheetOpen" title="TAO #1180 · hippo_multi" @close="sheetOpen = false">
          <div class="sheet-body">
            <ModeMark mode="live" full />
            <div class="big"><PnlValue :value="-38.12" unit="USDC" /></div>
            <DcaLadderV :position="ladderPosition" :orders="ladderOrders" />
          </div>
          <template #footer>
            <HoldButton :label="t('fq.action.holdToExitLive')" />
          </template>
        </AdaptiveSheet>
        <Toaster />
      </section>

      <!-- 9. Shell -->
      <section class="blk" aria-labelledby="s-shell">
        <h2 id="s-shell">Banner, ConnectionPill, StatusBar, TabBar</h2>
        <div class="stack">
          <Banner kind="cache"
            ><b>{{ t('fq.freshness.dataFrom', { n: 4 }) }}</b></Banner
          >
          <Banner kind="connecting">{{ t('fq.connection.connecting') }}</Banner>
          <Banner kind="degraded"
            ><b>{{ t('fq.connection.degraded') }}</b></Banner
          >
          <Banner kind="direct" action="Probe now"
            ><b>{{ t('fq.connection.direct') }}.</b>
            {{ t('fq.connection.unavailableDirect') }}</Banner
          >
          <Banner kind="offline"
            ><b>{{ t('fq.status.offline') }}.</b>
            {{ t('fq.freshness.frozenAt', { time: '14:32:08' }) }}</Banner
          >
          <Banner kind="auth" :action="t('fq.status.reconnect')"
            ><b>{{ t('fq.status.sessionExpired') }}</b></Banner
          >
          <Banner kind="starting"
            ><b>{{ t('fq.status.starting') }}</b> 6 min</Banner
          >
          <Banner kind="stopped"
            ><b>{{ t('fq.status.stopped') }}</b></Banner
          >
        </div>
        <div class="row">
          <ConnectionPill kind="gateway" state="live" :latency-ms="38" :beat="beat" />
          <ConnectionPill kind="gateway" state="live" :latency-ms="38" resyncing />
          <ConnectionPill kind="gateway" state="connecting" />
          <ConnectionPill kind="gateway" state="degraded" />
          <ConnectionPill kind="gateway" state="offline" frozen-at="14:32:08" />
          <ConnectionPill kind="direct" state="live" />
        </div>
        <div class="shell-demo">
          <StatusBar
            :health="'degraded'"
            :logs-error-count="4"
            :density="density2"
            @update:density="(v) => (density2 = v)"
          />
          <TabBar v-model="tabBar" :items="tabBarItems" label="Pages" />
        </div>
        <div class="row">
          <EmptyState icon="check" :title="t('fq.attention.allClear')" hint="No active alert." />
          <EmptyState
            icon="plug-zap"
            :title="t('fq.connection.unavailableDirect')"
            hint="Needs the gateway."
          />
        </div>
      </section>

      <!-- 10. Chart -->
      <section class="blk" aria-labelledby="s-chart">
        <h2 id="s-chart">BaseChart</h2>
        <div class="chart-box"><BaseChart :option="chartOption" label="Equity" /></div>
      </section>
    </main>
  </div>
</template>

<style scoped>
/* Cover the legacy navbar and footer: the showcase is a standalone page */
.ds {
  position: fixed;
  inset: 0;
  z-index: 1200;
  overflow: auto;
  text-align: left;
}
.ds-top {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s3);
  padding: 8px var(--s3);
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
}
h1 {
  margin: 0;
  font-size: var(--t-lg);
  flex: 1 1 260px;
}
.ctl {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex-wrap: wrap;
}
.ds-main {
  padding: var(--s3);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--s3);
  max-width: 1500px;
  margin: 0 auto;
}
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
  margin: 0;
  font-size: var(--t-sm);
  color: var(--fg-2);
}
.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--s2);
  min-width: 0;
}
.num-row .cell {
  min-width: 96px;
}
.lbl-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--t-sm);
  color: var(--fg-2);
}
.hold-row {
  align-items: flex-start;
}
.hold-box {
  width: 280px;
  max-width: 100%;
}
.w120 {
  width: 120px;
}
.w200 {
  width: 200px;
}
.w320 {
  width: 320px;
  max-width: 100%;
}
.form {
  max-width: 640px;
}
.two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: var(--s4);
}
.spacer {
  height: 28px;
}
.ladder-box {
  max-width: 460px;
}
.panes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--s2);
}
.panes :deep(.pane) {
  min-height: 170px;
}
.kept {
  display: grid;
  gap: 4px;
  font-size: var(--t-sm);
}
.tbox {
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  overflow: auto;
  resize: horizontal;
}
.tbox.full {
  width: 100%;
  resize: none;
}
.botcell {
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-ui);
}
.botcell .nm {
  font-weight: 500;
}
.cm {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.mw {
  width: 44px;
}
.anchor {
  height: var(--ctl);
  padding: 0 10px;
  border-radius: var(--r-2);
  border: 1px solid var(--line-2);
  background: var(--bg-2);
  color: var(--fg);
  font: inherit;
  cursor: pointer;
}
.toast-static {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--s2);
}
.sheet-body {
  padding: var(--s3);
  display: grid;
  gap: var(--s3);
}
.sheet-body > :first-child {
  justify-self: start;
}
.big {
  font: 600 var(--t-2xl) / 1 var(--font-num);
}
.stack {
  border: 1px solid var(--line);
  border-radius: var(--r-2);
  overflow: hidden;
}
.shell-demo {
  display: grid;
  gap: var(--s2);
}
.shell-demo :deep(.status),
.shell-demo :deep(.tabbar) {
  display: flex;
  border: 1px solid var(--line);
  border-radius: var(--r-2);
}
.chart-box {
  height: 240px;
}
code {
  font-family: var(--font-num);
  background: var(--bg-3);
  padding: 0 4px;
  border-radius: var(--r-1);
}
</style>
