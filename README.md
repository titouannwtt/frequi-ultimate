<p align="center">
  <img src="docs/assets/logo_frequi_ultimate.jpg" width="180" alt="FreqUI Ultimate logo">
</p>

<h1 align="center">FreqUI Ultimate</h1>

<p align="center">
  <b>The multi-bot Freqtrade dashboard, redesigned for production-grade algorithmic trading.</b><br>
  Companion to <a href="https://github.com/titouannwtt/freqtrade-ultimate">freqtrade-ultimate</a>. Maintained by <a href="https://buymeacoffee.com/freqtrade_france">Freqtrade France</a>.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPLv3-blue"></a>
  <a href="https://github.com/titouannwtt/frequi-ultimate/stargazers"><img src="https://img.shields.io/github/stars/titouannwtt/frequi-ultimate?style=social"></a>
  <img src="https://img.shields.io/badge/vue-3.5-brightgreen">
  <img src="https://img.shields.io/badge/i18n-6%20languages-blue">
  <a href="https://buymeacoffee.com/freqtrade_france"><img src="https://img.shields.io/badge/community-Freqtrade%20France-orange"></a>
</p>

---

## 🎯 What is FreqUI Ultimate?

A fork of [FreqUI](https://github.com/freqtrade/frequi) rebuilt around two needs upstream doesn't address:

1. **Monitoring multiple Freqtrade bots simultaneously** — compare them side-by-side, alert on cross-bot anomalies, manage them as a fleet.
2. **Understanding the market context around your bots** — volume context, regime indicators, stress tests, alert detection.

148 files modified, +38 413 lines added, 50+ enhanced components, 6 languages out of the box. Designed to pair with [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate) but compatible with any standard Freqtrade instance.

## ✨ Highlights

### Dashboard redesign
- **DashboardViewCustom** — Glassmorphism redesign with persistent layouts (Pinia store).
- **Enhanced widgets** — MarketPulse, ActivityTimeline, RiskOverview, StressTestCard, LogViewerEnhanced.
- **Enhanced charts** — ProfitBenchmarkChart, ProfitDistributionEnhanced, CumulativeProfitEnhanced, OpenTradesEnhanced, ClosedTradesEnhanced.
- **BotProfitComparisonChart** — Per-bot realized P&L as a bar chart to compare bots head-to-head over a chosen window. Period selector (24h, today, 48h, 7d, 14d, 1/2/3/6 months, 1 year, All), live/all/dry filter, value in the summary currency or in % of allocated capital, sortable, with the fleet total. Honors the bots selected in *Bot comparison* intersected with its own live/dry filter. Profit is summed from each bot's cached closed trades (no extra API calls) and currencies are normalized via the dashboard's exchange rates.

### Multi-bot fleet management
- **BotComparisonList** — Custom columns, tags, filters, sorting, groups, **13 alert types**, drag-drop reordering, CSV export, keyboard shortcuts (+4 530 lines over upstream).
- **Cross-bot popovers** — Glassmorphism context cards: PeriodProfitCard, OpenProfitCard, ClosedProfitCard, BotInfoCard, ExchangeInfoCard.
- **Browser notifications** — Trade events, alerts, fleet status changes.

### Strategy development UI
- **StrategyDev** — Embedded Monaco editor for live strategy editing, job launcher (backtest / hyperopt from the UI), 15+ analysis cards. Hooks into the strategy-dev backend shipped in [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate).

### Internationalization
- **6 languages out of the box** — English, French, German, Spanish, Italian, Portuguese (1 200+ translation keys each).

### Settings & UX
- **SettingsViewCustom** — Section cards, glassmorphism, notification settings, configuration export.
- **NavBar** — Tab icons, PDF export, full i18n, glassmorphism.

## 🚀 Installation

### Option A — Through freqtrade-ultimate (recommended)
```bash
freqtrade install-ui --ui-version github://titouannwtt/frequi-ultimate
```

### Option B — Local development
```bash
git clone https://github.com/titouannwtt/frequi-ultimate.git
cd frequi-ultimate
pnpm install
pnpm dev
```

Then point it at any Freqtrade or [freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate) instance via the standard FreqUI login flow.

## 🛠️ Stack

Vue 3.5 · Pinia · PrimeVue · ECharts · TailwindCSS 4 · vue-i18n · Monaco Editor · Vite 8 · pnpm.

## 📷 Screenshots

### Multi-bot dashboard

One glassmorphism screen for the whole fleet — live log console, cumulative profit vs BTC benchmark, per-bot comparison, and every open position with duration-health bars.

![Multi-bot dashboard](.readme_illustrations/dashboard-overview.png)

### Fleet comparison & alerts

Compare bots head-to-head with custom columns, tags, filters, groups, drag-drop ordering, and 13 cross-bot alert types.

<p align="center">
  <img src=".readme_illustrations/bot-comparison-alerts.png" width="49%" alt="Bot comparison — alerts">
  <img src=".readme_illustrations/bot-comparison-groups.png" width="49%" alt="Bot comparison — groups">
</p>

### Market context & portfolio risk

Widgets stock FreqUI doesn't have: Market Pulse (BTC dominance, Fear & Greed, fleet vs BTC/ETH) and a portfolio-wide Risk Overview (net/gross exposure, leverage, worst drawdown, correlation warnings).

<p align="center">
  <img src=".readme_illustrations/widget-market-pulse.png" width="49%" alt="Market Pulse widget">
  <img src=".readme_illustrations/widget-risk-overview.png" width="49%" alt="Risk Overview widget">
</p>

### Analytics widgets

Per-bot profit benchmarks, profit distribution, activity timeline, and a Monte-Carlo stress test.

<p align="center">
  <img src=".readme_illustrations/widget-profit-benchmarks-combined.png" width="49%" alt="Profit & benchmarks widget">
</p>
<p align="center">
  <img src=".readme_illustrations/widget-stress-test.png" width="49%" alt="Stress test widget">
  <img src=".readme_illustrations/widget-activity-timeline.png" width="49%" alt="Activity timeline widget">
</p>

### Rich context popovers

Hover any metric for a glassmorphism context card — open/closed profit, win/loss, DCA escalations, exit reasons, price levels, and more.

<p align="center">
  <img src=".readme_illustrations/popover-open-positions.png" width="49%" alt="Open positions popover">
  <img src=".readme_illustrations/popover-dca-escalations.png" width="49%" alt="DCA escalations popover">
</p>

> 🔗 **Note:** the advanced widgets above (Market Pulse, Risk Overview, fleet status, volume/signal context, the in-browser strategy editor) are powered by REST endpoints that only exist in **[freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate)**. Point this UI at a stock freqtrade bot and those panels stay empty — pair it with the fork for the full experience.

## 🎓 Learn algorithmic trading

**[Freqtrade France](https://buymeacoffee.com/freqtrade_france)** is the French-speaking algo trading community behind both freqtrade-ultimate and frequi-ultimate. Free tutorials, paid strategies, and live walkthroughs of how to use this dashboard with multi-bot setups.

- 🎥 YouTube: [@freqtrade_france](https://www.youtube.com/@freqtrade_france)
- 🐦 Twitter: [@MoutonCrypto](https://x.com/MoutonCrypto)
- 💎 Member access: 9 € / month or 90 € / year

If you don't want to subscribe but want to support the fork, the simplest free way is to use the [Hyperliquid referral link](https://app.hyperliquid.xyz/join/MOUTON) when creating your account.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs are welcome.

## 📄 License

GPL-3.0 — same as upstream FreqUI.

---

<p align="center">
  Built and maintained by <b>Mouton 🐑</b> · <a href="https://buymeacoffee.com/freqtrade_france"><b>Freqtrade France</b></a>
</p>
