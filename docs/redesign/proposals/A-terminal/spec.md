# Proposition A : « Terminal »

Un terminal de trading professionnel pour superviser 24 à 50 bots Freqtrade sur un wallet Hyperliquid partagé.
Inspirations : Bloomberg Terminal (densité, mnémoniques clavier), TradingView et Hyperliquid (graphique, carnet de positions), Linear (finition, palette de commandes, mouvement sobre).

Maquettes (HTML autonome, données fictives, thème sombre par défaut, `T` bascule le thème) :

| Fichier | Contenu | Paramètres de démonstration |
|---|---|---|
| `dashboard.html` | Page Flotte | `#pulse` (tiroir bot), `#confirm` (dialogue argent réel), `#palette`, `#logs`, `?conn=direct`, `?skeleton=1`, `?theme=light` |
| `bot-detail.html` | Page Bot : graphique, positions, échelle DCA, actions | `#trade` (feuille basse mobile), `#exitall`, `?bot=<nom>` |
| `journal.html` | Journal des trades fermés et analyse | `#dca` (onglet profondeur DCA) |
| `design-system.html` | Planche de jetons, contrôles, états, mouvement, dialogue | boutons de démonstration des trois niveaux de confirmation |

Captures : `screens/` (390 x 844, 768 x 1024, 1440 x 900, 1920 x 1080, clair et sombre, états).

---

## 1. Principes

1. **Un chiffre, une vérité, un âge.** Chaque valeur porte sa fraîcheur. Une donnée périmée est hachurée, jamais sommée, et le total dit combien de bots il exclut (« 2 exclus »).
2. **Densité sans bruit.** Les filets séparent, les ombres sont réservées aux éléments flottants. La couleur porte un sens, jamais une décoration. Les chiffres sont en monospace tabulaire, donc ils ne bougent pas quand ils changent.
3. **Le clavier d'abord, le pouce ensuite.** Toutes les actions passent par la palette `Ctrl K` et des raccourcis. Sur téléphone, tout ce qui était au survol devient tap, tiroir ou feuille basse.
4. **L'argent réel est un mode visuel.** Le violet `--live` ne sert qu'à signaler l'argent réel. Toute action live affiche le bot cible, demande un maintien du bouton, ne peut partir qu'une fois et renvoie un reçu.
5. **Fusionner plutôt qu'empiler.** 20 widgets deviennent 9 composants partagés entre les pages. Le même panneau sert à un bot, un groupe ou la flotte.

---

## 2. Architecture de l'information et navigation

### 2.1 Pages de premier rang

| Page | Route | Raccourci | Rôle |
|---|---|---|---|
| Flotte | `/` et `/dashboard` | `G D` | Surveiller, voir les alertes, agir vite |
| Bot | `/bot/:id` (redirections `/trade`, `/open_trades`, `/balance`, `/pairlist`) | `G B`, `[` `]` bot précédent/suivant | Piloter un bot : graphique, positions, DCA, actions |
| Graphiques | `/charts?bot=&pair=` | `G C` | Analyse plein écran multi-paires |
| Journal | `/journal` (redirection `/trade_history`) | `G J` | Historique, totaux, distributions, export |

Les anciennes routes restent valides et redirigent, y compris `?bot=` et `?highlight=`.

### 2.2 Menu Outils (discret)

Une entrée « Outils » en fin de navigation (icône clé, sans badge), qui ouvre un menu :

- Strategy Dev, Backtest, Télécharger des données, Configuration de pairlist (pages existantes, recâblées sur les jetons).
- Diagnostic : RequestTimeline, Sankey par méthode, budget rate détaillé (C6).
- Risque avancé : stress test avec les vrais prix de liquidation (C5).
- Comparateur de volume (une seule requête cachée côté passerelle).
- Replay dry (DryReplayModal), avec confirmation forte pour `reset_db`.
- Réconciliation du wallet (page complète de FleetviewReconciliation).

Ces pages ne figurent ni dans la barre mobile ni dans les raccourcis `G`. On les ouvre par le menu ou par la palette (« outil : backtest »).

### 2.3 Coquille desktop (≥ 1024 px)

```
+----------------------------------------------------------------------------------+
| FT FreqUI | Flotte Bot Graphiques Journal Outils v |  [Ctrl K palette]  ● 38 ms  🔔 ☀ ⚙ |  44 px
+----------------------------------------------------------------------------------+
| bandeau de page (KPI flotte, en-tête bot ou filtres journal)                     |  56-70 px
+----------------------------------------------------------------------------------+
| périmètre (FleetScope) : Live/Dry/Tout · recherche · groupes · tags · alertes · espace |  36 px
+----------------------------------------------------------------------------------+
|                                                                                  |
|                  panneaux redimensionnables (grille de la page)                  |
|                                                                                  |
+----------------------------------------------------------------------------------+
| Santé OK · Bots 31/32 · Budget HL 41 % · Backoff 0 · Cache 97 % · Snapshot 2 s · Logs 3 err · Densité |  24 px
+----------------------------------------------------------------------------------+
```

- **Barre d'état basse** : elle tient la santé système (C6) et l'accès aux logs (C7), comme la barre d'état d'un IDE. Un clic sur « Santé » ouvre le tiroir SystemHealth ; un clic sur « Logs » déplie le panneau LogStream par le bas.
- **Indicateur de connexion** en haut à droite (§ 9).
- **Cloche** : nombre d'alertes non acquittées, critiques et avertissements (les infos ne comptent pas). Un clic défile jusqu'à l'AlertRail ou ouvre le tiroir des alertes sur les autres pages.

### 2.4 Coquille mobile (< 600 px)

- En-tête de 52 px : logo, loupe (palette), pastille de connexion (texte affiché seulement hors passerelle), cloche, thème.
- **Barre d'onglets basse** de 56 px, 5 entrées : Flotte, Positions, Bot, Journal, Alertes (avec badge). Réglages et Outils sont dans la palette et dans le menu du logo.
- Les panneaux s'empilent dans un ordre de priorité de supervision : Alertes, Flotte (carte), Positions, Équité, Risque.
- Les tableaux deviennent des listes de cartes de 2 lignes (≥ 56 px de haut), avec le même registre de colonnes : `m1` identité, `m2` chiffre principal, `m3` contexte, `m4` chiffre secondaire.
- Les tiroirs deviennent des feuilles basses avec poignée, et les dialogues de confirmation se collent en bas avec des boutons de 48 px.
- Respect de `env(safe-area-inset-*)`.

### 2.5 Tablette (600 à 1023 px)

Navigation icônes seules, bandeau KPI en grille de 4, panneaux en 2 colonnes empilées, colonnes secondaires des tableaux masquées (`30 j`, `âge`, `raison`, `24 h`).

---

## 3. Pages

### 3.1 Flotte (`dashboard.html`)

**Bandeau KPI (KpiStrip, périmètre courant)** : Équité live, P&L jour (depuis 00:00 Europe/Paris), P&L ouvert (nombre de positions), Réalisé 30 j (winrate), Exposition long / short / net avec barre fendue, Marge utilisée, Bots en ligne (hors ligne, périmés), BTC · ETH (C12). Chaque somme exclut les bots périmés et l'affiche (« 2 exclus »).

**Grille 1440 x 900** (zones nommées, poignées de redimensionnement entre les panneaux) :

```
+-------------------------------------+------------------+
| FleetTable (Table | Carte)          | EquityCurve      |
|                                     | (Équité, Classement, Calendrier) |
|                                     +------------------+
|                                     | AlertRail / EventFeed |
+-------------------------------------+                  |
| TradeTable « open » (flotte)        +------------------+
|                                     | RiskPanel        |
+-------------------------------------+------------------+
```

À partir de 1800 px, une 3e colonne permanente reçoit l'AlertRail sur toute la hauteur et le RiskPanel montre 8 coins au lieu de 5.

- **FleetTable** : ligne Σ « Flotte live » collante, puis groupes repliables (agrégats par groupe), puis une ligne de 28 px par bot. Colonnes : statut + nom + LIVE/DRY + icône d'alerte, sens, P&L ouvert, jour, 30 j, sparkline 24 h, exposition, slots (jauge), drawdown / seuil (jauge avec repère du seuil), dernier trade, âge. Actions de ligne au survol ou au focus : pause des entrées, menu. Clic sur une ligne : tiroir BotPulse. Clic sur un en-tête de groupe ou sur Σ : même tiroir au périmètre groupe ou flotte (ScopeDrilldown). Tri au clic sur l'en-tête ; navigation `J` / `K`, `Entrée` ouvre.
- **Vue Carte** (touche `M`) : une tuile par bot, teinte proportionnelle au P&L ouvert rapporté au capital (± 4 %), point violet plein = live, cercle = dry, bordure rouge = critique, hachures = périmé. C'est la vue par défaut sur téléphone : 32 bots tiennent sur un écran.
- **Positions ouvertes** (TradeTable preset `open`) : paire (+ xyz, + orpheline), bot, sens et levier, pips DCA, entrée moyenne, prix, P&L, %, distance de liquidation (jauge colorée), durée, bouton « Sortir » (danger contour, visible au survol). Tri par défaut : pires P&L en haut. Filtres rapides : En perte, DCA ≥ 3, xyz.
- **EquityCurve** : réalisé + latent (aire), réalisé seul (pointillés), drawdown en sous-graphe synchronisé. En-tête chiffré : total, drawdown max, meilleur jour, écart vs BTC (≥ 1600 px). Onglets Classement (Leaderboard) et Calendrier (PnlCalendar) dans le même panneau.
- **AlertRail** : critiques d'abord, chaque alerte porte son action utile (Pause entrées, Voir logs, Réconcilier, Reprendre) puis Acquitter et Silence 1 h. Onglet Événements : vrais événements poussés par la passerelle (fills DCA, sorties avec raison et P&L, bot hors ligne, rechargement).
- **RiskPanel** : distance de liquidation minimale (paire), levier effectif, nombre de coins tenus par au moins 2 bots (netting), barres long/short par coin avec le nombre de bots (`×3`) au survol.

### 3.2 Bot (`bot-detail.html`)

**En-tête bot** : bot précédent/suivant, statut, nom, LIVE/DRY, sélecteur de bot (`B`), méta (stratégie, timeframe, levier, port, uptime, âge des données), KPI du bot (même KpiStrip), puis la barre d'actions. Actions non destructives à gauche : Pause entrées, Recharger, Config, menu `...` (Start, Stop, Entrée forcée, Replay). Après un espace se trouve **Tout sortir**, seul bouton danger de l'en-tête.

**Grille 1440** :

```
+-----------+-------------------------------+---------------------+
| Paires    | Graphique 15m avec niveaux    | TradeDrawer docké   |
| (PairNav) | Moy., TP, SO suivant, fills   | P&L, faits, échelle |
|           +-------------------------------+ DCA, ordres,        |
|           | Positions | Historique | Perf | autres actions      |
|           | Pairlist et verrous | Logs    +---------------------+
|           |                               | Sortie (collante)   |
+-----------+-------------------------------+---------------------+
```

- **PairNavigator** (C11) : positions tenues en tête (sens, DCA n/m, %), puis la whitelist avec variation, badge « signal entrée », cadenas avec durée restante. Filtres : Toutes, Pos., Signal, Verrou.
- **Graphique** : chandelier ECharts, lignes Moy. (pleine, accent), TP (tirets verts), SO suivant (tirets ambre), triangles E, S1, S2... aux fills. La liquidation hors champ est annoncée sur le bord avec sa distance. Bouton « Ouvrir dans Graphiques ».
- **TradeDrawer docké** (C10) : paire, sens, levier, HIP-3, bot (rappel explicite) ; P&L en 26 px ; 6 faits (taille, marge, DCA, vers TP, vers SO suivant, vers liquidation) ; **échelle DCA** (§ 10) ; tableau des ordres (remplis puis en attente) ; « Autres actions » (annuler l'ordre en attente, recharger le trade, supprimer de la DB, cette dernière en rouge texte avec l'info-bulle « ne ferme pas la position »). **Pied collant « Sortie »** : 25 / 50 / 100 %, montant en USDC, alerte si en dessous du minimum de 10 USDC, « Sortir au marché » et « Renforcer ». Le bouton de sortie reste donc toujours visible, sans défilement.
- **Onglets bas** : Positions (TradeTable bot), Historique (preset `closed`, lien vers le Journal filtré), Performance (barres par paire), Pairlist et verrous (méthodes, verrous, blacklist avec confirmation), Logs (LogStream filtré sur le bot), Config (résumé lisible + « Éditer » qui ouvre l'éditeur Monaco existant avec revue du diff).
- **Mobile** : en-tête, KPI 3 x 2, barre d'actions défilante, positions en premier, graphique de 300 px, le TradeDrawer en feuille basse au tap sur une position.
- **Clavier** : `J` / `K` position suivante/précédente, `X` sortir (ouvre la confirmation), `P` pause des entrées, `[` `]` bot voisin.

### 3.3 Graphiques (`/charts`, pas de maquette)

Même moteur que la page Bot, en plein écran. Grille 1, 2 ou 4 cellules (`Alt 1/2/4`). Chaque cellule a sa paire et son bot, avec superposition des niveaux DCA du trade ouvert. PairNavigator en colonne gauche repliable, PlotConfigurator (préréglages migrés depuis `ftPlotConfig`) en tiroir droit, outil de mesure `Maj + glisser` (et appui long sur tactile). L'ajout de bougie se fait par delta (plus de refetch complet) et les séries sont fusionnées par `id`.

### 3.4 Journal (`journal.html`)

- **Barre de filtres** : période (24 h, 7 j, 30 j, MTD, YTD, Tout, plage), bots (FleetScope), sens, raison de sortie, profondeur DCA, recherche de paire, « Vue » (enregistrer le filtre), export CSV / XLSX de l'ensemble filtré (côté passerelle).
- **Totaux** : P&L net (frais inclus), trades (par jour), winrate (G / P), profit factor (gain et perte moyens), espérance par trade, pire trade, durée médiane (P90), pire moins-value **en absolu** (pas en %, qui confond risque et profit).
- **Liste** : preset `journal` virtualisé et paginé par la passerelle. Colonnes : fermé, bot, paire, sens, DCA (ambre si ≥ 4), P&L, %, **MAE · MFE** (micro-barre : pire excursion en rouge, meilleure en vert, trait blanc = sortie), raison (puce colorée par famille), durée. Vues « Par bot » et « Par paire » dans le même panneau.
- **Analyse** (deux panneaux à onglets) : Distribution (histogramme log, queue gauche ≤ −5 % en rouge plein, phrase de synthèse chiffrée), Profondeur DCA (P&L, nombre et winrate par nombre d'ordres remplis), Durée (nuage durée / P&L) ; Calendrier (PnlCalendar Europe/Paris), Par bot (Leaderboard), Raisons (barres).

### 3.5 Réglages (`/settings`, pas de maquette)

Page en colonnes de sections avec ancres :

1. **Bots** (registre, C13) : liste du registre passerelle (ou local en mode direct), ajout, renommage, icône, groupe, tags, seuils d'alerte par bot, test de connexion. Import et export uniques (formats v1 et v2 de `useConfigExport` lus).
2. **Affichage** : langue FR / EN, thème Sombre / Clair / Système, densité, fuseau du P&L quotidien, mouvement réduit forcé.
3. **Alertes et notifications** : règles (seuils, silence, dédoublonnage) côté passerelle, notifications navigateur (avec explication si contexte http non sécurisé).
4. **Graphiques** : échelle, Heikin Ashi, couleurs haussière et baissière.
5. **Espaces de travail** : liste, renommer, réinitialiser.
6. **Sécurité des actions** : niveau de confirmation par mode (live : maintien + saisie pour Tout sortir ; dry : clic). Il n'existe **aucune option pour désactiver la confirmation en live**.
7. **À propos** : versions UI et passerelle, mode de connexion, journal d'audit des actions (si la passerelle l'expose).

---

## 4. Catalogue des widgets après fusion

### 4.1 Composants cibles

| Composant | Utilisé dans | Remplace |
|---|---|---|
| `KpiStrip` | Flotte (bandeau), Bot (en-tête), Journal (totaux), tiroir BotPulse (tuiles) | cartes Summary, BotProfit 22 métriques, bandeaux de stats |
| `FleetTable` (+ vue `FleetMap`) | Flotte | BotComparisonList, FleetviewBotsTable, FleetOverview |
| `ScopePanel` (BotPulse / ScopeDrilldown) | Flotte (tiroir), mobile (feuille) | 18 cartes au survol, cartes de groupe et de flotte |
| `TradeTable` (presets `open`, `closed`, `journal`, `bot`) | Flotte, Bot, Journal, tiroir | OpenTradesEnhanced, ClosedTradesEnhanced, TradeJournalView, listes mobiles |
| `TradeDrawer` (+ `DcaLadder`) | Bot (docké), Flotte et Journal (tiroir), mobile (feuille) | TradeDetail, TradeDetailPopover, ChartPopover, DcaInfoPopover, popovers de stats |
| `EquityCurve`, `PnlCalendar`, `Leaderboard`, `DistributionChart` | Flotte, Journal, Bot | 16 éléments P&L (C4) |
| `RiskPanel` | Flotte, Outils (version détaillée) | RiskOverview, FleetviewExposure, SummaryTradesCard |
| `AlertRail` + `EventFeed` | Flotte, cloche, tiroir global | useAlertDetection, ActivityTimeline, AlertDetailCard |
| `LogStream` (compact, page) | Barre d'état, Bot > Logs, Outils | LogConsoleWidget, LogViewerEnhanced, page Logs |
| `SystemHealth` | Barre d'état + tiroir, Outils > Diagnostic | InfrastructureHealth, CacheRateMonitor, CacheStatusWidget, RateBudget, RatePulse |
| `PairNavigator` | Bot, Graphiques | PairSummary, PairSelectorAdvanced, PairListLive, PairLockList, PairlistInfoCard |
| `FleetScope` | Barre de périmètre de toutes les pages | filtres de CL, filtres live/dry par widget, double sélection |
| `BotActionMenu` + `ConfirmDangerDialog` + `useBotAction(botId)` | Partout où il y a une mutation | BotControls, menu de CL, TradeActionsPopover, ForceExit/EntryForm |
| `CommandPalette` | Global | raccourcis épars (CL, charts, PlotConfigurator) |

### 4.2 Correspondance des clusters C1 à C15

| Cluster | Devient | Raison |
|---|---|---|
| **C1** Tableau de flotte | `FleetTable` (+ vue `FleetMap`) | Une ligne de 28 px, 12 colonnes utiles ; les 8 colonnes de config (port, stratégie, stake...) passent dans l'en-tête Bot et le tiroir. Groupes repliables avec agrégats, Σ collante, tri par en-tête, recherche. La carte remplace le tableau sur mobile. Données poussées par la passerelle, jamais recalculées au tick. |
| **C2** Carte par bot | `ScopePanel` au périmètre bot (tiroir) et en-tête de la page Bot | Les 10 cartes (Open/Closed/Period/Balance/WinLoss/BotInfo/TradesInfo, BotStatus, BotProfit, drawdown) deviennent 6 tuiles + alertes + actions + positions + équité 24 h. WinLossCard supprimée (winrate dans une tuile). Projections composées supprimées. |
| **C3** Cartes de flotte et de groupe | Même `ScopePanel` au périmètre groupe ou flotte (clic sur Σ ou sur un en-tête de groupe) | Un seul composant paramétré ; le capital de départ vient du registre (jamais `balance.total` sur wallet partagé). |
| **C4** Courbes et périodes P&L | `EquityCurve` (Flotte, Bot), `PnlCalendar` et `Leaderboard` (onglets du même panneau sur Flotte, panneau Journal), `DistributionChart` (Journal) | 16 éléments pour 4 questions : où en est l'équité, quels jours, quels bots, quelle forme des pertes. Benchmarks réduits à « vs BTC » chiffré. CumulativeProfitEnhanced, ProfitOverTimeEnhanced, PerformanceHeatmap supprimés (idée calendrier reprise). WalletHistory et CumProfit restent dans Backtest (Outils). |
| **C5** Risque et exposition | `RiskPanel` sur Flotte ; stress test dans Outils > Risque | Exposition long / short / net wallet-level, distance de liquidation minimale, levier effectif, coins tenus par plusieurs bots. Le stress test simpliste quitte le tableau de bord. |
| **C6** Infra et rate-limit | `SystemHealth` : résumé dans la barre d'état, tiroir détaillé, RequestTimeline dans Outils > Diagnostic | Le niveau de santé et ses raisons tiennent sur une ligne de 24 px ; les 4 ECharts de jauges disparaissent. CacheStatusWidget, RateBudget, RatePulse supprimés. |
| **C7** Logs | `LogStream` : panneau déroulant depuis la barre d'état (erreurs par défaut), onglet Logs de la page Bot, page complète dans Outils | Un composant, deux modes, curseur côté passerelle. |
| **C8** Alertes et événements | `AlertRail` + `EventFeed` + badge de la cloche | Alertes structurées calculées 24/7 par la passerelle, chacune avec son action, acquittement et silence ; vrais événements (fills, sorties, hors ligne). Statut de réconciliation remonté en alerte « orpheline ». |
| **C9** Tables de trades | `TradeTable` avec presets `open`, `closed`, `journal`, `bot` et mode cartes | Registre de colonnes portant le rendu ; pagination, tri et filtres serveur ; routage `(botId, tradeId)` ; TradeList, TradesLogEnhanced, CustomTradeList supprimés. |
| **C10** Détail de trade | `TradeDrawer` (docké sur Bot, tiroir ailleurs, feuille basse mobile) avec `DcaLadder` | Vue d'ensemble, échelle DCA, ordres, actions, sortie collante. MAE / MFE (idée de ProfitRangePopover) déplacé dans le Journal avec calcul serveur. StoplossChartPopover supprimé. |
| **C11** Navigation de paires | `PairNavigator` (Bot, Graphiques) + onglet « Pairlist et verrous » | Un sélecteur unique : positions, signaux, verrous ; édition de blacklist et levée de verrou avec confirmation. |
| **C12** Contexte marché et devises | Ticker BTC · ETH dans le bandeau KPI, servi par la passerelle | MarketPulse, ExchangeInfoCard, CurrencyInfoCard, conversion de devise : supprimés. Tout est en USDC. |
| **C13** Gestion des bots et réglages | Page Réglages, section Bots en tête | Home et BotList fusionnés dans le registre ; import et export à un seul endroit ; barre d'édition du layout supprimée (espaces de travail). |
| **C14** Actions sur un bot | `BotActionMenu` + `ConfirmDangerDialog` + `useBotAction(botId)` | Même menu dans la ligne de flotte, le tiroir et l'en-tête Bot ; § 8. |
| **C15** Sélection, filtres, groupes | `FleetScope` : barre de périmètre unique (Live / Dry / Tout, recherche `F`, groupes, tags, « En alerte ») | Un seul état de périmètre partagé par tous les panneaux d'une page et conservé entre pages ; un filtre actif est toujours visible (puce pleine) et jamais silencieux. |

---

## 5. Système de design

Les jetons sont des variables CSS uniques. Elles alimentent le preset PrimeVue en mode unstyled (pass-through) et le thème ECharts enregistré par `BaseChart`. Les trois systèmes actuels (Aura, `--sd-*`, mode clair ad hoc) sont remplacés. Les `--sd-*` restent comme alias le temps de migrer StrategyDev.

### 5.1 Couleurs

| Jeton | Sombre | Clair | Usage |
|---|---|---|---|
| `--bg` | `#0a0c0f` | `#f3f5f8` | fond |
| `--bg-1` | `#0f1216` | `#ffffff` | panneau |
| `--bg-2` | `#151a1f` | `#f6f8fa` | en-tête, survol |
| `--bg-3` | `#1c2228` | `#eaeef3` | contrôle actif, rail de jauge |
| `--line` / `--line-2` | `#1f262d` / `#2a333c` | `#e2e7ed` / `#cfd6de` | filets, bordures de contrôle |
| `--fg` / `-2` / `-3` / `-4` | `#e3e8ee` / `#a3adb9` / `#6c7785` / `#4a5460` | `#0f1720` / `#3f4a57` / `#6a7684` / `#9aa4b0` | texte, secondaire, libellé, désactivé |
| `--accent` | `#4f8cff` | `#2563eb` | focus, sélection, lien, moyenne d'entrée |
| `--profit` | `#26c281` | `#0a8f5a` | gain, long |
| `--loss` | `#ff5468` | `#d92d45` | perte, short, critique, danger |
| `--warn` | `#f2b33d` | `#b7791f` | avertissement, périmé, dernier renfort DCA |
| `--info` | `#45b6e8` | `#0b7fb5` | information, HIP-3 xyz, slots |
| `--live` | `#b583ff` | `#7c3aed` | **argent réel uniquement** |
| `--dry` | `#8794a3` | `#64748b` | dry-run (contour, jamais plein) |

Chaque couleur sémantique a une variante `-w` (13 % sombre, 10 % clair) pour les fonds de puces, de flash et de lignes. Les contrastes du texte principal et des chiffres sont ≥ 4,5:1 sur `--bg-1` dans les deux thèmes. Profit et perte ne sont jamais portés par la couleur seule : le signe `+` / `−` (vrai signe moins U+2212) est toujours affiché. Le motif « périmé » est une hachure ambre à 135° (`--stale-hatch`).

Couleur stable par bot (graphiques multi-séries) : teinte dérivée d'un hachage de l'id `ftbot.N`, dans une palette de 12 teintes à luminance égale ; jamais rouge, vert ou violet pur.

### 5.2 Typographie

- **Inter** pour l'interface (`cv11`, `ss01`), **JetBrains Mono** pour tout chiffre (`tabular-nums`, `slashed-zero`), classe utilitaire `.num`.
- Formatage FR : espace fine insécable pour les milliers, virgule décimale, précision des prix selon l'ordre de grandeur (1 à 5 décimales), P&L à 2 décimales, % à 2 décimales, durées « 23 h 04 », « 2 j 4 h ».

| Rôle | Desktop | Tactile |
|---|---|---|
| `2xl` P&L du tiroir | 26 | 28 |
| `xl` KPI | 20 | 22 |
| `lg` titres, KPI secondaires | 15 | 16 |
| `md` texte d'interface | 13 | 14 |
| `sm` cellules de table | 12 | 13 |
| `xs` sous-lignes, boutons sm | 11 | 12 |
| `micro` libellés en capitales (+0,06 em) | 10,5 | 11 |

### 5.3 Espacement, rayons, élévation

- Échelle 4 px : 2, 4, 6, 8, 12, 16, 20, 24, 32. Gouttière entre panneaux : 6 px desktop, 8 px mobile. Padding de panneau : 10 à 12 px.
- Rayons : 3 (puces, champs), 5 (boutons, panneaux), 8 (dialogues, palette), 14 en haut des feuilles basses.
- Élévation : niveau 0 = filet ; niveau 1 = `--shadow-float` réservé à la palette, aux tiroirs, aux dialogues et aux toasts. Aucun `backdrop-filter` sauf la barre d'onglets mobile.

### 5.4 Densité

| Mode | Ligne | Contrôle | Activation |
|---|---|---|---|
| Compacte | 28 px | 28 px | défaut desktop |
| Confort | 34 px | 32 px | bascule dans la barre d'état ou Réglages |
| Tactile | 44 px | 40 px (zone d'appui 44+) | automatique si `pointer: coarse` ou largeur < 600 px |

### 5.5 Points de rupture et grille

| Nom | Largeur | Grille |
|---|---|---|
| `xs` | < 600 | 1 colonne, cartes, barre d'onglets basse |
| `sm` | 600-1023 | 2 colonnes empilées, navigation en icônes |
| `md` | 1024-1439 | grille de page en zones (2 colonnes), colonnes secondaires masquées |
| `lg` | 1440-1799 | grille complète (colonne droite `clamp(360px, 30vw, 460px)`) |
| `xl` | ≥ 1800 | 3e colonne permanente (alertes), plus de lignes visibles |

Les grilles de pages sont des `grid-template-areas` nommées. Les panneaux redimensionnables stockent des fractions, pas des pixels, pour suivre l'écran.

### 5.6 Iconographie

- **Lucide** via `unplugin-icons` (`@iconify-json/lucide`), qui remplace `mdi`. Trait de 1,75, tailles 13 (dans les tables), 15 (défaut), 18 (états vides), 20 (barre mobile).
- Règles : une icône ne remplace jamais un libellé d'action argent réel (« Sortir » est toujours écrit) ; les boutons icône seuls ont un `aria-label` et une info-bulle avec raccourci ; pas d'emoji dans l'interface (les emojis de groupes existants sont conservés comme données utilisateur et affichés à côté du nom).
- Lexique fixe : `pause` pause des entrées, `refresh-cw` recharger, `log-out` sortir, `plus` renforcer, `triangle-alert` avertissement, `octagon-alert` critique, `plug-zap` hors ligne, `lock` verrou, `terminal` logs, `activity` santé, `sigma` total, `layout-grid` flotte, `bot` bot, `book-open-text` journal, `candlestick-chart` graphiques, `wrench` outils.

### 5.7 Boutons et contrôles

| Taille | Desktop | Tactile | Usage |
|---|---|---|---|
| `xs` | 22 | 36 (+ zone 44) | actions de ligne |
| `sm` | 24 | 36 (+ zone 44) | en-têtes de panneau, filtres |
| `md` | 28 | 40 | défaut |
| `lg` | 36 | 48 | dialogues, pied du TradeDrawer |

Variantes : secondaire (défaut), fantôme, primaire (un seul par zone), danger (contour rouge), danger plein (uniquement dans le dialogue de confirmation). États : survol, appui (`translateY(1px)`), focus (anneau accent 2 px), occupé (`aria-busy`, spinner, clic ignoré), désactivé. `SegmentedControl` pour les périodes et modes, `fchip` pointillée pour les filtres (pleine quand active).

---

## 6. Mouvement

| Jeton | Durée | Courbe | Usage |
|---|---|---|---|
| `--d-instant` | 80 ms | `--e-out` | survol, appui, lignes |
| `--d-fast` | 140 ms | `--e-out` | onglets, bascules, chevrons de groupe |
| `--d-base` | 200 ms | `--e-out` / `--e-spring` | palette, toasts, dialogue |
| `--d-slow` | 320 ms | `--e-out` | tiroirs, feuilles basses, jauges |
| `--d-flash` | 900 ms | `--e-out` | flash de valeur |

Courbes : `--e-out` `cubic-bezier(.2,.8,.2,1)`, `--e-inout` `(.65,0,.35,1)`, `--e-spring` `(.34,1.4,.64,1)` (entrée du dialogue seulement).

**Ce qui s'anime** : compteurs (interpolation de 420 ms sur la valeur, sans changer de largeur grâce aux chiffres tabulaires) ; flash vert ou rouge du fond de la cellule et liseré inférieur à chaque changement de P&L ; squelettes au premier snapshot (shimmer 1,3 s) ; entrée en cascade des alertes (40 ms d'écart) ; pouls de la pastille de connexion (2,4 s) ; remplissage du bouton de maintien (1,1 s linéaire) ; tiroirs et feuilles ; courbe d'équité au premier rendu.

**Ce qui ne s'anime jamais** : la position et l'ordre des lignes pendant un tick (le tri se fige tant que le pointeur est sur la table ou qu'une ligne a le focus) ; la largeur des colonnes ; les graphiques à chaque delta (ajout de point sans transition) ; les fonds animés en boucle (supprimés) ; tout ce qui se trouve sous une boîte de confirmation ouverte.

**prefers-reduced-motion** : durées ramenées à 1 ms, compteurs et flashes coupés (la nouvelle valeur s'affiche directement), shimmer statique, maintien raccourci à 400 ms mais conservé.

---

## 7. États de données

| État | Rendu | Règle |
|---|---|---|
| Chargement | Squelettes à la forme du contenu (lignes de table, KPI) ; le reste de la page s'affiche dès que son canal arrive | jamais de spinner plein écran ; le BootSplash disparaît au premier snapshot WS |
| Vide | Icône 18 px + phrase utile (« Aucune position ouverte. Le bot attend un signal. ») | pas de panneau vide sans explication |
| Erreur | Message court + cause (timeout, 401, 5xx) + « Réessayer » | l'erreur reste dans le panneau concerné |
| Périmé | Hachures ambre, âge en ambre, valeur en `--fg-3` | exclu de toute somme, compteur « n exclus » dans le total |
| Hors ligne (bot) | Ligne à 55 % d'opacité, « n/d » au lieu du P&L, alerte critique avec « Voir logs » et « Diagnostic » | ne jamais proposer de relancer un bot uniquement pour un forceexit |
| Hors ligne (réseau) | Pastille rouge, toutes les valeurs figées avec leur âge, actions argent réel désactivées avec info-bulle | reconnexion automatique avec repli exponentiel |

Seuils d'âge par défaut : 30 s pour les positions, 120 s pour les agrégats lents, 15 min pour l'historique (réglables).

---

## 8. Actions argent réel

**Règles** :

- Chaque mutation passe par `useBotAction(botId)` et porte `(botId, tradeId)` de bout en bout. Il n'y a plus de notion de « bot actif » pour agir.
- **Bot cible toujours explicite** : nom du bot + puce LIVE / DRY dans le menu, dans le bouton de ligne (info-bulle) et en première ligne du dialogue.
- **Trois niveaux de confirmation** :
  1. Dry : dialogue + clic.
  2. Live : dialogue + **maintien du bouton 1,1 s** (barre de progression dans le bouton ; Entrée maintenue au clavier). Le relâcher avant la fin annule.
  3. Live et irréversible en masse (Tout sortir, Supprimer de la DB, réalignement, reset_db de replay) : maintien + **saisie du nom du bot**.
- Le dialogue est **non désactivable en live** (l'option `confirmDialog` n'agit que sur le dry).
- **Verrou en vol** : au premier déclenchement, le bouton passe en `aria-busy` et une clé d'idempotence est générée ; tout second clic ou appui est ignoré jusqu'à la réponse. La passerelle ne rejoue jamais un POST non idempotent.
- **Feedback en deux temps** : toast ambre « envoyé à hippo_multi, en attente du fill » (clé d'idempotence), puis reçu vert avec quantité, prix de fill, P&L réalisé et latence, ou toast rouge avec la raison réelle (refus de `confirm_trade_exit`, minimum notionnel, 429). La ligne concernée garde un état « en cours » tant que le statut n'est pas confirmé par le snapshot suivant.
- **Bande d'en-tête** du dialogue : hachures violettes en live, grises en dry, visibles à 1 m de l'écran.
- **Avertissements contextuels** dans le dialogue : wallet partagé (seule la quantité du trade est réduite), position orpheline (passe par la réconciliation), montant sous le minimum de 10 USDC, « mettez les entrées en pause d'abord » avant Tout sortir, « espacez les rechargements de 10 min » pour Recharger.
- **Ordre spatial** : les actions destructives sont séparées des autres par un espace ou un filet ; « Supprimer de la DB » n'est jamais voisin de « Sortir ».
- **Aucune action groupée sans échelonnement** : la palette refuse « recharger N bots » et propose un enchaînement espacé de 10 min avec compte à rebours annulable.
- **Journal d'audit** : chaque mutation est visible dans Réglages > À propos (si la passerelle l'expose) : qui, quand, bot, trade, payload, résultat.

---

## 9. Connexion : passerelle ou mode direct

| Mode | Pastille | Comportement |
|---|---|---|
| Passerelle | point vert pulsé + « Passerelle 38 ms » (latence du dernier delta) | snapshot puis deltas WS, alertes 24/7, journal et exports serveur |
| Direct | point ambre fixe, bordure ambre, libellé « Direct » visible même sur mobile | polling actuel par bot avec cadences ralenties ; panneaux qui dépendent de la passerelle (alertes 24/7, événements, MAE / MFE, exports serveur) affichent « Indisponible en mode direct » ; un clic explique la cause et propose « Réessayer la passerelle » |
| Hors ligne | point rouge | valeurs figées avec âge, actions désactivées |

La barre d'état reprend l'âge du dernier snapshot. Le passage d'un mode à l'autre déclenche un toast unique (pas de répétition).

---

## 10. L'échelle DCA (composant signature)

Une colonne de prix verticale montre tout le plan DCA du trade : chaque niveau (Entrée, SO1, SO2...) est une barre dont la longueur est proportionnelle à la mise (pleine = remplie, pointillée = en attente). La moyenne d'entrée (accent), le TP (tirets verts), le prix courant (blanc, qui glisse au tick) et la liquidation (tirets rouges, ou flèche avec distance si hors champ) sont superposés. Lecture immédiate de trois questions : combien de renforts ont été remplis, à quelle distance est le prochain, à quelle distance est la liquidation. L'échelle existe en trois tailles : pips dans les tables (`▮▮▮▮▯▯`, dernier renfort ambre), mini dans le tiroir de flotte, complète dans le TradeDrawer.

---

## 11. Dashboard par défaut et personnalisation

- **Espaces de travail** (remplacent la grille libre en drag-and-drop) : trois préréglages livrés, sélectionnables par `Alt 1/2/3` ou dans la barre de périmètre.
  - **Surveillance** (défaut) : la disposition de la maquette.
  - **Incident** : AlertRail et LogStream en grand, FleetTable filtrée « En alerte », positions en perte en tête.
  - **Analyse** : EquityCurve et Leaderboard en grand, positions réduites.
- **Personnaliser** (bouton de disposition) : poignées de redimensionnement entre panneaux (fractions mémorisées), remplacement d'un panneau par un autre du registre via le menu de son en-tête, masquage. Pas de drag-and-drop libre : chaque zone accepte une liste de panneaux compatibles, donc la mise en page ne casse jamais.
- **Colonnes** : éditeur de colonnes par preset de TradeTable et pour FleetTable (ordre, visibilité). Les réglages actuels `enhanced*TradeColumns*` sont importés.
- **Persistance** : objet de réglages versionné (`ftTerminal.v1`), lu depuis les anciennes clés (`ftBotComparison`, `ftUISettings`, colonnes, `ftPlotConfig`) sans les modifier. Côté passerelle quand elle est présente (identique sur téléphone et ordinateur), en local sinon. `ftLayoutSettings` est ignoré : la disposition repart des espaces de travail.

---

## 12. Palette de commandes et clavier

`Ctrl K` ou `/` ouvre la palette. Les résultats sont groupés : Aller à, Bots (puce LIVE / DRY), Paires, Actions, Affichage. Les actions argent réel tapées dans la palette (« sortir HYPE hippo_multi ») ouvrent toujours le dialogue avec le bot cible, jamais une exécution directe.

| Touche | Action |
|---|---|
| `G D` / `G B` / `G C` / `G J` / `G S` | aller à Flotte, Bot, Graphiques, Journal, Réglages |
| `F` | focus recherche du périmètre |
| `M` | Table ou Carte de la flotte |
| `J` / `K`, `Entrée` | ligne suivante, précédente, ouvrir |
| `X` | sortir la position sélectionnée (confirmation) |
| `P` | pause des entrées du bot courant (confirmation) |
| `[` / `]` | bot précédent, suivant |
| `Alt 1/2/3` | espace de travail |
| `T` | thème |
| `?` | aide des raccourcis |
| `Échap` | fermer palette, tiroir, dialogue |

Aucune touche sans modificateur n'agit quand un champ a le focus ; `Ctrl A` n'est plus détourné.

---

## 13. Intégration technique (contraintes respectées)

- PrimeVue en mode unstyled avec pass-through. Les primitives (`Btn`, `Seg`, `Chip`, `Pane`, `DataTable` virtualisée, `Drawer`, `Dialog`) sont stylées par les jetons ci-dessus. Pas de Nuxt UI.
- Un seul `BaseChart` (enregistrement ECharts unique, thème dérivé des jetons, `replaceMerge` par `id`), ré-instancié au changement de thème.
- Thème appliqué via `data-theme` sur `<html>`, avec maintien de la classe `ft-dark-theme` pour les composants hérités pendant la migration.
- i18n FR (défaut) et EN uniquement. Toute chaîne passe par les fichiers de langue ; les langues retirées retombent sur EN.
- Pas de tiret cadratin dans l'interface (vérification automatique en CI sur les fichiers de langue).

---

## 14. Limites connues de cette proposition

- Les maquettes simulent la passerelle (deltas toutes les 2,6 s) : la latence réelle et le volume des deltas à 40 bots restent à mesurer.
- La page Graphiques et la page Réglages ne sont décrites que dans cette spécification, sans maquette.
- Le maintien de 1,1 s ralentit volontairement les sorties live. En cas de crise (sortir 8 positions vite), il faut passer par « Tout sortir » (une seule confirmation). Une option « maintien 600 ms » pourrait être envisagée, jamais une suppression.
- La vue Carte suppose que la teinte en fonction du P&L ouvert rapporté au capital est lisible pour les daltoniens ; le signe et la valeur restent écrits dans chaque tuile, mais un test réel est nécessaire.
- La densité compacte (28 px, texte de 12 px) vise un écran de bureau ; en 1280 px certaines colonnes (24 h, dernier trade) sont masquées.
- Les espaces de travail limitent la liberté de disposition par rapport à la grille actuelle : c'est un choix assumé (robustesse, mobile), à valider avec le propriétaire.
