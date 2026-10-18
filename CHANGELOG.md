# Changelog — FreqUI Ultimate

All notable fork-specific changes are documented here. Upstream FreqUI changes are tracked in [freqtrade/frequi releases](https://github.com/freqtrade/frequi/releases).

This fork is also documented in detail in [`CHANGELOG_FORK.md`](CHANGELOG_FORK.md).

## [Unreleased]

### Added
- Fleet page: a **Profit** block, full width under the four figures. It shows the profit of the ticked bots over 24 h, 7 d, 30 d, 90 d, 1 year, the whole history or a range of days, as two curves that start at zero where the period starts (the closed trades, and the closed trades with the open positions), with the realised and the open profit above them.
- Fleet page: a **Bots N/M** button opens the list of bots to tick (search, All / None, a quick pick by group). The bots ticked count in the four figures, the Profit block, the table of bots, the positions to watch and the risk; live and dry keep their own figures. The alerts and the verdict still watch the whole mode. The choice is kept in the preferences, and a bot that appears later is ticked.
- Gateway: `GET /equity` takes `to` (ms) beside `from`, cuts the range first and decimates after, and answers `base`, the value of the curve just before `from`.

### Changed
- Fleet page: the table of bots shows today, 7 days, 30 days and the total of each bot by default, and every ticked bot on a computer (a phone keeps its eight). A table saved with exactly the former six columns follows the new default; any other choice is kept.

## [2.0.0] - 2026-10-16

Full redesign of the interface, plus an optional Rust gateway. Upgrade guide: [`docs/UPGRADE.en.md`](docs/UPGRADE.en.md) ([français](docs/UPGRADE.fr.md)). Nothing to re-register: the bot list stays in the browser, and the old `localStorage` keys are never deleted.

### Added
- **`frequi-gateway`** (`gateway/`): a static Rust service that discovers the bots of the host, reads their trades once, computes the fleet figures and alerts, and serves them over `/gw/v1` (REST and WebSocket) with mandatory authentication, an origin allow list and rate limiting. Optional: without it the UI polls the bots itself (direct mode) and falls back to it by itself.
- New design system (`src/components/ds`, `src/components/fq`), data layer with a gateway source and a direct source (`src/datasource`), idempotent `localStorage` migration to `fqu2.*` keys (`src/migration`).
- Packaging (`gateway/packaging`): screen launcher, systemd user unit, Dockerfile (scratch, non-root), example configuration, and `deploy-ui.sh` (backup, additive copy, atomic switch of `index.html`, verification, `--rollback`).
- GitHub Actions: `rust.yml` (fmt, clippy, tests, cargo-deny, static musl builds), `frontend.yml` (lint, type-check ratchet, unit tests, build, optional Playwright), `contract.yml` (generated types and shared vectors on both sides), `packaging.yml`, `release.yml` (tag to prerelease with the UI archive first, so `freqtrade install-ui` keeps working, then the x86_64 and aarch64 binaries and `SHA256SUMS`).

- Calmer interface: the Fleet opens on one sentence that says what needs attention, then the alerts as cards with their most useful action, "Later" or "Seen"; the rest of the history is behind the bell. Plain labels (Total capital, Open, Drawdown, Top-ups) with the technical term in a tooltip; airy density by default, compact as an option; sensitive actions under "More".
- Charts show the trade on the price: average entry, current gain, filled entries and top-ups, pending orders (limit or stop trigger) and the closed trades of the pair.

### Changed
- Version 2.0.0 (UI and gateway). French and English only. Long and short are green and red with an arrow and an L/S letter; exiting a live position needs a one-second press-and-hold; days are cut in Europe/Paris by default.
- README rewritten around the two modes (direct and gateway).

### Fixed
- README: `--ui-version github://...` was never supported by `install-ui`; it takes a release name such as `v2.0.0`.

## [Unreleased]

### Branding & documentation
- Renamed repository from `frequi-fork` to `frequi-ultimate`.
- Full English-only README rewrite, emphasizing Freqtrade France brand and the multi-bot dashboard angle.
- Added [`LLMS.txt`](LLMS.txt) at root for AI indexing.
- Added [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- Added GitHub meta: `.github/FUNDING.yml`.

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

[2.0.0]: https://github.com/titouannwtt/frequi-ultimate/compare/v0.5.0...v2.0.0
[Unreleased]: https://github.com/titouannwtt/frequi-ultimate/compare/v0.5.0...HEAD
[v0.5.0]: https://github.com/titouannwtt/frequi-ultimate/releases/tag/v0.5.0
