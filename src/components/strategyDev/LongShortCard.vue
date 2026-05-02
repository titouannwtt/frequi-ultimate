<script setup lang="ts">
interface SideStats {
  count: number;
  total_profit: number;
  avg_profit: number;
  wins: number;
  losses: number;
  winrate: number;
  avg_duration: number;
}

const props = defineProps<{
  split: {
    long: SideStats;
    short: SideStats;
  };
}>();

const totalCount = computed(() => props.split.long.count + props.split.short.count);
const longPct = computed(() => (totalCount.value > 0 ? (props.split.long.count / totalCount.value) * 100 : 50));

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes.toFixed(0)}m`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)}d`;
}

function profitColor(val: number): string {
  return val >= 0 ? 'var(--sd-success)' : 'var(--sd-danger)';
}

function winrateColor(val: number): string {
  if (val >= 0.6) return 'var(--sd-success)';
  if (val >= 0.45) return 'var(--sd-text)';
  return 'var(--sd-danger)';
}
</script>

<template>
  <div class="ls">
    <!-- Ratio bar -->
    <div class="ls-ratio-bar">
      <div
        class="ls-ratio-fill ls-ratio-long"
        :style="{ width: `${longPct}%` }"
      >
        <span v-if="longPct > 15" class="ls-ratio-label">
          Long {{ longPct.toFixed(0) }}%
        </span>
      </div>
      <div
        class="ls-ratio-fill ls-ratio-short"
        :style="{ width: `${100 - longPct}%` }"
      >
        <span v-if="100 - longPct > 15" class="ls-ratio-label">
          Short {{ (100 - longPct).toFixed(0) }}%
        </span>
      </div>
    </div>

    <!-- Two columns -->
    <div class="ls-columns">
      <div
        v-for="(side, key) in { Long: split.long, Short: split.short }"
        :key="key"
        class="ls-col"
      >
        <h5 class="ls-col-title">{{ key }}</h5>

        <div class="ls-row">
          <span class="ls-label">Trades</span>
          <span class="ls-value">{{ side.count }}</span>
        </div>
        <div class="ls-row">
          <span class="ls-label">Total Profit</span>
          <span class="ls-value" :style="{ color: profitColor(side.total_profit) }">
            {{ side.total_profit >= 0 ? '+' : '' }}{{ side.total_profit.toFixed(2) }}%
          </span>
        </div>
        <div class="ls-row">
          <span class="ls-label">Avg Profit</span>
          <span class="ls-value" :style="{ color: profitColor(side.avg_profit) }">
            {{ side.avg_profit >= 0 ? '+' : '' }}{{ side.avg_profit.toFixed(2) }}%
          </span>
        </div>
        <div class="ls-row">
          <span class="ls-label">Win Rate</span>
          <span class="ls-value" :style="{ color: winrateColor(side.winrate) }">
            {{ (side.winrate * 100).toFixed(1) }}%
          </span>
        </div>
        <div class="ls-row">
          <span class="ls-label">W / L</span>
          <span class="ls-value">{{ side.wins }} / {{ side.losses }}</span>
        </div>
        <div class="ls-row">
          <span class="ls-label">Avg Duration</span>
          <span class="ls-value">{{ formatDuration(side.avg_duration) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--sd-surface0, #313244);
  border: 1px solid var(--sd-border-subtle, rgba(69, 71, 90, 0.3));
  border-radius: var(--sd-radius-md, 0.5rem);
  padding: 12px;
}

.ls-ratio-bar {
  display: flex;
  height: 22px;
  border-radius: var(--sd-radius-md);
  overflow: hidden;
  border: 1px solid var(--sd-border-subtle);
}

.ls-ratio-fill {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: width 0.4s ease;
}

.ls-ratio-long {
  background: var(--sd-success);
  opacity: 0.7;
}

.ls-ratio-short {
  background: var(--sd-danger);
  opacity: 0.7;
}

.ls-ratio-label {
  font-size: var(--sd-text-xs);
  font-weight: 600;
  color: #1e1e2e;
  white-space: nowrap;
}

.ls-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.ls-col {
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-md);
  gap: 6px;
}

.ls-col-title {
  margin: 0 0 4px;
  font-size: var(--sd-text-sm);
  font-weight: 600;
  color: var(--sd-text);
}

.ls-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ls-label {
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sd-overlay);
}

.ls-value {
  font-size: var(--sd-text-sm);
  font-weight: 700;
  font-family: var(--sd-font-mono);
  color: var(--sd-text);
}
</style>
