/** English messages of the Tools pages (`fq.pg.tools.*`). Same keys as tools.fr.ts. */
export default {
  tag: { python: 'Python', perBot: 'per bot' },
  refresh: 'Refresh',
  bot: 'Bot',
  mode: 'Trading mode',
  reconciliation: {
    sub: 'The wallet against the databases of the bots. Read at most once a minute; a correction asks for a preview, the name of the coin and a 1 s hold.',
    tooSoon: 'The next sweep is possible in {s} s',
    err: {
      noBot: 'No bot answers: the wallet cannot be read.',
      source: 'No data source is connected: the wallet cannot be read.',
      noServing:
        'No bot could give the reconciliation. It is served by bots that run the fleet tooling.',
      timeout:
        'The sweep of the wallet did not answer in time. The exchange may be rate limited: no new sweep starts on its own.',
      resting:
        'The last sweep just failed. The wallet is left alone so as not to overload the exchange: another try is possible in {s} s.',
      failed: 'The sweep of the wallet failed. Try again in a moment; every try asks the exchange.',
    },
  },
  diagnostic: {
    sub: 'The health of the fleet, then the requests of one bot: the 429 and the backoffs only exist per bot.',
    fleet: 'Fleet',
    timeline: 'Request timeline',
    timelineHint: 'Taken from the bot chosen here, through its own metrics.',
  },
  risk: {
    sub: 'The exposure of the wallet in full, and a stress test against the real liquidation prices.',
  },
  logs: { sub: 'Logs of one bot or the errors of all of them, filtered by the server.' },
  volume: {
    sub: 'Traded volume of the pairs of one bot over time. The answer is kept five minutes.',
  },
  replay: {
    sub: 'Replays the live loop on history into the database of a dry bot. Wiping the database first needs the name of the bot.',
    state: 'Replay',
    running: 'Running, {p} %',
    seeded: 'Seeded',
    idle: 'Not run',
    open: 'Open the replay',
    none: 'No dry bot',
    noneHint: 'The replay only writes into the database of a dry bot.',
  },
};
