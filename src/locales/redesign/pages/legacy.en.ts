/** Messages of the legacy tools (Backtest, Download data, Pairlist), keys `fq.pg.legacy.*`. Same keys as legacy.fr.ts. */
export default {
  noBot: 'No bot registered',
  noBotHint: 'Add a bot in Settings to use this tool.',
  silent: '{name} does not answer',
  silentHint: 'This tool reads the bot directly. Try again when it is online.',
  unavailable: 'Not available on this bot',
  unavailableHint:
    'The bot {name} runs in {mode} mode. This tool needs a bot in webserver mode: on a trading bot its API answers 503.',
  unavailableHintNoMode:
    'This tool needs a bot in webserver mode: on a trading bot such as {name}, its API answers 503.',
  use: 'Use {name}',
  timerange: { start: 'Start date', end: 'End date', label: 'Range' },
  download: {
    pairPlaceholder: 'Pair',
    timeframePlaceholder: 'Timeframe',
    fromPairlist: 'Use the pairs of the pairlist config',
    customTimerange: 'Custom date range',
    daysAria: 'Days to download',
    advanced: 'Advanced options',
    advancedNote:
      'Advanced options (erase data, download trades, custom exchange) are only applied when this section is open.',
    erase: 'Erase existing data',
    prepend: 'Prepend data to the existing ones',
    trades: 'Download trades instead of candles',
    candleTypes: 'Candle types',
    candleTypesHint:
      'When no type is selected, freqtrade downloads the types needed for regular operation by itself.',
    customExchange: 'Custom exchange',
    start: 'Start download',
    needPairs: 'Add at least one pair and one timeframe.',
  },
  pairlist: {
    stakeCurrency: 'Stake currency',
    customExchange: 'Custom exchange',
    mustStartWithGenerator:
      'The first entry of the pairlist must be a generator, like StaticPairList or VolumePairList.',
    dragHere: 'Drag a pairlist here',
    config: 'Config',
    results: 'Results',
    save: 'Save the configuration',
    evaluate: 'Evaluate',
    evaluateTip: 'Evaluate the pairlist',
    blacklist: 'Blacklist',
    copyFrom: 'Copy from',
    copy: 'Copy',
    add: 'Add',
  },
};
