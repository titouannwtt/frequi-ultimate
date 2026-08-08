/**
 * Types for GET /fleet/snapshot — one response describing every bot in the fleet.
 *
 * The figures are digests each bot pushed to the shared daemon on its own cycle, so every
 * entry carries `age_s`. A client must be able to tell a live figure from one left behind
 * by a bot that has since stopped: staleness that is not surfaced is worse than a slow
 * dashboard. Fields the bot could not produce cheaply are absent rather than guessed —
 * hence the optionals.
 */

export interface FleetBotDigest {
  bot_name: string;
  state: string;
  dry_run: boolean;
  exchange: string;
  strategy: string;
  stake_currency: string;
  trading_mode: string;
  open_trade_count: number;
  max_open_trades: number;
  closed_profit_abs: number;
  balance_total: number;
  /** Age of the wallet snapshot the balance came from. Null when never synced. */
  wallet_age_s?: number | null;
  /** Omitted when the bot's rate cache could not price open trades. */
  open_profit_abs?: number;
  /** Seconds since this bot last pushed. Always present. */
  age_s: number;
}

export interface FleetSnapshotResponse {
  ok?: boolean;
  ts?: number;
  bot_count?: number;
  bots?: Record<string, FleetBotDigest>;
  /** Present when the daemon could not be reached — the caller must fall back. */
  error?: string;
}
