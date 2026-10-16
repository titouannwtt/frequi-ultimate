# Passer à FreqUI Ultimate 2.0

Pour qui utilise déjà une version antérieure de FreqUI Ultimate (0.x), ou le FreqUI d'origine, et veut l'interface 2.0. English: [UPGRADE.en.md](UPGRADE.en.md).

**En bref.** Installez la nouvelle interface comme vous aviez installé l'ancienne. Rien à enregistrer à nouveau : la liste de vos bots est
dans votre navigateur (`localStorage`) et la 2.0 la relit telle quelle. La passerelle décrite plus bas est facultative ; sans elle,
l'interface fonctionne comme avant.

## Ce qui change pour vous

- L'interface reste un site statique **servi par votre bot** (même adresse, même port). Rien n'est placé devant, aucun bot n'est redémarré.
- Les données de votre navigateur sont migrées au premier chargement vers de nouvelles clés `fqu2.*`. **Les anciennes clés ne sont jamais
  supprimées** : revenir à l'ancienne interface retrouve vos bots, groupes, étiquettes et réglages d'alertes intacts.
- Nouveau dans la 2.0 : une organisation Flotte / Bot / Graphiques / Journal, long et short en vert et rouge avec une flèche et une lettre
  L/S, confirmation par appui maintenu pour les sorties en réel, français et anglais seulement. Les outils de stratégie (StrategyDev,
  Backtest, Téléchargement, Pairlist) passent dans un menu *Outils* discret.
- Nouveau et facultatif : **`frequi-gateway`**, un petit service qui lit vos bots une seule fois et alimente tous les onglets et
  téléphones ouverts, au lieu que chaque navigateur interroge chaque bot. L'interface la trouve toute seule et repasse en mode direct si elle
  disparaît.

## Étape 1 : installer la nouvelle interface

### Avec freqtrade-ultimate

```bash
freqtrade install-ui --ui-version v2.0.0
```

Sans `--ui-version`, `install-ui` installe la dernière version qui n'est pas une préversion. Rechargez ensuite la page une fois avec
Ctrl+Maj+R. Pour savoir quelle interface un bot sert : `curl http://127.0.0.1:8080/ui_version` (avec le port de votre bot).

### Avec freqtrade d'origine, ou à la main

Le `freqtrade install-ui` d'origine télécharge le FreqUI amont, pas ce fork. Téléchargez `frequi-ultimate-ui-v2.0.0.zip` sur la
[page des versions](https://github.com/titouannwtt/frequi-ultimate/releases) et décompressez-le dans
`freqtrade/rpc/api_server/ui/installed/` (pour le trouver : `python -c "import freqtrade.rpc.api_server as a; print(a.__path__[0])"`).
Le zip a `index.html` à sa racine.

Les panneaux propres au fork (pouls du marché, vue des risques, éditeur de stratégie) ont besoin des points d'accès supplémentaires de
[freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate) ; face à un bot d'origine ils restent vides, comme avant.

### Plus sûr : avec sauvegarde et retour arrière

Si vous gérez vous-même le dossier `installed`, `gateway/packaging/deploy-ui.sh` (dans ce dépôt) copie les nouveaux fichiers à côté des
anciens, bascule `index.html` de façon atomique, vérifie le résultat et garde une sauvegarde (`installed.bak.<horodatage UTC>` ; seules les 5 plus récentes sont conservées, voir `--keep` ; les copies faites à la main sous un autre nom ne sont jamais élaguées ni restaurées par `--rollback`) :

```bash
unzip frequi-ultimate-ui-v2.0.0.zip -d /tmp/frequi-ui
gateway/packaging/deploy-ui.sh --target ~/freqtrade/freqtrade/rpc/api_server/ui/installed \
    --dist /tmp/frequi-ui --version v2.0.0 --url http://127.0.0.1:8080
```

### Image Docker / nginx

Le `Dockerfile` à la racine construit l'interface dans une image nginx, comme avant. Reconstruisez-la depuis le tag.

## Étape 2 (facultative) : la passerelle

Utile si vous faites tourner plusieurs bots, ou ouvrez l'interface sur plusieurs appareils. Prérequis : Linux, la passerelle tourne sur la
**même machine et le même utilisateur que les bots** (elle les trouve en parcourant `/proc`, lit leurs réglages `api_server` dans leurs
fichiers de configuration, et ouvre leurs bases SQLite de trades en lecture seule). Elle ne modifie jamais la configuration d'un bot et ne
redémarre jamais un bot.

1. **Télécharger et vérifier.** Sur la page de la version, prenez `frequi-gateway-x86_64-unknown-linux-musl` (ou `aarch64`) et `SHA256SUMS`.

   ```bash
   sha256sum -c --ignore-missing SHA256SUMS
   install -D -m 0755 frequi-gateway-x86_64-unknown-linux-musl ~/.local/bin/frequi-gateway
   frequi-gateway version
   ```

2. **Regarder l'hôte (lecture seule).** `frequi-gateway doctor` liste les bots trouvés et ce qu'elle peut lire.

3. **Configurer.** Partez de `gateway/packaging/config.example.toml` :

   ```bash
   mkdir -p ~/.config/frequi-gateway
   frequi-gateway print-default-config > ~/.config/frequi-gateway/config.toml
   $EDITOR ~/.config/frequi-gateway/config.toml
   frequi-gateway check-config
   ```

   Le seul réglage à changer est `server.cors_origins` : l'adresse que vous tapez dans le navigateur pour ouvrir FreqUI, par exemple
   `["http://192.168.1.20:8080"]` (schéma, hôte et port, sans joker). L'authentification est obligatoire. Par défaut l'interface prouve
   qu'elle détient un jeton d'accès valide d'un de vos bots (rien à saisir). Pour ajouter un mot de passe propre à la passerelle :

   ```bash
   frequi-gateway hash-password        # collez l'empreinte affichée dans secrets.toml, mode 600 :
   printf '[auth]\npassword_hash = "..."\n' > ~/.config/frequi-gateway/secrets.toml
   chmod 600 ~/.config/frequi-gateway/secrets.toml
   # et dans config.toml : [auth] modes = ["token_proof", "password"]
   ```

4. **La lancer**, au choix :
   - **systemd (unité utilisateur)** : `gateway/packaging/frequi-gateway.service`, étapes d'installation en tête du fichier.
   - **screen** : `gateway/packaging/run-in-screen.sh` démarre une session détachée `frequi-gateway`, refuse de démarrer si le port est pris
     et peut être lancé deux fois sans risque. Arrêt : `screen -x frequi-gateway` puis Ctrl+C.
   - **Docker** : `docker build -f gateway/packaging/Dockerfile -t frequi-gateway gateway`. Limites : la découverte des bots demande
     `--pid=host`, les dossiers de configuration et de bases des bots doivent être montés aux mêmes chemins (la lecture seule suffit tant que le bot tourne ; la base d'un bot arrêté proprement n'est plus lisible sur un montage `:ro`, montez-le en lecture-écriture si besoin), avec
     l'identifiant utilisateur des bots ; en pratique le mode conteneur convient quand les bots tournent sur le même hôte Docker.
   - Directement : `frequi-gateway run`.

5. **Ouvrir l'interface.** Elle cherche la passerelle sur le même hôte, port 9399, en 1,5 s ; la page Réglages > Passerelle indique l'état
   et permet de donner une autre URL. Si rien ne répond elle reste en mode direct et réessaie chaque minute.

### Notes de sécurité

- La passerelle écoute par défaut sur `0.0.0.0:9399` en HTTP clair, comme les API des bots. Sur Internet, placez-la derrière un proxy
  inverse TLS et mettez `trust_forwarded_for = true` ; sur un réseau local, mettez dans `server.listen` l'adresse du réseau local.
- Toute route exige une session ; les écritures exigent aussi une `Origin` autorisée et une clé d'idempotence, et sont inscrites dans un
  journal d'audit ; les connexions sont limitées en débit et verrouillées après des échecs répétés. Jetons et secrets n'apparaissent jamais
  dans les journaux.
- Une action (sortie forcée, arrêt...) aboutit à l'API du bot lui-même : la passerelle ajoute des contrôles (paire et sens attendus,
  idempotence) et une ligne d'audit. Une session n'atteint que les bots dont le navigateur a prouvé le jeton d'accès.

## Revenir en arrière

| Quoi | Comment |
|---|---|
| L'interface | `freqtrade install-ui --ui-version <tag précédent>`, ou `deploy-ui.sh --target ... --rollback` (restaure la dernière sauvegarde, `--exact` retire aussi les nouveaux fichiers), ou décompresser à nouveau l'ancienne version. |
| La passerelle | L'arrêter (`screen -x frequi-gateway`, Ctrl+C, ou `systemctl --user stop frequi-gateway`). L'interface passe seule en mode direct. |
| Données du navigateur | Rien à faire : les anciennes clés n'ont jamais été supprimées. |

Aucune de ces étapes ne touche un bot ni sa configuration.

## Dépannage

| Symptôme | Cause et correction |
|---|---|
| Page blanche ou ancienne interface après la mise à jour | Rechargement forcé (Ctrl+Maj+R) ; vérifiez `curl http://<bot>/ui_version`. |
| L'interface reste en mode direct | La passerelle n'est pas joignable depuis le navigateur : vérifiez le port (`curl http://<hôte>:9399/gw/v1/hello`), le pare-feu, et que `cors_origins` contient l'adresse exacte de la page. |
| `403 origin_not_allowed` | `server.cors_origins` ne contient pas l'adresse de la page (schéma, hôte, port). |
| La passerelle démarre sans aucun bot | Pas sur la machine des bots, autre utilisateur, ou `discovery.proc_scan = false`. Lancez `frequi-gateway doctor`. |
| `ledger_unreadable` dans la vue santé | Une base n'est pas lisible : lancez `frequi-gateway doctor --deep` pour la raison (droits, autre utilisateur, fichier déplacé). Avec systemd, voir la note sur le bac à sable dans l'unité (un bot arrêté proprement laisse une base sans `-shm`, illisible si le système de fichiers est en lecture seule). |
| `check-config` dit qu'un secret est dans le fichier principal | `auth.password_hash` va uniquement dans `secrets.toml`. |
