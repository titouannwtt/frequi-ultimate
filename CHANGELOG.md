# Changelog — FreqUI Ultimate

All notable fork-specific changes are documented here. Upstream FreqUI changes are tracked in [freqtrade/frequi releases](https://github.com/freqtrade/frequi/releases).

This fork is also documented in detail in [`CHANGELOG_FORK.md`](CHANGELOG_FORK.md).

## [2.2.0] - 2026-11-15

### Back to the classic dashboard
- The 2.0.0 and 2.1.0 redesign (new interface and the optional Rust gateway) is withdrawn. FreqUI Ultimate is again the classic multi-bot dashboard, as it was before the redesign: the 0.9.0 code base plus the fixes made after it.
- The browser talks to each bot directly again. No gateway is needed: if you ran `frequi-gateway`, you can stop it.
- Your bot list is kept: the redesign never removed the logins stored in the browser.
- The version number keeps increasing (2.2.0) so that the in-app update check and `freqtrade install-ui` pick this release over 2.1.0.
- The redesign stays available for reference under the `v2.0.0` and `v2.1.0` tags.

### Since 0.9.0
- Fleet dashboard performance: the fleet table, the profit curves and the periodic refreshes read one fleet snapshot instead of one request per bot; open trades are virtualised; dashboard charts no longer animate.
- Partial exits and position adjustments made from the multi-bot trade list are sent to the bot that owns the trade.
- One failed request no longer marks a bot offline.
- Profit benchmark: the latent curve is merged from zero, the checkboxes act at once, and the curve no longer reloads in waves.

### Tooling
- Added `scripts/deploy-ui.sh`: deploys a build into the directory a bot serves the UI from, with a backup and a rollback.

## [Unreleased]

### Branding & documentation
- Renamed repository from `frequi-fork` to `frequi-ultimate`.
- Full English-only README rewrite, emphasizing Freqtrade France brand and the multi-bot dashboard angle.
- Added [`LLMS.txt`](LLMS.txt) at root for AI indexing.
- Added [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- Added GitHub meta: `.github/FUNDING.yml`, `.github/dependabot.yml`, `.github/workflows/ci.yml` (typecheck + lint + build on push/PR).

## [v0.5.0] — Multi-bot dashboard with glassmorphism design

Snapshot of fork-specific features as of v0.5.0.

### Dashboard redesign
- **DashboardViewCustom** — Glassmorphism redesign with persistent layouts (Pinia store).
- **Enhanced widgets** — MarketPulse, ActivityTimeline, PerformanceHeatmap, RiskOverview, StressTestCard, TradesLogEnhanced, LogViewerEnhanced.
- **Enhanced charts** — ProfitBenchmarkChart, ProfitDistributionEnhanced, ProfitOverTimeEnhanced, CumulativeProfitEnhanced, OpenTradesEnhanced, ClosedTradesEnhanced.

### Multi-bot fleet management
- **BotComparisonList** — Custom columns, tags, filters, sorting, groups, 13 alert types, drag-drop reordering, CSV export, keyboard shortcuts (+4 530 lines over upstream).
- **Cross-bot popovers** — PeriodProfitCard, OpenProfitCard, ClosedProfitCard, BotInfoCard, ExchangeInfoCard.
- **Browser notifications** — Trade events, alerts, fleet status changes.

### Strategy development UI
- **StrategyDev** — Monaco editor integration, job launcher (backtest/hyperopt from UI), 15+ analysis cards.

### Internationalization
- 6 languages out of the box: English, French, German, Spanish, Italian, Portuguese (1 200+ translation keys each).

### Settings & UX
- **SettingsViewCustom** — Section cards, glassmorphism, notification settings, configuration export.
- **NavBar** — Tab icons, PDF export, full i18n, glassmorphism.

---

For the complete inventory of fork modifications (148 files changed, +38 413 lines), see [`CHANGELOG_FORK.md`](CHANGELOG_FORK.md).

[Unreleased]: https://github.com/titouannwtt/frequi-ultimate/compare/v0.5.0...HEAD
[v0.5.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.5.0
