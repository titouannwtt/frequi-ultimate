<script setup lang="ts">
const props = defineProps<{
  modelValue: string;
  availablePairs: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const botStore = useBotStore();
const popoverRef = ref();
const searchQuery = ref('');
const searchInputRef = ref<HTMLInputElement>();
const highlightIndex = ref(-1);

const filters = ref({
  openTrades: false,
  closedTrades: false,
  enterLong: false,
  exitLong: false,
  enterShort: false,
  exitShort: false,
});

const openTradePairs = computed(() => new Set(botStore.activeBot.openTrades.map((t) => t.pair)));

function timeframeToMs(tf: string): number {
  const m = tf.match(/^(\d+)([smhdwM])$/);
  if (!m) return 0;
  const n = parseInt(m[1]);
  const unit: Record<string, number> = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000,
    w: 604800000,
    M: 2592000000,
  };
  return n * (unit[m[2]] ?? 0);
}

const chartWindowMs = computed(() => {
  const tfMs = timeframeToMs(botStore.activeBot.timeframe);
  return tfMs > 0 ? tfMs * 500 : 24 * 3600000;
});

const chartCutoff = computed(() => Date.now() - chartWindowMs.value);

const closedInChartWindow = computed(() => {
  const cutoff = chartCutoff.value;
  return new Set(
    botStore.activeBot.closedTrades
      .filter((t) => t.close_timestamp && t.close_timestamp * 1000 > cutoff)
      .map((t) => t.pair),
  );
});

const closedOutsideChart = computed(() => {
  const cutoff = chartCutoff.value;
  const inWindow = closedInChartWindow.value;
  return new Set(
    botStore.activeBot.closedTrades
      .filter(
        (t) => t.close_timestamp && t.close_timestamp * 1000 <= cutoff && !inWindow.has(t.pair),
      )
      .map((t) => t.pair),
  );
});

const recentlyClosedPairs = computed(() => {
  return new Set([...closedInChartWindow.value, ...closedOutsideChart.value]);
});

const signalData = computed(() => botStore.activeBot.signalSummary);
const signalLoading = computed(() => botStore.activeBot.signalSummaryLoading);

const hasAnySignal = computed(() => {
  const data = signalData.value;
  const result = { enterLong: false, exitLong: false, enterShort: false, exitShort: false };
  for (const counts of Object.values(data)) {
    if (counts.enter_long > 0) result.enterLong = true;
    if (counts.exit_long > 0) result.exitLong = true;
    if (counts.enter_short > 0) result.enterShort = true;
    if (counts.exit_short > 0) result.exitShort = true;
  }
  return result;
});

const filteredPairs = computed(() => {
  let pairs = props.availablePairs;

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    pairs = pairs.filter((p) => p.toLowerCase().includes(q));
  }

  if (filters.value.openTrades) {
    pairs = pairs.filter((p) => openTradePairs.value.has(p));
  }
  if (filters.value.closedTrades) {
    pairs = pairs.filter((p) => recentlyClosedPairs.value.has(p));
  }
  if (filters.value.enterLong) {
    pairs = pairs.filter((p) => (signalData.value[p]?.enter_long ?? 0) > 0);
  }
  if (filters.value.exitLong) {
    pairs = pairs.filter((p) => (signalData.value[p]?.exit_long ?? 0) > 0);
  }
  if (filters.value.enterShort) {
    pairs = pairs.filter((p) => (signalData.value[p]?.enter_short ?? 0) > 0);
  }
  if (filters.value.exitShort) {
    pairs = pairs.filter((p) => (signalData.value[p]?.exit_short ?? 0) > 0);
  }

  return pairs;
});

function toggleFilter(key: keyof typeof filters.value) {
  filters.value[key] = !filters.value[key];
}

function selectPair(pair: string) {
  emit('update:modelValue', pair);
  popoverRef.value?.hide();
}

function onPanelShow() {
  searchQuery.value = '';
  highlightIndex.value = -1;
  botStore.activeBot.getSignalSummary();
  nextTick(() => searchInputRef.value?.focus());
}

function onKeydown(e: KeyboardEvent) {
  const pairs = filteredPairs.value;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlightIndex.value = Math.min(highlightIndex.value + 1, pairs.length - 1);
    scrollToHighlighted();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightIndex.value = Math.max(highlightIndex.value - 1, 0);
    scrollToHighlighted();
  } else if (e.key === 'Enter' && highlightIndex.value >= 0) {
    e.preventDefault();
    selectPair(pairs[highlightIndex.value]);
  } else if (e.key === 'Escape') {
    popoverRef.value?.hide();
  }
}

function scrollToHighlighted() {
  nextTick(() => {
    const el = document.querySelector('.pair-item.highlighted');
    el?.scrollIntoView({ block: 'nearest' });
  });
}

watch(searchQuery, () => {
  highlightIndex.value = -1;
});

const hasActiveFilters = computed(() => Object.values(filters.value).some(Boolean));
</script>

<template>
  <div class="pair-selector-advanced">
    <!-- Trigger -->
    <button class="pair-trigger" @click="(e: Event) => popoverRef?.toggle(e)">
      <span v-if="openTradePairs.has(modelValue)" class="trigger-dot" />
      <span class="trigger-text">{{ modelValue || 'Select pair' }}</span>
      <i-mdi-chevron-down class="trigger-chevron" />
    </button>

    <!-- Panel -->
    <Popover ref="popoverRef" @show="onPanelShow">
      <div class="pair-panel" @keydown="onKeydown">
        <!-- Search -->
        <div class="pair-search">
          <i-mdi-magnify class="search-icon" />
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            class="search-input"
            placeholder="Search..."
            type="text"
          />
          <span class="pair-counter">{{ filteredPairs.length }}/{{ availablePairs.length }}</span>
        </div>

        <!-- Filters -->
        <div class="pair-filters">
          <button
            class="filter-pill"
            :class="{ active: filters.openTrades }"
            title="Open positions"
            @click="toggleFilter('openTrades')"
          >
            <i-mdi-swap-horizontal class="w-3 h-3" /> Open
          </button>
          <button
            class="filter-pill"
            :class="{ active: filters.closedTrades }"
            title="Recently closed (24h)"
            @click="toggleFilter('closedTrades')"
          >
            <i-mdi-check-circle-outline class="w-3 h-3" /> Closed
          </button>
          <div
            v-if="
              hasAnySignal.enterLong ||
              hasAnySignal.exitLong ||
              hasAnySignal.enterShort ||
              hasAnySignal.exitShort
            "
            class="filter-sep"
          />
          <button
            v-if="hasAnySignal.enterLong"
            class="filter-pill filter-el"
            :class="{ active: filters.enterLong }"
            title="Has enter long signals"
            @click="toggleFilter('enterLong')"
          >
            EL
          </button>
          <button
            v-if="hasAnySignal.exitLong"
            class="filter-pill filter-xl"
            :class="{ active: filters.exitLong }"
            title="Has exit long signals"
            @click="toggleFilter('exitLong')"
          >
            XL
          </button>
          <button
            v-if="hasAnySignal.enterShort"
            class="filter-pill filter-es"
            :class="{ active: filters.enterShort }"
            title="Has enter short signals"
            @click="toggleFilter('enterShort')"
          >
            ES
          </button>
          <button
            v-if="hasAnySignal.exitShort"
            class="filter-pill filter-xs"
            :class="{ active: filters.exitShort }"
            title="Has exit short signals"
            @click="toggleFilter('exitShort')"
          >
            XS
          </button>
          <button
            v-if="hasActiveFilters"
            class="filter-clear"
            title="Clear all filters"
            @click="
              Object.keys(filters).forEach((k) => (filters[k as keyof typeof filters] = false))
            "
          >
            <i-mdi-close class="w-3 h-3" />
          </button>
        </div>

        <!-- List -->
        <div class="pair-list">
          <div v-if="filteredPairs.length === 0" class="pair-empty">No pairs match</div>
          <div
            v-for="(pair, idx) in filteredPairs"
            :key="pair"
            class="pair-item"
            :class="{ selected: pair === modelValue, highlighted: idx === highlightIndex }"
            @click="selectPair(pair)"
            @mouseenter="highlightIndex = idx"
          >
            <span class="pair-name">{{ pair.replace('/', ' / ') }}</span>

            <!-- Trade tags -->
            <span v-if="openTradePairs.has(pair)" class="tag tag-open">OPEN</span>
            <span v-else-if="closedInChartWindow.has(pair)" class="tag tag-closed">CLOSED</span>
            <span v-else-if="closedOutsideChart.has(pair)" class="tag tag-closed-old">CLOSED</span>

            <!-- Signal badges -->
            <div class="signal-badges">
              <template v-if="signalLoading && Object.keys(signalData).length === 0">
                <div class="skel-badge" />
                <div class="skel-badge" />
              </template>
              <template v-else-if="signalData[pair]">
                <span
                  v-if="hasAnySignal.enterLong && signalData[pair].enter_long"
                  class="badge badge-el"
                  >{{ signalData[pair].enter_long }}</span
                >
                <span
                  v-if="hasAnySignal.exitLong && signalData[pair].exit_long"
                  class="badge badge-xl"
                  >{{ signalData[pair].exit_long }}</span
                >
                <span
                  v-if="hasAnySignal.enterShort && signalData[pair].enter_short"
                  class="badge badge-es"
                  >{{ signalData[pair].enter_short }}</span
                >
                <span
                  v-if="hasAnySignal.exitShort && signalData[pair].exit_short"
                  class="badge badge-xs"
                  >{{ signalData[pair].exit_short }}</span
                >
              </template>
            </div>
          </div>
        </div>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.pair-selector-advanced {
  display: inline-flex;
  align-items: center;
}

/* ── Trigger button ── */
.pair-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.625rem;
  padding: 0 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.02);
  font-size: 0.75rem;
  font-weight: 500;
  color: #3a3530;
  cursor: pointer;
  transition: all 0.15s ease;
  min-width: 140px;
  max-width: 220px;
}
.ft-dark-theme .pair-trigger {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.85);
}
.pair-trigger:hover {
  border-color: rgba(99, 102, 241, 0.4);
  background: rgba(99, 102, 241, 0.05);
}

.trigger-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  flex-shrink: 0;
}

.trigger-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: left;
}

.trigger-chevron {
  width: 0.75rem;
  height: 0.75rem;
  opacity: 0.4;
  flex-shrink: 0;
}

/* ── Panel ── */
.pair-panel {
  width: 340px;
  max-height: 440px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Search ── */
.pair-search {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.625rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.ft-dark-theme .pair-search {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

.search-icon {
  width: 0.875rem;
  height: 0.875rem;
  opacity: 0.35;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 0.75rem;
  color: inherit;
}
.search-input::placeholder {
  color: rgba(0, 0, 0, 0.3);
}
.ft-dark-theme .search-input::placeholder {
  color: rgba(255, 255, 255, 0.25);
}

.pair-counter {
  font-size: 0.625rem;
  font-weight: 600;
  font-family: monospace;
  color: rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}
.ft-dark-theme .pair-counter {
  color: rgba(255, 255, 255, 0.25);
}

/* ── Filters ── */
.pair-filters {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.625rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-wrap: wrap;
}
.ft-dark-theme .pair-filters {
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

.filter-sep {
  width: 1px;
  height: 14px;
  background: rgba(0, 0, 0, 0.1);
  margin: 0 0.125rem;
}
.ft-dark-theme .filter-sep {
  background: rgba(255, 255, 255, 0.08);
}

.filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.175rem;
  padding: 0.125rem 0.375rem;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: transparent;
  font-size: 0.625rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.ft-dark-theme .filter-pill {
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.35);
}
.filter-pill:hover {
  border-color: rgba(0, 0, 0, 0.15);
  color: rgba(0, 0, 0, 0.6);
}
.ft-dark-theme .filter-pill:hover {
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
}

.filter-pill.active {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: rgb(99, 102, 241);
}
.ft-dark-theme .filter-pill.active {
  background: rgba(99, 102, 241, 0.15);
  border-color: rgba(99, 102, 241, 0.3);
  color: rgb(165, 180, 252);
}

.filter-pill.filter-el.active {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.3);
  color: #059669;
}
.ft-dark-theme .filter-pill.filter-el.active {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
}
.filter-pill.filter-xl.active {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: #dc2626;
}
.ft-dark-theme .filter-pill.filter-xl.active {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}
.filter-pill.filter-es.active {
  background: rgba(139, 92, 246, 0.1);
  border-color: rgba(139, 92, 246, 0.3);
  color: #7c3aed;
}
.ft-dark-theme .filter-pill.filter-es.active {
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
}
.filter-pill.filter-xs.active {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.3);
  color: #d97706;
}
.ft-dark-theme .filter-pill.filter-xs.active {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}

.filter-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: all 0.15s ease;
  margin-left: auto;
}
.ft-dark-theme .filter-clear {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.35);
}
.filter-clear:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

/* ── Pair list ── */
.pair-list {
  overflow-y: auto;
  max-height: 340px;
  scrollbar-width: thin;
}

.pair-empty {
  padding: 1.5rem;
  text-align: center;
  font-size: 0.75rem;
  color: rgba(0, 0, 0, 0.3);
}
.ft-dark-theme .pair-empty {
  color: rgba(255, 255, 255, 0.25);
}

.pair-item {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background 0.1s ease;
}
.pair-item:hover,
.pair-item.highlighted {
  background: rgba(0, 0, 0, 0.04);
}
.ft-dark-theme .pair-item:hover,
.ft-dark-theme .pair-item.highlighted {
  background: rgba(255, 255, 255, 0.06);
}
.pair-item.selected {
  background: rgba(99, 102, 241, 0.08);
}
.ft-dark-theme .pair-item.selected {
  background: rgba(99, 102, 241, 0.12);
}

.pair-name {
  font-weight: 500;
  flex-shrink: 0;
}

/* ── Tags ── */
.tag {
  font-size: 0.5625rem;
  font-weight: 700;
  padding: 0.0625rem 0.25rem;
  border-radius: 0.1875rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}
.tag-open {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}
.ft-dark-theme .tag-open {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
}
.tag-closed {
  background: rgba(245, 158, 11, 0.12);
  color: #d97706;
}
.ft-dark-theme .tag-closed {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
}
.tag-closed-old {
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.25);
}
.ft-dark-theme .tag-closed-old {
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.2);
}

/* ── Signal badges ── */
.signal-badges {
  display: flex;
  align-items: center;
  gap: 0.1875rem;
  margin-left: auto;
  flex-shrink: 0;
}

.badge {
  font-size: 0.5625rem;
  font-weight: 700;
  font-family: monospace;
  min-width: 16px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.1875rem;
  padding: 0 0.1875rem;
}
.badge-el {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}
.ft-dark-theme .badge-el {
  background: rgba(16, 185, 129, 0.18);
  color: #34d399;
}
.badge-xl {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
}
.ft-dark-theme .badge-xl {
  background: rgba(239, 68, 68, 0.18);
  color: #f87171;
}
.badge-es {
  background: rgba(139, 92, 246, 0.12);
  color: #7c3aed;
}
.ft-dark-theme .badge-es {
  background: rgba(139, 92, 246, 0.18);
  color: #a78bfa;
}
.badge-xs {
  background: rgba(245, 158, 11, 0.12);
  color: #d97706;
}
.ft-dark-theme .badge-xs {
  background: rgba(245, 158, 11, 0.18);
  color: #fbbf24;
}

/* ── Skeleton shimmer ── */
.skel-badge {
  width: 20px;
  height: 14px;
  border-radius: 0.1875rem;
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.04) 25%,
    rgba(0, 0, 0, 0.08) 50%,
    rgba(0, 0, 0, 0.04) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
.ft-dark-theme .skel-badge {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04) 25%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0.04) 75%
  );
  background-size: 200% 100%;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
