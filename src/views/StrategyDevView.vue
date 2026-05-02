<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const stratDevStore = useStrategyDevStore();
const botStore = useBotStore();
const showLeftBar = ref(true);

const isBotOnline = computed(() => botStore.activeBot?.isBotOnline ?? false);

onMounted(async () => {
  if (isBotOnline.value) {
    await botStore.activeBot.getState();
    stratDevStore.fetchAllRuns();
    stratDevStore.fetchGlossary();
  }
});

watch(isBotOnline, async (online) => {
  if (online && !stratDevStore.allRuns) {
    await botStore.activeBot.getState();
    stratDevStore.fetchAllRuns();
    stratDevStore.fetchGlossary();
  }
});

// ── Resizable sidebar ──
const sidebarRef = ref<HTMLElement>();
const isResizing = ref(false);
const sidebarWidth = computed(() => stratDevStore.sidebarWidth);

function startResize(e: MouseEvent) {
  e.preventDefault();
  isResizing.value = true;
  const startX = e.clientX;
  const startW = sidebarWidth.value;

  function onMove(ev: MouseEvent) {
    const delta = ev.clientX - startX;
    const newW = Math.max(240, Math.min(480, startW + delta));
    stratDevStore.setSidebarWidth(newW);
  }

  function onUp() {
    isResizing.value = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ── Keyboard shortcuts ──
function onKeydown(e: KeyboardEvent) {
  const active = document.activeElement;
  const isInput = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA';

  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    showLeftBar.value = true;
    nextTick(() => {
      const input = document.querySelector('.sd-sidebar input') as HTMLInputElement;
      input?.focus();
    });
  }
  if (e.key === 'Escape' && !isInput) {
    if (stratDevStore.selectedRun) {
      stratDevStore.selectRun(null);
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault();
    showLeftBar.value = !showLeftBar.value;
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="sd-layout" :class="{ 'sd-layout--resizing': isResizing }">
    <!-- Sidebar -->
    <aside
      ref="sidebarRef"
      class="sd-sidebar"
      :class="{ 'sd-sidebar--collapsed': !showLeftBar }"
      :style="showLeftBar ? { width: sidebarWidth + 'px' } : undefined"
    >
      <div class="sd-sidebar-inner">
        <button
          class="sd-sidebar-toggle"
          :title="showLeftBar ? 'Collapse sidebar' : 'Expand sidebar (Ctrl+K)'"
          @click="showLeftBar = !showLeftBar"
        >
          <i-mdi-chevron-left v-if="showLeftBar" class="w-5 h-5" />
          <i-mdi-chevron-right v-else class="w-5 h-5" />
        </button>

        <Transition name="sd-sidebar-content">
          <StrategyDevSidebar v-if="showLeftBar" />
        </Transition>
      </div>

      <!-- Resize handle -->
      <div
        v-if="showLeftBar"
        class="sd-resize-handle"
        @mousedown="startResize"
      />
    </aside>

    <!-- Main content -->
    <main class="sd-main">
      <h2 class="sd-page-title">{{ t('strategyDev.title') }}</h2>

      <!-- Bot offline -->
      <div v-if="!isBotOnline" class="sd-empty-state">
        <i-mdi-power-plug-off class="sd-empty-icon" />
        <p class="sd-empty-title">{{ t('strategyDev.botOfflineTitle') }}</p>
        <p class="sd-empty-desc">{{ t('strategyDev.botOfflineDesc') }}</p>
      </div>

      <!-- Auth error -->
      <StrategyDevAuthError v-else-if="stratDevStore.errorCode !== null" />

      <!-- Loading (only if no data at all yet) -->
      <div v-else-if="!stratDevStore.allRuns" class="sd-empty-state">
        <div class="sd-loading-spinner" />
        <p class="sd-empty-desc">{{ t('strategyDev.loading') }}</p>
      </div>

      <!-- Detail view -->
      <StrategyDevDetail v-else-if="stratDevStore.selectedRun" />

      <!-- Empty state -->
      <div v-else class="sd-empty-state">
        <i-mdi-flask-outline class="sd-empty-icon" />
        <p class="sd-empty-desc">{{ t('strategyDev.noRunSelected') }}</p>
        <p class="sd-empty-hint">{{ t('strategyDev.selectRunHint') }}</p>
        <div class="sd-shortcuts">
          <div class="sd-shortcut">
            <kbd>Ctrl</kbd>+<kbd>K</kbd>
            <span>{{ t('strategyDev.shortcutSearch') }}</span>
          </div>
          <div class="sd-shortcut">
            <kbd>Ctrl</kbd>+<kbd>B</kbd>
            <span>{{ t('strategyDev.shortcutSidebar') }}</span>
          </div>
          <div class="sd-shortcut">
            <kbd>↑</kbd><kbd>↓</kbd>
            <span>{{ t('strategyDev.shortcutNavigate') }}</span>
          </div>
          <div class="sd-shortcut">
            <kbd>Esc</kbd>
            <span>{{ t('strategyDev.shortcutDeselect') }}</span>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.sd-layout {
  display: flex;
  height: calc(100vh - 60px);
  overflow: hidden;
}

.sd-layout--resizing {
  cursor: col-resize;
  user-select: none;
}

/* ── Sidebar ── */
.sd-sidebar {
  position: relative;
  display: flex;
  flex-shrink: 0;
  border-right: 1px solid var(--sd-border-subtle);
  transition: width var(--sd-transition-base);
  overflow: hidden;
}

.sd-sidebar--collapsed {
  width: 48px;
}

.sd-sidebar-inner {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}

.sd-sidebar-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin: 8px;
  border-radius: var(--sd-radius-sm);
  border: 1px solid var(--sd-border-subtle);
  background: transparent;
  color: var(--sd-subtext);
  cursor: pointer;
  transition: all var(--sd-transition-fast);
  flex-shrink: 0;
}

.sd-sidebar-toggle:hover {
  background: var(--sd-surface0);
  color: var(--sd-text);
  border-color: var(--sd-border);
}

/* ── Resize handle ── */
.sd-resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  transition: background var(--sd-transition-fast);
}

.sd-resize-handle:hover,
.sd-layout--resizing .sd-resize-handle {
  background: var(--sd-info);
  opacity: 0.3;
}

/* ── Main content ── */
.sd-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.sd-page-title {
  font-size: var(--sd-text-2xl);
  font-weight: 700;
  color: var(--sd-text);
  margin: 8px 0 4px 20px;
}

/* ── Empty states ── */
.sd-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60%;
  color: var(--sd-overlay);
  animation: sd-fade-in 400ms ease;
}

.sd-empty-icon {
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
  opacity: 0.25;
}

.sd-empty-title {
  font-size: var(--sd-text-lg);
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--sd-subtext);
}

.sd-empty-desc {
  font-size: var(--sd-text-sm);
  text-align: center;
  max-width: 360px;
}

.sd-empty-hint {
  font-size: var(--sd-text-xs);
  color: var(--sd-overlay);
  margin-top: 8px;
}

/* ── Keyboard shortcuts ── */
.sd-shortcuts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 24px;
  padding: 12px 16px;
  background: var(--sd-surface);
  border-radius: var(--sd-radius-md);
  border: 1px solid var(--sd-border-subtle);
}

.sd-shortcut {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--sd-text-2xs);
  color: var(--sd-subtext);
}

.sd-shortcut kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  color: var(--sd-text);
  font-family: var(--sd-font-mono);
  font-size: 10px;
  font-weight: 600;
}

/* ── Loading spinner ── */
.sd-loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--sd-surface1);
  border-top-color: var(--sd-info);
  border-radius: 50%;
  animation: sd-spin 800ms linear infinite;
  margin-bottom: 16px;
}

/* ── Sidebar content transition ── */
.sd-sidebar-content-enter-active {
  transition: opacity 200ms ease;
}
.sd-sidebar-content-leave-active {
  transition: opacity 150ms ease;
}
.sd-sidebar-content-enter-from,
.sd-sidebar-content-leave-to {
  opacity: 0;
}
</style>
