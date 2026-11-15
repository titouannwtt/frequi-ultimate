# Demo fleet

A fully synthetic fleet of Freqtrade bots, to try the UI without any bot and to regenerate the
README screenshots. Nothing here talks to a real exchange, a real bot or the Internet: every bot,
trade, balance, price and log line is invented (deterministic for a given `--seed`).

## Start the fleet and open the UI

```bash
pnpm build                                   # once: produces dist/
python3 scripts/demo-fleet/server.py         # Python 3 standard library only
```

Then open <http://127.0.0.1:3050>. The simulated bots are not registered yet: log in to each one
(any username and password work) with the URLs below, or let `capture.mjs` seed them for you.

Useful options: `--bots N` (default 8), `--seed S` (default 42), `--base-port P` (default 3051),
`--ui-port P` (default 3050), `--dist PATH`, `--summary` (print the fleet and exit), `-v`.

## Regenerate the screenshots

With the server running:

```bash
node scripts/demo-fleet/capture.mjs .readme_illustrations
```

Playwright comes from `@playwright/test` (already a dev dependency); set `PLAYWRIGHT_BROWSERS_PATH`
if the browsers are not in the default location. The script seeds the bot connections in
`localStorage`, answers every external call (CoinGecko, alternative.me, GitHub) locally, waits until
the dashboard has loaded every bot (about 7 minutes), then writes the PNG files.

Options: `--only=name1,name2` (file names without `.png`), `--probe` (load `/dashboard`, `/trade`
and `/logs` and only list page errors, failed requests and external calls).

## Ports

| Port | Role |
| --- | --- |
| 3050 | UI (`dist/`, with SPA fallback) and `/__demo/*` helper endpoints |
| 3051 to 3058 | the 8 simulated bots (`--base-port`, one port per bot) |

Bots: `hl_meanrev_dca`, `hl_trend_short`, `hl_range_scalper`, `binance_btc_swing`,
`binance_grid_eth`, `bybit_breakout`, `bybit_funding_carry`, `binance_fut_reversal`.
