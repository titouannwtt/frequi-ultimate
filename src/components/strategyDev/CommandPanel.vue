<script setup lang="ts">
import { RunType } from '@/types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const store = useStrategyDevStore();

const run = computed(() => store.selectedRun);
const copied = ref(false);
const copiedSegment = ref<number | null>(null);
const hoveredSegment = ref<number | null>(null);

const savedCommand = computed<string | null>(() => {
  if (!run.value) return null;
  if (run.value.run_type === RunType.hyperopt && store.hyperoptDetail) {
    return (store.hyperoptDetail.command as string) ?? null;
  }
  if (run.value.run_type === RunType.wfa && store.wfaDetail) {
    return (store.wfaDetail.command as string) ?? null;
  }
  return null;
});

interface CmdSegment {
  flag: string;
  value: string;
  description: string;
  copyText: string;
}

const flagDescriptions: Record<string, string> = {
  '--strategy': 'Strategy class name to use',
  '--timeframe': 'Candlestick timeframe (e.g. 5m, 15m, 1h)',
  '--timerange': 'Date range for backtesting data',
  '--hyperopt-loss': 'Loss function for optimization scoring',
  '--epochs': 'Number of optimization iterations',
  '--spaces': 'Parameter spaces to optimize (buy, sell, roi, stoploss, trailing)',
  '--config': 'Configuration file path',
  '--wf-windows': 'Number of walk-forward windows',
  '--pairs': 'Trading pairs list',
  '--stake-amount': 'Amount to stake per trade',
  '--max-open-trades': 'Maximum concurrent open trades',
  '--dry-run-wallet': 'Starting wallet amount for simulation',
};

const segments = computed<CmdSegment[]>(() => {
  const d = run.value?.run_type === RunType.hyperopt ? store.hyperoptDetail : store.wfaDetail;
  if (!d) return [];
  const segs: CmdSegment[] = [];
  const cmdName = run.value?.run_type === RunType.hyperopt ? 'freqtrade hyperopt' : 'freqtrade walk-forward';
  segs.push({ flag: '', value: cmdName, description: 'Freqtrade command', copyText: cmdName });

  if (d.strategy) {
    segs.push({ flag: '--strategy', value: String(d.strategy), description: flagDescriptions['--strategy'], copyText: `--strategy ${d.strategy}` });
  }
  if (d.timeframe) {
    segs.push({ flag: '--timeframe', value: String(d.timeframe), description: flagDescriptions['--timeframe'], copyText: `--timeframe ${d.timeframe}` });
  }
  if (d.timerange) {
    segs.push({ flag: '--timerange', value: String(d.timerange), description: flagDescriptions['--timerange'], copyText: `--timerange ${d.timerange}` });
  }
  if (d.hyperopt_loss) {
    segs.push({ flag: '--hyperopt-loss', value: String(d.hyperopt_loss), description: flagDescriptions['--hyperopt-loss'], copyText: `--hyperopt-loss ${d.hyperopt_loss}` });
  }
  if (run.value?.run_type === RunType.hyperopt && d.epochs_total) {
    segs.push({ flag: '--epochs', value: String(d.epochs_total), description: flagDescriptions['--epochs'], copyText: `--epochs ${d.epochs_total}` });
  }
  if (run.value?.run_type === RunType.wfa) {
    if ((d as any).n_windows) {
      segs.push({ flag: '--wf-windows', value: String((d as any).n_windows), description: flagDescriptions['--wf-windows'], copyText: `--wf-windows ${(d as any).n_windows}` });
    }
    if ((d as any).epochs_per_window) {
      segs.push({ flag: '--epochs', value: String((d as any).epochs_per_window), description: flagDescriptions['--epochs'], copyText: `--epochs ${(d as any).epochs_per_window}` });
    }
  }
  const spaces = d.spaces as string[] | undefined;
  if (spaces?.length) {
    segs.push({ flag: '--spaces', value: spaces.join(' '), description: flagDescriptions['--spaces'], copyText: `--spaces ${spaces.join(' ')}` });
  }
  if (d.max_open_trades != null) {
    segs.push({ flag: '--max-open-trades', value: String(d.max_open_trades), description: flagDescriptions['--max-open-trades'], copyText: `--max-open-trades ${d.max_open_trades}` });
  }
  if (d.dry_run_wallet != null) {
    segs.push({ flag: '--dry-run-wallet', value: String(d.dry_run_wallet), description: flagDescriptions['--dry-run-wallet'], copyText: `--dry-run-wallet ${d.dry_run_wallet}` });
  }
  if (d.stake_amount != null) {
    segs.push({ flag: '--stake-amount', value: String(d.stake_amount), description: flagDescriptions['--stake-amount'], copyText: `--stake-amount ${d.stake_amount}` });
  }

  return segs;
});

const inferredCommand = computed<string | null>(() => {
  if (savedCommand.value) return null;
  if (segments.value.length === 0) return null;
  return segments.value.map((s) => s.copyText).join(' \\\n  ');
});

const hasSnapshot = computed(() => savedCommand.value !== null);
const monoLine = ref(false);

const displayCommand = computed(() => {
  const cmd = savedCommand.value || inferredCommand.value;
  if (!cmd) return null;
  if (monoLine.value) return cmd.replace(/\s*\\\n\s*/g, ' ');
  return cmd;
});

const fullCommandText = computed(() => {
  if (savedCommand.value) return savedCommand.value.replace(/\s*\\\n\s*/g, ' ');
  return segments.value.map((s) => s.copyText).join(' ');
});

async function copyCommand() {
  const text = fullCommandText.value;
  if (text) {
    try { await navigator.clipboard.writeText(text); }
    catch { /* fallback handled below */ }
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  }
}

async function copySegment(idx: number, text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch { /* silent */ }
  copiedSegment.value = idx;
  setTimeout(() => (copiedSegment.value = null), 1500);
}
</script>

<template>
  <div class="cmd-panel sd-panel-enter">
    <!-- Warning: no snapshot -->
    <div
      v-if="!hasSnapshot && (segments.length > 0 || displayCommand)"
      class="cmd-warning"
    >
      <i-mdi-alert class="w-4 h-4 cmd-warning-icon" />
      <div>
        <span class="cmd-warning-title">{{ t('strategyDev.noSnapshotWarningTitle') }}</span>
        <span class="cmd-warning-desc">{{ t('strategyDev.noSnapshotCommandDesc') }}</span>
      </div>
    </div>

    <div v-if="segments.length > 0 || displayCommand">
      <!-- Header -->
      <div class="cmd-header">
        <h4 class="cmd-title">
          {{ hasSnapshot ? t('strategyDev.commandSaved') : t('strategyDev.commandInferred') }}
        </h4>
        <div class="cmd-actions">
          <div class="cmd-toggle">
            <button
              class="cmd-toggle-btn"
              :class="{ active: !monoLine }"
              @click="monoLine = false"
            >
              <i-mdi-format-list-bulleted class="w-3 h-3" />
            </button>
            <button
              class="cmd-toggle-btn"
              :class="{ active: monoLine }"
              @click="monoLine = true"
            >
              <i-mdi-minus class="w-3 h-3" />
            </button>
          </div>
          <button class="cmd-copy-btn" :class="{ copied }" @click="copyCommand">
            <i-mdi-check v-if="copied" class="w-3.5 h-3.5" />
            <i-mdi-content-copy v-else class="w-3.5 h-3.5" />
            {{ copied ? t('strategyDev.cvCopied') : t('strategyDev.cvCopy') }}
          </button>
        </div>
      </div>

      <!-- Interactive segments view (when multi-line & segments available) -->
      <div v-if="!monoLine && segments.length > 0 && !savedCommand" class="cmd-terminal">
        <span class="cmd-prompt">$</span>
        <div class="cmd-segments">
          <div
            v-for="(seg, i) in segments"
            :key="i"
            class="cmd-segment"
            :class="{
              'cmd-segment--hovered': hoveredSegment === i,
              'cmd-segment--command': !seg.flag,
            }"
            @mouseenter="hoveredSegment = i"
            @mouseleave="hoveredSegment = null"
            @click="copySegment(i, seg.copyText)"
          >
            <span v-if="seg.flag" class="cmd-flag">{{ seg.flag }}</span>
            <span class="cmd-value">{{ seg.value }}</span>

            <!-- Tooltip -->
            <Transition name="cv-search">
              <div v-if="hoveredSegment === i" class="cmd-tooltip">
                <div class="cmd-tooltip-desc">{{ seg.description }}</div>
                <div class="cmd-tooltip-hint">
                  <i-mdi-content-copy class="w-2.5 h-2.5" />
                  {{ copiedSegment === i ? t('strategyDev.cvCopied') : t('strategyDev.cmdClickToCopy') }}
                </div>
              </div>
            </Transition>

            <!-- Line continuation -->
            <span v-if="i < segments.length - 1" class="cmd-continuation">\</span>
          </div>
        </div>
      </div>

      <!-- Plain text view (mono-line or saved command) -->
      <div v-else-if="displayCommand" class="cmd-terminal">
        <span class="cmd-prompt">$</span>
        <pre class="cmd-text">{{ displayCommand }}</pre>
      </div>
    </div>

    <div v-else class="cmd-empty">
      {{ t('strategyDev.noCommandAvailable') }}
    </div>
  </div>
</template>

<style scoped>
.cmd-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 0;
  max-width: 1600px;
  margin: 0 auto;
}

/* ── Warning ── */
.cmd-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--sd-radius-md);
  background: rgba(249, 226, 175, 0.06);
  border: 1px solid rgba(249, 226, 175, 0.15);
  font-size: var(--sd-text-xs);
}

.cmd-warning-icon {
  color: #f9e2af;
  flex-shrink: 0;
  margin-top: 1px;
}

.cmd-warning-title {
  font-weight: 600;
  color: #f9e2af;
  display: block;
}

.cmd-warning-desc {
  color: rgba(249, 226, 175, 0.7);
  display: block;
  margin-top: 2px;
}

/* ── Header ── */
.cmd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.cmd-title {
  font-size: var(--sd-text-sm);
  font-weight: 600;
  color: var(--sd-text);
  margin: 0;
}

.cmd-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cmd-toggle {
  display: flex;
  border: 1px solid #45475a;
  border-radius: 4px;
  overflow: hidden;
}

.cmd-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  background: transparent;
  border: none;
  color: #6c7086;
  cursor: pointer;
  transition: all 0.15s;
}
.cmd-toggle-btn:first-child { border-right: 1px solid #45475a; }
.cmd-toggle-btn.active {
  background: #313244;
  color: #cdd6f4;
}
.cmd-toggle-btn:hover:not(.active) {
  color: #a6adc8;
}

.cmd-copy-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid #45475a;
  background: transparent;
  color: #a6adc8;
  cursor: pointer;
  font-size: 10px;
  transition: all 0.15s;
}
.cmd-copy-btn:hover {
  background: #313244;
  color: #cdd6f4;
}
.cmd-copy-btn.copied {
  border-color: #a6e3a1;
  color: #a6e3a1;
}

/* ── Terminal block ── */
.cmd-terminal {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px 16px;
  border-radius: var(--sd-radius-md);
  border: 1px solid var(--sd-border-subtle);
  background: #1e1e2e;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  font-size: 13px;
  line-height: 1.6;
}

.cmd-prompt {
  color: #a6e3a1;
  font-weight: 700;
  user-select: none;
  flex-shrink: 0;
}

.cmd-text {
  color: #cdd6f4;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

/* ── Interactive segments ── */
.cmd-segments {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.cmd-segment {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 1px 4px;
  border-radius: 3px;
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
}

.cmd-segment:hover {
  background: rgba(137, 180, 250, 0.08);
}

.cmd-segment--command {
  color: #a6e3a1;
  font-weight: 600;
}

.cmd-flag {
  color: #89b4fa;
}

.cmd-value {
  color: #cdd6f4;
}

.cmd-continuation {
  color: #45475a;
  margin-left: 4px;
  user-select: none;
}

/* ── Tooltip ── */
.cmd-tooltip {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  padding: 6px 10px;
  background: #313244;
  border: 1px solid #45475a;
  border-radius: 6px;
  z-index: 20;
  min-width: 180px;
  max-width: 300px;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.cmd-tooltip-desc {
  font-size: 11px;
  color: #cdd6f4;
  line-height: 1.4;
}

.cmd-tooltip-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #6c7086;
  margin-top: 4px;
}

/* ── Empty ── */
.cmd-empty {
  color: var(--sd-subtext);
  font-size: var(--sd-text-sm);
  padding: 16px 0;
  text-align: center;
}

/* ── Transition reuse ── */
.cv-search-enter-active { transition: opacity 0.15s, transform 0.15s; }
.cv-search-leave-active { transition: opacity 0.1s; }
.cv-search-enter-from { opacity: 0; transform: translateY(-4px); }
.cv-search-leave-to { opacity: 0; }
</style>
