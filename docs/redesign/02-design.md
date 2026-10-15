# 02 - Design final de FreqUI Ultimate 2

Statut : spécification définitive issue du concours de design (propositions A, B, C et trois jurys).
Entrées : `01-current-state.md` (inventaire, clusters C1 à C15), `03-gateway-architecture.md` (contrat passerelle,
tableau 6.4), `proposals/*/spec.md`. Maquettes finales : `mockups/` (voir § 20).

## 0. Décision

- **Base : A « Terminal »** (total 240, gagnante des trois jurys). Poste de trading dense et calme : filets plutôt
  qu'ombres, chiffres en monospace tabulaire, coquille identique sur toutes les pages, barre d'état façon IDE, espaces
  de travail à zones au lieu du glisser-déposer libre.
- **Greffes de B « Tour de contrôle »** : rail « À traiter » à onglets (Actives, Acquittées, Silencieuses) avec ré-alerte
  et silence à échéance ; incident d'abord sur téléphone ; « Depuis votre passage » ; tri « Attention d'abord » et badge
  « N à voir » ; raisons de santé sans score chiffré ; contenu complet du dialogue de confirmation ; jeton `--crit`
  distinct de `--loss` ; tuiles de carte neutres au repos ; échelle DCA horizontale normalisée ; filtre « Sans replay »
  par défaut ; liste exhaustive des mutations confirmées.
- **Greffes de C « Pouls »** : feuille adaptative unique (feuille basse sous 600 px, tiroir au-delà) ; avertissements
  contextuels chiffrés ; verrou en vol par clé `bot:action:trade` ; percentile de durée ; marqueur « manuel » ;
  bandeau « valeurs figées à HH:MM:SS » ; palette daltonien ; container queries ; tuiles d'action de 64 px et bouton de
  maintien pleine largeur sur téléphone ; section repliée « Maintenance de ce trade (base du bot) » ; base de la page Graphiques.
- **Non retenu** : score de santé 0-100 (B, peut endormir la vigilance), héros « P&L du jour » (C, le risque d'une flotte
  DCA est le latent et le drawdown), carrousel d'alertes (C), glisser pour fermer sur une action argent réel (C),
  séquence de rechargements multi-bots dans la palette (A, action groupée interdite en v1), ticker BTC/ETH dans une case
  KPI (A), notifications Telegram ou navigateur promises (B, C), clés `ftTerminal.v1` et `pouls.v1`.
- **Corrections** : toutes les exigences `must_fix` des trois jurys (regroupées quand elles se recoupent) sont tracées au § 18.

## 1. Principes

1. **Un chiffre, une vérité, un âge.** Chaque groupe de chiffres porte sa fraîcheur. Une valeur périmée n'est ni
   présentée comme actuelle ni sommée ; le total dit combien il exclut et le compteur ouvre la liste.
2. **L'argent réel d'abord, et seul.** Les totaux par défaut portent sur le live. Le dry n'est jamais additionné au live.
   Le violet `--live` ne signale que l'argent réel.
3. **L'exception se voit, le calme se tait.** Au repos, l'écran est neutre. La couleur n'apparaît que pour un sens :
   gain, perte, vigilance, critique, information, argent réel.
4. **Agir sans risque.** Toute mutation nomme son bot, part une seule fois, se confirme par un geste proportionné au
   risque et rend un résultat honnête en deux temps (transmis, puis rempli ou à vérifier).
5. **Fusionner plutôt qu'empiler.** 20 widgets et 18 cartes de survol deviennent une vingtaine de composants partagés.
   Le même panneau sert à un bot, un groupe ou la flotte.
6. **Le clavier sur desktop, le pouce sur téléphone.** Rien n'est accessible uniquement au survol.

## 2. Architecture de l'information et navigation

### 2.1 Pages de premier rang

| Page | Route | Raccourci | Rôle |
|---|---|---|---|
| Flotte | `/` et `/dashboard` | `G D` | Surveiller, voir ce qui demande une décision, agir vite |
| Bot | `/bot/:botKey` | `G B`, `[` `]` | Piloter un bot : graphique, positions, DCA, actions |
| Graphiques | `/charts?bot=&pair=&tf=` | `G C` | Analyse plein écran, 1 ou 2 cellules |
| Journal | `/journal` | `G J` | Historique fermé, totaux, distributions, export |

Redirections conservées (aucun lien existant ne casse) : `/trade` et `/trade?bot=` vers `/bot/:botKey` (résolution de
l'alias `ftbot.N`), `/open_trades` vers `/` filtre Positions, `/trade_history` vers `/journal`, `/balance` et
`/pairlist` vers l'onglet correspondant de la page Bot, `/logs` vers `Outils > Logs`, `/settings` vers `Réglages`,
`/login` vers `Réglages > Bots`, `/download_data`, `/pairlist_config`, `/strategy-dev`, `/backtest` vers les pages
Outils, paramètres `?bot=`, `?highlight=` et `redirect` honorés.

### 2.2 Menu Outils (discret)

Entrée « Outils » en fin de navigation, couleur `--fg-3`, sans badge, ouverte en menu : Diagnostic (timeline et 429 par
bot, Sankey, budget, cache), Réconciliation du wallet, Risque avancé (stress test), Logs (page), puis séparés :
Labo de stratégie, Backtest, Télécharger des données, Configuration de pairlist, Replay dry, Comparateur de volume. Les
pages Outils ne sont ni dans la barre mobile ni dans les raccourcis `G`. Accès aussi par la palette.

### 2.3 Coquille desktop (1024 px et plus)

```
+------------------------------------------------------------------------------------------+
| FreqUI  Flotte Bot Graphiques Journal Outils v   [Bot, paire, action  Ctrl K]  (o) Passerelle 38 ms  cloche  thème  réglages |  44 px
+------------------------------------------------------------------------------------------+
| bandeaux globaux éventuels : cache, connexion, mode direct, dégradé, hors ligne           |  auto
+------------------------------------------------------------------------------------------+
| bandeau de page : KPI flotte, en-tête bot, filtres et totaux du journal                   |  56-64 px
+------------------------------------------------------------------------------------------+
| périmètre FleetScope : Live/Dry/Tout · recherche · groupes · tags · En alerte · espace    |  40 px
+------------------------------------------------------------------------------------------+
|                         panneaux en zones nommées (grille de la page)                     |  1fr
+------------------------------------------------------------------------------------------+
| Santé · Bots live · Budget HL · Backoff 429 · Cache · Snapshot | Logs · Densité · version  |  26 px
+------------------------------------------------------------------------------------------+
```

- La page tient dans la fenêtre (`100dvh`), seuls les panneaux défilent.
- **Barre d'état** : résumé permanent de SystemHealth (C6) et accès au LogStream (C7). Clic sur Santé, Budget ou
  Backoff : feuille SystemHealth. Clic sur Logs : tiroir de logs par le bas (erreurs par défaut).
- **Cloche** : nombre d'alertes critiques et de vigilance non acquittées (les infos ne comptent pas). Clic : focus sur le
  rail « À traiter » (Flotte) ou retour en haut de page sur téléphone.

### 2.4 Tablette (600 à 1023 px)

Navigation principale dans la barre d'onglets basse, en-tête réduit. KPI en grille de 4. Panneaux sur 2 colonnes
puis empilés (« À traiter » et « Risque » côte à côte, puis Flotte, Positions, Équité). Le document défile ; chaque
panneau a une hauteur maximale et défile en interne.

### 2.5 Téléphone (moins de 600 px)

- En-tête de 52 px : logo, loupe (palette), pastille de connexion (point seul quand tout va bien, texte sinon), cloche.
- **Barre d'onglets basse** de 58 px, collante en fin de document : Flotte, Bot, Graphiques, Journal, Plus (Outils,
  Réglages, thème, santé). Les 4 pages de premier rang y sont.
- **Incident d'abord** : dès que la liste d'alertes n'est pas vide, le bloc « À traiter » (critiques d'abord, 4 visibles
  puis « Voir les N autres ») passe avant les KPI. Liste verticale, jamais de carrousel.
- KPI en grille 2 x 2 + exposition pleine largeur ; puis périmètre en puces défilantes ; Flotte en **carte** par défaut ;
  positions en cartes avec échelle DCA horizontale ; Équité ; Risque.
- Tiroirs, ScopePanel, TradeDrawer et confirmations deviennent des feuilles basses (poignée, coins de 14 px), boutons
  de 48 à 52 px, `env(safe-area-inset-*)` respecté. Aucun geste de glisser ne déclenche d'action financière.

### 2.6 Palette de commandes et clavier

`Ctrl K` ou `/` : groupes Aller à, Bots (point live ou badge Dry, état d'alerte), Paires, Actions, Affichage. Une action
tapée ouvre **toujours** la confirmation du bot nommé, un seul bot à la fois ; il n'existe aucune commande groupée en v1.

| Touche | Action |
|---|---|
| `G D` `G B` `G C` `G J` `G S` | Flotte, Bot, Graphiques, Journal, Réglages |
| `F` | focus de la recherche du périmètre |
| `M` | table ou carte de la flotte |
| `J` / `K`, `Entrée` | ligne suivante, précédente (ordre « Attention d'abord »), ouvrir |
| `X` | sortir la position sélectionnée (ouvre la confirmation) |
| `P` | pause des entrées du bot courant (confirmation nommée) |
| `[` / `]` | bot précédent, suivant |
| `Alt 1/2/3` | espace de travail Surveillance, Incident, Analyse (Graphiques : nombre de cellules) |
| `T` | thème |
| `?` | aide des raccourcis |
| `Échap` | fermer palette, feuille, dialogue |

Aucune touche sans modificateur n'agit quand un champ a le focus ; `Ctrl A` n'est plus détourné.

## 3. Pages

### 3.1 Flotte (`mockups/dashboard.html`)

**Bandeau KPI** (KpiStrip, périmètre courant, live par défaut) :

| Tuile | Valeur | Sous-ligne |
|---|---|---|
| Équité live, avec latent | réalisée + latent, USDC | équité réalisée ; « N exclus » cliquable |
| P&L latent | somme des positions non périmées | nombre de positions |
| Réalisé jour | depuis 00:00 du fuseau choisi | fuseau explicite |
| Réalisé 30 j | USDC | taux de réussite |
| Drawdown avec latent | **USDC d'abord**, puis % | seuil, jauge avec repère |
| Exposition wallet | long / short en USDC, barre verte et rouge | net signé en sous-ligne (jamais une 3e valeur sur la ligne principale, qui débordait à 1280 px) |
| Marge utilisée | % | jauge |
| Bots en ligne | en ligne / total du périmètre | compte par état : hors ligne, périmé, démarrage, session expirée |

En périmètre « Tout », les tuiles affichent live et dry côte à côte avec la mention « non sommés » ; aucune somme ne
mélange les deux. Le ticker BTC/ETH n'occupe pas de case : désactivé par défaut, il s'affiche dans la barre d'état
s'il est activé.

**Grille par défaut (espace Surveillance)** :

```
1024-1799 px                                     1800 px et plus
+--------------------------+-------------+       +-------------------+-----------+-----------+
| FleetTable | FleetMap    | À traiter   |       | FleetTable        | Équité    | À traiter |
| (7/12)                   | (5/12)      |       | (7/12)            | (7/12)    | (12/12)   |
|                          +-------------+       +-------------------+-----------+           |
+--------------------------+ Équité (4)  |       | Positions (5/12)  | Risque    |           |
| Positions ouvertes (5/12)+-------------+       |                   | (5/12)    |           |
|                          | Risque (3)  |       +-------------------+-----------+-----------+
+--------------------------+-------------+
colonne droite : clamp(360px, 30vw, 430px)
```

- **FleetTable** : ligne Σ collante « Flotte live · N exclus », groupes repliables avec agrégats et badge « N à voir »,
  une ligne par bot. Colonnes : état + nom (jamais tronqué, largeur minimale 196 px) + badges Dry, xyz + icône d'alerte
  + état texte (« démarrage 4 min », « session expirée », « depuis le 03/10 ») ; sens ; latent ; jour ; 30 j ;
  sparkline 24 h (SVG) ; exposition ; slots (jauge) ; drawdown USDC puis % avec jauge et repère de seuil ; dernier
  trade ; âge. Liseré violet de 2 px à gauche = live, liseré gris = dry. Tri « Attention d'abord » dans chaque groupe
  (critique, vigilance, info, puis pire latent) ; l'ordre ne change qu'à l'apparition ou à la résolution d'une alerte et
  se fige pendant le survol ou le focus. Clic sur une ligne : ScopePanel du bot ; sur Σ ou un groupe : ScopePanel du
  périmètre. Colonnes retirées selon la largeur du panneau (container queries : dernier trade sous 1080 px, sparkline
  sous 940, 30 j et expo sous 800, jour, slots et sens sous 600).
- **FleetMap** (`M`) : tuiles de 138 px minimum, neutres au repos (fond `--bg-2`), nom complet sur deux lignes au
  besoin, P&L latent en texte coloré, point violet pour le live, bordure pointillée pour le dry. Couleur seulement pour
  vigilance (barre ambre), critique (barre et bordure `--crit`), périmé (hachures ambre, bordure pointillée), hors ligne
  (hachures grises, valeur barrée). Légende visible. Même tri. Vue par défaut sur téléphone.
- **Positions ouvertes** (TradeTable `open`) : paire (+ xyz, + ORPHELINE), bot (lien, point live), sens, pips DCA,
  entrée moyenne, prix, P&L USDC, %, distance de liquidation (jauge), durée avec percentile (`p84` ambre, `p91`
  critique), menu de ligne. Tri par défaut : pire P&L en haut. Filtres : Toutes, En perte, DCA ≥ 3, xyz, Orphelines.
  Sous 560 px de panneau : cartes avec échelle DCA horizontale. **Aucun bouton rouge par ligne** : le menu `…` (neutre,
  visible au survol, au focus et toujours en tactile) propose Ouvrir le trade, Graphique, Sortir…, Renforcer…, Pause
  des entrées. Une position orpheline n'a jamais de Sortir : seulement « Réconcilier » vers l'aperçu.
- **À traiter** (AlertRail) : niveau (Calme, Vigilance, Critique) ; onglets Actives, Acquittées, Silencieuses,
  Événements. Chaque alerte : sévérité, titre, bot (point live ou Dry) ou « wallet », message chiffré (valeur et seuil),
  heure, action contextuelle (Pause entrées, Ouvrir, Logs, Réconcilier (aperçu), Diagnostic, Se reconnecter), puis
  Acquitter et Silence (1 h, 4 h, jusqu'à demain 08:00). L'alerte acquittée revient si la valeur empire d'un cran.
  Vide : « Rien à signaler ». En tête de l'onglet Événements : « Depuis votre passage » (réalisé, trades G/P, renforts
  DCA, alertes nouvelles et résolues, redémarrages, pire trade, bouton « Marquer vu »).
- **Équité** : onglets Équité, Classement, Calendrier ; période en menu ; définition nommée en segment (« Latent » =
  open-inclusive, « Réalisée »). Quand le panneau fait moins de 520 px (container query : 1280 px, 1920 px à 3 colonnes,
  téléphone), période et définition fusionnent en un seul menu « 7 j · Latent ». En-tête : variation de la période et drawdown max **en USDC puis %**. Courbe et
  sous-graphe de drawdown synchronisés (une instance ECharts), séparés par un écart ; libellé max du drawdown et min de
  l'équité masqués pour que les axes ne se chevauchent pas quand le panneau est bas. Classement : barres centrées sur zéro par bot (DOM).
  Calendrier : grille mensuelle teintée (DOM).
- **Risque wallet** : liquidation la plus proche (paire, bot), levier effectif (notionnel / capital), nombre de coins
  tenus par au moins 2 bots (netting), position orpheline, puis tableau coin, bots, barres long (acier) et short (sable
  hachuré), net.

**Espaces** : Incident agrandit « À traiter » et masque l'équité ; Analyse place l'équité en grand et masque le risque.
À partir de 1440 px : segment « Espace » plus bouton de disposition ; en dessous, un seul bouton-menu « Surveillance ▾ »
(espaces et « Personnaliser la disposition… ») pour que la barre de périmètre tienne sans défilement caché.

**Mobile** : voir § 2.5. Ordre : À traiter, KPI, périmètre, Flotte (carte), Positions (7 cartes puis « Voir les N
autres »), Équité, Risque.

### 3.2 Bot (`mockups/bot.html`)

**En-tête** : bot précédent et suivant, point d'état, nom (18 px), badge LIVE complet, badge marché (HIP-3,
crypto + xyz), sélecteur de bot ; méta (stratégie, timeframe, levier, port, état ou uptime, âge des données) ; KPI du bot
(latent, jour, 30 j, capital = `available_capital - capital_withdrawal`, exposition L/S, drawdown avec latent en USDC puis
% et seuil, backoff 429 du bot via proxy) ; actions : Pause entrées, Recharger, Config, `…` (Reprendre les entrées,
Entrée forcée, Replay dry, puis séparé : Arrêter le bot…), espace de 18 px, **Tout sortir…** (contour danger, seul
élément rouge de l'en-tête).

**Bandeaux d'état du bot** : session expirée (Se reconnecter, actions désactivées), démarrage (« pas d'alerte hors ligne
avant 20 min »), hors ligne (« valeurs figées à HH:MM:SS ; ne relancez pas un bot seulement pour fermer une position »),
arrêté (ledger orphelin, lecture seule).

**Grille 1440** :

```
+-----------+----------------------------------+----------------------+
| Paires    | Graphique 15m + niveaux          | TradeDrawer docké    |
| (236 px)  | Moy., TP, SO suivant, fills E S1 | P&L, faits, échelle  |
|           +----------------------------------+ DCA, ordres, base    |
|           | Positions | Historique | Perf.   | du bot (repliée)     |
|           | Paires et verrous | Logs | Config +----------------------+
|           |                                  | Sortie collante      |
+-----------+----------------------------------+----------------------+
```

- **PairNavigator** : positions tenues d'abord (sens, DCA n/m, %), puis whitelist (variation, « Signal entrée »,
  verrou avec durée restante). Filtres Toutes, Pos., Signal et cadenas (paires verrouillées, libellé en infobulle).
- **Graphique** : composant unique `PriceChart`, le même que la page Graphiques : chandeliers, préréglage d'indicateurs
  (ema_50 en `--info`), lignes Moy. (accent), TP (tirets `--profit`), SO suivant (tirets `--warn`), marqueurs E, SO1 à
  SOn posés au prix réel de remplissage, volume ; liquidation hors champ annoncée au bord avec sa distance ; marge
  gauche réservée pour la première heure ; lien « Ouvrir dans Graphiques ».
- **Positions** : bouton de ligne « Sortir… » en variante secondaire neutre (icône seule quand le panneau fait moins de
  820 px, libellé en infobulle et `aria-label`), visible au survol, au focus, sur la ligne
  sélectionnée et toujours en tactile. La sortie principale reste dans le pied collant du TradeDrawer.
- **TradeDrawer** : paire, sens, levier, xyz, numéro, rappel « Bot ciblé » avec badge LIVE ; P&L en 26 px, %, durée et
  percentile ; 6 faits (notionnel, mise, DCA, vers TP, vers SO suivant, vers liquidation) ; échelle DCA verticale
  (toujours ouverte : c'est l'information de risque) ; ordres repliables, repliés par défaut sous 900 px de haut avec le
  résumé « N remplis, M en attente » ; section repliée « Maintenance de ce trade (base du bot) » (Annuler l'ordre, Recharger le trade, puis séparé par un
  filet pointillé : Supprimer de la base…, avec « ne ferme pas la position »). **Pied collant** : quantité 25, 50,
  100 %, Autre ; montant ; « min. 10 USDC » ; Sortir au marché… (contour danger) et Renforcer…
- **Onglets** : Positions, Historique (preset `closed`, lien vers le Journal filtré), Performance (barres par paire),
  Paires et verrous (méthodes, whitelist, blacklist et levée de verrou avec confirmation), Logs (LogStream filtré),
  Config (résumé lisible, « Éditer (revue du diff) » vers l'éditeur Monaco existant).
- **Téléphone** : KPI 3 x 2, rangée de 4 tuiles d'action de 64 px (Pause entrées, Recharger, Config, Plus), onglets
  avec positions en cartes et échelle DCA horizontale, graphique de 320 px, paires, puis section repliée « Actions
  sensibles du bot » (Tout sortir…, Arrêter…) en bas de page, loin des actions courantes. Tap sur une position :
  TradeDrawer en feuille basse.
- **Clavier** : `J` / `K` position, `X` sortir, `P` pause, `[` `]` bot voisin.

### 3.3 Graphiques (`mockups/charts.html`)

- Barre d'outils : paire (ouvre la palette filtrée), **bot de contexte** (sa stratégie calcule les indicateurs), timeframe
  5m à 1j, cellules 1 ou 2 (`Alt 1/2`, 3 au maximum), Heikin Ashi, Mesurer (`Maj + glisser`, appui long en tactile),
  Indicateurs (feuille PlotConfigurator, préréglages migrés de `ftPlotConfig`).
- PairNavigator à gauche (260 px) : positions ouvertes de la flotte d'abord (bot, DCA, P&L), signaux récents, toutes.
- Cellule : légende OHLC et indicateurs mise à jour en rAF, puis le même `PriceChart` que la page Bot (mêmes niveaux DCA
  et marqueurs d'exécution), avec le sous-graphe RSI en plus ; bouton « HA » (infobulle « Bougies Heikin-Ashi ») ;
  lien « Page du bot ». Ajout de bougie par delta (canal `chart:<key>:<pair>:<tf>`), séries fusionnées par `id`.
- Téléphone : puces de paires défilantes (positions d'abord), graphique à 62 vh, puis carte de la position ouverte
  avec échelle DCA.

### 3.4 Journal (`mockups/journal.html`)

- **Filtres** : période (24 h, 7 j, 30 j, Mois, Année, Tout, plage), Live/Dry/Tout (Live par défaut), puce **« Sans
  replay »** active par défaut et visible, Bots, Sens, Raison de sortie, Profondeur DCA, paire, Vues enregistrées,
  Exporter (CSV ou XLSX de l'ensemble filtré par la passerelle ; en mode direct, CSV de la page affichée seulement).
- **Totaux filtrés** : P&L net frais inclus (« 96 trades dont 1 sans P&L » : même total que l'en-tête de liste, le
  trade sans profit est compté mais hors somme), taux de réussite (G/P), facteur de profit, espérance,
  pire trade, **pire moins-value en absolu** (USDC, jamais en %), durée médiane et P90, trades par jour.
- **Liste** : groupée par jour, en-tête de jour collant avec sous-total ; colonnes fermé, bot, paire, sens, DCA (ambre
  dès 4), P&L, %, MAE · MFE (micro-barre : excursion défavorable à gauche, favorable à droite, trait = sortie), raison
  (puce neutre en libellé FR, valeur freqtrade brute en infobulle et dans l'export : ROI atteint, Signal de sortie,
  Stop suiveur, Stop-loss, Sortie forcée, Liquidation ; inconnues affichées brutes ; Stop-loss en couleur de perte,
  « inconnu » si nul, badge « manuel » pour une sortie humaine), durée. Pagination par curseur serveur : pied « Plus
  ancien » en table, bouton unique « Charger les jours précédents » en cartes (jamais les deux). Vues Par jour, Par bot, Par paire.
- **Analyse** : Distribution (histogramme log, queue sous −5 % en `--loss`, phrase chiffrée sur son poids), Profondeur
  DCA (trades, taux de réussite, P&L par nombre d'ordres remplis), Raisons (P&L par raison), Par bot. Calendrier P&L disponible
  sur la Flotte (onglet de l'équité).
- **Téléphone** : totaux 2 x 3, cartes groupées par jour (2 jours puis « Charger les jours précédents »), analyse dessous.

### 3.5 Outils (`mockups/tools.html`, section Outils)

Grille de cartes (titre, phrase, étiquettes « Python », « par bot »). Réconciliation : tableau coin, wallet, somme des
bots, classification, proposition, « Aperçu… » qui ouvre une confirmation de niveau destructif (saisie du nom du coin +
maintien), écriture Python. Diagnostic : bot choisi pour sa timeline 429, budget agrégé, cache.

### 3.6 Réglages (`mockups/tools.html#reglages`)

1. **Bots (registre)** : bandeau de migration (« 32 bots importés depuis ce navigateur, ids `ftbot.N` gardés comme alias,
   anciennes clés intactes »), bots découverts non enregistrés (ajout en un clic), tableau (état, alias et `bot_key`,
   groupe, marché, seuils), « Se reconnecter » sur une session expirée, import (v1, v2, v3) et export uniques.
2. **Passerelle** : source Auto, Passerelle, Direct ; adresse ; état (4 états + direct) ; dernière sonde, protocole,
   version, décalage d'horloge corrigé ; « Sonder maintenant ».
3. **Affichage** : langue Français/English, thème Sombre/Clair/Système, densité, fuseau du P&L quotidien, palette
   daltonien, mouvement réduit, ticker BTC · ETH (désactivé par défaut).
4. **Alertes** : règles et seuils, sévérités ; notification navigateur indisponible en HTTP, expliqué.
5. **Sécurité des actions** : tableau des niveaux (§ 11), durée de maintien affichée et non modifiable, démonstration de
   chaque résultat d'action.
6. **Espaces de travail** : réinitialiser chacun.
7. **À propos et audit** : versions UI et passerelle, clés `fqu2.*`, journal d'audit.

## 4. Catalogue des widgets et clusters

### 4.1 Correspondance C1 à C15

| Cluster | Composant(s) final(s) | Ce qui change et pourquoi |
|---|---|---|
| **C1** Tableau de flotte | `FleetTable` + `FleetMap` | BotComparisonList (22 colonnes), FleetviewBotsTable et FleetOverview deviennent une table de 11 colonnes utiles et une carte. Les 8 colonnes de configuration passent dans l'en-tête Bot. Projection mensuelle et conversion FX supprimées (extrapolations trompeuses, tout est en USDC). Données du canal `fleet`. |
| **C2** Carte par bot | `ScopePanel` (périmètre bot) + `BotHeader` | Les 10 cartes (Open/Closed/Period/Balance/WinLoss/BotInfo/TradesInfo, BotStatus, BotProfit, drawdown) deviennent alertes du bot, 6 tuiles, actions, positions, latent 24 h. WinLossCard supprimée (winrate dans une tuile). Projections composées supprimées. |
| **C3** Cartes flotte et groupe | `ScopePanel` (périmètre groupe ou flotte) | Même composant, ouvert depuis Σ ou un en-tête de groupe. Capital du registre, jamais `balance.total`. |
| **C4** Courbes et périodes P&L | `EquityCurve`, `Leaderboard`, `PnlCalendar` (Flotte), `DistributionChart`, `DcaDepthTable`, `ExitReasonTable` (Journal) | 16 éléments pour 4 questions : où en est l'équité, quels jours, quels bots, quelle forme des pertes. Benchmarks réduits à zéro par défaut. CumulativeProfitEnhanced, ProfitOverTimeEnhanced, PerformanceHeatmap supprimés (morts). WalletHistory et CumProfit restent dans Backtest (Outils). |
| **C5** Risque et exposition | `RiskPanel` ; stress test dans Outils > Risque avancé | Exposition au niveau du wallet, liquidation la plus proche, levier effectif, netting par coin, orpheline. Le stress test simpliste quitte le tableau de bord. |
| **C6** Infra et rate-limit | `SystemHealth` : barre d'état + feuille ; RequestTimeline dans Outils > Diagnostic | Niveau et raisons en 26 px ; les 4 jauges ECharts disparaissent. Backoff et budget par bot via proxy, budget agrégé passerelle. CacheStatusWidget, RateBudget, RatePulse supprimés. |
| **C7** Logs | `LogStream` (compact : tiroir de la barre d'état et onglet Bot ; page : Outils > Logs) | Un composant, deux modes, filtres serveur, curseur passerelle. |
| **C8** Alertes et événements | `AlertRail`, `SinceLastVisit`, `EventFeed`, badge de cloche | Alertes structurées 24/7 (passerelle), acquittement, silence à échéance, dédoublonnage, actions contextuelles. Vrais événements (fills, sorties, hors ligne, audit). Statut de réconciliation remonté en alerte « Position orpheline ». |
| **C9** Tables de trades | `TradeTable` (presets `open`, `bot`, `closed`, `journal`) + `PositionCard` | Registre de colonnes portant le rendu, cartes sous 560 px de panneau, pagination, tri et filtres serveur, routage `(botKey, tradeId)`. TradeList, TradesLogEnhanced, CustomTradeList, MobileTradesListView supprimés. |
| **C10** Détail de trade | `TradeDrawer` + `DcaLadderV` | Docké sur Bot, tiroir ailleurs, feuille basse sur téléphone. MAE/MFE déplacé dans le Journal (calcul serveur). Survol de 5 000 bougies supprimé. StoplossChartPopover supprimé. |
| **C11** Navigation de paires | `PairNavigator` (Bot, Graphiques) + onglet « Paires et verrous » | Un seul sélecteur (positions, signaux, verrous). Blacklist et levée de verrou confirmées. |
| **C12** Marché et devises | Ticker BTC · ETH optionnel dans la barre d'état, désactivé par défaut | MarketPulse, ExchangeInfoCard, CurrencyInfoCard, conversion de devise et sentiment : supprimés. |
| **C13** Gestion des bots et réglages | Page Réglages (Bots en tête) | Home et BotList fusionnés dans le registre ; import et export à un seul endroit ; barre d'édition de la NavBar supprimée (espaces de travail). |
| **C14** Actions sur un bot | `BotActionBar`, `BotActionMenu`, `ConfirmDangerDialog`, `HoldButton`, `useBotAction(botKey)` | § 11. Même chemin pour ligne, tiroir, en-tête, menu et palette. |
| **C15** Sélection, filtres, groupes | `FleetScope` | Une barre partagée par toutes les vues de flotte et conservée entre pages ; filtre actif toujours visible (puce pleine) ; plus aucun filtre silencieux par widget. |

### 4.2 Suppressions et leur raison

| Élément (n° de 01) | Raison |
|---|---|
| Projection mensuelle/annuelle et FX du Summary (8) | Extrapolation linéaire trompeuse ; tout en USDC |
| MarketPulse (24, 128), ExchangeInfoCard (113), CurrencyInfoCard (114), sentiment | Faible valeur de supervision ; données statiques périmées et juridiquement risquées |
| Ids de widgets fantômes (38), barre d'édition du layout (49), Réglages > Dashboard (53) | Remplacés par les espaces de travail versionnés |
| SettingsView et DashboardView legacy (57) | Non routés |
| ~25 keyframes et fond animé infini (64) | Coût GPU ; remplacés par le système de mouvement § 9 |
| CumulativeProfitEnhanced (69), ProfitOverTimeEnhanced (70), PerformanceHeatmap (72) | Non montés ; idées « meilleur jour » et calendrier reprises |
| StoplossChartPopover (91), TradeList (98), TradesLogEnhanced (99), fichiers morts (201) | Aucun import ; vérifier par un build avant suppression |
| WinLossCard (108) | Entièrement couverte par la tuile winrate |
| ProfitRangePopover (117), ProfitGoalBar (118) | Morts ; MAE/MFE repris côté serveur dans le Journal |
| FleetOverview (122) | Mort, polling 1 s |
| CacheStatusWidget (131, 181), RateBudget (133), RatePulse (134) | Doublons de SystemHealth ; démon partagé |
| Helpers de contournement du fan-out (166) | Obsolètes avec la passerelle |
| MobileTradesListView et listes custom (200) | Remplacées par le mode cartes de TradeTable |
| `/profit_history` par bot (213) | Remplacé par la version flotte |
| Projections composées de PeriodProfitCard (106) | Trompeuses |
| Benchmarks multiples de ProfitBenchmarkChart (67) | Bruit ; « vs BTC » éventuel en v2 si ajouté au contrat |
| 18 cartes de survol de la FleetTable (5) | Tout passe par le ScopePanel au clic ou au tap |

### 4.3 Placement par page

| Composant | Flotte | Bot | Graphiques | Journal | Outils/Réglages |
|---|---|---|---|---|---|
| KpiStrip | bandeau | en-tête, ScopePanel | | totaux | |
| FleetScope | oui | | | filtres (même modèle) | |
| FleetTable / FleetMap | oui | | | | |
| ScopePanel | feuille | | | | |
| TradeTable | `open` | `bot`, `closed` | | `journal` | |
| TradeDrawer | feuille | docké / feuille | feuille | feuille (fermé) | |
| PairNavigator | | oui | oui | | |
| CandleChart | | oui | oui | | |
| EquityCurve, Leaderboard, PnlCalendar | onglets | onglet Performance | | | |
| DistributionChart, DcaDepthTable, ExitReasonTable | | | | oui | |
| RiskPanel | oui | | | | Risque avancé |
| AlertRail, SinceLastVisit, EventFeed | oui (mobile : en tête) | alertes du bot | | | |
| LogStream | tiroir | onglet | | | page |
| SystemHealth | barre d'état | barre d'état | barre d'état | barre d'état | Diagnostic |
| ConfirmDangerDialog, HoldButton | oui | oui | oui (palette) | | oui |

## 5. Composants partagés (bibliothèque à construire en premier)

Ordre de construction : jetons et thème, puis primitives (5.1), puis composites (5.2), puis pages. Chaque composant a
une story (Histoire ou page de démonstration) en sombre, clair, 390 et 1440 px, FR et EN. Les maquettes en sont la
référence visuelle : `mockups/_src/base.css` (jetons et styles) et `mockups/_src/core.js` (comportements).

### 5.1 Primitives

| Composant | Props principales | Événements, slots | Pages |
|---|---|---|---|
| `Btn` | `variant: secondary\|ghost\|primary\|danger-outline\|danger`, `size: xs\|sm\|md\|lg`, `icon?`, `busy?`, `disabled?`, `lockKey?` | `click` ; slot libellé | toutes |
| `IconBtn` | `icon`, `label` (aria et info-bulle), `shortcut?`, `size` | `click` | toutes |
| `HoldButton` | `label` (« Maintenir pour … en réel »), `durationMs` (fixe 1000), `tone: danger\|go`, `disabled`, `lockKey` | `complete`, `tooShort` (affiche l'aide) | dialogues |
| `SegmentedControl` | `options`, `modelValue`, `size` | `update:modelValue` | toutes |
| `FilterChip` | `label`, `count?`, `active`, `removable`, `icon?` | `toggle`, `remove` | Flotte, Journal, Graphiques |
| `Switch`, `TextInput`, `SearchField` | `modelValue`, `label`, `placeholder` | `update:modelValue` | Réglages, barres |
| `Badge` | `kind: live\|dry\|replay\|xyz\|orphan\|crit\|warn\|info\|neutral\|manual`, `label` | | toutes |
| `ModeMark` | `mode: live\|dry\|replay`, `full: boolean` (badge complet seulement en en-tête, tiroir, dialogue) | | toutes |
| `StatusDot` | `state: online\|starting\|offline\|stopped\|auth_expired\|stale` | | toutes |
| `DirectionChip` | `side: long\|short\|both`, `leverage?` (vert/rouge + flèche + lettre L/S) | | tables, tiroirs |
| `AgeBadge` | `asOfMs`, `staleAfterMs`, `clockSkewMs` | | tables, KPI |
| `ExcludedCount` | `bots: BotRef[]` | ouvre un popover listant les exclus | KPI, Σ, ScopePanel |
| `PnlValue` | `value`, `decimals`, `unit?`, `tween?`, `flash?`, `muted?` (périmé), `unknown?` | | toutes |
| `Meter` | `value`, `max`, `threshold?`, `tone: neutral\|ok\|warn\|crit\|info` | | tables, KPI |
| `SplitBar` | `long`, `short` | | KPI, RiskPanel |
| `DcaPips` | `filled`, `max` (dernier renfort ambre dès 4) | | tables |
| `DcaLadderH` | `position` (normalisée : gauche = liquidation, droite = TP) | | cartes mobiles, ScopePanel, Graphiques |
| `DcaLadderV` | `position`, `orders` (anti-chevauchement des étiquettes, 15 px) | | TradeDrawer |
| `Sparkline` | `values`, `width`, `height` (SVG pur) | | FleetTable, ScopePanel |
| `KpiTile` / `KpiStrip` | `label`, `value`, `sub?`, `meter?`, `alert?`, `onClick?` | | Flotte, Bot, Journal, ScopePanel |
| `Pane` (WidgetShell) | `title`, `icon`, `meta?`, `freshness?`, `state: ready\|loading\|empty\|error\|stale\|unavailable`, `unavailableReason?` | slots `tools`, `default` ; garde les dernières valeurs marquées périmées en erreur | toutes |
| `Tabs` | `tabs: {id,label,count?,tone?}[]`, `modelValue` | `update:modelValue` | toutes |
| `DataTable` | `columns: ColumnDef[]` (id, rendu, alignement, `hideBelow` en px de conteneur), `rows`, `rowKey`, `sort`, `virtual` (> 100 lignes), `sticky` (en-tête, Σ, jour), `rowClass` | `rowActivate`, `sort` | toutes les tables |
| `AdaptiveSheet` | `open`, `side: right` (desktop, 480 px), feuille basse sous 600 px, `title` | `close` (Échap, scrim, croix ; jamais par glisser sur une action) | ScopePanel, TradeDrawer, Santé, Indicateurs |
| `Popover` / `Menu` | `anchor`, `items` (séparateurs, items danger isolés) | `select` | toutes |
| `Toaster` / `ActionToast` | `kind: sent\|ok\|verify\|err`, `title`, `body`, `meta`, `actions` | | toutes |
| `Banner` | `kind: cache\|connecting\|degraded\|direct\|offline\|auth\|starting\|stopped`, `action?` | | coquille, Bot |
| `ConnectionPill` | `kind: gateway\|direct`, `state: connecting\|live\|degraded\|offline`, `latencyMs`, `resyncing` | `click` (détails) | coquille |
| `StatusBar` | `health`, `logsErrorCount`, `density` | ouvre SystemHealth, LogStream | coquille desktop |
| `TabBar` | `items` (4 pages + Plus) | | coquille mobile |
| `EmptyState` | `icon`, `title`, `hint` | | toutes |
| `Skeleton` | `shape: line\|kpi\|row` | | premier rendu sans cache |
| `BaseChart` | `option`, `theme` (dérivé des jetons), `replaceMerge` par `id`, `renderer` | `ready` ; ré-instancié au changement de thème | Flotte, Bot, Graphiques, Journal |
| `FormRow` | `label`, `hint`, slot contrôle | | Réglages |

### 5.2 Composites

| Composant | Props principales | Pages |
|---|---|---|
| `AppShell` | `page`, slots `banner`, `strip`, `scope` | toutes |
| `FleetScope` | `mode: live\|dry\|all` (défaut live), `query`, `groups`, `tags`, `attentionOnly`, `workspace` | Flotte, Journal (même modèle) |
| `FleetTable` | `rows: BotRow[]`, `groups`, `sort: attention\|latent\|name`, `freezeOnHover` | Flotte |
| `FleetMap` | `rows`, `groups`, `sort` | Flotte (défaut mobile) |
| `ScopePanel` | `scope: bot:<key>\|group:<id>\|fleet` | Flotte |
| `BotHeader` | `bot`, `kpis`, `actions` | Bot |
| `BotActionBar` / `BotActionMenu` | `botKey`, `context: row\|header\|drawer\|palette` | Flotte, Bot, palette |
| `TradeTable` | `preset: open\|bot\|closed\|journal`, `filters`, `cursor?`, `cardsBelow: 560` | Flotte, Bot, Journal |
| `PositionCard` | `position` (registre m1 à m4 + `DcaLadderH`) | téléphone, ScopePanel, Graphiques |
| `TradeDrawer` | `botKey`, `tradeId`, `docked` | Flotte, Bot, Graphiques |
| `ClosedTradeSheet` | `botKey`, `tradeId` (MAE/MFE, raison, sortie humaine) | Journal |
| `EquityCurve` | `scope`, `period`, `definition: realized\|with_open` | Flotte, Bot (Performance) |
| `Leaderboard` | `scope`, `period` (barres centrées sur zéro) | Flotte, ScopePanel |
| `PnlCalendar` | `scope`, `month`, `tz` | Flotte |
| `DistributionChart`, `DcaDepthTable`, `ExitReasonTable` | `query` (filtres du Journal) | Journal |
| `RiskPanel` | `scope`, `detail: boolean` | Flotte, Outils |
| `AlertRail` | `tab: active\|acked\|silenced\|events`, `limit?` (mobile 4) | Flotte, Bot (alertes du bot) |
| `AlertItem` | `alert` (modèle § 13.3), `actions` | AlertRail, ScopePanel |
| `SinceLastVisit` | `since` (repère par appareil) | AlertRail (Événements) |
| `EventFeed` / `EventRow` | `kinds`, `bot?` | AlertRail, Bot |
| `LogStream` | `mode: compact\|page`, `bot?`, `level` | barre d'état, Bot, Outils |
| `SystemHealth` | `detail: boolean` | barre d'état, Outils |
| `PairNavigator` | `botKey?`, `filter: positions\|signals\|locks\|all` | Bot, Graphiques |
| `CandleChart` | `botKey`, `pair`, `tf`, `overlays` (Moy., TP, SO, fills, liquidation) | Bot, Graphiques |
| `ConfirmDangerDialog` | `action`, `target {botKey, name, mode, tradeId?}`, `level`, `quantity?`, `orderType?`, `estimates[]`, `warnings[]` | partout |
| `CommandPalette` | `sources`, `actions` (toujours vers la confirmation) | global |
| `BotRegistry` | `bots`, `discovered`, `migration` | Réglages |
| `ReconciliationTable` | `wallet`, `rows` | Outils |

### 5.3 Composables

| Composable | Rôle |
|---|---|
| `useDataSource()` | `GatewaySource` ou `DirectSource` (contrat 03 § 9.1), état de connexion, décalage d'horloge |
| `useFreshness(group)` | âge, `stale`, exclusion des sommes, libellé « il y a N » |
| `useScope()` | FleetScope partagé, persistant entre pages |
| `useBotAction(botKey)` | clé d'idempotence, verrou en vol par `bot:action:trade`, confirmation, résultat en deux temps, aucun rejeu |
| `useNumberTween()` | interpolation 420 ms, flash, coupés en mouvement réduit |
| `useShortcuts()` | registre unique des raccourcis et de la palette |
| `useColumns(preset)` | registre de colonnes, visibilité par largeur de conteneur, ordre importé des anciennes clés |

## 6. Jetons de design

### 6.1 Couleurs (contrastes mesurés sur `--bg-1`)

| Jeton | Sombre | Ratio | Clair | Ratio | Usage |
|---|---|---|---|---|---|
| `--bg` | `#0a0c0f` | | `#f3f5f8` | | fond |
| `--bg-1` | `#0f1216` | | `#ffffff` | | panneau |
| `--bg-2` | `#151a1f` | | `#f6f8fa` | | en-tête, survol, tuile |
| `--bg-3` | `#1c2228` | | `#eaeef3` | | contrôle actif, rail de jauge |
| `--line` / `--line-2` | `#1f262d` / `#2a333c` | | `#e2e7ed` / `#cfd6de` | | filets, bordures |
| `--fg` | `#e3e8ee` | 15,2 | `#0f1720` | 18,1 | texte |
| `--fg-2` | `#a3adb9` | 8,3 | `#3f4a57` | 9,0 | secondaire |
| `--fg-3` | `#8590a0` | 5,8 | `#5c6876` | 5,7 | libellés (AA corrigé : 4,13 avant) |
| `--fg-4` | `#5b6571` | 3,2 | `#8a95a2` | 3,0 | désactivé uniquement |
| `--accent` | `#5b95ff` | 6,4 | `#1d5bd8` | 5,9 | focus, sélection, lien, moyenne d'entrée |
| `--profit` | `#2fca88` | 8,9 | `#047a4b` | 5,4 | gain (texte) |
| `--loss` | `#ff6b80` | 6,9 | `#c8233c` | 5,6 | perte (texte) |
| `--crit` | `#ff6a3d` | 6,6 | `#c2410c` | 5,2 | alerte critique, liquidation proche (distinct de `--loss`) |
| `--warn` | `#f2b33d` | 10,1 | `#8f5a0b` | 5,8 | vigilance, périmé, dernier renfort (corrigé : 3,64 avant) |
| `--info` | `#4cbbe9` | 8,6 | `#0a6e9e` | 5,6 | information, démarrage, xyz |
| `--live` | `#b98aff` | 7,3 | `#6d28d9` | 7,1 | **argent réel uniquement** |
| `--dry` | `#8e9aa8` | 6,6 | `#566476` | 6,0 | dry-run (contour pointillé) |
| `--long` | `var(--profit)` | | `var(--profit)` | | sens long : vert (décision du propriétaire, 2026-10-15) |
| `--short` | `var(--loss)` | | `var(--loss)` | | sens short : rouge, hachuré dans les barres |

Règles :
- Chaque couleur sémantique a une variante `-w` (13 à 14 % en sombre, 9 à 11 % en clair) pour les fonds.
- **Violet exclusif** : seulement le live. Dans les tables et les tuiles, un liseré ou un point ; le badge complet
  « LIVE » seulement dans les en-têtes, tiroirs et confirmations.
- **Long/short** : vert et rouge classiques (décision du propriétaire, les teintes acier/sable ont été refusées), toujours accompagnés de la flèche et de la lettre L/S pour ne pas être confondus avec un P&L.
- **P&L** : couleur de texte uniquement, jamais en remplissage de tuile ; signe `+` ou `−` (U+2212) toujours affiché.
- **Critique** (`--crit`, vermillon) n'est pas une perte (`--loss`, rose) : une alerte et un P&L négatif ne se confondent pas.
- Hachures : `--stale-hatch` (ambre, périmé), `--off-hatch` (gris, hors ligne), `--live-hatch` (bande du dialogue live).
- **Palette daltonien** (option) : gain bleu, perte orange ; signe et valeur restent écrits partout.
- Couleur stable par bot pour les graphiques multi-séries : hash de `bot_key` vers 12 teintes à luminance égale, jamais
  vert, rouge, vermillon ou violet purs.

### 6.2 Typographie

- **Inter** pour l'interface (`cv11`, `ss01`), **JetBrains Mono** pour tout chiffre (`tabular-nums`, `slashed-zero`).
  Les chiffres ne bougent jamais quand ils changent. ECharts : repli `ui-monospace, monospace` si la police n'est pas
  chargée.
- Capitales espacées réservées aux **en-têtes de colonnes**. Les libellés de KPI sont en casse de phrase.
- Tailles minimales : 11 px (`--t-xs`) pour tout texte, badges, échelle DCA, compteur de notification et axes ECharts
  compris ; seuls les `kbd` du bureau descendent à 10,5 px. 12 px pour un chiffre de table sur desktop, 13 px en tactile.
- Sous-lignes et libellés de KPI : une ligne, coupée par des points de suspension, jamais par-dessus la cellule voisine.

| Rôle | Desktop | Tactile (< 600 px ou `pointer: coarse`) |
|---|---|---|
| `2xl` P&L du TradeDrawer | 26 | 28 |
| `xl` valeur KPI | 20 | 22 |
| `lg` titres, KPI secondaires | 15 | 16 |
| `md` texte d'interface | 13 | 14 |
| `sm` cellules de table, boutons | 12 | 13 |
| `xs` sous-lignes, libellés, en-têtes de colonnes | 11 | 12 |

Formatage FR : espace fine insécable pour les milliers et avant `%`, virgule décimale, vrai signe moins, prix à 1 à
6 décimales selon l'ordre de grandeur, P&L et % à 2 décimales, durées « 23 h 04 », « 2 j 4 h », « 42 min ». EN : virgule
des milliers, point décimal, même signe moins.

### 6.3 Espacement, rayons, élévation

- Échelle de 4 px : 2, 4, 6, 8, 12, 16, 20, 24, 32. Gouttière 6 px (desktop), 8 px (tactile). Padding de panneau 12 px.
- Rayons : 3 (puces, badges), 5 (boutons, champs, panneaux), 8 (dialogues, palette), 14 (haut des feuilles basses).
- Élévation : niveau 0 = filet ; niveau 1 = `--shadow-float` réservé à la palette, aux feuilles, dialogues, menus et
  toasts. `backdrop-filter` uniquement sur la barre d'onglets mobile.

### 6.4 Densité

| Mode | Ligne | Contrôle | Activation |
|---|---|---|---|
| Compacte | 30 px | 28 px | défaut desktop |
| Confort | 36 px | 32 px | barre d'état ou Réglages |
| Tactile | 44 px | 40 px (zone d'appui 44 px et plus) ; segments, onglets et boutons d'icône à 44 px réels | automatique sous 600 px ou `pointer: coarse` |

### 6.5 Points de rupture et grille

| Nom | Largeur | Grille |
|---|---|---|
| `xs` | < 600 | 1 colonne, panneaux bord à bord, cartes, barre d'onglets |
| `sm` | 600-1023 | 2 colonnes puis empilement, barre d'onglets, document qui défile |
| `md` | 1024-1439 | zones nommées sur 12 rangées, colonne droite `clamp(360px, 30vw, 430px)` |
| `lg` | 1440-1799 | idem, plus de colonnes visibles |
| `xl` | ≥ 1800 | 3e colonne permanente pour « À traiter » (Flotte) |

Les grilles de page sont des `grid-template` à 12 rangées fractionnaires ; les redimensionnements stockent des fractions.
Les tables utilisent des **container queries** (seuils au § 3.1) : un panneau redimensionné reste lisible.

### 6.6 Thème

`data-theme="dark|light"` sur `<html>`, option Système (`prefers-color-scheme`). Les jetons alimentent le preset PrimeVue
en mode unstyled (pass-through) et le thème ECharts enregistré par `BaseChart`. Les alias `--sd-*` restent le temps de
migrer StrategyDev ; la classe `ft-dark-theme` est maintenue pour les composants hérités pendant la migration.

## 7. Icônes

Lucide via `unplugin-icons` (`@iconify-json/lucide`), trait 1,75, tailles 13 (tables), 15 (défaut), 18 (états vides),
20 (barre mobile). Une icône ne remplace jamais le libellé d'une action argent réel. Les boutons icône seuls ont
`aria-label` et info-bulle avec raccourci. Pas d'emoji dans l'interface (les emojis de groupes existants restent des
données utilisateur).

| Sens | Icône |
|---|---|
| Flotte, Bot, Graphiques, Journal, Outils, Réglages | `layout-grid`, `bot`, `chart-candlestick`, `book-open-text`, `wrench`, `settings` |
| Pause des entrées, reprendre, recharger, arrêter | `pause`, `play`, `refresh-cw`, `square` |
| Sortir, renforcer, entrée forcée | `log-out`, `plus`, `log-in` |
| Critique, vigilance, info | `octagon-alert`, `triangle-alert`, `info` |
| Hors ligne, session expirée, démarrage | `plug-zap`, `key-round`, `loader` |
| Acquitter, silence | `check`, `bell-off` |
| Logs, santé, À traiter | `terminal`, `activity`, `siren` |
| Réconciliation, base du bot | `git-compare-arrows`, `database` |
| Mode direct, hors ligne réseau, cache | `cable`, `wifi-off`, `history` |
| Long, short | `arrow-up-right`, `arrow-down-right` |
| Échelle DCA, positions | `layers` |
| Maintien | `hand` |

## 8. Boutons et contrôles

| Taille | Desktop | Tactile | Usage |
|---|---|---|---|
| `xs` | 24 | 36 (+ zone 44) | actions de ligne, en-têtes de panneau |
| `sm` | 26 | 36 (+ zone 44) | barres d'outils, filtres |
| `md` | 28 | 40 | défaut |
| `lg` | 38 | 48 à 52 | dialogues, pied du TradeDrawer ; en colonne sur téléphone, les deux boutons du dialogue font 52 px (`flex: none`, sinon la base 0 écrase la hauteur) |
| segment, onglet | 22 à 24 | 44 | périodes, filtres, onglets de panneau |
| bouton d'icône (`ibtn`) | 32 | 44 x 44 | barre du haut, bot précédent et suivant |
| tuile d'action | | 64 | page Bot sur téléphone |

- Variantes : secondaire (défaut), fantôme, primaire (une par zone, neutre : `--fg` sur `--bg`), contour danger, danger
  plein. **Le rouge plein n'existe que dans le remplissage du HoldButton du dialogue.**
- Une seule action de danger visible par ligne, en variante neutre, et seulement au survol ou au focus (toujours visible
  en tactile). « Supprimer de la base » est toujours séparé spatialement de « Sortir » (section repliée, filet).
- États : survol, appui (`translateY(1px)`), focus (anneau accent 2 px), occupé (`aria-busy`, spinner, clic ignoré),
  désactivé (info-bulle qui dit pourquoi : hors ligne, session expirée, connexion en cours).
- Rangées défilantes (barres d'outils, puces, onglets, segments) : dégradé de 40 px sur le bord qui cache du contenu,
  posé selon la position de défilement. Sous 600 px, les sous-titres de panneau sont masqués.
- `SegmentedControl` pour périodes, modes et définitions ; `FilterChip` pointillée, pleine quand active ; switch pour
  les booléens de Réglages.

## 9. Mouvement

| Jeton | Durée | Courbe | Usage |
|---|---|---|---|
| `--d-instant` | 80 ms | `--e-out` | survol, appui, lignes |
| `--d-fast` | 140 ms | `--e-out` | onglets, bascules, popovers |
| `--d-base` | 200 ms | `--e-out`, `--e-spring` (dialogue) | palette, toasts, dialogue, alertes |
| `--d-slow` | 320 ms | `--e-out` | feuilles, tiroirs, jauges, prix dans l'échelle DCA |
| `--d-flash` | 900 ms | `--e-out` | flash de valeur |
| `--hold` | 1 000 ms | linéaire | **délai de sécurité, jamais réduit** |

Courbes : `--e-out` `cubic-bezier(.2,.8,.2,1)`, `--e-inout` `(.65,0,.35,1)`, `--e-spring` `(.34,1.4,.64,1)`.

- **S'anime** : compteurs (420 ms, largeur fixe grâce aux chiffres tabulaires) ; flash vert ou rouge et liseré bas d'une
  cellule qui change, **seulement pour les cellules visibles** ; battement unique de la pastille à chaque delta ;
  apparition des alertes en cascade (40 ms) ; sortie d'une alerte acquittée vers la droite ; prix glissant dans les
  échelles DCA ; feuilles et dialogues ; courbe d'équité au premier rendu ; squelettes (shimmer 1,3 s) ; remplissage du
  HoldButton.
- **Ne s'anime jamais** : l'ordre des lignes pendant un tick ; la largeur des colonnes ; les graphiques à chaque delta
  (ajout de point sans transition) ; les fonds en boucle ; ce qui est sous un dialogue ouvert ; une resynchronisation
  (indicateur discret seulement).
- **Mouvement réduit** : durées à 1 ms, compteurs, flashes et cascades coupés, shimmer statique. Le maintien reste à
  1 s.

## 10. États

### 10.1 Données

| État | Rendu | Règle |
|---|---|---|
| Premier rendu | **dernier snapshot en cache (IndexedDB `fqu2-cache`) affiché tout de suite**, bandeau « Données d'il y a N min » | squelettes seulement s'il n'y a aucun cache ; actions désactivées tant que la synchronisation n'est pas faite |
| Chargement d'un panneau | squelettes à la forme du contenu | jamais de spinner plein écran |
| Vide | icône 18 px + phrase utile (« Aucune position ouverte. Le bot attend un signal. ») | |
| Erreur | le panneau garde ses dernières valeurs, marquées périmées, + cause (timeout, 401, 5xx) | pas de panneau blanc |
| Périmé | hachures ambre, âge ambre, valeur en `--fg-3` | exclu des sommes, compteur « N exclus » cliquable ; seuil = 3 fois la cadence du canal (digest 120 s, REST 3 x cadence, WS silencieux 2 min avec positions) |
| Indisponible | « Indisponible en mode direct » + raison | jamais une valeur inventée |
| Inconnu | « inconnu » pour `exit_reason` ou profit nuls | compté à part dans les totaux |
| Dry ensemencé | « depuis le JJ/MM » à côté du nom et dans les KPI | |
| Replay | badge REPLAY ; exclu du Journal par défaut (puce visible) | |

### 10.2 États de bot

| État | Point | Texte | Alerte | Actions |
|---|---|---|---|---|
| `online` | plein `--profit` | uptime | selon règles | toutes |
| `starting` | `--info` pulsé | « démarrage N min » | info, **jamais hors ligne pendant 20 min** | désactivées |
| `offline` | `--crit` | « hors ligne N min », valeurs barrées, « n/d » | critique | désactivées ; jamais « relancer pour fermer » |
| `stopped` | cercle vide | « arrêté, ledger orphelin » | aucune | lecture seule |
| `auth_expired` | carré `--warn` | « session expirée » | vigilance | désactivées ; bouton **Se reconnecter** |
| périmé (donnée) | `--warn` | âge ambre | vigilance (`dataStale`) | selon état du bot |

Badges : LIVE, DRY, REPLAY ; crypto, HIP-3 (`xyz`) ; « depuis le » pour un dry ensemencé.

### 10.3 Connexion

La pastille combine la source (`gateway` ou `direct`) et l'état (`connecting`, `live`, `degraded`, `offline`).

| État | Pastille | Bandeau | Comportement |
|---|---|---|---|
| `connecting` | anneau qui tourne, « Connexion en cours » | « Données d'il y a N min » si cache | actions désactivées |
| `live` (passerelle) | point vert, « Passerelle 38 ms », battement à chaque delta | aucun | resynchronisation : petit anneau dans la pastille, rien d'autre |
| `degraded` | point ambre, « Dégradée » | « Passerelle dégradée : sources en retard ; valeurs concernées marquées périmées » | actions possibles sur les bots frais |
| `offline` | point vermillon, « Hors ligne · figé HH:MM:SS » | « Hors ligne. Valeurs figées à HH:MM:SS, actions argent réel désactivées. Nouvel essai dans N s » | reconnexion 1, 2, 5, 10, 30 s |
| mode direct | carré ambre, « Direct » visible même sur téléphone | « Mode direct : passerelle injoignable… Indisponibles : … Nouvelle sonde dans N s » + Sonder maintenant | sonde de `hello` toutes les 60 s, bascule automatique dans les deux sens, toast unique au changement |

### 10.4 Matrice de disponibilité en mode direct

| Fonction | Passerelle | Mode direct |
|---|---|---|
| FleetTable, FleetMap, KPI | canal `fleet` | polling actuel réduit (sur téléphone : `/fleet/snapshot` d'un bot + bot affiché), agrégats en TS sur les vecteurs partagés |
| Sparkline 24 h, percentiles de durée | oui | indisponible (colonne masquée, mention) |
| Alertes | 24/7, ack et silence partagés | calculées par l'onglet ouvert seulement, mention dans le rail ; pas d'acquittement partagé |
| Depuis votre passage, EventFeed | oui | événements de l'onglet seulement |
| Journal | paginé serveur, totaux filtrés | calculé côté client sur l'historique chargé |
| MAE/MFE | oui | « indisponible » |
| Exports | CSV/XLSX de l'ensemble filtré | CSV de la page affichée |
| Santé | niveau et raisons | budgets par bot lus sur les bots du fork, sinon « indisponible » |
| Bots freqtrade amont (sans endpoints du fork) | | fonctionnent : liste, positions, actions ; colonnes du fork « n/d » |

## 11. Actions argent réel

### 11.1 Règles

- Toute mutation passe par `useBotAction(botKey)` et porte `(botKey, tradeId)` de bout en bout ; plus de « bot actif ».
- Le dialogue affiche toujours le **bloc « Bot ciblé »** (nom, `bot_key`, numéro de trade, badge LIVE ou DRY) en tête.
- La confirmation d'une mutation live **n'est pas désactivable**.
- **Une seule durée de maintien : 1 s**, écrite sur le bouton (« Maintenir pour sortir en réel »), jamais réduite.
- **Pas d'action groupée en v1** : ni « recharger N bots », ni enchaînement espacé, ni compte à rebours.
- Annuler a le focus par défaut. Échap et le scrim annulent. Un clic simple sur le HoldButton affiche « Maintenez le
  bouton 1 seconde pour confirmer (ou Entrée maintenue) ».

### 11.2 Niveaux et liste exhaustive des mutations

| Niveau | Geste | Mutations |
|---|---|---|
| Réduire le risque | confirmation nommée, un clic (« Mettre en pause les entrées ») | `stopbuy` (pause des entrées), acquitter, silence |
| Dry | confirmation nommée, un clic | toute mutation sur un bot dry, sauf `reset_db` |
| Live | maintien 1 s | `forceexit` total ou partiel, `forceentry` (renforcer, entrée forcée), `start` (reprendre), `reload_config`, `blacklist_add`, `blacklist_remove`, `lock_delete`, `cancel_open_order`, `reload_trade`, écriture de config |
| Live destructif | **saisie du nom du bot** (vérifiée par le serveur) + maintien 1 s | `forceexit` tradeid `all` (Tout sortir : **un seul POST**), `stop`, `delete_trade`, `replay` avec `reset_db`, `reconciliation/realign`, `reconciliation/resolve` (saisie du coin) |

### 11.3 Dialogue

Bande hachurée (violette en live, grise en dry), icône, titre, sous-titre (paire, sens, levier, nombre d'entrées, mise),
bloc Bot ciblé, quantité 100, 50, 25 %, Autre (sortie), type d'ordre Marché/Limite, estimations (P&L estimé, prix
indicatif ; pour Tout sortir : P&L latent et notionnel), avertissements contextuels, mention « Envoyé une seule fois,
sans nouvel essai automatique. Journalisé (audit). », champ de saisie du nom (niveau destructif), puis Annuler et le
HoldButton. Sur téléphone : feuille basse, boutons de 52 px, Annuler en bas.

### 11.4 Verrou en vol

Clé `bot_key:action:trade_id`. Au déclenchement : clé d'idempotence (UUID v4), toutes les surfaces portant la même clé
(bouton de ligne, menu, tiroir, palette, en-tête) passent en `aria-busy` ; un second déclenchement affiche « Déjà en
cours ». Le verrou tombe au résultat final ou après `unknown`.

### 11.5 Résultats (microcopie)

| Réponse | Toast | Texte FR |
|---|---|---|
| `accepted` | bleu « Transmis » | « hippo_multi · TAO #1180 : ordre transmis au bot. En attente du fill, la position n'est pas encore fermée. » |
| `exit_fill` ou relecture | vert « Rempli » | quantité, prix, P&L réalisé, latence (« exit_fill reçu en 0,8 s ») |
| `unknown` (timeout 20 s) | ambre « À vérifier » | « Pas de réponse en 20 s. Ni succès ni échec. La passerelle relit l'état et publiera le résultat dans le fil. » + Ouvrir le trade, Voir les logs |
| `rejected` | vermillon « Refusé par le bot » | raison réelle (confirm_trade_exit, minimum notionnel, 429) ; « Rien n'a été exécuté sur l'exchange. » |
| `409 state_mismatch` | vermillon « Rien n'a été envoyé : l'état a changé » | « … a changé depuis l'affichage (déjà fermé ou modifié). Les données ont été relues. » + Revoir le trade |
| `409 in_progress` | ambre « Déjà en cours » | « Une action identique est déjà en vol (autre appareil ou autre onglet). Attendez son résultat dans le fil. » |
| `401` | vermillon « Session expirée, rien n'a été exécuté » | « Aucun rejeu automatique. » + **Réessayer** (rouvre la confirmation) |

La ligne concernée garde l'état occupé jusqu'au résultat. Objectif : fill visible en moins de 1 s.

### 11.6 Avertissements contextuels

Paire nettée avec d'autres bots sur le wallet partagé (« seule la quantité de ce trade est réduite ») ; montant sous
10 USDC de notionnel (formulaire bloquant) ; `stop` sur un bot lancé par `launch_bot.sh` (« un /stop par l'API le relance
automatiquement ; arrêt réel par sa session screen ») ; Tout sortir sans pause préalable ; Recharger (« espacez de
10 min ; initialisation jusqu'à 20 min ») ; Supprimer de la base (« ne ferme pas la position : elle deviendra
orpheline ») ; levier comme propriété par coin du wallet (Renforcer).

### 11.7 Positions orphelines et bloquées

Ligne dédiée (fond `--crit-w`, badge ORPHELINE, « aucun bot (wallet) »), alerte « Position orpheline » avec action
« Réconcilier (aperçu) » vers Outils > Réconciliation filtré sur la paire. Jamais de bouton Sortir sur une position sans
bot propriétaire. L'orpheline n'entre dans aucune somme de bot ; elle apparaît à part dans le RiskPanel.

### 11.8 Audit

Chaque mutation : heure, bot, mode, action, paramètres nettoyés, appareil, résultat, latence. Visible dans Réglages >
À propos et audit, et dans l'EventFeed (« vous, téléphone »).

## 12. Honnêteté des chiffres

- **Live seul par défaut** pour les KPI et la ligne Σ ; le dry n'est jamais additionné au live (périmètre Tout : deux
  valeurs côte à côte).
- **Équité** : deux définitions nommées, « réalisée » et « avec latent » (open-inclusive). **Drawdown** : « réalisé » et
  « avec latent ». Toujours l'**absolu en USDC avant le %**.
- **Capital** = `available_capital - capital_withdrawal` (registre), jamais `balance.total` d'un wallet partagé.
- **Exposition** calculée au niveau du wallet (netting), jamais sommée par bot.
- **Fraîcheur** : âge = heure serveur (`freshness.as_of_ms`) corrigée du décalage d'horloge (`hb`). Valeur `stale` ni
  affichée comme actuelle ni sommée ; « N exclus » ouvre la liste des bots exclus (et la carte applique les hachures).
- `exit_reason` ou profit nuls : « inconnu ». Dry ensemencé : « depuis le JJ/MM ». Replay : exclu par défaut du Journal.
- La pire moins-value du Journal est en absolu (le % confond risque et profit).

## 13. Contrat de données

### 13.1 Widgets et sources (tableau 6.4 de 03)

| Widget | Premier affichage | Abonnement | Note |
|---|---|---|---|
| KpiStrip Flotte, FleetTable, FleetMap | snapshot `fleet` | `fleet` | totaux par scope calculés serveur, `freshness` par groupe |
| ScopePanel | `GET /scope/{scope}` | `bot:<key>` si bot | |
| TradeTable `open`, RiskPanel, PositionCard | snapshot `positions`, `/risk` | `positions` | coalescence 1/s par position |
| AlertRail, SinceLastVisit, EventFeed, cloche | snapshot `alerts`, `/events?since=` | `alerts`, `events` | ack, silence : `POST /alerts/*` |
| EquityCurve | `/equity?def=`, `/drawdown?def=` | `events` (invalidation) | |
| Leaderboard, PnlCalendar | `/leaderboard`, `/pnl/periods?tz=` | | |
| SystemHealth, barre d'état | snapshot `health` | `health` | `/health/rate?bot=` pour un bot |
| LogStream | `/logs` | `logs:errors`, `logs:<key>` | |
| BotHeader, onglets Bot | `/scope/bot:<key>`, `/trades?bots=` | `bot:<key>`, `logs:<key>` | |
| TradeDrawer | `/trades/{key}/{id}` | `positions` | |
| PairNavigator | `/pairs/{key}` | `bot:<key>` | signaux à la demande |
| CandleChart | proxy `pair_candles`, `plot_config` | `chart:<key>:<pair>:<tf>` | |
| Journal | `/trades` (curseur, totaux filtrés), `/trades/export.csv` | `events` | |
| Registre, Passerelle | `/bots`, `/bots/discovered`, `/hello` | | |
| Actions | `POST /bots/{key}/actions/{action}` | `events` (`exit_fill`) | |

### 13.2 Ajouts demandés au contrat passerelle (v1)

| Donnée | Pour | Endpoint ou canal proposé |
|---|---|---|
| Série latent 24 h par bot (24 points) | Sparkline FleetTable, ScopePanel | champ `spark24h` de `BotRow` (canal `fleet`, rafraîchi 5 min) |
| Percentile de durée par position | colonne Durée | déjà dans `Position` (`percentile`), à confirmer |
| MAE/MFE par trade fermé | Journal | champs `mae`, `mfe` de `TradeRow` (calcul sur `pair_candles` en cache, à la fermeture) |
| « Depuis votre passage » | AlertRail | `GET /digest?since=` (agrégat d'événements, repère par appareil) |
| Raisons du niveau de santé | barre d'état | déjà dans `Health` (raisons), lien vers `alert.id` |
| Marqueur de sortie humaine | Journal | `TradeRow.manual` depuis l'audit (`force_exit` émis par l'UI) |

### 13.3 Modèle d'alerte (03 § 7.1)

`{id, type_id, bot_key|null (wallet), subject (pair|trade_id|null), severity, value, threshold, since_ms, last_seen_ms,
state, acked_by_session?, silenced_until?}`, dédoublonnage `(type_id, bot_key, subject)`. Ré-alerte quand la valeur
franchit un cran de sévérité après acquittement.

### 13.4 Reporté en v2

Comparaison « vs BTC » ; vue Graphiques à 4 cellules ; actions groupées (job serveur échelonné) ; historique de logs au
delà du tampon ; notifications push (HTTPS requis) ; timeline 429 de flotte (n'existe pas).

## 14. Budget de rendu et performance

- **ECharts** : au plus 3 instances par page (Flotte 1, Bot 1, Journal 1, Graphiques 1 à 2, au plus 3 cellules).
  Sparklines, jauges, pips, échelles DCA, classement, calendrier et RiskPanel en SVG ou DOM.
- Deltas WebSocket appliqués par lot à chaque `requestAnimationFrame` ; flashes et compteurs seulement sur les cellules
  visibles (IntersectionObserver).
- Virtualisation au-delà de 100 lignes (Journal, positions) ; FleetTable non virtualisée (50 lignes au plus).
- Un seul popover monté à la fois ; aucun popover par ligne.
- Pas de `backdrop-filter` hors barre d'onglets mobile ; pas d'animation en boucle hors indicateurs d'état.
- Objectifs (03 § 12) : données à l'écran en moins de 1 s sur desktop, moins de 2,5 s en 4G (cache affiché
  immédiatement) ; bundle critique sous 180 Ko compressé (Monaco, xlsx, ECharts lourds en chargement paresseux).

## 15. Disposition par défaut, personnalisation, persistance

- **Espaces de travail** : Surveillance (défaut, § 3.1), Incident (À traiter et logs en grand, FleetTable filtrée « En
  alerte », positions en perte en tête), Analyse (équité et classement en grand). `Alt 1/2/3` ou segment du périmètre.
- **Personnaliser** : poignées entre panneaux (fractions mémorisées), remplacer un panneau par un panneau compatible de
  la même zone, masquer. Pas de glisser-déposer libre : la mise en page ne casse jamais, y compris sur téléphone.
- **Colonnes** : éditeur par preset de TradeTable et pour FleetTable ; les anciennes clés `enhanced*TradeColumns*` sont
  importées (ids inconnus ignorés).
- **Persistance** : nouvelles clés préfixées **`fqu2.`** (`fqu2.settings` versionné `{v:1}`, `fqu2.gateway`,
  `fqu2.migration`), IndexedDB `fqu2-cache` (snapshot). Préférences indexées par **`bot_key`** côté passerelle (identiques
  sur téléphone et ordinateur si validé) ; les ids `ftbot.N` restent des alias par appareil, jamais renumérotés.
- **Migration automatique** (03 § 9.2) : lecture seule de `ftAuthLoginInfo`, `ftSelectedBot`, `ftBotNames`,
  `ftBotComparison`, `ftUISettings`, `ftUIColorSettings`, `ft_locale`, colonnes, `ftPlotConfig` ; anciennes clés intactes
  (retour à l'ancienne UI possible) ; rejouée seulement si le hash d'une clé source change ; confirmation de forceexit
  forcée à vrai pour les bots live ; `es/de/it/pt` vers `en`. `ftLayoutSettings` ignoré. Export v3 incluant `fqu2.*`,
  lecture v1 et v2 conservée.

## 16. Microcopie FR et EN

- FR par défaut pour le propriétaire, EN complet ; aucune chaîne en dur ; contrôle CI qui refuse le tiret cadratin et
  les clés manquantes ; rendu testé à 390, 768, 1440 et 1920 px dans les deux langues (les libellés EN sont en moyenne
  10 % plus courts, les en-têtes FR denses ont été dimensionnés pour tenir).
- Ton : factuel, court, chiffré. Un fait, un chiffre, une action. Verbes à l'infinitif sur les boutons (« Sortir »,
  « Mettre en pause les entrées »). Les actions argent réel nomment le geste (« Maintenir pour sortir en réel »).
- Ponctuation : pas de tiret cadratin ; deux-points et virgules ; tiret demi-cadratin seulement pour les plages
  (« 24–40 bots »). Espace insécable avant `:`, `%`, `?`, `!` en FR.
- Le bot cible est toujours nommé ; jamais « ce bot » seul.
- Termes conservés tels quels car usuels en français du trading : Backtest, P&L, DCA, ROI, MAE, MFE, Long, Short, Live,
  Dry. Traduits : Labo de stratégie (Strategy Dev), Flux de logs (LogStream, nom de composant seulement), Taux de
  réussite (winrate), Facteur de profit (profit factor). Raisons de sortie freqtrade : libellé FR, valeur brute en
  infobulle.

| FR | EN |
|---|---|
| Flotte, Bot, Graphiques, Journal, Outils, Réglages | Fleet, Bot, Charts, Journal, Tools, Settings |
| À traiter | Needs attention |
| Actives, Acquittées, Silencieuses, Événements | Active, Acknowledged, Silenced, Events |
| Depuis votre passage · Marquer vu | Since your last visit · Mark as seen |
| Rien à signaler | All clear |
| Équité avec latent · Équité réalisée | Equity incl. open · Realized equity |
| Drawdown avec latent | Drawdown incl. open |
| P&L latent · Réalisé jour | Open P&L · Realized today |
| N exclus | N excluded |
| Périmé · Hors ligne · Démarrage · Arrêté · Session expirée | Stale · Offline · Starting · Stopped · Session expired |
| Se reconnecter | Reconnect |
| Pause entrées · Reprendre les entrées · Recharger | Pause entries · Resume entries · Reload |
| Sortir au marché… · Renforcer… · Tout sortir… | Exit at market… · Add to position… · Exit all… |
| Maintenir pour sortir en réel | Hold to exit with real money |
| Bot ciblé | Target bot |
| Envoyé une seule fois, sans nouvel essai automatique. Journalisé. | Sent once, never retried automatically. Logged. |
| Transmis · Rempli · À vérifier · Refusé par le bot | Sent · Filled · Needs checking · Rejected by bot |
| Données d'il y a N min | Data from N min ago |
| Mode direct · Passerelle · Dégradée · Connexion en cours | Direct mode · Gateway · Degraded · Connecting |
| Valeurs figées à HH:MM:SS | Values frozen at HH:MM:SS |
| Indisponible en mode direct | Unavailable in direct mode |
| Position orpheline · Réconcilier (aperçu) | Orphan position · Reconcile (preview) |
| Sans replay | Excluding replay |
| inconnu · depuis le JJ/MM · manuel | unknown · since MM/DD · manual |

## 17. Accessibilité

- Contrastes AA mesurés (§ 6.1) dans les deux thèmes ; `--fg-4` réservé aux éléments désactivés.
- Rien n'est porté par la couleur seule : signe, flèche, lettre, icône, hachure ou texte d'état accompagnent toujours.
- Cibles tactiles de 44 x 44 px minimum, en taille réelle et pas seulement en zone d'appui pour les segments, onglets,
  acquitter, silence, bot précédent et suivant, logo ; boutons `xs` et `sm` à 36 px plus zone d'appui de 44 px.
- Rôles : `alertdialog` pour les confirmations, `status` et `aria-live="polite"` pour la pastille et les toasts,
  `alert` pour les erreurs, `aria-busy` pour le verrou, `aria-sort` sur les en-têtes, `role="switch"`.
- Focus visible partout (anneau accent), ordre de tabulation logique, piège de focus dans dialogues et feuilles,
  restitution du focus à la fermeture. HoldButton utilisable au clavier (Entrée ou Espace maintenus).
- `prefers-reduced-motion` respecté (§ 9) ; `prefers-color-scheme` via le thème Système.

## 18. Traçabilité des corrections exigées par les jurys

| Exigence | Traitement | Où |
|---|---|---|
| Connexion à 4 états + bandeau mode direct, sonde 60 s, bascule auto, resync discrète | § 10.3 | toutes les maquettes, menu Démo, `?conn=` |
| Premier rendu depuis le cache, « données d'il y a N min » | § 10.1 | `dashboard.html?cache=1`, `?conn=connecting` |
| États de bot online, starting, offline, stopped, auth_expired ; Se reconnecter ; pas d'alerte pendant l'init | § 10.2 | FleetTable, carte, `bot.html?state=` |
| Résultats accepted, unknown, 409 x 2, 401 sans rejeu, confirmation par exit_fill | § 11.5 | menu Démo, Réglages > Sécurité |
| Totaux live seuls, dry jamais sommé, deux définitions, absolu avant %, capital sans balance.total | § 12, § 3.1 | KPI, Σ, Équité |
| Périmé jamais sommé, « N exclus » cliquable, même traitement sur la carte | § 10.1, § 3.1 | KPI, Σ, FleetMap |
| Aucune action groupée en v1 | § 11.1, § 2.6 | palette |
| Une seule durée de maintien (1 s), non réduite en mouvement réduit, écrite sur le bouton, aide au clic simple, Annuler focalisé | § 11.1, § 9 | dialogue |
| Pause entrées : confirmation nommée sans saisie ni maintien | § 11.2 | ScopePanel, Bot |
| Saisie du nom pour Tout sortir, Stop, Suppression en live | § 11.2 | `bot.html#exitall` |
| Pas de colonne de boutons rouges ; danger neutre au survol ; Supprimer séparé | § 3.1, § 3.2, § 8 | Flotte, Bot |
| Orphelines : ligne, alerte, réconciliation, jamais de forceexit | § 11.7 | Flotte, Outils |
| 429 : backoff par bot (proxy), budget agrégé, alerte de répétition, pas de timeline de flotte | § 3.2, § 10.4 | barre d'état, feuille Santé, Outils |
| Dry ensemencé, inconnu, replay exclu par défaut | § 10.1 | FleetTable, Journal |
| Clés `fqu2.`, `bot_key`, alias `ftbot.N`, anciennes clés intactes | § 15 | Réglages > Bots |
| Matrice du mode direct, bots amont | § 10.4 | `?conn=direct` |
| Ticker désactivé par défaut, drawdown dans le bandeau | § 3.1 | KPI |
| Maquettes Graphiques, Réglages, incident mobile | § 3.3, § 3.6, § 2.5 | `charts.html`, `tools.html`, `mobile.html` |
| Long/short hors vert et rouge | § 6.1 | partout |
| Marqueur LIVE : liseré ou point en liste, badge en en-tête | § 6.1 | partout |
| Noms de bots jamais tronqués | § 3.1 | FleetTable (196 px mini), tuiles sur 2 lignes |
| Contrastes AA corrigés | § 6.1 | jetons |
| Tailles minimales 11/12/13 px, capitales limitées aux en-têtes | § 6.2 | jetons |
| Cibles 44 px | § 8, § 17 | CSS tactile |
| Barre mobile avec les 4 pages | § 2.5 | toutes |
| Aucun débordement à 390 px | vérifié par script | captures `shots/*-390.png` |
| Alertes critiques jamais en carrousel | § 2.5, § 3.1 | À traiter |
| `--crit` distinct de `--loss` | § 6.1 | jetons |
| Fraîcheur depuis `as_of_ms` corrigée du décalage | § 12 | AgeBadge |
| Tout sortir = un seul POST `all` | § 11.2 | dialogue « Un seul ordre forceexit all » |
| Pas de notifications navigateur ni Telegram promises en HTTP | § 3.6 | Réglages > Alertes |
| Budget de rendu chiffré | § 14 | maquettes : 1 instance par page (2 au plus sur Graphiques) |
| Contrat de données par widget, ajouts et reports | § 13 | |
| i18n FR/EN, pas de chaîne en dur, tests de largeur | § 16 | |

## 19. Décisions du propriétaire (2026-10-15)

Design validé tel quel. Arbitrages :
1. Maintien de **1 s** pour toute sortie live : validé.
2. Fuseau du P&L quotidien : **Europe/Paris** par défaut, UTC en option.
3. Préférences **synchronisées** entre appareils via la passerelle (indexées par `bot_key`).
4. Ajouts au contrat passerelle du § 13.2 : inclus en v1.
5. Long/short : **vert et rouge** (acier et sable refusés), toujours avec flèche et lettre.
6. Densité compacte par défaut sur desktop, espaces de travail à zones, graphiques limités à 2 cellules en v1 : retenus.
7. Passerelle : identifiants lus dans les configs des bots (liste blanche de champs, jamais les clés exchange) ; port 9399
   en HTTP avec authentification obligatoire, CORS limité à l'origine de l'UI, limitation des tentatives de connexion ;
   TLS plus tard.

## 20. Maquettes et captures

| Fichier | Contenu | Démonstrations |
|---|---|---|
| `mockups/index.html` | galerie, bascule de thème, jetons | liens vers chaque état |
| `mockups/dashboard.html` | Flotte | `?view=map`, `?scope=all`, `?calm=1`, `?conn=connecting\|degraded\|offline\|direct`, `?cache=1`, `?skeleton=1`, `&hold=1` (fige l'état), `#scope`, `#trade`, `#confirm`, `#palette`, `#logs`, `?theme=light`, `?cvd=1` |
| `mockups/bot.html` | Bot | `?bot=<nom>`, `?state=auth_expired\|starting\|offline\|stopped`, `#trade`, `#confirm`, `#exitall` |
| `mockups/journal.html` | Journal | `#dca`, `?conn=direct` |
| `mockups/charts.html` | Graphiques | `?pair=`, `Alt 1/2` |
| `mockups/tools.html` | Outils et Réglages | `#reconciliation`, `#reglages`, `#securite` |
| `mockups/mobile.html` | vitrine de 6 écrans 390 x 844, cadres mis à l'échelle de la largeur (jamais plus larges que l'écran) | capture : `waitUntil: load` et fenêtre haute (1280 x 1700), car `networkidle` n'arrive jamais et Chromium ne peint pas les iframes hors fenêtre en pleine page |

Menu « Démo » de la barre d'état (desktop) ou « Plus » (téléphone) : états de connexion et résultat de la prochaine
action. Toutes les données sont fictives et déterministes.

Sources : `mockups/_src/base.css` (jetons et composants), `mockups/_src/core.js` (données, coquille, confirmation,
toasts, connexion), `mockups/_src/pages/*.html`. Reconstruction : `python3 mockups/_src/build.py` (injecte la feuille
et le noyau dans chaque page et refuse le tiret cadratin). Captures : `mockups/shots/` (390 x 844 pleine page et
fenêtre, 1440 x 900, états).
