<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  streaks: {
    max_consecutive_wins: number;
    max_consecutive_losses: number;
    wins: number;
    losses: number;
    draws: number;
    distribution?: {
      win_streaks: number[];
      loss_streaks: number[];
    };
  };
}>();

const totalTrades = computed(() => props.streaks.wins + props.streaks.losses + props.streaks.draws);

const winStreakHist = computed(() => {
  if (!props.streaks.distribution) return [];
  return _buildHist(props.streaks.distribution.win_streaks);
});

const lossStreakHist = computed(() => {
  if (!props.streaks.distribution) return [];
  return _buildHist(props.streaks.distribution.loss_streaks);
});

function _buildHist(streaks: number[]): { length: number; count: number }[] {
  if (!streaks.length) return [];
  const counts = new Map<number, number>();
  for (const s of streaks) {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([length, count]) => ({ length, count }));
}

function maxCount(hist: { length: number; count: number }[]): number {
  return Math.max(...hist.map((h) => h.count), 1);
}
</script>

<template>
  <div class="sk">
    <!-- Summary cards -->
    <div class="sk-summary">
      <div class="sk-stat">
        <span class="sk-stat-label">{{ t('strategyDev.skMaxWinStreak') }}</span>
        <span class="sk-stat-value sk-stat-win">{{ streaks.max_consecutive_wins }}</span>
      </div>
      <div class="sk-stat">
        <span class="sk-stat-label">{{ t('strategyDev.skMaxLossStreak') }}</span>
        <span class="sk-stat-value sk-stat-loss">{{ streaks.max_consecutive_losses }}</span>
      </div>
      <div class="sk-stat">
        <span class="sk-stat-label">{{ t('strategyDev.skWins') }}</span>
        <span class="sk-stat-value">{{ streaks.wins }}</span>
      </div>
      <div class="sk-stat">
        <span class="sk-stat-label">{{ t('strategyDev.skLosses') }}</span>
        <span class="sk-stat-value">{{ streaks.losses }}</span>
      </div>
      <div class="sk-stat">
        <span class="sk-stat-label">{{ t('strategyDev.skWinRate') }}</span>
        <span class="sk-stat-value">{{ totalTrades > 0 ? ((streaks.wins / totalTrades) * 100).toFixed(1) : 0 }}%</span>
      </div>
    </div>

    <!-- Streak distribution bars -->
    <div v-if="winStreakHist.length || lossStreakHist.length" class="sk-distributions">
      <div v-if="winStreakHist.length" class="sk-dist-section">
        <h5 class="sk-dist-title">{{ t('strategyDev.skWinStreakDist') }}</h5>
        <div class="sk-bars">
          <div
            v-for="h in winStreakHist"
            :key="'w' + h.length"
            class="sk-bar-row"
          >
            <span class="sk-bar-label">{{ h.length }}</span>
            <div class="sk-bar-track">
              <div
                class="sk-bar-fill sk-bar-win"
                :style="{ width: `${(h.count / maxCount(winStreakHist)) * 100}%` }"
              />
            </div>
            <span class="sk-bar-count">{{ h.count }}</span>
          </div>
        </div>
      </div>
      <div v-if="lossStreakHist.length" class="sk-dist-section">
        <h5 class="sk-dist-title">{{ t('strategyDev.skLossStreakDist') }}</h5>
        <div class="sk-bars">
          <div
            v-for="h in lossStreakHist"
            :key="'l' + h.length"
            class="sk-bar-row"
          >
            <span class="sk-bar-label">{{ h.length }}</span>
            <div class="sk-bar-track">
              <div
                class="sk-bar-fill sk-bar-loss"
                :style="{ width: `${(h.count / maxCount(lossStreakHist)) * 100}%` }"
              />
            </div>
            <span class="sk-bar-count">{{ h.count }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sk {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sk-summary {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
}

.sk-stat {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-md);
}

.sk-stat-label {
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--sd-overlay);
}

.sk-stat-value {
  font-size: var(--sd-text-lg);
  font-weight: 700;
  font-family: var(--sd-font-mono);
  margin-top: 2px;
  color: var(--sd-text);
}

.sk-stat-win { color: var(--sd-success); }
.sk-stat-loss { color: var(--sd-danger); }

.sk-distributions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.sk-dist-title {
  font-size: var(--sd-text-xs);
  font-weight: 600;
  color: var(--sd-subtext);
  margin: 0 0 8px;
}

.sk-bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sk-bar-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sk-bar-label {
  font-size: 10px;
  font-family: var(--sd-font-mono);
  color: var(--sd-overlay);
  width: 20px;
  text-align: right;
  flex-shrink: 0;
}

.sk-bar-track {
  flex: 1;
  height: 14px;
  background: var(--sd-surface0);
  border-radius: 3px;
  overflow: hidden;
}

.sk-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease;
}

.sk-bar-win { background: var(--sd-success); opacity: 0.7; }
.sk-bar-loss { background: var(--sd-danger); opacity: 0.7; }

.sk-bar-count {
  font-size: 10px;
  font-family: var(--sd-font-mono);
  color: var(--sd-subtext);
  width: 20px;
  flex-shrink: 0;
}
</style>
