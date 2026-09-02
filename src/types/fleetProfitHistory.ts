/**
 * Types for GET /fleetview/profit_history — every local bot's sampled profit curve in one call.
 *
 * The per-bot `/profit_history` endpoint is the single heaviest thing the dashboard pulls
 * (8.4 MB across a 45-bot fleet, because each bot ships its full ledger). The aggregate reads
 * the same SQLite ledgers directly on the host, decimates them server-side and answers in one
 * ~600 kB response.
 *
 * Two properties matter to the caller. The series are DECIMATED, so `data.length` is a target
 * point count, not the sample count: `total` says how many rows actually exist. And any bot
 * whose ledger could not be read lands in `errors` under a normalised code instead of
 * aborting the response, so a partial answer is the normal case, not a failure.
 */

/** Rows of [timestamp_ms, profit_closed_abs, profit_open_abs, open_trades]. */
export type ProfitHistoryPoints = [number, number, number, number][];

export interface FleetProfitHistoryBot {
  /** The bot's own reported name, not a UI botId — join through the bot-name registry. */
  bot_name: string;
  port: number;
  dry_run: boolean;
  strategy: string;
  state: string;
  /** Number of points actually returned (after decimation). */
  length: number;
  /** Number of samples in the ledger over the window; larger than `length` when thinned. */
  total: number;
  last_ts: number | null;
  data: ProfitHistoryPoints;
}

export interface FleetProfitHistoryResponse {
  generated_at: number;
  since: number;
  points: number;
  bot_count: number;
  /** True when the server ran out of its time budget: the answer is missing bots. */
  truncated: boolean;
  etag: string;
  bots: FleetProfitHistoryBot[];
  /** bot_name -> normalised failure code, for ledgers that could not be read. */
  errors: Record<string, string>;
}
