<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  title?: string;
  chartId?: string;
  hint?: string;
}>();

const isFullscreen = ref(false);
const wrapperRef = ref<HTMLElement | null>(null);
const exportFeedback = ref(false);

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value;
  if (isFullscreen.value) {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = '';
  }
}

function closeFullscreen() {
  isFullscreen.value = false;
  document.body.style.overflow = '';
}

async function exportPng() {
  const container = isFullscreen.value
    ? document.querySelector('.cw-fullscreen-body')
    : wrapperRef.value;
  if (!container) return;

  const canvas = container.querySelector('canvas');
  if (!canvas) return;

  try {
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `${props.title || props.chartId || 'chart'}.png`;
    link.href = dataUrl;
    link.click();
    exportFeedback.value = true;
    setTimeout(() => (exportFeedback.value = false), 2000);
  } catch {
    // canvas tainted or other issue
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isFullscreen.value) {
    closeFullscreen();
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
});
</script>

<template>
  <div ref="wrapperRef" class="cw">
    <!-- Header bar (always visible) -->
    <div class="cw-header">
      <span v-if="title" class="cw-title">{{ title }}</span>
      <div class="cw-actions">
        <InfoTip v-if="hint" :text="hint" position="bottom" width="300px" />
        <button
          class="cw-btn"
          :class="{ 'cw-btn--success': exportFeedback }"
          :title="t('strategyDev.chartExportPng')"
          @click="exportPng"
        >
          <i-mdi-download v-if="!exportFeedback" class="w-3.5 h-3.5" />
          <i-mdi-check v-else class="w-3.5 h-3.5" />
        </button>
        <button
          class="cw-btn"
          :title="t('strategyDev.chartFullscreen')"
          @click="toggleFullscreen"
        >
          <i-mdi-fullscreen class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- Normal slot -->
    <slot />

    <!-- Fullscreen overlay -->
    <Teleport to="body">
      <Transition name="cw-fs">
        <div v-if="isFullscreen" class="cw-fullscreen-overlay" @click.self="closeFullscreen">
          <div class="cw-fullscreen-container">
            <div class="cw-fullscreen-header">
              <span v-if="title" class="cw-fullscreen-title">{{ title }}</span>
              <div class="cw-fullscreen-actions">
                <button class="cw-btn" :title="t('strategyDev.chartExportPng')" @click="exportPng">
                  <i-mdi-download v-if="!exportFeedback" class="w-4 h-4" />
                  <i-mdi-check v-else class="w-4 h-4" />
                </button>
                <button class="cw-btn" @click="closeFullscreen">
                  <i-mdi-close class="w-4 h-4" />
                </button>
              </div>
            </div>
            <div class="cw-fullscreen-body">
              <slot name="fullscreen" />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.cw {
  position: relative;
}

.cw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 4px;
  min-height: 28px;
}

.cw-title {
  font-size: 12px;
  color: #a6adc8;
  font-weight: 600;
}

.cw-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.cw-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 4px;
  border: none;
  background: rgba(30, 30, 46, 0.85);
  color: #a6adc8;
  cursor: pointer;
  transition: all 0.15s;
  backdrop-filter: blur(4px);
}
.cw-btn:hover {
  background: rgba(49, 50, 68, 0.95);
  color: #cdd6f4;
}
.cw-btn--success {
  color: #a6e3a1 !important;
}

/* ── Fullscreen ── */
.cw-fullscreen-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}

.cw-fullscreen-container {
  width: 95vw;
  height: 90vh;
  background: #1e1e2e;
  border-radius: 12px;
  border: 1px solid #313244;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cw-fullscreen-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid #313244;
  background: #181825;
  flex-shrink: 0;
}

.cw-fullscreen-title {
  font-size: var(--sd-text-sm);
  font-weight: 600;
  color: var(--sd-text);
}

.cw-fullscreen-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cw-fullscreen-body {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.cw-fullscreen-body :deep(.v-chart) {
  width: 100% !important;
  height: 100% !important;
  min-height: 500px;
}

/* ── Transition ── */
.cw-fs-enter-active { transition: opacity 0.2s ease; }
.cw-fs-leave-active { transition: opacity 0.15s ease; }
.cw-fs-enter-from, .cw-fs-leave-to { opacity: 0; }
</style>
