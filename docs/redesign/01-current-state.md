# 01 - État actuel de FreqUI Ultimate (cartographie avant refonte)

Synthèse de 9 cartographies en lecture seule (branche `redesign/rust-gateway`, worktree `/home/moutonneux/frequi/.worktrees/redesign`).
Les chemins sont relatifs à `src/` sauf mention contraire. Abréviations : `CL` = `components/ftbot/BotComparisonList.vue`,
`DVC` = `views/DashboardViewCustom.vue`, `FT` = `/home/moutonneux/freqtrade/freqtrade/rpc/api_server/`.

## 1. Résumé

- Le navigateur fait tout : il détient la liste des bots (`localStorage.ftAuthLoginInfo`, JWT par bot), interroge chaque bot directement (fan-out `/status` 10 s, 8 endpoints en tier lent 60 s, `/logs` 30 s, `/rate_metrics` 15-30 s, `/trades` complet 10 min, 1 WebSocket par bot) et recalcule tous les agrégats de flotte.
- La lenteur vient du poids de rendu (20 slots de widgets, jusqu'à ~15 instances ECharts, tableau de flotte de 7,2k lignes non virtualisé, ~30 popovers) et des recalculs O(N bots) ou O(trades) à chaque tick.
- Le dashboard compte 20 widgets dont ~60 % se recouvrent : 9 vues P&L, 6 vues infra/rate, 4 vues risque/exposition, 3 tableaux de bots, 2 consoles de logs, 18 cartes de survol.
- Une grande partie du code est morte (au moins 17 fichiers non montés : CumulativeProfitEnhanced, ProfitOverTimeEnhanced, PerformanceHeatmap, FleetOverview, TradeList, TradesLogEnhanced, StoplossChartPopover, ProfitRangePopover, ProfitGoalBar, DashboardView, SettingsView, ChartsView non routée, etc.).
- Toute l'interface détaillée est accessible uniquement au survol (hover) et au drag-and-drop HTML5 : inutilisable sur téléphone.
- Bugs argent réel confirmés : ForceExitForm/ForceEntryForm agissent sur `activeBot` et non sur le bot de la ligne (mauvais bot possible) ; confirmation de forceexit désactivable globalement ; pas de verrou anti double clic.
- Bugs métier : alerte `noTradeActivity` jamais déclenchée (secondes vs ms), popover de configuration des alertes sans déclencheur, tri `currentProfit` inopérant, taux EUR jamais chargé, capital de départ faux sur wallet partagé dans 3 widgets sur 4.
- Le backend du fork expose déjà l'essentiel en agrégé (`/fleet/snapshot`, `/fleetview/*`) via le démon ftcache (socket Unix) et les SQLite des bots : une passerelle Rust peut tout relire sans toucher freqtrade, sauf les écritures (réconciliation, forceexit) qui restent proxifiées.
- L'UI est servie depuis le disque par le bot :9400 (`ui/installed`, relu à chaque requête) : un remplacement de fichiers prend effet sans redémarrage de bot.
- Contrainte de migration n°1 : conserver l'origine `http://<hôte>:9400` et les clés `ftAuthLoginInfo` / `ftBotComparison` (ids `ftbot.N`) pour que les ~24-40 bots, groupes, tags et alertes réapparaissent sans ressaisie.

## 2. Inventaire complet des widgets et pages

Verdicts : **keep** (garder, refondre), **merge** (fusionner dans un composant cible, cf. section 3), **drop** (supprimer), **tools** (déplacer dans le menu Outils), **primitive** (extraire en composant/fonction partagé), **rust** (calcul ou donnée déplacé dans la passerelle). Quand deux cartographies proposaient des verdicts différents, le verdict retenu est indiqué et l'écart signalé dans la raison.

### 2.1 Tableau de flotte (BotComparisonList et dépendances)

| # | Nom | Fichier | Rôle | Source de données | Verdict | Raison |
|---|---|---|---|---|---|---|
| 1 | Modèle de lignes (bots, groupes, Summary) | CL:3109-3614, 5088-5262 | Lignes bot + en-têtes de groupe + ligne Summary (somme des bots sélectionnés uniquement, exclut les lignes périmées) | allProfit, allOpenTrades, allBotState, allBalance, /fleet/snapshot 10 s, replayStore | rust | Agrégats O(N) par tick, à calculer côté passerelle ; garder la règle « jamais sommer du périmé » |
| 2 | Système de 22 colonnes | CL:1500-1700, 2168-2206, 3792-3847 | Éditeur de colonnes, ordre, fit-to-screen | compStore.visibleColumnIds/columnOrder | merge | 8 colonnes sont des faits de config (port, stratégie, stake...) à regrouper ou déplacer en détail bot ; illisible sur mobile |
| 3 | Cellule nom du bot | CL:5262-5700 | Icône, alerte, renommage, dossier, tags, uptime, sélecteur devise Summary | botStores, allBotAlerts, useExchangeRates | merge | Ligne de 3 lignes de haut, doublons tags/colonnes ; à compacter |
| 4 | Colonne statut + menu par bot + dialog | CL:5704-5830, 2214-2297, 6770-6966 | Start, Pause, Reload, Stop, Force exit all, liens logs/trades/journal/stratdev/replay/config | REST direct par bot | keep | Actions argent réel à refondre (feedback invisible, Start/Pause/Reload sans confirmation, 1 popover par bot) |
| 5 | Colonnes profit/trades/balance/W-L + cartes | CL:5866-6330, 4125-4530 | ProfitPill, jauges, 18 cartes au survol | getters botStore recalculés au survol | merge | Doublonne KPI, tables et graphes ; survol uniquement |
| 6 | Colonne drawdown max (bot, groupe, Summary) | CL:681-738, 6154-6208 ; utils/maxDrawdown.ts | Drawdown réalisé et open-inclusive | botStores[id].trades complets | rust | 3 définitions divergentes (colonne, tri, alerte) ; groupe/Summary non mémoïsés |
| 7 | Colonne dernier trade (+ restes de sparkline) | CL:814-885, 6332-6382, 3616-3644 | Dernier trade fermé, « +N » du jour | trades complets par bot | rust | Deux passes par bot par tick ; code mort sparkline |
| 8 | Projection mensuelle/annuelle + conversion FX Summary | CL:2525-2576, 3384-3441 | Extrapolation linéaire du profit, conversion de devise | allProfit, CoinGecko navigateur | drop | Extrapolations trompeuses ; toute la flotte est en USDC |
| 9 | Système de filtres | CL:1940-2149, 3897-4026 | Statut, exchange, devise, mode, tag ; force la désélection | allBotState, compStore.botFilters | merge | Filtre persistant qui masque silencieusement des bots ; pas de recherche texte |
| 10 | Système de tri | CL:1890-1938, 2977-3083, 3449-3543 | 15 critères, ordre manuel DnD | lignes + allProfit | merge | Accessible seulement par la touche `s` ; cas `currentProfit` absent ; comparateur dupliqué |
| 11 | Groupes (dossiers) | CL:2630-2975, 4528-4747, 4922-5084 | Création, renommage, emoji, repli, agrégats | compStore.botGroups | merge | 4 UI différentes pour la même chose ; doit devenir le concept d'organisation principal |
| 12 | Système d'alertes (14 types) | composables/useAlertDetection.ts ; stores/botComparison.ts:48-186 ; CL:3646-3707, 4748-4921 | Détection client, config, notifications | botStores, lastLogs, alertConfig | rust | Bugs (déclencheur absent, ms/s, balance) ; n'existe que si l'onglet est ouvert |
| 13 | Raccourcis clavier | CL:2299-2352 | Esc, Ctrl+A, 1-9, f, s | tableItems | merge | Ctrl+A détourné, touches sans modificateur ; centraliser (palette de commandes) |
| 14 | Point d'entrée éditeur de config + modales | CL:39-42, 6962-6964 | Ouvre BotConfigEditorModal (Monaco) et DryReplayModal | configEditorStore, replayStore | tools | Action à risque à 2 clics ; modales à sortir en singletons applicatifs |
| 15 | Infrastructure de popovers au survol | CL:174-740 ; composables/usePopoverHover.ts | Timers, Floating UI, closeAllPopovers | aucune | primitive | ~17 copies de la même machine à états (~600 lignes) |
| 16 | Repli fleet snapshot et âge des données | CL:59-140, 3318-3368 ; useFleetSnapshot.ts | Lignes de secours avec badge d'âge | /fleet/snapshot | rust | Remplacé par la passerelle ; garder la divulgation d'âge |
| 17 | Persistance et migration de l'état UI | stores/botComparison.ts:104-537 | Clé `ftBotComparison`, migration des clés legacy | localStorage | rust | Rien n'est partagé entre appareils ; à lire tel quel puis à porter côté serveur |

### 2.2 Coquille, navigation, dashboard, réglages, gestion des bots

| # | Nom | Fichier | Rôle | Source de données | Verdict | Raison |
|---|---|---|---|---|---|---|
| 18 | Slot dailyChart (ProfitBenchmarkChart) | DVC:~107-135 | Profit cumulé vs benchmarks | allTradesSelectedBots, CoinGecko | merge | Cluster P&L (C4) |
| 19 | Slot botComparison (BotComparisonList) | DVC:~136-205 | Tableau central, non masquable | stores par bot | keep | Devient FleetTable alimenté par la passerelle |
| 20 | Slot allOpenTrades (OpenTradesEnhanced) | DVC:~206-262 | Positions ouvertes de la flotte | allOpenTradesSelectedBots | keep | Cœur du suivi ; voir C9 |
| 21 | Slot allClosedTrades (ClosedTradesEnhanced) | DVC:~263-318 | Trades fermés | historique complet par bot | merge | Fusion avec le Journal (C9), pagination serveur |
| 22 | Slot profitDistributionChart | DVC:~319-355 | Histogramme des profits | trades navigateur | merge | Va dans Journal/analyse (C4) |
| 23 | Slot activityTimeline | DVC:~356-390 | Fil d'événements | dérivé des trades | rust | Devient un vrai flux d'événements poussé (C8) |
| 24 | Slot marketPulse | DVC:~391-415 | Contexte marché | CoinGecko, alternative.me | drop | Faible valeur de suivi ; ticker minimal côté serveur au mieux |
| 25 | Slot riskOverview | DVC:~416-440 | Synthèse risque | stores client | merge | Cluster risque (C5) |
| 26 | Slot stressTest | DVC:~441-466 | Scénario de choc | openTrades | merge | Vers Outils/Risque (C5) |
| 27 | Slot logConsole | DVC:~467-492 | Logs agrégés, premier widget à gauche | /logs par bot 30 s | rust | Agrégation de logs côté passerelle (C7) |
| 28 | Slot rateBudget (CacheRateMonitor) | DVC:~516-532 | Budget rate-limit | /rate_metrics par bot | merge | Cluster infra (C6) |
| 29 | Slot ratePulse (RequestTimeline) | DVC:~533-560 | Timeline des requêtes | /rate_metrics | merge | Vers Outils/Diagnostic (C6) |
| 30 | Slot fleetOverview (InfrastructureHealth) | DVC:~561-585 | Santé infra | useDaemonHealth | merge | Base du panneau Santé (C6) |
| 31 | Slot volumeComparator | DVC:~586-612 | Volume bots vs exchange | /volume_history par bot | tools | Recherche plus que suivi (écart : keep dans la cartographie coquille) |
| 32 | Slot periodBreakdown | DVC:~613-642 | Profit par période | /daily|weekly|monthly par bot | merge | C4 |
| 33 | Slot botProfitComparison | DVC:~643-670 | Profit par bot sur une période | trades navigateur | merge | Devient Leaderboard (C4) |
| 34 | Slot fleetReconciliation | DVC:~671-706 | Orphelins et netting du wallet | /fleetview/reconciliation | rust | Lecture en Rust ; statut à remonter dans la barre d'alertes globale |
| 35 | Slot fleetExposure | DVC:~707-732 | Exposition long/short | useFleetView | merge | C5 |
| 36 | Slot fleetPnl | DVC:~733-758 | Contribution P&L par bot | useFleetView | merge | C4 (Leaderboard) |
| 37 | Slot fleetBots | DVC:~759-790 | Tableau par bot fleetview | useFleetView | merge | Doublon du tableau principal (C1) |
| 38 | IDs de widgets fantômes | stores/layout.ts:~60-68 | 6 enums sans widget | n/a | drop | Garder la migration ; passer à des ids texte versionnés |
| 39 | DraggableContainer | components/layout/DraggableContainer.vue | Cadre de widget, lazy mount, scope, live | layoutStore | primitive | Base de WidgetShell ; retirer backdrop-blur et couleurs en dur |
| 40 | Store de layout | stores/layout.ts | Grilles lg/sm/trading, defaults, edit mode | `ftLayoutSettings` | primitive | Registre de widgets piloté par données ; layout par navigateur |
| 41 | Entrée nav Home (`/`) | NavBar.vue + views/HomeView.vue | Accueil + BotList | botStore | merge | Gestion des bots vers Réglages > Bots ; `/` doit mener au dashboard |
| 42 | Entrée nav Trade (`/trade`) | NavBar.vue | Page détail bot | activeBot | keep | Page de premier rang |
| 43 | Entrée nav Dashboard | NavBar.vue | Dashboard flotte | widgets | keep | Page de premier rang |
| 44 | Entrée nav Journal | NavBar.vue | Journal des trades | autre tranche | keep | Page de premier rang |
| 45 | Entrée nav Logs | NavBar.vue | Page logs | autre tranche | merge | LogStream partagé (C7) |
| 46 | Entrées Backtest, Download data, Pairlist config, Strategy dev | NavBar.vue:navItems | Outils de dev | stratdev Python | tools | Menu Outils discret |
| 47 | Entrée Settings | NavBar.vue + views/SettingsViewCustom.vue | Réglages | settings/layout/color stores | keep | |
| 48 | Grappe droite de la navbar | NavBar.vue:~390-480 | Langue, edit, export/import, update fork, logout | GitHub API, /ui_version | merge | Ajouter un état global flotte (alertes, bots en ligne, P&L) ; NavBar de 1144 lignes |
| 49 | Barre d'outils mode édition | NavBar.vue:~600-700 | Opacité, animation de fond, optimiser, reset | layoutStore | merge | Doublon partiel de Réglages > Dashboard |
| 50 | Navigation mobile (Drawer + NavFooter) | NavBar.vue:~500-600 ; NavFooter.vue | Menu tiroir, barre basse 5 boutons | botStore | merge | Libellés anglais en dur, pas d'état actif, centré sur un seul bot |
| 51 | MobileTradesListView (`/open_trades`, `/trade_history`) | views/MobileTradesListView.vue | Liste du bot actif | activeBot | merge | Voir #81 et #187 |
| 52 | Réglages : UI | SettingsViewCustom.vue:89-190 | Langue, titre, fuseau, confirmDialog | `ftUISettings` | keep | Bug : même libellé pour deux options |
| 53 | Réglages : Dashboard | SettingsViewCustom.vue:191-225 | Verrou et reset du layout | layoutStore | merge | Doublon de la barre d'édition |
| 54 | Réglages : Graphiques | SettingsViewCustom.vue:227-350 | Échelle, Heikin Ashi, couleurs | settings/color stores | keep | Plusieurs clés de réglage sans UI |
| 55 | Réglages : Notifications | SettingsViewCustom.vue:351-446 | Toasts et notifications navigateur | settingsStore | keep | À brancher sur les alertes passerelle |
| 56 | Réglages : Backtest + À propos | SettingsViewCustom.vue:448-540 | Métriques backtest, versions | settingsStore.uiVersion | tools | Backtest suit les Outils ; À propos reste |
| 57 | SettingsView.vue et DashboardView.vue legacy | views/SettingsView.vue, views/DashboardView.vue | Originaux upstream | n/a | drop | Non routés |
| 58 | BotList, BotListRow, BotEntry, BotRename, BotTagBadges | components/BotList.vue etc. | Gestion des bots sur Home | botStore, groupes | keep | Devient le registre (Réglages > Bots) ; BotTagBadges = primitive |
| 59 | BotLogin, LoginModal, LoginView | components/BotLogin.vue, LoginModal.vue, views/LoginView.vue | Login par bot, import de config | POST /token/login | rust | Registre côté passerelle ; import en double avec NavBar |
| 60 | ThemeSelect | components/ThemeSelect.vue | Bascule clair/sombre | `ftUISettings` | keep | Ajouter le mode système |
| 61 | BootSplash | components/general/BootSplash.vue | Splash de démarrage | statut des bots | keep | Un snapshot WS remplace l'attente par bot |
| 62 | Composants généraux | components/general/*.vue | BaseCheckbox, EditValue, InfoBox, MessageBox, ProfitPill, ProfitSymbol, ValuePair... | props | primitive | Socle à compléter (KpiTile, StatusDot, EmptyState...) |
| 63 | Système de thème et CSS | styles/*.css, plugins/primevue.ts, stores/colors.ts | Aura, Catppuccin `--sd-*`, mode clair, fit-screen | `ftUIColorSettings` | primitive | 3 systèmes de couleurs concurrents ; à remplacer par des tokens uniques |
| 64 | Animations existantes | styles/stratdev-tokens.css:79-260, DVC, NavBar, BootSplash | ~25 keyframes, fond animé infini | layoutStore.backgroundAnimation | drop | Coût GPU ; remplacer par un petit jeu de tokens de mouvement + prefers-reduced-motion |
| 65 | i18n | locales/index.ts | 6 langues | `ft_locale` | keep | Réduire à FR + EN ; nombreuses chaînes en dur |
| 66 | Plugins et point d'entrée | plugins/*, main.ts, App.vue | PrimeVue, grille, i18n, fix toast | n/a | keep | Retester le contournement de clics sous les toasts |

### 2.3 Graphiques de profit et performance

| # | Nom | Fichier | Rôle | Source de données | Verdict | Raison |
|---|---|---|---|---|---|---|
| 67 | ProfitBenchmarkChart | components/ftbot/ProfitBenchmarkChart.vue (1838 l.) | Courbe réalisée + latente + projection + benchmarks + stats | trades fermés, profit_history flotte, CoinGecko | merge | Devient EquityCurve alimentée par la passerelle ; seul widget au capital de départ correct |
| 68 | BotProfitComparisonChart | components/ftbot/BotProfitComparisonChart.vue | Barres de profit par bot | trades fermés, utils/botProfit | merge | Leaderboard (C4) ; % faux sur wallet partagé |
| 69 | CumulativeProfitEnhanced | components/ftbot/CumulativeProfitEnhanced.vue | Ancien cumul 4 onglets | props | drop | Non monté |
| 70 | ProfitOverTimeEnhanced | components/ftbot/ProfitOverTimeEnhanced.vue | Génération précédente du benchmark | props | drop | Non monté ; garder l'idée meilleur/pire jour |
| 71 | ProfitDistributionEnhanced | components/ftbot/ProfitDistributionEnhanced.vue (1127 l.) | 5 onglets de distribution | trades fermés | keep | Utile pour les queues de DCA ; à servir en histogramme serveur, placé dans Journal |
| 72 | PerformanceHeatmap | components/ftbot/PerformanceHeatmap.vue | Calendrier de P&L | props | drop | Non monté ; l'idée calendrier est à reprendre (C4) |
| 73 | PeriodBreakdown | components/ftbot/PeriodBreakdown.vue | Profit jour/semaine/mois | /daily etc. par bot | merge | C4 ; devise `USDT` en dur (écart : keep/primitive selon tranche) |
| 74 | BotPerformance | components/ftbot/BotPerformance.vue | Perf par paire/tag/sortie (1 bot) | /performance, /entries, /exits, /mix_tags | keep | Onglet de la page bot ; vue flotte souhaitable |
| 75 | BotProfit | components/ftbot/BotProfit.vue | 22 métriques clé/valeur | /profit | keep | À transformer en tuiles groupées |
| 76 | BotBalance | components/ftbot/BotBalance.vue | Wallet + camembert | /balance | merge | Trompeur sur wallet partagé ; voir #97 |
| 77 | VolumeComparatorChart + useVolumeComparator | components/ftbot/VolumeComparatorChart.vue, composables/useVolumeComparator.ts | Volume exchange vs bots | /volume_history sur chaque bot / 5 min | tools | 39 réponses sur 40 identiques ; une seule requête cachée côté passerelle |
| 78 | CumProfitChart | components/charts/CumProfitChart.vue | Cumul upstream | props | primitive | Seulement backtest ; remplacer par EquityCurve |
| 79 | WalletHistoryChart | components/charts/WalletHistoryChart.vue | Historique wallet | balanceHistory | tools | Backtest uniquement |
| 80 | benchmarkData.ts + useBtcBenchmark.ts | utils/benchmarkData.ts, composables/useBtcBenchmark.ts | Prix CoinGecko | api.coingecko.com depuis le navigateur | rust | Un seul client caché côté serveur |
| 81 | exchangeRates.ts + summaryCurrency.ts | composables/exchangeRates.ts, summaryCurrency.ts | Taux USD, devise d'affichage | CoinGecko 5 min | rust | Bug EUR jamais chargé ; quasi inutile (USDC partout) |
| 82 | botProfit.ts | utils/botProfit.ts | Périodes et agrégat par bot | pur | primitive | Modèle de période unique client/serveur |

### 2.4 Listes de trades et détail de trade

| # | Nom | Fichier | Rôle | Source de données | Verdict | Raison |
|---|---|---|---|---|---|---|
| 83 | OpenTradesEnhanced | components/ftbot/OpenTradesEnhanced.vue (776 l.) | Positions ouvertes, double exposition, menu d'actions | props openTrades, getPairCandles au survol | merge | Devient TradeTable preset `open` ; O(N² log N) caché |
| 84 | ClosedTradesEnhanced | components/ftbot/ClosedTradesEnhanced.vue | Historique paginé | props closedTrades | merge | TradeTable preset `closed` ; pagination cassée |
| 85 | TradeActionsPopover | components/ftbot/TradeActionsPopover.vue | Menu kebab, actions et liens exchange | props | primitive | Ids DOM dupliqués entre bots ; `botFeatures` du bot actif |
| 86 | Flux d'actions argent réel | OpenTradesEnhanced.vue:238-294, ForceExitForm.vue, ForceEntryForm.vue, stores/ftbot.ts:1063-1130 | forceexit, partiel, cancel, increase, delete, reload | REST par bot | rust | Mauvais bot possible ; à router par (botId, tradeId) via la passerelle |
| 87 | TradeDetail | components/ftbot/TradeDetail.vue | Panneau détaillé | activeBot.tradeDetail | keep | Devient TradeDrawer (C10) ; min 500 px casse le mobile |
| 88 | TradePopoverHost + useTradePopover | composables/useTradePopover.ts, TradePopoverHost.vue | Panneau flottant unique | aucune | primitive | Bon modèle mono-instance ; ajouter tap/bottom sheet |
| 89 | TradeDetailPopover | components/ftbot/TradeDetailPopover.vue | Survol de la paire | trade + closedTrades | merge | C10 |
| 90 | ChartPopover | components/ftbot/ChartPopover.vue | Mini chandelier SVG | /pair_candles limit 5000 par survol, cache infini | rust | Fan-out caché le plus lourd ; bougies servies par la passerelle |
| 91 | StoplossChartPopover | components/ftbot/StoplossChartPopover.vue | Ancienne variante | /pair_candles | drop | Aucun import |
| 92 | DcaInfoPopover | components/ftbot/DcaInfoPopover.vue | Échelle DCA | trade.orders | keep | Essentiel pour la flotte DCA ; onglet du TradeDrawer |
| 93 | DurationHealthPopover, TypeLeveragePopover, ExitReasonPopover | components/ftbot/*.vue | Stats de table au survol | trades complets | rust | Agrégats précalculés |
| 94 | ActivityTimeline | components/ftbot/ActivityTimeline.vue | Fil d'événements dérivé | openTrades + 100 trades par bot | rust | Événements synthétiques faux (DCA) ; filtres `bot_status`/`alert` morts |
| 95 | TradeJournalView (`/journal`) | views/TradeJournalView.vue | Historique complet, filtres, export CSV/XLSX | allTradesSelectedBots | keep | Page de premier rang ; pagination/filtre/export serveur, ajouter des totaux |
| 96 | MobileTradesListView + CustomTradeList/Entry | views/MobileTradesListView.vue, CustomTradeList(Entry).vue | Cartes mobiles du bot actif | activeBot | merge | Pas d'actions, pas de pager, 25 trades max |
| 97 | tradeColumns.ts | composables/tradeColumns.ts | Registre de colonnes + helpers | `enhanced*TradeColumns*` | primitive | Graine du système de colonnes ; `exitReasonColor` classe mal `trailing_stop_loss` |
| 98 | TradeList | components/ftbot/TradeList.vue | Table legacy | props | drop | Code mort avec une copie des handlers d'actions |
| 99 | TradesLogEnhanced | components/ftbot/TradesLogEnhanced.vue | Journal compact | props | drop | Aucun import |

### 2.5 Cartes de survol, alertes, notifications

| # | Nom | Fichier | Rôle | Source de données | Verdict | Raison |
|---|---|---|---|---|---|---|
| 100 | SummaryProfitCard | components/ftbot/SummaryProfitCard.vue | P&L flotte ouvert/fermé, capital à risque | allProfit, allOpenTrades | merge | FleetDrilldown (C3) ; somme des devises mélangées |
| 101 | SummaryBalanceCard | SummaryBalanceCard.vue | Balance par devise et par bot | allBalance, exchangeRates | merge | C3 ; seule carte qui convertit correctement |
| 102 | SummaryWinLossCard | SummaryWinLossCard.vue | Winrate flotte | allProfit | merge | C3 ; winrate affiché dans 3 cartes Summary |
| 103 | SummaryTradesCard | SummaryTradesCard.vue | Slots utilisés, exposition | allOpenTrades, allBotState | merge | C3/C5 |
| 104 | OpenProfitCard | OpenProfitCard.vue (811 l.) | P&L ouvert d'un bot, positions, durées | allOpenTrades, trades fermés | merge | BotPulse (C2) ; quasi doublon de TradesInfoCard |
| 105 | ClosedProfitCard | ClosedProfitCard.vue | Performance réalisée | allProfit | merge | C2 ; quasi identique à BotInfoCard |
| 106 | PeriodProfitCard | PeriodProfitCard.vue (982 l.) | Rythme et projections | allProfit, trades | merge | C2 ; projections composées trompeuses à étiqueter ou retirer |
| 107 | BalanceCard | BalanceCard.vue | Capital d'un bot | allBalance, allProfit | merge | C2 ; capital de départ estimé, faux sur wallet partagé |
| 108 | WinLossCard | WinLossCard.vue | Donut W/L | allProfit | drop | Entièrement couvert par ClosedProfit/BotInfo |
| 109 | BotInfoCard | BotInfoCard.vue | Identité + santé d'un bot | props + trades | keep | Base du panneau BotPulse ; garder l'état hors ligne |
| 110 | TradesInfoCard | TradesInfoCard.vue (849 l.) | Activité, capacité, rythme | allOpenTrades, allProfit | merge | C2 ; jauge capital à dénominateur arbitraire |
| 111 | AlertDetailCard | AlertDetailCard.vue | Détail des alertes d'un bot | alerts + botStore | keep | Parse les messages par regex : à alimenter par des alertes structurées ; ajouter des actions |
| 112 | BotMaxDrawdownCard | BotMaxDrawdownCard.vue | Drawdown bot/groupe avec courbes | maxDrawdown.ts, /fleetview/profit_history | rust | Calcul de risque à faire une fois côté serveur (préserver les correctifs documentés) |
| 113 | ExchangeInfoCard | ExchangeInfoCard.vue | Encyclopédie exchange statique | données en dur | drop | Données périmées et juridiquement risquées dans un repo public |
| 114 | CurrencyInfoCard | CurrencyInfoCard.vue | Encyclopédie devise statique | données en dur | drop | Idem ; garder seulement le filtre par devise |
| 115 | StressTestCard | StressTestCard.vue | Choc de marché simulé | openTrades | tools | Modèle simpliste ; Outils/Risque avec vrais prix de liquidation |
| 116 | DurationHealthPopover | DurationHealthPopover.vue | Percentile de durée | trade + closedTrades | keep | Meilleure statistique (percentile) à généraliser |
| 117 | ProfitRangePopover | ProfitRangePopover.vue | MAE/MFE par trade | 5000 bougies | drop | Mort ; concept à reprendre côté serveur pour le Journal |
| 118 | ProfitGoalBar | ProfitGoalBar.vue | Objectif de profit | trades, `ft_profit_goal` | drop | Mort |
| 119 | useAlertDetection | composables/useAlertDetection.ts | 14 types d'alerte | botStores, alertConfig | rust | Bugs ; détection 24/7 côté passerelle |
| 120 | browserNotifications | utils/browserNotifications.ts | Notifications navigateur | alertes | keep | Clé de dédoublonnage contenant le message (spam) ; contexte http non sécurisé |
| 121 | percentageTool | composables/percentageTool.ts | Outil de mesure Shift-drag | ECharts | keep | Appartient aux graphiques ; pas tactile |

### 2.6 Opérations, infra, santé de flotte

| # | Nom | Fichier | Rôle | Source de données | Verdict | Raison |
|---|---|---|---|---|---|---|
| 122 | FleetOverview | components/ftbot/FleetOverview.vue | Ancien panneau flotte | /fleet/status + /fleet/events toutes les 1 s | drop | Mort |
| 123 | FleetviewPnlChart | FleetviewPnlChart.vue | Contribution P&L par bot | /fleetview/overview + recon | merge | Leaderboard léger (C4) |
| 124 | FleetviewExposure | FleetviewExposure.vue | Long/short, exposition par coin | useFleetView | merge | C5 |
| 125 | FleetviewBotsTable | FleetviewBotsTable.vue | Table par bot côté serveur | /fleetview/overview | keep | Meilleure base de données pour FleetTable (C1) |
| 126 | FleetviewReconciliation | FleetviewReconciliation.vue (1141 l.) | Réconciliation wallet netté + actions | /fleetview/reconciliation, resolve, realign | keep | Critique ; lecture en Rust, écritures proxifiées ; en page/tiroir dédié |
| 127 | RiskOverview | RiskOverview.vue | KPI risque | stores client | rust | Recalcul O(trades) ; « worst drawdown » mal nommé |
| 128 | MarketPulse | MarketPulse.vue | Contexte marché + perf période | CoinGecko, alternative.me, historique complet | rust | Données externes à cacher côté serveur ; réduit à un ticker (écart : drop dans #24) |
| 129 | InfrastructureHealth | InfrastructureHealth.vue | Santé démon, rate, bots, événements | useDaemonHealth 20 s | keep | Base du panneau Santé (C6) |
| 130 | CacheRateMonitor | CacheRateMonitor.vue | Jauges cache/rate | /rate_metrics sur chaque bot 15 s | merge | 4 ECharts pour 3 chiffres (C6) |
| 131 | CacheStatusWidget | CacheStatusWidget.vue | Cache du bot actif | /cache_status 30 s | drop | Démon partagé, doublon (écart : tools dans la tranche Trading) |
| 132 | RequestTimeline | RequestTimeline.vue | Timeline, Sankey, table par méthode | /rate_metrics 30 s | tools | Diagnostic expert |
| 133 | RateBudget | RateBudget.vue | Budget rate-limit | /rate_metrics | drop | Monté seulement par DashboardView legacy |
| 134 | RatePulse | RatePulse.vue | Timeline compacte | /rate_metrics | drop | Idem ; sous-ensemble de RequestTimeline |
| 135 | LogConsoleWidget | LogConsoleWidget.vue (1075 l.) | Console de logs multi-bot | logConsole store | merge | LogStream (C7) |
| 136 | LogViewerEnhanced | LogViewerEnhanced.vue | Page `/logs` | logConsole store | merge | LogStream (C7) |
| 137 | DryReplayModal | DryReplayModal.vue | Replay dry-run | /replay* | tools | Python proxifié ; reset_db destructif |
| 138 | BotConfigEditorModal | configEditor/BotConfigEditorModal.vue | Édition de config par bot | /stratdev/editor/* | keep | Tiroir « Config » de la page bot ; reste Python |
| 139 | ConfigFieldRow | configEditor/ConfigFieldRow.vue | Ligne de formulaire | props | primitive | FormRow réutilisable |
| 140 | ConfigPairlistEditor | configEditor/ConfigPairlistEditor.vue | Éditeur de pairlists | props | keep | À unifier avec Pairlist config (Outils) |
| 141 | useRateMetrics | composables/useRateMetrics.ts | Fan-out + fusion /rate_metrics | chaque bot | rust | Fusion côté passerelle |
| 142 | useFleetSnapshot | composables/useFleetSnapshot.ts | Digest de flotte 10 s | /fleet/snapshot | rust | Source de vérité de la passerelle ; garder `age_s` |
| 143 | useDaemonHealth | composables/useDaemonHealth.ts | Score de santé client | 4 endpoints 20 s, setInterval brut | rust | Score et raisons calculés en Rust |
| 144 | useFleetView | composables/useFleetView.ts | État overview/recon partagé | /fleetview/* | rust | Modèle singleton + refcount à généraliser en canal WS |
| 145 | useLogFiltering | composables/useLogFiltering.ts | Filtres et regroupement de logs | entrées en mémoire | primitive | Contrats de type à garder, filtres côté serveur |
| 146 | useConfigExport | composables/useConfigExport.ts | Export/import chiffré de la config UI | toutes les clés localStorage | keep | Critique pour la migration (formats v1/v2) |
| 147 | store logConsole | stores/logConsole.ts | Poll /logs sur tous les bots | /logs?limit=200 | rust | Timeout jamais appliqué, dédup fragile |
| 148 | replayStore | stores/replayStore.ts | État replay | /replay* 1,5 s | tools | Proxifié ; `isReplayTrade` partagé avec les tables |
| 149 | configEditorCatalog | utils/configEditorCatalog.ts | 61 champs éditables | statique | keep | Peut être servi en JSON |

### 2.7 Couche état et réseau

| # | Nom | Fichier | Rôle | Source de données | Verdict | Raison |
|---|---|---|---|---|---|---|
| 150 | Liste des bots + identifiants (`ftAuthLoginInfo`) | composables/loginInfo.ts:15-160, types/auth.ts | Source de vérité des bots | /token/login, /token/refresh | rust | Import unique dans le registre passerelle ; ids `ftbot.N` à préserver |
| 151 | Client HTTP par bot (useApi) | composables/api.ts | Axios par bot, refresh 401, détection offline | tous les endpoints | rust | Une seule auth passerelle ; bug de rejeu après échec de refresh |
| 152 | État du store wrapper | stores/ftbotwrapper.ts:114-165, 313-398 | botStores, selectedBot, isSelected, initBots | loggedInBots | merge | Deux notions de sélection à unifier en un FleetScope |
| 153 | Sous-store par bot | stores/ftbot.ts:104-1613 | Données + actions de chaque bot | ~45 endpoints | rust | État lourd ×40 ; ne garder que le bot affiché |
| 154 | Boucle rapide (/status + /locks) | ftbotwrapper.ts:403-412, 514-530 | Positions ouvertes 10 s | /status par bot | rust | Remplacée par le push WS |
| 155 | Boucle lente (8 endpoints) | ftbotwrapper.ts:413-420, 525-529 | Config, profit, balance... 60 s | par bot | rust | Idem |
| 156 | Balayage des trades fermés | ftbotwrapper.ts:541-563 | Historique complet 10 min | /trades paginé | rust | ~180 000 trades / 11 Mo en mémoire navigateur |
| 157 | Boucle fleet snapshot | useFleetSnapshot.ts:96-125, fleetDigestPolicy.ts | Digest 10 s | /fleet/snapshot | rust | Exactement le rôle de la passerelle |
| 158 | Autres boucles flotte | useFleetProfitHistory.ts, useFleetView.ts, useDaemonHealth.ts, useRateMetrics.ts, useVolumeComparator.ts | profit_history, overview, santé, rate, volume | endpoints fork | rust | Agrégats à pousser par WS |
| 159 | Console logs + WebSockets par bot + timers divers | stores/logConsole.ts, stores/ftbot.ts (ws), exchangeRates.ts, settings.ts | Logs 30 s, 40 WS, CoinGecko, check GitHub | bots + externes | rust | Un WS multiplexé ; token WS jamais renouvelé |
| 160 | Appels d'écriture (argent réel) | stores/ftbot.ts ~1000-1290, ftbotwrapper.ts:680-698, botConfigEditorStore.ts | Toutes les mutations | POST/DELETE par bot | keep | Proxifier 1:1 sans retry, ajouter audit et idempotence |
| 161 | Getters agrégés O(bots) | ftbotwrapper.ts:129-228 | allProfit, allBalance... | sous-stores | rust | Recalcul à presque chaque tick |
| 162 | Agrégats de trades O(T log T) | ftbotwrapper.ts:51-86, 202-219 | Aplatissement + tri | sous-stores | rust | Signature qui rate les éditions rétroactives |
| 163 | Agrégats jour/semaine/mois | ftbotwrapper.ts:229-301, 652-709 | Fusion par date | /daily etc. | rust | `USDT` en dur, `rel_profit` sommé à tort |
| 164 | Store botComparison | stores/botComparison.ts, types/botComparison.ts | Préférences, tags, groupes, alertes | localStorage | keep | À importer automatiquement ; ajouter un champ version |
| 165 | Petits stores et clés persistées | stores/settings.ts, colors.ts, chartConfig.ts, plotConfig.ts, pairlistConfig.ts, btStore.ts, alertsStore.ts... | Préférences UI | localStorage | keep | Inventaire de migration (section 6) |
| 166 | Helpers de jointure digest | stores/botApiPort.ts, botNameRegistry.ts, fleetDigestPolicy.ts, perBotFetchPolicy.ts, closedTradesPolicy.ts, slowRefreshScheduler.ts | Contournements du fan-out | aucun | drop | Obsolètes avec la passerelle ; garder l'idée d'abonnement à la demande |
| 167 | liveBotAnalytics | utils/liveBotAnalytics.ts (923 l.) | Analyse profonde d'un bot live | sous-store complet | rust | Calcul à la demande côté serveur, partageable avec le backtest |
| 168 | botProfit + maxDrawdown | utils/botProfit.ts, utils/maxDrawdown.ts | Profit par période, drawdown | trades aplatis | rust | Deux définitions de drawdown concurrentes |
| 169 | Couche de types | types/*.ts | Contrats API | n/a | primitive | Base des structs serde de la passerelle ; versionner le format |

### 2.8 Pages Trading, Charts et pages destinées aux Outils

| # | Nom | Fichier | Rôle | Source de données | Verdict | Raison |
|---|---|---|---|---|---|---|
| 170 | TradingView (`/trade`) | views/TradingView.vue | Grille 5 panneaux, 8 onglets | activeBot | keep | Devient la page bot ; bug de gate du chart (TradingView.vue:~265) |
| 171 | BotControls | components/ftbot/BotControls.vue | Start, Stop, Pause, Reload, Force entry, Exit all | REST bot actif | primitive | BotActionMenu partagé avec le tableau de flotte |
| 172 | ForceEntryForm / ForceExitForm | ForceEntryForm.vue, ForceExitForm.vue | Formulaires d'entrée/sortie forcées | /forcebuy, /forcesell | keep | Corriger le routage par botId (voir #86) |
| 173 | Onglet BotStatus | BotStatus.vue (+ StrategyParameters.vue) | Faits du bot en prose | botState, profit | merge | BotPulse (C2) |
| 174 | Onglet PairSummary | PairSummary.vue | Liste de paires cliquable | whitelist, locks, openTrades | merge | PairNavigator (C11) |
| 175 | Onglet BotPerformance | BotPerformance.vue | Voir #74 | /performance... | keep | Même composant que #74 |
| 176 | Onglet BotBalance et route `/balance` | BotBalance.vue (+ BalanceChart.vue) | Voir #76 | /balance | merge | Même composant que #76 |
| 177 | Onglet PeriodBreakdown | PeriodBreakdown.vue (+ TimePeriodChart.vue) | Voir #73 | /daily... | primitive | Même composant que #73, un seul composant bot/flotte |
| 178 | PairListLive (onglet, route `/pairlist`) | PairListLive.vue | Méthodes, whitelist, blacklist éditable | /whitelist, /blacklist | merge | C11 |
| 179 | PairlistInfoCard | PairlistInfoCard.vue | Pipeline de pairlist au survol | /whitelist | merge | C11 ; 420 px fixe |
| 180 | Onglet PairLockList | PairLockList.vue | Verrous de paires | /locks | merge | C11 |
| 181 | Onglet CacheStatusWidget | CacheStatusWidget.vue | Voir #131 | /cache_status | drop | Même composant que #131 |
| 182 | OpenTradesEnhanced (page bot) | OpenTradesEnhanced.vue | Voir #83 | openTrades | primitive | Même composant que #83 |
| 183 | ClosedTradesEnhanced (page bot) | ClosedTradesEnhanced.vue | Voir #84 | closedTrades | merge | Même composant que #84 |
| 184 | TradeDetail (page bot) | TradeDetail.vue | Voir #87 | tradeDetail | merge | Même composant que #87 |
| 185 | ChartsView | views/ChartsView.vue | Page graphique (non routée) | activeBot, chartStore | merge | Fusionner avec le chart de la page bot ou nouvelle page Charts |
| 186 | CandleChartContainer | components/charts/CandleChartContainer.vue | Barre d'outils et 13 options | candleData, settings | keep | Libellés FR en dur ; primitive Toggle |
| 187 | SingleCandleChartContainer | components/charts/SingleCandleChartContainer.vue | Cellule par paire, raccourcis | candleData, /plot_config | merge | Code mort (assignFirstPair, watcher vide) |
| 188 | CandleChart | components/charts/CandleChart.vue (957 l.) | Moteur ECharts | props | keep | Recherche linéaire au survol, refetch complet à chaque bougie |
| 189 | PairSelectorAdvanced | components/charts/PairSelectorAdvanced.vue | Sélecteur de paire avancé | /signal_summary | keep | Navigateur de paires unique (C11) |
| 190 | PlotConfigurator + PlotConfigSelect | components/charts/PlotConfigurator.vue (1176 l.), PlotConfigSelect.vue | Éditeur d'indicateurs | `ftPlotConfig` | keep | Préréglages = travail utilisateur à migrer |
| 191 | ChartLegend | components/charts/ChartLegend.vue | Légende temps réel | axisValues | keep | Throttle rAF |
| 192 | Graphiques backtest/dashboard de `charts/` | components/charts/*.vue | Mini ECharts divers | props | primitive | BaseChart unique ; HourlyChart inutilisé |
| 193 | Helpers utils/charts | utils/charts/*.ts | Séries de trades, Heikin Ashi, zoom | pur | keep | Couche pure réutilisable |
| 194 | Composables des graphiques | composables/useChartShortcuts.ts, percentageTool.ts, plotTemplates.ts, pairTemplates.ts | Raccourcis, mesure, templates | DOM | keep | Libellés FR en dur |
| 195 | BacktestingView | views/BacktestingView.vue + Backtest*.vue | Backtest webserver | /backtest 1 s | tools | Politique : pas de backtest proposé |
| 196 | StrategyDevView | views/StrategyDevView.vue + components/strategyDev/ (~120) | Labo stratégie | /stratdev/* | tools | Reste Python, proxifié |
| 197 | DownloadDataView | views/DownloadDataView.vue + DownloadDataMain.vue | Téléchargement de données | /download_data | tools | |
| 198 | PairlistConfigView | views/PairlistConfigView.vue + PairlistConfig*.vue | Évaluation de pairlist | /pairlists/* | tools | |
| 199 | LogView | views/LogView.vue + LogViewerEnhanced.vue | Page logs | logConsole | rust | Voir #136 ; logs poussés par la passerelle |
| 200 | MobileTradesListView + TradeList + CustomTradeList | views/MobileTradesListView.vue, TradeList.vue, CustomTradeList | Voir #96 et #98 | activeBot | drop | Remplacés par le mode carte de TradeTable (écart : merge dans #51/#96) |
| 201 | Fichiers morts | TradeActions.vue, LogViewer.vue, StoplossChartPopover.vue, BotListCollapsible.vue, PlotFromTemplate.vue, PlotIndicator.vue, PlotIndicatorSelect.vue, HourlyChart.vue | Aucun import | n/a | drop | Vérifier par un build avant suppression (auto-import unplugin) |

### 2.9 Backend du fork, déploiement, outillage

| # | Nom | Fichier | Rôle | Source de données | Verdict | Raison |
|---|---|---|---|---|---|---|
| 202 | GET /fleet/snapshot | FT/api_v1.py:238 -> rpc.py:2229 -> ohlcv_cache/daemon.py:2761 | Digest par bot | socket ftcache `summary_get` | rust | Lisible directement par la passerelle |
| 203 | GET /fleet/status | FT/api_v1.py:233 | Santé démon, limiteurs | socket `fleet_status` | rust | 1:1 via socket |
| 204 | GET /fleet/events | FT/api_v1.py:251 | Incidents de flotte | socket `fleet_events` | rust | Poll `since` + push |
| 205 | GET /cache_status | FT/api_v1.py:219 | Stats ftcache + pairlist cache | 2 sockets | rust | Recopier les pourcentages dérivés |
| 206 | GET /rate_metrics | FT/api_v1.py:224 -> rpc.py:2278 | Timeline 429 + budget | mémoire du bot qui répond + démon | keep | Moitié non reproductible : proxy vers un bot choisi |
| 207 | GET /fleetview/overview | FT/api_v1/api_fleetview.py:280 | Table par bot | /proc + SQLite ro | rust | Reproductible ; cache et intervalle au lieu de recalcul par requête |
| 208 | GET /fleetview/reconciliation | api_fleetview.py:633 | Classification par coin | SQLite + HL /info | rust | Lecture reproductible ; prudence 429 |
| 209 | POST /fleetview/reconciliation/resolve | api_fleetview.py:778 | Ordres signés, suppression de trades | ccxt + REST bots | keep | Rester en Python (vaultAddress, signature) |
| 210 | POST /fleetview/reconciliation/realign | api_fleetview.py:953 | Réparation DB avec aperçu | REST bots | keep | Proxy ; garder aperçu puis confirmation |
| 211 | GET /fleetview/exposure | api_fleetview.py:999 | Exposition wallet | `user_data/exposure_state.json` | rust | Lecture de fichier ; non utilisé par l'UI aujourd'hui |
| 212 | GET /fleetview/profit_history | api_fleetview.py:1229 | Courbes de profit de toute la flotte | SQLite `profit_history` | rust | Lecture incrémentale + push |
| 213 | GET /profit_history (par bot) | FT/api_trading.py:131 | Courbe d'un bot | SQLite du bot | drop | Remplacé par la version flotte |
| 214 | GET /volume_history | FT/api_trading.py:194 | Volume de marché | feathers + whitelist du bot | tools | Proxy paresseux caché |
| 215 | GET /signal_summary | FT/api_trading.py:416 | Comptes de signaux par paire | dataframes en mémoire du bot | drop | Seulement à la demande sur la page bot (utilisé par PairSelectorAdvanced, à garder proxifié) |
| 216 | /replay* | FT/api_v1/api_replay.py:81-296 | Harnais de replay | Python | tools | Proxy |
| 217 | Modèle d'auth | FT/api_auth.py, webserver.py:207-340 | Basic/JWT, CORS | config api_server | primitive | Identifiants partagés par les 24 bots ; CORS limité à l'origine :9400 |
| 218 | Service de l'UI | FT/web_ui.py, ui_static.py | SPA depuis le disque | `ui/installed` | keep | Remplacement à chaud sans redémarrage |
| 219 | Mécanisme install-ui | freqtrade/commands/deploy_ui.py:60-100 | Installation depuis GitHub | API releases | keep | Syntaxe `github://` du README non supportée |
| 220 | Faits de déploiement | /home/moutonneux/freqtrade/live_configs/*.json | 24 bots tournent (16 live, 8 dry), ports 8878-9520 | configs fusionnées | keep | Dimensionner pour 40-50 |
| 221 | Outillage de build | package.json, vite.config.ts... | Vue 3.5, Vite 8, PrimeVue 4.5, ECharts 6 | n/a | keep | Pas de pré-compression ; Monaco/xlsx à charger paresseusement |
| 222 | Tests et e2e | tests/, e2e/, playwright.config.ts | ~17 specs unitaires, 11 e2e | mocks | keep | Pas de tests des widgets fork, ni mobile, ni contrats d'API |
| 223 | CI, release, versioning | .github/, CHANGELOG*.md, Dockerfile, docker-compose.yml | Aucun workflow CI | n/a | keep | À créer (lint, typecheck, tests, build, cargo, release) |

## 3. Clusters de redondance

| Cluster | Éléments actuels (n° section 2) | Widget fusionné proposé |
|---|---|---|
| C1 Tableau de flotte | 1, 2, 3, 5, 16, 19, 37, 58 (lignes), 122, 125, table de bots de 129 | **FleetTable** : une ligne dense par bot (statut, P&L ouvert/fermé, exposition, slots, alerte, âge de la donnée), groupes repliables, recherche, tri au clic sur en-tête, vue cartes sur mobile, données poussées par la passerelle |
| C2 Carte par bot | 104, 105, 106, 107, 108, 109, 110, 173, 75, 112 (vue bot) | **BotPulse** : tiroir (desktop) / bottom sheet (mobile) avec sections Performance, Positions, Capital, Risque/Drawdown, Config ; ouvert au clic |
| C3 Cartes de flotte et de groupe | 100, 101, 102, 103, cartes Summary de 5, cartes de groupe | **ScopeDrilldown** : même panneau que BotPulse paramétré par périmètre (bot, groupe, flotte) |
| C4 Courbes et périodes de P&L | 18, 22, 32, 33, 36, 67, 68, 69, 70, 71, 72, 73, 78, 79, 123, 177 | **EquityCurve** (flotte ou bot, réalisé + latent + drawdown), **PnlCalendar** (jour/semaine/mois), **Leaderboard** (barres horizontales triées par bot, 1j/7j/30j) ; distributions dans le Journal |
| C5 Risque et exposition | 25, 26, 35, 103, 115, 124, 127, 211 | **RiskPanel** : exposition long/short/nette wallet-level, levier moyen, capacité, distance de liquidation, paires dupliquées entre bots ; stress test dans Outils |
| C6 Infra et rate-limit | 28, 29, 30, 122, 129, 130, 131, 132, 133, 134, 181 | **SystemHealth** : niveau + raisons, budget rate, backoff, hit rate, bots process, événements ; RequestTimeline en Outils/Diagnostic |
| C7 Logs | 27, 45, 135, 136, 147, 199, LogViewer mort (201) | **LogStream** : un composant, mode compact (dashboard, erreurs seulement) et mode page |
| C8 Alertes et événements | 12, 23, 94, 111, 119, 120, 204, statut de 34/126 | **AlertRail** + **EventFeed** : alertes structurées calculées 24/7 par la passerelle (ack, silence, dédup), vrais événements (fills, sorties, bot hors ligne), badge global dans l'en-tête |
| C9 Tables de trades | 20, 21, 51, 83, 84, 95, 96, 98, 99, 182, 183, 200 | **TradeTable** : registre de colonnes portant le rendu des cellules, presets `open` / `closed` / `journal`, mode cartes mobile, pagination/filtre/tri serveur pour l'historique |
| C10 Détail de trade | 87, 89, 90, 91, 92, 93, 116, 117, 184 | **TradeDrawer** : onglets Vue d'ensemble, DCA et ordres, Graphique, Stats ; actions de sortie dans le tiroir |
| C11 Navigation de paires | 174, 178, 179, 180, 189 | **PairNavigator** (sélecteur unique avec filtres signaux/positions/verrous) + onglet Pairlist (méthodes, whitelist, blacklist, verrous) |
| C12 Contexte marché et devises | 24, 80, 81, 113, 114, 128, partie FX de 8 | Ticker minimal BTC/ETH servi par la passerelle ; conversion de devise supprimée ou faite serveur |
| C13 Gestion des bots et réglages | 41, 47-49, 52-56, 58, 59, NavBar import/export (48) | **Réglages** avec section Bots (registre passerelle), import/export unique |
| C14 Actions sur un bot | 4, 171, 85, 172 | **BotActionMenu** + **ConfirmDangerDialog** + `useBotAction(botId)` |
| C15 Sélection, filtres, groupes | 9, 10, 11, 13, 152, filtres live/dry par widget | **FleetScope** : barre globale (mode, groupes, tags, exchange, recherche) partagée par tous les widgets ; remplace la double notion sélection/filtre |

## 4. Primitives partagées à créer

### 4.1 Composants UI

| Primitive | Remplace / utilisée par |
|---|---|
| `WidgetShell` (titre, scope, état chargement/erreur/périmé avec âge, actions d'en-tête, lazy) | DraggableContainer, blocs squelette/erreur/retry de tous les widgets ops, boutons fit-to-screen/filtre/colonnes recopiés dans DVC |
| Registre de widgets piloté par données | Les 20 blocs GridItem de DVC, stores/layout.ts |
| `HoverCard` + `useHoverCard(key)` + `BottomSheet` tactile | ~17 machines à états de CL, usePopoverHover, popovers de RiskOverview, MarketPulse, CacheRateMonitor, InfrastructureHealth, TradePopoverHost |
| `DataTable`/`TradeTable` avec registre de colonnes portant le rendu | OpenTradesEnhanced, ClosedTradesEnhanced, TradeJournalView, TradeList, CustomTradeList, FleetviewBotsTable, CL |
| `FleetCell` (rendu bot/groupe/flotte/démarrage) | 6 colonnes de profit de CL |
| `PnlValue` / `ProfitPill` / `PnlChip` (seuils configurables) | ProfitPill, profitColor x8, perfProfitBgClass, periodProfitBgClass, balanceValueBgClass, rowBgClass |
| `StatusDot`, `BotModeBadge` (Live/Dry/Replay), `DirectionChip`, `LeverageChip`, `ExitReasonChip`, `StaleBadge` | CL, tables de trades, InfrastructureHealth, FleetviewBotsTable, BotTagBadges |
| `Donut` (+ preset `WinLossDonut`) | 9 donuts SVG dans les cartes |
| `Sparkline` / `AreaLine` (marqueurs pic/creux) | BotInfoCard, PeriodProfitCard, BotMaxDrawdownCard, ChartPopover |
| `StatTile`, `KpiStrip`, `StatGrid`, `StatRow` | Bandeaux de stats de ProfitBenchmarkChart, ProfitDistributionEnhanced, BotProfit, ClosedProfitCard, BotInfoCard |
| `RankedBarList` | 4 cartes Summary, FleetviewPnlChart, BotProfitComparisonChart |
| `Meter` / `CapacityBar` / `SplitBar` | Jauges ECharts de CacheRateMonitor/RateBudget, capacité de SummaryTradesCard, barres winrate |
| `SegmentedControl`, `PeriodPills`, `Toggle`, `WidgetToolbar` | Pilules de période/mode de tous les graphiques, ~10 toggles copiés dans CandleChartContainer |
| `ConfirmDangerDialog` + `useBotAction(botId)` (verrou en vol, nom du bot, badge live/dry, saisie de confirmation) | CL, BotControls, OpenTradesEnhanced, TradeList, ForceExit/EntryForm, FleetviewReconciliation, BotConfigEditorModal |
| `PositionRow` | OpenProfitCard, TradesInfoCard, AlertDetailCard, StressTestCard |
| `EventRow` | InfrastructureHealth, FleetOverview, ActivityTimeline |
| `EmptyState`, `Skeleton` | 7 cartes et la plupart des widgets |
| `BaseChart` (enregistrement ECharts unique, thème, export, replaceMerge par id) | Tous les composants ECharts (enregistrements `use([...])` répétés) |
| `FormRow` | ConfigFieldRow, formulaires Réglages |
| Palette de commandes + raccourcis centralisés | Raccourcis de CL, useChartShortcuts, PlotConfigurator Ctrl+Z |

### 4.2 Fonctions pures (côté client ou passerelle)

| Fonction | Fichiers concernés aujourd'hui |
|---|---|
| Modèle de période unique (1j, 7j, 30j, MTD, YTD, tout) | getTimeframeCutoff x3, utils/botProfit.PROFIT_PERIODS, Journal, MarketPulse |
| Formatage de durée et de temps relatif | timeAgo, humanDuration, humanizeDays, formatDuration(Ms), formatUptime (5+ fichiers) |
| Parsing de `avg_duration` | OpenProfitCard, TradesInfoCard, useAlertDetection, AlertDetailCard (2 implémentations divergentes) |
| Percentile de durée (seuils 70/90) | tradeColumns.durationAnomalyPct, DurationHealthPopover, TradeDetailPopover, OpenProfitCard (ratio 1,5/2) |
| Extraction des ordres d'entrée (avec repli par side) | DcaInfoPopover, TradeDetailPopover, ChartPopover |
| Classification des raisons de sortie | tradeColumns.exitReasonColor (à corriger) |
| Classification de marché HIP-3 (`XYZ-`, `xyz:`) | CL:744-812, liens exchange de TradeActionsPopover |
| Couleur stable par bot (hash de l'id) | BOT_COLORS x3-4, barColors x4 |
| Capital par bot (starting_capital, jamais balance.total sur wallet partagé) | ProfitBenchmarkChart (correct), BotProfitComparisonChart, ProfitOverTimeEnhanced, BalanceCard |
| Drawdown réalisé et open-inclusive (une seule définition) | utils/maxDrawdown.ts, BotMaxDrawdownCard, liveBotAnalytics, colonne/tri/alerte de CL |
| Modèle d'alerte structuré `{typeId, botId, pair, value, threshold, severity, since}` | useAlertDetection, AlertDetailCard, browserNotifications |
| Normalisation ms/s des timestamps | useAlertDetection, ProfitGoalBar, types |

## 5. Flux de données actuel

### 5.1 Boucles de polling et cadences

| Boucle | Endpoint(s) | Cadence | Portée | Fichier |
|---|---|---|---|---|
| Tier rapide | /status (+ /locks bot actif) | 10 s, 1/6 pour bots couverts par digest | chaque bot, lots de 6, 150 ms | ftbotwrapper.ts:403-412 |
| Tier lent | /show_config, /profit_all, /balance, /historic_balance, /strategy, /trades, /whitelist, /blacklist | 60 s si refreshRequired, 1/3 si digest | chaque bot | ftbotwrapper.ts:413-420 |
| Balayage trades fermés | /trades?limit=1 puis pages de 500 | 10 min + à la demande | bots dont l'historique est demandé | ftbotwrapper.ts:541-563 |
| Fleet snapshot | /fleet/snapshot | 10 s (onglet visible) | 1 bot | useFleetSnapshot.ts |
| Fleetview | /fleetview/overview ; reconciliation au montage | 60 s | 1 bot (sondage séquentiel) | useFleetView.ts |
| Profit history flotte | /fleetview/profit_history (ETag) | cache 60 s | 1 bot, repli par bot | useFleetProfitHistory.ts |
| Santé démon | /cache_status, /fleet/status, /fleet/events, /rate_metrics | 20 s, setInterval non conditionné à la visibilité | bot actif | useDaemonHealth.ts |
| Rate metrics | /rate_metrics | 15 s (CacheRateMonitor), 30 s (autres) | chaque bot, cache 10 s | useRateMetrics.ts |
| Logs | /logs?limit=200 | 30 s | chaque bot | stores/logConsole.ts |
| Volume | /volume_history | 3 s puis 5 min | chaque bot | useVolumeComparator.ts |
| Cache bot actif | /cache_status | 30 s | bot actif | CacheStatusWidget.vue |
| Replay | /replay | 1,5 s par replay actif | bot cible | stores/replayStore.ts |
| Backtest | /backtest | 1 s pendant l'exécution | bot webserver | BacktestingView |
| WebSockets | /message/ws?token= | continu, reconnexion 10 s | 1 par bot (~40) | stores/ftbot.ts |
| Ping | /ping | 60 s | tous | NavBar.vue |
| Externes | CoinGecko simple/price, market_chart ; alternative.me ; api.github.com | 5 min ; 10 min ; 30 s (MarketPulse) ; 1 h | navigateur | exchangeRates.ts, benchmarkData.ts, MarketPulse.vue, settings.ts |
| Au survol | /pair_candles limit 5000 | par paire/bot, cache infini | bot de la ligne | ChartPopover.vue |
| Code mort | /fleet/status + /fleet/events | 1 s | si monté | FleetOverview.vue |

Ordre de grandeur pour 40 bots : ~4 req/s en régime normal sans digest, plus ~80 req/min de logs, ~80 req/min de rate metrics, jusqu'à 11 Mo d'historique fermé en mémoire, 40 WebSockets.

### 5.2 Agrégats calculés côté client et leur coût

- Getters wrapper O(bots) recalculés presque à chaque tick : allProfit, allOpenTrades, allBalance, allBotState, allBalanceHistory, allRateMetrics.
- Aplatissements de trades O(T) et O(T log T) (~180 000 éléments) : allTradesSelectedBots, allClosedTradesSelectedBots.
- Tableau de flotte : lignes, filtres, tri, Summary, groupes O(N) ; drawdown de groupe/Summary non mémoïsé O(T log T) ; dernier trade 2 passes par bot ; alertes avec 4-5 passes sur le buffer de logs de chaque bot.
- Tables de trades : `durationAnomalyPct` par ligne O(N² log N) même colonne masquée ; corrélations scannées deux fois ; Journal `concurrentPositions` O(N²) par rendu.
- Graphiques : chaque graphique monté re-réduit tout l'historique fermé (debounce 500 ms) ; ProfitDistributionEnhanced recalcule 5 graphiques ; ActivityTimeline reconstruit ~4 000 événements.
- Ops : RiskOverview ~12 computeds sur toutes les positions ; MarketPulse sur tout l'historique ; fusion de ~40 payloads `/rate_metrics` ; parsing de 40 x 200 lignes de logs toutes les 30 s ; score de santé.
- Rendu : jusqu'à ~15 instances ECharts (CacheRateMonitor 4, RequestTimeline 2-3, PnlChart 1, benchmark, distribution, volume, période, comparaison...), backdrop-blur sur chaque en-tête, fond animé infini, tableau non virtualisé, 1 popover d'actions monté par bot.

### 5.3 Ce qui passe dans la passerelle Rust (faisabilité sans modifier freqtrade)

| Besoin | Source actuelle | Faisabilité passerelle | Remarque |
|---|---|---|---|
| Digest par bot | /fleet/snapshot | Oui : socket Unix `/tmp/ftcache-<uid>.sock`, op `summary_get` | Complète avec SQLite (winrate, ratios absents du digest) |
| Santé démon, limiteurs | /fleet/status | Oui : op `fleet_status` | |
| Événements | /fleet/events | Oui : op `fleet_events` avec `since` | Ou lecture de `fleet_events.jsonl` |
| Stats cache | /cache_status | Oui : ops `stats` (ftcache) + socket pairlist cache | Confirmer le chemin dans `pairlist_cache/defaults.py` |
| Rate metrics | /rate_metrics | Partiel : `current` et `ftcache_extended` via socket ; timeline et 429 = mémoire d'un bot, proxy | La timeline ne décrit qu'un bot, pas la flotte |
| Vue par bot (capital, P&L 1j/7j/30j, positions) | /fleetview/overview | Oui : scan /proc + configs fusionnées + SQLite ro | Chemins relatifs via `/proc/<pid>/cwd` ; dates naïves UTC |
| Courbes de profit | /fleetview/profit_history | Oui : lecture incrémentale de la table `profit_history` (rowid) | Inclure les ledgers orphelins (bots arrêtés) |
| Exposition wallet | /fleetview/exposure | Oui : lire `user_data/exposure_state.json` | Seuils dupliqués avec `exposure_guardrail.py` |
| Réconciliation (lecture) | /fleetview/reconciliation | Oui : SQLite + HL POST /info `clearinghouseState` (+ dex HIP-3) | Max 1 appel/60 s par wallet ; tests d'équivalence obligatoires |
| Réconciliation (écriture) | resolve, realign | Non en v1 : proxy vers Python | Signature EIP-712, vaultAddress |
| Positions ouvertes temps réel | /status par bot | Oui : poll unique par bot depuis la passerelle (127.0.0.1) puis push des deltas | Remplace le fan-out navigateur |
| Profit, balance, config | /profit_all, /balance, /show_config | Oui : poll lent côté passerelle | Respecter BotFeatures (repli /profit) |
| Historique fermé, Journal, export | /trades paginé | Oui : SQLite ro avec pagination, filtres, tri, totaux | Pièges : `is_short`, `exit_reason`/`close_rate` parfois nuls |
| Jour/semaine/mois | /daily etc. | Oui : depuis SQLite, une seule devise, fuseau explicite | |
| Drawdown, percentiles de durée, analytics live | client | Oui : calcul serveur depuis SQLite | Porter les correctifs de BotMaxDrawdownCard, tester contre la sortie TS |
| Alertes | client | Oui : moteur de règles serveur, ack/silence/dédup | Logs à suivre pour les alertes log |
| Logs | /logs par bot | Oui : poll unique par bot ou lecture des fichiers de log, curseur serveur | |
| Bougies du mini-graphique | /pair_candles | Oui : proxy caché (ou feathers) | Pas de 5000 bougies par survol |
| Marché, taux | CoinGecko, alternative.me | Oui : cache serveur | |
| Volume | /volume_history | Proxy paresseux caché (dépend de la whitelist du bot) | |
| Signaux | /signal_summary | Proxy vers le bot ciblé uniquement | Dataframes en mémoire du bot |
| Actions de trading | /forcesell, /forcebuy, /start, /stop, /stopbuy, /reload_config, DELETE /trades/{id}... | Proxy 1:1 avec auth bot, sans retry | Audit + idempotence |
| Replay, stratdev, backtest, éditeur de config | /replay*, /stratdev/* | Proxy Python | Timeouts longs, exemptés de la détection offline |
| Graphiques (dataframes analysés) | /message/ws ANALYZED_DF, /pair_candles | Proxy | |

## 6. Contraintes de migration

### 6.1 Clés localStorage et forme de la liste de bots

- `ftAuthLoginInfo` : objet `{ "ftbot.N": { botName, botIcon?, apiUrl, username?, refreshToken, accessToken, autoRefresh, sortId?, createdAt? } }`. Le mot de passe n'est pas stocké : seuls les tokens (refresh 30 jours). Les ids `ftbot.N` servent de clé à toutes les préférences : ne jamais les renuméroter.
- Préférences à importer automatiquement : `ftSelectedBot`, `ftBotNames`, `ftBotComparison` (colonnes, tags, groupes, ordre, filtres, seuils d'alerte, notifications ; pas de champ version), `ftUISettings`, `ftUIColorSettings`, `ft_locale`, `enhancedOpenTradeColumns`, `enhancedClosedTradeColumns`, `enhancedOpenTradeColumnOrder`, `enhancedClosedTradeColumnOrder`, `ftPlotConfig` (préréglages d'indicateurs = travail utilisateur).
- Clés réinitialisables (layout refondu) : `ftLayoutSettings` (ids numériques 0-25, avec migration existante), `ftUIChartSettings`, `ftPairlistConfig`, `ftBotListGrouped`, `ftBotComparisonRecentIcons`, `ft_benchmarks_enabled`, `ft_benchmark_show_latent`, `ft_benchmark_show_realized`, `ft_benchmark_show_dd`, `ft_market_overview_settings`, `ft_profit_goal`, `ft_dismissed_correlations` (non borné), filtres de mode par widget, `ftForkUpdateCheck`, sessionStorage `ftBootShown`. Clés legacy `ft_*` déjà migrées par botComparison.ts:442-523.
- Garder une lecture compatible et laisser les anciennes clés intactes pour permettre un retour à l'ancienne UI sur la même origine. Introduire un objet de réglages versionné.
- `useConfigExport` : garder la lecture des formats v1/v2 (tweetnacl XSalsa20-Poly1305 + SHA-512, pas de `crypto.subtle` en http).

### 6.2 Authentification

- Aujourd'hui : JWT par bot (accès 15 min, refresh 30 j), WebSocket avec `?token=`, CORS des bots limité à l'unique origine :9400.
- Sur ce serveur : les 24 bots partagent un même username/password/jwt_secret_key et un même ws_token (fichiers d'accès fusionnés) ; ne jamais régénérer ces fichiers (casse FreqUI).
- La passerelle doit avoir sa propre auth (ou vérifier le JWT partagé), parler aux bots en 127.0.0.1, ne jamais journaliser les tokens ni les clés, et ne pas devenir un point de forceexit non authentifié. Pour les utilisateurs open-source sans identifiants partagés : import du registre depuis le navigateur au premier chargement (POST des entrées `ftAuthLoginInfo`) avant expiration des refresh tokens.

### 6.3 Service de l'UI et déploiement sans redémarrage

- Le bot :9400 sert `freqtrade/rpc/api_server/ui/installed/` lu à chaque requête (index.html no-cache, assets hashés immutables, ETag, LRU gzip dont la clé inclut mtime) : remplacer les fichiers prend effet immédiatement, sans redémarrer de bot. `ui/installed` est ignoré par git dans freqtrade.
- Procédure sûre : construire dans un répertoire voisin, écrire les assets d'abord puis index.html (ou renommage atomique du répertoire), garder une sauvegarde `installed.bak.<date>` (deux existent déjà).
- Rester sur la même origine est la condition pour retrouver `ftAuthLoginInfo` sans action utilisateur. Une passerelle sur un autre port implique CORS côté passerelle ; les bots refuseraient toute autre origine. Option à trancher : UI servie par le bot :9400 et appels vers la passerelle (CORS), ou passerelle devant :9400 (nécessite de déplacer le bot, donc un redémarrage : à éviter).
- Version installée : `0.8.0-perf.23758f82` alors que le repo est en 0.9.0 (installation manuelle, `frequi-dist.tar.gz` dans `/home/moutonneux/frequi`).
- Aucun redémarrage de bot n'est acceptable (tempêtes de 429, échelonnement de 10 min minimum).

### 6.4 install-ui et chemin de mise à jour open-source

- `freqtrade install-ui` lit les releases de `titouannwtt/frequi-ultimate` (30 premières), choisit par `name` ou la plus récente non-prerelease, n'utilise que `assets[0]`, écrit `.uiversion` = nom de la release.
- Le README annonce `--ui-version github://...` que le code ne sait pas analyser : corriger le README ou le code.
- Publier d'abord en prerelease (`--prerelease`), puis promouvoir. Archive dist en premier asset.
- La passerelle n'est pas livrée par install-ui : binaire séparé (release GitHub linux x86_64/aarch64 + checksums, script d'installation, service). L'UI doit fonctionner sans passerelle (repli sur le polling direct actuel) et contre des bots sans les endpoints du fork.
- Pas de CI aujourd'hui ; `docker-compose.yml` pointe sur l'image upstream ; `.gitignore` ignore tous les `.md` sauf 5 fichiers : ce document et `docs/redesign/` doivent être ajoutés à la liste blanche pour être versionnés.
- Routes existantes à conserver ou rediriger : `/dashboard`, `/trade`, `/journal`, `/logs`, `/settings`, `/login`, `/open_trades`, `/trade_history`, `/pairlist`, `/balance`, `/download_data`, `/pairlist_config`, `/strategy-dev`, `/backtest`, paramètres `?bot=`, `?highlight=`, `redirect`.

## 7. Actions argent réel

| Action | Appel | Où dans l'UI | Confirmation actuelle | Problèmes |
|---|---|---|---|---|
| Forceexit total d'un trade | POST /forcesell {tradeid, ordertype?} | Menu kebab OpenTradesEnhanced, TradeList (mort) | Dialog « Exit trade » ; sautée si `settings.confirmDialog` = false (défaut true) | Pas de verrou anti double clic ; succès HTTP affiché comme « ordre créé » sans statut réel ni refus de `confirm_trade_exit` |
| Forceexit partiel | POST /forcesell {tradeid, amount, price?} | ForceExitForm | Le bouton du formulaire vaut confirmation | Envoyé à `botStore.activeBot`, pas au bot de la ligne : mauvais bot possible (trade_id non unique entre bots) ; montants sous le minimum notionnel |
| Augmenter la position | POST /forcebuy | ForceEntryForm (mode increase) | Bouton du formulaire | Même bug activeBot ; gating par features du bot actif |
| Force entry | POST /forcebuy | BotControls | Formulaire | Lié à `activeBot.selectedPair` |
| Exit all d'un bot | POST /forcesell {tradeid:'all'} | Menu de CL, BotControls | Dialog simple (messages avec botId, boutons non i18n dans CL) | Aucune saisie de confirmation ; ne pas relancer un bot mort pour forceexit |
| Stop | POST /stop | Menu de CL, BotControls | Dialog | Avec `launch_bot.sh`, /stop provoque un redémarrage automatique |
| Pause (stop buy) | POST /stopbuy | Menu de CL, BotControls | Aucune dans CL, dialog dans BotControls | Incohérent |
| Reload config | POST /reload_config | Menu de CL, BotControls, éditeur de config | Aucune dans CL, dialog dans BotControls | Jamais en masse : redémarrages échelonnés |
| Start | POST /start | Menu de CL, BotControls | Aucune | Pas d'indication de mode replay |
| Supprimer un trade (DB) | DELETE /trades/{id} | Menu kebab | Toujours confirmé | Ne ferme pas la position sur l'exchange ; voisin direct de Forceexit dans le menu |
| Annuler l'ordre ouvert | DELETE /trades/{id}/open-order | Menu kebab | Toujours confirmé | |
| Recharger un trade | POST /trades/{id}/reload | Menu kebab | Aucune | |
| Blacklist ajout/suppression | POST/DELETE /blacklist | PairListLive | Aucune (popover d'ajout) | Affecte le trading live |
| Supprimer un verrou | DELETE /locks/{id} | PairLockList | Aucune | |
| Réconciliation : delete_phantom / close_minority / close_unowned | POST /fleetview/reconciliation/resolve {confirm:true} | FleetviewReconciliation | Dialog + reconstruction fraîche côté serveur, 409 sans confirm, plafond 1000 USDC | Ordres marché signés ; vaultAddress obligatoire pour le sous-compte |
| Réconciliation : realign | POST /fleetview/reconciliation/realign (aperçu puis confirm) | FleetviewReconciliation | Aperçu puis exécution, tolérance 2 % | Modifie les DB des bots via leur API ; `/trades/{id}/amount` requis |
| Écriture de config | POST /stratdev/editor/file (+ validate) | BotConfigEditorModal | Revue du diff, garde `loadIncomplete`, champs verrouillés | Accessible en 2 clics depuis le tableau sans avertissement « bot live » |
| Replay avec reset_db | POST /replay, /replay/restore | DryReplayModal | `window.confirm` | Écrase la DB dry |
| Multi-bot | forceSellMulti, deleteTradeMulti, cancelOpenOrderMulti, reloadTradeMulti | Tables multi-bot | Comme ci-dessus | Routage correct par botId, sauf les deux formulaires |

Règles à appliquer dans la refonte : porter `(botId, tradeId)` de bout en bout, nom du bot et badge live/dry dans chaque confirmation, saisie de confirmation pour Exit all et suppression sur bot live, verrou en vol, aucun retry passerelle sur un POST non idempotent (le rejeu actuel après refresh 401 d'api.ts:75-93 est à supprimer), journal d'audit serveur, pas d'action groupée sans échelonnement.

## 8. Risques et questions ouvertes

### 8.1 Risques

1. Argent réel : bug de mauvais bot (#86), confirmation désactivable, pas d'anti double clic, ids DOM `btn-actions-<trade_id>` dupliqués entre bots.
2. Réconciliation : une classification fausse produit un « fantôme prouvé » suivi d'une suppression ; écritures à laisser en Python tant que l'équivalence n'est pas testée.
3. Wallet partagé et netting : ne jamais sommer `balance.total` ; le bot sur sous-compte (vault) casse les heuristiques `exchange:trading_mode` ; boucle sur les dex HIP-3 obligatoire pour toute lecture de positions.
4. Définitions métier divergentes : drawdown (3 définitions), profit courant, capital de départ (4 formules), winrate pondéré. Unifier délibérément et tester contre les chiffres rapportés par les bots ; ne pas harmoniser la sémantique documentée du drawdown cumulé vs BotMaxDrawdownCard sans décision explicite.
5. Honnêteté des données : chaque chiffre doit porter son âge, une donnée périmée n'est jamais présentée comme actuelle ni sommée (digest médian 63 s, max 2619 s).
6. Rate limits Hyperliquid : la passerelle ne doit pas recréer la tempête de 429 (budget, jitter, lecture HL au plus 1/60 s par wallet).
7. SQLite : lecture seule, timeout court, jamais de checkpoint ni d'écriture ; ignorer backup/replay/tmp.
8. Migration : changer la forme de `ftBotComparison` ou les ids de widgets réinitialise silencieusement les réglages ; garder les ids `ftbot.N`.
9. Sécurité : identifiants partagés par tous les bots, API des bots exposées sur 0.0.0.0 en http, tokens en clair dans localStorage et dans l'URL WS ; notifications navigateur et PWA impossibles sans HTTPS.
10. Mobile : tout est au survol ou en drag-and-drop HTML5 ; le layout `sm` masque chart et tables sur la page bot (layout.ts:51-55).
11. Alertes : ne pas recopier les bugs (`noTradeActivity` ms/s, `allFundsExposed` lit un champ absent, déclencheur de configuration manquant, dédup incluant le message) ; respecter la règle Telegram court et sans spam.
12. Chaînes de logs dont dépendent les alertes (« Wallet shows a total of 0 », « Refusing to adjust », « Could not create », « ExchangeError ») : suivre les logs de tous les bots côté passerelle.
13. Écarts entre cartographies à garder en tête : 14 types d'alerte listés mais le store en déclarerait 16 ; BotComparisonList fait 7166 lignes (une tranche l'estimait à ~5100) ; 24 bots tournent contre « +30/40 » annoncés (dimensionner pour 50).
14. Graphiques : ECharts fusionne les séries par index ; utiliser des ids ou `replaceMerge` ; le refetch complet à chaque nouvelle bougie doit devenir un ajout.

### 8.2 Questions ouvertes

1. Topologie réseau : passerelle sur un port distinct avec CORS et UI toujours servie par :9400, ou passerelle qui sert l'UI (et alors comment conserver l'origine sans redémarrer le bot :9400) ?
2. Registre des bots : découverte /proc (comme `discover_bots`), import unique du `ftAuthLoginInfo` du navigateur, ou les deux ? Comment la passerelle obtient-elle les identifiants pour des bots distants ?
3. Préférences (groupes, tags, layouts, seuils) : rester par navigateur ou passer côté passerelle pour être identiques sur téléphone et ordinateur ?
4. Forceexit doit-il rester accessible depuis le tableau de flotte, ou seulement dans le TradeDrawer ? Garder sortie partielle et augmentation de position malgré le minimum notionnel et le netting ?
5. Actions groupées (fermer toutes les positions perdantes, stopper N bots) : voulues, et avec quel échelonnement ?
6. Journal d'audit serveur de chaque mutation (qui, quand, bot, trade, payload, résultat) : voulu ?
7. Bots arrêtés (~16 ledgers SQLite orphelins) : à afficher comme « arrêtés » ?
8. Market context (MarketPulse, benchmarks au-delà de BTC, conversion de devise) : à supprimer entièrement ?
9. Fuseau du P&L quotidien : UTC ou Europe/Paris ?
10. Historique de logs au-delà des 200 dernières lignes par bot : voulu ?
11. `/trades/{id}/amount` est-il présent sur tous les bots tournant aujourd'hui (requis par realign) ?
12. Le dépôt `titouannwtt/frequi-ultimate` est-il public, et comment la version 0.8.0-perf a-t-elle été produite ?
13. Langues : supprimer es/de/it/pt immédiatement, en gardant le repli vers EN pour les utilisateurs qui avaient choisi ces langues ?
14. Le menu Outils conserve-t-il Backtest malgré la règle « jamais de backtest proposé » ?
