<script setup lang="ts">
import { computed } from 'vue';

import { positionTradeIdOf } from '@/composables/useBotAction';
import { useActionDialog } from '@/composables/useActionDialog';
import { useFqFleetStore } from '@/datasource/stores/fleet';
import { useFqPositionsStore } from '@/datasource/stores/positions';
import type { DataSource } from '@/datasource/types';

import ConfirmDangerDialog from './ConfirmDangerDialog.vue';
import { nettedWith } from './lib/dialog';

/**
 * Mounts the one confirmation dialog of the app for whatever surface asked for it
 * (`useActionDialog().request`). Placed once, in the shell.
 */
const props = defineProps<{
  /** Previews and tests: where the request goes; by default the active data source. */
  source?: DataSource | null;
  inline?: boolean;
}>();

const dialog = useActionDialog();
const fleet = useFqFleetStore();
const positions = useFqPositionsStore();

const req = computed(() => dialog.current.value);
const name = computed(() =>
  req.value ? (fleet.bots[req.value.botKey]?.identity.name ?? req.value.botKey) : '',
);
const netted = computed(() => {
  const p = req.value?.context.position;
  return p ? nettedWith(p, fleet.bots, positions.list) : [];
});
</script>

<template>
  <ConfirmDangerDialog
    v-if="req"
    open
    :action="req.action"
    :target="{ botKey: req.botKey, name, tradeId: positionTradeIdOf(req.action) }"
    :position="req.context.position ?? null"
    :netted-with="netted"
    :initial-fraction="req.context.initialFraction"
    :source="props.source"
    :inline="inline"
    @close="dialog.close()"
  />
</template>
