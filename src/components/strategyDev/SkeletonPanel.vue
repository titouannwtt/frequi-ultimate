<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'cards' | 'chart' | 'table' | 'text';
    rows?: number;
    cols?: number;
  }>(),
  { variant: 'cards', rows: 3, cols: 4 },
);
</script>

<template>
  <!-- Card grid skeleton -->
  <div v-if="variant === 'cards'" class="sk-grid" :style="{ '--sk-cols': cols }">
    <div v-for="i in cols" :key="i" class="sk-card">
      <div class="sd-skeleton sk-line sk-line--short" />
      <div class="sd-skeleton sk-line sk-line--value" />
      <div class="sd-skeleton sk-line sk-line--full" />
    </div>
  </div>

  <!-- Chart skeleton -->
  <div v-else-if="variant === 'chart'" class="sk-chart">
    <div class="sd-skeleton sk-chart-title" />
    <div class="sd-skeleton sk-chart-area" />
  </div>

  <!-- Table skeleton -->
  <div v-else-if="variant === 'table'" class="sk-table">
    <div class="sk-table-header">
      <div v-for="c in cols" :key="c" class="sd-skeleton sk-th" />
    </div>
    <div v-for="r in rows" :key="r" class="sk-table-row">
      <div v-for="c in cols" :key="c" class="sd-skeleton sk-td" />
    </div>
  </div>

  <!-- Text block skeleton -->
  <div v-else class="sk-text">
    <div v-for="r in rows" :key="r" class="sd-skeleton sk-line" :style="{ width: `${60 + Math.random() * 40}%` }" />
  </div>
</template>

<style scoped>
.sk-grid {
  display: grid;
  grid-template-columns: repeat(var(--sk-cols), 1fr);
  gap: 12px;
}

.sk-card {
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-lg);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sk-line {
  height: 12px;
  border-radius: 4px;
}
.sk-line--short { width: 40%; }
.sk-line--value { width: 60%; height: 20px; }
.sk-line--full { width: 100%; }

.sk-chart {
  background: var(--sd-base);
  border: 1px solid var(--sd-border-subtle);
  border-radius: var(--sd-radius-lg);
  padding: 16px;
}

.sk-chart-title {
  width: 30%;
  height: 14px;
  margin-bottom: 16px;
  border-radius: 4px;
}

.sk-chart-area {
  width: 100%;
  height: 280px;
  border-radius: var(--sd-radius-md);
}

.sk-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sk-table-header, .sk-table-row {
  display: flex;
  gap: 8px;
}

.sk-th {
  flex: 1;
  height: 14px;
  border-radius: 4px;
}

.sk-td {
  flex: 1;
  height: 12px;
  border-radius: 4px;
}

.sk-text {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

@media (max-width: 768px) {
  .sk-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
