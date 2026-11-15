<p align="center">
  <img src=".readme_illustrations/readme-hero.svg" alt="FreqUI Ultimate, the multi-bot Freqtrade dashboard: the orange robot mascot stands in front of a dashboard with bot cards, a cumulative profit chart and a bot comparison panel" width="100%">
</p>

<p align="center">
  <a href="https://github.com/titouannwtt/frequi-ultimate/releases/latest"><img src="https://img.shields.io/github/v/release/titouannwtt/frequi-ultimate?label=release&color=F7901E" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPLv3-blue" alt="License: GPLv3"></a>
  <a href="https://github.com/titouannwtt/frequi-ultimate/stargazers"><img src="https://img.shields.io/github/stars/titouannwtt/frequi-ultimate?style=social" alt="GitHub stars"></a>
  <img src="https://img.shields.io/badge/vue-3.5-brightgreen" alt="Vue 3.5">
  <img src="https://img.shields.io/badge/i18n-6%20languages-blue" alt="6 languages">
  <a href="https://buymeacoffee.com/freqtrade_france"><img src="https://img.shields.io/badge/community-Freqtrade%20France-orange" alt="Freqtrade France community"></a>
</p>

<p align="center">
  <a href="#install"><b>Install</b></a> ·
  <a href="#how-it-works"><b>How it works</b></a> ·
  <a href="#highlights"><b>Highlights</b></a> ·
  <a href="#screenshots"><b>Screenshots</b></a>
</p>

## What is FreqUI Ultimate?

A fork of [FreqUI](https://github.com/freqtrade/frequi), the Freqtrade web dashboard, redesigned to run a whole fleet of Freqtrade bots from one screen. It is the companion of [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate), but it is compatible with any standard Freqtrade instance.

It is rebuilt around two needs upstream doesn't address:

1. **Monitoring multiple Freqtrade bots simultaneously:** compare them side-by-side, alert on cross-bot anomalies, manage them as a fleet.
2. **Understanding the market context around your bots:** volume context, regime indicators, stress tests, alert detection.

Compared with the upstream commit it was forked from (April 2026): 182 Vue components added, 49 reworked, about 105 000 lines added under `src/`. Maintained by [Freqtrade France](https://buymeacoffee.com/freqtrade_france).

> [!NOTE]
> **Current release: [v2.2.0](https://github.com/titouannwtt/frequi-ultimate/releases/latest)** (2026-11-15). The version number jumps from 0.9.0 to 2.2.0 on purpose: 2.0.0 and 2.1.0 were a full redesign that has been withdrawn, and they remain available as archived pre-releases. 2.2.0 is the classic dashboard shown below: the 0.9.0 code base plus the fixes made since. History in [CHANGELOG.md](CHANGELOG.md).

## Install

FreqUI Ultimate is a static web app served by the bot itself. Installing it means putting a release build into the `freqtrade/rpc/api_server/ui/installed/` folder of your Freqtrade checkout. No bot restart is needed: hard-refresh the page once (Ctrl+Shift+R).

### Option A: with freqtrade-ultimate (recommended)

```bash
freqtrade install-ui                        # latest release
freqtrade install-ui --ui-version v2.2.0    # a specific release
```

In [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate), `install-ui` downloads from this repository.

### Option B: with a standard Freqtrade

Stock `freqtrade install-ui` installs the upstream FreqUI, so do it by hand:

1. Download `frequi-ultimate-ui-v2.2.0.zip` from the [latest release](https://github.com/titouannwtt/frequi-ultimate/releases/latest) (check it with `sha256sum -c SHA256SUMS`).
2. Empty `freqtrade/rpc/api_server/ui/installed/`.
3. Unzip the archive into that folder.

### Option C: from source

```bash
git clone https://github.com/titouannwtt/frequi-ultimate.git
cd frequi-ultimate
pnpm install
pnpm dev      # development server
pnpm build    # production build in dist/
```

`pnpm dev` serves the UI locally: add any Freqtrade or [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate) bot through the standard FreqUI login flow. To install your own build, copy the content of `dist/` into `freqtrade/rpc/api_server/ui/installed/`, or use [`scripts/deploy-ui.sh`](scripts/deploy-ui.sh), which makes a backup first and can roll back.

## How it works

<p align="center"><img src=".readme_illustrations/readme-architecture.svg" alt="The browser runs FreqUI Ultimate; Pinia stores poll the REST API of every bot and merge the results client-side; fleet-wide widgets call endpoints that only exist on freqtrade-ultimate" width="100%"></p>

- **Fan-out polling.** Each bot is a separate Freqtrade REST API instance with its own auth. Pinia stores poll every bot independently and merge the results client-side into the fleet dashboard.
- **One fleet snapshot when the backend offers it.** On freqtrade-ultimate, the fleet table, the profit curves and the periodic refreshes read a single `/fleet/snapshot` instead of one request per bot and per widget, which keeps a fleet of 20 to 30 bots well inside exchange and API rate limits.
- **Fork-only widgets.** Fleet-wide panels call extra endpoints (`/fleet/*`, `/fleetview/*`, `/stratdev/*`, `/replay/*`, `/volume_history`, `/signal_summary`) served by freqtrade-ultimate.
- **Interactive diagram.** [`docs/diagrams/frequi-architecture.html`](docs/diagrams/frequi-architecture.html) shows how the fleet dashboard polls every bot's REST API and where the fork-only widgets plug in.

> [!NOTE]
> The advanced widgets (Market Pulse, Risk Overview, fleet status, volume/signal context, the in-browser strategy editor, Dry Replay, the per-bot config editor) are powered by REST endpoints that only exist in **[freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate)**. Point this UI at a stock freqtrade bot and those panels stay empty: pair it with the fork for the full experience.

**Stack:** Vue 3.5 · Pinia · PrimeVue · ECharts · TailwindCSS 4 · vue-i18n · Monaco Editor · Vite 8 · pnpm.

## Highlights

<p align="center"><img src=".readme_illustrations/readme-highlights.svg" alt="Five areas: dashboard redesign, fleet management with 14 cross-bot alerts, strategy development UI, 6 languages, settings and UX" width="100%"></p>

### Dashboard redesign

- **DashboardViewCustom:** glassmorphism redesign with persistent layouts (Pinia store).
- **Enhanced widgets:** MarketPulse, ActivityTimeline, RiskOverview, StressTestCard, LogViewerEnhanced.
- **Enhanced charts:** ProfitBenchmarkChart, ProfitDistributionEnhanced, CumulativeProfitEnhanced, OpenTradesEnhanced, ClosedTradesEnhanced.
- **Profit and benchmarks:** three independent curves (realized profit, latent profit including open positions, drawdown), with the drawdown measured on the selected window and market benchmarks you can add or remove (BTC by default).
- **Fit-to-screen tables:** *Bot comparison*, *Open trades* and *Closed trades* can share the viewport width instead of scrolling horizontally.
- **BotProfitComparisonChart:** per-bot realized P&L as a bar chart to compare bots head-to-head over a chosen window. Period selector (24h, today, 48h, 7d, 14d, 1/2/3/6 months, 1 year, All), live/all/dry filter, value in the summary currency or in % of allocated capital, sortable, with the fleet total. Honors the bots selected in *Bot comparison* intersected with its own live/dry filter. Profit is summed from each bot's cached closed trades (no extra API calls) and currencies are normalized via the dashboard's exchange rates.

### Multi-bot fleet management

- **BotComparisonList:** custom columns, tags, filters, sorting, groups, **14 alert types**, drag-drop reordering, CSV export, keyboard shortcuts (about 7 000 lines over upstream). Columns added since 0.6 include Current Profit (closed plus open), Max Drawdown and Market (Crypto, XYZ Stocks, XYZ Indices, XYZ Commodities or Mixed, derived from each bot's whitelist).
- **Per-bot config editor:** edit a bot's configuration from the dashboard (BotConfigEditorModal), with the backend shipped in freqtrade-ultimate.
- **Dry Replay:** replay a bot's real live loop over historical data and seed the simulated trades into its dry-run database, from the bot's action menu (DryReplayModal).
- **Cross-bot popovers:** glassmorphism context cards: PeriodProfitCard, OpenProfitCard, ClosedProfitCard, BotInfoCard, ExchangeInfoCard.
- **Browser notifications:** trade events, alerts, fleet status changes.

### Strategy development UI

- **StrategyDev:** embedded Monaco editor for live strategy editing, job launcher (backtest / hyperopt from the UI), 15+ analysis cards. Hooks into the strategy-dev backend shipped in [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate).

### Internationalization

- **6 languages:** English and French are complete (about 2 800 translation keys each). German, Spanish, Italian and Portuguese cover about 1 200 keys each and fall back to English for the rest.

### Settings and UX

- **SettingsViewCustom:** section cards, glassmorphism, notification settings, configuration export.
- **NavBar:** tab icons, PDF export, i18n, glassmorphism, and an in-app check for a newer release.

## Screenshots

All screenshots come from a synthetic demo fleet ([`scripts/demo-fleet`](scripts/demo-fleet)): the bots, trades and amounts are made up, and no real account or address appears in them.

### Multi-bot dashboard

One glassmorphism screen for the whole fleet: live log console, cumulative profit vs BTC benchmark, per-bot comparison, and every open position with duration-health bars.

![Multi-bot dashboard](.readme_illustrations/dashboard-overview.png)

### Fleet comparison and alerts

Compare bots head-to-head with custom columns, tags, filters, groups, drag-drop ordering, and 14 cross-bot alert types.

<p align="center">
  <img src=".readme_illustrations/bot-comparison-alerts.png" width="49%" alt="Bot comparison: alerts">
  <img src=".readme_illustrations/bot-comparison-groups.png" width="49%" alt="Bot comparison: groups">
</p>

### Market context and portfolio risk

Widgets stock FreqUI doesn't have: Market Pulse (BTC dominance, Fear & Greed, fleet vs BTC/ETH) and a portfolio-wide Risk Overview (net/gross exposure, leverage, worst drawdown, correlation warnings).

<p align="center">
  <img src=".readme_illustrations/widget-market-pulse.png" width="49%" alt="Market Pulse widget">
  <img src=".readme_illustrations/widget-risk-overview.png" width="49%" alt="Risk Overview widget">
</p>

### Analytics widgets

Per-bot profit benchmarks, profit distribution, activity timeline, and a Monte-Carlo stress test.

<p align="center">
  <img src=".readme_illustrations/widget-profit-benchmarks-combined.png" width="49%" alt="Profit and benchmarks widget">
</p>
<p align="center">
  <img src=".readme_illustrations/widget-stress-test.png" width="49%" alt="Stress test widget">
  <img src=".readme_illustrations/widget-activity-timeline.png" width="49%" alt="Activity timeline widget">
</p>

### Rich context popovers

Hover any metric for a glassmorphism context card: open/closed profit, win/loss, DCA escalations, exit reasons, price levels, and more.

<p align="center">
  <img src=".readme_illustrations/popover-open-positions.png" width="49%" alt="Open positions popover">
  <img src=".readme_illustrations/popover-dca-escalations.png" width="49%" alt="DCA escalations popover">
</p>

<details>
<summary><strong>More screenshots</strong> (logs page, comparison table, other widgets and popovers)</summary>

<br>

**Logs page and log console**

![Logs page](.readme_illustrations/logs-page-redesign.png)
![Log console widget](.readme_illustrations/widget-log-console.png)

**Bot comparison: columns, filters and sorting**

<p align="center">
  <img src=".readme_illustrations/bot-comparison-columns.png" width="32%" alt="Bot comparison: column editor">
  <img src=".readme_illustrations/bot-comparison-filter.png" width="32%" alt="Bot comparison: filters">
  <img src=".readme_illustrations/bot-comparison-sort.png" width="32%" alt="Bot comparison: sorting">
</p>

**Profit widgets**

<p align="center">
  <img src=".readme_illustrations/widget-profit-benchmarks-per-bot.png" width="49%" alt="Profit benchmarks per bot">
  <img src=".readme_illustrations/widget-profit-distribution.png" width="49%" alt="Profit distribution widget">
</p>

**Popovers**

<p align="center">
  <img src=".readme_illustrations/popover-open-profit.png" width="32%" alt="Open profit popover">
  <img src=".readme_illustrations/popover-closed-profit.png" width="32%" alt="Closed profit popover">
  <img src=".readme_illustrations/popover-periodic-profit.png" width="32%" alt="Periodic profit popover">
</p>
<p align="center">
  <img src=".readme_illustrations/popover-win-loss.png" width="32%" alt="Win/loss popover">
  <img src=".readme_illustrations/popover-exit-reasons.png" width="32%" alt="Exit reasons popover">
  <img src=".readme_illustrations/popover-trade-duration.png" width="32%" alt="Trade duration popover">
</p>
<p align="center">
  <img src=".readme_illustrations/popover-trade-overview.png" width="32%" alt="Trade overview popover">
  <img src=".readme_illustrations/popover-price-levels.png" width="32%" alt="Price levels popover">
  <img src=".readme_illustrations/popover-bot-info.png" width="32%" alt="Bot info popover">
</p>
<p align="center">
  <img src=".readme_illustrations/popover-exchange-info.png" width="32%" alt="Exchange info popover">
</p>

</details>

## Learn algorithmic trading

**[Freqtrade France](https://buymeacoffee.com/freqtrade_france)** is the French-speaking algo trading community behind both freqtrade-ultimate and frequi-ultimate. Free tutorials, paid strategies, and live walkthroughs of how to use this dashboard with multi-bot setups.

- YouTube: [@freqtrade_france](https://www.youtube.com/@freqtrade_france)
- Twitter: [@MoutonCrypto](https://x.com/MoutonCrypto)
- Member tutorials: see [Freqtrade France](https://buymeacoffee.com/freqtrade_france) for the current offer and pricing. The public forks remain free to use.

If you don't want to subscribe but want to support the fork, the simplest free way is to use the [Hyperliquid referral link](https://app.hyperliquid.xyz/join/MOUTON) when creating your account.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs are welcome.

## License

GPL-3.0, same as upstream [FreqUI](https://github.com/freqtrade/frequi), which this project is a fork of. See [LICENSE](LICENSE).

---

<p align="center">
  Built and maintained by <b>Mouton 🐑</b> · <a href="https://buymeacoffee.com/freqtrade_france"><b>Freqtrade France</b></a>
</p>
