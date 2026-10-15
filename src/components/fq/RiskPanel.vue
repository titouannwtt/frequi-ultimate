<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  Badge,
  DirectionChip,
  EmptyState,
  ExcludedCount,
  ModeMark,
  Skeleton,
  SplitBar,
} from '@/components/ds';
import type { BotRef } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useScopeDetail } from '@/composables/useScopeDetail';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import type { ScopeDetail, ScopeRef } from '@/datasource/types';
import type { BotKey, BotMode } from '@/gateway/types.gen';

import { liquidationTone, riskModel } from './lib/risk';
import { pairLabel } from './lib/trades';

/**
 * Wallet-level risk (02 sections 4.1 C5 and 12): the closest liquidation, the effective leverage,
 * the exposure netted per coin and the orphan positions. Exposure is read per wallet and never
 * added bot by bot. One trading mode at a time (live by default). Pure DOM, no chart instance.
 * `detail` shows every coin held by several bots (Tools, advanced risk) instead of the first few.
 */
const props = withDefaults(
  defineProps<{
    scope: ScopeRef;
    detail?: boolean;
    mode?: BotMode;
    /** Replaces the query (previews and tests). */
    scopeDetail?: ScopeDetail | null;
    coinLimit?: number;
  }>(),
  { detail: false, mode: 'live', scopeDetail: null, coinLimit: 4 },
);

const emit = defineEmits<{ openBot: [botKey: BotKey]; openReconciliation: [] }>();

const { t } = useI18n();
const fmt = useFormat();
const fleet = useFqFleetStore();

const loaded = useScopeDetail(() => props.scope);
const data = computed<ScopeDetail | null>(() => props.scopeDetail ?? loaded.detail.value);

const model = computed(() => {
  const d = data.value;
  if (!d) return null;
  return riskModel({
    positions: d.positions,
    totals: d.totals.find((x) => x.mode === props.mode) ?? null,
    mode: props.mode,
    modeOf: (k) => fleet.bots[k]?.identity.mode ?? null,
    walletOf: (k) => fleet.bots[k]?.state.wallet_id ?? null,
  });
});

const showAll = ref(false);
const coins = computed(() => {
  const all = model.value?.coins ?? [];
  return props.detail || showAll.value ? all : all.slice(0, props.coinLimit);
});
const coinScale = computed(() =>
  Math.max(1, ...(model.value?.coins ?? []).map((c) => Math.max(c.long, c.short))),
);
const nameOf = (k: BotKey) => fleet.bots[k]?.identity.name ?? k;
const excludedRefs = computed<BotRef[]>(() =>
  (model.value?.excluded ?? []).map((k) => ({
    key: k,
    name: nameOf(k),
    reason: t('fq.status.stale'),
  })),
);
function openNearest() {
  const k = model.value?.nearest?.botKey;
  if (k) emit('openBot', k);
}
const tone = computed(() => liquidationTone(model.value?.nearest?.distancePct ?? null));
</script>

<template>
  <div class="risk" data-testid="risk-panel">
    <p v-if="loaded.stale.value && data && !scopeDetail" class="err" role="status">
      {{ t('fq.ds.pane.error') }} · {{ t('fq.ds.pane.lastValues') }}
    </p>
    <Skeleton v-if="!model" shape="row" :count="4" />
    <template v-else>
      <div class="head">
        <ModeMark :mode="mode" full />
        <span v-if="!model.exposure.netted" class="mut" data-testid="risk-not-netted">{{
          t('fq.fleet.notNetted')
        }}</span>
        <ExcludedCount :bots="excludedRefs" @select="(b) => emit('openBot', b.key)" />
      </div>

      <dl class="rk">
        <dt>{{ t('fq.risk.nearest') }}</dt>
        <dd data-testid="risk-nearest" :class="tone">
          <template v-if="model.nearest">
            <span class="num">{{ fmt.percent(model.nearest.distancePct, 1, false) }}</span>
            · {{ pairLabel(model.nearest.pair) }}
            <button type="button" class="link" @click="openNearest">
              {{ nameOf(model.nearest.botKey) }}
            </button>
          </template>
          <span v-else class="mut">{{ t('fq.ds.notAvailable') }}</span>
        </dd>

        <dt>{{ t('fq.risk.leverage') }}</dt>
        <dd data-testid="risk-leverage">
          <template v-if="model.leverage !== null">
            <span class="num">{{ fmt.number(model.leverage, 2) }}×</span>
            <span v-if="model.capitalPartial" class="mut partial">{{
              t('fq.risk.partialCapital')
            }}</span>
          </template>
          <span v-else class="mut">{{ t('fq.ds.notAvailable') }}</span>
        </dd>

        <dt>{{ t('fq.risk.exposure') }}</dt>
        <dd class="expo">
          <span class="num"
            >{{ fmt.number(model.exposure.long, 0) }} /
            {{ fmt.number(model.exposure.short, 0) }}</span
          >
          <span class="mut">
            · {{ t('fq.header.net', { n: fmt.signed(model.exposure.net, 0) }) }}</span
          >
          <SplitBar :long="model.exposure.long" :short="model.exposure.short" />
        </dd>

        <dt>{{ t('fq.risk.netting') }}</dt>
        <dd class="num" data-testid="risk-netting-count">{{ model.coins.length }}</dd>

        <dt>{{ t('fq.risk.orphan') }}</dt>
        <dd data-testid="risk-orphans">
          <template v-if="model.orphans.length > 0">
            <button
              v-for="o in model.orphans"
              :key="`${o.pair}-${o.side}`"
              type="button"
              class="orph"
              @click="emit('openReconciliation')"
            >
              <Badge kind="orphan" />
              {{ pairLabel(o.pair) }}
              <DirectionChip :side="o.side" />
              <span class="num">{{ fmt.number(o.notional, 2) }}</span>
            </button>
          </template>
          <span v-else class="mut">{{ t('fq.risk.noOrphan') }}</span>
        </dd>
      </dl>

      <div
        v-if="model.coins.length > 0"
        class="coins"
        role="table"
        :aria-label="t('fq.risk.coinsTitle')"
      >
        <span class="colh" role="columnheader">{{ t('fq.risk.coin') }}</span>
        <span class="colh" role="columnheader">{{ t('fq.risk.bots') }}</span>
        <span class="colh" role="columnheader">{{ t('fq.side.longLetter') }}</span>
        <span class="colh" role="columnheader">{{ t('fq.side.shortLetter') }}</span>
        <span class="colh r" role="columnheader">{{ t('fq.risk.net') }}</span>
        <template v-for="c in coins" :key="c.key">
          <span class="coin" role="cell" :title="c.coin">{{ pairLabel(c.coin) }}</span>
          <span class="num mut" role="cell" :title="c.bots.map(nameOf).join(', ')"
            >×{{ c.bots.length }}</span
          >
          <span class="bwrap" role="cell"
            ><i class="bl" :style="{ width: `${(c.long / coinScale) * 100}%` }"></i
          ></span>
          <span class="bwrap" role="cell"
            ><i class="bs" :style="{ width: `${(c.short / coinScale) * 100}%` }"></i
          ></span>
          <span class="num r" role="cell">{{ fmt.signed(c.net, 0) }}</span>
        </template>
      </div>
      <button
        v-if="!detail && model.coins.length > coinLimit"
        type="button"
        class="more"
        @click="showAll = !showAll"
      >
        {{
          showAll
            ? t('fq.risk.fewer')
            : t('fq.risk.seeOthers', { n: model.coins.length - coinLimit })
        }}
      </button>
      <EmptyState
        v-if="model.coins.length === 0 && data && data.positions.length === 0"
        icon="layers"
        :title="t('fq.risk.noPosition')"
        :hint="t('fq.risk.noPositionHint')"
      />
    </template>
  </div>
</template>

<style scoped>
.risk {
  display: grid;
  gap: var(--s2);
  padding: var(--s3);
  min-width: 0;
  font-size: var(--t-sm);
}
.err {
  margin: 0;
  color: var(--warn);
  font-size: var(--t-xs);
}
.head {
  display: flex;
  align-items: center;
  gap: var(--s2);
  flex-wrap: wrap;
}
.partial {
  margin-left: var(--s2);
}
.mut {
  color: var(--fg-3);
}
.rk {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px var(--s3);
  margin: 0;
  align-items: baseline;
}
.rk dt {
  color: var(--fg-2);
  min-width: 0;
}
.rk dd {
  margin: 0;
  text-align: right;
  min-width: 0;
  font-weight: 600;
}
.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
dd.crit {
  color: var(--crit);
}
dd.warn {
  color: var(--warn);
}
.expo {
  display: grid;
  gap: 4px;
  min-width: 160px;
}
.link {
  background: none;
  border: 0;
  padding: 0;
  color: var(--fg-3);
  font: inherit;
  font-weight: 400;
  cursor: pointer;
  text-decoration: underline dotted;
}
.orph {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--crit-w);
  border: 1px solid color-mix(in srgb, var(--crit) 40%, transparent);
  border-radius: var(--r-1);
  padding: 1px 6px;
  color: var(--fg);
  font: inherit;
  cursor: pointer;
}
.coins {
  display: grid;
  grid-template-columns: minmax(48px, auto) auto minmax(40px, 1fr) minmax(40px, 1fr) auto;
  gap: 4px var(--s2);
  align-items: center;
  padding-top: var(--s2);
  border-top: 1px solid var(--line);
}
.colh {
  font-size: var(--t-xs);
  color: var(--fg-3);
}
.r {
  text-align: right;
}
.coin {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bwrap {
  display: block;
  height: 8px;
  background: var(--bg-2);
  border-radius: 2px;
  overflow: hidden;
}
.bl,
.bs {
  display: block;
  height: 100%;
}
.bl {
  background: var(--long);
}
.bs {
  background: var(--short);
  background-image: var(--short-hatch);
}
.more {
  justify-self: start;
  background: none;
  border: 0;
  padding: 0;
  color: var(--accent);
  font: inherit;
  font-size: var(--t-xs);
  cursor: pointer;
}
</style>
