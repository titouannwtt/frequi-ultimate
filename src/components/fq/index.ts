/**
 * FreqUI Ultimate 2 composites (docs/redesign/02-design.md, section 5.2), batches A and B. Import from here
 * (`@/components/fq`); like the design system primitives the folder is excluded from component
 * auto-registration. Composites read the data layer (stores, composables), never a bot API.
 */
export { default as ActionDialogHost } from './ActionDialogHost.vue';
export { default as AlertCenter } from './AlertCenter.vue';
export { default as AlertItem } from './AlertItem.vue';
export { default as AlertRail } from './AlertRail.vue';
export type { AlertTab } from './AlertRail.vue';
export { default as AppShell } from './AppShell.vue';
export type { ShellPage } from './AppShell.vue';
export { default as BotActionBar } from './BotActionBar.vue';
export { default as BotActionMenu } from './BotActionMenu.vue';
export { default as BotHeader } from './BotHeader.vue';
export { default as BotRegistry } from './BotRegistry.vue';
export { default as CandleChart } from './CandleChart.vue';
export { default as ChartCell } from './ChartCell.vue';
export { default as ClosedTradePanel } from './ClosedTradePanel.vue';
export { default as ClosedTradeSheet } from './ClosedTradeSheet.vue';
export { default as CommandPalette } from './CommandPalette.vue';
export type { PalettePage } from './CommandPalette.vue';
export { default as ConfirmDangerDialog } from './ConfirmDangerDialog.vue';
export { default as DcaDepthTable } from './DcaDepthTable.vue';
export { default as DistributionChart } from './DistributionChart.vue';
export { default as EquityCurve } from './EquityCurve.vue';
export { default as EventFeed } from './EventFeed.vue';
export { default as EventRow } from './EventRow.vue';
export { default as ExitReasonTable } from './ExitReasonTable.vue';
export { default as FleetAlerts } from './FleetAlerts.vue';
export { default as FleetKpis } from './FleetKpis.vue';
export { default as FleetMap } from './FleetMap.vue';
export { default as FleetScope } from './FleetScope.vue';
export { default as FleetTable } from './FleetTable.vue';
export { default as FleetVerdict } from './FleetVerdict.vue';
export { default as IndicatorsSheet } from './IndicatorsSheet.vue';
export { default as JournalFilterBar } from './JournalFilterBar.vue';
export { default as JournalTotals } from './JournalTotals.vue';
export { default as Leaderboard } from './Leaderboard.vue';
export { default as LogStream } from './LogStream.vue';
export { default as MaeMfeBar } from './MaeMfeBar.vue';
export { default as PairNavigator } from './PairNavigator.vue';
export { default as PairlistPanel } from './PairlistPanel.vue';
export { default as PnlCalendar } from './PnlCalendar.vue';
export { default as PositionCard } from './PositionCard.vue';
export { default as ReconciliationTable } from './ReconciliationTable.vue';
export { default as RiskPanel } from './RiskPanel.vue';
export { default as ScopePanel } from './ScopePanel.vue';
export { default as ShortcutHelp } from './ShortcutHelp.vue';
export { default as ShellSlot } from './ShellSlot.vue';
export { default as SinceLastVisit } from './SinceLastVisit.vue';
export { default as SystemHealth } from './SystemHealth.vue';
export { default as TradeChart } from './TradeChart.vue';
export { default as TradeChartFold } from './TradeChartFold.vue';
export { default as TradeDrawer } from './TradeDrawer.vue';
export { default as TradeTable } from './TradeTable.vue';
export { default as WatchList } from './WatchList.vue';
