<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { RunType } from '@/types';

const { t } = useI18n();
const store = useStrategyDevStore();

const typeOptions = [
  { label: t('strategyDev.allTypes'), value: null },
  { label: t('strategyDev.backtest'), value: RunType.backtest },
  { label: t('strategyDev.hyperopt'), value: RunType.hyperopt },
  { label: t('strategyDev.wfa'), value: RunType.wfa },
];

const strategyOptions = computed(() => [
  { label: t('strategyDev.allStrategies'), value: null },
  ...store.strategies.map((s) => ({ label: s, value: s })),
]);

const dateRangeOptions = [
  { label: t('strategyDev.dateAll'), value: null },
  { label: t('strategyDev.date24h'), value: 86400 },
  { label: t('strategyDev.date48h'), value: 172800 },
  { label: t('strategyDev.date7d'), value: 604800 },
  { label: t('strategyDev.date14d'), value: 1209600 },
  { label: t('strategyDev.date30d'), value: 2592000 },
  { label: t('strategyDev.date3m'), value: 7776000 },
  { label: t('strategyDev.date6m'), value: 15552000 },
  { label: t('strategyDev.date1y'), value: 31536000 },
];

const sortOptions = computed(() => [
  { label: t('strategyDev.sortDate'), value: 'date' as const, icon: 'i-mdi-sort-calendar-descending' },
  { label: t('strategyDev.sortProfit'), value: 'profit' as const, icon: 'i-mdi-trending-up' },
  { label: t('strategyDev.sortLoss'), value: 'loss' as const, icon: 'i-mdi-target' },
  { label: t('strategyDev.sortGrade'), value: 'grade' as const, icon: 'i-mdi-school' },
]);

const groupOptions = [
  { label: t('strategyDev.groupByType'), value: 'type' as const },
  { label: t('strategyDev.groupByStrategy'), value: 'strategy' as const },
];

function clearSearch() {
  store.filterText = '';
}
</script>

<template>
  <div class="sd-sidebar-content">
    <!-- Search with clear button -->
    <div class="sd-search-wrapper">
      <i-mdi-magnify class="sd-search-icon" />
      <input
        v-model="store.filterText"
        class="sd-search-input"
        :placeholder="`${t('strategyDev.search')} (Ctrl+K)`"
      />
      <button
        v-if="store.filterText"
        class="sd-search-clear"
        @click="clearSearch"
      >
        <i-mdi-close class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Filters row -->
    <div class="sd-filters">
      <SelectButton
        v-model="store.filterType"
        :options="typeOptions"
        option-label="label"
        option-value="value"
        size="small"
        class="w-full flex-wrap"
      />

      <Select
        v-model="store.filterStrategy"
        :options="strategyOptions"
        option-label="label"
        option-value="value"
        size="small"
        class="w-full"
        :placeholder="t('strategyDev.filterByStrategy')"
      />

      <Select
        v-model="store.filterDateRange"
        :options="dateRangeOptions"
        option-label="label"
        option-value="value"
        size="small"
        class="w-full"
        :placeholder="t('strategyDev.filterByDate')"
      />
    </div>

    <!-- Sort & group controls -->
    <div class="sd-sort-row">
      <div class="sd-sort-buttons">
        <button
          v-for="opt in sortOptions"
          :key="opt.value"
          class="sd-sort-btn"
          :class="{ 'sd-sort-btn--active': store.sortBy === opt.value }"
          :title="t('strategyDev.sortBy', { metric: opt.label })"
          @click="store.setSortBy(opt.value)"
        >
          {{ opt.label }}
        </button>
        <button
          class="sd-sort-btn sd-fav-filter-btn"
          :class="{ 'sd-sort-btn--active': store.filterFavoritesOnly }"
          :title="t('strategyDev.favoritesOnly')"
          @click="store.filterFavoritesOnly = !store.filterFavoritesOnly"
        >
          <i-mdi-star class="w-3 h-3" />
        </button>
      </div>
      <div class="sd-group-toggle">
        <button
          v-for="opt in groupOptions"
          :key="opt.value"
          class="sd-group-btn"
          :class="{ 'sd-group-btn--active': store.groupBy === opt.value }"
          @click="store.setGroupBy(opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- Pinned favorites -->
    <div v-if="store.favoriteRuns.length && !store.filterText" class="sd-favorites">
      <div class="sd-favorites-header">
        <i-mdi-star class="w-3 h-3" style="color: var(--sd-yellow)" />
        <span>{{ t('strategyDev.favorites') }}</span>
      </div>
      <RunTreeItem
        v-for="run in store.favoriteRuns"
        :key="'fav-' + run.filename"
        :run="run"
        :selected="store.selectedRun?.filename === run.filename && store.selectedRun?.run_type === run.run_type"
        @click="store.selectRun(run)"
      />
    </div>

    <!-- Divider -->
    <div class="sd-divider" />

    <!-- Run list -->
    <div v-if="store.loading && !store.filteredRuns.length && !store.loadingTypes.size" class="sd-center-state">
      <div class="sd-loading-spinner sd-loading-spinner--sm" />
      <p>{{ t('strategyDev.loading') }}</p>
    </div>

    <div v-else-if="!store.loading && store.filteredRuns.length === 0 && !store.loadingTypes.size" class="sd-center-state">
      <p>{{ t('strategyDev.noRuns') }}</p>
    </div>

    <RunTreeList v-else :runs="store.filteredRuns" :loading-types="store.loadingTypes" />
  </div>
</template>

<style scoped>
.sd-sidebar-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 8px 8px;
  overflow-y: auto;
  overflow-x: hidden;
  height: calc(100vh - 120px);
}

/* ── Search ── */
.sd-search-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.sd-search-icon {
  position: absolute;
  left: 8px;
  width: 14px;
  height: 14px;
  color: var(--sd-overlay);
  pointer-events: none;
}

.sd-search-input {
  width: 100%;
  padding: 6px 28px 6px 28px;
  font-size: var(--sd-text-xs);
  background: var(--sd-surface0);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-md);
  color: var(--sd-text);
  outline: none;
  transition: border-color var(--sd-transition-fast);
}

.sd-search-input:focus {
  border-color: var(--sd-info);
}

.sd-search-input::placeholder {
  color: var(--sd-overlay);
}

.sd-search-clear {
  position: absolute;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--sd-overlay);
  cursor: pointer;
  border-radius: var(--sd-radius-sm);
  transition: all var(--sd-transition-fast);
}

.sd-search-clear:hover {
  background: var(--sd-surface1);
  color: var(--sd-text);
}

/* ── Filters ── */
.sd-filters {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Sort & group ── */
.sd-sort-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sd-sort-buttons {
  display: flex;
  gap: 2px;
  background: var(--sd-surface0);
  border-radius: var(--sd-radius-sm);
  padding: 2px;
}

.sd-sort-btn {
  flex: 1;
  padding: 3px 0;
  font-size: 9px;
  font-weight: 500;
  text-align: center;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--sd-overlay);
  cursor: pointer;
  transition: all var(--sd-transition-fast);
}

.sd-sort-btn:hover {
  color: var(--sd-subtext);
}

.sd-sort-btn--active {
  background: var(--sd-info-dim);
  color: var(--sd-info);
  font-weight: 600;
}

.sd-fav-filter-btn {
  flex: 0;
  padding: 3px 6px;
}

.sd-fav-filter-btn.sd-sort-btn--active {
  background: rgba(249, 226, 175, 0.15);
  color: var(--sd-yellow);
}

.sd-group-toggle {
  display: flex;
  gap: 2px;
  background: var(--sd-surface0);
  border-radius: var(--sd-radius-sm);
  padding: 2px;
}

.sd-group-btn {
  flex: 1;
  padding: 3px 0;
  font-size: 9px;
  font-weight: 500;
  text-align: center;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--sd-overlay);
  cursor: pointer;
  transition: all var(--sd-transition-fast);
}

.sd-group-btn:hover {
  color: var(--sd-subtext);
}

.sd-group-btn--active {
  background: var(--sd-info-dim);
  color: var(--sd-info);
  font-weight: 600;
}

/* ── Favorites ── */
.sd-favorites {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 4px;
}

.sd-favorites-header {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--sd-overlay);
  padding: 4px 4px 2px;
}

/* ── Divider ── */
.sd-divider {
  height: 1px;
  background: var(--sd-border-subtle);
  margin: 2px 0;
}

/* ── Center states ── */
.sd-center-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 0;
  font-size: var(--sd-text-xs);
  color: var(--sd-overlay);
}

.sd-loading-spinner--sm {
  width: 24px;
  height: 24px;
  border: 2px solid var(--sd-surface1);
  border-top-color: var(--sd-info);
  border-radius: 50%;
  animation: sd-spin 800ms linear infinite;
}
</style>
