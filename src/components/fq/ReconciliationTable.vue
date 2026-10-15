<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { Badge, Btn, EmptyState } from '@/components/ds';
import { useFormat } from '@/components/ds/lib/useFormat';
import { useNowMs } from '@/components/ds/lib/useNowMs';
import type { FleetviewCoin } from '@/types/fleetview';

import { nextSweepInMs, onChainNotional, reconView, sortRecon } from './lib/recon';

/**
 * The wallet reconciliation as a table (02 section 3.5): per coin the signed position on the
 * wallet, the sum of the bots' databases, the classification and the proposal. It is read only.
 * The "Preview" of a row asks the page for a confirmation of the destructive level (name of the
 * coin typed, then a 1 s hold), where the Python write happens; this table never sends anything and
 * never offers an exit on a position without an owner bot.
 */
const props = defineProps<{
  /** Shortened wallet address (`0xAbCd...1234`); the full address never reaches the browser. */
  wallet: string;
  rows: FleetviewCoin[];
  /** When the sweep was made (server time, ms). */
  checkedMs?: number | null;
  /** A preview is already open or a write is running: no second one. */
  busy?: boolean;
  nowMs?: number;
}>();

const emit = defineEmits<{ preview: [row: FleetviewCoin] }>();

const { t } = useI18n();
const fmt = useFormat();
const clock = useNowMs();
const now = computed(() => props.nowMs ?? clock.value);

const sorted = computed(() => sortRecon(props.rows));
const issues = computed(() => props.rows.filter((r) => r.status !== 'ok').length);
const hasChecked = computed(() => props.checkedMs !== null && props.checkedMs !== undefined);
const sweepAge = computed(() =>
  props.checkedMs == null ? 0 : Math.max(0, now.value - props.checkedMs),
);
const wait = computed(() => nextSweepInMs(props.checkedMs, now.value));

function sideLetter(v: number): string {
  return v === 0 ? '' : v > 0 ? t('fq.side.longLetter') : t('fq.side.shortLetter');
}
function amount(v: number): string {
  return v === 0 ? '0' : `${sideLetter(v)} ${fmt.number(Math.abs(v), Math.abs(v) >= 100 ? 1 : 3)}`;
}
function proposal(r: FleetviewCoin): string {
  const v = reconView(r);
  if (v.proposalKey === 'deletePhantom') {
    return t('fq.recon.proposal.deletePhantom', {
      id: r.phantom_candidate?.trade_id ?? '',
      bot: r.phantom_candidate?.bot_name ?? '',
    });
  }
  if (v.proposalKey === 'closeMinority') {
    return t('fq.recon.proposal.closeMinority', {
      n: r.minority_slices.length,
    });
  }
  if (v.hints.length > 0 && v.classKey === 'ambiguous') {
    return v.hints.map((h) => t(`fq.recon.hint.${h}`)).join(' · ');
  }
  return t(`fq.recon.proposal.${v.proposalKey}`);
}
</script>

<template>
  <div class="rec" data-testid="reconciliation">
    <div class="meta">
      <span class="w num" :title="t('fq.recon.walletTitle')">{{ wallet }}</span>
      <Badge :kind="issues > 0 ? 'crit' : 'neutral'" :label="t('fq.recon.issues', { n: issues })" />
    </div>
    <div v-if="sorted.length > 0" class="wrap">
      <table>
        <thead>
          <tr>
            <th class="l">{{ t('fq.recon.coin') }}</th>
            <th>{{ t('fq.recon.onChain') }}</th>
            <th>{{ t('fq.recon.bots') }}</th>
            <th class="l">{{ t('fq.recon.classification') }}</th>
            <th class="l proposal">{{ t('fq.recon.proposalTitle') }}</th>
            <th>
              <span class="sr">{{ t('fq.recon.action') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in sorted"
            :key="`${r.coin}`"
            :class="{ orph: r.status === 'unowned' }"
            :data-status="r.status"
          >
            <td class="l ui coin">{{ r.coin }}</td>
            <td
              class="num"
              :title="
                onChainNotional(r) === null
                  ? ''
                  : `${fmt.number(onChainNotional(r) as number, 2)} USDC`
              "
            >
              {{ amount(r.on_chain) }}
              <small v-if="onChainNotional(r) !== null" class="mut"
                >≈ {{ fmt.number(onChainNotional(r) as number, 0) }}</small
              >
            </td>
            <td class="num">{{ amount(r.db_sum) }}</td>
            <td class="l ui">
              <Badge
                :kind="
                  reconView(r).tone === 'orphan'
                    ? 'orphan'
                    : reconView(r).tone === 'crit'
                      ? 'crit'
                      : reconView(r).tone === 'warn'
                        ? 'warn'
                        : 'neutral'
                "
                :label="t(`fq.recon.class.${r.status}`, { n: reconView(r).bots })"
              />
            </td>
            <td class="l ui proposal" :class="{ mut: r.status === 'ok' }">{{ proposal(r) }}</td>
            <td>
              <Btn
                v-if="reconView(r).actionable"
                size="xs"
                :disabled="busy"
                :data-coin="r.coin"
                @click="emit('preview', r)"
                >{{ t('fq.recon.preview') }}</Btn
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <EmptyState
      v-else
      icon="git-compare-arrows"
      :title="t('fq.recon.empty')"
      :hint="t('fq.recon.emptyHint')"
    />
    <p v-if="hasChecked" class="foot mut" data-testid="recon-foot">
      {{ t('fq.recon.lastSweep', { age: fmt.age(sweepAge) }) }}
      <template v-if="wait > 0">
        · {{ t('fq.recon.nextIn', { s: Math.ceil(wait / 1000) }) }}</template
      >
    </p>
  </div>
</template>

<style scoped>
.rec {
  display: grid;
  gap: var(--s2);
  min-width: 0;
  container-type: inline-size;
}
.meta {
  display: flex;
  align-items: center;
  gap: var(--s2);
}
.w {
  font-size: var(--t-xs);
  color: var(--fg-3);
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
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
td {
  text-align: right;
  padding: 4px 8px;
  height: var(--row);
  border-bottom: 1px solid var(--line);
  vertical-align: middle;
}
th.l,
td.l {
  text-align: left;
}
tr:last-child td {
  border-bottom: 0;
}
tr.orph td {
  background: var(--crit-w);
}
td.ui {
  font-family: var(--font-ui);
}
td.coin {
  font-weight: 600;
}
.num {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums slashed-zero;
}
td small {
  display: block;
  font-size: var(--t-xs);
}
.mut {
  color: var(--fg-3);
}
.foot {
  margin: 0;
  font-size: var(--t-xs);
}
.proposal {
  white-space: normal;
  min-width: 150px;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
@container (max-width: 560px) {
  .proposal {
    display: none;
  }
}
</style>
