# Proposition C « Pouls » : fluide, pensée d'abord pour le téléphone

Angle : l'outil se conçoit d'abord pour un téléphone tenu d'une main, puis se déplie en grille dense sur grand écran.
Références assumées : Revolut (gros chiffres, feuilles), Apple Bourse (sobriété, couleur réservée au sens), Robinhood Legend (densité desktop), Vercel (neutralité, bouton principal blanc).

Maquettes (HTML autonomes, thème sombre par défaut, bascule clair) :

| Fichier | Contenu | Paramètres de démo |
|---|---|---|
| `dashboard.html` | Flotte : héros « Pouls », périmètre, alertes, mosaïque/liste des bots, positions, capital, risque, classement, événements, santé, logs, personnalisation | `?theme=light`, `?conn=direct`, `?conn=offline`, `?skeleton=1` |
| `bot-detail.html` | Page d'un bot (dynv1_short en alerte drawdown) : KPI, actions, onglets, graphique avec niveaux DCA, échelle DCA vivante, confirmation | `?sheet=1` (tiroir de trade ouvert sur téléphone), `?confirm=1` (dialogue de fermeture) |
| `journal.html` | Journal : KPI 30 j, filtres collants, calendrier P&L, distribution, raisons de sortie, liste groupée par jour, détail de trade | `?sheet=1` |
| `charts.html` | Graphiques : navigateur de paires (positions d'abord), chandeliers + indicateurs du bot choisi, feuille d'indicateurs | |

Les sources sont dans `_src/` (`base.css` = design system, `core.js` = données factices et primitives d'interaction). `python3 _src/build.py` régénère les fichiers autonomes et refuse tout tiret cadratin. Captures dans `screenshots/`.
Un clic sur l'indicateur de connexion fait défiler les 3 états (passerelle, direct, hors ligne) pour montrer leur rendu.

---

## 1. L'idée en un paragraphe

Le propriétaire ouvre l'interface pour répondre à trois questions, dans cet ordre : « est-ce que ça va ? », « qu'est-ce qui demande mon attention ? », « où est l'argent en jeu ? ». « Pouls » y répond par une seule colonne verticale qui se lit au pouce : un héros (P&L du jour en très grand, latent, exposition, bots en ligne) qui se replie en barre compacte au défilement, un rail « À traiter » d'alertes actionnables, une mosaïque de la flotte (un carreau par bot, teinté par son latent) et les positions classées par douleur. Tout détail s'ouvre dans une **feuille adaptative** unique : bottom sheet sur téléphone, tiroir latéral sur desktop, même composant, même contenu. Au-delà de 1024 px la colonne se scinde en 2 puis 3 colonnes denses, les mosaïques deviennent des tableaux, mais la hiérarchie ne change jamais : ce qui est en haut sur le téléphone reste en haut sur l'écran 2560 px. Toute action qui touche l'argent passe par la même confirmation, qui nomme toujours le bot cible, impose un geste délibéré (maintenir 0,9 s) et attend le vrai statut de l'ordre avant de dire « exécuté ».

## 2. Principes

1. **Un chiffre, un âge.** Chaque valeur porte sa fraîcheur. Une donnée périmée est hachurée, jamais additionnée, et le total dit combien de bots il exclut (pastille « 2 bots exclus des totaux »).
2. **La couleur est réservée au sens.** Vert = gain, rouge = perte, ambre = attention, bleu = information et sélection, violet = argent réel (live). Le bouton principal est neutre (blanc sur sombre, noir sur clair) pour ne jamais être confondu avec un signal.
3. **Le pouce d'abord.** Cibles de 44 px minimum, actions fréquentes dans le tiers bas de l'écran (barre d'onglets, pied des feuilles), aucun survol obligatoire, aucun glisser-déposer obligatoire.
4. **Un composant, trois densités.** Mosaïque, liste confort, tableau dense : même donnée, même tri, même périmètre.
5. **Le mouvement explique, il ne décore pas.** Un mouvement dit « ceci vient d'arriver », « ceci s'ouvre depuis là », « ceci a changé ». Aucun fond animé, aucune boucle infinie hors spinner d'attente.

## 3. Architecture de l'information et navigation

### 3.1 Pages et routes

| Page | Route | Rang | Remplace |
|---|---|---|---|
| Flotte (dashboard) | `/` et `/dashboard` | 1er | DashboardViewCustom, HomeView (la gestion des bots part dans Réglages) |
| Bots (page d'un bot) | `/bot/:botId` ; `/trade?bot=` redirige | 1er | TradingView, routes `/balance`, `/pairlist` (onglets), MobileTradesListView |
| Graphiques | `/charts?pair=&bot=` | 1er | ChartsView non routée, graphique de la page Trade |
| Journal | `/journal` | 1er | TradeJournalView, ClosedTradesEnhanced, `/trade_history` |
| Logs | `/logs` | secondaire | LogView, LogConsoleWidget |
| Santé | `/health` (onglets Système, Réconciliation, Diagnostic réseau) | secondaire | InfrastructureHealth, CacheRateMonitor, FleetviewReconciliation, RequestTimeline |
| Outils | `/tools/strategy-dev`, `/tools/backtest`, `/tools/download`, `/tools/pairlist`, `/tools/stress` ; anciennes routes redirigées | discret | StrategyDev, Backtest, DownloadData, PairlistConfig, StressTestCard, VolumeComparator |
| Réglages | `/settings/{general,bots,alertes,graphiques,affichage,a-propos}` | discret | SettingsViewCustom, BotList, LoginView, import/export de la NavBar |

`/open_trades` redirige vers `/#positions`, `/trade_history` vers `/journal`, `/login` vers `/settings/bots`. Les paramètres `?bot=`, `?highlight=` et `redirect` sont conservés.

### 3.2 Téléphone (< 768 px)

- **Barre d'onglets basse, 5 entrées** : Flotte, Bots, Graphiques, Journal, Plus. Pastille rouge du nombre d'alertes sur Flotte. L'onglet actif a une pilule de fond (animée), libellés toujours visibles.
- **Plus** ouvre une feuille : Surveillance (Logs, Santé et réconciliation, Alertes), Outils (Labo de stratégie, Backtest, Télécharger des données, Configurer une pairlist, Diagnostic réseau, Test de choc), Application (Réglages, thème).
- **En-tête de page** : titre + horodatage, indicateur de connexion, recherche (palette), thème.
- **Barre compacte** : quand le héros sort de l'écran, une barre fine (52 px, flou de fond) descend avec le titre, le P&L du jour et le latent. Le périmètre (chips) reste collé dessous.
- **Feuilles** : détail bot, détail trade, filtres, confirmation. Glisser la poignée vers le bas ferme, Échap aussi. Une feuille peut s'empiler sur une autre (bot puis trade), deux niveaux au plus.

### 3.3 Tablette (768-1023 px) et desktop (>= 1024 px)

- Le rail gauche remplace la barre d'onglets : icônes seules (76 px) jusqu'à 1439 px, icônes + libellés + raccourcis (232 px) à partir de 1440 px. Sections : Pilotage (Flotte, Bots, Graphiques, Journal), Surveillance (Logs, Santé), puis en bas Outils (menu), Réglages, Thème.
- À partir de 1024 px les feuilles deviennent des tiroirs latéraux de 480 px ; la confirmation devient un dialogue centré de 460 px.
- **Palette de commandes Ctrl K / Cmd K** : aller à un bot, une paire, une page ; actions non financières (pause des notifications, thème). Les actions financières y ouvrent la confirmation, jamais plus.
- Raccourcis centralisés, tous avec préfixe ou hors champs de saisie : `G F` Flotte, `G B` Bots, `G G` Graphiques, `G J` Journal, `T` thème, `/` recherche, `Échap` ferme. Plus de Ctrl+A détourné ni de touches nues qui agissent sur la sélection.

### 3.4 Le périmètre (FleetScope, C15)

Une seule rangée de chips collante, partagée par toutes les cartes de la page : `Tout 28`, `Live 17`, `Dry 11`, puis les groupes (`Hippo 4`, `DynV 3`...). Le bouton Filtres ouvre la feuille complète (tags, exchange, état, recherche). Le compteur « 28 bots sur 28 » est toujours visible sur desktop : un filtre ne peut plus masquer des bots en silence. Le périmètre est mémorisé par appareil et réinitialisable d'un geste.

## 4. Pages

### 4.1 Flotte (`dashboard.html`)

Ordre téléphone, de haut en bas :

1. **Pouls (héros)** : P&L réalisé du jour (48-52 px desktop, 40 px téléphone) avec répartition Live / Dry et 30 j, courbe intrajournalière au quart d'heure, puis 4 KPI : Latent (+ nombre de positions), 7 jours, Exposition (barre long/short), Bots en ligne (live/dry). Fond légèrement teinté vert ou rouge selon le signe du jour. La pastille ambre « N bots exclus des totaux » explique toute exclusion.
2. **Périmètre** (chips collantes).
3. **À traiter (AlertRail)** : cartes défilables avec aimantation, une par alerte structurée, triées par sévérité. Chaque carte : icône, titre, bot (ou « wallet partagé »), valeur vs seuil, ancienneté, action principale contextuelle (Ouvrir le bot, Réconcilier, Voir les logs, Diagnostiquer, Voir le trade) et Acquitter (silence 1 h, réactivée si la valeur empire). Masqué quand il n'y a rien : l'absence d'alerte est un état, pas un vide.
4. **Bots** : mosaïque par groupe sur téléphone (carreau = nom, latent en grand, positions/slots, réalisé du jour ; teinte proportionnelle au latent rapporté au capital ; pointillé = dry ; hachures = hors ligne ou périmé ; drapeau en coin pour l'alerte). Sur desktop, liste dense par défaut : bot (avatar couleur stable, badge Live/Dry, stratégie ou état), slots, latent, jour, 7 j, tendance, drawdown (jauge vs seuil), exposition, âge de la donnée, menu d'actions. Les colonnes se retirent selon la largeur de la carte (requêtes de conteneur), pas selon la fenêtre. Groupes avec sous-totaux, tri au clic sur l'en-tête.
5. **Positions** : TradeTable preset `open`. Téléphone : cartes avec paire, sens/levier, bot, points DCA (le dernier palier en ambre), durée, latent et %. Glisser à gauche révèle Détail et Fermer. Desktop : tableau avec percentile de durée (p84 en ambre, p91 en rouge), distance de liquidation, bouton Fermer discret qui ne devient rouge qu'au survol de la ligne. Tris : Pires, DCA, Âge.
6. **Capital (EquityCurve)** : réalisé (trait plein), réalisé + latent (pointillé bleu), drawdown open-inclusive en sous-graphe rouge, périodes 1J/7J/30J/Tout, 3 chiffres : drawdown max, meilleur jour, pire jour.
7. **Risque (RiskPanel)** : barre long/short/net, levier moyen pondéré, slots, liquidation la plus proche (avec la paire et le bot), marge utilisée, paires tenues par plusieurs bots (même sens, ou nettées long/short).
8. **Classement (Leaderboard)** : barres divergentes autour de zéro, 5 meilleurs puis 3 pires, 1J/7J/30J.
9. **Événements (EventFeed)** : vrais événements poussés (sorties, renforts DCA, ouvertures, bot hors ligne, stop).
10. **Santé (SystemHealth compact)** : niveau + raison en une phrase, budget rate-limit, cache, dernier 429, latence passerelle ; lien Diagnostic.
11. **Logs (LogStream compact)** : erreurs et avertissements seulement, 5 lignes ; lien vers le flux.

Desktop 1024-1799 px : alertes en pleine largeur, puis 2 colonnes (principale : Bots, Positions, Capital ; latérale 340-372 px : Risque, Classement, Événements, Santé, Logs).
Desktop >= 1800 px : 3 colonnes (Bots + Capital | Positions + Événements | Risque, Classement, Santé, Logs), alertes en grille de 5.

Un tap sur un bot (carreau, ligne, alerte, position) ouvre **BotPulse** : KPI (latent, réalisé jour, 7 j avec sparkline, drawdown vs seuil), 4 grosses actions (Pause entrées, Recharger, Arrêter, Tout fermer), positions du bot, et en pied « Ouvrir la page du bot » + raccourci graphique. Pour un bot hors ligne : bandeau hachuré « dernières valeurs connues, exclues des totaux ; ne pas relancer un bot uniquement pour forcer une sortie ».

### 4.2 Bot (`bot-detail.html`)

- En-tête : retour, **sélecteur de bot** (avatar + nom + badge, ouvre la recherche), connexion. Ligne d'identité : état, stratégie, timeframe, sens, levier, port, âge de la donnée, uptime.
- **Bandeau d'alerte** du bot quand il y en a une, avec l'action la plus probable à portée de pouce (Pause entrées) et Acquitter.
- **Bande de KPI** (2 colonnes téléphone, 3 tablette, 6 desktop) : latent, réalisé jour, 7 j + winrate, drawdown avec jauge vs seuil, slots + capital alloué, exposition + levier.
- **Barre d'actions** : Pause entrées, Recharger, Entrée forcée, et à droite (séparées) Arrêter et Tout fermer. Sur téléphone : 4 tuiles de 64 px.
- **Onglets collants** : Positions, Performance, Paires, Config, Logs.
  - Positions : desktop = graphique (paire sélectionnée, lignes Moyen, Sortie, prochain DCA, paliers remplis en pointillé, triangles aux remplissages) + liste à gauche, **TradeDrawer** intégré à droite (collant). Téléphone = liste ; un tap ouvre le TradeDrawer en feuille.
  - Chaque position porte une **piste DCA** horizontale : paliers remplis/vides, objectif de sortie (trait vert), prix actuel (trait rouge ou vert) qui glisse en direct.
  - TradeDrawer : paire, sens/levier, n° de trade, **cible explicite** (carte bot + badge live), latent en grand, % sur la mise, durée + percentile, **échelle DCA verticale vivante** (liquidation en haut, paliers avec prix et montant, palier suivant en ambre « en attente », prix moyen bleu, objectif de sortie vert, zone de perte teintée entre moyen et prix actuel, étiquettes qui ne se chevauchent jamais), faits (mise engagée / mise totale prévue, notionnel, prochain renfort avec distance, prix moyen), actions (Fermer au marché, Sortie partielle, Renforcer), section repliée « Actions sur la base du bot » (Annuler l'ordre ouvert, Recharger le trade, Supprimer de la base) volontairement éloignée de Fermer, puis la liste des ordres.
  - Performance : calendrier P&L du mois, P&L par paire, raisons de sortie, profil (trades, winrate, profit factor, durée, pire trade, drawdown max). Remplace BotProfit, BotPerformance, PeriodBreakdown, BalanceCard pour un bot.
  - Paires : whitelist avec signaux 24 h et positions, verrous (levée confirmée), blacklist (ajout/retrait confirmés).
  - Config : configuration en service en lecture, paramètres de stratégie (JSON hyperopt prioritaire signalé), bouton Éditer qui ouvre l'éditeur Monaco existant en plein écran avec revue de diff et rappel « bot live ».
  - Logs : LogStream filtré sur le bot.

### 4.3 Graphiques (`charts.html`)

- Desktop : navigateur de paires à gauche (Positions d'abord avec latent, puis Signaux récents, Verrous ; filtres Positions/Signaux/Toutes ; recherche paire ou bot), graphique à droite, et à partir de 1920 px une colonne de contexte (position ouverte sur la paire, autres bots sur la paire).
- Téléphone : chips de paires défilables (positions d'abord, avec bot et latent), barre d'outils compacte, graphique à 62 % de la hauteur, sous-graphes volume et RSI.
- Barre d'outils : paire, **contexte** (le bot dont on affiche les indicateurs et les trades), timeframe, Indicateurs (feuille avec préréglages migrés depuis `ftPlotConfig`), Mesurer (Maj + glisser à la souris, deux doigts au tactile).
- La légende suit le curseur (throttle rAF). Les nouvelles bougies sont ajoutées, jamais rechargées en entier.

### 4.4 Journal (`journal.html`)

- KPI 30 j : P&L net (frais et funding inclus), trades, winrate, profit factor, gain moyen / perte moyenne, durée médiane + p90.
- Filtres collants : recherche (paire, bot, raison, n°), période (1J, 7J, 30J, Mois, Tout), chips Bots, Live/Dry, Sens, Raison de sortie, Résultat, Groupe, Réinitialiser. Les filtres actifs sont bleus et retirables d'un tap.
- Analyse : calendrier P&L (tap sur un jour = filtre), distribution des profits (barres ; la queue gauche DCA est nommée et chiffrée ; tap sur une barre = filtre), raisons de sortie (nombre et P&L par raison).
- Liste groupée par jour avec en-têtes collants (nombre, % gagnants, sous-total). Téléphone : cartes ; desktop : tableau (heure, paire, bot, sortie, durée, DCA, %, P&L). Une fermeture manuelle est marquée (icône téléphone ou écran) pour l'audit.
- Détail de trade en feuille : P&L, MAE / MFE calculés côté passerelle, percentile de durée, frais + funding, ordres, liens graphique et bot.
- Pagination, filtre, tri, totaux et export CSV/XLSX faits par la passerelle (50 par page).
- Ordre téléphone : calendrier, liste, puis distribution et raisons. Desktop >= 1280 px : liste à gauche, analyse collante à droite (380-460 px).

### 4.5 Menu Outils

Discret mais complet pour les utilisateurs open-source : Labo de stratégie, Backtest, Télécharger des données, Configurer une pairlist, Diagnostic réseau et rate-limit (RequestTimeline), Test de choc (StressTest avec vrais prix de liquidation), Comparateur de volume, Replay dry. Chaque outil garde son écran actuel restylé avec les tokens ; aucun n'apparaît sur Flotte. Sur ce serveur, le propriétaire peut masquer Backtest (réglage « Afficher les outils de backtest », désactivé par défaut pour lui, activé pour une installation neuve).

### 4.6 Réglages

Sections : Général (langue FR/EN, fuseau du P&L quotidien, titre), **Bots** (registre de la passerelle : liste, groupes, tags, renommage, couleur, ajout, import/export unique de la config chiffrée v1/v2), **Alertes** (seuils par type, par groupe ou par bot, silences, notifications navigateur, règle « court et sans spam »), Graphiques (échelle, Heikin Ashi, couleurs haussier/baissier, préréglages), Affichage (thème sombre/clair/système, densité confort/compact/dense, palette daltonien, mouvement réduit forcé, disposition du dashboard par appareil), À propos (versions UI et passerelle, mise à jour du fork). La confirmation des actions financières n'est **plus désactivable**.

### 4.7 Santé et Logs

Santé : niveau global (Sain / Dégradé / Critique) avec raisons, budget rate-limit et backoff, cache ftcache, bots process, événements de flotte ; onglet Réconciliation (FleetviewReconciliation restylé : classification par coin, aperçu, puis confirmation avec le même dialogue, écritures toujours proxifiées vers Python) ; onglet Diagnostic réseau (RequestTimeline). Logs : LogStream en mode page (filtres niveau, bot, texte ; curseur serveur ; suivi en direct suspendu dès que l'utilisateur remonte).

## 5. Catalogue des widgets après fusion (C1 à C15)

| Cluster | Destination | Où | Raison |
|---|---|---|---|
| C1 Tableau de flotte | **FleetGrid** : un composant, deux vues (Mosaïque, Liste dense) ; groupes repliables, tri par en-tête, colonnes retirées par requête de conteneur, âge de la donnée par ligne | Flotte | La mosaïque résume 28-40 bots sur un téléphone sans défilement horizontal ; la liste garde la densité desktop. Projection mensuelle/FX supprimées (trompeuses). 22 colonnes ramenées à 10 ; les faits de config (port, stake...) vont dans la page bot |
| C2 Carte par bot | **BotPulse** (feuille/tiroir) puis page Bot | Flotte, partout où un bot est cliquable | 9 cartes au survol remplacées par un tap ; WinLossCard supprimée (couverte) ; projections composées supprimées |
| C3 Cartes de flotte et de groupe | **ScopePulse** : le héros Pouls pour la flotte, BotPulse paramétré par groupe (tap sur un en-tête de groupe) | Flotte | Le même panneau à trois périmètres évite 4 cartes Summary qui affichaient 3 winrates |
| C4 Courbes et périodes de P&L | **EquityCurve** (flotte et bot), **PnlCalendar** (Journal et onglet Performance), **Leaderboard** (Flotte) ; distribution dans le Journal | Flotte, Bot, Journal | 16 éléments pour 3 questions : « comment évolue le capital », « quels jours », « quels bots ». Benchmarks CoinGecko supprimés de la vue par défaut |
| C5 Risque et exposition | **RiskPanel** ; stress test en Outils | Flotte, Bot (KPI exposition) | Exposition wallet-level, liquidation la plus proche et paires partagées sont les seuls chiffres de risque actionnables au quotidien |
| C6 Infra et rate-limit | **SystemHealth** compact (Flotte) + page Santé ; RequestTimeline en Outils/Diagnostic ; RateBudget, RatePulse, CacheStatusWidget supprimés | Flotte, Santé | 4 ECharts pour 3 chiffres remplacés par 3 jauges et une phrase |
| C7 Logs | **LogStream** : mode compact (erreurs, 5 lignes) et mode page | Flotte, Bot, Logs | Un seul composant, filtres côté serveur |
| C8 Alertes et événements | **AlertRail** (À traiter) + **EventFeed** + pastille globale (onglet Flotte, rail) ; bandeau d'alerte sur la page bot | Flotte, Bot, navigation | Alertes calculées 24/7 par la passerelle, structurées, avec action directe et acquittement ; événements réels au lieu d'événements synthétiques |
| C9 Tables de trades | **TradeTable** : presets `open` (cartes glissables / tableau), `closed` et `journal` (groupé par jour, pagination serveur) | Flotte, Bot, Journal | Un registre de colonnes, un rendu carte pour le téléphone |
| C10 Détail de trade | **TradeDrawer** : en-tête cible, P&L, échelle DCA verticale, faits, actions, ordres ; stats MAE/MFE dans le Journal | Bot (intégré desktop, feuille mobile), Journal | Le DCA est le cœur de la flotte : il devient visuel et lisible d'un coup d'oeil. Survol de 5000 bougies supprimé |
| C11 Navigation de paires | **PairNavigator** (Graphiques, chips mobiles) + onglet Paires du bot (whitelist, verrous, blacklist) | Graphiques, Bot | Positions d'abord, puis signaux et verrous, une seule source |
| C12 Contexte marché et devises | **Supprimé** de l'interface par défaut ; option « ticker BTC/ETH » dans le héros servie par la passerelle (désactivée par défaut) ; conversion de devise supprimée | Réglages > Affichage | Toute la flotte est en USDC ; MarketPulse, ExchangeInfoCard, CurrencyInfoCard n'aidaient pas à décider |
| C13 Gestion des bots et réglages | **Réglages** : section Bots (registre passerelle), import/export unique ; barre d'édition de la NavBar supprimée | Réglages | Un seul endroit pour configurer, rien de tel sur Flotte |
| C14 Actions sur un bot | **BotActionBar** (page bot, BotPulse) + **ConfirmSheet** + `useBotAction(botId)` | Bot, BotPulse, menus de ligne | Une seule grammaire d'action, cible toujours explicite, verrou en vol |
| C15 Sélection, filtres, groupes | **FleetScope** : chips collantes + feuille Filtres + compteur visible | Toutes les pages flotte | Supprime la double notion sélection/filtre et les filtres invisibles |

Primitives partagées (toutes utilisées dans les maquettes) : `AdaptiveSheet` (bottom sheet / tiroir), `ConfirmSheet` + `HoldButton`, `KpiTile` / `KpiStrip`, `PnlValue` (animé, signe typographique U+2212), `StatusDot`, `ModeBadge` (Live/Dry), `DirectionBadge`, `LevChip`, `ExitReasonChip`, `AgeBadge`, `DcaDots`, `DcaTrack`, `DcaLadder`, `Meter`, `SplitBar`, `Sparkline` (SVG sans librairie), `SegmentedControl` (curseur animé), `Chip`, `SwipeRow`, `EventRow`, `Skeleton`, `EmptyState`, `Toast`, `ConnectionPill`, `CompactBar`, `BaseChart` (ECharts enregistré une fois, thème lu dans les tokens).

## 6. Design system

### 6.1 Couleurs

Tokens sémantiques, jamais de valeur en dur dans un composant. Contraste texte >= 4,5:1 sur `surface` dans les deux thèmes.

| Token | Sombre | Clair | Usage |
|---|---|---|---|
| `--bg` | #090B0E | #F4F5F7 | fond de page |
| `--bg-raised` | #0E1115 | #FAFBFC | rail, feuilles, en-têtes de groupe |
| `--surface` | #12161B | #FFFFFF | cartes |
| `--surface-2` | #181D24 | #F3F5F8 | survol, champs |
| `--surface-3` | #212731 | #E8EBF0 | sélection, curseur de segment |
| `--line` / `--line-strong` | blanc 6,5 % / 12 % | encre 8 % / 15 % | séparateurs, bordures |
| `--text` / `--text-2` / `--text-3` | #ECEFF4 / #A3ACB9 / #6C7585 | #0D1117 / #4A5465 / #7D8696 | texte principal, secondaire, tertiaire |
| `--primary` | #F2F4F7 (encre #0A0C0F) | #0D1117 (encre blanche) | bouton principal neutre |
| `--profit` | #2ED18B | #0A9A5C | gain, long |
| `--loss` | #FF5D6E | #DD3448 | perte, short, danger |
| `--warn` | #F5B544 | #B67500 | attention, périmé, DCA profond |
| `--info` | #5AA9FF | #2B76E5 | information, focus, prix moyen |
| `--live` | #A98BFF | #7444D8 | argent réel |
| `--dry` | #8A93A3 (contour pointillé) | #6B7383 | simulation |

Chaque couleur sémantique a une variante `-soft` (12-16 % d'opacité) pour les fonds. Hachures (`--hatch`) = donnée hors ligne ou périmée. Palette daltonien en option : profit bleu #3D9BFF, perte orange #FF8A3D, et toujours un signe + / − et une flèche ou un libellé.

### 6.2 Typographie

Geist (interface) et Geist Mono (logs, prix dans l'échelle DCA). Chiffres tabulaires partout (`tnum`). Moins typographique U+2212, espace fine insécable U+202F avant `%`, séparateur de milliers français.

| Rôle | Téléphone | Desktop | Graisse |
|---|---|---|---|
| Héros (display) | 40/44 | 48/52 (52/56 à 1920 px) | 650, approche −0,035 em |
| Titre de page (h1) | 22/28 | 22/28 | 650 |
| Titre de carte (h2) | 17/22 | 14/20 | 620 |
| KPI | 20-22 | 20-22 | 620 |
| Corps | 15/20 | 14/20 | 400-550 |
| Petit | 13/18 | 12,5/17 | 400-550 |
| Micro (labels en capitales, +0,07 em) | 11/14 | 11/14 | 550 |

### 6.3 Espacement, rayons, élévation

- Espacement base 4 : 2, 4, 8, 12, 16, 20, 24, 32, 40, 56. Marge de page 16 px (téléphone), 24 px (tablette, desktop), 32 px (>= 1920 px). Gouttière 12 px puis 16 px.
- Rayons : 6 (badges), 8 (petits boutons), 12 (boutons, champs, segments), 16 (cartes), 24 (feuilles, héros), plein (chips, pilules).
- Élévation sombre : on monte d'une surface et on ajoute un liseré interne clair de 1 px ; les ombres portées ne servent qu'aux feuilles et dialogues. Clair : ombres douces (`--shadow-1` à `--shadow-3`).

### 6.4 Densité

| Mode | Hauteur de ligne | Contrôle moyen | Par défaut |
|---|---|---|---|
| Confort | 56 px | 44 px | téléphone et écrans tactiles |
| Compact | 40 px | 34 px | desktop à pointeur fin |
| Dense | 32 px | 30 px | au choix (écrans 2560 px, mur de supervision) |

La densité est déduite de `pointer: coarse/fine` et de la largeur, puis réglable par appareil.

### 6.5 Points de rupture et grille

| Nom | Largeur | Grille | Navigation | Feuilles |
|---|---|---|---|---|
| xs | < 480 | 1 colonne, 4 col. internes | onglets bas | bottom sheet |
| sm | 480-767 | 1 colonne | onglets bas | bottom sheet |
| md | 768-1023 | 1 colonne large, KPI en 4 | rail icônes 76 px | bottom sheet, confirmation centrée |
| lg | 1024-1439 | 2 colonnes (1fr + 340 px) | rail icônes | tiroir 480 px |
| xl | 1440-1799 | 2 colonnes (1fr + 372 px) | rail 232 px avec libellés | tiroir |
| 2xl | >= 1800 | 3 colonnes (1,2fr + 1fr + 400 px) | rail 232 px | tiroir |

Les composants internes réagissent à leur propre largeur (container queries), ce qui permet de déplacer une carte d'une colonne à l'autre sans casse.

## 7. Iconographie

- **Lucide** (ISC, 1500+ icônes, cohérent avec l'écosystème Vue via `lucide-vue-next`, arborescent donc importé icône par icône). Trait 1,75 px, coins arrondis.
- Tailles : 14 (dans les chips), 16 (lignes denses, boutons sm), 20 (défaut), 22-24 (barre d'onglets).
- Règles : une icône = un concept dans toute l'app (`activity` Flotte, `bot` Bots, `chart-candlestick` Graphiques, `book-open-text` Journal, `trending-down` drawdown, `ghost` orpheline, `unplug` hors ligne, `hourglass` périmé, `layers` DCA, `ban` sortie refusée, `pause`, `rotate-cw`, `square` arrêt, `log-out` tout fermer, `hand` maintenir). Jamais d'icône seule pour une action financière : toujours un libellé. Les icônes héritent de la couleur du texte ; seules les icônes d'alerte prennent une couleur sémantique.
- Logo : un tracé de pouls dans un carré arrondi, dessiné dans la même grammaire de trait.

## 8. Boutons et contrôles

| Taille | Téléphone (tactile) | Desktop (pointeur fin) | Usage |
|---|---|---|---|
| sm | 36 px visibles, zone tactile 48 px | 28 px | actions de ligne, en-têtes de carte |
| md | 44 px | 34 px | défaut |
| lg | 52 px | 40 px | pied de feuille, action principale |
| Maintenir | 56 px pleine largeur | 56 px | confirmation financière |
| Tuile d'action | 64-68 px, icône + libellé | ligne de boutons md | barre d'actions du bot, BotPulse |

Variantes : principal (neutre plein), secondaire (surface), fantôme, danger plein (Fermer au marché), danger doux (Tout fermer, Supprimer), attention douce (Arrêter). Retour d'appui : échelle 0,97 en 90 ms. État `busy` : spinner intégré, bouton inactif. Segments à curseur glissant, chips de filtre, champs de 44-52 px, focus visible bleu 2 px.

## 9. Mouvement

| Durée | Courbe | Où |
|---|---|---|
| 90 ms | standard (0.2, 0, 0, 1) | appui, échelle |
| 160 ms | standard | survol, couleurs, chips |
| 240 ms | décélération (0.05, 0.7, 0.1, 1) | segments, barre compacte, cartes qui bougent |
| 360 ms | décélération | apparition de cartes (décalage 35 ms, 6 au plus), toasts |
| 420 ms | « feuille » (0.32, 0.72, 0, 1) | feuilles, tiroirs, confirmation |
| 600 ms | sortie cubique | compteurs de chiffres, déplacement du prix sur l'échelle DCA |

Ce qui s'anime : compteurs (de l'ancienne valeur à la nouvelle, jamais depuis zéro après le premier affichage), lueur verte ou rouge de 700 ms sur une valeur qui change, battement unique du point de connexion à chaque delta, glissement du prix sur les pistes et l'échelle DCA, réordonnancement des cartes en mode personnalisation (FLIP), squelettes au premier chargement uniquement.

Ce qui ne s'anime jamais : un fond, une boucle décorative, le réordonnancement d'une liste pendant que le doigt ou la souris est dessus (les changements de rang sont différés), un graphique pendant un zoom, le bouton de confirmation (sa progression suit le doigt, pas une minuterie décorative), un résultat d'ordre (il reste affiché jusqu'au statut réel). Aucun clignotement hors état « hors ligne ».

`prefers-reduced-motion` : plus aucune translation ni échelle, fondus de 120 ms au plus, compteurs instantanés, squelettes statiques, une seule itération partout. Réglage pour forcer ce mode.

## 10. Actions argent réel

1. **Cible toujours explicite** : la confirmation affiche avatar, nom du bot, badge Live (fond violet) ou Dry, stratégie, port, et la paire/sens/levier pour un trade. L'appel porte `(botId, tradeId)` de bout en bout ; il n'existe plus de notion de « bot actif » pour une écriture.
2. **Impact chiffré** : P&L estimé, notionnel, prix, paliers DCA ; avertissements contextuels (paire nettée sur le wallet partagé, minimum notionnel de 10 USDC, arrêt via l'API qui relance le bot, échelonnement des rechargements, suppression de base qui crée une orpheline).
3. **Geste délibéré** : « Maintenir pour fermer » 0,9 s (au clavier : maintenir Entrée). Pour Tout fermer et Supprimer de la base sur un bot live, il faut en plus taper le nom du bot. La confirmation ne peut pas être désactivée.
4. **Verrou en vol** : clé `bot:action:trade` ; tant que l'ordre n'a pas de statut, les boutons portant cette clé sont en état `busy` partout dans l'interface (ligne, tiroir, BotPulse). Aucun renvoi automatique d'un POST, côté passerelle comme côté client.
5. **Retour d'état réel** : toast « Fermeture envoyée, en attente de confirmation de l'exchange » (spinner), puis « Position fermée · réalisé +x USDC » ou « Refusée par la stratégie (confirm_trade_exit) » avec lien vers le trade. Les toasts de résultat restent 5 s et sont rejouables dans le journal d'audit.
6. **Éloignement** : Fermer et Supprimer de la base ne sont jamais voisins ; la suppression vit dans une section repliée « Actions sur la base du bot ».
7. **Pas d'action groupée sans échelonnement** : « Tout fermer » d'un bot envoie un ordre par position ; aucune action multi-bots en v1.
8. **Hors ligne** : toutes les actions marquées `data-money` sont désactivées et le bandeau le dit.

## 11. États

- **Chargement** : au premier snapshot, squelettes à la forme exacte du contenu (cartes, lignes, graphique) pendant ~400 ms ; ensuite plus jamais de squelette, seulement les deltas.
- **Vide** : phrase utile + action (« Aucune position. Le bot attend un signal. », « Rien à traiter » remplace le rail d'alertes).
- **Erreur d'un widget** : la carte garde sa place, message court, bouton Réessayer, détails repliés.
- **Périmé** (donnée plus vieille que 2 cycles) : hachures, âge en ambre, exclusion des totaux signalée. **Mort** (> 5 min ou bot hors ligne) : hachures, âge en rouge, valeurs grisées.
- **Hors ligne (navigateur ou passerelle)** : bandeau rouge « Connexion perdue, valeurs figées à HH:MM:SS, actions désactivées, reconnexion automatique », point rouge clignotant doux dans l'indicateur.

## 12. Connexion : passerelle ou mode direct

Indicateur en pilule dans chaque en-tête (et dans la barre compacte) :

| État | Rendu | Sens |
|---|---|---|
| Passerelle | point vert fixe, « Passerelle · 42 ms », battement à chaque delta | WebSocket ouvert, données poussées, alertes 24/7 |
| Direct | point ambre, « Direct · sondage 10 s », bandeau ambre explicatif | passerelle injoignable : le navigateur interroge les bots (mode actuel), alertes seulement onglet ouvert, agrégats calculés localement |
| Hors ligne | point rouge, « Hors ligne · reconnexion 4 s », bandeau rouge | plus aucune source ; valeurs figées, actions désactivées |

Un tap ouvre le détail : latence, nombre de bots sondés, dernier snapshot, version de la passerelle, raison du mode direct.

## 13. Dashboard par défaut et personnalisation

- Disposition par défaut décrite en 4.1, différente par classe d'appareil (téléphone, desktop) et mémorisée séparément (la passerelle peut les synchroniser).
- Bouton **Personnaliser** en bas de page (et via la palette) : chaque carte affiche Monter, Descendre, Masquer ; sur desktop, glisser par l'en-tête en plus. Les déplacements sont animés (FLIP). Aucune dépendance au glisser-déposer HTML5 sur téléphone.
- Trois **préréglages** : Surveillance (défaut : alertes, bots, positions, risque), Trading (positions et capital en premier, graphique de la paire la plus en perte), Analyse (capital, classement, calendrier). Réinitialisation en un geste.
- Les identifiants de cartes sont des chaînes versionnées (`fleet@1`, `positions@1`...) ; l'ancien `ftLayoutSettings` est ignoré (réinitialisable par contrat), les autres préférences sont migrées.

## 14. Migration (sans action de l'utilisateur)

Au premier chargement sur la même origine `:9400` : lecture de `ftAuthLoginInfo` (ids `ftbot.N` conservés), `ftBotComparison` (groupes, tags, ordre, seuils), `ftUISettings`, `ftUIColorSettings`, `ft_locale` (es/de/it/pt basculent sur EN), colonnes de trades, `ftPlotConfig` (préréglages d'indicateurs) ; import vers la passerelle si elle répond, sinon stockage dans une clé versionnée `pouls.v1`. Les anciennes clés ne sont jamais modifiées, ce qui permet de revenir à l'ancienne interface.

## 15. Points à valider par le propriétaire

1. Geste « maintenir 0,9 s » pour toute action financière, et saisie du nom pour Tout fermer / Supprimer sur un bot live : acceptable au quotidien ou trop lent ?
2. Mosaïque par défaut sur téléphone et liste dense par défaut sur desktop : le grand chiffre d'un carreau doit-il être le latent (proposé) ou le réalisé du jour ?
3. Forceexit depuis la carte Positions du dashboard (glisser puis confirmer) : à garder, ou seulement depuis le TradeDrawer ?
4. Violet pour « live » : assez distinct du bleu d'information sur votre écran et votre téléphone ?
5. Fuseau du P&L quotidien (maquettes en UTC+2) et définition du « jour ».
6. Ticker BTC/ETH optionnel dans le héros, ou suppression totale du contexte marché ?
7. Seuils de fraîcheur : périmé à 2 cycles, mort à 5 min ?

## 16. Limites connues des maquettes

- Données factices générées dans le navigateur ; les agrégats, alertes et MAE/MFE seront calculés par la passerelle.
- La palette de commandes, la feuille Filtres, le sélecteur de bot et les pages Santé, Logs, Réglages, Outils ne sont décrits que dans ce document (pas de maquette dédiée).
- Le geste de glisser des lignes ne s'active qu'au tactile (pointeur souris ignoré) ; sur desktop, le bouton Fermer de la ligne le remplace.
- En capture pleine page, la barre d'onglets fixe et la barre compacte apparaissent à la position du premier écran : c'est un artefact de capture, pas de mise en page.
- Polices et ECharts chargés depuis un CDN : sans réseau, repli sur les polices système.
