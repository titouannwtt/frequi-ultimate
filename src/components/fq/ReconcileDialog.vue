<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { AdaptiveSheet, Badge, Btn, HoldButton, SegmentedControl, TextInput } from '@/components/ds';
import type { SegmentOption } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import type { FleetviewResolvePayload } from '@/types/fleetview';

import {
  intentsFor,
  payloadOf,
  sliceOf,
  typedMatches,
  type ReconIntent,
  type WriteOutcome,
} from './lib/reconWrite';
import type { FleetviewCoin } from '@/types/fleetview';

/**
 * The confirmation of a reconciliation write (02 section 11, destructive level): the coin is
 * named, what will be sent is shown as it will be sent, the coin name is typed back and the button
 * is held for one second. It sends nothing itself: `confirm` hands the body to the page, which
 * sends it once. After that the dialog only shows the result; "Retry" never exists, a new attempt
 * is a new preview with a new confirmation.
 */
const props = defineProps<{
  open: boolean;
  row: FleetviewCoin | null;
  /** The bot through which the request goes (the gateway checks its name again). */
  viaBot: string | null;
  /** The write is running. */
  busy: boolean;
  /** What came back, once it did. */
  outcome: WriteOutcome | null;
  /** The write could not be sent or failed on the way (message), without an answer. */
  failure: string | null;
}>();

const emit = defineEmits<{ close: []; confirm: [payload: FleetviewResolvePayload] }>();

const { t } = useI18n();
const fmt = useFormat();

const typed = ref('');
const pick = ref(0);
/** Armed once a hold completed: the dialog cannot submit twice. */
const submitted = ref(false);

const intents = computed<ReconIntent[]>(() => (props.row ? intentsFor(props.row) : []));
const intent = computed<ReconIntent | null>(
  () => intents.value[Math.min(pick.value, intents.value.length - 1)] ?? null,
);
const slice = computed(() => (intent.value ? sliceOf(intent.value.coin, intent.value.trade) : null));
const payload = computed(() => (intent.value ? payloadOf(intent.value) : null));
/** One hold per coin, action and trade, shared with any other surface that would offer it. */
const lockKey = computed(() =>
  intent.value
    ? `recon:${intent.value.coin.coin}:${intent.value.action}:${intent.value.trade?.trade_id ?? '-'}`
    : undefined,
);

const pickOptions = computed<SegmentOption<number>[]>(() =>
  intents.value.map((i, n) => ({
    value: n,
    label: i.trade ? `${i.trade.bot_name} #${i.trade.trade_id}` : String(n + 1),
  })),
);

watch(
  () => [props.open, props.row?.coin],
  () => {
    if (props.open) {
      typed.value = '';
      pick.value = 0;
      submitted.value = false;
    }
  },
  { immediate: true },
);

const armed = computed(
  () => !!intent.value && typedMatches(typed.value, intent.value.coin.coin) && !submitted.value,
);
const done = computed(() => props.outcome !== null || props.failure !== null);

function holdDone() {
  if (!payload.value || submitted.value) return;
  submitted.value = true;
  emit('confirm', payload.value);
}

const outcomeKey = computed(() => (props.outcome ? `fq.reconw.result.${props.outcome.status}` : ''));
const outcomeTone = computed(() => {
  switch (props.outcome?.status) {
    case 'accepted':
      return 'ok';
    case 'unknown':
    case 'in_progress':
      return 'warn';
    default:
      return 'crit';
  }
});
</script>

<template>
  <AdaptiveSheet
    :open="open"
    :title="t('fq.reconw.title', { coin: row?.coin ?? '' })"
    :scrim-close="false"
    @close="emit('close')"
  >
    <div v-if="row && intent" class="rw" data-testid="recon-dialog">
      <div class="head">
        <Badge kind="live" />
        <span class="via">{{ t('fq.reconw.via', { bot: viaBot ?? '?' }) }}</span>
      </div>

      <section class="what">
        <h3>{{ t(`fq.reconw.action.${intent.action}`) }}</h3>
        <p class="warn">{{ t(`fq.reconw.warn.${intent.action}`) }}</p>
        <SegmentedControl
          v-if="intents.length > 1"
          v-model="pick"
          :options="pickOptions"
          :label="t('fq.reconw.pickSlice')"
          size="sm"
        />
        <dl class="facts">
          <dt>{{ t('fq.recon.coin') }}</dt>
          <dd class="num">{{ row.coin }}</dd>
          <dt>{{ t('fq.recon.onChain') }}</dt>
          <dd class="num">{{ fmt.number(row.on_chain, 4) }}</dd>
          <dt>{{ t('fq.recon.bots') }}</dt>
          <dd class="num">{{ fmt.number(row.db_sum, 4) }}</dd>
          <template v-if="intent.trade">
            <dt>{{ t('fq.reconw.trade') }}</dt>
            <dd class="num">{{ intent.trade.bot_name }} #{{ intent.trade.trade_id }}</dd>
          </template>
          <template v-if="slice">
            <dt>{{ t('fq.reconw.sliceAmount') }}</dt>
            <dd class="num">{{ fmt.number(slice.signed_amount, 4) }}</dd>
            <dt>{{ t('fq.reconw.sliceStake') }}</dt>
            <dd class="num">{{ fmt.number(slice.stake_amount, 2) }} USDC</dd>
          </template>
        </dl>
        <details class="body">
          <summary>{{ t('fq.reconw.request') }}</summary>
          <pre class="num">POST /fleetview/reconciliation/resolve
{{ JSON.stringify(payload, null, 2) }}</pre>
        </details>
      </section>

      <section v-if="!done" class="gate">
        <TextInput
          v-model="typed"
          :label="t('fq.reconw.typeCoin', { coin: row.coin })"
          :placeholder="row.coin"
          mono
          :disabled="busy || submitted"
        />
        <HoldButton
          :label="t(`fq.reconw.hold.${intent.action}`)"
          :disabled="!armed || busy"
          :disabled-reason="t('fq.reconw.typeFirst')"
          :lock-key="lockKey"
          @complete="holdDone"
        />
        <p class="once">{{ t('fq.reconw.once') }}</p>
      </section>

      <section v-else class="result" :class="outcomeTone" data-testid="recon-result" role="status">
        <template v-if="outcome">
          <b>{{ t(outcomeKey) }}</b>
          <p v-if="outcome.text" class="num raw">{{ outcome.text }}</p>
          <p class="hint">{{ t(`fq.reconw.next.${outcome.status}`) }}</p>
        </template>
        <template v-else>
          <b>{{ t('fq.reconw.result.failed') }}</b>
          <p class="num raw">{{ failure }}</p>
          <p class="hint">{{ t('fq.reconw.next.failed') }}</p>
        </template>
        <Btn @click="emit('close')">{{ t('fq.ds.close') }}</Btn>
      </section>
    </div>
  </AdaptiveSheet>
</template>

<style scoped>
.rw {
  display: grid;
  gap: var(--s3);
  padding: var(--s3) var(--s4) var(--s4);
  text-align: left;
}
.head {
  display: flex;
  align-items: center;
  gap: var(--s2);
}
.via {
  color: var(--fg-2);
  font-size: var(--t-sm);
}
h3 {
  margin: 0;
  font-size: var(--t-md);
  font-weight: 600;
}
.warn {
  margin: var(--s1) 0 var(--s2);
  padding: var(--s2);
  border-left: 3px solid var(--crit);
  background: var(--crit-w);
  color: var(--fg);
  font-size: var(--t-sm);
}
.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px var(--s3);
  margin: var(--s2) 0;
  font-size: var(--t-sm);
}
dt {
  color: var(--fg-3);
}
dd {
  margin: 0;
  text-align: right;
}
.body summary {
  cursor: pointer;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
pre {
  margin: var(--s1) 0 0;
  padding: var(--s2);
  background: var(--bg-2);
  border-radius: var(--r-1);
  font-size: var(--t-xs);
  overflow: auto;
}
.gate {
  display: grid;
  gap: var(--s2);
}
.once {
  margin: 0;
  color: var(--fg-3);
  font-size: var(--t-xs);
}
.result {
  display: grid;
  gap: var(--s2);
  padding: var(--s3);
  border: 1px solid var(--line-2);
  border-radius: var(--r-2);
}
.result.ok {
  border-color: var(--profit);
  background: var(--profit-w);
}
.result.warn {
  border-color: var(--warn);
  background: var(--warn-w);
}
.result.crit {
  border-color: var(--crit);
  background: var(--crit-w);
}
.raw {
  margin: 0;
  font-size: var(--t-xs);
  overflow-wrap: anywhere;
}
.hint {
  margin: 0;
  color: var(--fg-2);
  font-size: var(--t-sm);
}
.num {
  font-variant-numeric: tabular-nums;
  font-family: var(--font-num);
}
</style>
