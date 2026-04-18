# FreqUI — Fork

[![Open in Visual Studio Code](https://img.shields.io/static/v1?logo=visualstudiocode&label=&message=Open%20in%20Visual%20Studio%20Code&labelColor=2c2c32&color=007acc&logoColor=007acc)](https://vscode.dev/github/titouannwtt/frequi-fork)

A fork of [freqtrade/frequi](https://github.com/freqtrade/frequi) with a near-complete overhaul of the user interface. The goal of this project is to make the Freqtrade dashboard **more dynamic, more detailed, and more opinionated** — with custom widgets tailored to the kind of DCA / futures strategies I run daily.

Upstream FreqUI is great as a general-purpose monitoring tool, but it stops short of surfacing the information I actually look at every day when running multiple bots in parallel: per-bot risk exposure, DCA state, liquidation distance, cross-bot benchmarks, market context, alert history, projected monthly/yearly profit, and so on. This fork fills that gap.

<p align="center">
  <img src=".readme_illustrations/dashboard-overview.png" alt="FreqUI fork — dashboard overview with Bot Comparison, Profit & Benchmarks and Log Console" width="900">
</p>

---

## English

### Why this fork?

I run several Freqtrade instances at once (short DCA on Hyperliquid, long DCA on Binance, experimental strategies, etc.). The stock FreqUI is fine for monitoring *one* bot but becomes noisy as soon as you want to compare them or understand **where your risk actually is** across the whole fleet.

This fork is my answer to that. It rebuilds the dashboard around:

- **Fleet-level views** — see all bots at once with custom columns, groups, tags, sorting, per-bot alerts, and drag-and-drop ordering.
- **Rich popovers** — click any metric (profit, win/loss, balance, trades, DCA state…) and get a full contextual card instead of a plain number.
- **Market context** — BTC / ETH / SOL benchmarks, Fear & Greed, calendar heatmap, so profit numbers don't float in a vacuum.
- **Opinionated risk view** — net/gross exposure, drawdown gauge, liquidation distance, stress test.
- **Full i18n** — English, French, German, Spanish, Italian, Portuguese (1200+ keys).

All of this is built on top of the original FreqUI codebase (Vue 3 + PrimeVue + ECharts + Tailwind), and stays compatible with any Freqtrade API.

### What's new vs. upstream?

Concrete inventory (148 files changed, +38 413 / -1 676 lines vs. `freqtrade/frequi`). Highlights:

#### New top-level views & widgets

- **Custom Dashboard** (`DashboardViewCustom.vue`) — new layout with drag-and-droppable enhanced widgets.
- **Custom Settings view** (`SettingsViewCustom.vue`) — glassmorphism redesign, grouped into cards (connections, notifications, appearance, About).
- **Bot Comparison** — ~4500 lines of new code on top of the upstream list: custom columns, tags, filters, sort, groups, 13 alert types, custom tags, per-column popovers, drag ordering, CSV export, keyboard shortcuts.

<p align="center">
  <img src=".readme_illustrations/bot-comparison-columns.png" alt="Visible columns picker" width="270">
  &nbsp;
  <img src=".readme_illustrations/bot-comparison-sort.png" alt="Sort by picker" width="270">
  &nbsp;
  <img src=".readme_illustrations/bot-comparison-filter.png" alt="Filters" width="270">
</p>
<p align="center">
  <img src=".readme_illustrations/bot-comparison-alerts.png" alt="Alert settings (13 alert types)" width="270">
  &nbsp;
  <img src=".readme_illustrations/bot-comparison-groups.png" alt="Bot groups / subfolders" width="350">
</p>

- **Market Pulse** — BTC/ETH tracker, Fear & Greed index, 24h market performance.

<p align="center"><img src=".readme_illustrations/widget-market-pulse.png" alt="Market Pulse widget" width="650"></p>

- **Activity Timeline** — rich event timeline (entries, exits, DCA, alerts, errors) with grouping and filters.

<p align="center"><img src=".readme_illustrations/widget-activity-timeline.png" alt="Activity Timeline widget" width="650"></p>

- **Performance Heatmap** — calendar heatmap, daily / weekly / monthly.

<p align="center"><img src=".readme_illustrations/widget-performance-heatmap.png" alt="Performance Heatmap widget" width="650"></p>

- **Risk Overview** — net & gross exposure, drawdown gauge, open-risk summary.

<p align="center"><img src=".readme_illustrations/widget-risk-overview.png" alt="Risk Overview widget" width="650"></p>

- **Stress Test card** — shock scenarios from -50% to +50%, liquidation capping.

<p align="center"><img src=".readme_illustrations/widget-stress-test.png" alt="Stress Test widget" width="650"></p>

- **Enhanced Trades Log** — compact, filterable journal.

<p align="center"><img src=".readme_illustrations/widget-trades-log.png" alt="Trades Log widget" width="650"></p>

- **Enhanced Log Viewer** — coloured logs, heartbeat / WebSocket filters, 500-line buffer. Also a full refresh of the Logs page.

<p align="center"><img src=".readme_illustrations/widget-log-console.png" alt="Log console widget" width="750"></p>
<p align="center"><img src=".readme_illustrations/logs-page-redesign.png" alt="Logs page — full redesign" width="700"></p>

#### Enhanced versions of existing widgets

Drop-in replacements that keep the same purpose but add drill-downs, tabs, and stats:

- `ProfitBenchmarkChart.vue` — unifies Profit + BTC/ETH/SOL benchmarks (via CoinGecko).

<p align="center">
  <img src=".readme_illustrations/widget-profit-benchmarks-combined.png" alt="Profit &amp; Benchmarks — combined view with BTC overlay" width="430">
  &nbsp;
  <img src=".readme_illustrations/widget-profit-benchmarks-per-bot.png" alt="Profit &amp; Benchmarks — per-bot view" width="430">
</p>

- `ProfitDistributionEnhanced.vue` — 5 tabs, filters, ECharts.

<p align="center"><img src=".readme_illustrations/widget-profit-distribution.png" alt="Profit Distribution widget" width="650"></p>

- `ProfitOverTimeEnhanced.vue` — 3 modes (cumulative / per-trade / rolling), timeframes, stats.
- `CumulativeProfitEnhanced.vue` — 4 tabs, zoom, running stats.
- `OpenTradesEnhanced.vue` / `ClosedTradesEnhanced.vue` — custom columns, exit-reason badges, pagination, popovers.

#### Contextual popovers (click any number, get a card)

Each of these replaces a plain-text metric with a detailed glassmorphism card:

- Profit popovers: Open / Closed / Summary / Period (monthly & yearly with SVG projections) / Goal.
- Trade popovers: Open trades info, Trade detail (DCA ladder, stoploss, liquidation), Duration health (box plot / percentiles).
- Balance popovers: Balance card, Summary Balance, Win/Loss, Summary Win/Loss, Summary Trades.
- Bot / Exchange / Currency info cards: equity curve, fees, KYC flags, token backing & risks.
- Stoploss chart popover: mini SVG price chart with 5 000 candles, SL & liquidation lines.
- Alert detail card grouped by position.

<table>
  <tr>
    <td align="center"><img src=".readme_illustrations/popover-bot-info.png" alt="Bot info popover" width="260"></td>
    <td align="center"><img src=".readme_illustrations/popover-exchange-info.png" alt="Exchange info popover" width="260"></td>
    <td align="center"><img src=".readme_illustrations/popover-trade-overview.png" alt="Trade overview popover" width="220"></td>
  </tr>
  <tr>
    <td align="center"><img src=".readme_illustrations/popover-open-positions.png" alt="All open positions popover" width="240"></td>
    <td align="center"><img src=".readme_illustrations/popover-dca-escalations.png" alt="DCA &amp; cost escalations popover" width="220"></td>
    <td align="center"><img src=".readme_illustrations/popover-periodic-profit.png" alt="Periodic profit analysis popover" width="240"></td>
  </tr>
  <tr>
    <td align="center"><img src=".readme_illustrations/popover-closed-profit.png" alt="Closed profits (all bots) popover" width="280"></td>
    <td align="center"><img src=".readme_illustrations/popover-open-profit.png" alt="Open profit (all bots) popover" width="280"></td>
    <td align="center"><img src=".readme_illustrations/popover-win-loss.png" alt="Global win/loss popover" width="260"></td>
  </tr>
  <tr>
    <td align="center"><img src=".readme_illustrations/popover-exit-reasons.png" alt="Exit reason distribution popover" width="240"></td>
    <td align="center"><img src=".readme_illustrations/popover-price-levels.png" alt="Price levels &amp; zones popover" width="260"></td>
    <td align="center"><img src=".readme_illustrations/popover-trade-duration.png" alt="Trade duration vs bot history popover" width="260"></td>
  </tr>
</table>

#### New composables & stores

- `tradeColumns.ts`, `exchangeRates.ts`, `benchmarkData.ts`, `browserNotifications.ts`, `summaryCurrency.ts`, `useAlertDetection.ts`, `useConfigExport.ts`, `useLogFiltering.ts`, `usePopoverHover.ts`, `useTradePopover.ts`.
- New stores: `botComparison.ts`, `logConsole.ts`, extended `ftbotwrapper.ts` / `ftbot.ts` / `layout.ts` / `settings.ts`.

#### i18n

Full translations in **EN / FR / DE / ES / IT / PT**, lazy-loaded, with a language selector. Roughly 1 200 strings per locale.

#### External data sources

- CoinGecko (no API key required) — crypto prices, historical data, benchmarks.
- Alternative.me — Fear & Greed index.

Both are called from the UI only and cached client-side (5–10 min).

### How to use this fork with Freqtrade

There are two supported ways.

#### Option A — use my Freqtrade fork (recommended)

I maintain a companion fork of Freqtrade itself at:

**<https://github.com/titouannwtt/freqtrade-fork>**

In that fork, `freqtrade install-ui` is already redirected to fetch this UI instead of the upstream one, so you don't have to do anything special:

```bash
git clone https://github.com/titouannwtt/freqtrade-fork.git
cd freqtrade-fork
./setup.sh -i              # or your usual install path
freqtrade install-ui        # pulls from titouannwtt/frequi-fork
freqtrade trade --config user_data/config.json
```

Then open the UI on the API port (by default `http://127.0.0.1:8080`).

#### Option B — drop into an existing Freqtrade install

If you want to keep upstream Freqtrade and only swap the UI, build this fork locally and copy the `dist/` folder into Freqtrade's UI directory:

```bash
# 1. Build the UI
git clone https://github.com/titouannwtt/frequi-fork.git
cd frequi-fork
pnpm install
pnpm run build

# 2. Replace the UI served by your Freqtrade install
#    (adjust the path to your freqtrade checkout / venv)
rm -rf /path/to/freqtrade/freqtrade/rpc/api_server/ui/installed/*
cp -a dist/. /path/to/freqtrade/freqtrade/rpc/api_server/ui/installed/
```

Restart your bot — the next time you open the web UI, you'll be on this fork.

> Tip: use `cp -al` instead of `cp -a` if you want hardlinks, so that any rebuild of `dist/` propagates instantly without re-copying.

#### CORS / API config

No change vs. upstream: this fork still expects a Freqtrade API on `localhost:8080` (or wherever you configured it), and still requires [CORS to be correctly configured](https://www.freqtrade.io/en/stable/rest-api/#cors) if you serve the UI from a different origin than the API.

### Standalone / Docker

Same as upstream:

```bash
docker compose up -d
# UI available on http://localhost:3000
```

You still need a running Freqtrade bot with CORS properly set up.

### Developer setup

```bash
pnpm install
pnpm run dev          # hot-reload dev server
pnpm run build        # production build into dist/
pnpm run lint         # lint & auto-fix
```

The dev server expects a Freqtrade API to be reachable — either on `localhost:8080` with CORS configured, or via the Vite proxy.

### Tutorials & posts (FR)

I publish French-language tutorials on algorithmic trading with Freqtrade here:

**<https://buymeacoffee.com/freqtrade_france/posts>**

Strategy design, hyperopt methodology, live feedback, fork rationale, etc.

### License

Same license as upstream FreqUI (GPL-3.0). See `LICENSE`.

---

## Français

### Pourquoi ce fork ?

Je fais tourner plusieurs instances de Freqtrade en parallèle (DCA short sur Hyperliquid, DCA long sur Binance, stratégies expérimentales, etc.). La FreqUI de base est bien pour monitorer *un* bot, mais elle devient vite bruyante dès qu'on veut les **comparer** ou comprendre **où se trouve le risque** sur l'ensemble de la flotte.

Ce fork est ma réponse à ce problème. Il reconstruit le dashboard autour de :

- **Vues orientées flotte** — tous les bots en même temps avec colonnes custom, groupes, tags, tri, alertes par bot, et réorganisation par glisser-déposer.
- **Popovers riches** — chaque chiffre (profit, win/loss, balance, trades, état DCA…) s'ouvre en carte contextuelle détaillée.
- **Contexte de marché** — benchmarks BTC / ETH / SOL, Fear & Greed, heatmap calendrier, pour que les chiffres de profit ne flottent pas dans le vide.
- **Vue risque assumée** — exposition nette/brute, jauge de drawdown, distance de liquidation, stress test.
- **i18n complète** — anglais, français, allemand, espagnol, italien, portugais (plus de 1 200 clés).

Le tout repose sur la base de FreqUI (Vue 3 + PrimeVue + ECharts + Tailwind) et reste compatible avec n'importe quelle API Freqtrade.

### Ce que ce fork apporte vs. upstream

Inventaire concret (148 fichiers modifiés, +38 413 / -1 676 lignes vs. `freqtrade/frequi`). Points forts :

#### Nouvelles vues et widgets

- **Dashboard custom** (`DashboardViewCustom.vue`) — nouveau layout, widgets enhanced réorganisables par drag & drop.
- **Vue Paramètres custom** (`SettingsViewCustom.vue`) — refonte glassmorphism, sections en cartes (connexions, notifications, apparence, À propos).
- **Comparaison de bots** — ~4 500 lignes ajoutées : colonnes custom, tags, filtres, tri, groupes, 13 types d'alertes, popovers par colonne, ré-ordonnancement, export CSV, raccourcis clavier.

<p align="center">
  <img src=".readme_illustrations/bot-comparison-columns.png" alt="Sélecteur de colonnes visibles" width="270">
  &nbsp;
  <img src=".readme_illustrations/bot-comparison-sort.png" alt="Tri par colonne" width="270">
  &nbsp;
  <img src=".readme_illustrations/bot-comparison-filter.png" alt="Filtres" width="270">
</p>
<p align="center">
  <img src=".readme_illustrations/bot-comparison-alerts.png" alt="Paramètres d'alertes (13 types)" width="270">
  &nbsp;
  <img src=".readme_illustrations/bot-comparison-groups.png" alt="Groupes de bots / sous-dossiers" width="350">
</p>

- **Market Pulse** — suivi BTC / ETH, Fear & Greed, performance marché 24 h.

<p align="center"><img src=".readme_illustrations/widget-market-pulse.png" alt="Widget Market Pulse" width="650"></p>

- **Activity Timeline** — timeline événementielle (entrées, sorties, DCA, alertes, erreurs) avec filtres et regroupement.

<p align="center"><img src=".readme_illustrations/widget-activity-timeline.png" alt="Widget Activity Timeline" width="650"></p>

- **Heatmap de performance** — heatmap calendrier (jour / semaine / mois).

<p align="center"><img src=".readme_illustrations/widget-performance-heatmap.png" alt="Widget Performance Heatmap" width="650"></p>

- **Risk Overview** — exposition nette & brute, jauge de drawdown, résumé risque ouvert.

<p align="center"><img src=".readme_illustrations/widget-risk-overview.png" alt="Widget Risk Overview" width="650"></p>

- **Stress Test** — scénarios de choc de -50 % à +50 %, liquidation plafonnée.

<p align="center"><img src=".readme_illustrations/widget-stress-test.png" alt="Widget Stress Test" width="650"></p>

- **Trades Log enhanced** — journal compact filtrable.

<p align="center"><img src=".readme_illustrations/widget-trades-log.png" alt="Widget Trades Log" width="650"></p>

- **Log Viewer enhanced** — logs colorés, filtres heartbeat / WebSocket, buffer de 500 lignes. Également une refonte complète de la page Logs.

<p align="center"><img src=".readme_illustrations/widget-log-console.png" alt="Widget Log Console" width="750"></p>
<p align="center"><img src=".readme_illustrations/logs-page-redesign.png" alt="Page Logs — refonte complète" width="700"></p>

#### Versions améliorées des widgets existants

Remplacements drop-in, même rôle mais avec drill-down, onglets et statistiques :

- `ProfitBenchmarkChart.vue` — unifie Profit + benchmarks BTC/ETH/SOL (via CoinGecko).

<p align="center">
  <img src=".readme_illustrations/widget-profit-benchmarks-combined.png" alt="Profit &amp; Benchmarks — vue combinée avec courbe BTC" width="430">
  &nbsp;
  <img src=".readme_illustrations/widget-profit-benchmarks-per-bot.png" alt="Profit &amp; Benchmarks — vue par bot" width="430">
</p>

- `ProfitDistributionEnhanced.vue` — 5 onglets, filtres, ECharts.

<p align="center"><img src=".readme_illustrations/widget-profit-distribution.png" alt="Widget Profit Distribution" width="650"></p>

- `ProfitOverTimeEnhanced.vue` — 3 modes (cumulatif / par trade / glissant), timeframes, stats.
- `CumulativeProfitEnhanced.vue` — 4 onglets, zoom, stats live.
- `OpenTradesEnhanced.vue` / `ClosedTradesEnhanced.vue` — colonnes custom, badges exit reason, pagination, popovers.

#### Popovers contextuels

Chaque métrique devient cliquable et s'ouvre en carte détaillée :

- Profit : ouvert / fermé / Summary / période (mensuel & annuel avec projections SVG) / objectif.
- Trades : infos trades ouverts, détail trade (échelle DCA, stoploss, liquidation), santé durée (box plot / percentiles).
- Balance : carte balance, Summary Balance, Win/Loss, Summary Win/Loss, Summary Trades.
- Fiches Bot / Exchange / Currency : courbe d'equity, frais, KYC, backing et risques des tokens.
- Popover stoploss : mini graphique prix SVG (5 000 bougies, SL et liquidation).
- Carte d'alertes détaillée groupée par position.

<table>
  <tr>
    <td align="center"><img src=".readme_illustrations/popover-bot-info.png" alt="Popover info bot" width="260"></td>
    <td align="center"><img src=".readme_illustrations/popover-exchange-info.png" alt="Popover info exchange" width="260"></td>
    <td align="center"><img src=".readme_illustrations/popover-trade-overview.png" alt="Popover vue d'ensemble du trade" width="220"></td>
  </tr>
  <tr>
    <td align="center"><img src=".readme_illustrations/popover-open-positions.png" alt="Popover toutes positions ouvertes" width="240"></td>
    <td align="center"><img src=".readme_illustrations/popover-dca-escalations.png" alt="Popover DCA &amp; escalades de coût" width="220"></td>
    <td align="center"><img src=".readme_illustrations/popover-periodic-profit.png" alt="Popover analyse profit périodique" width="240"></td>
  </tr>
  <tr>
    <td align="center"><img src=".readme_illustrations/popover-closed-profit.png" alt="Popover profits fermés (tous bots)" width="280"></td>
    <td align="center"><img src=".readme_illustrations/popover-open-profit.png" alt="Popover profit ouvert (tous bots)" width="280"></td>
    <td align="center"><img src=".readme_illustrations/popover-win-loss.png" alt="Popover win/loss global" width="260"></td>
  </tr>
  <tr>
    <td align="center"><img src=".readme_illustrations/popover-exit-reasons.png" alt="Popover distribution des exit reasons" width="240"></td>
    <td align="center"><img src=".readme_illustrations/popover-price-levels.png" alt="Popover niveaux de prix &amp; zones" width="260"></td>
    <td align="center"><img src=".readme_illustrations/popover-trade-duration.png" alt="Popover durée du trade vs historique du bot" width="260"></td>
  </tr>
</table>

#### Nouveaux composables & stores

- `tradeColumns.ts`, `exchangeRates.ts`, `benchmarkData.ts`, `browserNotifications.ts`, `summaryCurrency.ts`, `useAlertDetection.ts`, `useConfigExport.ts`, `useLogFiltering.ts`, `usePopoverHover.ts`, `useTradePopover.ts`.
- Nouveaux stores : `botComparison.ts`, `logConsole.ts`. Stores existants étendus : `ftbotwrapper.ts`, `ftbot.ts`, `layout.ts`, `settings.ts`.

#### i18n

Traductions complètes en **EN / FR / DE / ES / IT / PT**, lazy-loadées, avec sélecteur de langue. ~1 200 clés par locale.

#### Sources de données externes

- CoinGecko (sans clé API) — prix crypto, historique, benchmarks.
- Alternative.me — Fear & Greed index.

Les deux sont appelées côté UI uniquement et cachées côté client (5 à 10 min).

### Comment utiliser ce fork avec Freqtrade

Deux méthodes.

#### Option A — utiliser mon fork de Freqtrade (recommandé)

Je maintiens un fork complémentaire de Freqtrade lui-même :

**<https://github.com/titouannwtt/freqtrade-fork>**

Dans ce fork, `freqtrade install-ui` pointe déjà sur cette UI au lieu de l'upstream. Rien à faire de spécial :

```bash
git clone https://github.com/titouannwtt/freqtrade-fork.git
cd freqtrade-fork
./setup.sh -i              # ou votre méthode d'install habituelle
freqtrade install-ui        # récupère depuis titouannwtt/frequi-fork
freqtrade trade --config user_data/config.json
```

Puis ouvrir l'UI sur le port de l'API (par défaut `http://127.0.0.1:8080`).

#### Option B — remplacement manuel dans un Freqtrade existant

Si vous voulez garder le Freqtrade officiel et seulement swapper l'UI, buildez ce fork localement et copiez `dist/` dans le dossier UI de Freqtrade :

```bash
# 1. Build de l'UI
git clone https://github.com/titouannwtt/frequi-fork.git
cd frequi-fork
pnpm install
pnpm run build

# 2. Remplacer l'UI servie par votre Freqtrade
#    (ajustez le chemin vers votre install freqtrade)
rm -rf /chemin/vers/freqtrade/freqtrade/rpc/api_server/ui/installed/*
cp -a dist/. /chemin/vers/freqtrade/freqtrade/rpc/api_server/ui/installed/
```

Redémarrez le bot — la prochaine ouverture de l'UI sera sur ce fork.

> Astuce : utilisez `cp -al` au lieu de `cp -a` pour créer des hardlinks, ce qui fait que tout rebuild de `dist/` se propage instantanément sans recopier.

#### CORS / config API

Rien de changé vs. upstream : ce fork attend toujours une API Freqtrade sur `localhost:8080` (ou là où vous l'avez configurée), et nécessite toujours une [config CORS correcte](https://www.freqtrade.io/en/stable/rest-api/#cors) si l'UI est servie depuis une origine différente de l'API.

### Standalone / Docker

Identique à l'upstream :

```bash
docker compose up -d
# UI dispo sur http://localhost:3000
```

Il faut toujours un bot Freqtrade en face, avec CORS configuré.

### Setup dev

```bash
pnpm install
pnpm run dev          # serveur de dev hot-reload
pnpm run build        # build production dans dist/
pnpm run lint         # lint & auto-fix
```

Le serveur de dev a besoin d'une API Freqtrade accessible — soit directement sur `localhost:8080` avec CORS, soit via le proxy Vite.

### Tutoriels (FR)

Je publie mes tutoriels sur le trading algorithmique avec Freqtrade ici :

**<https://buymeacoffee.com/freqtrade_france/posts>**

Design de stratégie, méthodo hyperopt, retours d'expérience live, choix de fork, etc.

### Licence

Même licence que FreqUI upstream (GPL-3.0). Voir `LICENSE`.
