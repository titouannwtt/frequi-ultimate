<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  FleetviewCoin,
  FleetviewRealignOp,
  FleetviewRealignOperation,
  FleetviewRealignPreview,
  FleetviewReconciliationResponse,
  FleetviewResolvePayload,
  FleetviewResolveResponse,
  FleetviewSlice,
} from '@/types';

const { t } = useI18n();
const {
  recon: reconRef,
  reconLoading,
  loadRecon,
  resolveIssue,
  realignReconciliation,
  subscribe,
} = useFleetView();
subscribe();

const recon = computed((): FleetviewReconciliationResponse | null => reconRef.value);
const loading = computed(() => reconLoading.value);

function refresh() {
  loadRecon(true);
}

const okExpanded = ref(false);

// A sub-cent notional gap is float/rounding noise, not a position: burying real
// breaks under rows worth fractions of a cent teaches the eye to skip the panel.
// Unknown notional (no mark price) is NOT noise — it stays visible.
const NOISE_NOTIONAL_USDC = 0.01;
function isNoiseGap(c: FleetviewCoin): boolean {
  const n = diffNotionalOf(c);
  return n !== null && Math.abs(n) < NOISE_NOTIONAL_USDC;
}
const issueCoins = computed(() =>
  (recon.value?.coins ?? []).filter((c) => c.status !== 'ok' && !isNoiseGap(c)),
);
const okCoins = computed(() =>
  (recon.value?.coins ?? []).filter((c) => c.status === 'ok' || isNoiseGap(c)),
);

const dataAge = computed(() => {
  if (!recon.value) return '';
  const s = Math.max(0, Math.round(Date.now() / 1000 - recon.value.generated_at));
  return s < 120
    ? t('fleet.reconciliation.secondsAgo', { seconds: s })
    : t('fleet.reconciliation.minutesAgo', { minutes: Math.round(s / 60) });
});

function statusSeverity(status: string): string {
  switch (status) {
    case 'phantom':
      return 'warn';
    case 'minority':
      return 'danger';
    case 'unowned':
      return 'danger';
    case 'ambiguous':
      return 'secondary';
    default:
      return 'success';
  }
}

function statusHint(status: string): string {
  switch (status) {
    case 'phantom':
    case 'minority':
    case 'unowned':
    case 'ambiguous':
      return t(`fleet.reconciliation.hint.${status}`);
    default:
      return '';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'phantom':
    case 'minority':
    case 'unowned':
    case 'ambiguous':
      return t(`fleet.reconciliation.status.${status}`);
    default:
      return status;
  }
}

function fmtAmount(v: number): string {
  const a = Math.abs(v);
  const digits = a >= 100 ? 1 : a >= 1 ? 2 : 5;
  return v.toFixed(digits);
}

function notional(amount: number, coin: FleetviewCoin): string {
  if (!coin.mark_price) return '?';
  return (Math.abs(amount) * coin.mark_price).toFixed(2);
}

function diffOf(coin: FleetviewCoin): number {
  return coin.diff ?? coin.db_sum - coin.on_chain;
}

function diffNotionalOf(coin: FleetviewCoin): number | null {
  if (coin.diff_notional !== undefined && coin.diff_notional !== null) return coin.diff_notional;
  return coin.mark_price ? Math.abs(diffOf(coin)) * coin.mark_price : null;
}

function gapNotionalText(coin: FleetviewCoin): string {
  const n = diffNotionalOf(coin);
  return n != null ? `~${n.toFixed(2)} USDC` : '';
}

function sideLabel(v: number): string {
  if (Math.abs(v) < 1e-9) return t('fleet.reconciliation.sideFlat');
  return v > 0 ? t('fleet.reconciliation.sideLong') : t('fleet.reconciliation.sideShort');
}

function fmtSigned(v: number): string {
  return (v >= 0 ? '+' : '') + fmtAmount(v);
}

function summaryLine(coin: FleetviewCoin): string {
  const base = {
    dbSide: sideLabel(coin.db_sum),
    dbAmount: fmtAmount(Math.abs(coin.db_sum)),
    coin: coin.coin,
    chainSide: sideLabel(coin.on_chain),
    chainAmount: fmtAmount(Math.abs(coin.on_chain)),
  };
  switch (coin.status) {
    case 'minority': {
      const m = coin.minority_slices[0];
      return t('fleet.reconciliation.summaryMinority', {
        ...base,
        bot: m?.bot_name ?? '?',
        tradeId: m?.trade_id ?? '?',
      });
    }
    case 'phantom':
      return t('fleet.reconciliation.summaryPhantom', {
        ...base,
        bot: coin.phantom_candidate?.bot_name ?? '?',
        tradeId: coin.phantom_candidate?.trade_id ?? '?',
      });
    case 'unowned':
      return t('fleet.reconciliation.summaryUnowned', base);
    default: {
      const n = gapNotionalText(coin);
      return t('fleet.reconciliation.summaryAmbiguous', {
        ...base,
        gap: `${fmtSigned(diffOf(coin))}${n ? `, ${n}` : ''}`,
      });
    }
  }
}

// --- Resolution guide (ambiguous coins) ---
interface GuideStep {
  text: string;
  refresh?: boolean;
  calm?: boolean;
  items?: string[];
}

const guideClosed = ref<Record<string, boolean>>({});

function guideSteps(coin: FleetviewCoin): GuideStep[] {
  const steps: GuideStep[] = [];
  for (const h of coin.hints ?? []) {
    switch (h.code) {
      case 'refresh_first':
        steps.push({
          text: t('fleet.reconciliation.guide.refreshFirst'),
          refresh: true,
        });
        break;
      case 'dust':
        steps.push({
          text: t('fleet.reconciliation.guide.dust', {
            notional: (h.notional ?? 0).toFixed(2),
          }),
          calm: true,
        });
        break;
      case 'multi_phantom':
        steps.push({
          text: t('fleet.reconciliation.guide.multiPhantom', {
            count: h.candidates?.length ?? 0,
          }),
          items: (h.candidates ?? []).map((c) =>
            t('fleet.reconciliation.guide.multiPhantomItem', {
              bot: c.bot_name,
              tradeId: c.trade_id,
              amount: fmtSigned(c.signed_amount),
            }),
          ),
        });
        break;
      case 'partial_fill':
        for (const s of h.suspects ?? []) {
          steps.push({
            text: t('fleet.reconciliation.guide.partialFill', {
              bot: s.bot_name,
              tradeId: s.trade_id,
              dbAmount: fmtAmount(s.db_amount),
              impliedFill: fmtAmount(s.implied_fill),
            }),
          });
        }
        break;
      case 'stale_db':
        steps.push({
          text: t('fleet.reconciliation.guide.staleDb'),
        });
        break;
    }
  }
  return steps;
}

// --- Confirmation dialog state ---
const confirmVisible = ref(false);
const confirmCoin = ref<FleetviewCoin | null>(null);
const confirmPayload = ref<FleetviewResolvePayload | null>(null);
const confirmSlice = ref<FleetviewSlice | null>(null);
const confirmWarning = ref('');
const confirmTitle = ref('');
const resolving = ref(false);
const resolveResult = ref<FleetviewResolveResponse | null>(null);
const resolveError = ref('');

function openConfirm(
  title: string,
  coin: FleetviewCoin,
  payload: FleetviewResolvePayload,
  slice: FleetviewSlice | null,
  warning: string,
) {
  confirmTitle.value = title;
  confirmCoin.value = coin;
  confirmPayload.value = payload;
  confirmSlice.value = slice;
  confirmWarning.value = warning;
  resolveResult.value = null;
  resolveError.value = '';
  confirmVisible.value = true;
}

function askDeletePhantom(coin: FleetviewCoin) {
  if (!coin.phantom_candidate) return;
  const slice =
    coin.slices.find(
      (s) =>
        s.bot_name === coin.phantom_candidate!.bot_name &&
        s.trade_id === coin.phantom_candidate!.trade_id,
    ) ?? null;
  openConfirm(
    t('fleet.reconciliation.dialog.deletePhantomTitle', { coin: coin.coin }),
    coin,
    {
      action: 'delete_phantom',
      coin: coin.coin,
      bot_name: coin.phantom_candidate.bot_name,
      trade_id: coin.phantom_candidate.trade_id,
      confirm: true,
    },
    slice,
    t('fleet.reconciliation.dialog.warnDeletePhantom'),
  );
}

function askCloseMinority(coin: FleetviewCoin, ref_: { bot_name: string; trade_id: number }) {
  const slice =
    coin.slices.find((s) => s.bot_name === ref_.bot_name && s.trade_id === ref_.trade_id) ?? null;
  openConfirm(
    t('fleet.reconciliation.dialog.closeMinorityTitle', { coin: coin.coin }),
    coin,
    {
      action: 'close_minority',
      coin: coin.coin,
      bot_name: ref_.bot_name,
      trade_id: ref_.trade_id,
      confirm: true,
    },
    slice,
    t('fleet.reconciliation.dialog.warnCloseMinority'),
  );
}

function askCloseUnowned(coin: FleetviewCoin) {
  openConfirm(
    t('fleet.reconciliation.dialog.flattenUnownedTitle', { coin: coin.coin }),
    coin,
    { action: 'close_unowned', coin: coin.coin, confirm: true },
    null,
    t('fleet.reconciliation.dialog.warnFlattenUnowned'),
  );
}

async function doResolve() {
  if (!confirmPayload.value) return;
  resolving.value = true;
  resolveError.value = '';
  try {
    resolveResult.value = await resolveIssue(confirmPayload.value);
    refresh();
  } catch (err: any) {
    resolveError.value =
      err?.response?.data?.detail ?? err?.message ?? t('fleet.errors.resolveFailed');
  } finally {
    resolving.value = false;
  }
}

// --- Realign dialog state ---
type RealignChoice = 'keep' | 'close' | 'adjust';

const realignVisible = ref(false);
const realignCoin = ref<FleetviewCoin | null>(null);
const realignStep = ref<'plan' | 'preview' | 'done'>('plan');
const realignChoices = ref<Record<string, RealignChoice>>({});
const realignAmounts = ref<Record<string, number | null>>({});
const realignPreview = ref<FleetviewRealignPreview | null>(null);
const realignError = ref('');
const realignBusy = ref(false);

function sliceKey(s: FleetviewSlice): string {
  return `${s.bot_name}-${s.trade_id}`;
}

function canRealign(coin: FleetviewCoin): boolean {
  return (coin.status === 'ambiguous' || coin.status === 'minority') && coin.slices.length > 0;
}

function openRealign(coin: FleetviewCoin) {
  realignCoin.value = coin;
  realignStep.value = 'plan';
  realignPreview.value = null;
  realignError.value = '';
  const choices: Record<string, RealignChoice> = {};
  const amounts: Record<string, number | null> = {};
  for (const s of coin.slices) {
    choices[sliceKey(s)] = 'keep';
    amounts[sliceKey(s)] = Math.abs(s.signed_amount);
  }
  realignChoices.value = choices;
  realignAmounts.value = amounts;
  realignVisible.value = true;
}

const realignAdjustKey = computed(() => {
  for (const [k, v] of Object.entries(realignChoices.value)) {
    if (v === 'adjust') return k;
  }
  return null;
});

function realignChoiceOptions(key: string) {
  return [
    { label: t('fleet.reconciliation.realign.keep'), value: 'keep', disabled: false },
    { label: t('fleet.reconciliation.realign.closeOp'), value: 'close', disabled: false },
    {
      label: t('fleet.reconciliation.realign.adjustOp'),
      value: 'adjust',
      disabled: realignAdjustKey.value !== null && realignAdjustKey.value !== key,
    },
  ];
}

function sliceResulting(s: FleetviewSlice): number {
  const key = sliceKey(s);
  const choice = realignChoices.value[key] ?? 'keep';
  if (choice === 'close') return 0;
  if (choice === 'adjust') {
    const amt = realignAmounts.value[key];
    if (amt == null || !isFinite(amt)) return 0;
    return Math.sign(s.signed_amount) * Math.abs(amt);
  }
  return s.signed_amount;
}

const realignResulting = computed(() => {
  const coin = realignCoin.value;
  if (!coin) return 0;
  return coin.slices.reduce((acc, s) => acc + sliceResulting(s), 0);
});

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.02 + 1e-6;
}

const realignWithinTolerance = computed(() => {
  const coin = realignCoin.value;
  if (!coin) return false;
  return amountsMatch(realignResulting.value, coin.on_chain);
});

const realignHasOps = computed(() => Object.values(realignChoices.value).some((c) => c !== 'keep'));

const realignAmountsValid = computed(() => {
  for (const [k, v] of Object.entries(realignChoices.value)) {
    if (v === 'adjust') {
      const amt = realignAmounts.value[k];
      if (amt == null || !isFinite(amt) || amt <= 0) return false;
    }
  }
  return true;
});

const realignCanPreview = computed(
  () => realignHasOps.value && realignAmountsValid.value && realignWithinTolerance.value,
);

function realignOpLabel(op: FleetviewRealignOp): string {
  return op === 'close'
    ? t('fleet.reconciliation.realign.closeOp')
    : t('fleet.reconciliation.realign.adjustOp');
}

function buildRealignOperations(): FleetviewRealignOperation[] {
  const coin = realignCoin.value;
  if (!coin) return [];
  const ops: FleetviewRealignOperation[] = [];
  for (const s of coin.slices) {
    const key = sliceKey(s);
    const choice = realignChoices.value[key];
    if (choice === 'close') {
      ops.push({ bot_name: s.bot_name, trade_id: s.trade_id, op: 'close' });
    } else if (choice === 'adjust') {
      ops.push({
        bot_name: s.bot_name,
        trade_id: s.trade_id,
        op: 'adjust',
        new_amount: Math.abs(realignAmounts.value[key] ?? 0),
      });
    }
  }
  return ops;
}

async function doRealignPreview() {
  const coin = realignCoin.value;
  if (!coin || !realignCanPreview.value) return;
  realignBusy.value = true;
  realignError.value = '';
  try {
    realignPreview.value = await realignReconciliation({
      coin: coin.coin,
      operations: buildRealignOperations(),
      confirm: false,
    });
    realignStep.value = 'preview';
  } catch (err: any) {
    realignError.value =
      err?.response?.data?.detail ?? err?.message ?? t('fleet.errors.resolveFailed');
  } finally {
    realignBusy.value = false;
  }
}

async function doRealignExecute() {
  const coin = realignCoin.value;
  if (!coin) return;
  realignBusy.value = true;
  realignError.value = '';
  try {
    realignPreview.value = await realignReconciliation({
      coin: coin.coin,
      operations: buildRealignOperations(),
      confirm: true,
    });
    realignStep.value = 'done';
    refresh();
  } catch (err: any) {
    realignError.value =
      err?.response?.data?.detail ?? err?.message ?? t('fleet.errors.resolveFailed');
  } finally {
    realignBusy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col h-full p-3 gap-3">
    <div
      v-if="!recon || issueCoins.length"
      class="flex items-center justify-between flex-wrap gap-2"
    >
      <div
        class="flex items-center gap-1.5 flex-wrap text-xs text-surface-500 dark:text-surface-400"
      >
        <template v-if="recon">
          <span class="inline-block px-1.5 py-0.5 rounded text-xs font-mono bg-surface-500/10">
            {{ recon.wallet }}
          </span>
          <span class="inline-block px-1.5 py-0.5 rounded text-xs bg-surface-500/10">
            {{ t('fleet.reconciliation.liveBots', { count: recon.live_bots }) }}
          </span>
          <span class="inline-block px-1.5 py-0.5 rounded text-xs bg-surface-500/10">
            {{ dataAge }}
          </span>
        </template>
      </div>
      <Button size="small" severity="secondary" :loading="loading" @click="refresh">
        <i-mdi-refresh class="mr-1" /> {{ t('fleet.refresh') }}
      </Button>
    </div>

    <div v-if="!recon && !loading" class="text-sm text-surface-500 dark:text-surface-400">
      {{ t('fleet.reconciliation.noData') }}
    </div>

    <!-- Issues first, highlighted -->
    <div
      v-for="coin in issueCoins"
      :key="coin.coin"
      class="rounded-lg border p-3 flex flex-col gap-2"
      :class="
        coin.status === 'ambiguous'
          ? 'border-black/[0.06] dark:border-white/[0.06] bg-surface-500/5'
          : 'border-amber-400/60 bg-amber-400/10'
      "
    >
      <div class="flex items-center gap-2 flex-wrap">
        <span class="font-semibold">{{ coin.coin }}</span>
        <Tag
          :value="statusLabel(coin.status)"
          :severity="statusSeverity(coin.status)"
          class="!text-[0.65rem]"
        />
        <span
          v-if="coin.mark_price"
          class="text-xs text-surface-500 dark:text-surface-400 font-mono tabular-nums"
        >
          {{ t('fleet.reconciliation.mark', { price: coin.mark_price }) }}
        </span>
        <span
          class="text-xs font-mono tabular-nums"
          :class="coin.unrealized_pnl >= 0 ? 'text-emerald-500' : 'text-red-400'"
        >
          {{ t('fleet.reconciliation.upnl') }} {{ coin.unrealized_pnl.toFixed(2) }}
        </span>
      </div>

      <div class="flex items-stretch gap-2 flex-wrap">
        <div class="rounded bg-surface-500/10 px-2.5 py-1 flex flex-col">
          <span
            class="text-[0.6rem] uppercase tracking-wide text-surface-500 dark:text-surface-400"
          >
            {{ t('fleet.reconciliation.dbSays') }}
          </span>
          <span class="text-sm font-semibold font-mono tabular-nums">
            {{ sideLabel(coin.db_sum) }} {{ fmtAmount(Math.abs(coin.db_sum)) }}
          </span>
        </div>
        <div class="rounded bg-surface-500/10 px-2.5 py-1 flex flex-col">
          <span
            class="text-[0.6rem] uppercase tracking-wide text-surface-500 dark:text-surface-400"
          >
            {{ t('fleet.reconciliation.onChain') }}
          </span>
          <span class="text-sm font-semibold font-mono tabular-nums">
            {{ sideLabel(coin.on_chain) }} {{ fmtAmount(Math.abs(coin.on_chain)) }}
          </span>
        </div>
        <div class="rounded bg-surface-500/10 px-2.5 py-1 flex flex-col">
          <span
            class="text-[0.6rem] uppercase tracking-wide text-surface-500 dark:text-surface-400"
          >
            {{ t('fleet.reconciliation.gap') }}
          </span>
          <span
            class="text-sm font-semibold font-mono tabular-nums"
            :class="Math.abs(diffOf(coin)) < 1e-9 ? '' : 'text-red-400'"
          >
            {{ fmtSigned(diffOf(coin)) }}
            <span
              v-if="gapNotionalText(coin)"
              class="text-xs font-normal text-surface-500 dark:text-surface-400"
            >
              ({{ gapNotionalText(coin) }})
            </span>
          </span>
        </div>
      </div>

      <p class="text-xs m-0">
        {{ summaryLine(coin) }}
      </p>
      <p class="text-xs text-surface-500 dark:text-surface-400 m-0">
        {{ statusHint(coin.status) }}
      </p>

      <table v-if="coin.slices.length" class="text-xs w-full">
        <thead>
          <tr class="text-surface-500">
            <th class="pr-3 font-normal text-left">{{ t('fleet.reconciliation.colBot') }}</th>
            <th class="pr-3 font-normal text-left">{{ t('fleet.reconciliation.colTrade') }}</th>
            <th class="pr-3 font-normal text-right">
              {{ t('fleet.reconciliation.colSignedAmount') }}
            </th>
            <th class="pr-3 font-normal text-right">
              {{ t('fleet.reconciliation.colOpenRate') }}
            </th>
            <th class="pr-3 font-normal text-right">{{ t('fleet.reconciliation.colStake') }}</th>
            <th class="font-normal"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in coin.slices" :key="`${s.bot_name}-${s.trade_id}`">
            <td class="pr-3">{{ s.bot_name }}</td>
            <td class="pr-3 font-mono tabular-nums">#{{ s.trade_id }}</td>
            <td
              class="pr-3 text-right font-mono tabular-nums"
              :class="s.signed_amount >= 0 ? 'text-emerald-500' : 'text-red-400'"
            >
              {{ fmtAmount(s.signed_amount) }}
            </td>
            <td class="pr-3 text-right font-mono tabular-nums">{{ s.open_rate }}</td>
            <td class="pr-3 text-right font-mono tabular-nums">{{ s.stake_amount.toFixed(2) }}</td>
            <td>
              <Button
                v-if="
                  coin.status === 'minority' &&
                  coin.minority_slices.some(
                    (m) => m.bot_name === s.bot_name && m.trade_id === s.trade_id,
                  )
                "
                size="small"
                severity="danger"
                outlined
                class="!text-[0.65rem] !py-0.5"
                @click="askCloseMinority(coin, { bot_name: s.bot_name, trade_id: s.trade_id })"
              >
                {{ t('fleet.reconciliation.closeMinority') }}
              </Button>
              <Tag
                v-else-if="
                  coin.status === 'phantom' &&
                  coin.phantom_candidate?.bot_name === s.bot_name &&
                  coin.phantom_candidate?.trade_id === s.trade_id
                "
                :value="t('fleet.reconciliation.status.phantom')"
                severity="warn"
                class="!text-[0.6rem] !py-0"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <div class="flex gap-2">
        <Button
          v-if="coin.status === 'phantom' && coin.phantom_candidate"
          size="small"
          severity="warn"
          @click="askDeletePhantom(coin)"
        >
          {{
            t('fleet.reconciliation.deletePhantom', {
              bot: coin.phantom_candidate.bot_name,
              tradeId: coin.phantom_candidate.trade_id,
            })
          }}
        </Button>
        <Button
          v-if="coin.status === 'unowned'"
          size="small"
          severity="danger"
          @click="askCloseUnowned(coin)"
        >
          {{ t('fleet.reconciliation.flattenReduceOnly') }}
        </Button>
        <Button
          v-if="canRealign(coin)"
          size="small"
          severity="secondary"
          outlined
          @click="openRealign(coin)"
        >
          <i-mdi-database-sync class="mr-1" /> {{ t('fleet.reconciliation.realign.button') }}
        </Button>
        <span
          v-if="coin.status === 'ambiguous' && !guideSteps(coin).length"
          class="text-xs text-surface-500 dark:text-surface-400 italic"
        >
          {{ t('fleet.reconciliation.manualOnly') }}
        </span>
      </div>

      <!-- Resolution guide (ambiguous only) -->
      <div
        v-if="coin.status === 'ambiguous' && guideSteps(coin).length"
        class="rounded border border-black/[0.06] dark:border-white/[0.06] bg-surface-500/5"
      >
        <button
          class="w-full flex items-center gap-1.5 text-xs font-semibold text-left bg-transparent border-0 px-2 py-1.5 cursor-pointer text-surface-600 dark:text-surface-300 hover:text-surface-800 dark:hover:text-surface-100"
          @click="guideClosed[coin.coin] = !guideClosed[coin.coin]"
        >
          <span
            class="inline-block"
            :style="{
              transform: guideClosed[coin.coin] ? 'rotate(0deg)' : 'rotate(90deg)',
              transition: 'transform 0.2s',
            }"
            >&#9654;</span
          >
          {{ t('fleet.reconciliation.guide.title') }}
        </button>
        <div v-if="!guideClosed[coin.coin]" class="px-2 pb-2 flex flex-col gap-1.5">
          <div
            v-for="(step, idx) in guideSteps(coin)"
            :key="idx"
            class="rounded p-1.5 text-xs flex gap-2"
            :class="step.calm ? 'bg-emerald-400/10' : 'bg-surface-500/10'"
          >
            <span class="font-semibold font-mono tabular-nums">{{ idx + 1 }}.</span>
            <div class="flex flex-col gap-1 min-w-0">
              <span>{{ step.text }}</span>
              <ul v-if="step.items?.length" class="m-0 pl-4 list-disc font-mono tabular-nums">
                <li v-for="it in step.items" :key="it">{{ it }}</li>
              </ul>
              <Button
                v-if="step.refresh"
                size="small"
                severity="secondary"
                outlined
                class="self-start !text-[0.65rem] !py-0.5"
                :loading="loading"
                @click="refresh"
              >
                <i-mdi-refresh class="mr-1" /> {{ t('fleet.reconciliation.guide.refreshNow') }}
              </Button>
            </div>
          </div>
          <p class="text-xs text-surface-500 dark:text-surface-400 m-0 italic">
            {{ t('fleet.reconciliation.guide.footer') }}
          </p>
        </div>
      </div>
    </div>

    <!-- Compact all-clear line when nothing is wrong -->
    <div
      v-if="recon && !issueCoins.length"
      class="flex items-center gap-2 flex-wrap text-xs text-surface-500 dark:text-surface-400"
    >
      <Tag :value="t('fleet.allClear')" severity="success" class="!text-[0.65rem]" />
      <span>{{ t('fleet.reconciliation.allInSync') }}</span>
      <span class="inline-block px-1.5 py-0.5 rounded bg-surface-500/10">{{ dataAge }}</span>
      <Button
        size="small"
        severity="secondary"
        text
        :loading="loading"
        class="!py-0.5 !px-1.5"
        @click="refresh"
      >
        <i-mdi-refresh />
      </Button>
    </div>

    <!-- OK coins, collapsed -->
    <div v-if="okCoins.length">
      <button
        class="text-xs text-surface-500 dark:text-surface-400 bg-transparent border-0 p-0 cursor-pointer hover:text-surface-700 dark:hover:text-surface-200"
        @click="okExpanded = !okExpanded"
      >
        <span
          class="inline-block"
          :style="{
            transform: okExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }"
          >&#9654;</span
        >
        {{ t('fleet.reconciliation.coinsInSync', { count: okCoins.length }) }}
      </button>
      <div v-if="okExpanded" class="mt-1.5 flex flex-wrap gap-1">
        <span
          v-for="coin in okCoins"
          :key="coin.coin"
          class="inline-block px-1.5 py-0.5 rounded text-xs font-mono bg-surface-500/10"
        >
          {{ coin.coin }} {{ fmtAmount(coin.db_sum) }}
        </span>
      </div>
    </div>

    <!-- Confirmation dialog -->
    <Dialog
      v-model:visible="confirmVisible"
      modal
      :header="confirmTitle"
      :style="{ width: '30rem', maxWidth: '95vw' }"
    >
      <div v-if="confirmCoin && confirmPayload" class="flex flex-col gap-3 text-sm">
        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <span class="text-surface-500">{{ t('fleet.reconciliation.dialog.coin') }}</span>
          <span class="font-semibold">{{ confirmCoin.coin }}</span>
          <template v-if="confirmPayload.bot_name">
            <span class="text-surface-500">{{ t('fleet.reconciliation.dialog.bot') }}</span>
            <span>{{ confirmPayload.bot_name }}</span>
          </template>
          <template v-if="confirmPayload.trade_id !== undefined">
            <span class="text-surface-500">{{ t('fleet.reconciliation.dialog.trade') }}</span>
            <span class="font-mono tabular-nums">#{{ confirmPayload.trade_id }}</span>
          </template>
          <template v-if="confirmSlice">
            <span class="text-surface-500">{{ t('fleet.reconciliation.dialog.amount') }}</span>
            <span class="font-mono tabular-nums">
              {{ fmtAmount(confirmSlice.signed_amount) }} {{ confirmCoin.coin }}
            </span>
            <span class="text-surface-500">{{ t('fleet.reconciliation.dialog.estNotional') }}</span>
            <span class="font-mono tabular-nums">
              {{ notional(confirmSlice.signed_amount, confirmCoin) }} USDC
            </span>
          </template>
          <template v-else-if="confirmPayload.action === 'close_unowned'">
            <span class="text-surface-500">{{ t('fleet.reconciliation.dialog.amount') }}</span>
            <span class="font-mono tabular-nums">
              {{ fmtAmount(confirmCoin.on_chain) }} {{ confirmCoin.coin }}
            </span>
            <span class="text-surface-500">{{ t('fleet.reconciliation.dialog.estNotional') }}</span>
            <span class="font-mono tabular-nums">
              {{ notional(confirmCoin.on_chain, confirmCoin) }} USDC
            </span>
          </template>
        </div>

        <div class="rounded border border-amber-400/50 bg-amber-400/10 p-2 text-xs">
          {{ confirmWarning }}
        </div>

        <div
          v-if="resolveResult"
          class="rounded border border-emerald-400/50 bg-emerald-400/10 p-2 text-xs"
        >
          <div class="font-semibold mb-1">{{ t('fleet.reconciliation.dialog.done') }}</div>
          <div v-if="resolveResult.order">
            {{
              t('fleet.reconciliation.dialog.orderResult', {
                id: resolveResult.order.order_id ?? '?',
                filled: resolveResult.order.filled ?? '?',
                avg: resolveResult.order.average ?? '?',
                notional: resolveResult.order.notional ?? '?',
              })
            }}
          </div>
          <div v-if="resolveResult.delete">
            {{ t('fleet.reconciliation.dialog.dbDelete') }} {{ resolveResult.delete }}
          </div>
        </div>
        <div v-if="resolveError" class="rounded border border-red-400/50 bg-red-400/10 p-2 text-xs">
          {{ resolveError }}
        </div>

        <div class="flex justify-end gap-2">
          <Button size="small" severity="secondary" @click="confirmVisible = false">
            {{
              resolveResult
                ? t('fleet.reconciliation.dialog.close')
                : t('fleet.reconciliation.dialog.cancel')
            }}
          </Button>
          <Button
            v-if="!resolveResult"
            size="small"
            severity="danger"
            :loading="resolving"
            @click="doResolve"
          >
            {{ t('fleet.reconciliation.dialog.confirm') }}
          </Button>
        </div>
      </div>
    </Dialog>

    <!-- Realign DB dialog -->
    <Dialog
      v-model:visible="realignVisible"
      modal
      :header="t('fleet.reconciliation.realign.title', { coin: realignCoin?.coin ?? '' })"
      :style="{ width: '44rem', maxWidth: '95vw' }"
    >
      <div v-if="realignCoin" class="flex flex-col gap-3 text-sm">
        <div class="rounded border border-emerald-400/50 bg-emerald-400/10 p-2 text-xs">
          {{ t('fleet.reconciliation.realign.dbOnly') }}
        </div>

        <!-- Step 1: plan -->
        <template v-if="realignStep === 'plan'">
          <p class="text-xs text-surface-500 dark:text-surface-400 m-0">
            {{ t('fleet.reconciliation.realign.intro') }}
          </p>
          <table class="text-xs w-full">
            <thead>
              <tr class="text-surface-500">
                <th class="pr-3 font-normal text-left">{{ t('fleet.reconciliation.colBot') }}</th>
                <th class="pr-3 font-normal text-left">
                  {{ t('fleet.reconciliation.colTrade') }}
                </th>
                <th class="pr-3 font-normal text-right">
                  {{ t('fleet.reconciliation.colSignedAmount') }}
                </th>
                <th class="pr-3 font-normal text-left">
                  {{ t('fleet.reconciliation.realign.colAction') }}
                </th>
                <th class="font-normal text-right">
                  {{ t('fleet.reconciliation.realign.colNewAmount') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in realignCoin.slices" :key="sliceKey(s)">
                <td class="pr-3 py-1">{{ s.bot_name }}</td>
                <td class="pr-3 py-1 font-mono tabular-nums">#{{ s.trade_id }}</td>
                <td
                  class="pr-3 py-1 text-right font-mono tabular-nums"
                  :class="s.signed_amount >= 0 ? 'text-emerald-500' : 'text-red-400'"
                >
                  {{ fmtSigned(s.signed_amount) }}
                </td>
                <td class="pr-3 py-1">
                  <SelectButton
                    v-model="realignChoices[sliceKey(s)]"
                    :options="realignChoiceOptions(sliceKey(s))"
                    option-label="label"
                    option-value="value"
                    option-disabled="disabled"
                    :allow-empty="false"
                    size="small"
                    class="realign-choice"
                  />
                </td>
                <td class="py-1 text-right">
                  <InputNumber
                    v-if="realignChoices[sliceKey(s)] === 'adjust'"
                    v-model="realignAmounts[sliceKey(s)]"
                    :min="0"
                    :max-fraction-digits="8"
                    size="small"
                    :input-style="{ width: '7rem', textAlign: 'right' }"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <p
            v-if="realignAdjustKey"
            class="text-xs text-surface-500 dark:text-surface-400 m-0 italic"
          >
            {{ t('fleet.reconciliation.realign.onlyOneAdjust') }}
          </p>

          <div class="flex items-center gap-2 flex-wrap text-xs">
            <span class="text-surface-500">{{ t('fleet.reconciliation.realign.resulting') }}</span>
            <span class="font-mono tabular-nums font-semibold">
              {{ fmtSigned(realignResulting) }}
            </span>
            <span class="text-surface-500">{{ t('fleet.reconciliation.realign.target') }}</span>
            <span class="font-mono tabular-nums font-semibold">
              {{ fmtSigned(realignCoin.on_chain) }}
            </span>
            <Tag
              :value="
                realignWithinTolerance
                  ? t('fleet.reconciliation.realign.withinTolerance')
                  : t('fleet.reconciliation.realign.outsideTolerance')
              "
              :severity="realignWithinTolerance ? 'success' : 'danger'"
              class="!text-[0.65rem]"
            />
          </div>

          <div
            v-if="realignError"
            class="rounded border border-red-400/50 bg-red-400/10 p-2 text-xs"
          >
            {{ realignError }}
          </div>

          <div class="flex justify-end gap-2">
            <Button size="small" severity="secondary" @click="realignVisible = false">
              {{ t('fleet.reconciliation.dialog.cancel') }}
            </Button>
            <Button
              size="small"
              severity="warn"
              :disabled="!realignCanPreview"
              :loading="realignBusy"
              @click="doRealignPreview"
            >
              {{ t('fleet.reconciliation.realign.previewBtn') }}
            </Button>
          </div>
        </template>

        <!-- Step 2: server-validated preview -->
        <template v-else-if="realignStep === 'preview' && realignPreview">
          <table class="text-xs w-full">
            <thead>
              <tr class="text-surface-500">
                <th class="pr-3 font-normal text-left">{{ t('fleet.reconciliation.colBot') }}</th>
                <th class="pr-3 font-normal text-left">
                  {{ t('fleet.reconciliation.colTrade') }}
                </th>
                <th class="pr-3 font-normal text-left">
                  {{ t('fleet.reconciliation.realign.colAction') }}
                </th>
                <th class="pr-3 font-normal text-right">
                  {{ t('fleet.reconciliation.realign.colBefore') }}
                </th>
                <th class="pr-3 font-normal text-right">
                  {{ t('fleet.reconciliation.realign.colAfter') }}
                </th>
                <th class="pr-3 font-normal text-right">
                  {{ t('fleet.reconciliation.realign.colDelta') }}
                </th>
                <th class="font-normal text-right">
                  {{ t('fleet.reconciliation.realign.colNotional') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="op in realignPreview.operations" :key="`${op.bot_name}-${op.trade_id}`">
                <td class="pr-3 py-0.5">{{ op.bot_name }}</td>
                <td class="pr-3 py-0.5 font-mono tabular-nums">#{{ op.trade_id }}</td>
                <td class="pr-3 py-0.5">{{ realignOpLabel(op.op) }}</td>
                <td class="pr-3 py-0.5 text-right font-mono tabular-nums">
                  {{ fmtSigned(op.signed_amount_before) }}
                </td>
                <td class="pr-3 py-0.5 text-right font-mono tabular-nums">
                  {{ fmtSigned(op.signed_amount_after) }}
                </td>
                <td class="pr-3 py-0.5 text-right font-mono tabular-nums">
                  {{ fmtSigned(op.delta) }}
                </td>
                <td class="py-0.5 text-right font-mono tabular-nums">
                  {{ op.delta_notional != null ? `${op.delta_notional.toFixed(2)} USDC` : '?' }}
                </td>
              </tr>
            </tbody>
          </table>

          <div class="flex items-center gap-2 flex-wrap text-xs">
            <span
              class="inline-block px-1.5 py-0.5 rounded bg-surface-500/10 font-mono tabular-nums"
            >
              {{ t('fleet.reconciliation.dbSays') }}
              {{ fmtSigned(realignPreview.db_sum_before) }} &rarr;
              {{ fmtSigned(realignPreview.db_sum_after) }}
            </span>
            <span
              class="inline-block px-1.5 py-0.5 rounded bg-surface-500/10 font-mono tabular-nums"
            >
              {{ t('fleet.reconciliation.onChain') }} {{ fmtSigned(realignPreview.on_chain) }}
            </span>
            <span
              class="inline-block px-1.5 py-0.5 rounded bg-surface-500/10 font-mono tabular-nums"
            >
              {{
                t('fleet.reconciliation.realign.touchedNotional', {
                  notional: realignPreview.touched_notional.toFixed(2),
                })
              }}
            </span>
          </div>

          <div
            v-if="realignError"
            class="rounded border border-red-400/50 bg-red-400/10 p-2 text-xs"
          >
            {{ realignError }}
          </div>

          <div class="flex justify-end gap-2">
            <Button
              size="small"
              severity="secondary"
              :disabled="realignBusy"
              @click="realignStep = 'plan'"
            >
              {{ t('fleet.reconciliation.realign.backBtn') }}
            </Button>
            <Button size="small" severity="danger" :loading="realignBusy" @click="doRealignExecute">
              {{ t('fleet.reconciliation.realign.applyBtn') }}
            </Button>
          </div>
        </template>

        <!-- Step 3: results -->
        <template v-else-if="realignStep === 'done' && realignPreview">
          <div class="rounded border border-emerald-400/50 bg-emerald-400/10 p-2 text-xs">
            <div class="font-semibold mb-1">
              {{ t('fleet.reconciliation.realign.resultsTitle') }}
            </div>
            <ul class="m-0 pl-4 list-disc">
              <li
                v-for="r in realignPreview.results ?? []"
                :key="`${r.bot_name}-${r.trade_id}`"
                class="font-mono tabular-nums"
              >
                {{ r.bot_name }} #{{ r.trade_id }} ({{ realignOpLabel(r.op) }}): {{ r.result }}
              </li>
            </ul>
          </div>

          <div
            v-if="realignError"
            class="rounded border border-red-400/50 bg-red-400/10 p-2 text-xs"
          >
            {{ realignError }}
          </div>

          <div class="flex justify-end gap-2">
            <Button size="small" severity="secondary" @click="realignVisible = false">
              {{ t('fleet.reconciliation.dialog.close') }}
            </Button>
          </div>
        </template>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
.realign-choice :deep(.p-togglebutton) {
  padding: 0.15rem 0.5rem;
  font-size: 0.7rem;
}
</style>
