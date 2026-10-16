<script setup lang="ts">
import type { Position } from '@/gateway/types.gen';

import BotActionBar from './BotActionBar.vue';
import type { ActionId } from './lib/actions';

/**
 * Sticky foot of the trade drawer: "Exit..." and "Add to position...". The share to exit (25, 50,
 * 100 %) is chosen in the confirmation of the exit, next to the amount it represents and the
 * minimum order: nothing is decided, or sent, from here.
 */
defineProps<{ position: Position }>();
const emit = defineEmits<{ navigate: [id: ActionId] }>();
</script>

<template>
  <div class="foot">
    <BotActionBar
      context="drawer"
      :bot-key="position.bot_key"
      :position="position"
      @navigate="(id) => emit('navigate', id)"
    />
  </div>
</template>

<style scoped>
.foot {
  display: grid;
  /* A grid track is min-content wide by default: let the bar wrap inside the panel */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--s2);
}
</style>
