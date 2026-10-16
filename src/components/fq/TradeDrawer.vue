<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { AdaptiveSheet, EmptyState } from '@/components/ds';
import type { LadderOrder } from '@/components/ds';
import { useTradeOrders } from '@/composables/useTradeOrders';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { BotKey } from '@/gateway/types.gen';

import type { ActionId } from './lib/actions';
import { pairLabel } from './lib/trades';
import TradeDrawerBody from './TradeDrawerBody.vue';
import TradeDrawerFoot from './TradeDrawerFoot.vue';

/**
 * Detail of one trade (02 sections 3.2 and 5.2), docked on the Bot page, a side drawer elsewhere
 * and a bottom sheet on a phone. It is addressed by `(botKey, tradeId)` and reads that exact
 * position: two bots can hold the same trade id, and the drawer never shows or acts on the other.
 * A trade that closed while the drawer was open is said so; no action remains.
 */
const props = withDefaults(
  defineProps<{
    botKey: BotKey;
    tradeId: number;
    docked?: boolean;
    /** Drawer or sheet only: whether it is shown. */
    open?: boolean;
    tp?: number | null;
    nextSo?: number | null;
    dcaMax?: number | null;
    orders?: LadderOrder[];
    inline?: boolean;
  }>(),
  { docked: false, open: true, tp: null, nextSo: null, dcaMax: null },
);

const emit = defineEmits<{ close: []; navigate: [id: ActionId] }>();

const { t } = useI18n();
const positions = useFqPositionsStore();
const position = computed(() => positions.get(props.botKey, props.tradeId) ?? null);
// The drawer reads the orders of its own trade when the page did not hand them over: a drawer
// opened from the fleet table or the journal has no other way to know its ladder
const own = useTradeOrders(
  () => props.botKey,
  () => props.tradeId,
  () => position.value?.side ?? 'long',
);
const ladder = computed(() => props.orders ?? own.model.value?.ladder);
const ladderLoading = computed(() => props.orders === undefined && own.loading.value);
const fraction = ref(1);
const title = computed(() =>
  position.value ? `${pairLabel(position.value.pair)} #${props.tradeId}` : `#${props.tradeId}`,
);
</script>

<template>
  <aside v-if="docked" class="docked" :aria-label="title" data-testid="trade-drawer">
    <div class="scroll">
      <TradeDrawerBody
        v-if="position"
        :position="position"
        :tp="tp"
        :next-so="nextSo"
        :dca-max="dcaMax"
        :orders="ladder"
        :orders-loading="ladderLoading"
      />
      <EmptyState
        v-else
        icon="layers"
        :title="t('fq.drawer.gone')"
        :hint="t('fq.drawer.goneHint')"
      />
    </div>
    <footer v-if="position" class="sticky">
      <TradeDrawerFoot
        v-model="fraction"
        :position="position"
        @navigate="(id) => emit('navigate', id)"
      />
    </footer>
  </aside>
  <AdaptiveSheet v-else :open="open" :title="title" :inline="inline" @close="emit('close')">
    <div data-testid="trade-drawer">
      <TradeDrawerBody
        v-if="position"
        :position="position"
        :tp="tp"
        :next-so="nextSo"
        :dca-max="dcaMax"
        :orders="ladder"
        :orders-loading="ladderLoading"
      />
      <EmptyState
        v-else
        icon="layers"
        :title="t('fq.drawer.gone')"
        :hint="t('fq.drawer.goneHint')"
      />
    </div>
    <template v-if="position" #footer>
      <TradeDrawerFoot
        v-model="fraction"
        :position="position"
        @navigate="(id) => emit('navigate', id)"
      />
    </template>
  </AdaptiveSheet>
</template>

<style scoped>
.docked {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: var(--r-2);
}
.scroll {
  flex: 1;
  overflow: auto;
  min-height: 0;
}
.sticky {
  flex: none;
  padding: var(--s3);
  border-top: 1px solid var(--line);
  background: var(--bg-1);
}
</style>
