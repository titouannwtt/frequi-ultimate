<script setup lang="ts">
/**
 * TradePopoverHost — Single host for ALL trade table popovers.
 * Positioned via Floating UI (flip/shift/arrow).
 * Includes export-to-PNG button.
 */
import type { Trade, ClosedTrade } from '@/types';
import type { PopoverName } from '@/composables/useTradePopover';
import { toPng } from 'html-to-image';

const props = defineProps<{
  active: PopoverName | null;
  trade: Trade | null;
  botId: string;
  styleObj: Record<string, string>;
  arrowStyle?: Record<string, string>;
  actualPlacement?: string;
  trades: (Trade | ClosedTrade)[];
  isOpen: boolean;
}>();

const emit = defineEmits<{
  keep: [];
  leave: [];
}>();

const exporting = ref(false);

async function exportPng() {
  const el = document.getElementById('trade-popover-floating');
  if (!el) return;
  exporting.value = true;
  try {
    // Hide the export button and arrow during capture
    const arrow = document.getElementById('trade-popover-arrow');
    const exportBtn = document.getElementById('popover-export-btn');
    if (arrow) arrow.style.display = 'none';
    if (exportBtn) exportBtn.style.display = 'none';

    const dataUrl = await toPng(el, {
      backgroundColor: '#0f1117',
      pixelRatio: 2,
    });

    // Restore
    if (arrow) arrow.style.display = '';
    if (exportBtn) exportBtn.style.display = '';

    // Download
    const link = document.createElement('a');
    link.download = `popover-${props.active}-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  } catch (err) {
    console.warn('Export failed:', err);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="popover-fade">
      <div
        v-if="active && (trade || active === 'typeLeverage' || active === 'exitReason')"
        id="trade-popover-floating"
        class="trade-popover-panel"
        :style="styleObj"
        @mouseenter="emit('keep')"
        @mouseleave="emit('leave')"
      >
        <!-- Arrow -->
        <div id="trade-popover-arrow" class="trade-popover-arrow" :style="arrowStyle" />

        <!-- Export button (top-right, discreet) -->
        <button
          id="popover-export-btn"
          class="absolute top-1.5 right-1.5 p-1 rounded opacity-20 hover:opacity-70 transition-opacity cursor-pointer z-10"
          title="Export as PNG"
          @click.stop="exportPng"
        >
          <i-mdi-download v-if="!exporting" class="w-3.5 h-3.5 text-surface-400" />
          <i-mdi-loading v-else class="w-3.5 h-3.5 text-surface-400 animate-spin" />
        </button>

        <!-- Content -->
        <div class="relative">
          <template v-if="active === 'tradeDetail' && trade">
            <slot name="tradeDetail" :trade="trade" :bot-id="botId" />
          </template>
          <template v-else-if="active === 'chart' && trade">
            <slot name="chart" :trade="trade" :bot-id="botId" />
          </template>
          <template v-else-if="active === 'duration' && trade">
            <slot name="duration" :trade="trade" :trades="trades" />
          </template>
          <template v-else-if="active === 'dca' && trade">
            <slot name="dca" :trade="trade" />
          </template>
          <template v-else-if="active === 'typeLeverage'">
            <slot name="typeLeverage" :trade="trade" :trades="trades" />
          </template>
          <template v-else-if="active === 'exitReason'">
            <slot name="exitReason" :trade="trade" :trades="trades" />
          </template>
          <template v-else-if="active === 'profitStats' && trade">
            <slot name="profitStats" :trade="trade" :trades="trades" />
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.trade-popover-panel {
  position: relative;
  background: rgba(15, 17, 23, 0.96);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.5),
    0 2px 8px rgba(0, 0, 0, 0.3);
  max-height: calc(100vh - 16px);
  max-width: calc(100vw - 16px);
  overflow-y: auto;
  overflow-x: hidden;
  pointer-events: auto;
}

.trade-popover-arrow {
  position: absolute;
  width: 8px;
  height: 8px;
  background: rgba(15, 17, 23, 0.96);
  /* transform set dynamically via inline style based on placement side */
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  border-right: none;
  border-bottom: none;
}

.popover-fade-enter-active {
  transition:
    opacity 0.12s ease-out,
    transform 0.12s ease-out;
}
.popover-fade-leave-active {
  transition:
    opacity 0.08s ease-in,
    transform 0.08s ease-in;
}
.popover-fade-enter-from {
  opacity: 0;
  transform: scale(0.96);
}
.popover-fade-leave-to {
  opacity: 0;
  transform: scale(0.98);
}
</style>
