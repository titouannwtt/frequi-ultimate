# Inventaire des modifications — Fork FreqUI

**Upstream** : `freqtrade/frequi` (commit `1ec764d2`)
**Fork** : `titouannwtt/frequi`
**Total** : 98 fichiers, +31 224 / -1 313 lignes

---

## Suivi upstream — FreqUI 3.1.1 (2026-07-31)

**Upstream release** : [freqtrade/frequi 3.1.1](https://github.com/freqtrade/frequi/releases/tag/3.1.1)
**Base fork** : cherry-picks jusqu'à 3.1.0 (`57ba2a21`, `7e7cce62`, `ec4a8ebb`, `c7e0c184`)
**Compare** : https://github.com/freqtrade/frequi/compare/3.1.0...3.1.1 — 103 commits, 38 fichiers

### TL;DR — impact fork

Malgré la note upstream laconique ("aligned with freqtrade monthly release"), 3.1.1 contient une **refonte structurelle majeure** : migration vers le **file-based routing (Nuxt-style)**, `src/views/*.vue` → `src/pages/*.vue`, réécriture complète de `src/router/index.ts`.

Cette refonte est **incompatible en l'état** avec les vues custom du fork (`DashboardViewCustom.vue`, `SettingsViewCustom.vue`, `StrategyDevView.vue`, `TradeJournalView.vue`, `ChartsView.vue`) et son `router/index.ts` custom.

Un `git merge 3.1.1 --allow-unrelated-histories` produit **146 conflits** — la stratégie merge n'est pas viable. On reste sur la stratégie **cherry-pick sélectif** déjà utilisée pour 3.0.x / 3.1.0.

### Découpage des changements upstream

**🔴 Rupture / architecture (à décider avant tout portage)**

| Commit | Sujet | Impact fork |
|--------|-------|-------------|
| `4471057a` (PR #2966) | `feat: file_router` (merge) | ⚠️ Migre `views/` → `pages/`. Le fork garde ses vues custom sous `views/`. Router upstream réécrit 99 lignes vs 112 lignes custom du fork. |
| `918e71a7` | `feat: convert final views to file based routing` | ⚠️ Idem |
| `341ba694` | `feat: add missing routes as base files` | ⚠️ Idem |
| `7e4250a3` | `feat: rename existing routes` | ⚠️ Idem |
| `6a3f7868` | `feat: first steps to move to file based routing` | ⚠️ Idem |
| `cc6270fc` | `feat: update typechecking and HMR` | Coupé au routing — à porter avec |

Ne **pas** porter la migration file-router dans une PR "sync auto". Elle mérite sa propre décision produit + PR dédiée + validation e2e sur toutes les vues custom.

**🟡 Fonctionnel (portable mais avec conflit)**

| Commit | Sujet | Impact fork |
|--------|-------|-------------|
| `6bb0c095` | `feat: differentiate between offline and loggedout bots` | Touche `BotComparisonList.vue` (48 lignes) + `botComparison.ts`. Le fork a déjà customisé lourdement `BotComparisonList.vue` (colonne Max Drawdown, éditeur de config par bot). Cherry-pick à faire à la main. ~30 min. |

**🟢 Sûr / trivial (dep bumps et CI)**

À laisser à Dependabot du fork (déjà son mode d'opération, cf. PRs `#22`, `#23`, `#24`, `#25`, `#26`, `#33`) :

- npm : `@nuxt/ui` 4.9→4.10, groupe `vue` (5 bumps), `reka-ui` 2.9.10→2.10.1, `humanize-duration` 3.33.2→3.34.0, `axios` 1.18.0→1.18.1
- dev : `vite` 8.1.0→8.1.5, `prettier` 3.8.4→3.9.6, `happy-dom` 20.10.5→20.11.0, groupe `tailwindcss`, `eslint` 10.5→10.6, `vitest` 4.1.9→4.1.10, `@vitejs/plugin-vue` 6.0.7→6.0.8, `@types/node` 25.9.3→26.1.1, `globals` 17.6→17.7, `@playwright/test` 1.61.0→1.61.1
- toolchain : `pnpm` 11.11→11.17
- CI/Docker : `actions/checkout`, `actions/setup-node`, `docker/login-action`, `zizmorcore/zizmor-action` 0.5.6→0.6.1, `nginx` 1.31.2→1.31.3, `node` 26.4→26.5, `alexellis/upload-assets` 0.4.1→0.5.0

### Plan d'action

1. **Cette PR** : ajoute ce suivi. Ne modifie **aucun code** applicatif. Zéro risque.
2. **PR suivi 1 — `feat: offline vs loggedout bots`** : cherry-pick manuel de `6bb0c095` avec merge à la main sur `BotComparisonList.vue`.
3. **PR suivi 2 — architecturale** : décider si on adopte le file-based routing upstream. Si non, geler ce point de divergence.
4. **Dependabot** : laisser tourner.

---

## Fichiers AJOUTÉS (40 fichiers, ~19 000 lignes)

| Fichier | Lignes | Résumé | Risque |
|---------|--------|--------|--------|
| `src/locales/en.ts` | +1554 | Traductions anglaises (1272 clés) — système i18n complet | Cosmétique |
| `src/locales/fr.ts` | +1549 | Traductions françaises avec accents | Cosmétique |
| `src/locales/de.ts` | +1547 | Traductions allemandes | Cosmétique |
| `src/locales/es.ts` | +1547 | Traductions espagnoles | Cosmétique |
| `src/locales/it.ts` | +1547 | Traductions italiennes | Cosmétique |
| `src/locales/pt.ts` | +1490 | Traductions portugaises | Cosmétique |
| `src/locales/index.ts` | +49 | Plugin vue-i18n, lazy loading des langues, sélecteur | Faible |
| `src/components/ftbot/ProfitBenchmarkChart.vue` | +1192 | Widget unifié Profit + Benchmarks (BTC/ETH/SOL via CoinGecko) | Moyen — remplace 2 widgets |
| `src/components/ftbot/BotProfitComparisonChart.vue` | +~370 | Widget barres profit/perte par bot : sélecteur de période (24h→1an→All), filtre live/dry/all, devise ou %, total flotte. Croise les bots sélectionnés (Comparaison des bots) avec son filtre. | Faible — nouveau widget |
| `src/utils/botProfit.ts` | +~130 | Agrégation profit par bot + bornes de période (date-fns), fonctions pures testées | Faible |
| `src/components/ftbot/ProfitDistributionEnhanced.vue` | +854 | Distribution des profits (5 onglets, filtres, ECharts) | Moyen — remplace widget existant |
| `src/components/ftbot/ProfitOverTimeEnhanced.vue` | +848 | Profit temporel (3 modes, timeframes, stats) | Moyen — remplace widget existant |
| `src/components/ftbot/MarketPulse.vue` | +791 | Tableau de bord marché (BTC/ETH, Fear&Greed, performance) | Faible — nouveau widget |
| `src/components/ftbot/OpenTradesEnhanced.vue` | +747 | Trades ouverts (colonnes custom, badges, popovers) | Moyen — remplace TradeList |
| `src/components/ftbot/TradesInfoCard.vue` | +709 | Popover glassmorphism pour colonne Trades | Faible — popover card |
| `src/components/ftbot/PeriodProfitCard.vue` | +693 | Popover profit mensuel/annuel avec projections SVG | Faible |
| `src/components/ftbot/CumulativeProfitEnhanced.vue` | +686 | Profit cumulé (4 onglets, zoom, stats) | Moyen — remplace CumProfitChart usage |
| `src/components/ftbot/ClosedTradesEnhanced.vue` | +682 | Trades fermés (pagination, exit reason badges) | Moyen — remplace TradeList |
| `src/components/ftbot/ActivityTimeline.vue` | +671 | Timeline d'activité (events riches, filtres, groupement) | Faible — nouveau widget |
| `src/components/ftbot/OpenProfitCard.vue` | +648 | Popover profit ouvert (positions, DCA, durée historique) | Faible |
| `src/components/ftbot/RiskOverview.vue` | +521 | Aperçu risques (exposition net/brut, jauge, drawdown) | Faible — nouveau widget |
| `src/components/ftbot/StoplossChartPopover.vue` | +491 | Mini graphique prix SVG (5000 bougies, SL, liq) | Faible |
| `src/components/ftbot/AlertDetailCard.vue` | +481 | Popover alertes détaillé groupé par position | Faible |
| `src/components/ftbot/ClosedProfitCard.vue` | +467 | Popover profit fermé (donut W/L, performance grid) | Faible |
| `src/components/ftbot/ExchangeInfoCard.vue` | +428 | Fiche exchange (13 exchanges, frais, KYC, drapeaux) | Faible |
| `src/components/ftbot/SummaryProfitCard.vue` | +412 | Popover Summary profit (comparaison entre bots) | Faible |
| `src/components/ftbot/BotInfoCard.vue` | +395 | Popover info bot (equity curve, donut, métriques) | Faible |
| `src/components/ftbot/CurrencyInfoCard.vue` | +388 | Fiche currency (16+ tokens, backing, risques) | Faible |
| `src/components/ftbot/TradesLogEnhanced.vue` | +335 | Journal trades compact filtrable | Faible — nouveau widget |
| `src/components/ftbot/TradeDetailPopover.vue` | +320 | Popover détail trade (DCA, prix, stoploss) | Faible |
| `src/components/ftbot/SummaryWinLossCard.vue` | +307 | Popover Summary W/L (donut, breakdown par bot) | Faible |
| `src/components/ftbot/SummaryBalanceCard.vue` | +291 | Popover Summary Balance (donut, conversion) | Faible |
| `src/components/ftbot/LogViewerEnhanced.vue` | +286 | Logs colorés, filtres heartbeat/WS, 500 lignes | Faible |
| `src/components/ftbot/PerformanceHeatmap.vue` | +279 | Carte thermique calendrier (jour/semaine/mois) | Faible — nouveau widget |
| `src/components/ftbot/SummaryTradesCard.vue` | +263 | Popover Summary Trades (capacité, capital, winrate) | Faible |
| `src/components/ftbot/BalanceCard.vue` | +256 | Popover balance (croissance, allocation) | Faible |
| `src/components/ftbot/WinLossCard.vue` | +232 | Popover W/L (grand donut, profit factor) | Faible |
| `src/components/ftbot/StressTestCard.vue` | +213 | Test de stress (-50% à +50%, liquidation cappée) | Faible — nouveau widget |
| `src/composables/tradeColumns.ts` | +188 | Composable partagé colonnes trades (DRY) | Faible |
| `src/components/ftbot/ProfitGoalBar.vue` | +168 | Barre objectif profit (désactivée mais présente) | Cosmétique |
| `src/components/ftbot/DurationHealthPopover.vue` | +140 | Popover santé durée (box plot, percentile) | Faible |
| `src/composables/exchangeRates.ts` | +140 | Taux de change CoinGecko (refresh 5min) | Faible |
| `src/composables/benchmarkData.ts` | +116 | Fetch historique crypto CoinGecko (cache 10min) | Faible |
| `src/composables/browserNotifications.ts` | +84 | Notifications navigateur pour alertes | Faible |
| `src/composables/summaryCurrency.ts` | +31 | Composable devise Summary (sync localStorage) | Faible |

## Fichiers MODIFIÉS (54 fichiers)

| Fichier | +/- | Résumé | Risque |
|---------|-----|--------|--------|
| `src/components/ftbot/BotComparisonList.vue` | +4530/-155 | **Refonte majeure** : colonnes custom, tags, filtres, tri, groupes, alertes (13 types), custom tags, popovers, drag, export CSV, raccourcis clavier | **Breaking** — réécriture quasi-complète |
| `src/views/SettingsView.vue` | +495/-184 | Refonte glassmorphism, sections cards, About, notifications browser, visibilité | Moyen — UI modifiée |
| `src/views/DashboardView.vue` | +209/-77 | Nouveaux widgets, widgets enhanced remplacent les anciens, layout store | **Moyen** — structure dashboard changée |
| `src/components/layout/NavBar.vue` | +74/-37 | Glassmorphism, icônes tabs, PDF export, i18n | Moyen — navbar modifiée |
| `src/views/TradingView.vue` | +65/-33 | Icônes tabs, i18n, hide simultaneous entries toggle | Faible |
| `src/types/botComparison.ts` | +99/-0 | Nouveaux types : ColumnDef, BotAlertConfig, BotGroup, CustomTag, alerts | Faible — ajouts |
| `src/stores/ftbotwrapper.ts` | +48/-10 | toggleBotsByExchange/Currency, background trades fetch, group toggle | Faible |
| `src/components/ftbot/BotProfit.vue` | +52/-29 | i18n sur toutes les métriques, v-tooltip, withdrawal display | Faible |
| `src/components/ftbot/TradeList.vue` | +44/-40 | i18n headers et labels | Cosmétique |
| `src/components/ftbot/TradeDetail.vue` | +33/-31 | i18n labels | Cosmétique |
| `src/components/ftbot/BotStatus.vue` | +29/-27 | i18n | Cosmétique |
| `src/views/ChartsView.vue` | +29/-8 | Glassmorphism settings panel, i18n | Cosmétique |
| `src/components/charts/CandleChartContainer.vue` | +27/-9 | Hide simultaneous entries toggle, i18n, short entries red | Faible |
| `src/components/ftbot/BacktestRun.vue` | +26/-24 | i18n | Cosmétique |
| `src/stores/layout.ts` | +20/-8 | Nouveaux widgets dans DashboardLayout enum + defaults | Faible |
| `src/components/ftbot/BotPerformance.vue` | +17/-14 | i18n | Cosmétique |
| `src/components/ftbot/BotControls.vue` | +16/-15 | i18n | Cosmétique |
| `src/components/ftbot/ForceEntryForm.vue` | +16/-14 | i18n | Cosmétique |
| `src/stores/ftbot.ts` | +16/-45 | closedTradesLoaded/Loading flags, lastSeenOnline, trades fetch | Faible |
| `src/components/ftbot/BacktestResultAnalysis.vue` | +16/-13 | i18n | Cosmétique |
| `src/components/ftbot/BacktestResultPeriodBreakdown.vue` | +16/-13 | i18n | Cosmétique |
| `src/components/ftbot/ForceExitForm.vue` | +15/-14 | i18n | Cosmétique |
| `src/components/ftbot/PeriodBreakdown.vue` | +14/-12 | i18n | Cosmétique |
| `src/components/ftbot/PairListLive.vue` | +12/-9 | i18n | Cosmétique |
| `src/components/ftbot/BacktestResultTablePer.vue` | +11/-8 | i18n | Cosmétique |
| `src/components/ftbot/BotBalance.vue` | +10/-8 | i18n | Cosmétique |
| `src/components/ftbot/DownloadDataMain.vue` | +9/-7 | i18n | Cosmétique |
| `src/components/charts/SingleCandleChartContainer.vue` | +9/-6 | i18n entry/exit labels | Cosmétique |
| `src/components/ftbot/PairLockList.vue` | +8/-6 | i18n | Cosmétique |
| `src/components/ftbot/TradeActionsPopover.vue` | +6/-3 | i18n | Cosmétique |
| `src/components/ftbot/ReloadControl.vue` | +5/-2 | i18n | Cosmétique |
| `src/main.ts` | +5/-0 | Import i18n + Tooltip directive | Faible |
| `src/auto-imports.d.ts` | +58/-0 | Auto-imports types | Cosmétique |
| `src/components/charts/CandleChart.vue` | +4/-4 | Short entries en rouge | Cosmétique |
| `src/components/charts/CumProfitChart.vue` | +4/-0 | Minor fix | Cosmétique |
| `src/types/profit.ts` | +4/-0 | capital_withdrawal, profit_net_coin fields | Faible |
| `src/router/index.ts` | +4/-4 | Route adjustments | Cosmétique |
| `src/types/balance.ts` | +2/-0 | capital_withdrawal field | Faible |
| `src/composables/loginInfo.ts` | +2/-0 | botName computed exposed | Faible |
| `src/utils/backtestMetrics.ts` | +2/-6 | Minor fix | Cosmétique |
| `package.json` | +2/-3 | vue-i18n dependency added | Faible |
| `src/types/features.ts` | +1/-3 | Feature flag adjustment | Cosmétique |
| `src/stores/settings.ts` | +1/-0 | hideSimultaneousEntryExit setting | Cosmétique |
| `src/components/charts/PlotConfigurator.vue` | +1/-1 | Minor fix | Cosmétique |
| `src/components/ftbot/StrategySelect.vue` | +1/-1 | Minor fix | Cosmétique |
| `src/components/ftbot/BacktestResultChart.vue` | +4/-1 | i18n | Cosmétique |
| `src/views/BacktestingView.vue` | +13/-9 | i18n | Cosmétique |
| `src/views/LogView.vue` | +1/-1 | Use LogViewerEnhanced | Faible |
| `pnpm-lock.yaml` | +72/-18 | Lock file update (vue-i18n) | Cosmétique |
| `src/styles/tailwind.css` | +31/-0 | Print CSS, popover z-index, row hover styles | Cosmétique |

## Fichiers SUPPRIMÉS (4 fichiers)

| Fichier | Lignes | Résumé | Risque |
|---------|--------|--------|--------|
| `src/components/charts/WalletHistoryChart.vue` | -361 | Supprimé (remplacé par widgets enhanced) | Moyen — breaking si référencé |
| `src/types/daily.ts` | -16 | Types supprimés (inutilisés) | Faible |
| `src/types/backtest.ts` | -10 | Types déplacés/supprimés | Faible |
| `pnpm-workspace.yaml` | -4 | Config workspace supprimée | Cosmétique |
| `src/components/ftbot/BacktestGraphs.vue` | -10 | Supprimé | Faible |

## Résumé des risques

| Niveau | Nombre | Description |
|--------|--------|-------------|
| **Breaking** | 2 | BotComparisonList (réécriture), DashboardView (structure) |
| **Moyen** | 8 | Widgets remplacés, Settings, NavBar, LogView |
| **Faible** | 44 | Nouveaux composants, composables, stores, types |
| **Cosmétique** | 44 | i18n, minor fixes, styles |

## Dépendances ajoutées
- `vue-i18n` ^11.3.0

## APIs externes utilisées
- CoinGecko (gratuit, sans clé) : prix crypto, historique, benchmarks
- Alternative.me (gratuit) : Fear & Greed Index
