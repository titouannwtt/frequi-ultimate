# 05 - FreqUI plus calme : inventaire, principes et plan

Statut : proposition à valider par le propriétaire, aucun code modifié. Maquette :
`docs/redesign/mockups/friendly-v1.html` (Flotte, Bot, Graphiques ; bureau et téléphone ; glossaire).
Base : captures du rig e2e (40 faux bots) à 1440, 1920 et 390 px, lecture de `src/components/{ds,fq}` et
`src/views/fq`. Décisions conservées : PrimeVue, long vert / short rouge, FR et EN, Europe/Paris, mode direct sans
passerelle, langage « Terminal » (adouci, pas remplacé). Le `02-design.md` reste la référence ; ce document le
modifie là où il le dit.

## 1. Principes

1. **Une question par page**, et sa réponse en une phrase en tête (verdict). Flotte : « tout va bien ? ». Bot : « dois-je
   intervenir ? ». Graphiques : « que fait le prix autour de mes positions ? ». Journal : « qu'ai-je gagné, et pourquoi ? ».
2. **Quatre chiffres, pas huit.** Le reste s'ouvre d'un clic ; rien qui serve une décision n'est supprimé sans
   nouvelle place.
3. **Le calme se tait** : un panneau, un compteur ou un filtre vide disparaît (alertes à 0, Logs 0, Orphelines 0).
4. **Des mots de trader, pas des noms de variables** (« Renforts 2 sur 4 », « liquidation loin », « plus long que
   d'habitude ») ; le terme technique reste en infobulle et dans l'export.
5. **Un graphique par question**, jamais de sous-graphique sans titre ni phrase d'explication.
6. **Une action principale visible, le reste dans « Plus »**. Les actions argent réel restent confirmées comme
   aujourd'hui (dialogue, maintien) ; seule leur place change.
7. **Des valeurs par défaut suffisantes** (Live, 7 j, 15 min, tri par attention) et mémorisées.
8. **Terminal adouci** : mêmes jetons de couleur ; ligne 38 px au lieu de 30, texte courant 14 px, cartes rayon 10 px,
   en-têtes de colonnes en casse normale, moins de filets.

## 2. Inventaire

Légende : **G** garder, **S** simplifier, **P** derrière « Plus » (menu, repli, réglage), **R** retirer.
Pour chaque P ou R : où l'information reste accessible.

### 2.1 Barre du haut (`AppShell.vue`)

| Élément | Décision | Raison (décision de trader) | Reste accessible |
|---|---|---|---|
| Logo FreqUI | G | repère, retour Flotte | |
| Mention « Ultimate » | R | n'aide aucune décision, prend de la place | À propos (Réglages) |
| Onglets Flotte, Bot, Graphiques, Journal | G | navigation principale | |
| Outils ▾ | G | outils rares, déjà discrets | |
| Palette « Bot, paire, action » Ctrl K | S | libellé plus court, champ plus étroit | |
| Pastille « Passerelle 8 ms » | S | remplacée par un point + « À jour » ; la latence ne décide rien | infobulle et Réglages > Passerelle |
| Cloche | G | point d'entrée des alertes acquittées, silencieuses et des événements | |
| Bascule de thème | P | réglage ponctuel | Réglages > Affichage, raccourci T |
| Engrenage Réglages | G | | |

### 2.2 Barre d'état (`StatusBar.vue`, `AppShell.vue`)

| Élément | Décision | Raison | Reste accessible |
|---|---|---|---|
| « Santé Dégradée / Critique » | S | jargon ; dit « Connexion ralentie : quota Hyperliquid à 82 % » avec la raison, et ne s'affiche que hors état normal | SystemHealth au clic |
| « Logs N » | S | n'apparaît que si N > 0 (« 3 erreurs dans les logs ») | Outils > Logs |
| « Bots live 8/10 · 1 en démarrage » | R | doublon du verdict de la Flotte | verdict Flotte, tableau des bots |
| « Budget HL 82 % » | S | n'apparaît qu'au-delà de 70 %, libellé « Appels Hyperliquid : 82 % du quota » | SystemHealth, Outils > Diagnostic |
| Backoff actif | G | décision réelle (attendre) ; en clair « Hyperliquid limite les appels, reprise dans 40 s » | |
| « Snapshot 3 s » | S | devient « À jour, il y a 3 s » ; passe à l'ambre au-delà de 30 s | |
| « Compacte » (densité) | P | réglage ponctuel | Réglages > Affichage |

### 2.3 Flotte (`FleetPage.vue`)

| Élément | Décision | Raison | Reste accessible |
|---|---|---|---|
| Verdict (nouveau) | ajouter | répond à « tout va bien ? » en une ligne, compte des bots en ligne inclus | |
| KPI Équité avec latent | S | « Capital total », latent en sous-ligne | |
| KPI P&L latent | S | fusionné dans la sous-ligne du capital (« dont +20 en cours ») et colonne « En cours » | tableau des bots |
| KPI Réalisé jour | S | sous-ligne de « Gagné sur 30 jours » | Journal 24 h |
| KPI Réalisé 30 j | G | « Gagné sur 30 jours », réussite en sous-ligne | |
| KPI Drawdown avec latent | G | « Recul depuis le plus haut », USDC puis %, jauge et limite | |
| KPI Exposition long/short | P | utile au risque, pas en tête | carte Risque du wallet |
| KPI Marge utilisée | G | seul indicateur d'approche de liquidation au niveau wallet ; liquidation la plus proche en sous-ligne | |
| KPI Bots en ligne | R | | verdict, tableau des bots |
| Segment Live / Dry / Tout | G | « Dry 30 » porte le compte | |
| « 30 dry masqués » | R | doublon du compte dans le segment | segment Dry |
| Champ « Filtrer bots, paires, tags » | P | rare à 10 bots live | palette Ctrl K, raccourci F |
| Puce « En alerte 0 » | S | n'apparaît que si > 0 | |
| Espace Surveillance / Incident / Analyse | P | choix ponctuel | bouton « Disposition » |
| Rail À traiter (Calme, 4 onglets) | S | au repos : rien ; sinon une carte par alerte active sous le verdict, avec ses actions | Acquittées, Silencieuses, Événements, « Depuis votre passage » dans la cloche |
| Table / Carte | G | carte reste la vue téléphone | |
| Tri Attention d'abord / Latent / Nom | P | en-têtes de colonnes cliquables, défaut conservé | clic sur l'en-tête |
| Ligne Σ « Flotte live, 1 exclu » | R | totaux déjà dans les KPI ; l'exclusion devient la carte d'alerte et le mot « figé » | KPI, alerte |
| Colonnes Bot, Latent, 30 j, sparkline, Slots | S | « En cours », « 30 jours », « 7 jours », « Positions » en pastilles | |
| Colonnes Sens, Jour, Expo, DD/Seuil, Âge | P | rarement décisives ligne à ligne | menu « Colonnes » ; âge affiché quand anormal (« figé ») |
| Badge HIP-3 cyan par ligne | S | gris « actions », « matières » ; le cyan est réservé à l'information | |
| Positions ouvertes, 40 lignes et 11 colonnes | S | « Positions à surveiller » : les 5 pires, faits en mots | « Voir les 40 positions » (table actuelle) |
| Filtres Toutes, En perte, DCA ≥ 3, xyz, Orphelines | P | servent dans la vue complète seulement ; Orphelines n'apparaît que si > 0 | vue complète |
| Équité : courbe + sous-graphe drawdown | S | une courbe, 24 h / 7 j / 30 j | drawdown : KPI Recul et Journal > Analyse |
| Segment Avec latent / Réalisée | P | définition fixe « positions comprises », infobulle | Journal > Analyse |
| Onglets Classement, Calendrier | P | analyse, pas surveillance | Journal > Analyse (Par bot, Calendrier) |
| Risque wallet (8 lignes + tableau coin) | S | un mot (Modéré, Élevé, Critique) et 4 lignes | « Détails » (tableau coin, netting, orphelines) |

### 2.4 Bot (`BotPage.vue`, `BotHeader.vue`, `BotActionBar.vue`, `TradeDrawer*.vue`)

| Élément | Décision | Raison | Reste accessible |
|---|---|---|---|
| ‹ › nom, LIVE, sélecteur | G | | |
| Badge « CRYPTO + XYZ » | S | gris, ou dans la méta | |
| Méta stratégie, exchange, port, uptime, âge | S | « Stratégie · 15 min · depuis 2 j » | port, exchange, âge : menu Plus > Informations |
| Pause entrées | G | action la plus fréquente | |
| Recharger, Config | P | rares | menu Plus ; Config aussi en onglet |
| Tout sortir… (rouge, en tête) | P | anxiogène en permanence, rare ; même confirmation | menu Plus > Actions sensibles (comme sur téléphone) |
| KPI Latent, Jour, 30 j, Capital, Expo, Drawdown (6) | S | 4 : En cours, Gagné 30 j (jour en sous-ligne), Capital (expo en sous-ligne), Recul | |
| Navigateur de paires (Positions, Signaux, Verrous, Toutes) | R | doublon de l'onglet Positions | onglet « Paires et verrous » (signaux, verrous, whitelist) ; « Ouvrir en grand » vers Graphiques |
| Graphique, 8 unités de temps | S | 4 (5 min, 15 min, 1 h, 4 h) ; défaut = timeframe de la stratégie | Graphiques (toutes) |
| Puces Entrée moy., Exécutions, Liquidation | S | niveaux nommés sur l'axe, allumés par défaut | Graphiques > Affichage |
| Onglets Positions, Historique, Performance | G | | |
| Onglets Paires et verrous, Logs, Config | P | moins fréquents | « Plus ▾ » dans la barre d'onglets |
| Colonnes Positions : DCA pips, Dist. liq., P98 | S | « Renforts », « Liquidation loin (47 %) », « long » | infobulle percentile |
| Colonne Entrée moy., Prix, Actions | P | dans le panneau de la position | panneau, Détails |
| Panneau : P&L, durée | G | | |
| 6 faits (Notionnel, Mise, DCA, Vers TP, Vers SO, Vers liq.) | S | 3 phrases : sortie visée, prochain renfort, liquidation, chacune avec sa distance | notionnel, mise : repli « Détails » |
| Échelle DCA verticale | S | barre horizontale « Renforts 1 sur 4 », engagé / maximum | |
| Ordres | P | repli (déjà) | « Détails » |
| Maintenance (base du bot) | G | déjà repliée | |
| Pied : 25 / 50 / 100 %, montant, min. 10 USDC | P | décision prise au moment de sortir | dialogue de confirmation de « Sortir… » |
| Sortir au marché…, Renforcer… | G | libellé « Sortir… » | |

### 2.5 Graphiques (`ChartsPage.vue`, `ChartCell.vue`, `CandleChart.vue`, `IndicatorsSheet.vue`)

| Élément | Décision | Raison | Reste accessible |
|---|---|---|---|
| Paire (palette) + bot de contexte | S | un bouton « OP · calculé par dynv1_short » | |
| Timeframes 1m à 1j (7 à 8) | S | 4 courants + « Autre » | menu Autre |
| 1 cellule / 2 cellules | P | usage rare | Affichage > Deux graphiques côte à côte ; Alt 1/2 |
| HA | P | sigle opaque | Affichage > Bougies lissées (Heikin-Ashi) |
| Mesurer | P | geste, pas un bouton permanent | Affichage > Mesurer (Maj + glisser) |
| Indicateurs, Sous-graphiques N/M | S | un sous-graphique par défaut, titré et expliqué ; « + Ajouter » liste les autres | Affichage > Indicateurs de la stratégie |
| Noms bruts rsi_84, I-vwap_low, C-rsi | S | traduits quand reconnus (RSI 84, VWAP bas…), bruts en infobulle | infobulle |
| Puces Entrée moy., Ordres de sécurité, Exécutions, Liquidation | P | allumées par défaut, étiquetées sur l'axe | Affichage > Niveaux de la position |
| Échelle Y étirée par un niveau lointain | S | l'axe suit les bougies ; niveau hors champ annoncé au bord avec sa distance (constaté : bougies écrasées en bande sur les captures) | annonce au bord |
| Légende OHLC | G | | |
| Lien Position, Page du bot | G | | |
| Liste de paires (Positions, Signaux, Toutes) | S | « Mes positions » d'abord, puis recherche | Signaux : onglet de la liste |

### 2.6 Journal (`JournalPage.vue`, `JournalTotals.vue`, `JournalFilterBar.vue`)

Pas de maquette dédiée (même traitement que la Flotte) ; à maquetter si le principe est validé.

| Élément | Décision | Raison | Reste accessible |
|---|---|---|---|
| 8 totaux | S | 4 : Résultat net, Réussite (G/P), Gain moyen / perte moyenne, Pire trade | « Plus de chiffres » : facteur de profit, espérance, pire moins-value absolue, durée médiane et P90, trades par jour |
| Périodes 24 h à Plage | G | | |
| Live / Dry / Tout, Sans replay | G | | |
| Bots, Sens, Raison, Profondeur DCA | P | un bouton « Filtres (n) » en feuille | feuille Filtres |
| Paire | G | | |
| Vues, Exporter | P | rares | menu ⋯ |
| Colonne Sortie (prix) | P | | tiroir du trade |
| Raison vide (icône ⊘) | S | « inconnue » en texte | |
| Analyse : Distribution, Profondeur DCA, Raisons, Par bot | G | | |
| Calendrier, Classement (depuis la Flotte) | ajouter | leur place logique | |

### 2.7 Téléphone (toutes pages)

| Élément | Décision | Raison | Reste accessible |
|---|---|---|---|
| Bouton « Sortir au marché… » sur chaque carte de position (Flotte, Bot, Graphiques) | R | 7 boutons de sortie argent réel en défilant ; contredit « aucun bouton de sortie par ligne » du 02 | toucher la carte ouvre la feuille avec Sortir |
| 8 KPI en 4 rangées avant tout contenu | S | 4 en 2 × 2 | |
| Rangée de 4 tuiles d'action Bot | S | 2 : Pause des entrées, Plus | menu Plus |
| Méta du bot sur 3 lignes (« 19 s » orphelin) | S | une ligne | menu Plus > Informations |
| Réglages : débordement horizontal à 390 px (scrollWidth 536) | corriger | bug constaté, hors maquette | |

## 3. Plan d'implémentation par lots

Chaque lot est livrable seul, testé sur le rig (`pnpm e2e:rig`) à 1440 et 390 px, FR et EN. Tailles : S < 150 lignes,
M 150 à 400, L > 400. Aucun lot ne touche les confirmations d'action argent réel (ConfirmDangerDialog, HoldButton),
seulement l'endroit d'où on les ouvre.

| Lot | Contenu | Fichiers | Risque | Taille |
|---|---|---|---|---|
| L1 Libellés | glossaire FR et EN (§ 2, maquette), infobulles des termes techniques, « Ultimate » retiré | `src/locales/fr.ts`, `en.ts`, `AppShell.vue` | faible ; e2e qui cherchent des textes à mettre à jour | M |
| L2 Coquille calme | barre d'état conditionnelle (santé en clair, quota > 70 %, logs > 0, « À jour, il y a N s »), pastille réduite à un point, thème et densité vers Réglages | `StatusBar.vue`, `AppShell.vue`, `ConnectionPill.vue`, `DisplaySettings.vue` | faible ; garder les `data-testid` | S |
| L3 Densité adoucie | ligne 38 px, texte 14 px, rayon 10 px des panneaux, en-têtes en casse normale ; en option « Compacte » pour revenir à 30 px | `src/styles/tokens.css`, `Pane.vue`, `DataTable.vue`, `KpiTile.vue` | moyen : débordements à revérifier sur toutes les pages (container queries) | M |
| L4 Flotte | verdict, 4 KPI, alertes en cartes sous le verdict (rail déplacé dans la cloche), tableau 6 colonnes + menu Colonnes, sans ligne Σ, « Positions à surveiller » (5) + vue complète, équité seule, risque résumé, Disposition en menu | `FleetPage.vue`, `FleetKpis.vue`, `FleetTable.vue`, `AlertRail.vue`, `EquityCurve.vue`, `RiskPanel.vue`, `FleetScope.vue`, nouveau `FleetVerdict.vue`, nouveau `WatchList.vue` | moyen : la page la plus testée (`e2e/fleet.spec.ts`), à réécrire en partie | L |
| L5 Bot | en-tête une action + Plus (Tout sortir en Actions sensibles), 4 KPI, sans PairNavigator, onglets 3 + Plus, panneau en phrases, quantité de sortie dans le dialogue | `BotPage.vue`, `BotHeader.vue`, `BotActionBar.vue`, `BotActionMenu.vue`, `TradeDrawerBody.vue`, `TradeDrawerFoot.vue`, `ConfirmDangerDialog.vue` (ajout du choix de quantité seulement) | moyen à élevé : chemins de sortie argent réel, `e2e/actions.spec.ts` et `bot.spec.ts` | L |
| L6 Graphiques | barre réduite + menu Affichage, 4 timeframes + Autre, un sous-graphique titré, « + Ajouter », humaniseur de noms d'indicateurs, axe Y centré sur les bougies avec annonce des niveaux hors champ | `ChartsPage.vue`, `ChartCell.vue`, `CandleChart.vue`, `IndicatorsSheet.vue`, nouveau `src/utils/indicatorLabel.ts` (+ test unitaire) | moyen : **un autre chantier modifie les surimpressions de trades dans les mêmes fichiers**, à faire après sa fusion | M à L |
| L7 Journal | 4 totaux + « Plus de chiffres », bouton Filtres (n), menu ⋯ (Vues, Exporter), Calendrier et Classement dans Analyse | `JournalPage.vue`, `JournalTotals.vue`, `JournalFilterBar.vue`, `PnlCalendar.vue`, `Leaderboard.vue` | faible à moyen (`charts-journal.spec.ts`) | M |
| L8 Téléphone | cartes de position sans bouton de sortie, KPI 2 × 2, 2 tuiles d'action Bot, méta sur une ligne, correctif de débordement de Réglages à 390 px | `PositionCard.vue`, `TradeTable.vue`, `BotPage.vue`, `SettingsPage.vue` | faible ; `touchTargets.spec.ts` | S à M |

Ordre conseillé : L1, L2, L8 (rapides et visibles), puis L4, L5, L3, L7, et L6 après le chantier des surimpressions.
Le mode direct (sans passerelle) n'est concerné que par L2 (la pastille doit continuer d'indiquer « Direct ») et par
le quota Hyperliquid, absent en direct : la ligne ne s'affiche pas.

## 4. Points à valider par le propriétaire

1. « Tout sortir… » quitte l'en-tête du Bot sur bureau pour le menu Plus > Actions sensibles (comme sur téléphone).
2. Le rail « À traiter » disparaît au repos ; les alertes actives deviennent des cartes sous le verdict, le reste va dans la cloche.
3. Libellés en français courant (« Capital total », « En cours », « Recul depuis le plus haut », « Renforts ») à la place
   des termes de trading (équité, latent, drawdown, DCA) ; ceux-ci restent en infobulle.
4. Densité par défaut adoucie (38 px), « Compacte » en option, ou l'inverse.
5. Calendrier et Classement quittent la Flotte pour le Journal.
