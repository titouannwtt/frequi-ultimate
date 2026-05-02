<script setup lang="ts">
defineProps<{ message?: string }>();
</script>
<template>
  <div class="chart-empty">
    <i-mdi-chart-line-variant class="w-8 h-8 opacity-30" />
    <p>{{ message || 'Données insuffisantes pour ce graphique' }}</p>
  </div>
</template>
<style scoped>
.chart-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 20px;
  color: #6c7086;
  font-size: 13px;
  text-align: center;
  background: rgba(30, 30, 46, 0.3);
  border-radius: 8px;
  border: 1px dashed rgba(69, 71, 90, 0.3);
}
</style>
