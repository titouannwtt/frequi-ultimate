<script setup lang="ts">
/**
 * Boot splash: takes over from the static splash in index.html the moment Vue mounts,
 * shows progress tied to actual bot loading state (X / N bots), then fades into the app.
 *
 * One-shot per browsing session — flagged in sessionStorage so SPA navigation never
 * re-triggers it. The pre-Vue static splash is removed from the DOM on mount so we own
 * the screen alone (no double layer, no flash).
 */
import { useI18n } from 'vue-i18n';
import { useBotStore } from '@/stores/ftbotwrapper';

const { t } = useI18n();
const botStore = useBotStore();

const SESSION_KEY = 'ftBootShown';
const MIN_DISPLAY_MS = 400; // floor — avoid a too-brief flash on warm caches
const SOFT_TIMEOUT_MS = 5000; // hide once we believe we're "mostly there"
const HARD_TIMEOUT_MS = 8000; // safety cap, never block the dashboard
const NO_BOT_GRACE_MS = 600; // first-time user (no bot configured): exit fast
const READY_RATIO = 0.8; // fraction of bots whose status must be known

const visible = ref(sessionStorage.getItem(SESSION_KEY) !== '1');
const mountedAt = Date.now();

const totalBots = computed<number>(() => botStore.botCount);
const loadedBots = computed<number>(
  // botStatusAvailable flips true once the bot responded (online or offline confirmed).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  () => botStore.allBotStores.filter((b: any) => b.botStatusAvailable).length,
);
const ratio = computed(() =>
  totalBots.value === 0 ? 0.5 : Math.min(1, loadedBots.value / totalBots.value),
);

// 8% floor: the bar is never visually empty (always reads as "we are doing something").
const progressPct = ref(8);
let rafId: number | null = null;
function syncProgress() {
  const target = Math.max(8, Math.round(ratio.value * 100));
  if (progressPct.value !== target) progressPct.value = target;
}
watch([loadedBots, totalBots], () => {
  if (rafId !== null) return; // coalesce bursts of bot updates into one frame
  rafId = requestAnimationFrame(() => {
    rafId = null;
    syncProgress();
  });
});

const status = computed(() => {
  if (totalBots.value === 0) return t('boot.connecting');
  if (ratio.value < READY_RATIO) {
    return t('boot.botsLoaded', { loaded: loadedBots.value, total: totalBots.value });
  }
  return t('boot.preparingDashboard');
});

function hide() {
  if (!visible.value) return;
  const elapsed = Date.now() - mountedAt;
  if (elapsed < MIN_DISPLAY_MS) {
    setTimeout(hide, MIN_DISPLAY_MS - elapsed);
    return;
  }
  visible.value = false;
  sessionStorage.setItem(SESSION_KEY, '1');
}

watch(ratio, (r) => {
  if (r >= READY_RATIO && totalBots.value > 0) hide();
});

let softTimer: ReturnType<typeof setTimeout> | null = null;
let hardTimer: ReturnType<typeof setTimeout> | null = null;
let noBotsTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  // Seamless handoff: remove the pre-Vue splash (we are visually identical).
  document.getElementById('ft-boot-splash')?.remove();

  softTimer = setTimeout(hide, SOFT_TIMEOUT_MS);
  hardTimer = setTimeout(hide, HARD_TIMEOUT_MS);
  // First-user / nothing configured: fade out so the login UI takes over quickly.
  noBotsTimer = setTimeout(() => {
    if (totalBots.value === 0) hide();
  }, NO_BOT_GRACE_MS);
});

onBeforeUnmount(() => {
  if (softTimer) clearTimeout(softTimer);
  if (hardTimer) clearTimeout(hardTimer);
  if (noBotsTimer) clearTimeout(noBotsTimer);
  if (rafId !== null) cancelAnimationFrame(rafId);
});
</script>

<template>
  <Transition name="ft-boot-fade">
    <div
      v-if="visible"
      class="ft-boot-overlay"
      role="status"
      aria-live="polite"
      :aria-label="status"
    >
      <div class="ft-boot-ring">
        <div class="ft-boot-dot"></div>
      </div>
      <div class="ft-boot-wordmark">freq<b>UI</b></div>
      <Transition name="ft-boot-status-fade" mode="out-in">
        <div :key="status" class="ft-boot-status">{{ status }}</div>
      </Transition>
      <div class="ft-boot-bar"><i :style="{ width: progressPct + '%' }"></i></div>
    </div>
  </Transition>
</template>

<style>
/* Unscoped so the keyframes + selectors stay consistent with the static splash;
   selectors are namespaced under .ft-boot-overlay so collisions are impossible. */
.ft-boot-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  background: #0a1622;
  color: rgba(255, 255, 255, 0.92);
  z-index: 9999;
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    Helvetica,
    Arial,
    sans-serif;
}
@media (prefers-color-scheme: light) {
  .ft-boot-overlay {
    background: #f8fafc;
    color: rgba(15, 23, 42, 0.92);
  }
}
.ft-boot-overlay .ft-boot-ring {
  position: relative;
  width: 88px;
  height: 88px;
}
.ft-boot-overlay .ft-boot-ring::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    rgba(0, 137, 161, 0) 0%,
    rgba(0, 137, 161, 0) 30%,
    rgba(0, 137, 161, 0.85) 70%,
    rgba(0, 137, 161, 1) 100%
  );
  -webkit-mask: radial-gradient(circle, transparent 32px, black 33px);
  mask: radial-gradient(circle, transparent 32px, black 33px);
  animation: ft-boot-spin 3.6s linear infinite;
}
.ft-boot-overlay .ft-boot-dot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 50%;
  background: #0089a1;
  box-shadow: 0 0 20px rgba(0, 137, 161, 0.6);
  animation: ft-boot-pulse 1.6s ease-in-out infinite;
}
.ft-boot-overlay .ft-boot-wordmark {
  font-size: 28px;
  font-weight: 300;
  letter-spacing: 0.05em;
}
.ft-boot-overlay .ft-boot-wordmark > b {
  color: #0089a1;
  font-weight: 500;
}
.ft-boot-overlay .ft-boot-status {
  font-size: 14px;
  opacity: 0.7;
  min-height: 20px;
  text-align: center;
}
.ft-boot-overlay .ft-boot-bar {
  width: 200px;
  height: 2px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 1px;
  overflow: hidden;
}
@media (prefers-color-scheme: light) {
  .ft-boot-overlay .ft-boot-bar {
    background: rgba(15, 23, 42, 0.08);
  }
}
.ft-boot-overlay .ft-boot-bar > i {
  display: block;
  height: 100%;
  background: #0089a1;
  transition: width 0.2s ease;
}
/* Exit fade — opacity only, GPU-friendly, pointer-events off to unblock the dashboard. */
.ft-boot-fade-leave-active {
  transition: opacity 0.35s ease-out;
  pointer-events: none;
}
.ft-boot-fade-leave-to {
  opacity: 0;
}
/* Status swap fade — quick + subtle so the message change reads but doesn't distract. */
.ft-boot-status-fade-enter-active,
.ft-boot-status-fade-leave-active {
  transition: opacity 0.18s ease;
}
.ft-boot-status-fade-enter-from,
.ft-boot-status-fade-leave-to {
  opacity: 0;
}

@keyframes ft-boot-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes ft-boot-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.85;
  }
  50% {
    transform: scale(1.12);
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ft-boot-overlay .ft-boot-ring::before,
  .ft-boot-overlay .ft-boot-dot {
    animation: none;
  }
  .ft-boot-fade-leave-active,
  .ft-boot-status-fade-enter-active,
  .ft-boot-status-fade-leave-active {
    transition: none;
  }
}
</style>
