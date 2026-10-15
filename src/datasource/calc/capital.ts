/**
 * Capital of a bot and of a set of bots on shared wallets. Port of `fg-core::calc::capital`.
 *
 * All the Hyperliquid bots of this fleet trade one wallet: `balance.total` reported by each bot is
 * the whole wallet, so summing it across bots multiplies the wallet by the number of bots (bug
 * B10). The rules:
 *
 * 1. The starting capital of a bot is its own allocation: `available_capital -
 *    capital_withdrawal` from its configuration, never derived from the wallet total.
 * 2. Without a configured allocation, a bot that does not share its wallet may derive it from its
 *    own balance minus its profit. A bot on a shared wallet stays unknown.
 * 3. Wallet-level figures (equity, exposure) are counted once per wallet, however many bots
 *    report them, and a stale report is excluded rather than summed.
 */
import type {
  Capital,
  CapitalInput,
  CapitalSum,
  WalletReport,
  WalletTotals,
} from '@/gateway/types.gen';

const UNKNOWN: Capital = { value: null, source: 'unknown' };

function positive(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

/** Starting capital of one bot and its provenance. Missing input fields mean "unknown". */
export function startingCapital(input: Partial<CapitalInput>): Capital {
  const avail = positive(input.available_capital);
  if (avail !== null) {
    const withdrawal =
      input.capital_withdrawal != null && Number.isFinite(input.capital_withdrawal)
        ? input.capital_withdrawal
        : 0;
    const net = positive(avail - withdrawal);
    return net === null ? { ...UNKNOWN } : { value: net, source: 'config' };
  }
  if (input.wallet_shared) {
    return { ...UNKNOWN };
  }
  const base = positive(input.bot_managed_balance) ?? positive(input.balance_total);
  const profit =
    input.profit_all_coin != null && Number.isFinite(input.profit_all_coin)
      ? input.profit_all_coin
      : null;
  if (base !== null && profit !== null) {
    const net = positive(base - profit);
    return net === null ? { ...UNKNOWN } : { value: net, source: 'derived' };
  }
  return { ...UNKNOWN };
}

/**
 * Sum the starting capitals of several bots. Unknown capitals are counted, never replaced by 0
 * silently: the caller decides whether a partial total may be shown.
 */
export function sumStartingCapital(capitals: ReadonlyArray<number | null>): CapitalSum {
  const s: CapitalSum = { total: 0, known: 0, unknown: 0 };
  for (const c of capitals) {
    const v = positive(c);
    if (v !== null) {
      s.total += v;
      s.known += 1;
    } else {
      s.unknown += 1;
    }
  }
  return s;
}

/**
 * Count each wallet once: among the fresh reports of a wallet the most recent wins. A wallet with
 * no fresh report is excluded (never summed stale).
 */
export function walletTotals(reports: readonly WalletReport[]): WalletTotals {
  const byWallet = new Map<string, WalletReport[]>();
  for (const r of reports) {
    const list = byWallet.get(r.wallet_id);
    if (list) {
      list.push(r);
    } else {
      byWallet.set(r.wallet_id, [r]);
    }
  }
  const out: WalletTotals = { total: 0, wallets: 0, excluded: [], conflicting: [] };
  // BTreeMap order on the Rust side: wallets by id.
  for (const id of [...byWallet.keys()].sort()) {
    const rs = byWallet.get(id) as WalletReport[];
    const fresh = rs.filter((r) => !r.stale && r.total != null && Number.isFinite(r.total));
    if (fresh.length === 0) {
      out.excluded.push(id);
      continue;
    }
    // `max_by_key` keeps the last of equally recent reports.
    let best = fresh[0];
    for (const r of fresh) {
      if (r.as_of_ms >= best.as_of_ms) {
        best = r;
      }
    }
    const value = best.total ?? 0;
    if (fresh.some((r) => Math.abs((r.total ?? 0) - value) > Math.max(Math.abs(value), 1) * 1e-4)) {
      out.conflicting.push(id);
    }
    out.total += value;
    out.wallets += 1;
  }
  return out;
}
