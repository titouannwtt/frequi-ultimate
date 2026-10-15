/**
 * Exposure, computed at wallet level. Port of `fg-core::calc::exposure`.
 *
 * Hyperliquid nets positions per coin on a wallet: a long of one bot and a short of another on the
 * same coin offset each other on the exchange. Exposure is therefore aggregated per coin key
 * (see `hip3.parsePair().coin_key`) over the positions of a wallet, never summed per bot.
 */
import type { Exposure, ExposurePosition } from '@/gateway/types.gen';

/** Aggregate the positions of one wallet. `long` and `short` are the gross sides before netting. */
export function exposure(positions: readonly ExposurePosition[]): Exposure {
  const e: Exposure = { long: 0, short: 0, net: 0, net_by_coin: {}, gross_netted: 0 };
  for (const p of positions) {
    if (!Number.isFinite(p.notional)) {
      continue;
    }
    let signed: number;
    if (p.side === 'long') {
      e.long += p.notional;
      signed = p.notional;
    } else {
      e.short += p.notional;
      signed = -p.notional;
    }
    e.net_by_coin[p.coin] = (e.net_by_coin[p.coin] ?? 0) + signed;
  }
  e.net = e.long - e.short;
  e.gross_netted = Object.values(e.net_by_coin).reduce((acc, v) => acc + Math.abs(v), 0);
  return e;
}
