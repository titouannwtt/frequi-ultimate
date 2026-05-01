<script setup lang="ts">
interface Drawdown {
  start: string;
  valley: string;
  end: string;
  depth_pct: number;
  decline_days?: number;
  recovery_days?: number;
  total_days?: number;
  active?: boolean;
}

const props = defineProps<{
  drawdowns: Drawdown[];
}>();

/**
 * Interpolate color from --sd-warning (shallow) to --sd-danger (deep).
 * Uses fixed Catppuccin fallback values for the gradient since CSS vars
 * cannot be interpolated programmatically without getComputedStyle.
 */
function depthColor(depth: number): string {
  const maxDepth = props.drawdowns.length
    ? Math.max(...props.drawdowns.map((d) => Math.abs(d.depth_pct)))
    : 1;
  const ratio = Math.min(Math.abs(depth) / maxDepth, 1);
  // warning #f9e2af -> danger #f38ba8
  const r = Math.round(249 + (243 - 249) * ratio);
  const g = Math.round(226 + (139 - 226) * ratio);
  const b = Math.round(175 + (168 - 175) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

function fmtDate(d: string): string {
  if (!d) return '\u2014';
  return d.slice(0, 10);
}

function fmtDays(d: number | undefined): string {
  if (d == null) return '\u2014';
  return `${d}d`;
}
</script>

<template>
  <div class="dd-details-card">
    <div class="dd-table-wrap">
      <table class="dd-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Depth</th>
            <th>Start</th>
            <th>Valley</th>
            <th>End</th>
            <th>Decline</th>
            <th>Recovery</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(dd, i) in drawdowns.slice(0, 5)" :key="i">
            <td class="dd-rank">{{ i + 1 }}</td>
            <td class="dd-depth" :style="{ color: depthColor(dd.depth_pct) }">
              {{ dd.depth_pct.toFixed(2) }}%
            </td>
            <td class="dd-date">{{ fmtDate(dd.start) }}</td>
            <td class="dd-date">{{ fmtDate(dd.valley) }}</td>
            <td class="dd-date">{{ dd.active ? '\u2014' : fmtDate(dd.end) }}</td>
            <td class="dd-days">{{ fmtDays(dd.decline_days) }}</td>
            <td class="dd-days">
              <span v-if="dd.active" class="dd-active-badge">Active</span>
              <template v-else>{{ fmtDays(dd.recovery_days) }}</template>
            </td>
            <td class="dd-days">{{ dd.active ? '\u2014' : fmtDays(dd.total_days) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.dd-details-card {
  background: var(--sd-surface0, #313244);
  border: 1px solid var(--sd-border-subtle, #45475a);
  border-radius: var(--sd-radius-md, 8px);
  overflow: hidden;
}

.dd-table-wrap {
  overflow-x: auto;
}

.dd-table {
  width: 100%;
  border-collapse: collapse;
}

.dd-table thead tr {
  border-bottom: 1px solid var(--sd-border-subtle, #45475a);
}

.dd-table th {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--sd-overlay, #45475a);
  padding: 8px 12px;
  text-align: left;
  white-space: nowrap;
}

.dd-table th:nth-child(n + 2) {
  text-align: right;
}

.dd-table tbody tr {
  border-bottom: 1px solid var(--sd-border-subtle, #45475a);
  transition: background var(--sd-transition-fast, 0.15s);
}

.dd-table tbody tr:last-child {
  border-bottom: none;
}

.dd-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.03);
}

.dd-table td {
  padding: 8px 12px;
  font-size: var(--sd-text-sm, 13px);
  color: var(--sd-text, #cdd6f4);
  text-align: right;
  white-space: nowrap;
}

.dd-rank {
  text-align: left !important;
  font-weight: 600;
  color: var(--sd-subtext, #a6adc8);
}

.dd-depth {
  font-family: var(--sd-font-mono, monospace);
  font-weight: 700;
}

.dd-date {
  font-family: var(--sd-font-mono, monospace);
  color: var(--sd-subtext, #a6adc8) !important;
  font-size: var(--sd-text-xs, 11px);
}

.dd-days {
  font-family: var(--sd-font-mono, monospace);
  font-variant-numeric: tabular-nums;
}

.dd-active-badge {
  display: inline-block;
  background: var(--sd-warning, #f9e2af);
  color: #1e1e2e;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 8px;
  border-radius: 9999px;
  line-height: 1.6;
}
</style>
