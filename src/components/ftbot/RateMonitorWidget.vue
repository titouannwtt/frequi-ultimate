<script setup lang="ts">
import ECharts from 'vue-echarts';
import type { EChartsOption } from 'echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { GaugeChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { useI18n } from 'vue-i18n';
import { useDaemonHealth } from '@/composables/useDaemonHealth';
import { usePopoverHover, trackMouse } from '@/composables/usePopoverHover';
import type { MethodStats } from '@/types';
import Popover from 'primevue/popover';

use([GaugeChart, BarChart, CanvasRenderer, GridComponent, TooltipComponent]);

const { t } = useI18n();
const settingsStore = useSettingsStore();
const { state, healthLevel, secondsSinceRefresh } = useDaemonHealth({ refreshMs: 15_000 });

const {
  popoverRef: methodPopoverRef,
  hoveredValue: hoveredMethod,
  startHover: startMethodHover,
  cancelHover: cancelMethodHover,
  keepPopover: keepMethodPopover,
  hide: hideMethodPopover,
} = usePopoverHover<{ name: string; stats: MethodStats }>(300);

const current = computed(() => state.rate?.current);
const ftcache = computed(() => state.rate?.ftcache_extended ?? state.cache?.ftcache);
const ftpairlist = computed(() => state.rate?.ftpairlist);
const summary = computed(() => state.rate?.summary);
const exchangeLimit = computed(() => state.rate?.exchange_rate_limit);
const recent429s = computed(() => state.rate?.recent_429s ?? []);

const tokenPct = computed(() => {
  const c = current.value;
  if (!c?.tokens_max) return 100;
  return Math.round((c.tokens_available / c.tokens_max) * 100);
});

const cacheHitPct = computed(() => (ftcache.value as any)?.cache_hit_rate_pct ?? (ftcache.value as any)?.hit_rate_pct ?? 0);
const tickersHitPct = computed(() => (ftcache.value as any)?.tickers_hit_rate_pct ?? 0);
const positionsHitPct = computed(() => (ftcache.value as any)?.positions_hit_rate_pct ?? 0);

function bucketColor(pct: number): string {
  if (pct > 60) return '#22c55e';
  if (pct > 30) return '#f59e0b';
  return '#ef4444';
}

function hitColor(pct: number): string {
  if (pct >= 80) return '#22c55e';
  if (pct >= 50) return '#f59e0b';
  return '#ef4444';
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

function formatNum(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const gaugeOption = computed((): EChartsOption => {
  const pct = tokenPct.value;
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: { show: false },
    series: [{
      type: 'gauge',
      startAngle: 220,
      endAngle: -40,
      min: 0,
      max: 100,
      radius: '100%',
      center: ['50%', '60%'],
      progress: {
        show: true,
        width: 14,
        roundCap: true,
        itemStyle: { color: bucketColor(pct) },
      },
      axisLine: { lineStyle: { width: 14, color: [[1, '#1e293b']] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      pointer: { show: false },
      title: { show: false },
      detail: {
        valueAnimation: true,
        fontSize: 20,
        fontWeight: 'bold',
        color: bucketColor(pct),
        offsetCenter: [0, '0%'],
        formatter: '{value}%',
      },
      data: [{ value: pct }],
    }],
  };
});

const hitBarsOption = computed((): EChartsOption => {
  const categories = ['OHLCV', 'Tickers', 'Positions'];
  const values = [cacheHitPct.value, tickersHitPct.value, positionsHitPct.value];
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    tooltip: { show: false },
    grid: { left: 60, right: 40, top: 2, bottom: 2 },
    xAxis: { type: 'value', max: 100, show: false },
    yAxis: {
      type: 'category',
      data: categories,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: '#94a3b8' },
    },
    series: [{
      type: 'bar',
      data: values.map((v) => ({
        value: v,
        itemStyle: { color: hitColor(v), borderRadius: [0, 4, 4, 0] },
      })),
      barWidth: 12,
      label: {
        show: true,
        position: 'right',
        formatter: '{c}%',
        fontSize: 10,
        color: '#94a3b8',
      },
    }],
  };
});

const sortedMethods = computed(() => {
  const methods = summary.value?.by_method as Record<string, MethodStats> | undefined;
  if (!methods) return [];
  return Object.entries(methods)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);
});

function cacheRatio(stats: MethodStats): string {
  if (stats.count === 0) return '—';
  return `${Math.round((stats.cached / stats.count) * 100)}%`;
}

const refreshProgress = computed(() => Math.min(100, (secondsSinceRefresh.value / 15) * 100));
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden" @mousemove="trackMouse">
    <!-- Refresh progress bar -->
    <div class="h-0.5 w-full bg-surface-800 shrink-0">
      <div
        class="h-full transition-all duration-1000 ease-linear"
        :style="{ width: `${refreshProgress}%`, backgroundColor: bucketColor(tokenPct) }"
      />
    </div>

    <div class="flex flex-col gap-2 p-2 overflow-auto grow">
      <!-- Skeleton loading -->
      <template v-if="state.loading && !state.rate && !state.cache">
        <div class="flex gap-3 items-center">
          <div class="w-[130px] h-[110px] bg-surface-800 rounded animate-pulse" />
          <div class="grow space-y-2">
            <div class="h-5 w-full bg-surface-800 rounded animate-pulse" />
            <div class="h-5 w-3/4 bg-surface-800 rounded animate-pulse" />
            <div class="h-5 w-1/2 bg-surface-800 rounded animate-pulse" />
          </div>
        </div>
      </template>

      <template v-else>
        <!-- Top row: gauge + alerts + stats -->
        <div class="flex gap-3">
          <!-- Token bucket gauge -->
          <div class="flex flex-col items-center shrink-0" style="min-width: 130px">
            <span class="text-[10px] text-surface-500 mb-0.5">
              {{ t('rateMonitor.rateBudget') }}
            </span>
            <ECharts
              :option="gaugeOption"
              :theme="settingsStore.chartTheme"
              autoresize
              style="width: 130px; height: 110px"
            />
            <span v-if="current?.tokens_max" class="text-[10px] text-surface-500 font-mono -mt-1">
              {{ current.tokens_available.toFixed(0) }} / {{ current.tokens_max }}
            </span>
          </div>

          <!-- Right side: alerts + stats -->
          <div class="flex flex-col gap-1.5 grow min-w-0">
            <!-- 429 alert -->
            <div
              v-if="recent429s.length > 0"
              class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/10 text-red-400 text-xs border border-red-500/20"
            >
              <i-mdi-alert-circle class="w-3.5 h-3.5 shrink-0" />
              <span class="font-semibold">
                {{ recent429s.length }} {{ t('rateMonitor.429s') }}
              </span>
              <span class="text-[10px] text-red-400/70 ml-auto truncate">
                {{ recent429s[0]?.method ?? '' }}
              </span>
            </div>

            <!-- Backoff alert -->
            <div
              v-if="current?.backoff_active"
              class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 text-xs border border-amber-500/20"
            >
              <i-mdi-timer-sand class="w-3.5 h-3.5 animate-pulse shrink-0" />
              <span>
                BACKOFF {{ current.backoff_remaining_s?.toFixed(0) }}s
              </span>
              <span
                v-if="current.consecutive_backoffs > 1"
                class="ml-auto text-[10px] px-1.5 py-0 rounded-full bg-red-500/20 text-red-400 font-semibold"
              >
                L{{ current.consecutive_backoffs }}/4
              </span>
            </div>

            <!-- Shed/backoff counters (when not in active backoff) -->
            <div
              v-if="!current?.backoff_active && (current?.backoff_count ?? 0) > 0"
              class="flex items-center gap-3 text-[10px] text-surface-500"
            >
              <span v-if="(current?.backoff_count ?? 0) > 0">
                <i-mdi-shield-alert-outline class="w-3 h-3 inline text-amber-500" />
                {{ current?.backoff_count }} backoffs
              </span>
              <span v-if="(current?.shed_count ?? 0) > 0">
                <i-mdi-filter-remove-outline class="w-3 h-3 inline text-orange-400" />
                {{ formatNum(current?.shed_count ?? 0) }} shed
              </span>
            </div>

            <!-- Stats grid -->
            <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              <div class="flex items-center gap-1">
                <i-mdi-swap-horizontal class="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span class="text-surface-500">{{ t('rateMonitor.requests') }}</span>
                <span class="font-mono font-semibold ml-auto">{{ formatNum(summary?.total ?? 0) }}</span>
              </div>
              <div class="flex items-center gap-1">
                <i-mdi-alert-outline class="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span class="text-surface-500">{{ t('rateMonitor.errors') }}</span>
                <span
                  class="font-mono font-semibold ml-auto"
                  :class="(summary?.errors ?? 0) > 0 ? 'text-red-400' : ''"
                >
                  {{ summary?.errors ?? 0 }}
                </span>
              </div>
              <div class="flex items-center gap-1">
                <i-mdi-speedometer class="w-3.5 h-3.5 text-green-400 shrink-0" />
                <span class="text-surface-500">{{ t('rateMonitor.avgResponse') }}</span>
                <span class="font-mono font-semibold ml-auto">
                  {{ formatLatency(summary?.avg_latency_ms ?? 0) }}
                </span>
              </div>
              <div class="flex items-center gap-1">
                <i-mdi-tray-full class="w-3.5 h-3.5 text-purple-400 shrink-0" />
                <span class="text-surface-500">{{ t('rateMonitor.queue') }}</span>
                <span class="font-mono font-semibold ml-auto">
                  {{ Object.values(current?.queue_depths ?? {}).reduce((s, v) => s + v, 0) }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Cache hit rates -->
        <div>
          <span class="text-[10px] text-surface-500">{{ t('rateMonitor.cacheHitRates') }}</span>
          <ECharts
            :option="hitBarsOption"
            :theme="settingsStore.chartTheme"
            autoresize
            style="width: 100%; height: 60px"
          />
        </div>

        <!-- Exchange capacity bar -->
        <div v-if="exchangeLimit?.max_requests_per_min" class="text-xs">
          <div class="flex justify-between mb-0.5">
            <span class="text-surface-500 text-[10px]">{{ t('cacheHealth.exchangeCapacity') }}</span>
            <span
              class="font-mono text-[10px]"
              :style="{ color: (() => {
                const pct = Math.round(((summary?.direct ?? 0) / exchangeLimit.max_requests_per_min) * 100);
                return pct < 50 ? '#22c55e' : pct < 80 ? '#f59e0b' : '#ef4444';
              })() }"
            >
              {{ Math.round(((summary?.direct ?? 0) / exchangeLimit.max_requests_per_min) * 100) }}%
            </span>
          </div>
          <div class="w-full h-1.5 bg-surface-800 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :style="{
                width: `${Math.min(100, Math.round(((summary?.direct ?? 0) / exchangeLimit.max_requests_per_min) * 100))}%`,
                backgroundColor: (() => {
                  const pct = Math.round(((summary?.direct ?? 0) / exchangeLimit.max_requests_per_min) * 100);
                  return pct < 50 ? '#22c55e' : pct < 80 ? '#f59e0b' : '#ef4444';
                })(),
              }"
            />
          </div>
        </div>

        <!-- Method breakdown table -->
        <div v-if="sortedMethods.length > 0" class="text-xs">
          <span class="text-[10px] text-surface-500">{{ t('rateMonitor.topMethods') }}</span>
          <div class="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-2 gap-y-0 mt-0.5">
            <span class="text-surface-500 text-[10px] font-semibold">{{ t('rateMonitor.method') }}</span>
            <span class="text-surface-500 text-[10px] font-semibold text-right">#</span>
            <span class="text-surface-500 text-[10px] font-semibold text-right">cache</span>
            <span class="text-surface-500 text-[10px] font-semibold text-right">err</span>
            <span class="text-surface-500 text-[10px] font-semibold text-right">avg</span>

            <template v-for="[method, stats] in sortedMethods" :key="method">
              <span
                class="truncate max-w-[120px] py-px cursor-default hover:text-surface-200 transition-colors"
                @mouseenter="startMethodHover($event, { name: method, stats: stats as MethodStats })"
                @mouseleave="cancelMethodHover()"
              >
                <span
                  v-if="method.startsWith('pl:')"
                  class="text-[8px] font-bold px-0.5 rounded mr-0.5 bg-blue-500/15 text-blue-400"
                >PL</span>
                {{ method.startsWith('pl:') ? method.slice(3) : method }}
              </span>
              <span class="text-right font-mono py-px">{{ (stats as MethodStats).count }}</span>
              <span class="text-right font-mono py-px text-green-400">
                {{ cacheRatio(stats as MethodStats) }}
              </span>
              <span
                class="text-right font-mono py-px"
                :class="(stats as MethodStats).errors > 0 ? 'text-red-400' : 'text-surface-500'"
              >
                {{ (stats as MethodStats).errors }}
              </span>
              <span
                class="text-right font-mono py-px"
                :class="(stats as MethodStats).avg_latency_ms > 500 ? 'text-amber-400' : ''"
              >
                {{ formatLatency((stats as MethodStats).avg_latency_ms) }}
              </span>
            </template>
          </div>
        </div>
      </template>
    </div>

    <!-- Method popover -->
    <Popover ref="methodPopoverRef" :dismiss-able="false" class="!p-0" @mouseenter="keepMethodPopover" @mouseleave="hideMethodPopover">
      <div v-if="hoveredMethod" class="p-3 text-xs space-y-1.5 min-w-[200px]">
        <div class="font-semibold text-sm">{{ hoveredMethod.name }}</div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1">
          <div><span class="text-surface-500">Total calls</span></div>
          <div class="font-mono">{{ hoveredMethod.stats.count }}</div>
          <div><span class="text-surface-500">Cached</span></div>
          <div class="font-mono text-green-400">
            {{ hoveredMethod.stats.cached }}
            ({{ cacheRatio(hoveredMethod.stats) }})
          </div>
          <div><span class="text-surface-500">Direct</span></div>
          <div class="font-mono text-blue-400">{{ hoveredMethod.stats.direct }}</div>
          <div><span class="text-surface-500">Errors</span></div>
          <div class="font-mono" :class="hoveredMethod.stats.errors > 0 ? 'text-red-400' : ''">
            {{ hoveredMethod.stats.errors }}
          </div>
          <div><span class="text-surface-500">Avg latency</span></div>
          <div class="font-mono">{{ formatLatency(hoveredMethod.stats.avg_latency_ms) }}</div>
          <div><span class="text-surface-500">P95 latency</span></div>
          <div
            class="font-mono"
            :class="hoveredMethod.stats.p95_latency_ms > 500 ? 'text-amber-400' : ''"
          >
            {{ formatLatency(hoveredMethod.stats.p95_latency_ms) }}
          </div>
        </div>
        <div
          v-if="hoveredMethod.stats.p95_latency_ms > 1000"
          class="text-[10px] text-amber-400/80 border-t border-surface-700 pt-1"
        >
          ⚠ P95 latency > 1s — may indicate congestion or backoff
        </div>
        <div
          v-if="hoveredMethod.stats.errors > hoveredMethod.stats.count * 0.1"
          class="text-[10px] text-red-400/80 border-t border-surface-700 pt-1"
        >
          ⚠ Error rate > 10% — check exchange connectivity
        </div>
      </div>
    </Popover>
  </div>
</template>
