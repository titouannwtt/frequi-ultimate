# Changelog — FreqUI Ultimate

All notable fork-specific changes are documented here. Upstream FreqUI changes are tracked in [freqtrade/frequi releases](https://github.com/freqtrade/frequi/releases).

This fork is also documented in detail in [`CHANGELOG_FORK.md`](CHANGELOG_FORK.md).

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
