# Passerelle FreqUI : référence de l'API `/gw/v1`

Référence de ce qui est livré par le lot `fg-server` et la CLI `frequi-gateway`. La conception reste
dans `03-gateway-architecture.md` (sections 3, 6 et 8) ; ce document décrit le comportement réel, tel
que les tests le vérifient (`gateway/tools/fakebot/tests/gateway_*.rs`).

## 1. Lancer et configurer

| Commande | Effet |
|---|---|
| `frequi-gateway run [--config F] [--secrets F]` | Sonde les bots, sert `/gw/v1` en HTTP et WebSocket (défaut `0.0.0.0:9399`). Arrêt propre sur SIGINT/SIGTERM : les WebSocket se ferment avec le code 1001. |
| `frequi-gateway check-config` | Lit la configuration, liste chaque problème et ce qu'il implique ; ne démarre rien. |
| `frequi-gateway print-default-config` | Affiche la configuration par défaut, commentée. |
| `frequi-gateway hash-password` | Lit un mot de passe (deux fois sur un terminal, une ligne sur un tube) et affiche son empreinte Argon2id pour `auth.password_hash` de `secrets.toml`. |
| `frequi-gateway doctor [--deep]` | Contrôle de l'hôte en lecture seule (existant). |

Sections de la configuration : `general`, `server`, `auth`, `discovery`, `ftcache`, `hyperliquid`,
`scheduler`, `market`, `alerts`, `storage`, `log`. Une clé inconnue est refusée. Le hash du mot de
passe n'est accepté que depuis `secrets.toml` ou l'environnement.

Fils d'exécution : `scheduler.worker_threads` vaut 0 (automatique : le nombre de processeurs, entre 2
et 3) ou une valeur de 2 à 4 ; la réserve de fils bloquants (lectures SQLite, balayage `/proc`) vaut
`scheduler.ledger_threads + 2`. Chaque fil qui alloue garde un tas à lui dans l'allocateur : 16 fils
bloquants au lieu de 4 coûtent environ 14 Mo résidents.

Mémoire : au démarrage de `run`, le binaire se relance sur place (même pid, mêmes descripteurs) avec
`MIMALLOC_PURGE_DELAY=0`, faute de quoi mimalloc garde engagées les pages libérées par les rafales de
lecture (30 à 50 Mo résidents de plus mesurés). Une valeur explicite de cette variable est respectée ;
`FG_NO_REEXEC=1` supprime la relance.

## 2. Authentification

Deux niveaux distincts : la passerelle parle aux bots avec les identifiants de sa configuration ; le
navigateur parle à la passerelle avec un jeton de session `fgs_...` (seule l'empreinte est stockée,
durée de vie glissante de 30 jours par défaut).

| Route | Corps | Rôle |
|---|---|---|
| `POST /session/bootstrap` | `{device_id, bots: [{ui_id, botName, apiUrl, accessToken}], prefs?}` | Échange silencieux : la passerelle demande au bot (`GET /api/v1/version` avec le jeton) de confirmer le jeton. La cible vient de la découverte (boucle locale et port), jamais de l'URL du client. Les bots prouvés forment le périmètre de la session. |
| `POST /session/login` | `{mode: "bot_credentials" or "password", username?, password, device_id}` | Repli quand le navigateur n'a aucun jeton valide. |
| `GET /hello` | | Service, version, protocole, modes d'accès actifs, période des `hb`. Sans donnée de flotte. |
| `DELETE /session`, `GET /sessions`, `DELETE /sessions/{id}` | | Fin de session, liste, révocation (la socket du révoqué se ferme en 4401). |

Les deux premières routes sont limitées (par adresse, globalement, avec verrouillage après échecs :
réponse 429 et `Retry-After`). Toute autre route exige `Authorization: Bearer fgs_...` (le schéma est
insensible à la casse) ; sinon 401 avec `WWW-Authenticate: Bearer`. Un chemin inconnu répond 401 à un
inconnu et 404 à une session.

Périmètre : un groupe de confiance est `hash(empreinte utilisateur : empreinte jwt)`. Une session
partielle ne voit que ses bots (403 sur les autres, y compris dans `?bots=`) et ne peut pas lire vers
les vues qui couvrent toute la flotte.

## 3. Origine et CORS

Liste exacte `server.cors_origins` (schéma, hôte, port ; pas de joker, pas de mode credentials). Une
requête portant un `Origin` hors liste reçoit 403 `origin_not_allowed`, y compris sur une écriture
avec session valide. Sans `Origin` (curl, script) la requête passe : elle exige tout de même une
session. Le WebSocket vérifie l'origine dans le gestionnaire et ferme en 4403.

Déploiement : la passerelle et l'interface se déploient ensemble. Deux champs ont changé de sens
sans version de protocole (la version de `/hello` n'est lue par aucun client) : `rate_budget_pct` est la
part **utilisée** du budget (et non la part disponible) et `Position.dca_entries` compte les ordres
d'entrée remplis, le premier compris (et non les renforts). Une interface d'avant ces changements face à
la passerelle courante, ou l'inverse, affiche une jauge inversée et une entrée de moins ou de plus. Les
routes qui changent de réponse doivent, comme `missing=204`, être demandées explicitement.

## 4. Routes de lecture

Toutes sous `/gw/v1`, sauf mention, avec session.

| Route | Contenu |
|---|---|
| `GET /snapshot?ch=fleet,positions,alerts,health,events` | État des canaux avec leur numéro de séquence (`X-Gw-Seq: fleet=12,...`) et un `ETag` stable (`If-None-Match` donne 304). Compressé si demandé. |
| `GET /bots`, `GET /bots/discovered` | Bots de la session avec alias de l'appareil ; bots découverts sur l'hôte. |
| `GET /scope/{scope}` | `live`, `dry`, `replay`, `fleet`, `bot:<clé>` ou `group:<id>` (groupe défini dans les préférences). Les chiffres ne mélangent jamais live, dry et replay : un groupe de modes mixtes est refusé (400). |
| `GET /trades` | Journal paginé par curseur (`status`, `bots`, `group`, `pair`, `side`, `exit_reason`, `mode`, `from`, `to`, `sort`, `order`, `cursor`, `limit`) ; `status=open` renvoie les positions. |
| `GET /trades/{clé}/{id}` | Détail d'un trade avec ses ordres (lus dans le registre du bot à la demande). |
| `GET /trades/export.csv` | Export CSV ; les cellules texte commençant par `=`, `+`, `-`, `@`, tabulation ou retour chariot sont préfixées d'une apostrophe. |
| `GET /pnl/periods`, `/equity`, `/drawdown`, `/leaderboard`, `/risk` | Calendrier (fuseau Europe/Paris), courbes, drawdown réalisé et avec latent, classement, exposition. `scope=` ou `bots=`. |
| `GET /health`, `/health/rate`, `/logs`, `/events`, `/pairs/{clé}`, `/market`, `/audit` | Santé, débit vers un bot, journaux, événements, paires d'un bot, marché, journal d'audit des écritures. `/pairs`, `/logs?bot=` et `/scope/bot:...` fonctionnent aussi pour un bot dont personne n'observe le canal (le détail est construit à la demande). |
| `GET /candles?pair=&tf=&end=&limit=` | Bougies OHLCV historiques d'une paire, lues dans des fichiers feather de l'hôte, **sans aucun appel à l'exchange** (voir ci-dessous). |
| `GET/PUT/DELETE /prefs?scope=` | Préférences synchronisées entre appareils (256 Ko au plus), version par `ETag` et `If-Match` (409 `state_mismatch` en cas de conflit). `scope=` (vide) est le document global, `scope=<bot_key>` celui d'un bot, sans `scope` le `GET` liste tous les documents. Un document jamais écrit répond `204` si la requête porte `missing=204` (le `404` s'afficherait en erreur à chaque chargement) et `404` sinon : un client qui ignore l'option prendrait le `204` pour un document. Le premier bootstrap peut les amorcer ; les suivants ne les écrasent jamais. |
| `GET /alerts`, `POST /alerts/{id}/ack`, `POST /alerts/silence`, `DELETE /alerts/silence/{id}`, `GET/PUT /alerts/rules` | Alertes actives, acquittement, silences (une fin est obligatoire), règles. |
| `POST /bots`, `PATCH /bots/{clé}`, `DELETE /bots/{clé}`, `POST /bots/{clé}/credentials` | Le registre est la découverte de l'hôte : répondent 501. |

### 4.1 `GET /candles`

Sert au graphique d'une paire : remonter avant la fenêtre que le bot garde en mémoire (`/pair_candles`) et
afficher un timeframe que la stratégie du bot ne tourne pas. Lecture seule, session requise comme les autres
routes ; les bougies sont des données de marché, pas des données d'un bot : aucune portée de session ne s'y applique.

Paramètres : `pair` (obligatoire, `BTC/USDC:USDC`, uniquement `[A-Za-z0-9_/:.-]`, 64 caractères au plus, ni `..`
ni début par `.` ou `/`), `tf` (obligatoire : `1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w`), `end` (optionnel,
horodatage en ms, **exclusif** : seules les bougies qui ouvrent avant ; absent = les plus récentes), `limit`
(défaut 1000, ramené dans [1, 5000]). Un paramètre absent ou illisible répond 400 `bad_request`.

```json
{ "pair": "BTC/USDC:USDC", "tf": "15m",
  "candles": [[ts_ms, open, high, low, close, volume], ...],
  "has_more": true, "first_available_ms": 1738946700000, "resampled_from": null }
```

`candles` est trié par ouverture croissante, au plus `limit` éléments, les plus proches de `end`. `has_more` dit
qu'il existe des bougies plus anciennes que la première renvoyée : la page suivante se demande avec
`end = candles[0][0]`. `first_available_ms` est l'ouverture de la plus ancienne bougie connue (`null` sans
donnée). Une paire ou un timeframe sans donnée répond 200 avec `candles` vide.

Sources (répertoires configurables, `[candles]` de la config, motif de nom par répertoire ; par défaut les deux
ci-dessous, la config de production n'a rien à changer) :

1. le cache du démon ftcache, `~/.freqtrade/ftcache/hyperliquid/futures/{paire}-{tf}.feather` : les 5000 bougies
   les plus récentes, à jour ;
2. l'historique long de freqtrade, `~/freqtrade/user_data/data/hyperliquid/futures/{paire}-{tf}-futures.feather`,
   rafraîchi de temps en temps.

`{paire}` est la paire avec `/` et `:` remplacés par `_`. Les deux sources sont fusionnées par horodatage ; en
cas de doublon, la première (ftcache) l'emporte. Les lignes sans date, datées hors de 2000-2100 (les fichiers
hebdomadaires de ftcache en contiennent : lignes à 0 et 1, dates divisées par un million) ou dont un prix n'est pas
un nombre sont écartées.

Un timeframe sans fichier est reconstruit depuis le plus fin des timeframes disponibles qui le divise exactement
(`6h` depuis `1h` ou `2h`, `1w` depuis `1d`), sauf si un timeframe plus gros remonte plus loin d'au moins une tranche
dans le passé (les fichiers des timeframes fins sont souvent les plus courts : l'historique prime). `resampled_from`
nomme la base ; sinon `null`. Les tranches sont
alignées sur l'époque UTC (la semaine s'ouvre donc le jeudi, comme celle de l'exchange). La plus ancienne tranche
est omise quand les données commencent en son milieu (elle serait partielle) ; la plus récente, encore en
formation, est gardée comme une bougie native. `1m` et `3m` n'ont pas de timeframe plus fin : vides sans fichier.

Mémoire : les fichiers décodés sont gardés dans un cache LRU borné (`cache_series`, 24 par défaut, et
`cache_max_rows`, 400 000 bougies soit environ 19 Mo), clé = chemin, date de modification et taille, relu dès que
le fichier change. Un seul décodage à la fois, hors des threads async. Un fichier illisible (tronqué, autre schéma)
est ignoré et journalisé.

## 5. WebSocket `/gw/v1/ws`

Une seule connexion multiplexée. Première trame dans les 5 s : `{"t":"auth","token","device_id"}`
(le jeton ne passe jamais dans l'URL) ; réponse `authed`. Puis :

* `{"t":"sub","ch":[...],"resume":{canal: dernier_seq}}` : réponse `subscribed` (têtes de séquence),
  puis, par canal, les trames manquées dans l'ordre, ou `resync` (`stale_resume` si la reprise est trop
  ancienne, d'une autre incarnation de la passerelle ou en avance ; `overflow` si le client est trop
  lent ; `gap` après un trou).
* `{"t":"unsub","ch":[...]}`, `{"t":"ping","ts"}` (réponse `hb`).
* Serveur : `up` (`upsert` par collection et clé, `remove`), `ev` (événement immuable), `hb`, `err`.
  Un canal inconnu répond `err unknown_channel`, une trame illisible `err bad_request` (la socket reste
  ouverte).

Une clé qui disparaît d'un groupe objet (un coin qui sort de `net_exposure`, un groupe de `freshness`)
ne peut pas se dire par un patch fusionné. Le serveur envoie alors, dans la même transaction, une trame
qui remet le groupe à `null` puis la trame qui le republie en entier ; le client applique les deux dans
le même lot. Le hub TypeScript du mode direct fait de même (vecteur partagé `protocol.diff`).

### 5.1 Canal `chart:<clé>:<paire>:<timeframe>`

Bougies d'un graphique ouvert. Une bougie qui forme se corrige à chaque lecture, d'où un canal d'état
(collections clés/valeurs) comme les autres, et non un flux d'événements.

* **Relais par lecture, pas par WebSocket du bot.** Un bot ne pousse `new_candle` et `analyzed_df` qu'à un
  client qui s'y abonne, et ces messages portent un dataframe par paire (lourd). Le relais fait ce que la
  page ferait seule, une fois pour tous : tant qu'au moins un client tient le canal, il lit
  `GET /pair_candles?pair=&timeframe=&limit=150` du bot par le passthrough, une fois toutes les
  `timeframe / 12` (entre 5 et 60 s), chaque lecture coûtant un jeton du budget global de requêtes. Un
  seul lecteur par graphique quel que soit le nombre de clients ; il s'arrête 30 s après le dernier
  départ. Au plus 16 graphiques distincts à la fois (503 `unavailable` au-delà) et 8 par connexion
  WebSocket (erreur `bad_request`, « too many charts ») ; un bot hors ligne, arrêté ou à jeton expiré
  n'est pas interrogé. Le relais a une part réservée de 0,3 req/s pour tous les graphiques ensemble
  (B106) : ses lectures font la queue entre elles puis se paient sans attendre derrière le polling de la
  flotte, qui ne peut donc pas être affamé ; au-delà de la part (par exemple 16 graphiques en 1 min), un
  graphique est lu moins souvent et sa fraîcheur (`meta.freshness.stale`) suit la cadence réelle.
* **Contenu.** Seules les colonnes OHLCV des 150 dernières bougies voyagent (les colonnes d'indicateurs
  restent côté bot ; l'historique et les indicateurs viennent de `proxy/pair_candles` et `proxy/pair_history`,
  mis en cache). Collection `candles`, clé = heure d'ouverture en ms : `{t, o, h, l, c, v}` ; collection
  `chart`, clé `meta` : `{pair, timeframe, timeframe_ms, candles, freshness}`.
* **Fraîcheur.** Si le bot ne peut plus être lu, les dernières bougies restent et
  `meta.freshness.stale` passe à `true` (plus de 3 périodes sans lecture réussie) : un graphique figé
  n'est jamais présenté comme vivant.
* **Snapshot.** `GET /snapshot?ch=chart:...` rend l'état du relais, vide tant que personne n'a rejoint le
  canal (aucune lecture n'est lancée par un GET). Le flux normal est : snapshot HTTP de `proxy/pair_candles`
  pour l'historique, souscription WS, puis fusion des trames `up` du canal.
* **Erreurs.** Paire ou timeframe mal formés : `bad_request` ; bot inconnu : `not_found` ; bot hors du
  périmètre de la session : `forbidden` ; trop de graphiques ouverts : `unavailable`.

Codes de fermeture : 4401 session invalide ou révoquée, 4403 origine refusée, 4429 trop de
connexions ou client trop lent, 1001 arrêt de la passerelle. Un client qui applique les trames `up`
(fusion superficielle par groupe de champs) obtient le même état qu'un client qui charge le snapshot,
aux champs de fraîcheur près (non poussés seuls).

## 6. Écritures

`POST /bots/{clé}/actions/{action}` avec l'en-tête `Idempotency-Key` obligatoire.

* Actions typées : `start`, `stop`, `pause`, `stopentry` (alias `stopbuy`), `reload_config`,
  `forceexit`, `forceentry` (alias `forceenter`), `delete_trade`, `cancel_open_order`; relayées vers
  l'API Python avec la même discipline : `reload_trade`, `blacklist_add`, `blacklist_remove`,
  `lock_delete`. Les paramètres inconnus sont refusés, une action inconnue répond 404. Pour un trade, le corps porte
  `expected: {pair, is_short}` : le moteur le compare à l'état courant, ce qui empêche un formulaire
  resté sur le mauvais bot d'agir.
* `stop` (tout bot) et `delete_trade` (bot live) demandent le nom du bot retapé dans `confirm`.
* Rejeu : la même clé ne frappe jamais deux fois ; la réponse du premier appel est rendue sans
  second appel au bot. Un 401 n'est pas mémorisé. Une seule tentative est faite vers le bot.
* L'entrée d'audit est écrite avant l'envoi ; elle ne contient jamais de jeton.
* Cadence : `auth.actions_per_min` par session. Un bot injoignable est refusé d'avance (502
  `bot_unreachable`), rien n'est envoyé.

## 7. Passerelle vers l'API Python

`ANY /bots/{clé}/proxy/{*rest}` : liste blanche (`passthrough.rs`).

| Classe | Exemples | Traitement |
|---|---|---|
| Lecture courte en cache | `pair_candles`, `pair_history`, `plot_config`, `signal_summary`, `volume_history`, `strategies`, `strategy/*`, `rate_metrics` | Cache de 5 à 300 s, comptée dans le budget de requêtes. |
| Lecture longue | `stratdev/*`, `replay`, `backtest`, `download_data`, `pairlists/*`, `fleetview/*` | Délai de 300 s, hors budget pour ne pas affamer les sondes. |
| Calcul par POST | `stratdev/editor/validate`, `stratdev/diff`, `pairlists/evaluate` | Transmis tel quel. |
| Mutation | `stratdev/*`, `replay`, `backtest`, `blacklist`, réconciliation (`resolve`, `realign`) | Clé d'idempotence, audit, une tentative ; les plus dangereuses exigent l'en-tête `X-Confirm-Bot` (nom du bot). |

Tout le reste répond 404. Le chemin est jugé sous sa forme brute : aucun `%`, aucun `.` ni `..`,
que des segments simples. La réconciliation, qui touche l'échange, est mise en cache au niveau du
portefeuille (une requête par portefeuille et par intervalle, quel que soit le demandeur).

## 8. Erreurs et journaux

Corps d'erreur : `{"code","message","retry_after_ms"?}` ; codes : `bad_request`, `unauthorized`,
`forbidden`, `origin_not_allowed`, `not_found`, `rate_limited`, `state_mismatch`, `in_progress`,
`unknown_channel`, `too_many_connections`, `bot_unreachable`, `unavailable`, `internal`.

Les journaux (JSON ou texte) passent par un écrivain qui masque tout ce qui ressemble à un secret :
valeur d'un champ JSON (y compris du JSON cité dans une chaîne) ou d'une paire `clé=valeur` dont la clé
nomme un secret, identifiants `Bearer` et `Basic`, jetons JWT, jetons `fgs_`, empreintes Argon2. Les
lignes d'accès ne portent jamais la chaîne de requête. Un échec d'authentification laisse une ligne
sans secret, de forme stable pour fail2ban (`event=auth_failed ip=... path=...`).

## 9. Santé

`GET /gw/v1/health` : niveau global, bots par état, requêtes accordées/écritures/attente cumulée du
budget, horodatage de génération. C'est la même vue que le canal `health`.

Raisons possibles (`reasons[].code`) : des codes machine stables, le catalogue `HealthReasonCode`
(exporté dans `types.gen.ts` sous `HEALTH_REASON_CODES`). Le texte d'une raison ne fait jamais partie
du contrat : le client traduit le code (un code inconnu est affiché tel quel), et `detail` ne porte que
des valeurs sans langue.

| Code | Sens | `detail` |
|---|---|---|
| `daemon_unreachable` | le démon de cache ne répond pas depuis trois sondages | |
| `digest_stale` | le digest du démon est trop ancien | |
| `rate_backoff` | un limiteur du démon est en backoff après un 429 | |
| `rate_budget_low` | moins de 20 % du budget de l'exchange restent (constat de la flotte, pas un défaut de la passerelle) | le pourcentage restant, sans unité (`20`) |
| `all_bots_offline`, `bots_offline` | tous les bots, ou une partie, hors ligne | `hors ligne/total` (`3/24`) |
| `rate_limit_events` | des bots ont reçu des 429 récemment | le nombre de bots |
| `ledger_unreadable` | des registres illisibles | le nombre et le code d'échec (`11 (timeout 11)`, `db_locked`, `db_corrupt`, `db_missing`, `db_error`) |
| `auth_expired`, `data_stale` | mode direct seulement | les noms des bots |

`rate_budget_pct` est la part du budget **utilisée** (0 à 100, le limiteur le plus chargé) : une valeur
haute est la mauvaise, comme dans le mode direct ; `100 - rate_budget_pct` est ce qui reste.

Un registre qui dépasse son budget de requête (200 ms) obtient un budget multiplié par 4 à chaque
dépassement, jusqu'à 16 fois (3,2 s) ; sans cela une requête trop lente pour l'hôte échouerait à chaque
passe et laisserait les chiffres du bot inconnus pour de bon (un binaire de débogage, dont SQLite n'est
pas optimisé, laissait 11 bots sur 24 en `timeout` : santé `degraded`).
