/**
 * Filter, sort and page a list of trade rows held in memory. DirectSource uses it for every
 * query; GatewaySource for the open trades, which the gateway returns whole (they are the
 * positions it already publishes).
 */
import type { TradeRow } from '@/gateway/types.gen';

import type { TradePage, TradeQuery } from '../types';
import { tradeTotals } from './stats';

export function pageTradeRows(rows: TradeRow[], q: TradeQuery, complete: boolean): TradePage {
  const kept = rows.filter(
    (r) =>
      (!q.pair || r.pair === q.pair) &&
      (!q.side || r.side === q.side) &&
      (!q.exitReason ||
        r.exit_reason.kind === q.exitReason ||
        r.exit_reason.raw === q.exitReason) &&
      (q.fromMs === undefined || (r.close_ms ?? r.open_ms) >= q.fromMs) &&
      (q.toMs === undefined || (r.close_ms ?? r.open_ms) <= q.toMs),
  );
  const sort = q.sort ?? (q.status === 'open' ? 'open_ms' : 'close_ms');
  const dir = q.order === 'asc' ? 1 : -1;
  const val = (r: TradeRow): number | string =>
    sort === 'pair'
      ? r.pair
      : sort === 'profit_abs'
        ? (r.profit_abs ?? Number.NEGATIVE_INFINITY)
        : sort === 'open_ms'
          ? r.open_ms
          : (r.close_ms ?? 0);
  kept.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    const c = va < vb ? -1 : va > vb ? 1 : 0;
    return c * dir || a.bot_key.localeCompare(b.bot_key) || a.trade_id - b.trade_id;
  });
  const limit = q.limit ?? 50;
  const start = q.cursor ? Number(q.cursor) || 0 : 0;
  return {
    items: kept.slice(start, start + limit),
    nextCursor: start + limit < kept.length ? String(start + limit) : null,
    complete,
    totals: tradeTotals(kept.map((r) => (r.profit_unknown ? null : r.profit_abs))),
  };
}
