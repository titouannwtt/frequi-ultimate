<script setup lang="ts">
interface WinDeg {
  index: number;
  train_range: string;
  test_range: string;
  degradation: Record<string, number>;
  train_metrics: Record<string, number>;
  test_metrics: Record<string, number>;
}

defineProps<{ windows: WinDeg[] }>();

function degColor(val: number): string {
  if (val >= 0.8) return 'text-green-400';
  if (val >= 0.5) return 'text-amber-400';
  return 'text-red-400';
}

function fmtDeg(val: number | undefined): string {
  if (val == null) return '\u2014';
  return `${(val * 100).toFixed(0)}%`;
}
</script>

<template>
  <div class="bg-surface-50 dark:bg-surface-800 rounded-lg overflow-hidden">
    <h4 class="text-sm font-semibold p-3 pb-0">Degradation per Window</h4>
    <div class="overflow-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-900/50">
          <tr>
            <th class="text-left px-3 py-2 text-xs text-surface-400 uppercase">Window</th>
            <th class="text-right px-3 py-2 text-xs text-surface-400 uppercase">Train Profit</th>
            <th class="text-right px-3 py-2 text-xs text-surface-400 uppercase">Test Profit</th>
            <th class="text-right px-3 py-2 text-xs text-surface-400 uppercase">Deg. Profit</th>
            <th class="text-right px-3 py-2 text-xs text-surface-400 uppercase">Deg. Sharpe</th>
            <th class="text-right px-3 py-2 text-xs text-surface-400 uppercase">Deg. Calmar</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="w in windows"
            :key="w.index"
            class="border-t border-surface-700 hover:bg-surface-700/30"
          >
            <td class="px-3 py-2 font-mono text-xs">W{{ w.index }}</td>
            <td
              class="px-3 py-2 text-right tabular-nums"
              :class="
                (w.train_metrics?.profit_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
              "
            >
              {{ (w.train_metrics?.profit_pct ?? 0).toFixed(2) }}%
            </td>
            <td
              class="px-3 py-2 text-right tabular-nums"
              :class="
                (w.test_metrics?.profit_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
              "
            >
              {{ (w.test_metrics?.profit_pct ?? 0).toFixed(2) }}%
            </td>
            <td
              class="px-3 py-2 text-right tabular-nums"
              :class="degColor(w.degradation?.profit_pct ?? 0)"
            >
              {{ fmtDeg(w.degradation?.profit_pct) }}
            </td>
            <td
              class="px-3 py-2 text-right tabular-nums"
              :class="degColor(w.degradation?.sharpe ?? 0)"
            >
              {{ fmtDeg(w.degradation?.sharpe) }}
            </td>
            <td
              class="px-3 py-2 text-right tabular-nums"
              :class="degColor(w.degradation?.calmar ?? 0)"
            >
              {{ fmtDeg(w.degradation?.calmar) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
