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
| `GET/PUT/DELETE /prefs?scope=` | Préférences synchronisées entre appareils (256 Ko au plus), version par `ETag` et `If-Match` (409 `state_mismatch` en cas de conflit). Le premier bootstrap peut les amorcer ; les suivants ne les écrasent jamais. |
| `GET /alerts`, `POST /alerts/{id}/ack`, `POST /alerts/silence`, `DELETE /alerts/silence/{id}`, `GET/PUT /alerts/rules` | Alertes actives, acquittement, silences (une fin est obligatoire), règles. |
| `POST /bots`, `PATCH /bots/{clé}`, `DELETE /bots/{clé}`, `POST /bots/{clé}/credentials` | Le registre est la découverte de l'hôte : répondent 501. |

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
