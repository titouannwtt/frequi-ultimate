# Architecture diagram

[`frequi-architecture.html`](frequi-architecture.html) — interactive diagram (pan/zoom,
light/dark theme) of how FreqUI Ultimate talks to a Freqtrade fleet: Pinia stores poll every
bot's REST API independently and merge the results client-side into the fleet dashboard, with
a separate branch for the fork-only endpoints (`/fleet/*`, `/stratdev/*`) that only exist on
[freqtrade-ultimate](https://github.com/titouannwtt/freqtrade-ultimate).

For the backend side of this same relationship (the REST API surface, the bot loop, the
shared-caching daemons), see
[freqtrade-ultimate/docs/diagrams](https://github.com/titouannwtt/freqtrade-ultimate/tree/main/docs/diagrams).

Rendered with [archify](https://github.com/tt-a1i/archify) from
`frequi-architecture.architecture.json`; regenerate after a source change with:

```bash
node bin/archify.mjs deliver architecture frequi-architecture.architecture.json frequi-architecture.html --quality showcase
```
