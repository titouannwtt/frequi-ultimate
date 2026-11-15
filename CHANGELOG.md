# Changelog: frequi-ultimate

All notable changes to this fork are documented here. For the changelog of upstream FreqUI, see the [upstream releases](https://github.com/freqtrade/frequi/releases).

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each entry links to its GitHub release, which holds the full notes and the build to install.

> **About the version numbers.** The fork went from 0.9.0 to 2.0.0 with a full redesign (new interface and optional Rust gateway). That redesign was withdrawn on 2026-11-15. The number keeps increasing (2.2.0) so that the in-app update check and `freqtrade install-ui` prefer the current release, but 2.2.0 continues the 0.9.0 line, not the 2.x redesign.

## [2.2.0] - 2026-11-15

### Changed
- **Back to the classic dashboard.** The 2.0.0 and 2.1.0 redesign (new interface and optional Rust gateway) is withdrawn. FreqUI Ultimate is again the classic multi-bot dashboard, as it was before the redesign: the 0.9.0 code base plus the fixes made after it.
- The browser talks to each bot directly again; no gateway is needed.
- The version number keeps increasing so that the in-app update check and `freqtrade install-ui` prefer this release over 2.1.0. The redesign stays available under the `v2.0.0` and `v2.1.0` tags.

### Since 0.9.0
- Fleet dashboard performance: the fleet table, the profit curves and the periodic refreshes read one fleet snapshot instead of one request per bot; open trades are virtualised; dashboard charts no longer animate.
- Partial exits and position adjustments made from the multi-bot trade list are sent to the bot that owns the trade.
- One failed request no longer marks a bot offline.
- Profit benchmark: the latent curve is merged from zero, the checkboxes act at once, and the curve no longer reloads in waves.

### Documentation
- README, changelogs, `LLMS.txt` and `CONTRIBUTING.md` brought back in line with the classic dashboard: corrected install instructions, current fork figures, 14 alert types, honest translation coverage.
- README screenshots retaken on a synthetic demo fleet ([`scripts/demo-fleet`](scripts/demo-fleet)): no real account, trade or address appears in them.

## [2.1.0] - 2026-10-18 (withdrawn)

Second release of the redesign: full-width profit block with period and date-range selection, bot selection applied to the whole fleet view, chart for any open or closed trade. Withdrawn with 2.2.0. Kept as an archived pre-release.

## [2.0.0] - 2026-10-16 (withdrawn)

Full redesign of the interface with an optional Rust gateway (`frequi-gateway`) aggregating the fleet. Withdrawn with 2.2.0. Kept as an archived pre-release.

## [0.9.0] - 2026-08-04

### Added
- **Latent-profit curve** in *Profit and benchmarks*: current profit (closed plus open unrealized) sampled over time, with a signed filled band.
- **Three independent toggles**: realized profit, latent profit, drawdown. "Combined" was renamed *Realized profit*.
- **Period drawdown**, measured on the curves displayed, over the selected window.
- Richer hover: open-book value at that instant and distance from the running high.
- **Market column and tag** in *Bot comparison*, derived from each bot's whitelist: Crypto, XYZ Stocks, XYZ Indices, XYZ Commodities or Mixed.
- **Fit-to-screen toggle** on *Bot comparison*, *Open trades* and *Closed trades*.

### Fixed
- Percentages were wrong on a shared wallet (the base summed the whole exchange wallet for every bot).
- The zoom window of the bottom time slider no longer resets on every data tick.
- Selection semantics of empty or filtered groups in *Bot comparison*.
- The *All modes / Live / Dry* filter is persisted per widget and survives a reload.

## [0.8.0] - 2026-05-29

### Added
- **Dry Replay modal**: drive the dry-run replay harness of freqtrade-ultimate from the UI (per-bot action, dry-run bots only).
- **Boot splash** covering the delay before the first bot data arrives.

### Fixed
- Trade duration is floored at zero in the journal and in the duration chart.

## [0.7.5] - 2026-05-21

### Added
- **Per-bot configuration editor**: edit a bot's Freqtrade configuration from its menu in *Bot comparison* (categorized form, typed inputs, raw JSON view).
- **Max Drawdown column** (hidden by default): realized drawdown and drawdown including open positions.

## [0.7.0] - 2026-05-20

### Added
- **Current Profit column** (open plus closed profit) for bots, groups and the summary row.
- **Per-bot profit comparison widget**: bar chart of realized P&L per bot over a chosen window.
- Redesigned *Available Bots* panel: tags, folders and sorting.

### Changed
- New default widget layout on first launch and on reset.

## [0.6.0] - 2026-05-19

### Changed
- Repository renamed `frequi-fork` to `frequi-ultimate` (the old URL redirects).
- README rewritten in English around the multi-bot dashboard.

### Added
- `LLMS.txt`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`.
- `.github/` scaffolding: funding link, issue and pull request templates. The Dependabot configuration and the CI workflow added in this release were removed in August 2026 (GitHub Actions is disabled on this repository).

## [0.5.0] - 2026-05-16

### Added
- **Dashboard widgets:** MarketPulse, ActivityTimeline, RiskOverview, StressTestCard, LogViewerEnhanced.
- **Enhanced charts:** ProfitBenchmarkChart, ProfitDistributionEnhanced, CumulativeProfitEnhanced, OpenTradesEnhanced, ClosedTradesEnhanced.
- **Multi-bot comparison (BotComparisonList):** custom columns, tags, filters, sorting, groups, alert types, drag-drop reordering, CSV export, keyboard shortcuts. *Available funds* column, host badge, persistent column visibility.
- **Cross-bot popovers:** glassmorphism context cards (PeriodProfitCard, OpenProfitCard, ClosedProfitCard, BotInfoCard, ExchangeInfoCard).
- **Browser notifications** for trade events, alerts and fleet status changes.
- **Strategy development UI:** embedded Monaco editor, job launcher, 15+ analysis cards.
- **Internationalization:** English, French, German, Spanish, Italian, Portuguese.
- Chart: advanced pair selector, button to load the indicators of the active strategy, price axis label and crosshair. Journal: time period filter and leverage column.

### Changed
- **DashboardViewCustom:** full glassmorphism redesign with persistent layouts.
- **SettingsViewCustom:** section cards, notification settings, configuration export.
- **NavBar:** tab icons, PDF export, i18n.
- **ftbot store:** multi-bot polling (profit all, performance, logs, fleet status).

### Fixed
- Widget zoom levels, filter defaults and layout customizations persist across page refreshes; adding a widget no longer resets the layout.
- Navbar clicks failing from the dashboard.

## [0.4.0] - 2026-05-08

- Strategy Dev: inline Monaco editor for config and strategy files, job launcher with live console, re-run of any backtest or hyperopt job with its parameters pre-filled.

## [0.3.2] - 2026-05-08

- Light theme: readable text across 25+ components. Optimized default dashboard layout on first launch and on reset.

## [0.3.1] - 2026-05-08

- Charts: redesigned trade markers, DCA labels, stoploss and liquidation lines, legend with live values, import and export of plot configurations. Trade actions popover with "View chart" and "View on exchange".

## [0.3.0] - 2026-05-07

- Viewport-normalized widget zoom, new dashboard background animation, navigation fixes.

## [0.2.0] - 2026-05-07

- Dashboard edit mode: per-widget zoom, column editor, "Save as default" filters, Live / Dry / All filter on 9 widgets, layout optimizer. Fork version badge with update check in the navbar. Volume Comparator widget, Charts tab.

## [0.1.0] - 2026-04-18

- First packaged build of the fork, installable with `freqtrade install-ui` from freqtrade-ultimate.

## Fork stats

Compared with the upstream FreqUI commit the fork started from (April 2026), as of 2.2.0:

- 327 files changed under `src/`, about 105 000 lines added.
- 182 Vue components added, 49 upstream components reworked.
- English and French fully translated; German, Spanish, Italian and Portuguese partially, with English fallback.

## Pairing with freqtrade-ultimate

frequi-ultimate is the official dashboard of [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate). Several widgets (Market Pulse, Risk Overview, Stress Test, fleet status, Strategy Dev, Dry Replay, the configuration editor) call REST endpoints that only exist in freqtrade-ultimate. The UI also works with a standard Freqtrade bot, where those panels stay empty.

[2.2.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v2.2.0
[2.1.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v2.1.0
[2.0.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v2.0.0
[0.9.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.9.0
[0.8.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.8.0
[0.7.5]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.7.5
[0.7.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.7.0
[0.6.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.6.0
[0.5.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.5.0
[0.4.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.4.0
[0.3.2]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.3.2
[0.3.1]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.3.1
[0.3.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.3.0
[0.2.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.2.0
[0.1.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.1.0
