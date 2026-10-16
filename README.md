<p align="center">
  <img src=".readme_illustrations/readme-hero.svg" alt="FreqUI Ultimate, the multi-bot Freqtrade dashboard: the orange robot mascot stands in front of a dashboard with bot cards, a cumulative profit chart and a bot comparison panel" width="100%">
</p>

<p align="center">
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

A fork of [FreqUI](https://github.com/freqtrade/frequi), the Freqtrade web dashboard, redesigned to run a whole fleet of Freqtrade trading bots from one screen. It is the companion of [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate), but it is compatible with any standard Freqtrade instance.

It is rebuilt around two needs upstream doesn't address:

1. **Monitoring multiple Freqtrade bots simultaneously:** compare them side-by-side, alert on cross-bot anomalies, manage them as a fleet.
2. **Understanding the market context around your bots:** volume context, regime indicators, stress tests, alert detection.

148 files modified, +38 413 lines added, 50+ enhanced components, 6 languages out of the box. Maintained by [Freqtrade France](https://buymeacoffee.com/freqtrade_france).

## Install

### Option A: through freqtrade-ultimate (recommended)

```bash
freqtrade install-ui --ui-version github://titouannwtt/frequi-ultimate
```

### Option B: local development

```bash
git clone https://github.com/titouannwtt/frequi-ultimate.git
cd frequi-ultimate
pnpm install
pnpm dev
```

Then point it at any Freqtrade or [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate) instance via the standard FreqUI login flow.

## How it works

<p align="center"><img src=".readme_illustrations/readme-architecture.svg" alt="The browser runs FreqUI Ultimate; Pinia stores poll the REST API of every bot and merge the results client-side; fleet-wide widgets call endpoints that only exist on freqtrade-ultimate" width="100%"></p>

- **Fan-out polling.** Each bot is a separate Freqtrade REST API instance with its own auth. Pinia stores poll every bot independently and merge the results client-side into the fleet dashboard.
- **Fork-only widgets.** Fleet-wide panels call extra endpoints (`/fleet/*`, `/fleetview/*`, `/stratdev/*`, `/volume_history`, `/signal_summary`) served by freqtrade-ultimate.
- **Interactive diagram.** [`docs/diagrams/frequi-architecture.html`](docs/diagrams/frequi-architecture.html) shows how the fleet dashboard polls every bot's REST API and where the fork-only widgets plug in.

> [!NOTE]
> The advanced widgets (Market Pulse, Risk Overview, fleet status, volume/signal context, the in-browser strategy editor) are powered by REST endpoints that only exist in **[freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate)**. Point this UI at a stock freqtrade bot and those panels stay empty: pair it with the fork for the full experience.

**Stack:** Vue 3.5 · Pinia · PrimeVue · ECharts · TailwindCSS 4 · vue-i18n · Monaco Editor · Vite 8 · pnpm.

## Highlights

<p align="center"><img src=".readme_illustrations/readme-highlights.svg" alt="Five areas: dashboard redesign, fleet management with 13 cross-bot alerts, strategy development UI, 6 languages, settings and UX" width="100%"></p>

### Dashboard redesign

- **DashboardViewCustom:** glassmorphism redesign with persistent layouts (Pinia store).
- **Enhanced widgets:** MarketPulse, ActivityTimeline, RiskOverview, StressTestCard, LogViewerEnhanced.
- **Enhanced charts:** ProfitBenchmarkChart, ProfitDistributionEnhanced, CumulativeProfitEnhanced, OpenTradesEnhanced, ClosedTradesEnhanced.
- **BotProfitComparisonChart:** per-bot realized P&L as a bar chart to compare bots head-to-head over a chosen window. Period selector (24h, today, 48h, 7d, 14d, 1/2/3/6 months, 1 year, All), live/all/dry filter, value in the summary currency or in % of allocated capital, sortable, with the fleet total. Honors the bots selected in *Bot comparison* intersected with its own live/dry filter. Profit is summed from each bot's cached closed trades (no extra API calls) and currencies are normalized via the dashboard's exchange rates.

### Multi-bot fleet management

- **BotComparisonList:** custom columns, tags, filters, sorting, groups, **13 alert types**, drag-drop reordering, CSV export, keyboard shortcuts (+4 530 lines over upstream).
- **Cross-bot popovers:** glassmorphism context cards: PeriodProfitCard, OpenProfitCard, ClosedProfitCard, BotInfoCard, ExchangeInfoCard.
- **Browser notifications:** trade events, alerts, fleet status changes.

### Strategy development UI

- **StrategyDev:** embedded Monaco editor for live strategy editing, job launcher (backtest / hyperopt from the UI), 15+ analysis cards. Hooks into the strategy-dev backend shipped in [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate).

### Internationalization

- **6 languages out of the box:** English, French, German, Spanish, Italian, Portuguese (1 200+ translation keys each).

### Settings and UX

- **SettingsViewCustom:** section cards, glassmorphism, notification settings, configuration export.
- **NavBar:** tab icons, PDF export, full i18n, glassmorphism.

## Screenshots

### Multi-bot dashboard

One glassmorphism screen for the whole fleet: live log console, cumulative profit vs BTC benchmark, per-bot comparison, and every open position with duration-health bars.

![Multi-bot dashboard](.readme_illustrations/dashboard-overview.png)

### Fleet comparison and alerts

Compare bots head-to-head with custom columns, tags, filters, groups, drag-drop ordering, and 13 cross-bot alert types.

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
