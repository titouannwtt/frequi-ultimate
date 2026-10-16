# Upgrading to FreqUI Ultimate 2.0

For anyone who already runs an earlier FreqUI Ultimate (0.x), or the stock FreqUI, and wants the 2.0 interface. Français : [UPGRADE.fr.md](UPGRADE.fr.md).

**Short version.** Install the new UI the way you installed the old one. Nothing to re-register: the list of your bots lives in your
browser (`localStorage`) and 2.0 reads it as it is. The gateway described below is optional; without it the UI works as before.

## What changes for you

- The UI is still a static site that **your bot serves** (same address, same port). Nothing runs in front of it, no bot is restarted.
- Your browser data is migrated on first load to new `fqu2.*` keys. **The old keys are never deleted**, so going back to the old UI
  finds your bots, groups, tags and alert settings untouched.
- New in 2.0: a Fleet / Bot / Charts / Journal layout, long and short in green and red with an arrow and an L/S letter, hold-to-confirm for
  live exits, French and English only. Strategy tools (StrategyDev, Backtest, Download data, Pairlist) moved to a discreet *Tools* menu.
- New and optional: **`frequi-gateway`**, a small service that reads your bots once and feeds every open tab and phone, instead of each
  browser polling every bot. The UI finds it by itself and falls back to direct mode if it goes away.

## Step 1: install the new UI

### With freqtrade-ultimate

```bash
freqtrade install-ui --ui-version v2.0.0
```

Without `--ui-version`, `install-ui` installs the latest release that is not a prerelease. Then reload the page once with
Ctrl+Shift+R. To check which UI a bot serves: `curl http://127.0.0.1:8080/ui_version` (use your bot's port).

### With stock freqtrade, or by hand

Stock `freqtrade install-ui` downloads the upstream FreqUI, not this fork. Download `frequi-ultimate-ui-v2.0.0.zip` from the
[releases page](https://github.com/titouannwtt/frequi-ultimate/releases) and unzip it into `freqtrade/rpc/api_server/ui/installed/`
(find it with `python -c "import freqtrade.rpc.api_server as a; print(a.__path__[0])"`). The zip has `index.html` at its root.

The fork-only panels (market pulse, risk overview, strategy editor) need the extra endpoints of
[freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate); against a stock bot they stay empty, as before.

### Safer: with a backup and a rollback

If you manage the `installed` directory yourself, `gateway/packaging/deploy-ui.sh` (in this repository) copies the new files next to the old
ones, switches `index.html` atomically, checks the result and keeps a backup (`installed.bak.<UTC stamp>`; only the 5 newest of those are kept, see `--keep`; copies you made by hand under other names are never pruned nor restored by `--rollback`):

```bash
unzip frequi-ultimate-ui-v2.0.0.zip -d /tmp/frequi-ui
gateway/packaging/deploy-ui.sh --target ~/freqtrade/freqtrade/rpc/api_server/ui/installed \
    --dist /tmp/frequi-ui --version v2.0.0 --url http://127.0.0.1:8080
```

### Docker / nginx image

The `Dockerfile` at the root builds the UI into an nginx image, as before. Rebuild it from the tag.

## Step 2 (optional): the gateway

Use it when you run several bots, or open the UI on several devices. Prerequisites: Linux, the gateway runs on the **same machine and
user as the bots** (it finds them by scanning `/proc`, reads their `api_server` settings from their config files, and opens their SQLite
trade databases read-only). It never changes a bot's config and never restarts a bot.

1. **Download and verify.** From the release page, take `frequi-gateway-x86_64-unknown-linux-musl` (or `aarch64`) and `SHA256SUMS`.

   ```bash
   sha256sum -c --ignore-missing SHA256SUMS
   install -D -m 0755 frequi-gateway-x86_64-unknown-linux-musl ~/.local/bin/frequi-gateway
   frequi-gateway version
   ```

2. **Look at the host (read-only).** `frequi-gateway doctor` lists the bots it found and what it can read.

3. **Configure.** Start from `gateway/packaging/config.example.toml`:

   ```bash
   mkdir -p ~/.config/frequi-gateway
   frequi-gateway print-default-config > ~/.config/frequi-gateway/config.toml
   $EDITOR ~/.config/frequi-gateway/config.toml
   frequi-gateway check-config
   ```

   The one setting you must change is `server.cors_origins`: the address you type in the browser to open FreqUI, for example
   `["http://192.168.1.20:8080"]` (scheme, host and port, no wildcard). Authentication is mandatory. By default the UI proves it holds a
   valid access token of one of your bots (nothing to type). To add a password of the gateway itself:

   ```bash
   frequi-gateway hash-password        # paste the printed hash in secrets.toml, mode 600:
   printf '[auth]\npassword_hash = "..."\n' > ~/.config/frequi-gateway/secrets.toml
   chmod 600 ~/.config/frequi-gateway/secrets.toml
   # and in config.toml: [auth] modes = ["token_proof", "password"]
   ```

4. **Run it**, with one of:
   - **systemd (user unit)**: `gateway/packaging/frequi-gateway.service`, install steps in the file header.
   - **screen**: `gateway/packaging/run-in-screen.sh` starts a detached session `frequi-gateway`, refuses to start if the port is taken, and is
     safe to run twice. Stop it with `screen -x frequi-gateway` then Ctrl+C.
   - **Docker**: `docker build -f gateway/packaging/Dockerfile -t frequi-gateway gateway`. Limits: bot discovery needs `--pid=host`, the bot
     config and database directories must be mounted at the same paths (read-only is enough while the bot runs; the database of a cleanly stopped bot cannot be read on a `:ro` mount, mount it read-write if you need that) with the bots' user id, so in practice the
     container mode suits a setup where the bots run on the same Docker host.
   - Plain: `frequi-gateway run`.

5. **Open the UI.** It looks for the gateway on the same host, port 9399, within 1.5 s; the Settings > Gateway page shows the status
   and lets you give another URL. If nothing answers it stays in direct mode and tries again every minute.

### Security notes

- The gateway listens on `0.0.0.0:9399` by default over plain HTTP, like the bot APIs. On the Internet put it behind a TLS reverse proxy and
  set `trust_forwarded_for = true`; on a LAN, set `server.listen` to the LAN address.
- Every route needs a session; writes also need an allowed `Origin` and an idempotency key, and are written to an audit log; logins are
  rate-limited and locked out after repeated failures. Tokens and secrets never appear in the logs.
- An action (forced exit, stop...) ends at the bot's own API: the gateway adds checks (expected pair and side, idempotency) and an audit line.
  A session only reaches the bots whose access token the browser proved.

## Roll back

| What | How |
|---|---|
| The UI | `freqtrade install-ui --ui-version <previous tag>`, or `deploy-ui.sh --target ... --rollback` (restores the latest backup, `--exact` also removes the new files), or unzip the old release again. |
| The gateway | Stop it (`screen -x frequi-gateway`, Ctrl+C, or `systemctl --user stop frequi-gateway`). The UI switches to direct mode by itself. |
| Browser data | Nothing to do: the old keys were never deleted. |

None of these steps touches a bot or its config.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Blank page or old UI after the update | Hard refresh (Ctrl+Shift+R); check `curl http://<bot>/ui_version`. |
| The UI stays in direct mode | The gateway is not reachable from the browser: check the port (`curl http://<host>:9399/gw/v1/hello`), the firewall, and that `cors_origins` has the exact address of the page. |
| `403 origin_not_allowed` | `server.cors_origins` does not list the page's address (scheme, host, port). |
| The gateway starts with no bot | Not on the machine of the bots, another user, or `discovery.proc_scan = false`. Run `frequi-gateway doctor`. |
| `ledger_unreadable` in the health view | A database cannot be read: run `frequi-gateway doctor --deep` for the reason (permissions, another user, a moved file). With systemd, see the sandbox note in the unit file (a cleanly stopped bot leaves a database without `-shm`, unreadable on a read-only file system). |
| `check-config` says a secret is in the main file | `auth.password_hash` goes in `secrets.toml` only. |
