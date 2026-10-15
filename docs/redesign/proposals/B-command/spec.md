# Proposition B : « Tour de contrôle », l'exception d'abord

Maquettes (fichiers autonomes, thème sombre par défaut, bascule clair/sombre en haut à droite) :

- `dashboard.html` : Tour de contrôle (page d'accueil `/` et `/dashboard`)
- `bot-detail.html` : page d'un bot (positions, échelle DCA, graphique, actions, confirmations)
- `journal.html` : Journal (totaux, calendrier, distribution, table, tiroir de trade)
- `system.html` : fondations (couleurs, typo, boutons, états, mouvement)
- `screens/` : captures 390, 768, 1440, 1920 et thème clair

Démos intégrées : bouton « Flotte calme / Incidents » et bascule de connexion (Passerelle, Direct, Hors ligne) en bas des pages desktop ; `bot-detail.html#confirm` et `#exitall` ouvrent les confirmations ; `journal.html#drawer` ouvre le tiroir ; `?theme=light` force le thème clair.

## 1. Idée directrice

Un écran de supervision doit être silencieux quand tout va bien et bruyant seulement là où il faut agir. La refonte applique trois règles :

1. **La couleur est un signal, pas une décoration.** Le fond, les cartes, les tuiles calmes et les graphiques sont neutres. Le vert et le rouge ne servent qu'au P&L ; l'ambre, le rouge vif et le hachuré ne servent qu'aux états qui demandent une décision. Un bot qui va bien ne « crie » pas.
2. **Ce qui demande attention remonte seul.** Un score de santé, un rail « À traiter » et le tri « Attention d'abord » amènent les incidents en haut de l'écran sur desktop et en tête de page sur téléphone. Le reste est à un clic.
3. **Chaque chiffre dit son âge.** La passerelle pousse des données horodatées ; une valeur périmée est grisée, exclue des totaux et porte son âge à la place de sa couleur.

Inspirations : salles d'opérations (Datadog, Grafana), contrôle aérien (strips en couleur seulement sur conflit), Stripe (sobriété, chiffres tabulaires, résumé « depuis votre dernière visite »).

## 2. Architecture de l'information et navigation

### 2.1 Pages de premier rang

| Page | Route | Rôle | Remplace |
|---|---|---|---|
| Tour de contrôle | `/` et `/dashboard` | Situation de la flotte, incidents, tendances | Home, Dashboard, `/logs` en mode compact |
| Bots | `/bots/:botId` (alias `/trade?bot=`) | Tout sur un bot : positions, DCA, historique, perf, paires, config, logs | `/trade`, `/balance`, `/pairlist`, `/open_trades`, `/trade_history` |
| Graphiques | `/charts?bot=&pair=` | Chandeliers plein écran, indicateurs, marquage des trades | ChartsView non routée, onglet chart de `/trade` |
| Journal | `/journal` | Historique fermé de la flotte, analyse, export | Journal, ClosedTradesEnhanced, ProfitDistribution, PeriodBreakdown |

`/bots` sans identifiant affiche la flotte en vue liste (FleetTable) ; c'est aussi le sélecteur de bot. Les anciennes routes redirigent (section 6.3 du document d'état) en conservant `?bot=` et `?highlight=`.

### 2.2 Menu Outils (discret)

Entrée « Outils » à droite de la navigation, menu déroulant groupé, jamais de badge :

- **Développement** : Strategy Dev, Backtest, Téléchargement de données, Pairlist config.
- **Exploitation** : Réconciliation du wallet, Replay dry, Stress test, Volume bots/exchange.
- **Diagnostic** : RequestTimeline, rate metrics détaillés, cache, logs bruts.

La Réconciliation est la seule entrée d'Outils qui peut être atteinte depuis une alerte (« Position orpheline » ouvre directement l'outil filtré sur la paire).

### 2.3 Réglages

Une page `/settings` à sections : Général (langue FR/EN, fuseau, thème clair/sombre/système, densité), Bots (registre, groupes, tags, ordre ; import/export unique), Alertes (règles, seuils, silences par défaut, notifications navigateur), Tour de contrôle (layout, widgets visibles, réinitialiser), Graphiques (échelle, Heikin Ashi, couleurs), À propos (versions UI et passerelle, mise à jour). La barre d'édition du dashboard et ses doublons disparaissent.

### 2.4 Desktop (>= 1024 px)

- **Barre du haut (52 px)** : marque, navigation (4 pages + Outils), badge rouge sur « Tour de contrôle » = nombre d'alertes actives non acquittées, déclencheur de palette (« Bot, paire, action… », `Ctrl K`), indicateur de connexion, thème, réglages.
- **Barre de périmètre (44 px, FleetScope)** : Tous / Live / Dry, groupes, tags, « Seulement ce qui demande attention ». Elle est partagée par le Tour de contrôle, Graphiques (liste de paires) et le Journal. Un périmètre actif est toujours visible : rien n'est masqué en silence.
- **Fil d'Ariane** sur la page bot, avec sélecteur de bot et `J`/`K` pour passer au bot suivant/précédent dans l'ordre « Attention d'abord ».
- **Palette de commandes** : aller à un bot, une paire, une page ; lancer une action (« pause dynv1 ») qui ouvre la même confirmation que le bouton.

### 2.5 Téléphone (< 640 px)

- Barre du haut réduite : marque, connexion, recherche, thème.
- **Barre d'onglets basse (64 px + safe area)** : Contrôle (avec badge d'alertes), Bots, Graphiques, Journal, Plus (Outils, Réglages, langue).
- Ordre de la page Contrôle : santé, **À traiter**, KPI, Depuis votre passage, Flotte (tuiles 2 colonnes, groupes repliables), courbe, classement, positions, événements, système. L'incident est le premier écran.
- Tiroirs et confirmations deviennent des feuilles basses (bottom sheets) avec poignée ; aucun survol n'est requis, toute info au survol a un équivalent au toucher.

### 2.6 Tablette (640-1023 px)

Une colonne ; même ordre que le téléphone ; navigation en icônes sauf la page courante ; tuiles en grille fluide.

## 3. Pages

### 3.1 Tour de contrôle (maquette `dashboard.html`)

Grille 12 colonnes desktop, de haut en bas :

1. **Bandeau de situation** (3 blocs) :
   - **FleetHealth** : anneau de score 0-100, niveau (Calme, Vigilance, Critique), phrase de synthèse, liste des raisons avec points retirés ; chaque raison mène à l'alerte. En flotte calme, la liste disparaît et le libellé devient « Tout est calme ».
   - **KpiStrip** (6 tuiles) : Réalisé du jour, Latent (avec mention des bots périmés exclus), Exposition nette (barre long/short), Capital engagé (jauge), Positions (DCA moyen, nombre au palier max), Drawdown flotte (latent inclus, seuil).
   - **SinceLastVisit** : résumé depuis le dernier repère (réalisé, trades fermés gagnants/perdants, renforts DCA, nouvelles alertes et résolues, redémarrages, pire trade) ; bouton « Marquer vu » qui déplace le repère.
2. **Flotte + rail** :
   - **FleetBoard** (tuiles à chaleur, groupées par dossier) avec bascule vers **FleetTable** (liste dense) ; tri « Attention d'abord / P&L / Nom ». Chaque groupe affiche son nombre de bots, un badge « N à voir » et son latent (sans les périmés).
   - **AlertRail « À traiter »** collant à droite (360 px, 400 px au-delà de 1900 px) : onglets Actives / Acquittées / Silencieuses, actions contextuelles, acquitter, silencer. Vide : « Rien à signaler ».
3. **EquityCurve** (2/3) : réalisé (trait plein accent), latent inclus (pointillé + aire), drawdown en sous-graphe synchronisé ; périodes 24 h / 30 j / 90 j / Tout ; 4 chiffres clés au-dessus. **Leaderboard** (1/3) : 6 meilleurs, séparateur, 3 pires, barres centrées sur zéro, 1 j / 7 j / 30 j.
4. **WatchList « Positions sous surveillance »** (2/3) : sous-ensemble du TradeTable `open` filtré par règles (DCA à 1 palier du max, durée > p70, distance de liquidation < 45 %) avec bouton Sortir (confirmation). **EventFeed** et **SystemHealth** compact (1/3).

Comportement en direct : un delta poussé met à jour la tuile concernée (tic de nombre + flash unique), le KPI concerné et l'événement s'insère en haut du fil. Rien d'autre ne bouge.

### 3.2 Page bot (maquette `bot-detail.html`)

- **En-tête** : avatar du groupe, nom, badge LIVE/DRY, état (En marche, Entrées en pause, Arrêté, Hors ligne), stratégie, timeframe, marché, port, uptime, âge de la donnée. Actions : Pause entrées (ou Reprendre), Recharger, Config, menu « … » (Logs, Journal filtré, Entrée forcée, Replay, Arrêter), séparateur, **Tout sortir** en bouton danger. Sur téléphone : grille Pause / Recharger / … puis Tout sortir en pleine largeur.
- **Bandeau d'alerte du bot** quand une alerte le concerne (même modèle que le rail, avec « Voir » qui sélectionne la position).
- **KpiStrip bot** : Latent, Réalisé 7 j, Winrate 30 j, Drawdown max 30 j (latent inclus, actuel), Exposition, Capital du bot (capital déployable restant, jamais `balance.total` du wallet partagé).
- **Onglets** : Positions (défaut si positions ouvertes), Historique (TradeTable `closed` filtré), Performance (EquityCurve bot, PnlCalendar bot, BotPerformance par paire/tag/sortie), Paires et verrous (PairNavigator : whitelist, blacklist éditable avec confirmation, verrous), Config (éditeur existant en tiroir, avertissement LIVE en tête, diff avant écriture), Logs (LogStream filtré).
- **Positions** : cartes `PositionCard` avec **échelle DCA normalisée** (section 9.3), pied de carte (âge et percentile, mise, distance de liquidation) et actions Sortir / Renforcer / … (Sortie partielle, Annuler l'ordre ouvert, Recharger le trade, puis séparé et en rouge : Supprimer de la base, avec « ne ferme pas la position sur l'exchange »). Tri Risque / P&L / Âge.
- **Colonne latérale collante** : graphique de la position sélectionnée (entrées en points, prix moyen, prochain renfort, objectif, liquidation hors champ signalée) et table des ordres (remplis + prochain déclencheur). Lien « Ouvrir dans Graphiques ».

### 3.3 Graphiques (non maquetté, décrit)

Une seule page, réutilise `CandleChart` et `PairNavigator`. Gauche (280 px, repliable) : PairNavigator (recherche, filtres « positions ouvertes / signaux / verrouillées », regroupement par bot). Centre : chandeliers, trades et ordres DCA superposés, indicateurs (préréglages `ftPlotConfig` migrés), outil de mesure (Shift + glisser, et appui long sur mobile). Haut : bot, paire, timeframe, préréglage d'indicateurs, Heikin Ashi. Droite (repliable) : légende temps réel et position ouverte sur cette paire avec ses actions. Mobile : graphique plein écran, PairNavigator en feuille basse, barre d'outils en bas. Mise à jour par ajout de bougie, jamais par rechargement complet.

### 3.4 Journal (maquette `journal.html`)

- **En-tête** : périodes (24 h, 7 j, 30 j, Mois, Année, Tout, plage personnalisée), fuseau affiché, export CSV/XLSX généré par la passerelle.
- **Filtres** : recherche (paire, bot, n° de trade, touche `/`), Sens, Résultat, Raison de sortie, Paliers DCA ; les filtres actifs sont des puces retirables ; « Sans trades de replay » est actif par défaut et visible.
- **TotalsBar** : Trades, Winrate, P&L net (frais inclus), Profit factor (espérance), Gain/perte moyens (ratio), Durée médiane (p90), Pire trade.
- **Analyse** : **PnlCalendar** (jour/semaine/mois, intensité de couleur proportionnelle, aujourd'hui encadré), **Distribution** (histogramme %, queue gauche < −8 % soulignée et chiffrée, utile pour les queues DCA), **ExitReasons** (part et P&L par raison).
- **TradeTable preset `journal`** : groupé par jour avec sous-total collant, colonnes Fermé, Bot, Paire, Sens, DCA, Durée (badge percentile), Profit %, USDC, Raison ; pagination serveur (« 1 à 50 sur 1 284 ») ; sur mobile, cartes groupées par jour.
- **TradeDrawer** au clic : onglets Vue d'ensemble (P&L, raison, durée, entrées, mise, prix, frais, funding, MAE/MFE), DCA et ordres, Graphique, Stats ; navigation `↑`/`↓` entre trades ; lecture seule pour les trades fermés.

## 4. Catalogue des widgets après fusion

### 4.1 Traitement des 15 clusters

| Cluster | Devient | Où | Raison |
|---|---|---|---|
| C1 Tableau de flotte | **FleetBoard** (tuiles à chaleur) et **FleetTable** (liste dense, même modèle de ligne) | Tour de contrôle, `/bots` | Une seule source de lignes poussée par la passerelle ; les tuiles donnent l'état d'un coup d'œil, la liste sert au tri et à la comparaison ; les 8 colonnes de config passent dans la page bot ; mobile = tuiles 2 colonnes |
| C2 Carte par bot | **BotPulse** = en-tête + KpiStrip + bandeau d'alerte de la page bot ; aperçu au survol/appui long d'une tuile | Page bot, tuiles | 10 cartes quasi identiques réduites à un en-tête et 6 tuiles ; WinLossCard supprimée ; projections composées supprimées |
| C3 Cartes flotte et groupe | **ScopeSummary** : KpiStrip paramétrée par périmètre (flotte, groupe, bot) | Bandeau de situation, en-tête de groupe, page bot | Même composant à trois échelles ; winrate affiché une fois ; jamais de somme de devises ou de périmés |
| C4 Courbes et périodes P&L | **EquityCurve** (flotte/bot, réalisé + latent + drawdown), **PnlCalendar**, **Leaderboard**, **Distribution** | Tour de contrôle (courbe, classement), Journal (calendrier, distribution), Performance du bot | 16 éléments ramenés à 4 graphes ; projections linéaires supprimées ; benchmark BTC conservé en série optionnelle de l'EquityCurve |
| C5 Risque et exposition | **KpiStrip** (exposition nette, capital engagé, drawdown) + **WatchList** + règles d'alerte ; **RiskPanel** détaillé (par coin, paires dupliquées entre bots, liquidation) au clic sur « Exposition nette » | Tour de contrôle ; Stress test dans Outils | Le risque se lit en 3 chiffres et se traite par exception ; le détail reste à un clic |
| C6 Infra et rate limit | **SystemHealth** compact (budget rate, cache, backoff, processus) ; ses anomalies deviennent des alertes ; RequestTimeline dans Outils > Diagnostic | Tour de contrôle (bas), Outils | 4 ECharts pour 3 chiffres remplacés par 4 jauges ; l'infra ne prend de place que si elle casse |
| C7 Logs | **LogStream** : compact (erreurs et avertissements, dans l'EventFeed et l'onglet Logs du bot) et page (Outils > Diagnostic > Logs bruts) | Page bot, Outils | Un composant, filtres et curseur côté passerelle |
| C8 Alertes et événements | **AlertRail** + **EventFeed** + **FleetHealth** + badge de navigation | Tour de contrôle, bandeau de la page bot, palette | Alertes structurées calculées 24/7 par la passerelle avec acquittement, silence, dédup ; événements réels (fills, sorties, incidents) au lieu d'événements reconstruits |
| C9 Tables de trades | **TradeTable** avec presets `open`, `watch`, `closed`, `journal`, et mode cartes mobile | Page bot, WatchList, Journal | Un registre de colonnes porte le rendu ; tri, filtre, pagination côté passerelle pour l'historique |
| C10 Détail de trade | **TradeDrawer** (onglets Vue d'ensemble, DCA et ordres, Graphique, Stats) + **PositionCard** pour les positions ouvertes | Journal, page bot, WatchList | Un panneau, tiroir à droite ou feuille basse ; l'échelle DCA devient visuelle ; MAE/MFE calculés serveur |
| C11 Navigation de paires | **PairNavigator** (sélecteur unique) + onglet « Paires et verrous » | Graphiques, page bot | Une liste filtrable remplace 5 vues ; blacklist et suppression de verrou passent par confirmation |
| C12 Contexte marché et devises | Ticker minimal BTC/ETH optionnel dans la barre du haut (réglage, désactivé par défaut) ; conversion de devise supprimée | Barre du haut | Flotte en USDC ; encyclopédies statiques supprimées ; données externes cachées côté passerelle |
| C13 Gestion des bots et réglages | **Réglages** à sections, section Bots = registre passerelle, import/export unique | `/settings` | La NavBar perd import/export, édition et mise à jour ; une seule porte |
| C14 Actions sur un bot | **BotActionBar** (page bot), **BotActionMenu** (tuile, palette), **ConfirmDangerDialog** et `useBotAction(botId)` | Partout | Cible `(botId, tradeId)` de bout en bout, confirmation non désactivable pour le LIVE, verrou en vol, retour en deux temps |
| C15 Sélection, filtres, groupes | **FleetScope** (barre de périmètre partagée) + groupes comme organisation principale | Toutes les pages de flotte | Un seul périmètre visible au lieu de filtres par widget ; recherche texte ; plus de désélection forcée |

### 4.2 Supprimés sans remplaçant

WinLossCard, ExchangeInfoCard, CurrencyInfoCard, MarketPulse en widget, projections mensuelles/annuelles, ProfitGoalBar, CacheStatusWidget, RateBudget, RatePulse, fond animé, éditeur d'opacité de widgets, conversion de devise, langues autres que FR et EN (repli vers EN), tous les fichiers morts listés en section 2 du document d'état.

### 4.3 Primitives partagées

`WidgetShell` (titre, méta, âge, états), `KpiTile`/`KpiStrip`, `PnlValue`, `ModeBadge` (LIVE plein violet, DRY pointillé), `StatusDot`, `DirectionChip`, `DcaPips`, `DcaLadder`, `Sparkline`, `SplitBar`, `Meter`, `RankedBarList`, `SegmentedControl`, `Chip`, `AgeBadge`, `EventRow`, `AlertCard`, `HealthRing`, `EmptyState`, `Skeleton`, `BaseChart`, `Drawer`/`BottomSheet`, `ConfirmDangerDialog`, `HoldButton`, `Toast`, `CommandPalette`, `FormRow`.

## 5. Système de design

### 5.1 Couleurs

Règle : neutre au repos ; une couleur = un sens ; le contraste du texte respecte AA (4,5:1) sur `--surface`.

| Token | Sombre | Clair | Usage |
|---|---|---|---|
| `--bg` | `#090C11` | `#F4F5F8` | Fond de page |
| `--surface` | `#0F131A` | `#FFFFFF` | Cartes |
| `--surface-2` | `#141922` | `#FAFBFC` | Tuiles, lignes survolées |
| `--surface-3` | `#1A202B` | `#F1F3F6` | Contrôles, pistes de jauges |
| `--line` / `--line-2` / `--line-strong` | `#1F2631` / `#2A3341` / `#3A4556` | `#E3E7EC` / `#D6DBE2` / `#B9C1CC` | Bordures |
| `--text` / `--text-2` / `--text-3` / `--text-4` | `#E8ECF2` / `#A4AEBE` / `#6C7688` / `#4A5363` | `#11161D` / `#4A5463` / `#6F7988` / `#9AA3AF` | Texte, secondaire, libellés, désactivé |
| `--accent` | `#2CC6DF` | `#0789A0` | Interaction, focus, série principale (continuité avec le cyan actuel de FreqUI Ultimate) |
| `--profit` | `#3DD68C` | `#0C8C55` | P&L positif uniquement |
| `--loss` | `#F2646E` | `#CC2F3C` | P&L négatif uniquement |
| `--warn` | `#F5B83D` | `#A86A00` | Vigilance, périmé, DCA profond |
| `--crit` | `#FF4A5E` | `#D41F35` | Alerte critique, hors ligne, actions dangereuses |
| `--info` | `#6AA8FF` | `#2465C9` | Information, en attente |
| `--live` | `#B08CFF` | `#7444E0` | Argent réel : badge LIVE, cadre de la cible d'une confirmation |
| `--dry` | `#8D97A8` | `#6F7988` | Dry, bordures pointillées |

Chaque couleur sémantique a une variante `-weak` (fond 9 à 15 % d'opacité) et `-line` (bordure 35 à 55 %). Le violet LIVE n'est utilisé pour rien d'autre : il ne peut pas être confondu avec une perte ou une alerte. Les tokens remplacent les trois systèmes actuels (`--sd-*` Catppuccin, Aura, `ftUIColorSettings`) ; PrimeVue reçoit ces variables en mode non stylé.

### 5.2 Typographie

Inter (chiffres tabulaires `tnum` partout où il y a des nombres, `cv11`), JetBrains Mono pour logs, identifiants et saisies de confirmation.

| Rôle | Taille / interligne | Graisse |
|---|---|---|
| display (score) | 40/44 (34 mobile) | 680 |
| kpi | 24/28 (22 mobile) | 620 |
| h1 | 22/28 | 680 |
| h2 | 18/24 | 650 |
| title | 15/22 | 600 |
| body | 13/19 desktop, 14/20 mobile | 400-550 |
| caption | 12/16 | 400-550 |
| micro (libellés en capitales, +0,07 em) | 11/14 | 600 |

Les champs de saisie font 16 px sur mobile (pas de zoom iOS).

### 5.3 Espacement, rayons, élévation

- Espacement base 4 : 4, 8, 12, 16, 20, 24, 32, 40. Gouttière 16 desktop, 12 mobile ; padding de carte 16, de tuile 10-12.
- Rayons : 4 (puces), 6 (contrôles), 10 (tuiles, alertes), 14 (cartes), 18 (feuilles basses), pilule.
- Élévation : en sombre par luminance de surface et liseré (`e1` liseré, `e2` popovers et toasts, `e3` tiroirs et dialogues) ; en clair, ombres douces. Pas de flou d'arrière-plan sauf barres collantes (et seulement si supporté).

### 5.4 Densité

| Mode | Hauteur de ligne | Contrôle standard | Quand |
|---|---|---|---|
| Compact | 28 px | 28 px | Choix utilisateur (proposé par défaut à partir de 1920 px) |
| Confort | 34 px | 32 px | Défaut desktop |
| Tactile | 48 px | 44 px | Automatique sous `pointer: coarse` |

### 5.5 Points de rupture et grille

| Nom | Largeur | Grille | Comportement clé |
|---|---|---|---|
| phone | < 640 | 4 colonnes, marges 12 | barre basse, feuilles basses, tuiles 2 colonnes, cartes au lieu de tables |
| tablet | 640-1023 | 8 colonnes, marges 16 | une colonne, navigation en icônes, rail en tête |
| desktop | 1024-1599 | 12 colonnes, marges 16 | rail collant 320-360 px |
| wide | 1600-2199 | 12 colonnes | rail 400 px, tuiles plus nombreuses |
| ultra | >= 2200 | 12 colonnes, largeur max 2400 | contenu centré, pas d'étirement des tables |

## 6. Iconographie

Lucide (licence ISC, arbre secouable, déjà proche du style actuel). Règles : trait 1,75 ; tailles 14 (dans les puces et boutons sm), 16 (défaut), 20 (en-têtes d'alerte, dialogues), 22 (barre basse) ; couleur héritée du texte, jamais d'icône colorée sans sens ; une icône par concept, fixée dans un registre :

| Concept | Icône |
|---|---|
| Tour de contrôle | `radar` |
| Bot | `bot` |
| Graphiques | `candlestick-chart` |
| Journal | `book-open-text` |
| Outils | `wrench` |
| Drawdown | `trending-down` |
| Hors ligne | `unplug` |
| Périmé | `clock-alert` |
| Orphelin | `ghost` |
| DCA | `layers` |
| Acquitter / Silencer | `check` / `bell-off` |
| Sortir | `log-out` |
| Pause entrées / Reprendre | `pause` / `play` |
| Passerelle / Direct / Hors ligne | `radio-tower` / `git-fork` / `wifi-off` |

Les groupes reçoivent une icône Lucide choisie par l'utilisateur (remplace les emojis de dossier, migrés vers une icône proche ou conservés tels quels si aucune correspondance).

## 7. Boutons et contrôles

| Taille | Desktop | Tactile | Usage |
|---|---|---|---|
| xs | 24 | 32 (zone de toucher 44 par marge) | actions de ligne de table |
| sm | 28 | 36 | actions d'alerte, en-têtes de carte |
| md | 32 | 44 | défaut |
| lg | 40 | 48 | dialogues, bouton de maintien |

Variantes : Principal (accent, une seule par vue), Secondaire, Discret, Danger (contour rouge), Danger plein (dans les confirmations seulement). États : survol, appui (échelle 0,97), focus (anneau 2 px accent), désactivé, en vol (`aria-busy`, spinner, non cliquable). Les contrôles segmentés remplacent les pilules de période ; les puces servent aux filtres et au périmètre. Toute cible tactile fait au moins 44 x 44 px.

## 8. Mouvement

| Token | Durée | Courbe | Usage |
|---|---|---|---|
| micro | 90 ms | standard `cubic-bezier(.2,0,0,1)` | appui de bouton |
| fast | 140 ms | standard | survol, onglets, puces |
| base | 220 ms | standard | apparition de dialogue, toast, acquittement d'alerte |
| slow | 320 ms | emphase sortante `cubic-bezier(.05,.7,.1,1)` | tiroirs et feuilles basses |
| tick | 600 ms | ease-out cubique | interpolation d'un chiffre qui change |

Ce qui anime : tic des nombres qui changent, flash unique de fond (900 ms) sur une valeur mise à jour, entrée d'un événement en haut du fil, disparition d'une alerte acquittée (glissement + repli de hauteur), remplissage de l'anneau de santé, halo d'une tuile ou d'une alerte critique (3 cycles à l'apparition puis fixe), squelettes de chargement, point « Passerelle » qui pulse doucement.

Ce qui n'anime jamais : la disposition des tables et des tuiles sur une mise à jour de données (pas de réordonnancement animé, l'ordre « Attention d'abord » ne change qu'à l'apparition ou la résolution d'une alerte), les couleurs de P&L (pas de clignotement), le contenu d'une confirmation, les fonds, les graphiques sur un tick (ajout sans transition). Aucune boucle infinie hors indicateurs d'état (spinner en vol, point de connexion).

`prefers-reduced-motion` : durées ramenées à 1 ms, plus de halo ni de pulsation ; les changements d'état restent visibles par couleur et icône ; la durée de maintien du bouton de confirmation est conservée (c'est un délai de sécurité, pas une animation).

## 9. Actions argent réel

### 9.1 Règles

1. **Cible explicite** : chaque action porte `(botId, tradeId)` depuis le composant qui l'affiche ; aucun recours au « bot actif ». La confirmation affiche en tête un bloc « Bot ciblé » encadré du violet LIVE (pointillé gris si DRY), avec nom et badge.
2. **Confirmation non désactivable en LIVE** pour : sortie (totale ou partielle), renforcer, entrée forcée, tout sortir, arrêter, recharger, pause entrées, blacklist, suppression de verrou, suppression de trade, réconciliation, écriture de config. Le réglage « confirmDialog » ne s'applique plus qu'aux bots DRY.
3. **Maintenir pour exécuter** (1,2 s) au lieu d'un clic : impossible à déclencher par double clic ou par un toucher accidentel ; fonctionne au clavier (Espace ou Entrée maintenus).
4. **Saisie de confirmation** (nom du bot) en plus du maintien pour : Tout sortir, Arrêter, Supprimer un trade de la base, réconciliation qui passe un ordre.
5. **Verrou en vol** : après déclenchement, le bouton passe en « Envoi au bot… (verrouillé) » ; toute autre action sur la même cible est grisée jusqu'au résultat ; une seule requête, sans nouvel essai automatique (le rejeu après refresh 401 est supprimé).
6. **Retour en deux temps** : toast « en attente » (« ordre accepté par hippo_multi, en attente du remplissage ») puis toast final avec le résultat réel venant du flux d'événements (« WIF fermée, −28,27 USDC frais inclus, trade #4812 ») ou l'erreur exacte (refus par `confirm_trade_exit`, notionnel minimum, bot hors ligne). La position concernée affiche « Sortie en cours » jusqu'à confirmation.
7. **Garde-fous de contexte** : sortie partielle sous 10 USDC de notionnel bloquée dans le formulaire ; Recharger affiche le dernier rechargement de la flotte et recommande d'échelonner de 10 min ; Arrêter rappelle que `launch_bot.sh` relance le bot ; Tout sortir rappelle « Pause entrées d'abord » ; Supprimer de la base est séparé des sorties dans les menus et précise qu'il ne ferme rien sur l'exchange ; aucune action groupée sur plusieurs bots en v1.
8. **Audit** : chaque mutation est journalisée par la passerelle (qui, quand, bot, trade, charge, résultat) et visible dans l'EventFeed.
9. **Hors ligne ou mode dégradé** : en mode « Hors ligne », toutes les actions sont désactivées avec la raison au survol ; en mode direct, elles restent possibles (appel direct au bot) mais la confirmation l'indique.

### 9.2 Dialogue de confirmation

Ordre fixe : icône d'avertissement et verbe (« Sortir la position »), objet (paire, sens, levier, entrées, mise), bloc « Bot ciblé », paramètres (quantité 100/50/25 %/autre, type d'ordre), estimations (P&L, prix indicatif), avertissements contextuels, mention « Envoyé une seule fois, sans nouvel essai automatique. Journalisé. », puis Annuler (à gauche) et le bouton de maintien (à droite, pleine largeur restante). Desktop : modal centré 460 px ; mobile : feuille basse. `Échap` ferme tant que rien n'est parti.

### 9.3 Échelle DCA normalisée

Chaque position ouverte affiche une piste horizontale où la gauche est toujours le côté dangereux et la droite le côté profit, pour un long comme pour un short : liquidation signalée à gauche (zone hachurée, valeur en clair même hors champ), entrées remplies en points pleins de taille croissante, renforts en attente en cercles pointillés (le prochain plus marqué), prix moyen en trait blanc, objectif en trait vert, prix actuel en triangle coloré, segment entre moyenne et prix actuel en vert ou rouge. Les étiquettes se placent sur deux rangées sans chevauchement ; celles qui ne tiennent pas disparaissent (jamais le prix actuel ni la moyenne). Version miniature dans les tuiles et tables : `DcaPips` (paliers utilisés, deux derniers en ambre).

## 10. États, données et connexion

### 10.1 États d'un widget (WidgetShell)

| État | Rendu | Règle |
|---|---|---|
| Chargement | squelettes à la forme du contenu, balayage 1,3 s | jamais de spinner plein écran ; un snapshot passerelle remplace l'écran d'attente actuel |
| Vide | icône neutre, phrase utile, contexte (« Le bot attend un signal. Dernière sortie il y a 2 h ») | pas de carte vide sans texte |
| Erreur | icône et titre rouges, cause (endpoint, code, essais), Réessayer, Voir les logs | les dernières valeurs restent affichées et marquées périmées |
| Périmé | bordure pointillée ambre, valeurs grisées, âge en ambre à la place de la couleur | jamais sommé dans un total ; le total dit combien de bots il exclut |
| Hors ligne | hachures rouges, valeurs barrées (dernière valeur connue), actions désactivées sauf logs | alerte critique automatique pour un bot LIVE |
| Arrêté / pause | opacité réduite / point ambre et « Entrées en pause » | pas d'alerte, sauf règle explicite |

Seuil de péremption par défaut : 3 fois la cadence attendue (30 s pour le statut poussé, 3 min pour un bot sans digest), réglable.

### 10.2 Indicateur de connexion

Pilule dans la barre du haut, toujours visible, cliquable pour le détail :

- **Passerelle** (point vert qui pulse lentement, « push 0,4 s ») : un flux WebSocket pour toute la flotte, alertes 24/7, historique complet.
- **Mode direct** (contour et point ambres, « 32 bots, 10 s ») : passerelle injoignable, le navigateur interroge chaque bot ; un bandeau discret sous la barre précise ce qui manque (alertes 24/7, historique long, score de santé partiel, Journal limité) et propose « Réessayer la passerelle ».
- **Hors ligne** (rouge, « données d'il y a 2 min ») : interface figée, chaque valeur garde son âge, actions désactivées.

## 11. Alertes, santé et « depuis votre passage »

### 11.1 Modèle d'alerte

`{id, typeId, severity (crit | warn | info), botId | "wallet", pair?, value, threshold, since, state (active | acked | silenced | resolved), silencedUntil?}` calculé par la passerelle. Types de départ : drawdown au-delà du seuil, bot hors ligne, donnée périmée, position orpheline ou fantôme (réconciliation), DCA à un palier du maximum, durée > p90, liquidation proche, aucune activité (correctement en secondes), erreurs de log connues (« Wallet shows a total of 0 », « Refusing to adjust », « Could not create », « ExchangeError »), backoff 429 répétés, capital engagé au-delà du seuil.

Comportement : dédup par `(typeId, botId, pair)` sans le message ; acquitter garde l'alerte en vue « Acquittées » et la ressort si la valeur empire d'un cran ; silencer (1 h, 4 h, jusqu'à demain, personnalisé) la cache et la compte dans le pied du rail ; une alerte résolue seule disparaît avec un événement « résolu ». Notifications navigateur et Telegram limitées aux `crit` LIVE, courtes (un fait, un chiffre, une action).

### 11.2 Score de santé

`score = 100 − Σ pénalités` des alertes actives non acquittées. Pénalités de base : crit 9 à 12, warn 3 à 4, info 1 ; un bot DRY compte pour un quart ; une alerte acquittée compte pour un tiers. Plafond : tant qu'une alerte crit LIVE est active, le score ne dépasse pas 79. Niveaux : 90-100 Calme (vert), 60-89 Vigilance (ambre), < 60 Critique (rouge). En mode direct le score est marqué « partiel ». Le détail des raisons est toujours affiché à côté du chiffre : le score n'est jamais une boîte noire.

### 11.3 Depuis votre passage

Repère `lastSeenAt` stocké par la passerelle par appareil (repli localStorage en mode direct), avancé par « Marquer vu » ou automatiquement après 2 min de présence sur la page. La passerelle calcule le résumé à partir des événements : réalisé, trades fermés (gagnants/perdants), renforts DCA, alertes nouvelles et résolues, redémarrages, pire trade, et la liste d'événements correspondante (le clic sur une case filtre l'EventFeed sur l'intervalle). Après marquage, la carte s'atténue jusqu'au prochain événement notable.

## 12. Layout par défaut et personnalisation

- **Défaut** : celui des maquettes. Il est volontairement fixe pour les 3 premières rangées (situation, flotte + rail) : ce sont les fondations de la lecture par exception.
- **Personnalisation** (Réglages > Tour de contrôle, et mode « Modifier » sur la page) : masquer, réordonner ou redimensionner (1/3, 1/2, 2/3, pleine largeur) les widgets des rangées basses parmi un registre (EquityCurve, Leaderboard, WatchList, EventFeed, SystemHealth, PnlCalendar, RiskPanel, Distribution) ; choisir le tri par défaut de la flotte, la vue tuiles ou liste, les KPI affichés (6 parmi 10). Le réordonnancement se fait au clavier et par poignées tactiles, pas en glisser-déposer HTML5.
- **Persistance** : layout versionné (ids texte de widgets), stocké par la passerelle et partagé entre téléphone et ordinateur, avec un layout mobile dérivé automatiquement (ordre conservé, une colonne). Réinitialisation en un clic.
- **Migration** : registre `ftAuthLoginInfo` (ids `ftbot.N` conservés), `ftBotComparison` (groupes, tags, ordre, seuils d'alerte convertis en règles), `ftUISettings`, `ft_locale` (es/de/it/pt vers EN), colonnes de trades, `ftPlotConfig` sont lus au premier chargement et poussés à la passerelle ; les anciennes clés restent intactes pour un retour arrière. `ftLayoutSettings` n'est pas repris (layout refondu) : l'utilisateur voit le défaut.

## 13. Points à valider par le propriétaire

1. Le score de santé (formule et seuils) et le plafond à 79 en présence d'une alerte critique LIVE.
2. Le maintien 1,2 s pour toutes les actions LIVE, et la saisie du nom du bot pour Tout sortir, Arrêter, Supprimer un trade, réconciliation.
3. Le violet comme couleur exclusive du LIVE.
4. Sortie depuis la WatchList du Tour de contrôle (en plus de la page bot), sans action groupée multi-bots en v1.
5. « Depuis votre passage » : repère par appareil ou commun à tous les appareils.
6. Fuseau du calendrier P&L : la maquette affiche Europe/Paris.
7. Ticker BTC/ETH : désactivé par défaut.
8. Seuils par défaut de la WatchList (DCA à un palier du max, durée > p70, liquidation < 45 %).
