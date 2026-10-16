import type { Component } from 'vue';
import type { DsIconName } from './icons';

export type { ColumnDef, SortDir, SortState } from './lib/table';
export type { LadderLineInput, LadderLineKind, LadderOrder, LadderOrderState } from './lib/ladder';

/** An icon given by Lucide name (see icons.ts) or as a component. */
export type DsIconRef = DsIconName | Component;

export type BtnVariant = 'secondary' | 'ghost' | 'primary' | 'danger-outline' | 'danger';
export type BtnSize = 'xs' | 'sm' | 'md' | 'lg';

export type BadgeKind =
  | 'live'
  | 'dry'
  | 'replay'
  | 'xyz'
  | 'orphan'
  | 'crit'
  | 'warn'
  | 'info'
  | 'neutral'
  | 'manual';

export type TradingMode = 'live' | 'dry' | 'replay';

export type BotState = 'online' | 'starting' | 'offline' | 'stopped' | 'auth_expired' | 'stale';

export type Side = 'long' | 'short' | 'both';

export type MeterTone = 'neutral' | 'ok' | 'warn' | 'crit' | 'info';

export interface SegmentOption<T extends string | number = string> {
  value: T;
  label: string;
  icon?: DsIconRef;
  count?: number;
  disabled?: boolean;
}

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  tone?: 'crit' | 'warn';
}

export interface BotRef {
  key: string;
  name: string;
  /** Short reason shown next to the name, for example "stale 4 min". */
  reason?: string;
}

export interface KpiMeter {
  value: number;
  max?: number;
  threshold?: number;
  tone?: MeterTone;
}

export interface FreshnessInfo {
  asOfMs: number;
  staleAfterMs: number;
  clockSkewMs?: number;
}

export type PaneState = 'ready' | 'loading' | 'empty' | 'error' | 'stale' | 'unavailable';

export interface MenuItem {
  id: string;
  /** `item` by default; `separator` and `heading` are not selectable. */
  kind?: 'item' | 'separator' | 'heading';
  label?: string;
  icon?: DsIconRef;
  shortcut?: string;
  /** Destructive items are isolated at the end of the menu, after a separator. */
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export type ToastKind = 'sent' | 'ok' | 'verify' | 'err';

export interface ToastAction {
  id: string;
  label: string;
}

export type BannerKind =
  | 'cache'
  | 'connecting'
  | 'degraded'
  | 'direct'
  | 'offline'
  | 'auth'
  | 'starting'
  | 'stopped';

export type ConnectionKind = 'gateway' | 'direct';
export type ConnectionState = 'connecting' | 'live' | 'degraded' | 'offline';

export type HealthLevel = 'ok' | 'degraded' | 'crit';
export type Density = 'airy' | 'compact';

export interface TabBarItem {
  id: string;
  label: string;
  icon: DsIconRef;
  /** Notification count shown as a badge. */
  count?: number;
}

export type SkeletonShape = 'line' | 'kpi' | 'row';
