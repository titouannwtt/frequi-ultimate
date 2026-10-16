# 03 - Architecture de la passerelle Rust `frequi-gateway`

Statut : proposition d'architecture (aucun code écrit). Branche `redesign/rust-gateway`.
Entrée obligatoire : `docs/redesign/01-current-state.md` (sections 5, 6, 7, clusters C1-C15).
Sources lues : `FT/api_fleetview.py`, `freqtrade/ohlcv_cache/{daemon,client,protocol,healthcheck,defaults}.py`,
`freqtrade/rpc/rpc.py` (`_rpc_fleet_*`), `freqtrade/freqtradebot.py` (`_push_fleet_digest`, `trade_snapshot`),
`FT/web_ui.py`, `src/composables/{loginInfo,api,useAlertDetection}.ts`, `src/stores/{ftbot,ftbotwrapper,botComparison}.ts`.

## 0. Décision en une page

**Problème.** Le navigateur interroge chaque bot (fan-out 10 s / 60 s / 30 s, 40 WebSockets, 11 Mo d'historique en
mémoire) et recalcule tous les agrégats ; chaque onglet ouvert (téléphone + ordinateur) multiplie la charge ; les alertes
ne tournent que si un onglet est ouvert ; les écritures argent réel partent parfois vers le mauvais bot.

**Déjà décidé (non rediscuté).** Passerelle Rust qui interroge chaque bot une seule fois côté serveur, calcule les agrégats
et pousse snapshot + deltas en WebSocket ; mode direct dégradé conservé ; freqtrade non modifié ; SPA toujours servie par
le bot :9400 (même origine, `localStorage` conservé) ; FR + EN ; migration automatique des clés.

**Invariants.**
1. Aucun redémarrage de bot, jamais, pendant tout le déploiement.
2. Aucune charge supplémentaire sur Hyperliquid : régime permanent = zéro appel HL par la passerelle.
3. Lecture seule sur les bases des bots, jamais de verrou tenu, jamais de checkpoint.
4. Aucune écriture rejouée automatiquement ; chaque écriture porte `(bot_key, trade_id)` explicites, une clé d'idempotence
   et laisse une trace d'audit.
5. Chaque chiffre porte son âge ; une donnée périmée n'est ni présentée comme actuelle ni sommée.
6. Aucun secret (token, mot de passe, clé privée) dans les logs, les réponses ou l'audit.

**Recommandation.** Un binaire statique unique, workspace Cargo de 4 crates, état propre dans un SQLite local,
protocole « snapshot HTTP compressé + upserts par clé sur WebSocket avec numéros de séquence », sources dans cet ordre de
préférence : socket ftcache (lecture, liste blanche d'ops) > SQLite des bots (lecture seule) > WebSocket des bots
(événements, `trade_snapshot`) > REST des bots en 127.0.0.1 (cadences lentes) > Hyperliquid (jamais en direct en v1).

**Ce que je conteste dans la demande.**
- « Prouver un JWT et téléverser `ftAuthLoginInfo` » ne suffit pas comme mécanisme principal sur ce serveur : les refresh
  tokens des bots expirent 30 jours après le dernier login et l'UI n'a pas le mot de passe. Sur ce serveur, la passerelle
  lit les identifiants `api_server` dans les configs fusionnées des bots découverts par `/proc` (exactement ce que fait déjà
  `api_fleetview.discover_bots`) : plus jamais d'expiration. La preuve par JWT reste le mécanisme d'ouverture de session
  (zéro action) et le téléversement de tokens ne sert qu'aux bots distants (utilisateurs open-source).
- « JSON-patch-like deltas » : je recommande des upserts par clé d'entité (fusion superficielle) plutôt que du JSON Patch :
  idempotents, rejouables, sans dépendance à l'ordre des index de tableau, triviaux à appliquer dans Pinia.
- « Au plus 1 appel HL /info par 60 s par wallet ET boucler sur tous les dex HIP-3 » est contradictoire dès qu'il existe
  un dex HIP-3 (un `clearinghouseState` par dex). Interprétation retenue : au plus **un balayage** (1 + k appels, k = nombre
  de dex HIP-3) par wallet et par 60 s, et en v1 ce balayage reste fait par l'endpoint Python existant
  `/fleetview/reconciliation` (cache 60 s, équivalence garantie), uniquement quand quelqu'un le regarde, plus un balayage
  de fond toutes les 5 min pour l'alerte de réconciliation.
- Le port Rust de la lecture de réconciliation est repoussé en v2, derrière des tests d'équivalence : une classification
  fausse mène à une suppression de trade (risque 8.1.2 du document 01).

Meilleure alternative écartée : passerelle « proxy cache » minimale qui se contente de mettre en cache les endpoints
Python existants (`/fleet/snapshot`, `/fleetview/*`) et de multiplexer les WebSockets. Coût faible, mais elle laisse le calcul
dans le processus du bot live :9400 (argent réel), ne permet ni journal paginé serveur ni moteur d'alertes, et ne supprime
pas les bugs de définitions. Elle reste le plan B si le calendrier dérape (voir lot B3, mode `compat`).

## 1. Topologie

```
 Téléphone / ordinateur
   |  HTTP :9400 (SPA statique, inchangé)          |  HTTP + WS :9399 (CORS liste blanche)
   v                                                v
 bot hippo_original_multi :9400            frequi-gateway (screen "frequi-gateway")
   ui/installed/ lu à chaque requête          |-- /tmp/ftcache-1001.sock     (ops lecture seule)
                                              |-- /tmp/ftpairlist-1001.sock  (stats)
                                              |-- database/*.sqlite          (mode=ro, WAL)
                                              |-- /proc + live_configs/*.json (découverte, champs en liste blanche)
                                              |-- 127.0.0.1:<port> REST + WS de chaque bot
                                              '-- (v1) /fleetview/reconciliation d'un bot, <= 1 balayage / 60 s / wallet
```

- Port proposé **9399** : libre au 2026-10-15 (`ss -ltn` ne l'affiche pas) et absent de tous les `listen_port` de
  `live_configs/*.json` (8878-9520). `frequi-gateway doctor` revérifie au démarrage et refuse de démarrer si occupé.
- Écoute `0.0.0.0:9399` (le navigateur du téléphone doit l'atteindre) ; à vérifier : pare-feu de l'hôte / OVH (les bots
  sur 0.0.0.0 sont joignables, donc a priori oui).
- Les bots ne voient que des appels en 127.0.0.1 : leur CORS (limité à `http://<hôte>:9400`) n'est pas touché.
- CORS de la passerelle : liste blanche exacte `server.cors_origins = ["http://<hôte>:9400"]`, méthodes
  `GET, POST, PUT, PATCH, DELETE`, en-têtes `Authorization, Content-Type, Idempotency-Key, If-Match, If-None-Match`,
  `Expose-Headers: ETag, X-Gw-Seq`, `Max-Age 600`, **sans** `Allow-Credentials` (auth par bearer, pas de cookie).
  En plus du CORS, toute requête qui modifie un état et toute ouverture WS vérifient l'en-tête `Origin` côté serveur
  (défense en profondeur ; un client non navigateur sans `Origin` reste accepté s'il a une session valide).
- Option open-source : `server.serve_ui_dir` permet à la passerelle de servir elle-même la SPA (un seul port). Désactivée
  sur ce serveur (changer d'origine perdrait `localStorage`).
- Évolution conseillée (question utilisateur) : TLS. Caddy semble déjà présent (127.0.0.1:2019, :80, :443) ; une page
  http peut appeler une passerelle https sans souci de contenu mixte, donc l'origine :9400 reste inchangée.

## 2. Workspace, dépendances, binaire, exploitation

### 2.1 Arborescence

```
gateway/                         workspace Cargo (dans le dépôt frequi, à côté de src/)
  Cargo.toml                     [workspace], profils release (lto="thin", codegen-units=1, panic="abort")
  deny.toml                      cargo-deny : licences, avis de sécurité, doublons
  crates/
    fg-core/                     modèle de domaine + fonctions pures, AUCUNE E/S
      model.rs                   Bot, Position, Trade, Alert, Event, Health, Wallet, Freshness
      calc/                      drawdown (2 définitions nommées), périodes (fuseau), capital, durées, HIP-3, exit_reason
      alerts/                    règles (14 types + nouvelles), machine d'états
      protocol.rs                enveloppes WS, canaux, erreurs
      ts-export                  génération des types TS (ts-rs) -> src/gateway/types.gen.ts
    fg-sources/                  adaptateurs d'entrée
      discovery.rs               scan /proc + fusion add_config_files (champs en liste blanche)
      ftcache.rs                 client socket Unix NDJSON, liste blanche d'ops
      sqlite.rs                  lecteur lecture seule, introspection de schéma, pièges
      botrest.rs                 client REST par bot (auth, refresh, pas de retry en écriture)
      botws.rs                   client WebSocket par bot (abonnements, reconnexion)
      external.rs                CoinGecko (ticker BTC/ETH), jamais HL
    fg-engine/                   état vivant
      store.rs                   arc-swap de l'état, bus de deltas par canal
      scheduler.rs               cadences, jitter, sémaphores, backoff, hors ligne, abonnements
      aggregate.rs               agrégats flotte / groupe / bot
      alert_engine.rs            évaluation, dédup, ack, silence, persistance
      state_db.rs                SQLite propre à la passerelle (registre, sessions, prefs, alertes, audit, événements)
    fg-server/                   axum : auth, REST, WS, proxy, audit, CORS, redaction
  bin/frequi-gateway/            main : run | doctor | check-config | print-default-config | hash-password | version
  tools/fakebot/                 faux bots freqtrade + faux démon ftcache (tests de charge, e2e)
  tests/equivalence/             comparaison lecture seule avec les endpoints Python de ce serveur
  fixtures/vectors/*.json        vecteurs partagés Rust / vitest (mêmes entrées, mêmes sorties attendues)
  packaging/                     frequi-gateway.service, Dockerfile, run-in-screen.sh, install.sh
```

Raison du découpage : `fg-core` sans E/S se teste exhaustivement et sert de spécification exécutable pour les fonctions
pures que le mode direct doit aussi implémenter en TS (mêmes vecteurs). Les quatre crates permettent quatre lots
d'implémentation parallèles avec des interfaces stables.

### 2.2 Dépendances (et pourquoi)

| Crate | Rôle | Justification |
|---|---|---|
| `tokio` (rt-multi-thread, net, time, signal, fs) | Runtime | Standard ; sockets Unix, timers, `spawn_blocking` pour SQLite |
| `axum` 0.8 + `axum::extract::ws` | HTTP + WebSocket serveur | Ergonomique, basé sur tower, WS intégré |
| `tower-http` | CORS, compression gzip/br, timeout, limite de corps, trace | Évite de réécrire ces couches ; compression des snapshots |
| `reqwest` (rustls, json, sans openssl) | Client REST vers les bots et CoinGecko | Pool de connexions keep-alive ; rustls = binaire musl statique sans OpenSSL |
| `tokio-tungstenite` (rustls) | Client WS vers `/api/v1/message/ws` des bots | Même pile que le serveur WS |
| `rusqlite` (feature `bundled`) | Lecture des SQLite des bots + état propre | SQLite compilé statiquement, URI `mode=ro`, contrôle fin des PRAGMA ; `sqlx` est surdimensionné ici |
| `serde`, `serde_json` | Sérialisation | Standard |
| `figment` (toml + env) | Config fichier + surcharges d'environnement | Fusion déclarative TOML puis `FG_*` |
| `tracing`, `tracing-subscriber` (json) | Logs structurés | Champs typés, filtre de redaction centralisé |
| `arc-swap` | Instantanés de l'état sans verrou | Lectures concurrentes WS/REST sans contention |
| `governor` | Limitation de débit (login, bootstrap, actions) | Algorithme GCRA éprouvé |
| `argon2` | Hash du mot de passe optionnel de la passerelle | Recommandation OWASP |
| `chacha20poly1305`, `zeroize`, `getrandom`, `blake3` | Chiffrement des refresh tokens stockés, effacement mémoire, jetons de session, hash des jetons | Petites crates pures Rust |
| `chrono` (+ `chrono-tz`) | Dates naïves UTC des bases, découpage jour/semaine/mois par fuseau | Gère `Europe/Paris` et les changements d'heure |
| `ts-rs` | Génération des types TypeScript depuis les structs Rust | Contrat unique Rust/TS vérifié en CI |
| `clap` | CLI | Standard |
| `thiserror`, `anyhow` | Erreurs | Standard |
| `mimalloc` | Allocateur | L'allocateur musl est lent sous charge multi-thread |

Exclus volontairement : OpenSSL (casse le statique musl), `arrow`/lecture des feathers (lourd ; le ticker vient de
CoinGecko ou d'un bot), ccxt-like / signature EIP-712 (les écritures exchange restent en Python).

### 2.3 Configuration

Fichier TOML (défaut `~/.config/frequi-gateway/config.toml`, sinon `--config`). Surcharge par variables `FG_` avec `__`
pour l'imbrication (`FG_SERVER__LISTEN=0.0.0.0:9399`). Secrets dans un fichier séparé `secrets.toml` en 0600 (refusé
au démarrage si plus permissif), jamais dans le fichier principal.

```toml
[server]
listen = "0.0.0.0:9399"
cors_origins = ["http://<hôte>:9400"]
serve_ui_dir = ""                 # vide = ne sert pas l'UI

[auth]
modes = ["token_proof", "bot_credentials"]   # + "password" (argon2) pour l'open-source
session_ttl_days = 30             # glissant
login_rate_per_min = 5

[discovery]
proc_scan = true                  # bots locaux (Linux)
read_api_credentials_from_config = true      # ce serveur : identifiants api_server des configs fusionnées
ignore_db_name_tokens = ["backup", "replay", "tmp"]

[ftcache]
socket = "/tmp/ftcache-1001.sock" # défaut : /tmp/ftcache-<uid>.sock
pairlist_socket = "/tmp/ftpairlist-1001.sock"

[hyperliquid]
recon_mode = "proxy_python"       # v2 : "native"
min_sweep_interval_s = 60
sweep_timeout_s = 40              # un balayage sans réponse au bout de ce délai est un échec
background_sweep_interval_s = 300

[scheduler]                       # cadences, voir section 4
[alerts]                          # valeurs par défaut des règles
[storage]
data_dir = "~/.local/share/frequi-gateway"
[log]
level = "info"
format = "json"
```

### 2.4 Binaire, service, Docker

- Cibles : `x86_64-unknown-linux-musl` et `aarch64-unknown-linux-musl`, construites en CI avec `cargo-zigbuild`
  (pas de Docker requis), publiées en assets de release avec `SHA256SUMS`. Taille visée < 15 Mo.
- L'hôte n'a ni `cargo` ni `docker` : installation par téléchargement de l'artefact CI vers `~/.local/bin/frequi-gateway`
  (ou `rustup` en espace utilisateur pour le développement, sans root).
- Ce serveur (GNU screen) : `packaging/run-in-screen.sh` crée la session détachée `frequi-gateway` (idempotent : rien si elle
  existe ; refus avec le code 4 si le port d'écoute est déjà pris ; refus avec le code 3 si `check-config` échoue) et y lance
  la passerelle dans une boucle de relance (5 s après un plantage, pas après une erreur de configuration ni un arrêt propre,
  abandon après 10 échecs rapides) ; arrêt `screen -x frequi-gateway` puis Ctrl+C (même discipline que pour les bots, jamais
  `kill` de l'extérieur).
  Arrêt propre sur SIGINT/SIGTERM : fermeture WS avec code 1001, vidage de l'audit, en moins de 5 s.
- Open-source : unité systemd **utilisateur** `frequi-gateway.service` (`Restart=on-failure`, `NoNewPrivileges=yes`,
  `RestrictSUIDSGID`, `RestrictAddressFamilies`, `LockPersonality` : les filtres seccomp s'appliquent sans privilège). Les
  directives de bac à sable de système de fichiers (`ProtectSystem`, `ReadWritePaths`...) ne sont PAS dans l'unité : un
  gestionnaire utilisateur les ignore en silence sans `PrivateUsers=yes` (mesuré, systemd 247, B110). Avec ce drop-in
  optionnel le système de fichiers devient réellement en lecture seule, et une base WAL sans `-shm` (bot arrêté
  proprement) ne s'ouvre plus en `mode=ro` : il faut alors un chemin inscriptible sur le répertoire des bases (B105, corrigé
  par B110). Piège documenté : **pas de `PrivateTmp`**
  (le socket ftcache est dans `/tmp`) et pas de `ProtectProc=invisible` (scan `/proc`).
- Docker : image `scratch` + binaire statique. Limites documentées : pas de scan `/proc` sans `--pid=host`, montages
  requis (répertoire des bases : la lecture seule suffit tant que le bot tourne, ses fichiers `-wal` et `-shm` existent ; pour un bot arrêté proprement une base WAL sans `-shm` est illisible en lecture seule réelle, B110 ; socket ftcache ; même UID que les bots) ; en pratique le mode Docker = registre + REST.

## 3. Authentification

### 3.1 Deux niveaux distincts

1. **Passerelle -> bots** (identifiants des bots, jamais vus par le navigateur en mode passerelle) :
   - Ce serveur : identifiants `api_server.username/password` lus dans la config fusionnée de chaque bot découvert
     (même méthode que `discover_bots`). La passerelle fait `POST /token/login` (Basic) puis rafraîchit l'accès toutes les
     12 min ; si le refresh échoue, nouveau login Basic. Aucune expiration à 30 jours.
   - Bots distants / open-source : refresh token téléversé par la SPA (bootstrap), stocké chiffré
     (ChaCha20-Poly1305, clé `data_dir/gateway.key` en 0600 ; protection contre une fuite de sauvegarde, pas contre un
     attaquant qui lit le disque de l'hôte). Optionnel : identifiants saisis une fois dans Réglages > Bots, stockés
     chiffrés seulement si l'utilisateur coche « mémoriser ».
   - Parsing des configs : désérialisation dans une struct qui ne contient **que** les champs utiles (port, identifiants
     API, `db_url`, `dry_run`, `bot_name`, `strategy`, `stake_currency`, `available_capital`, `capital_withdrawal`,
     `walletAddress`, `vaultAddress`, `hip3_dexes`, `exchange.name`, `trading_mode`, `max_open_trades`). Les clés privées
     exchange ne sont jamais matérialisées ; le tampon brut du fichier est `zeroize` après parsing.
2. **Navigateur -> passerelle** : session opaque (256 bits aléatoires), stockée côté serveur sous forme de hash blake3,
   TTL glissant 30 jours, révocable (Réglages > Sessions). Envoyée en `Authorization: Bearer` ; pour le WS, dans la
   première trame (`{"t":"auth","token":...}` sous 5 s, sinon fermeture 4401), jamais dans l'URL.

### 3.2 Bootstrap sans action utilisateur

```
SPA (origine :9400)                         Passerelle :9399                       Bot 127.0.0.1:<port>
1. GET /gw/v1/hello (1,5 s max) ---------->  {version, protocol:1, auth_modes}
2. pas de session valide : prend un bot de ftAuthLoginInfo, rafraîchit son accessToken
   directement auprès du bot (flux actuel, CORS :9400 autorisé)
3. POST /gw/v1/session/bootstrap  ------->  pour chaque entrée : apiUrl -> cible locale ?
   {device_id, bots:[{ui_id:"ftbot.3",     GET /api/v1/version (Bearer accessToken) ------>  200 = preuve
     botName, apiUrl, accessToken,
     refreshToken?, sortId, botIcon,
     createdAt}], prefs?}
4.                                   <----  {session, expires_at, bots:[{ui_id, bot_key, scope}]}
```

- Correspondance `apiUrl` -> cible : si l'hôte est `localhost`, `127.0.0.1` ou une IP de l'hôte (liste via les interfaces),
  la cible devient `127.0.0.1:<port>` ; sinon l'URL telle quelle (bot distant).
- **Portée** : la session n'ouvre que les bots dont une preuve a réussi (`scope`). Sur ce serveur, les 24 bots partagent
  les mêmes identifiants : une preuve sur un bot vaut pour tous les bots dont la config porte le même `username` et le même
  `jwt_secret_key` (comparés par hash, jamais exposés) ; pour l'open-source, preuve par bot.
- Le `refreshToken` n'est conservé que si la passerelle n'a pas d'identifiants config pour ce bot.
- Expiration : tant que l'utilisateur ouvre le dashboard au moins une fois par 30 jours, aucune ressaisie (session
  glissante, identifiants bots côté serveur). Si la session et tous les refresh tokens du navigateur ont expiré : écran de
  connexion unique « identifiants API des bots » ; la passerelle les valide par `POST /token/login` sur un bot local
  (mode `bot_credentials`, rien n'est stocké) et, pour le mode direct, la SPA récupère aussi des tokens frais.
- Bot dont l'auth échoue : état `auth_expired` visible (badge dans FleetTable, alerte `authExpiring` 3 jours avant pour
  les refresh tokens téléversés dont l'`exp` JWT est lisible sans secret).

### 3.3 Ne jamais devenir un point de forceexit non authentifié

- Toutes les routes sauf `/gw/v1/hello` et `/gw/v1/session/*` exigent une session ; toute action exige en plus que le bot
  soit dans la portée de la session, un `Idempotency-Key` et un `Origin` autorisé.
- Actions sensibles (exit all, stop, suppression de trade sur bot live) : champ `confirm` égal au nom du bot, vérifié
  côté serveur (la saisie de confirmation n'est pas seulement une case UI).
- Limitation : login et bootstrap 5/min par IP (rafale 5), 30/min global, verrouillage 15 min après 10 échecs ;
  actions 30/min par session ; comparaisons en temps constant ; une ligne de log d'échec sans secret (compatible
  fail2ban).
- Corps de requête limités (64 Ko, sauf passthrough stratdev 2 Mo), timeouts de lecture, nombre max de WS par session (8).

### 3.4 Ne jamais journaliser de token

Couche `tracing` de redaction : en-têtes `Authorization`, paramètres `token=`, tout champ nommé `*token*`, `password`,
`secret`, `private_key`, `privateKey`, `jwt_secret_key`, `ws_token` remplacés par `***`. Les URL WS des bots
(`?token=`) ne sont journalisées que par leur chemin. Le panic hook n'imprime aucun contenu de requête. Test automatique :
lancer la passerelle avec des secrets factices connus, exercer tous les chemins, vérifier que les chaînes n'apparaissent ni
dans les logs, ni dans l'audit, ni dans `state.db` en clair.

## 4. Registre, découverte, ordonnanceur

### 4.1 Identité des bots

- `bot_key` canonique : `local:<port>` pour un bot local, `url:<origine normalisée>` pour un distant. Les ids `ftbot.N` du
  navigateur sont des **alias par appareil** (`device_id` -> `ftbot.N` -> `bot_key`) : le téléphone et l'ordinateur ont
  chacun leur `localStorage` et probablement des numérotations différentes. Les ids `ftbot.N` ne sont jamais renumérotés.
- `incarnation` = hash de `(bot_name, strategy, db_path, process_start)` : un changement sur le même port émet
  l'événement `bot_replaced` et sépare l'historique ; le journal est indexé par `db_path`, pas par port.
- Bot découvert absent du registre du navigateur : affiché « nouveau bot détecté » dans Réglages > Bots (ajout en un clic,
  la SPA lui attribue `nextBotId`). Bot du registre absent de `/proc` mais base présente : état `stopped` (ledger orphelin,
  comme `_ph_orphan_ledgers`).

### 4.2 Sources et cadences (40 bots, régime permanent)

| Source | Donnée | Cadence normale | Cadence « vue » (abonné) | Notes |
|---|---|---|---|---|
| `/proc` + configs | découverte, capital, wallet, dex HIP-3 | 30 s | | Re-fusion des configs seulement si mtime change |
| ftcache `summary_get` | digest par bot (`age_s`, `open_profit_abs`, état) | 5 s | | Une requête pour toute la flotte |
| ftcache `fleet_status` | santé démon, budgets, backoff | 15 s | 5 s (panneau Santé ouvert) | |
| ftcache `fleet_events` | incidents (`since_ts` curseur) | 5 s | | |
| ftcache `stats` + socket pairlist | hit rate, séries | 60 s | 15 s | |
| `stat()` base + `-wal` | détection de changement | 2 s | 1 s | 80 `stat` toutes les 2 s, coût négligeable |
| SQLite `trades`/`orders` | positions ouvertes, historique, agrégats | sur changement | sur changement | Relecture complète si < 5 000 trades, sinon incrémentale |
| SQLite `profit_history` | courbes | incrémental par `rowid` sur changement | | Rechargement complet si `max(rowid)` recule |
| WS bot | `entry*`, `exit*`, `status`, `warning`, `startup`, `protection_trigger*`, `strategy_msg`, `trade_snapshot`, `whitelist` | continu | `new_candle` et `analyzed_df` ne sont pas souscrits (voir 05 section 5.1) | Prix et P&L latent en direct sans polling |
| REST `/status` | stoploss, liquidation, current_rate | 60 s | 10 s | Remplacé de fait par `trade_snapshot` quand présent |
| REST `/logs?limit=100` | logs (alertes log) | 30 s | 10 s | Dédup par `(ts, logger, message)` |
| REST `/balance` | wallet-level (1 bot live par wallet), dry : par bot | 120 s | 30 s | Jamais sommé entre bots d'un même wallet |
| REST `/whitelist`, `/blacklist`, `/locks` | paires | 300 s | 30 s | |
| REST `/show_config`, `/version` | features, `api_version` | 600 s + sur événement `startup`/reload | | |
| Python `/fleetview/reconciliation` | réconciliation (lecture) | 40 s (`hyperliquid.sweep_timeout_s`) | 60 s | Seul chemin vers HL en v1, voir 4.4. Hors budget de requêtes (elle ne bloque pas un créneau des pollers). Un balayage en échec (délai dépassé, erreur 5xx) met toute la flotte au repos 60 s : les appels suivants, par n'importe quel bot, reçoivent le même échec avec `retry_after_ms` sans nouveau balayage |
| CoinGecko | ticker BTC/ETH (C12) | 120 s | | Externe, pas HL ; absent = ticker masqué |

Charge REST vers les bots : environ 0,07 requête/s par bot, soit moins de 3 req/s pour 40 bots, toutes en boucle locale,
**indépendante du nombre d'onglets** (aujourd'hui ~4 req/s par onglet). Le bot live :9400 n'exécute plus
`/fleetview/overview` ni `/fleet/snapshot` pour l'UI.

### 4.3 Règles d'ordonnancement

- Jitter ±20 % par tâche, démarrage étalé sur la première période (pas de rafale au lancement de la passerelle).
- Concurrence : 1 requête REST en vol par bot (une tâche en retard saute son tour, pas de file), 6 en vol au total,
  4 threads SQLite (`spawn_blocking` dédié), 1 connexion socket ftcache à la fois, éphémère, timeout 2 s.
- Timeouts : REST lecture 8 s, `/logs` 5 s, passthrough stratdev/backtest/replay 300 s, écritures 20 s.
- Détection hors ligne (port de `createOfflineDetector`) : seules les erreurs de transport comptent (connexion refusée,
  timeout, 500) ; 3 échecs consécutifs -> `offline` ; 502 « not in the correct state » -> `starting` ; WS fermé + `/ping`
  en échec -> `offline` immédiat. Bot `offline` : seul `/ping` est sondé, backoff 30 s -> 60 s -> 120 s max ; retour en
  ligne -> resynchronisation complète du bot. Les passthrough stratdev/replay sont exemptés de la détection.
- Abonnements : un client qui ouvre la page d'un bot (`bot:<key>`) relève les cadences de ce bot (compteur de références),
  retour aux cadences normales 30 s après le dernier désabonnement.
- BotFeatures (bots sans endpoints du fork, freqtrade amont) : sondage une fois par incarnation (`/version` ->
  `api_version`, 404 sur les endpoints fork = absent). Replis : pas de socket ftcache -> digest reconstruit depuis REST ;
  `/profit_all` absent -> `/profit` ; pas de table `profit_history` -> courbe réalisée seule depuis les trades fermés, marquée
  `realized_only` ; pas de `trade_snapshot` -> `/status` à 15 s (bot vu) ou 60 s ; bot distant sans SQLite -> `/trades`
  paginé incrémental toutes les 10 min (comparaison du `total_trades` avant de paginer).

### 4.4 Hyperliquid et socket ftcache : règles dures

- Liste blanche d'ops ftcache : `ping`, `summary_get`, `fleet_status`, `fleet_events`, `stats` (et `stats` du socket
  pairlist). **Interdits** : `register`, `state_update`, `*_put`, `acquire`, `tickers`, `positions_get`, `report_*`.
  Raison vérifiée dans `daemon.py:_handle_positions_get` : sur cache manquant, le démon arme un événement « en vol » et
  retire du budget de poids en attendant que **l'appelant** aille chercher les positions ; les bots suivants attendent
  jusqu'à 15 s cet événement. Une passerelle qui lit sans pousser bloquerait la flotte. `register` ferait apparaître la
  passerelle comme un bot. Les tests vérifient la liste blanche (le client refuse toute autre op à la compilation : enum fermé).
- Le démon est mono-thread asyncio et a déjà saturé (85 % d'un cœur) : la passerelle y ajoute environ 0,5 requête/s de
  petites réponses (le digest de 40 bots fait quelques dizaines de Ko), contre plusieurs requêtes/s supprimées côté UI.
- Hyperliquid : **zéro appel en régime permanent**. Positions et exposition proviennent des bases + `trade_snapshot` +
  digest ; l'exposition wallet de `user_data/exposure_state.json` est lue comme fichier. La lecture on-chain n'a lieu que
  via la réconciliation : v1 = proxy de l'endpoint Python (qui boucle déjà sur les dex HIP-3 de la config), au plus un
  balayage par wallet et par 60 s, garde côté passerelle (horodatage du dernier balayage par wallet, persistant au
  redémarrage) ; v2 = client natif `POST /info clearinghouseState` par dex avec le même plafond, activé seulement après
  équivalence prouvée.

## 5. Lecture des SQLite des bots en production

- Toutes les bases actives sont en WAL (39/40 vérifiées, une sans `profit_history`) : un lecteur ne bloque jamais
  l'écrivain. Le seul risque est d'empêcher un checkpoint de progresser (croissance du `-wal`) en gardant une transaction
  de lecture ouverte.
- Ouverture : `file:<path>?mode=ro` avec `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_URI | SQLITE_OPEN_NO_MUTEX` ; **jamais**
  `immutable=1` (lirait des pages périmées en WAL) ; `PRAGMA query_only=1` ; `busy_timeout=250` ms ; aucune commande
  `wal_checkpoint`, `journal_mode`, `VACUUM`, `ANALYZE`.
- Chaque lecture = une transaction implicite courte (budget 200 ms par base, statements finalisés aussitôt) ; connexions
  mises en cache mais jamais avec un statement ouvert. Test de charge dédié : un écrivain qui commit en continu pendant
  10 min, la taille du `-wal` ne doit pas dériver.
- Bases ignorées : noms contenant `backup`, `replay`, `tmp`, sous-répertoires `_archive`, `_retired`.
- Introspection du schéma (`PRAGMA table_info`) à chaque incarnation : colonne absente = champ absent, pas une erreur.
- Pièges métier (depuis `project_trade_db_sql_pitfalls`, `api_fleetview.py`) :
  - Direction : `trades.is_short` ; les ordres d'entrée sont ceux dont `ft_order_side` vaut `sell` si `is_short` sinon
    `buy` (repli par side comme dans DcaInfoPopover).
  - `exit_reason` et `close_rate` parfois nuls sur des trades fermés (clôture externe, suppression) : affichés « inconnu »,
    exclus des calculs fondés sur `close_rate`, jamais remplacés par une valeur inventée ; `close_profit_abs` lu avec
    `COALESCE` et un drapeau `profit_unknown`.
  - Dates naïves `YYYY-MM-DD HH:MM:SS[.ffffff]` interprétées en UTC, converties en millisecondes entières dès la lecture.
  - `profit_history` incrémental par `rowid` ; si le `rowid` max recule (purge, recréation), rechargement complet.
  - Trades rejoués / ensemencés dans les bases dry (`project_dry_pnl_seed_bias`) : la passerelle expose la date du premier
    trade réel et la date de lancement pour que l'UI affiche « depuis le ».
- Erreurs normalisées sans chemin ni message brut (port de `_ph_error_code`) : `db_locked`, `no_history_table`,
  `db_corrupt`, `db_missing`, `timeout`, `db_error`.

## 6. Modèle de données et protocole

### 6.1 Entités (types générés en TS par ts-rs)

- `BotRow` (clé `bot_key`) : identité (`ui_ids`, nom, icône, mode live/dry/replay, stratégie, exchange, marché
  crypto/HIP-3), état (`online|starting|offline|stopped|auth_expired`), capital de départ
  (`available_capital - capital_withdrawal`, jamais `balance.total` d'un wallet partagé), `wallet_id`, métriques (réalisé
  1j/7j/30j/total, latent, ouverts/max, exposition long/short, drawdown réalisé et drawdown avec latent, en absolu puis en
  %, dernier trade), alertes actives (compte, sévérité max), `freshness` par groupe de champs.
- `Position` (clé `bot_key/trade_id`) : paire, side, levier, montant, prix d'entrée, prix courant, P&L, stoploss,
  liquidation, distance à la liquidation, nombre d'entrées DCA, durée, percentile de durée.
- `TradeRow` (journal) : champs fermés + `profit_unknown`, `exit_reason` nullable.
- `WalletRow` : adresse (abrégée), bots rattachés, équité wallet-level, exposition nette par coin, résumé réconciliation.
- `Health` : niveau `ok|degraded|critical` + raisons, budgets rate, backoff, hit rate, bots process, âge du digest.
- `Alert`, `Event`, `AuditEntry`, `Ticker`.
- `Freshness` = `{as_of_ms, source: "digest"|"sqlite"|"ws"|"rest"|"python", stale: bool}` ; `stale` calculé côté serveur
  (digest > 120 s, REST > 3 fois la cadence, WS silencieux > 2 min alors que le bot a des positions).

### 6.2 Protocole

Choix comparés :

| Critère | Snapshots complets périodiques | JSON Patch (RFC 6902) | **Upserts par clé + séquence (retenu)** |
|---|---|---|---|
| Exactitude | Simple | Dépend de l'ordre des index de tableaux | Idempotent, indépendant de l'ordre |
| Débit | 40 lignes x N toutes les 5 s | Minimal | Minimal |
| Reprise après coupure | Triviale | Difficile | Rejeu du tampon ou snapshot |
| Intégration Pinia | Remplacement | Bibliothèque de patch | `Object.assign` par entité |

- **Snapshot initial en HTTP** : `GET /gw/v1/snapshot?ch=fleet,positions,alerts,health` -> JSON compressé (br/gzip
  via tower-http), `ETag`, en-tête `X-Gw-Seq` par canal. Mesurable, mis en cache, compressible sans dépendre du support
  `permessage-deflate` du WS (à vérifier selon la version de tungstenite ; non requis).
- **WebSocket** `GET /gw/v1/ws` : trames texte JSON.
  ```json
  {"t":"auth","token":"...","device_id":"d-7f3a"}
  {"t":"sub","ch":["fleet","alerts","health","positions"],"resume":{"fleet":1842,"alerts":77}}
  {"t":"up","ch":"fleet","seq":1843,"ts":1760530000123,
   "upsert":{"bots":{"local:9056":{"metrics":{"open_profit_abs":-3.42},"freshness":{"metrics":{"as_of_ms":1760530000000,"source":"ws","stale":false}}}}},
   "remove":{"bots":[]}}
  {"t":"ev","ch":"events","seq":5120,"data":{"kind":"exit_fill","bot_key":"local:9056","trade_id":412,"pair":"ETH/USDC:USDC","profit_abs":4.1}}
  {"t":"hb","ts":1760530015000}
  {"t":"resync","ch":"fleet","reason":"gap"}
  ```
- Séquences monotones par canal ; tampon circulaire des 512 derniers deltas par canal ; trou détecté côté client ou
  reprise hors tampon -> le serveur envoie `resync` et le client recharge le snapshot HTTP de ce canal.
- Fusion : par entité, superficielle sur les groupes de champs (`metrics`, `freshness`, `state`) ; suppression explicite
  via `remove`.
- Coalescence : deltas `fleet` au plus 4 par seconde, `positions` (prix) au plus 1 par seconde par position ; événements
  et alertes immédiats.
- Battement : `hb` toutes les 15 s avec l'heure serveur (le client corrige son décalage d'horloge pour les âges) ; aucune
  trame depuis 35 s -> reconnexion (backoff 1, 2, 5, 10, 30 s) avec `resume`.
- Redémarrage de la passerelle : la numérotation des trames d'un canal démarre à `base + 1`, `base` = millisecondes du
  démarrage du processus (sous 2^53, exact en JavaScript). Un `resume` d'une incarnation précédente tombe donc toujours
  sous la plus ancienne trame du tampon et reçoit un `resync` (`stale_resume`), jamais un rejeu de trames étrangères.
- Contre-pression : file d'envoi bornée par client (256 trames) ; dépassement -> vidage de la file et `resync` (un client
  lent ne ralentit jamais les autres ni le moteur).
- Canaux : `fleet` (lignes de bots + totaux par scope), `positions` (toutes les positions ouvertes, RiskPanel et
  TradeTable `open`), `alerts`, `events`, `health`, `recon` (seulement si abonné, déclenche la cadence 60 s),
  `bot:<key>` (détail : verrous, whitelist, config résumée, logs récents), `logs:<key|errors>` (LogStream),
  `chart:<key>:<pair>:<tf>` (relais des bougies d'un graphique ouvert : lecture `pair_candles` du bot, voir 05 section 5.1).

### 6.3 Endpoints REST (`/gw/v1`)

| Méthode et chemin | Rôle | Cluster |
|---|---|---|
| `GET /hello` | Public : version, protocole, modes d'auth, aucune donnée | |
| `POST /session/bootstrap`, `POST /session/login`, `DELETE /session`, `GET /sessions`, `DELETE /sessions/{id}` | Sessions | C13 |
| `GET /snapshot?ch=` | Snapshot compressé par canal | C1, C3, C5, C6, C8 |
| `GET /ws` | WebSocket | tous |
| `GET/POST /bots`, `PATCH/DELETE /bots/{key}`, `POST /bots/{key}/credentials`, `GET /bots/discovered` | Registre | C13 |
| `GET/PUT /prefs` (`If-Match`, objet versionné) | Préférences synchronisées (si validé, voir questions) | C13, C15 |
| `GET /scope/{scope}` (`bot:<key>`, `group:<id>`, `fleet`) | Données de BotPulse / ScopeDrilldown | C2, C3 |
| `GET /trades?status=&bots=&group=&pair=&side=&exit_reason=&mode=&from=&to=&sort=&order=&cursor=&limit=` | Journal paginé serveur (curseur keyset `(sort_value, bot_key, trade_id)`), totaux filtrés (nombre, somme, winrate, profit factor) | C9 |
| `GET /trades/{key}/{trade_id}` | Détail avec ordres DCA | C10 |
| `GET /trades/export.csv?...` | Export | C9 |
| `GET /pnl/periods?unit=day\|week\|month&scope=&tz=&n=` | Calendrier P&L (une devise, fuseau explicite) | C4 |
| `GET /equity?scope=&from=&points=&mode=realized\|with_open` | Courbes depuis `profit_history`, décimées, `ETag` | C4 |
| `GET /drawdown?scope=&def=realized\|with_open` | Drawdown (définitions nommées, absolu d'abord) | C4, C5 |
| `GET /leaderboard?period=1d\|7d\|30d&scope=` | Classement par bot | C4 |
| `GET /risk?scope=` | Exposition long/short/nette par wallet, levier moyen, capacité, distance de liquidation, paires dupliquées | C5 |
| `GET /health` | Score et raisons ; `GET /health/rate?bot=` proxifie la timeline d'un bot (non reproductible côté flotte) | C6 |
| `GET /logs?bot=&level=&q=&cursor=` | Logs fusionnés, filtres serveur | C7 |
| `GET /alerts?state=`, `POST /alerts/{id}/ack`, `POST /alerts/silence`, `DELETE /alerts/silence/{id}`, `GET/PUT /alerts/rules` | Alertes persistées | C8 |
| `GET /events?since=&kinds=&bot=` | Fil d'événements | C8 |
| `GET /pairs/{key}` | Whitelist, blacklist, verrous, signaux (proxy `signal_summary` à la demande) | C11 |
| `GET /market` | Ticker BTC/ETH | C12 |
| `POST /bots/{key}/actions/{action}` | Écritures typées (section 8) | C14 |
| `ANY /bots/{key}/proxy/{path}` | Passthrough en liste blanche (section 8) | Outils, Charts |
| `GET /audit?from=&bot=` | Journal d'audit | C14 |

La conversion de devise (C12) est supprimée en v1 : tout est en devise de mise (USDC), sans `USDT` en dur.

### 6.4 Couverture des clusters et des pages

| Cluster (doc 01) | Ce que la passerelle fournit | Ce qu'elle ne fournit pas |
|---|---|---|
| C1 FleetTable | Canal `fleet` (une ligne par bot, état, P&L, exposition, slots, alerte, âge), tri/filtre client sur 40 lignes | |
| C2 BotPulse | `GET /scope/bot:<key>` + canal `bot:<key>` (performance, positions, capital, drawdown, config résumée) | Édition de config (passthrough Python) |
| C3 ScopeDrilldown | Même `GET /scope/{scope}` pour `group:<id>` et `fleet` (groupes résolus depuis les préférences) | |
| C4 EquityCurve, PnlCalendar, Leaderboard | `/equity`, `/drawdown`, `/pnl/periods`, `/leaderboard` | Distributions avancées (calculées client sur la page du journal filtrée) |
| C5 RiskPanel | `/risk` + canal `positions` ; exposition wallet-level, jamais sommée par bot | Stress test (Outils, client) |
| C6 SystemHealth | Canal `health` (score + raisons) ; `/health/rate?bot=` proxifie la timeline d'un bot | Timeline 429 de flotte (n'existe que par bot) |
| C7 LogStream | Canal `logs:errors` (mode compact), `/logs` paginé (mode page) | Historique au-delà du tampon des bots (question ouverte) |
| C8 AlertRail, EventFeed | Canaux `alerts`, `events` ; ack, silence persistés ; badge global | Notifications push hors onglet ouvert |
| C9 TradeTable | Canal `positions` (preset `open`), `/trades` paginé (presets `closed`, `journal`), export CSV | |
| C10 TradeDrawer | `/trades/{key}/{id}` (ordres DCA), actions typées, `pair_candles` proxifié en cache | |
| C11 PairNavigator | `/pairs/{key}` (whitelist, blacklist, verrous, signaux à la demande) | |
| C12 Ticker marché | `/market` (BTC/ETH, CoinGecko caché) ; conversion de devise supprimée | Indicateurs de sentiment (supprimés) |
| C13 Réglages, bots | Registre, sessions, préférences versionnées, import/export | |
| C14 BotActionMenu | `POST /bots/{key}/actions/*`, idempotence, garde d'état, audit | Actions groupées (v2, job échelonné) |
| C15 FleetScope | Paramètre `scope` commun à tous les endpoints et canaux, groupes/tags dans les préférences | |

| Page | Données au premier affichage | Abonnements |
|---|---|---|
| Dashboard | Snapshot `fleet`, `alerts`, `health`, `positions` ; `/equity?scope=fleet` ; `/leaderboard` | `fleet`, `alerts`, `events`, `health`, `positions` |
| Trading / page bot | `/scope/bot:<key>`, `/trades?bots=<key>&status=closed&limit=50` | `bot:<key>` (cadences relevées), `positions` filtré, `logs:<key>` |
| Charts | `proxy pair_candles` en cache, `plot_config`, trades de la paire | `chart:<key>:<pair>:<tf>` |
| Journal | `/trades` paginé, totaux filtrés, `/pnl/periods` | `events` (nouvelles clôtures -> invalidation de la page 1) |
| Outils (StrategyDev, Backtest, Download data, Pairlist config, diagnostic) | Passthrough Python en liste blanche, timeouts longs | Aucun (polling de job existant via le proxy) |

## 7. Moteur d'alertes et fil d'événements

### 7.1 Modèle

`Alert = {id, type_id, bot_key, subject (pair ou trade_id ou null), pair (la paire de la position, pour les règles par position dont le sujet est le trade_id ; sert à l'affichage, pas à la clé), severity, value, threshold, since_ms, last_seen_ms,
state: pending|firing|resolved, acked_by_session?, silenced_until?}`. Clé de dédup = `(type_id, bot_key, subject)` (le
message n'en fait plus partie). Évaluation toutes les 10 s et sur delta pertinent. Hystérésis : passage `firing` après
`for` (par défaut 30 s, 0 pour les critiques), `resolved` après 2 évaluations négatives. Ack valable jusqu'à résolution ;
silence par règle, bot, paire, jusqu'à une date. Tout est persistant dans `state.db`. Seuils globaux + surcharge par
bot importés de `ftBotComparison.alertConfig` (dont `perBotEnabled`).

### 7.2 Règles portées (14 `typeId` trouvés dans `useAlertDetection.ts`)

Le brief parle de 13 types et le document 01 évoque 14 ou 16 : le code en émet 14, tous portés.

| Type | Règle serveur | Correction par rapport au client |
|---|---|---|
| `positionLoss` | `profit_ratio < seuil` (défaut -10 %), critique sous 2 fois le seuil | Clé par trade |
| `positionStuck` | durée > multiplicateur x médiane des durées fermées du bot (SQLite) | Plus de parsing fragile de `avg_duration` |
| `nearLiquidation` | `abs(rate - liq) / rate < seuil` (défaut 15 %) | Le client utilisait `1 + profit_ratio`, qui n'est pas une distance à la liquidation |
| `liquidationBeforeStoploss` | distance liquidation < distance stoploss | Identique, sur prix frais |
| `logErrors` | lignes `ERROR`/`CRITICAL` **nouvelles** dans les 15 dernières minutes | Le client comptait tout le tampon de 200 lignes, à perpétuité |
| `orderFailed` | motifs `Could not create`, `InvalidOrderException`, `Unable to exit trade`, `Unable to create`, `Insufficient funds` sur lignes nouvelles | Fenêtre glissante |
| `insufficientFunds` | motifs `Insufficient`, `Not enough`, `balance too low` | Idem |
| `exchangeError` | motifs `ExchangeError`, `RequestTimeout`, `NetworkError`, `rate limit` + événements 429 du démon | Idem |
| `walletMismatch` | `Wallet shows a total of 0`, `Refusing to adjust` | Idem |
| `noTradeActivity` | heures depuis le dernier trade > seuil (défaut 24 h) | **Bug corrigé** : `latest_trade_timestamp` est en millisecondes (`dt_ts_def`, `rpc.py:1021`) et le client le comparait à `Date.now()/1000` ; la passerelle normalise tout en ms et lit la date dans SQLite. Le bot `long` inactif en marché baissier reste en `info`, jamais critique |
| `botOffline` | état ordonnanceur `offline` (critique), `starting` (info) | Fondé sur la machine d'états, pas sur un onglet ouvert |
| `highDrawdown` | drawdown réalisé courant < seuil, en absolu et en % du capital de départ | Définition nommée unique |
| `capacityFull` | ouverts >= `max_open_trades` | |
| `allFundsExposed` | somme des mises ouvertes >= 95 % du capital de départ du bot | Le client lisait `state.balance`, champ absent |

Nouvelles règles possibles côté passerelle : `dataStale` (remplace l'avertissement « stale > 2 min »), `authExpiring`,
`daemonDegraded` (backoff actif, budget > 80 %), `reconMismatch` (fantômes ou orphelins > seuil de poussière 30 USDC),
`gatewayDegraded` (bases illisibles, socket absent).

### 7.3 Événements et notifications

Sources du fil : WS des bots (`entry_fill`, `exit_fill`, `*_cancel`, `protection_trigger*`, `warning`, `startup`,
`strategy_msg`), `fleet_events` du démon, transitions d'alertes, transitions online/offline, actions de l'audit.
Anneau mémoire de 5 000 événements, persistance 30 jours. Notifications navigateur uniquement quand un onglet est ouvert
(Notification API exige HTTPS hors localhost : à signaler) ; pas de Telegram par la passerelle (les bots notifient déjà,
règle « Telegram court, pas de spam »).

## 8. Écritures et passthrough

### 8.1 Actions typées

`POST /gw/v1/bots/{key}/actions/{action}` avec `action` parmi : `forceexit` (total ou partiel), `forceentry`, `start`,
`stop`, `stopbuy`, `reload_config`, `delete_trade`, `cancel_open_order`, `reload_trade`, `blacklist_add`,
`blacklist_remove`, `lock_delete`.

- Corps typé avec garde d'état attendu : par exemple `forceexit = {trade_id, expected:{pair, is_short}, amount?, ordertype?,
  confirm?}`. La passerelle vérifie dans son modèle (et, si plus vieux que 10 s, par `GET /status/{trade_id}` sur le bot)
  que le trade existe, est ouvert, et correspond à `expected` ; sinon `409 state_mismatch`. C'est le correctif serveur du
  bug « mauvais bot » (`ForceExitForm` sur `activeBot`) : le bot est dans l'URL, le trade est vérifié.
- `Idempotency-Key` obligatoire (UUID v4 généré au clic). Même clé déjà vue : renvoie le résultat stocké (avant toute
  précondition : le rejeu d'une sortie réussie ne dépend pas de l'état que l'action a changé), ou `409 in_progress`. Une clé
  réutilisée pour un autre bot, une autre action ou d'autres paramètres : `422 idempotency_key_reused`. Verrou en vol par `(bot_key, trade_id)` et par `(bot_key, action)` pour `stop`/`reload_config`.
- **Aucun retry.** Le token d'accès est rafraîchi **avant** l'envoi s'il expire dans moins de 60 s. Une réponse 401
  prouve que l'action n'a pas été exécutée : renvoyée telle quelle (non mémorisée comme résultat final), l'UI propose de
  réessayer. Timeout après 20 s : résultat `unknown` (« vérifier sur le bot »), jamais présenté comme un échec ni comme
  un succès ; la passerelle sonde ensuite l'état du trade et pousse la vérité dans le fil.
  L'exécution est détachée de la requête HTTP : un client qui part ne coupe jamais l'écriture en vol, le résultat est
  toujours enregistré, audité et annoncé ; l'appelant attend au plus 75 s, puis reçoit `unknown` (`reason: timeout`) pendant
  que la tâche continue.
- Réponse : `{status: accepted|rejected|unknown, bot_response (tronquée), verify: {expected_state, check_after_ms}}`.
  Le succès HTTP signifie « ordre transmis », pas « position fermée » ; la confirmation vient de l'événement
  `exit_fill` ou de la relecture SQLite, et l'UI affiche les deux étapes.
- Règles serveur : `stop` sur un bot lancé par `launch_bot.sh` est signalé (il redémarre tout seul) ; pas d'action
  groupée en v1 ; plus tard, actions groupées seulement via un job serveur échelonné (10 min minimum entre deux
  `reload_config`/`stop`, annulable).
- Audit (append-only, table `audit` + fichier JSONL roulant) : horodatage, hash de session, IP, user agent abrégé,
  `bot_key`, nom, mode live/dry, action, paramètres nettoyés, clé d'idempotence, statut HTTP, réponse tronquée à 2 Ko,
  latence. Jamais de token.

### 8.2 Passthrough en liste blanche

`ANY /gw/v1/bots/{key}/proxy/{path}`, liste blanche (tout autre chemin = 404) :
- Lecture avec cache : `pair_candles` (cache par `(pair, tf, limit)` jusqu'à la clôture de bougie suivante ; plus de 5 000
  bougies par survol), `pair_history`, `plot_config`, `signal_summary` (à la demande), `volume_history` (cache 5 min),
  `strategy/*`, `rate_metrics` (timeline d'un bot).
- Python uniquement, timeouts longs (300 s), exemptés de la détection hors ligne : `stratdev/*` (éditeur de config
  compris), `replay*`, `backtest*`, `download_data`, `pairlists/*`.
- Écritures passthrough (`fleetview/reconciliation/resolve`, `fleetview/reconciliation/realign`, `stratdev/editor/file`,
  `replay` avec `reset_db`, `blacklist`) : mêmes exigences que 8.1 (idempotence, aucun retry, audit, confirmation).
  La réconciliation reste entièrement en Python (signature EIP-712, `vaultAddress`, aperçu puis confirmation).

## 9. Contrat d'intégration frontend

### 9.1 Abstraction de source

```ts
type SourceKind = 'gateway' | 'direct';
interface DataSource {
  kind: SourceKind;
  status: Ref<{ state: 'connecting' | 'live' | 'degraded' | 'offline'; lastSyncMs: number; clockSkewMs: number }>;
  subscribe<C extends Channel>(ch: C, params: ChannelParams[C], sink: (u: ChannelUpdate[C]) => void): () => void;
  query: {
    trades(q: TradeQuery): Promise<Page<TradeRow>>;
    periods(q: PeriodQuery): Promise<PeriodRow[]>;
    equity(q: EquityQuery): Promise<EquitySeries>;
    drawdown(q: DrawdownQuery): Promise<DrawdownResult>;
    logs(q: LogQuery): Promise<Page<LogLine>>;
    events(q: EventQuery): Promise<Page<FleetEvent>>;
    scope(s: ScopeRef): Promise<ScopeDetail>;
  };
  act(botKey: string, action: BotAction, idempotencyKey: string): Promise<ActionResult>;
  proxy<T>(botKey: string, method: string, path: string, body?: unknown, opts?: { timeoutMs?: number }): Promise<T>;
  registry: RegistryApi;
  alerts: AlertsApi;
}
```

- `GatewaySource` : snapshot HTTP + WS ; `DirectSource` : enveloppe le polling actuel de `ftbotwrapper` (réduit : sur
  mobile, `/fleet/snapshot` d'un bot + bot affiché seulement) et calcule les agrégats avec des fonctions TS pures validées
  sur les mêmes vecteurs `gateway/fixtures/vectors` que `fg-core`. En direct : pas d'alertes 24/7, journal calculé
  client, bandeau « mode direct ».
  Ordonnancement du `DirectSource` (B230) : trois voies (digest et vue d'ensemble de la flotte ; `/status` sur 16 créneaux ;
  config, profit, balance, logs et historique clos sur 4), le bot affiché d'abord puis celui qui attend depuis le plus longtemps,
  une requête `/status` en vol par bot au plus, attendue 120 s (10 s par position tant que l'exchange est en backoff 429),
  lecture ordinaire 15 s ; `/show_config` est lu avec `/status` tant que le mode du bot est inconnu.
- Les composants ne parlent qu'aux stores normalisés (`fleet`, `positions`, `alerts`, `events`, `health`) alimentés par la
  source ; aucun appel axios dans un composant. `useBotAction(botKey)` fournit verrou en vol, clé d'idempotence et
  confirmation pour les deux sources (en direct : envoi unique, pas de rejeu après 401, comme exigé par le doc 01).
- Sélection : préférence `auto|gateway|direct` (défaut `auto`). `auto` sonde `hello` sur l'URL configurée, sinon
  `${location.protocol}//${location.hostname}:9399` (1,5 s max). Échec -> direct, nouvelle sonde toutes les 60 s.
  WS perdu plus de 30 s et `hello` en échec -> bascule en direct avec bandeau ; retour automatique dès que `hello` répond.
- Premier affichage instantané : le dernier snapshot `fleet` est conservé en IndexedDB et affiché aussitôt, marqué
  « données d'il y a N min », puis remplacé.

### 9.2 Migration du `localStorage` (aucune action utilisateur)

Lecture seule des anciennes clés, jamais supprimées ni réécrites par la migration (retour arrière possible vers l'ancienne
UI sur la même origine). Exception assumée : en mode direct, le rafraîchissement des tokens continue d'écrire
`ftAuthLoginInfo` dans la même forme qu'aujourd'hui.

| Clé | Traitement |
|---|---|
| `ftAuthLoginInfo` | Lue ; ids `ftbot.N` conservés ; envoyée au bootstrap ; reste la source du mode direct |
| `ftSelectedBot`, `ftBotNames` | Importées dans `fqu2.settings` |
| `ftBotComparison` | Importée (groupes, tags, ordre, colonnes, filtres, seuils d'alerte, `perBotEnabled`, notifications) ; alertes envoyées à la passerelle |
| `ftUISettings`, `ftUIColorSettings` | Importées (confirmation de forceexit forcée à vrai pour les bots live) |
| `ft_locale` | `fr`/`en` conservés, `es`/`de`/`it`/`pt` -> `en` dans la nouvelle clé seulement |
| `enhancedOpenTradeColumns`, `enhancedClosedTradeColumns`, `enhancedOpenTradeColumnOrder`, `enhancedClosedTradeColumnOrder` | Converties vers le registre de colonnes de TradeTable (ids inconnus ignorés) |
| `ftPlotConfig` | Importée telle quelle (préréglages d'indicateurs) |
| `ftLayoutSettings`, `ftUIChartSettings`, `ftPairlistConfig`, `ftBotListGrouped`, `ftBotComparisonRecentIcons`, `ft_benchmarks_enabled`, `ft_benchmark_show_latent`, `ft_benchmark_show_realized`, `ft_benchmark_show_dd`, `ft_market_overview_settings`, `ft_profit_goal`, `ft_dismissed_correlations`, `ftForkUpdateCheck`, sessionStorage `ftBootShown` | Non importées (layout refondu), laissées intactes |

Nouvelles clés (préfixe `fqu2.`, ignorées par l'ancienne UI) : `fqu2.settings` (objet versionné `{v:1, ...}`),
`fqu2.gateway` (`{url, session, expiresAt, deviceId, mode}`), `fqu2.migration` (`{v, at, sourceHashes}` : la migration
ne se rejoue que si une clé source change de hash), IndexedDB `fqu2-cache` (snapshot). `useConfigExport` garde la lecture
des formats v1/v2 et ajoute un format v3 qui inclut `fqu2.*`.

## 10. Stratégie de tests et CI

- **Unitaires `fg-core`** : drawdown (deux définitions, absolu et %), périodes avec fuseau et changement d'heure, capital
  sur wallet partagé, durées et percentiles, classification HIP-3 (`XYZ-`, `xyz:`), `exit_reason` nul, `is_short`,
  normalisation ms/s (test de régression `noTradeActivity`), chaque règle d'alerte avec ses cas limites, machine d'états
  (hystérésis, ack, silence), fusion des deltas et détection de trous.
- **Vecteurs partagés** : `gateway/fixtures/vectors/*.json` exécutés par `cargo test` et par vitest (mode direct).
- **Sources** : SQLite fixtures (schémas de plusieurs versions de freqtrade, dates naïves, nuls), faux démon ftcache
  (vérifie la liste blanche d'ops), faux bot (401, 502 « not in the correct state », timeouts, WS coupés).
- **Équivalence en lecture seule sur ce serveur** (`cargo test -p equivalence -- --ignored`, lancé à la main) : compare
  la passerelle avec `GET /api/v1/fleet/snapshot`, `/fleetview/overview`, `/fleetview/profit_history` et `/profit_all`
  par bot (127.0.0.1, identifiants lus comme en 3.1). Tolérance 1e-6 sur les sommes, dates exactes, mêmes listes de
  bots et de positions. Uniquement des GET ; `/fleetview/reconciliation` exécuté au plus une fois par 60 s (il appelle
  HL). Aucun appel à un endpoint d'écriture.
- **Charge** : `tools/fakebot` simule 40 bots (API, WS `trade_snapshot` toutes les 5 s, SQLite de 5 000 trades chacun avec
  un écrivain WAL actif, faux démon) et 50 clients WS ; 30 min ; critères = budgets de la section 12, taille du `-wal`
  stable, aucune trame perdue sans `resync`.
- **Sécurité** : aucune route d'écriture sans session/portée/idempotence/Origin (test table-driven sur toutes les routes),
  rate limiting, secrets absents des logs (3.4), passthrough hors liste blanche refusé.
- **E2E Playwright** : contre une passerelle de démonstration (`fakebot` + passerelle réelle en mode test, ou serveur
  mock rejouant des fixtures) ; projets desktop et mobile ; scénarios : bootstrap silencieux, reconnexion et `resync`,
  bascule en direct quand la passerelle tombe, double clic sur forceexit = une seule requête, `409 state_mismatch`
  affiché, migration du `localStorage` depuis un jeu de clés réelles anonymisées.
- **CI GitHub Actions** (créés dans `.github/workflows`, lot B5 ; `actionlint` propre) :
  - `rust.yml` : `fmt --check`, `clippy -D warnings`, `test`, `cargo-deny`, build musl x86_64 + aarch64 (cargo-zigbuild),
    artefacts.
  - `frontend.yml` : `pnpm install --frozen-lockfile`, `lint-ci`, `typecheck`, `test:unit`, `build`, Playwright chromium +
    mobile contre la passerelle de démonstration.
  - `contract.yml` : régénère `src/gateway/types.gen.ts` via ts-rs et échoue sur diff ; vecteurs partagés des deux côtés.
  - `packaging.yml` : shellcheck, répétition de `deploy-ui.sh` et du retour arrière, unité systemd, exemple de configuration,
    construction de l'image Docker.
  - Pas de zéro erreur exigé sur l'ancien code : `frontend.yml` bloque tout lint sur les couches de la refonte, et un
    cliquet `scripts/typecheck-budget.txt` (84 erreurs `vue-tsc` héritées, zéro dans les couches neuves) qui ne peut que baisser.
  - `release.yml` (tag) : archive dist de l'UI en **premier** asset (contrainte `install-ui`, `assets[0]`), binaires
    passerelle + `SHA256SUMS` ensuite, publication d'abord en prerelease.

## 11. Déploiement et retour arrière

### 11.1 Ce serveur (aucun redémarrage de bot)

1. **Préparation** : binaire dans `~/.local/bin/frequi-gateway` (artefact CI, somme vérifiée), config dans
   `~/.config/frequi-gateway/`, `frequi-gateway doctor` : port 9399 libre, socket ftcache joignable (op `ping`), bases
   lisibles en `ro`, chaque bot répond en 127.0.0.1, identifiants valides, CORS cohérent, aucun secret en clair dans les
   logs de test.
2. **Ombre (24-48 h)** : `gateway/packaging/run-in-screen.sh` (copié à côté du binaire). L'ancienne UI reste
   en place. Suivi : CPU du démon ftcache, latence `/status` des bots, taille des `-wal`, 429 dans `fleet_events`.
   Tests d'équivalence. Vérifier l'accès au port 9399 depuis le téléphone.
3. **Déploiement de l'UI** (le bot :9400 relit `ui/installed` à chaque requête) :
   `cp -a installed installed.bak.<date>` ; copie des nouveaux assets hachés dans `installed/` (additive, les anciens
   restent pour les onglets ouverts) ; écriture de `index.html.new` puis `mv` atomique vers `index.html` ; écriture de
   `.uiversion`. Script `packaging/deploy-ui.sh` idempotent avec vérification (hash de `index.html` servi par
   `curl http://127.0.0.1:9400/` ).
4. **Observation** : comparer les chiffres clés avec le bot (Telegram, `/profit`), surveiller les alertes, l'audit.
5. Option ultérieure : `installed` devient un lien symbolique vers `releases/<version>` (le serveur résout le chemin à
   chaque requête, `web_ui.py:42`), bascule par `mv -T` atomique d'un lien.

**Retour arrière** : UI = restaurer `index.html` depuis `installed.bak.<date>` (atomique, les anciens assets sont encore
là) ou restaurer le répertoire complet ; passerelle = `screen -x frequi-gateway` puis Ctrl+C, la SPA bascule seule en mode
direct. Les anciennes clés `localStorage` étant intactes, l'ancienne UI retrouve bots, groupes, tags et alertes.
Aucune de ces étapes ne touche un bot ni sa config.

### 11.2 Utilisateurs open-source de l'ancien dépôt

- `freqtrade install-ui` inchangé (release `titouannwtt/frequi-ultimate`, dist en `assets[0]`) ; corriger le README
  (`github://` non supporté).
- La passerelle est optionnelle : sans elle, l'UI fonctionne en mode direct, y compris contre des bots freqtrade amont.
- Avec elle : télécharger le binaire, `frequi-gateway print-default-config > config.toml`, renseigner les bots (ou
  laisser le scan `/proc` si même machine), choisir le mode d'auth (`token_proof` + `password`), installer l'unité systemd
  utilisateur ou le conteneur, ajouter l'origine de l'UI dans `cors_origins`. Dans l'UI : Réglages > Passerelle (URL,
  détection automatique). Guide FR et EN dans `docs/`.

## 12. Budgets de performance (40 bots, 50 en marge)

| Mesure | Budget |
|---|---|
| CPU passerelle, régime permanent | < 2 % d'un cœur en moyenne ; < 25 % d'un cœur en pic (resynchronisation complète) |
| RSS passerelle | < 120 Mo avec 200 000 trades indexés et 50 clients WS |
| Requêtes vers les bots | < 3 req/s au total, < 0,1 req/s par bot, indépendant du nombre d'onglets |
| Requêtes vers le démon ftcache | < 0,6 req/s, réponses < 100 Ko |
| Appels Hyperliquid | 0 en régime permanent ; au plus un balayage par wallet par 60 s, seulement réconciliation |
| Transaction SQLite | < 200 ms par base, aucune transaction de lecture tenue au-delà |
| Snapshot `fleet` | < 40 Ko brut, < 10 Ko compressé ; `positions` (100 positions) < 10 Ko compressé ; génération < 20 ms |
| Flux WS par client | < 2 Ko/s en moyenne, plafond 20 Ko/s |
| Latence événement (fill du bot -> UI) | < 1 s ; P&L latent : cadence du `trade_snapshot` du bot |
| Surcoût passerelle sur une action | < 20 ms |
| Dashboard, premier affichage avec données | < 1,0 s desktop, < 2,5 s téléphone 4G (snapshot en cache affiché immédiatement) |
| Bundle critique de la SPA | < 180 Ko compressé (Monaco, xlsx, ECharts lourds en chargement paresseux) |

## 13. Lots d'implémentation

Dépendances : B1 -> (B2, B3) -> B4 -> B7 ; B5 et B6 démarrent dès que les types de B1 sont figés.

| Lot | Contenu | Interfaces produites | Critères d'acceptation |
|---|---|---|---|
| **B1 fg-core** | Modèle, fonctions pures, règles d'alerte, protocole, export ts-rs, vecteurs | `model.rs`, `protocol.rs`, `src/gateway/types.gen.ts`, `fixtures/vectors` | `cargo test -p fg-core` vert ; couverture des 14 règles + régression `noTradeActivity` ; diff ts-rs nul |
| **B2 fg-sources** | Découverte `/proc` (liste blanche de champs), lecteur SQLite ro, client ftcache (enum fermé d'ops), REST bot (refresh, pas de retry en écriture), WS bot | traits `BotRest`, `BotWs`, `LedgerReader`, `DaemonClient`, `Discovery` | Tests sur fixtures ; `frequi-gateway doctor` vert sur ce serveur en lecture seule ; test qui échoue si une op hors liste est ajoutée |
| **B3 fg-engine** | Store arc-swap, ordonnanceur, agrégats, moteur d'alertes, `state.db` ; mode `compat` (proxy cache des endpoints Python) comme plan B | `EngineHandle` (subscribe, query, act) | Test de charge fakebot : budgets section 12 ; machine hors ligne ; `-wal` stable |
| **B4 fg-server** | Sessions, bootstrap, rate limiting, CORS, REST, WS, actions, passthrough, audit, redaction | API `/gw/v1` section 6.3 | Tests de sécurité table-driven ; idempotence ; secrets absents des logs |
| **B5 outillage** | `tools/fakebot`, harnais d'équivalence, workflows CI | `rust.yml`, `frontend.yml`, `contract.yml`, `release.yml` | CI verte sur une PR ; équivalence passée sur ce serveur |
| **B6 frontend data layer** | `DataSource`, `GatewaySource`, `DirectSource`, stores normalisés, `useBotAction`, migration `localStorage`, détection et bascule | `src/datasource/*`, `src/migration/*` | vitest sur vecteurs partagés ; Playwright (desktop + mobile) contre la passerelle de démonstration, y compris bascule et double clic |
| **B7 packaging et déploiement** | Builds musl, `run-in-screen.sh`, unité systemd, Dockerfile, `deploy-ui.sh` + rollback, guides FR/EN | `packaging/*` | Répétition du déploiement et du retour arrière sur une copie de `ui/installed` ; aucun bot touché |

## 14. Risques ouverts

1. Op `positions_get` du démon : un appel sans `positions_put` bloque les bots jusqu'à 15 s. Interdite par construction ;
   toute évolution du démon doit relire cette règle.
2. Interprétation du plafond HL (un balayage = 1 + k appels). À confirmer par l'utilisateur.
3. La passerelle lit des configs qui contiennent des clés privées exchange : désérialisation en liste blanche et effacement
   du tampon, mais le processus tourne avec le même utilisateur que les bots.
4. Port 9399 exposé sur Internet en HTTP clair, comme les API des bots aujourd'hui ; tokens interceptables. TLS conseillé.
5. Écarts de définitions (drawdown, capital, winrate) entre passerelle, Python et UI actuelle : à trancher et tester, pas
   à harmoniser en silence.
6. Ids `ftbot.N` différents entre appareils : la synchronisation des préférences doit passer par `bot_key`.
7. Le bot :9400 qui sert l'UI est un bot live : un déploiement raté coupe le dashboard, pas le trading ; la passerelle
   retire au contraire la charge `/fleetview/*` de ce processus.
8. Toolchain Rust présente sur l'hôte dans `~/.cargo/bin` (cargo 1.99, hors PATH par défaut) ; pas de Docker. Les binaires musl de release viennent de la CI.
9. Évolutions de l'API freqtrade amont : tests de contrat et sondage des features par incarnation.
10. `permessage-deflate` non garanti côté WS : compensé par le snapshot HTTP compressé et des deltas petits.
11. Notifications navigateur impossibles en HTTP hors localhost.

## 15. Questions qui exigent l'utilisateur

1. Préférences (groupes, tags, colonnes, seuils) synchronisées entre téléphone et ordinateur via la passerelle (recommandé,
   indexées par `bot_key`), ou propres à chaque navigateur ?
2. Plafond Hyperliquid : « un balayage (main + chaque dex HIP-3) par wallet et par 60 s » convient-il ?
3. Fuseau du P&L quotidien : UTC (comme `/daily` de freqtrade) ou Europe/Paris ?
4. TLS pour la passerelle (Caddy semble présent) : maintenant ou plus tard ? Sans TLS, pas de notifications navigateur.
5. Accepter que la passerelle valide une connexion de secours avec les identifiants API des bots (rien n'est stocké) ?
6. Actions groupées (fermer toutes les pertes, stopper N bots) : voulues en v2, et avec quel échelonnement ?
