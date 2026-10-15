<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  Badge,
  Btn,
  DirectionChip,
  DsIcon,
  HoldButton,
  ModeMark,
  PnlValue,
  SegmentedControl,
  TextInput,
} from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useFocusTrap } from '@/components/ds/lib/useFocusTrap';
import { useBotAction, type ActionOutcome } from '@/composables/useBotAction';
import { useInflightLock } from '@/composables/useInflightLock';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { BotAction, DataSource } from '@/datasource/types';
import type { BotKey, Position } from '@/gateway/types.gen';

import {
  exitPlan,
  fractionFromNotional,
  isSingleExit,
  MIN_NOTIONAL,
  warningsFor,
  type DialogWarning,
  type QuantityChoice,
} from './lib/dialog';

/**
 * The confirmation of a mutation (docs/redesign/02-design.md, sections 11.1 to 11.6). It always
 * names the target bot first. The gesture is derived from the mode of the bot and the action by
 * `useBotAction` (not a prop, so no caller can weaken it): one click for pausing entries and for
 * a dry bot, the bot name typed plus a 1 s hold for the destructive live ones, the 1 s hold for
 * the other live ones. "Cancel" has the initial focus; Escape and the scrim cancel.
 *
 * The request is sent once, never retried: the hold button takes the in-flight lock of the action
 * when it completes, and `useBotAction.submit` refuses a second one.
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    action: BotAction;
    target: { botKey: BotKey; name: string; tradeId?: number | 'all' | null };
    /** The position the action is about, as displayed (single exit, reinforcement, maintenance). */
    position?: Position | null;
    /** Names of the other bots holding the same coin on the same wallet. */
    nettedWith?: string[];
    /** `true` when the entries of the bot are known to be paused. */
    entriesPaused?: boolean | null;
    /** Share pre-selected by the drawer foot, 0 to 1. */
    initialFraction?: number;
    extraWarnings?: DialogWarning[];
    /** Previews and tests: the source that receives the request; by default the active one. */
    source?: DataSource | null;
    /** Render in place instead of in <body>. */
    inline?: boolean;
  }>(),
  { position: null, nettedWith: () => [], entriesPaused: null, extraWarnings: () => [] },
);

const emit = defineEmits<{ close: []; done: [outcome: ActionOutcome] }>();

const { t } = useI18n();
const fmt = useFormat();
const lock = useInflightLock();
const positions = useFqPositionsStore();
const titleId = useId();
const descId = useId();

const botAction = useBotAction(() => props.target.botKey);

// ---- form state ----
const choice = ref<QuantityChoice>(100);
const otherUsdc = ref('');
const orderType = ref<'market' | 'limit'>('market');
const limitPrice = ref('');
const typedName = ref('');
const entryPair = ref('');
const entryStake = ref('');
const submitting = ref(false);
const hold = ref<InstanceType<typeof HoldButton> | null>(null);
const cancelComp = ref<{ $el: HTMLElement } | null>(null);
const panel = ref<HTMLElement | null>(null);

function resetForm() {
  const f = props.initialFraction;
  choice.value = f === 0.5 ? 50 : f === 0.25 ? 25 : 100;
  otherUsdc.value = '';
  orderType.value = 'market';
  limitPrice.value = '';
  typedName.value = '';
  entryPair.value = props.action.kind === 'forceentry' ? props.action.pair : '';
  entryStake.value = '';
  submitting.value = false;
}
watch(
  () => [props.open, props.action, props.target.botKey],
  () => {
    if (props.open) resetForm();
  },
  { immediate: true },
);

// ---- what would be sent ----
const single = computed(() => (isSingleExit(props.action) ? props.action : null));

const plan = computed(() => {
  const p = props.position;
  if (!single.value || !p) return null;
  const fraction =
    choice.value === 'other'
      ? fractionFromNotional(Number(otherUsdc.value.replace(',', '.')), p.notional)
      : choice.value / 100;
  return exitPlan(
    {
      amount: p.amount,
      notional: p.notional,
      profitAbs: p.profit_abs,
      currentRate: p.current_rate,
    },
    fraction,
  );
});

const limitPriceNum = computed(() => Number(limitPrice.value.replace(',', '.')));
const limitOk = computed(
  () =>
    orderType.value === 'market' ||
    (Number.isFinite(limitPriceNum.value) && limitPriceNum.value > 0),
);

const stakeNum = computed(() => Number(entryStake.value.replace(',', '.')));

/** The action exactly as it will be sent: it is built from what the form shows. */
const effective = computed<BotAction>(() => {
  const a = props.action;
  if (a.kind === 'forceexit' && a.tradeId !== 'all') {
    return {
      ...a,
      ...(plan.value?.amount !== undefined ? { amount: plan.value.amount } : {}),
      orderType: orderType.value,
      ...(orderType.value === 'limit' && limitOk.value ? { price: limitPriceNum.value } : {}),
    };
  }
  if (a.kind === 'forceentry') {
    return {
      ...a,
      pair: entryPair.value.trim(),
      ...(Number.isFinite(stakeNum.value) && stakeNum.value > 0
        ? { stakeAmount: stakeNum.value }
        : {}),
      orderType: orderType.value,
      ...(orderType.value === 'limit' && limitOk.value ? { price: limitPriceNum.value } : {}),
    };
  }
  return a;
});

const preview = computed(() => botAction.prepare(effective.value));
const level = computed(() => preview.value.level);
const live = computed(() => preview.value.mode === 'live');
const locked = computed(() => lock.isLocked(preview.value.lockKey));

const nameOk = computed(
  () => !preview.value.requiresTypedName || typedName.value === botAction.botName.value,
);

const formOk = computed(() => {
  const a = props.action;
  if (a.kind === 'forceexit' && a.tradeId !== 'all') {
    return !!props.position && !!plan.value?.valid && limitOk.value;
  }
  if (a.kind === 'forceentry') {
    return entryPair.value.trim().length > 0 && stakeNum.value > 0 && limitOk.value;
  }
  return true;
});

const blockedReason = computed(() => {
  if (submitting.value || locked.value) return t('fq.dialog.inFlight');
  if (!nameOk.value) return t('fq.dialog.typeNameFirst');
  if (plan.value?.belowMin) return t('fq.dialog.warn.belowMin', { min: MIN_NOTIONAL });
  if (!formOk.value) return t('fq.dialog.fillForm');
  return undefined;
});
const canConfirm = computed(() => !blockedReason.value);

// ---- text ----
const kindKey = computed(() => {
  const a = props.action;
  if (a.kind === 'forceexit') return a.tradeId === 'all' ? 'exitAll' : 'exit';
  return a.kind;
});
const title = computed(() => t(`fq.dialog.title.${kindKey.value}`));
const iconName = computed(() => {
  switch (props.action.kind) {
    case 'forceentry':
      return 'log-in' as const;
    case 'forceexit':
      return 'log-out' as const;
    case 'stop':
      return 'square' as const;
    case 'stopbuy':
      return 'pause' as const;
    case 'start':
      return 'play' as const;
    case 'reload_config':
    case 'reload_trade':
      return 'refresh-cw' as const;
    case 'delete_trade':
      return 'database' as const;
    default:
      return 'triangle-alert' as const;
  }
});

const subtitle = computed(() => {
  const p = props.position;
  if (p && (single.value || props.action.kind === 'forceentry')) {
    const side = p.side === 'long' ? t('fq.side.long') : t('fq.side.short');
    return t('fq.dialog.subtitle', {
      pair: p.pair,
      side,
      lev: p.leverage,
      n: p.dca_entries,
      stake: fmt.number(p.stake_amount, 2),
    });
  }
  return t(`fq.dialog.sub.${kindKey.value}`);
});

const holdLabel = computed(() => {
  switch (kindKey.value) {
    case 'exit':
    case 'exitAll':
      return t('fq.action.holdToExitLive');
    default:
      return t(`fq.dialog.hold.${kindKey.value}`);
  }
});
const confirmLabel = computed(() =>
  props.action.kind === 'stopbuy' ? t('fq.dialog.confirmPause') : t('fq.dialog.confirm'),
);

const allPositions = computed(() => positions.byBot(props.target.botKey).filter((p) => !p.orphan));
const allLatent = computed(() => {
  const list = allPositions.value.filter((p) => !p.freshness.stale);
  return list.length === 0 ? null : list.reduce((acc, p) => acc + (p.profit_abs ?? 0), 0);
});
const allNotional = computed(() => {
  const list = allPositions.value.filter((p) => !p.freshness.stale);
  return list.length === 0 ? null : list.reduce((acc, p) => acc + p.notional, 0);
});

const warnings = computed<DialogWarning[]>(() => [
  ...warningsFor(props.action, {
    nettedWith: props.nettedWith,
    entriesPaused: props.entriesPaused,
    plan: plan.value,
  }),
  ...props.extraWarnings,
]);

const quantityOptions = computed(() => [
  { value: 100 as QuantityChoice, label: '100 %' },
  { value: 50 as QuantityChoice, label: '50 %' },
  { value: 25 as QuantityChoice, label: '25 %' },
  { value: 'other' as QuantityChoice, label: t('fq.dialog.other') },
]);
const orderOptions = computed(() => [
  { value: 'market' as const, label: t('fq.dialog.market') },
  { value: 'limit' as const, label: t('fq.dialog.limit') },
]);

// ---- send ----
async function run(): Promise<void> {
  if (!formOk.value || !nameOk.value) {
    // The form changed under the hold (or was never valid): give the lock back, send nothing
    if (preview.value.requiresHold) lock.release(preview.value.lockKey);
    hold.value?.reset();
    return;
  }
  // A fresh idempotency key for this confirmed intent
  const pending = botAction.prepare(effective.value);
  submitting.value = true;
  try {
    const outcome = await botAction.submit(pending, {
      typedName: typedName.value,
      source: props.source,
    });
    emit('done', outcome);
  } finally {
    submitting.value = false;
    hold.value?.reset();
    emit('close');
  }
}

function onBlocked() {
  // Completed while another surface holds the key: nothing was sent
  hold.value?.reset();
}

function cancel() {
  if (submitting.value) return;
  emit('close');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) {
    e.stopPropagation();
    cancel();
  }
}

const openRef = computed(() => props.open);
useFocusTrap(panel, openRef, () => cancelComp.value?.$el ?? null);
watch(
  openRef,
  async (o) => {
    if (o) {
      await nextTick();
      cancelComp.value?.$el?.focus();
    }
  },
  { flush: 'post' },
);
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <Transition name="fq-fade">
      <div v-if="open" class="scrim" aria-hidden="true" @click="cancel"></div>
    </Transition>
    <Transition name="fq-dlg">
      <div
        v-if="open"
        ref="panel"
        class="dlg fq-portal"
        :class="[`lvl-${level}`, live ? 'is-live' : 'is-dry']"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="descId"
        :aria-busy="submitting || undefined"
        tabindex="-1"
        data-testid="confirm-dialog"
        @keydown="onKeydown"
      >
        <div v-if="level !== 'reduce'" class="band" aria-hidden="true"></div>
        <div class="in">
          <header class="hd">
            <span class="ic"><DsIcon :name="iconName" :size="18" /></span>
            <div class="tt">
              <h2 :id="titleId">{{ title }}</h2>
              <p :id="descId" class="sub">{{ subtitle }}</p>
            </div>
          </header>

          <section
            class="target"
            data-testid="dialog-target"
            :aria-label="t('fq.action.targetBot')"
          >
            <div class="tg-l">
              <span class="k">{{ t('fq.action.targetBot') }}</span>
              <span class="nm">{{ target.name }}</span>
              <code class="key">
                {{ target.botKey
                }}<template v-if="target.tradeId !== null && target.tradeId !== 'all'">
                  · {{ t('fq.dialog.trade') }} #{{ target.tradeId }}</template
                ><template v-if="target.tradeId === 'all'">
                  · {{ t('fq.dialog.allPositions') }}</template
                >
              </code>
            </div>
            <ModeMark :mode="preview.mode" full />
          </section>

          <div v-if="position && (single || action.kind === 'forceentry')" class="pos-line">
            <DirectionChip :side="position.side" :leverage="position.leverage" />
            <Badge v-if="position.market !== 'crypto'" kind="xyz" />
          </div>

          <template v-if="single">
            <div class="row">
              <span class="lab">{{ t('fq.dialog.quantity') }}</span>
              <SegmentedControl
                v-model="choice"
                :options="quantityOptions"
                size="sm"
                :label="t('fq.dialog.quantity')"
              />
              <TextInput
                v-if="choice === 'other'"
                v-model="otherUsdc"
                type="number"
                mono
                class="amt"
                :label="t('fq.dialog.amountUsdc')"
                :placeholder="`≥ ${MIN_NOTIONAL}`"
              />
            </div>
          </template>
          <template v-if="action.kind === 'forceentry'">
            <div class="row">
              <span class="lab">{{ t('fq.dialog.pair') }}</span>
              <TextInput
                v-model="entryPair"
                mono
                :label="t('fq.dialog.pair')"
                :disabled="!!position"
              />
            </div>
            <div class="row">
              <span class="lab">{{ t('fq.dialog.stake') }}</span>
              <TextInput
                v-model="entryStake"
                type="number"
                mono
                :label="t('fq.dialog.stake')"
                placeholder="USDC"
              />
            </div>
          </template>
          <div v-if="single || action.kind === 'forceentry'" class="row">
            <span class="lab">{{ t('fq.dialog.order') }}</span>
            <SegmentedControl
              v-model="orderType"
              :options="orderOptions"
              size="sm"
              :label="t('fq.dialog.order')"
            />
            <TextInput
              v-if="orderType === 'limit'"
              v-model="limitPrice"
              type="number"
              mono
              class="amt"
              :label="t('fq.dialog.limitPrice')"
              :invalid="!limitOk"
            />
          </div>

          <div v-if="single && plan" class="est">
            <div>
              <span class="k">{{ t('fq.dialog.estPnl') }}</span>
              <span class="v"
                ><PnlValue :value="plan.pnl" :unknown="plan.pnl === null" unit="USDC"
              /></span>
            </div>
            <div>
              <span class="k">{{ t('fq.dialog.estPrice') }}</span>
              <span class="v num">{{
                !position || position.current_rate === null
                  ? t('fq.ds.notAvailable')
                  : fmt.price(position.current_rate)
              }}</span>
            </div>
          </div>
          <div v-else-if="action.kind === 'forceexit' && action.tradeId === 'all'" class="est">
            <div>
              <span class="k">{{ t('fq.dialog.latentPnl') }}</span>
              <span class="v"
                ><PnlValue :value="allLatent" :unknown="allLatent === null" unit="USDC"
              /></span>
            </div>
            <div>
              <span class="k">{{ t('fq.dialog.notional') }}</span>
              <span class="v num"
                >{{ allNotional === null ? t('fq.ds.notAvailable') : fmt.number(allNotional, 0)
                }}<small> USDC</small></span
              >
            </div>
          </div>

          <ul v-if="warnings.length" class="warns">
            <li v-for="w in warnings" :key="w.key" :class="w.tone">
              <DsIcon :name="w.tone === 'warn' ? 'triangle-alert' : 'info'" :size="15" />
              <span>{{ t(`fq.dialog.warn.${w.key}`, w.params ?? {}) }}</span>
            </li>
          </ul>

          <p class="once">
            <DsIcon name="activity" :size="15" />
            <span>{{ t('fq.action.sentOnce') }}</span>
          </p>

          <div v-if="preview.requiresTypedName" class="typed">
            <TextInput
              v-model="typedName"
              mono
              :label="t('fq.dialog.typeName', { name: botAction.botName.value })"
              :placeholder="botAction.botName.value"
              autocomplete="off"
              :invalid="typedName.length > 0 && !nameOk"
            />
          </div>

          <footer class="ft">
            <Btn ref="cancelComp" class="cancel" size="lg" :disabled="submitting" @click="cancel">
              {{ t('fq.dialog.cancel') }}
            </Btn>
            <HoldButton
              v-if="preview.requiresHold"
              ref="hold"
              class="go"
              :label="holdLabel"
              :disabled="!(formOk && nameOk) || submitting"
              :disabled-reason="blockedReason"
              :lock-key="preview.lockKey"
              @complete="run"
              @blocked="onBlocked"
            />
            <Btn
              v-else
              class="go"
              variant="primary"
              size="lg"
              :disabled="!canConfirm"
              :disabled-reason="blockedReason"
              :busy="submitting"
              :lock-key="preview.lockKey"
              data-testid="dialog-confirm"
              @click="run"
            >
              {{ confirmLabel }}
            </Btn>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-base, 0) + 70);
  background: var(--scrim);
}
.dlg {
  position: fixed;
  z-index: calc(var(--z-base, 0) + 71);
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(468px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  background: var(--bg-1);
  color: var(--fg);
  border-radius: var(--r-3);
  box-shadow: var(--shadow-float);
  font-family: var(--font-ui);
  font-size: var(--t-md);
}
.band {
  height: 8px;
  background: var(--live-hatch);
}
.is-dry .band {
  background: var(--off-hatch);
  border-bottom: 1px solid var(--line-2);
}
.in {
  padding: var(--s4);
  display: grid;
  gap: var(--s3);
}
.hd {
  display: flex;
  gap: var(--s3);
  align-items: flex-start;
}
.ic {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: var(--r-2);
  background: var(--bg-2);
  color: var(--fg-2);
}
.is-live .ic {
  background: var(--live-w);
  color: var(--live);
}
h2 {
  margin: 0;
  font-size: var(--t-lg);
  font-weight: 700;
}
.sub {
  margin: 2px 0 0;
  color: var(--fg-2);
  font-size: var(--t-sm);
}
.target {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s3);
  padding: 9px var(--s3);
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
  background: var(--bg-2);
}
.is-live .target {
  border-color: color-mix(in srgb, var(--live) 55%, var(--line-2));
  background: var(--live-w);
}
.tg-l {
  display: grid;
  gap: 1px;
  min-width: 0;
}
.k {
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.nm {
  font-weight: 700;
  font-size: var(--t-lg);
  overflow-wrap: anywhere;
}
.key {
  font: 500 var(--t-xs) var(--font-num);
  color: var(--fg-2);
}
.pos-line {
  display: flex;
  gap: 8px;
  align-items: center;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--s3);
  flex-wrap: wrap;
}
.lab {
  width: 64px;
  color: var(--fg-3);
  font-size: var(--t-sm);
}
.amt {
  width: 130px;
}
.est {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--s2);
}
.est > div {
  display: grid;
  gap: 2px;
  padding: 8px var(--s3);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
}
.est .v {
  font: 600 var(--t-lg) var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
.est small {
  color: var(--fg-3);
  font-weight: 500;
}
.warns,
.once {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 6px;
  font-size: var(--t-sm);
  color: var(--fg-2);
}
.warns li,
.once {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.warns li.warn {
  color: var(--warn);
}
.warns :deep(.ico),
.once :deep(.ico) {
  flex: none;
  margin-top: 1px;
}
.ft {
  display: flex;
  gap: var(--s2);
  align-items: flex-start;
  margin-top: 2px;
}
.cancel {
  flex: none;
}
.go {
  flex: 1;
  min-width: 0;
}
.fq-dlg-enter-active,
.fq-dlg-leave-active {
  transition:
    opacity var(--d-base) var(--e-out),
    transform var(--d-base) var(--e-spring);
}
.fq-dlg-enter-from,
.fq-dlg-leave-to {
  opacity: 0;
  transform: translate(-50%, -48%);
}
.fq-fade-enter-active,
.fq-fade-leave-active {
  transition: opacity var(--d-base) var(--e-out);
}
.fq-fade-enter-from,
.fq-fade-leave-to {
  opacity: 0;
}
@media (max-width: 599px) {
  .dlg {
    left: 0;
    right: 0;
    top: auto;
    bottom: 0;
    transform: none;
    width: 100%;
    border-radius: var(--r-4) var(--r-4) 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .fq-dlg-enter-from,
  .fq-dlg-leave-to {
    transform: translateY(100%);
  }
  .ft {
    flex-direction: column-reverse;
    align-items: stretch;
  }
  .cancel,
  .go {
    flex: none;
  }
  .cancel :deep(.btn),
  .ft :deep(.btn) {
    height: 52px;
  }
}
</style>
