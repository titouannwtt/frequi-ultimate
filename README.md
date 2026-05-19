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
- **Enhanced widgets** — MarketPulse, ActivityTimeline, PerformanceHeatmap, RiskOverview, StressTestCard, TradesLogEnhanced, LogViewerEnhanced.
- **Enhanced charts** — ProfitBenchmarkChart, ProfitDistributionEnhanced, ProfitOverTimeEnhanced, CumulativeProfitEnhanced, OpenTradesEnhanced, ClosedTradesEnhanced.

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

_To be added — placeholder for dashboard, fleet view, strategy dev._

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
