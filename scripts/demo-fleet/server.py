#!/usr/bin/env python3
"""Demo fleet for FreqUI Ultimate.

Simulates the REST API (plus the fork-specific fleet routes) of several Freqtrade
bots, entirely with synthetic data, and serves the built UI (`dist/`) next to them.
No real exchange, wallet, database or bot is ever contacted.

    python3 scripts/demo-fleet/server.py                  # 8 bots, UI on :3050
    python3 scripts/demo-fleet/server.py --bots 4 --seed 7

Everything is deterministic for a given `--seed`, and every timestamp is relative to
the moment the server starts, so the data always looks recent. Restart the server to
refresh it. Standard library only.
"""

import argparse
import base64
import hashlib
import json
import math
import mimetypes
import os
import random
import signal
import socket
import struct
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse


API_VERSION = 2.53
BOT_VERSION = "2026.10"
UI_VERSION = "2.2.0"
FIAT = "USD"
FAKE_WALLET = "0xDEMO000000000000000000000000000000000000"
DAY = 86400

STOP = threading.Event()

# --------------------------------------------------------------------------------------
# Synthetic market
# --------------------------------------------------------------------------------------

# coin -> (base price now, relative volatility)
COINS = {
    "BTC": (96000.0, 0.6),
    "ETH": (3400.0, 0.8),
    "SOL": (190.0, 1.0),
    "XRP": (2.4, 1.0),
    "DOGE": (0.18, 1.3),
    "AVAX": (38.0, 1.1),
    "LINK": (18.0, 1.0),
    "ARB": (0.75, 1.3),
    "OP": (1.9, 1.3),
    "SUI": (3.6, 1.4),
    "ADA": (0.72, 1.1),
    "NEAR": (5.2, 1.2),
    "APT": (8.4, 1.2),
    "INJ": (22.0, 1.3),
    "TIA": (6.1, 1.4),
    "AAVE": (280.0, 1.0),
    "UNI": (9.5, 1.1),
    "LTC": (105.0, 0.9),
    "DOT": (6.8, 1.1),
    "ATOM": (6.2, 1.1),
    "FIL": (4.6, 1.3),
    "SEI": (0.38, 1.5),
    "WIF": (1.6, 1.6),
    "ENA": (0.52, 1.5),
}

# CoinGecko ids used by the UI for its market overview / benchmark overlays.
GECKO_IDS = {
    "bitcoin": "BTC",
    "ethereum": "ETH",
    "solana": "SOL",
    "ripple": "XRP",
    "dogecoin": "DOGE",
    "avalanche-2": "AVAX",
    "chainlink": "LINK",
    "cardano": "ADA",
    "litecoin": "LTC",
    "polkadot": "DOT",
}

PERIODS = [2400, 7200, 25200, 95000, 320000, 950000, 2500000, 7200000]
AMPS = [0.0012, 0.0025, 0.005, 0.010, 0.022, 0.045, 0.075, 0.11]


class Market:
    """Deterministic price function: price(coin, ts) = base * exp(h(ts) - h(now))."""

    def __init__(self, seed, now):
        self.seed = seed
        self.now = now
        self._params = {}

    def _p(self, coin):
        p = self._params.get(coin)
        if p is None:
            rng = random.Random(f"{self.seed}:market:{coin}")
            base, vol = COINS.get(coin, (10.0, 1.2))
            phases = [rng.uniform(0, 2 * math.pi) for _ in PERIODS]
            amps = [a * vol * rng.uniform(0.7, 1.3) for a in AMPS]
            idx = rng.randrange(1, 1 << 20)
            p = (base, vol, phases, amps, idx)
            self._params[coin] = p
        return p

    @staticmethod
    def _noise(idx, minute):
        x = (minute * 374761393 + idx * 668265263) & 0xFFFFFFFF
        x = ((x ^ (x >> 13)) * 1274126177) & 0xFFFFFFFF
        x ^= x >> 16
        return x / 4294967296.0 - 0.5

    def _h(self, coin, ts):
        _, vol, phases, amps, idx = self._p(coin)
        s = 0.0
        for per, ph, a in zip(PERIODS, phases, amps):
            s += a * math.sin(2 * math.pi * ts / per + ph)
        return s + 0.0022 * vol * self._noise(idx, int(ts // 60))

    def price(self, coin, ts):
        base = self._p(coin)[0]
        return base * math.exp(self._h(coin, ts) - self._h(coin, self.now))


# --------------------------------------------------------------------------------------
# Bot specifications
# --------------------------------------------------------------------------------------

EXCHANGES = {
    "hyperliquid": {"fee": 0.00045, "name": "Hyperliquid"},
    "binance": {"fee": 0.001, "name": "Binance"},
    "bybit": {"fee": 0.00055, "name": "Bybit"},
}

FUT_COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "AVAX", "LINK", "ARB", "OP", "SUI", "ADA", "NEAR", "APT", "INJ"]
SPOT_COINS = ["BTC", "ETH", "SOL", "LINK", "AVAX", "ADA", "LTC", "DOT"]

BOT_SPECS = [
    dict(
        name="hl_meanrev_dca", exchange="hyperliquid", mode="futures", stake="USDC", dry=False,
        direction="long", lev=2, tf="15m", capital=5000, margin=200, max_open=5, dca_max=3,
        dca_step=0.03, days=150, rate=5.0, wr=0.92, win=0.019, loss=0.025, dur_h=9.0, sl=0.30,
        strategy="MeanRevDCA", tags=["rsi_oversold", "bb_lower_touch", "vwap_dip"],
        coins=FUT_COINS, open_kinds=["win", "dca_loss", "win", "dca_win"], bad_wr=0.62,
    ),
    dict(
        name="hl_trend_short", exchange="hyperliquid", mode="futures", stake="USDC", dry=False,
        direction="short", lev=3, tf="1h", capital=3000, margin=200, max_open=3, dca_max=0,
        dca_step=0.0, days=120, rate=1.6, wr=0.47, win=0.085, loss=0.04, dur_h=30.0, sl=0.12,
        strategy="TrendShort", tags=["ema_breakdown", "lower_high", "adx_trend"],
        coins=FUT_COINS, open_kinds=["win", "loss"], bad_wr=0.30,
    ),
    dict(
        name="hl_range_scalper", exchange="hyperliquid", mode="futures", stake="USDC", dry=True,
        direction="both", lev=2, tf="5m", capital=2000, margin=100, max_open=6, dca_max=0,
        dca_step=0.0, days=75, rate=12.0, wr=0.64, win=0.011, loss=0.010, dur_h=1.2, sl=0.05,
        strategy="RangeScalper", tags=["range_top", "range_bottom", "vol_squeeze"],
        coins=FUT_COINS, open_kinds=["win", "loss", "win"], bad_wr=0.45,
    ),
    dict(
        name="binance_btc_swing", exchange="binance", mode="spot", stake="USDT", dry=False,
        direction="long", lev=1, tf="4h", capital=8000, margin=1200, max_open=3, dca_max=0,
        dca_step=0.0, days=160, rate=0.7, wr=0.58, win=0.055, loss=0.038, dur_h=48.0, sl=0.08,
        strategy="SwingTrend", tags=["macd_cross", "weekly_support", "ema200_reclaim"],
        coins=SPOT_COINS, open_kinds=["win", "win", "loss"], bad_wr=0.35,
    ),
    dict(
        name="binance_grid_eth", exchange="binance", mode="spot", stake="USDT", dry=True,
        direction="long", lev=1, tf="15m", capital=1500, margin=150, max_open=5, dca_max=2,
        dca_step=0.02, days=90, rate=6.0, wr=0.89, win=0.015, loss=0.025, dur_h=5.0, sl=0.20,
        strategy="GridAccumulator", tags=["grid_level_1", "grid_level_2", "rsi_cooldown"],
        coins=SPOT_COINS, open_kinds=["dca_win", "dca_loss", "win", "dca_win"], bad_wr=0.62,
    ),
    dict(
        name="bybit_breakout", exchange="bybit", mode="futures", stake="USDT", dry=False,
        direction="long", lev=2, tf="1h", capital=6000, margin=400, max_open=4, dca_max=0,
        dca_step=0.0, days=110, rate=2.0, wr=0.43, win=0.085, loss=0.034, dur_h=22.0, sl=0.10,
        strategy="DonchianBreakout", tags=["donchian_20", "volume_spike", "atr_expansion"],
        coins=FUT_COINS, open_kinds=["win", "win", "loss"], bad_wr=0.25,
    ),
    dict(
        name="bybit_funding_carry", exchange="bybit", mode="futures", stake="USDT", dry=True,
        direction="short", lev=2, tf="1h", capital=2500, margin=250, max_open=4, dca_max=0,
        dca_step=0.0, days=60, rate=2.5, wr=0.78, win=0.018, loss=0.035, dur_h=14.0, sl=0.10,
        strategy="FundingCarry", tags=["funding_high", "basis_wide"],
        coins=FUT_COINS, open_kinds=["win", "win"], bad_wr=0.50,
    ),
    dict(
        name="binance_fut_reversal", exchange="binance", mode="futures", stake="USDT", dry=True,
        direction="both", lev=3, tf="30m", capital=3500, margin=200, max_open=4, dca_max=0,
        dca_step=0.0, days=95, rate=4.0, wr=0.57, win=0.036, loss=0.028, dur_h=6.0, sl=0.09,
        strategy="ReversalHunter", tags=["rsi_divergence", "wick_reject", "liquidity_sweep"],
        coins=FUT_COINS, open_kinds=["win", "loss", "win"], bad_wr=0.35,
    ),
]

TF_MIN = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240, "1d": 1440}


def fmt_dt(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def iso_dt(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000")


def human_ago(delta_s):
    d = int(delta_s)
    if d < 90:
        return "a minute ago"
    if d < 3600:
        return f"{d // 60} minutes ago"
    if d < 86400:
        h = d // 3600
        return "an hour ago" if h == 1 else f"{h} hours ago"
    days = d // 86400
    if days < 30:
        return "a day ago" if days == 1 else f"{days} days ago"
    if days < 365:
        m = days // 30
        return "a month ago" if m == 1 else f"{m} months ago"
    return "a year ago"


def r2(x, n=2):
    return round(float(x), n)


PRICE_KEYS = (
    "open_rate",
    "open_rate_requested",
    "close_rate",
    "close_rate_requested",
    "current_rate",
    "stop_loss_abs",
    "initial_stop_loss_abs",
    "liquidation_price",
    "min_rate",
    "max_rate",
    "stoploss_current_dist",
    "stoploss_entry_dist",
)


def sig(x, n=6):
    """Round to n significant digits (prices look like exchange prices, not raw floats)."""
    if x is None or x == 0:
        return x
    return round(x, n - 1 - int(math.floor(math.log10(abs(x)))))


# --------------------------------------------------------------------------------------
# Trades
# --------------------------------------------------------------------------------------


class Trade:
    """A trade: a list of entries (ts, price, margin) and an optional exit."""

    def __init__(self, bot, pair, coin, is_short, entries, tag):
        self.bot = bot
        self.pair = pair
        self.coin = coin
        self.is_short = is_short
        self.entries = entries  # list of dicts: ts, price, margin
        self.tag = tag
        self.tid = 0
        self.exit_ts = None
        self.exit_price = None
        self.exit_reason = None
        self.min_rate = None
        self.max_rate = None

    # position -----------------------------------------------------------------------
    def position(self, upto=None):
        ents = [e for e in self.entries if upto is None or e["ts"] <= upto]
        lev = self.bot.lev
        notional = sum(e["margin"] * lev for e in ents)
        amount = sum(e["margin"] * lev / e["price"] for e in ents)
        stake = sum(e["margin"] for e in ents)
        avg = notional / amount if amount else 0.0
        return amount, avg, stake, notional

    def profit_abs_at(self, price, upto=None):
        amount, avg, _, notional = self.position(upto)
        if not amount:
            return 0.0
        d = -1.0 if self.is_short else 1.0
        fo, fc = self.bot.fee, self.bot.fee
        return d * (price - avg) * amount - fo * notional - fc * amount * price

    @property
    def is_open(self):
        return self.exit_ts is None

    @property
    def open_ts(self):
        return self.entries[0]["ts"]

    @property
    def profit_abs(self):
        return self.profit_abs_at(self.exit_price)

    @property
    def profit_ratio(self):
        stake = self.position()[2]
        return self.profit_abs / stake if stake else 0.0

    @property
    def close_ts(self):
        return self.exit_ts

    @property
    def notional_volume(self):
        amount, _, _, notional = self.position()
        vol = notional
        if self.exit_ts:
            vol += amount * self.exit_price
        return vol


def solve_exit_price(avg, ratio, lev, fee, is_short):
    """Exit price giving a net profit ratio (relative to margin) after fees."""
    if is_short:
        return avg * (1 - fee - ratio / lev) / (1 + fee)
    return avg * (1 + fee + ratio / lev) / (1 - fee)


class Bot:
    def __init__(self, spec, port, market, seed, now):
        self.spec = spec
        self.port = port
        self.market = market
        self.seed = seed
        self.now = now
        self.name = spec["name"]
        self.exchange = spec["exchange"]
        self.dry = spec["dry"]
        self.mode = spec["mode"]
        self.stake_currency = spec["stake"]
        self.lev = float(spec["lev"])
        self.fee = EXCHANGES[self.exchange]["fee"]
        self.tf = spec["tf"]
        self.tf_min = TF_MIN[self.tf]
        self.capital = float(spec["capital"])
        self.rng = random.Random(f"{seed}:bot:{self.name}")
        self.start_ts = now - spec["days"] * DAY
        self.pid = 20000 + self.rng.randrange(30000)
        self.pairs = [self.pair_of(c) for c in spec["coins"]]
        self._cache = {}
        self.open_trades = []
        self.closed_trades = []
        self._gen_open()
        self._gen_closed()
        allt = sorted(self.open_trades + self.closed_trades, key=lambda t: t.open_ts)
        for i, t in enumerate(allt, 1):
            t.tid = i
        self.all_trades = allt

    # naming ---------------------------------------------------------------------------
    def pair_of(self, coin):
        q = self.stake_currency
        return f"{coin}/{q}:{q}" if self.mode == "futures" else f"{coin}/{q}"

    def coin_of(self, pair):
        return pair.split("/")[0]

    # generation -----------------------------------------------------------------------
    def _direction(self, rng):
        d = self.spec["direction"]
        if d == "both":
            return rng.random() < 0.5
        return d == "short"

    def _gen_open(self):
        spec, rng = self.spec, self.rng
        used = set()
        for kind in spec["open_kinds"]:
            best, best_score = None, None
            for _ in range(260):
                coin = rng.choice(spec["coins"])
                if coin in used:
                    continue
                # open positions are about as old as a typical closed trade (a few multiples at most)
                age = max(rng.uniform(0.2, 2.6) * spec["dur_h"] * 3600, 1800)
                if self.tf_min >= 240:
                    age = rng.uniform(1.0, 6.0) * DAY
                t0 = int(self.now - age)
                is_short = self._direction(rng)
                tr = self._simulate_open(coin, is_short, t0)
                ratio = tr.profit_ratio_now
                n = len(tr.entries)
                if kind == "win":
                    ok = 0.012 <= ratio <= 0.07 and n == 1
                    score = abs(ratio - 0.03)
                elif kind == "loss":
                    ok = -0.10 <= ratio <= -0.025 and n == 1
                    score = abs(ratio + 0.05)
                elif kind == "dca_win":
                    ok = n >= 2 and 0.004 <= ratio <= 0.05
                    score = abs(ratio - 0.02) + (0 if n >= 2 else 1)
                else:  # dca_loss
                    ok = n >= 3 and -0.14 <= ratio <= -0.03
                    score = abs(ratio + 0.07) + (0 if n >= 3 else 1)
                if ok:
                    best = tr
                    break
                if best is None or score < best_score:
                    best, best_score = tr, score
            used.add(best.coin)
            self.open_trades.append(best)

    def _simulate_open(self, coin, is_short, t0):
        spec, rng = self.spec, self.rng
        pair = self.pair_of(coin)
        m = self.market
        margin = spec["margin"] * rng.uniform(0.85, 1.15)
        price = m.price(coin, t0)
        entries = [{"ts": t0, "price": price, "margin": margin}]
        last = price
        n_dca = 0
        step = 1800
        t = t0 + step
        while t < self.now and n_dca < spec["dca_max"]:
            p = m.price(coin, t)
            trig = last * (1 + spec["dca_step"]) if is_short else last * (1 - spec["dca_step"])
            if (is_short and p >= trig) or (not is_short and p <= trig):
                n_dca += 1
                entries.append({"ts": t + rng.randrange(20, 240), "price": p, "margin": margin * 1.3**n_dca})
                last = p
            t += step
        tr = Trade(self, pair, coin, is_short, entries, rng.choice(spec["tags"]))
        cur = m.price(coin, self.now)
        tr.current_rate = cur
        tr.profit_ratio_now = tr.profit_abs_at(cur) / tr.position()[2]
        return tr

    def _gen_closed(self):
        spec = self.spec
        rng = random.Random(f"{self.seed}:closed:{self.name}")
        m = self.market
        lev, fee = self.lev, self.fee
        # bad windows -> equity dips
        windows = []
        for _ in range(2):
            ws = self.start_ts + rng.uniform(0.15, 0.85) * (self.now - self.start_ts)
            windows.append((ws, ws + rng.uniform(5, 9) * DAY))
        pair_free = {}
        for t in self.open_trades:
            pair_free[t.pair] = -t.open_ts  # closed trades must end before this
        free_at = {}
        active = []
        t = self.start_ts + rng.uniform(0, 3600)
        end = self.now - 900
        while True:
            t += rng.expovariate(spec["rate"] / DAY)
            if t > end - 600:
                break
            active = [c for c in active if c > t]
            if len(active) >= spec["max_open"] - len(self.open_trades) // 2:
                continue
            coin = rng.choice(spec["coins"])
            pair = self.pair_of(coin)
            if free_at.get(pair, 0) > t:
                continue
            dur = rng.lognormvariate(math.log(spec["dur_h"] * 3600), 0.8)
            dur = min(max(dur, self.tf_min * 60 * 2), 7 * DAY)
            close_ts = int(t + dur)
            if close_ts > end:
                continue
            if pair in pair_free and close_ts > -pair_free[pair] - 600:
                continue
            free_at[pair] = close_ts
            active.append(close_ts)
            in_bad = any(a <= close_ts <= b for a, b in windows)
            wr = spec["bad_wr"] if in_bad else spec["wr"]
            win = rng.random() < wr
            is_short = self._direction(rng)
            if win:
                ratio = min(rng.lognormvariate(math.log(spec["win"]), 0.45), spec["win"] * 3.5)
            else:
                sev = 1.5 if in_bad else 1.0
                ratio = -min(
                    rng.lognormvariate(math.log(spec["loss"] * sev), 0.4), spec["sl"] * 1.02
                )
            # DCA ladder
            probs = [0.15, 0.25, 0.30, 0.30] if not win else [0.72, 0.20, 0.07, 0.01]
            n_dca = 0
            if spec["dca_max"]:
                x, acc = rng.random(), 0.0
                for i, pr in enumerate(probs):
                    acc += pr
                    if x < acc:
                        n_dca = min(i, spec["dca_max"])
                        break
            open_ts = int(t)
            margin = spec["margin"] * rng.uniform(0.85, 1.15)
            p0 = m.price(coin, open_ts)
            entries = [{"ts": open_ts, "price": p0, "margin": margin}]
            for i in range(1, n_dca + 1):
                off = spec["dca_step"] * i * rng.uniform(0.8, 1.25)
                pi = p0 * (1 + off) if is_short else p0 * (1 - off)
                entries.append(
                    {
                        "ts": int(open_ts + dur * (i / (n_dca + 1)) * rng.uniform(0.7, 1.0)),
                        "price": pi,
                        "margin": margin * 1.3**i,
                    }
                )
            tr = Trade(self, pair, coin, is_short, entries, rng.choice(spec["tags"]))
            _, avg, _, _ = tr.position()
            tr.exit_ts = close_ts
            tr.exit_price = solve_exit_price(avg, ratio, lev, fee, is_short)
            if win:
                tr.exit_reason = rng.choices(
                    ["roi", "exit_signal", "trailing_stop_loss"], [55, 33, 12]
                )[0]
            else:
                tr.exit_reason = rng.choices(
                    ["stop_loss", "exit_signal", "force_exit"], [48, 44, 8]
                )[0]
            prices = [e["price"] for e in entries] + [tr.exit_price]
            tr.min_rate = min(prices) * (1 - rng.uniform(0.001, 0.006))
            tr.max_rate = max(prices) * (1 + rng.uniform(0.001, 0.006))
            self.closed_trades.append(tr)
        self.closed_trades.sort(key=lambda x: x.close_ts)

    # cached computations --------------------------------------------------------------
    def memo(self, key, fn):
        if key not in self._cache:
            self._cache[key] = fn()
        return self._cache[key]

    def open_profit_now(self):
        return sum(t.profit_abs_at(t.current_rate) for t in self.open_trades)

    def closed_profit(self):
        return sum(t.profit_abs for t in self.closed_trades)

    def balance_total(self):
        return self.capital + self.closed_profit() + self.open_profit_now()

    def used_margin(self):
        return sum(t.position()[2] for t in self.open_trades)

    # trade -> API dict ----------------------------------------------------------------
    def trade_dict(self, t):
        amount, avg, stake, notional = t.position()
        is_open = t.is_open
        d = -1.0 if t.is_short else 1.0
        fee = self.fee
        mode = self.mode
        entry_side = "sell" if t.is_short else "buy"
        exit_side = "buy" if t.is_short else "sell"
        orders = []
        for i, e in enumerate(t.entries):
            amt = e["margin"] * self.lev / e["price"]
            orders.append(
                {
                    "pair": t.pair,
                    "order_id": f"demo-{t.tid}-e{i + 1}",
                    "status": "closed",
                    "remaining": 0.0,
                    "amount": amt,
                    "safe_price": e["price"],
                    "cost": e["margin"] * self.lev,
                    "filled": amt,
                    "ft_order_side": entry_side,
                    "order_type": "limit",
                    "is_open": False,
                    "order_timestamp": (e["ts"] - 3) * 1000,
                    "order_filled_timestamp": e["ts"] * 1000,
                    "ft_is_entry": True,
                    "ft_order_tag": t.tag if i == 0 else None,
                    "order_date": fmt_dt(e["ts"] - 3),
                    "order_filled_date": fmt_dt(e["ts"]),
                    "average": e["price"],
                    "price": e["price"],
                }
            )
        if not is_open:
            orders.append(
                {
                    "pair": t.pair,
                    "order_id": f"demo-{t.tid}-x1",
                    "status": "closed",
                    "remaining": 0.0,
                    "amount": amount,
                    "safe_price": t.exit_price,
                    "cost": amount * t.exit_price,
                    "filled": amount,
                    "ft_order_side": exit_side,
                    "order_type": "limit",
                    "is_open": False,
                    "order_timestamp": (t.exit_ts - 2) * 1000,
                    "order_filled_timestamp": t.exit_ts * 1000,
                    "ft_is_entry": False,
                    "ft_order_tag": t.exit_reason,
                    "order_date": fmt_dt(t.exit_ts - 2),
                    "order_filled_date": fmt_dt(t.exit_ts),
                    "average": t.exit_price,
                    "price": t.exit_price,
                }
            )
        open_value = notional * (1 - fee) if t.is_short else notional * (1 + fee)
        sl_ratio = -self.spec["sl"]
        sl_abs = avg * (1 + d * sl_ratio / self.lev)
        first = t.entries[0]
        init_sl = first["price"] * (1 + d * sl_ratio / self.lev)
        liq = None
        if mode == "futures":
            liq = avg * (1 + 1 / self.lev - 0.005) if t.is_short else avg * (1 - 1 / self.lev + 0.005)
        out = {
            "trade_id": t.tid,
            "pair": t.pair,
            "base_currency": t.coin,
            "quote_currency": self.stake_currency,
            "is_open": is_open,
            "is_short": t.is_short,
            "exchange": self.exchange,
            "amount": amount,
            "amount_requested": amount,
            "stake_amount": stake,
            "max_stake_amount": stake,
            "strategy": self.spec["strategy"],
            "enter_tag": t.tag,
            "timeframe": self.tf_min,
            "fee_open": fee,
            "fee_open_cost": notional * fee,
            "fee_open_currency": self.stake_currency,
            "fee_close": fee,
            "fee_close_cost": (amount * t.exit_price * fee) if not is_open else None,
            "fee_close_currency": self.stake_currency,
            "open_date": fmt_dt(first["ts"]),
            "open_timestamp": first["ts"] * 1000,
            "open_fill_date": fmt_dt(first["ts"]),
            "open_fill_timestamp": first["ts"] * 1000,
            "open_rate": avg,
            "open_rate_requested": first["price"],
            "open_trade_value": open_value,
            "close_date": fmt_dt(t.exit_ts) if not is_open else None,
            "close_timestamp": t.exit_ts * 1000 if not is_open else None,
            "close_rate": t.exit_price if not is_open else None,
            "close_rate_requested": t.exit_price if not is_open else None,
            "exit_reason": t.exit_reason if not is_open else None,
            "sell_reason": t.exit_reason if not is_open else None,
            "exit_order_status": "closed" if not is_open else None,
            "stop_loss_abs": sl_abs,
            "stop_loss_ratio": sl_ratio,
            "stop_loss_pct": r2(sl_ratio * 100),
            "stoploss_last_update": fmt_dt(first["ts"]),
            "stoploss_last_update_timestamp": first["ts"] * 1000,
            "initial_stop_loss_abs": init_sl,
            "initial_stop_loss_ratio": sl_ratio,
            "initial_stop_loss_pct": r2(sl_ratio * 100),
            "min_rate": t.min_rate if t.min_rate else avg * 0.99,
            "max_rate": t.max_rate if t.max_rate else avg * 1.01,
            "nr_of_successful_entries": len(t.entries),
            "nr_of_successful_exits": 0 if is_open else 1,
            "has_open_orders": False,
            "open_order_id": None,
            "orders": orders,
            "leverage": self.lev,
            "interest_rate": 0.0,
            "liquidation_price": liq,
            "funding_fees": 0.0,
            "trading_mode": mode,
            "amount_precision": 0.0001,
            "price_precision": 0.01 if avg > 1 else 1e-05,
            "precision_mode": 4,
            "trade_duration_s": int((t.exit_ts or self.now) - first["ts"]),
            "trade_duration": int(((t.exit_ts or self.now) - first["ts"]) // 60),
        }
        if is_open:
            cur = t.current_rate
            pa = t.profit_abs_at(cur)
            ratio = pa / stake
            out.update(
                {
                    "realized_profit": 0.0,
                    "realized_profit_ratio": None,
                    "profit_ratio": ratio,
                    "profit_pct": r2(ratio * 100),
                    "profit_abs": pa,
                    "profit_fiat": pa,
                    "close_profit": None,
                    "close_profit_pct": None,
                    "close_profit_abs": None,
                    "current_rate": cur,
                    "total_profit_abs": pa,
                    "total_profit_fiat": pa,
                    "total_profit_ratio": ratio,
                    "stoploss_current_dist": sl_abs - cur,
                    "stoploss_current_dist_ratio": (sl_abs - cur) / cur,
                    "stoploss_current_dist_pct": r2((sl_abs - cur) / cur * 100),
                    "stoploss_entry_dist": sl_abs - avg,
                    "stoploss_entry_dist_ratio": (sl_abs - avg) / avg,
                }
            )
        else:
            pa, ratio = t.profit_abs, t.profit_ratio
            out.update(
                {
                    "realized_profit": pa,
                    "realized_profit_ratio": ratio,
                    "profit_ratio": ratio,
                    "profit_pct": r2(ratio * 100),
                    "profit_abs": pa,
                    "profit_fiat": pa,
                    "close_profit": ratio,
                    "close_profit_pct": r2(ratio * 100),
                    "close_profit_abs": pa,
                }
            )
        for key in PRICE_KEYS:
            if out.get(key) is not None:
                out[key] = sig(out[key])
        for o in orders:
            for key in ("safe_price", "average", "price"):
                o[key] = sig(o[key])
        return out

    def closed_dicts(self):
        return self.memo("closed_dicts", lambda: [self.trade_dict(t) for t in sorted(self.closed_trades, key=lambda x: x.tid)])

    # aggregates -----------------------------------------------------------------------
    def profit_block(self, side=None):
        """Body of /profit; `side` in (None, 'long', 'short') filters by direction."""
        closed = [t for t in self.closed_trades if side is None or (t.is_short == (side == "short"))]
        opens = [t for t in self.open_trades if side is None or (t.is_short == (side == "short"))]
        now = self.now
        cap = self.capital
        pc = sum(t.profit_abs for t in closed)
        po = sum(t.profit_abs_at(t.current_rate) for t in opens)
        ratios = [t.profit_ratio for t in closed]
        all_ratios = ratios + [t.profit_abs_at(t.current_rate) / t.position()[2] for t in opens]

        def mean(x):
            return sum(x) / len(x) if x else 0.0

        wins = [t for t in closed if t.profit_abs > 0]
        losses = [t for t in closed if t.profit_abs < 0]
        gp = sum(t.profit_abs for t in wins)
        gl = -sum(t.profit_abs for t in losses)
        first_ts = min([t.open_ts for t in closed + opens], default=now)
        last_ts = max([t.open_ts for t in closed + opens] + [t.close_ts or 0 for t in closed], default=now)
        durs = [t.close_ts - t.open_ts for t in closed]
        avg_dur = timedelta(seconds=int(mean(durs)))
        per_pair = {}
        for t in closed + opens:
            pa = t.profit_abs if not t.is_open else t.profit_abs_at(t.current_rate)
            ent = per_pair.setdefault(t.pair, [0.0, 0.0])
            ent[0] += pa / t.position()[2]
            ent[1] += pa
        best = max(per_pair.items(), key=lambda kv: kv[1][0], default=(None, [0, 0]))
        # drawdown on the closed-trade equity curve
        eq = cap
        peak, peak_ts = cap, first_ts
        dd, dd_abs, dd_s, dd_e = 0.0, 0.0, first_ts, first_ts
        cur_start = first_ts
        daily = {}
        for t in closed:
            eq += t.profit_abs
            day = t.close_ts // DAY
            daily[day] = daily.get(day, 0.0) + t.profit_abs
            if eq > peak:
                peak, peak_ts = eq, t.close_ts
            else:
                d = (peak - eq) / peak
                if d > dd:
                    dd, dd_abs, dd_s, dd_e = d, peak - eq, peak_ts, t.close_ts
        cur_dd_abs = peak - eq
        cur_dd = cur_dd_abs / peak if peak else 0.0
        days_span = max((now - first_ts) / DAY, 1.0)
        final = cap + pc + po
        cagr = (final / cap) ** (365.0 / days_span) - 1 if final > 0 else 0.0
        rets = [v / cap for v in daily.values()]
        mu = mean(rets)
        sd = math.sqrt(mean([(x - mu) ** 2 for x in rets])) if rets else 0.0
        dn = math.sqrt(mean([min(x, 0.0) ** 2 for x in rets])) if rets else 0.0
        pa_list = [t.profit_abs for t in closed]
        pmu = mean(pa_list)
        psd = math.sqrt(mean([(x - pmu) ** 2 for x in pa_list])) if pa_list else 0.0
        sqn = math.sqrt(len(pa_list)) * pmu / psd if psd else 0.0
        win_rate = len(wins) / len(closed) if closed else 0.0
        avg_win = mean([t.profit_abs for t in wins])
        avg_loss = mean([-t.profit_abs for t in losses])
        expectancy = win_rate * avg_win - (1 - win_rate) * avg_loss
        vol = sum(t.notional_volume for t in closed + opens)
        bot_start = int(first_ts - DAY)
        return {
            "profit_closed_coin": pc,
            "profit_closed_percent_mean": r2(mean(ratios) * 100),
            "profit_closed_ratio_mean": mean(ratios),
            "profit_closed_percent_sum": r2(sum(ratios) * 100),
            "profit_closed_ratio_sum": sum(ratios),
            "profit_closed_percent": r2(pc / cap * 100),
            "profit_closed_ratio": pc / cap,
            "profit_closed_fiat": pc,
            "profit_all_coin": pc + po,
            "profit_all_percent_mean": r2(mean(all_ratios) * 100),
            "profit_all_ratio_mean": mean(all_ratios),
            "profit_all_percent_sum": r2(sum(all_ratios) * 100),
            "profit_all_ratio_sum": sum(all_ratios),
            "profit_all_percent": r2((pc + po) / cap * 100),
            "profit_all_ratio": (pc + po) / cap,
            "profit_all_fiat": pc + po,
            "trade_count": len(closed) + len(opens),
            "closed_trade_count": len(closed),
            "first_trade_date": fmt_dt(first_ts),
            "first_trade_humanized": human_ago(now - first_ts),
            "first_trade_timestamp": first_ts * 1000,
            "latest_trade_date": fmt_dt(last_ts),
            "latest_trade_humanized": human_ago(now - last_ts),
            "latest_trade_timestamp": last_ts * 1000,
            "avg_duration": str(avg_dur),
            "best_pair": best[0] or "",
            "best_rate": r2(best[1][0] * 100),
            "best_pair_profit_ratio": best[1][0],
            "best_pair_profit_abs": best[1][1],
            "winning_trades": len(wins),
            "losing_trades": len(losses),
            "profit_factor": gp / gl if gl else 0.0,
            "winrate": win_rate,
            "expectancy": expectancy,
            "expectancy_ratio": expectancy / avg_loss if avg_loss else 0.0,
            "sharpe": (mu / sd) * math.sqrt(365) if sd else 0.0,
            "sortino": (mu / dn) * math.sqrt(365) if dn else 0.0,
            "sqn": sqn,
            "pvalue": 0.004 if sqn > 2 else 0.18,
            "calmar": cagr / dd if dd else 0.0,
            "cagr": cagr,
            "max_drawdown": dd,
            "max_drawdown_abs": dd_abs,
            "max_drawdown_start": fmt_dt(dd_s),
            "max_drawdown_start_timestamp": dd_s * 1000,
            "max_drawdown_end": fmt_dt(dd_e),
            "max_drawdown_end_timestamp": dd_e * 1000,
            "current_drawdown": cur_dd,
            "current_drawdown_abs": cur_dd_abs,
            "current_drawdown_high": peak - cap,
            "current_drawdown_start": fmt_dt(peak_ts),
            "current_drawdown_start_timestamp": peak_ts * 1000,
            "trading_volume": vol,
            "bot_start_timestamp": bot_start * 1000,
            "bot_start_date": fmt_dt(bot_start),
            "capital_withdrawal": 0,
        }

    def profit(self):
        return self.memo("profit", lambda: self.profit_block())

    def profit_all(self):
        def build():
            return {
                "all": self.profit_block(),
                "long": self.profit_block("long"),
                "short": self.profit_block("short"),
            }

        return self.memo("profit_all", build)

    def balance(self):
        total = r2(self.balance_total())
        used = r2(self.used_margin())
        sc = self.stake_currency
        curr = [
            {
                "currency": sc,
                "free": max(total - used, 0.0),
                "balance": total,
                "used": used,
                "bot_owned": total,
                "est_stake": total,
                "est_stake_bot": total,
                "stake": sc,
                "side": "long",
                "is_position": False,
                "position": 0.0,
                "is_bot_managed": True,
            }
        ]
        if self.mode == "spot":
            curr[0]["free"] = max(total - used, 0.0)
            curr[0]["used"] = 0.0
            for t in self.open_trades:
                amt = t.position()[0]
                curr.append(
                    {
                        "currency": t.coin,
                        "free": amt,
                        "balance": amt,
                        "used": 0.0,
                        "bot_owned": amt,
                        "est_stake": amt * t.current_rate,
                        "est_stake_bot": amt * t.current_rate,
                        "stake": sc,
                        "side": "long",
                        "is_position": False,
                        "position": 0.0,
                        "is_bot_managed": True,
                    }
                )
        else:
            for t in self.open_trades:
                amt, avg, stake, notional = t.position()
                curr.append(
                    {
                        "currency": t.pair,
                        "free": 0.0,
                        "balance": amt,
                        "used": 0.0,
                        "bot_owned": amt,
                        "est_stake": stake,
                        "est_stake_bot": stake,
                        "stake": sc,
                        "side": "short" if t.is_short else "long",
                        "is_position": True,
                        "position": amt,
                        "is_bot_managed": True,
                    }
                )
        ratio = total / self.capital - 1
        return {
            "currencies": curr,
            "total": total,
            "total_bot": total,
            "symbol": FIAT,
            "value": total,
            "value_bot": total,
            "stake": sc,
            "note": "Simulated balances" if self.dry else "",
            "starting_capital": self.capital,
            "starting_capital_ratio": ratio,
            "starting_capital_pct": r2(ratio * 100),
            "starting_capital_fiat": self.capital,
            "starting_capital_fiat_ratio": ratio,
            "starting_capital_fiat_pct": r2(ratio * 100),
            "wallet_age_s": 4.0,
            "capital_withdrawal": 0,
        }

    def group_stats(self, key_fn, name):
        groups = {}
        for t in self.closed_trades:
            groups.setdefault(key_fn(t), []).append(t)
        out = []
        for k, ts in groups.items():
            ratios = [t.profit_ratio for t in ts]
            avg = sum(ratios) / len(ratios)
            out.append(
                {
                    name: k,
                    "profit_ratio": avg,
                    "profit_pct": r2(avg * 100),
                    "profit_abs": sum(t.profit_abs for t in ts),
                    "count": len(ts),
                }
            )
        out.sort(key=lambda x: x["profit_abs"], reverse=True)
        return out

    def performance(self):
        groups = {}
        for t in self.closed_trades:
            groups.setdefault(t.pair, []).append(t)
        out = []
        for pair, ts in groups.items():
            s = sum(t.profit_ratio for t in ts)
            out.append(
                {
                    "pair": pair,
                    "profit": r2(s * 100),
                    "profit_ratio": s,
                    "profit_pct": r2(s * 100),
                    "profit_abs": sum(t.profit_abs for t in ts),
                    "count": len(ts),
                }
            )
        out.sort(key=lambda x: x["profit_ratio"], reverse=True)
        return out

    def stats(self):
        reasons = {}
        durs = {"wins": [], "draws": [], "losses": []}
        for t in self.closed_trades:
            r = reasons.setdefault(t.exit_reason, {"wins": 0, "losses": 0, "draws": 0})
            k = "wins" if t.profit_abs > 0 else "losses" if t.profit_abs < 0 else "draws"
            r[k] += 1
            durs[k].append(t.close_ts - t.open_ts)
        return {
            "exit_reasons": reasons,
            "durations": {k: (sum(v) / len(v) if v else None) for k, v in durs.items()},
        }

    def period_profit(self, scale, count):
        """/daily, /weekly, /monthly: newest first, zero periods included."""
        now_d = datetime.fromtimestamp(self.now, timezone.utc).date()
        if scale == "weekly":
            cur = now_d - timedelta(days=now_d.weekday())
        elif scale == "monthly":
            cur = now_d.replace(day=1)
        else:
            cur = now_d

        def prev(d):
            if scale == "weekly":
                return d - timedelta(days=7)
            if scale == "monthly":
                return (d.replace(day=1) - timedelta(days=1)).replace(day=1)
            return d - timedelta(days=1)

        def nxt(d):
            if scale == "weekly":
                return d + timedelta(days=7)
            if scale == "monthly":
                return (d.replace(day=28) + timedelta(days=4)).replace(day=1)
            return d + timedelta(days=1)

        def ts_of(d):
            return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())

        rows = []
        d = cur
        for _ in range(count):
            lo, hi = ts_of(d), ts_of(nxt(d))
            ts = [t for t in self.closed_trades if lo <= t.close_ts < hi]
            before = sum(t.profit_abs for t in self.closed_trades if t.close_ts < lo)
            start_bal = self.capital + before
            ab = sum(t.profit_abs for t in ts)
            rows.append(
                {
                    "date": d.isoformat(),
                    "abs_profit": ab,
                    "rel_profit": ab / start_bal if start_bal else 0.0,
                    "starting_balance": start_bal,
                    "fiat_value": ab,
                    "trade_count": len(ts),
                }
            )
            d = prev(d)
        return {"data": rows, "fiat_display_currency": FIAT, "stake_currency": self.stake_currency}

    # time series ----------------------------------------------------------------------
    def profit_history_rows(self):
        """Rows [ts_ms, closed_abs, open_abs, open_trades] on a 30 minute grid."""

        def build():
            step = 1800
            t0 = (int(self.start_ts) // step) * step
            n = int((self.now - t0) // step) + 1
            closed = [0.0] * (n + 1)
            opn = [0.0] * (n + 1)
            cnt = [0] * (n + 1)
            for tr in self.closed_trades:
                ci = int((tr.close_ts - t0) // step) + 1
                if 0 <= ci <= n:
                    closed[ci] += tr.profit_abs
                oi = max(int((tr.open_ts - t0) // step) + 1, 0)
                span = max(ci - oi, 1)
                stake = tr.position()[2]
                dip = stake * (0.035 if (tr.profit_abs < 0 or len(tr.entries) > 1) else 0.012)
                for i in range(oi, min(ci, n + 1)):
                    frac = (i - oi) / span
                    opn[i] += tr.profit_abs * frac - dip * math.sin(math.pi * frac)
                    cnt[i] += 1
            for tr in self.open_trades:
                oi = max(int((tr.open_ts - t0) // step) + 1, 0)
                for i in range(oi, n + 1):
                    ts = t0 + (i - 1) * step
                    price = tr.current_rate if i == n else self.market.price(tr.coin, ts)
                    opn[i] += tr.profit_abs_at(price, upto=ts)
                    cnt[i] += 1
            rows = []
            cum = 0.0
            for i in range(1, n + 1):
                cum += closed[i]
                ts = t0 + (i - 1) * step
                if ts > self.now:
                    break
                rows.append([ts * 1000, cum, opn[i], cnt[i]])
            # final sample exactly now
            rows.append(
                [self.now * 1000, self.closed_profit(), self.open_profit_now(), len(self.open_trades)]
            )
            return rows

        return self.memo("profit_history", build)

    def historic_balance(self):
        def build():
            rows = self.profit_history_rows()
            out = []
            for r in rows[::2]:
                ts = r[0] // 1000
                out.append([iso_dt(ts), r[0], self.capital + r[1] + r[2]])
            return {
                "columns": ["date", "__date_ts", "total_quote"],
                "data": out,
                "length": len(out),
                "capture_start_ts": int(self.start_ts * 1000),
            }

        return self.memo("hist_balance", build)

    def volume_history(self, days, bucket):
        key = ("vol", days, bucket)

        def build():
            size = {"1d": 1, "3d": 3, "7d": 7, "1M": 30, "1Q": 90}.get(bucket, 1)
            rng = random.Random(f"{self.seed}:vol:{self.name}")
            base = {"hyperliquid": 1.6e9, "binance": 9.0e9, "bybit": 2.4e9}[self.exchange]
            if self.mode == "spot":
                base *= 0.45
            end_day = int(self.now // DAY)
            first_day = end_day - days + 1
            buckets = []
            d = first_day
            while d <= end_day:
                lo, hi = d * DAY, (d + size) * DAY
                ts = [t for t in self.closed_trades if lo <= t.close_ts < hi]
                bot_vol = sum(t.notional_volume for t in ts)
                dow = 0.85 + 0.3 * math.sin(d / 7 * 2 * math.pi)
                ex = base * size * dow * (1 + 0.25 * math.sin(d / 23.0)) * rng.uniform(0.8, 1.2)
                buckets.append(
                    {
                        "date": datetime.fromtimestamp(lo, timezone.utc).strftime("%Y-%m-%d"),
                        "exchange_volume": ex,
                        "bot_volume": bot_vol,
                        "trade_count": len(ts),
                        "abs_profit": sum(t.profit_abs for t in ts),
                    }
                )
                d += size
            return {
                "buckets": buckets,
                "exchange_name": EXCHANGES[self.exchange]["name"],
                "stake_currency": self.stake_currency,
                "whitelist_count": len(self.pairs) + 40,
                "data_coverage_pct": 100.0,
                "anomaly_threshold_high": 1.8,
                "anomaly_threshold_low": 0.45,
            }

        return self.memo(key, build)

    def candles(self, pair, timeframe, limit):
        tfm = TF_MIN.get(timeframe, 15)
        step = tfm * 60
        coin = self.coin_of(pair)
        last = (self.now // step) * step
        n = min(int(limit or 500), 1500)
        rows = []
        ema20 = ema50 = None
        for i in range(n):
            ts = last - (n - 1 - i) * step
            sub = [self.market.price(coin, ts + k * step // 4) for k in range(5)]
            o = self.market.price(coin, ts)
            c = self.market.price(coin, ts + step - 1) if ts + step - 1 <= self.now else self.market.price(coin, self.now)
            hi, lo = max(sub + [o, c]), min(sub + [o, c])
            ema20 = c if ema20 is None else ema20 + (c - ema20) * 2 / 21
            ema50 = c if ema50 is None else ema50 + (c - ema50) * 2 / 51
            vol = (1000 + 600 * (1 + math.sin(ts / 5000.0))) * (1 + abs(c - o) / o * 80)
            rows.append(
                [ts * 1000, o, hi, lo, c, vol, 50 + 35 * math.sin(ts / 9000.0), ema20, ema50,
                 0, 0, 0, 0, ts * 1000, None, None, None, None]
            )
        cols = ["date", "open", "high", "low", "close", "volume", "rsi", "ema20", "ema50",
                "enter_long", "enter_short", "exit_long", "exit_short", "__date_ts",
                "_enter_long_signal_close", "_exit_long_signal_close",
                "_enter_short_signal_close", "_exit_short_signal_close"]
        return {
            "strategy": self.spec["strategy"],
            "pair": pair,
            "timeframe": timeframe,
            "timeframe_ms": step * 1000,
            "columns": cols,
            "all_columns": cols,
            "data": rows,
            "length": len(rows),
            "buy_signals": 0,
            "sell_signals": 0,
            "enter_long_signals": 0,
            "exit_long_signals": 0,
            "enter_short_signals": 0,
            "exit_short_signals": 0,
            "last_analyzed": fmt_dt(self.now),
            "last_analyzed_ts": self.now,
            "data_start_ts": (last - (n - 1) * step) * 1000,
            "data_start": fmt_dt(last - (n - 1) * step) + "+00:00",
            "data_stop": fmt_dt(last) + "+00:00",
            "data_stop_ts": last * 1000,
        }

    def show_config(self):
        spec = self.spec
        return {
            "version": BOT_VERSION,
            "strategy_version": "1.4.2",
            "api_version": API_VERSION,
            "dry_run": self.dry,
            "trading_mode": self.mode,
            "margin_mode": "isolated" if self.mode == "futures" else "",
            "short_allowed": self.mode == "futures" and spec["direction"] != "long",
            "stake_currency": self.stake_currency,
            "stake_amount": str(spec["margin"]),
            "available_capital": self.capital,
            "tradable_balance_ratio": 0.99,
            "stake_currency_decimals": 2,
            "max_open_trades": spec["max_open"],
            "minimal_roi": {"0": 0.06, "240": 0.03, "720": 0.012, "2160": 0},
            "stoploss": -spec["sl"],
            "stoploss_on_exchange": False,
            "trailing_stop": True,
            "trailing_stop_positive": 0.01,
            "trailing_stop_positive_offset": 0.02,
            "trailing_only_offset_is_reached": True,
            "unfilledtimeout": {"entry": 10, "exit": 30, "unit": "minutes", "exit_timeout_count": 0},
            "order_types": {
                "entry": "limit", "exit": "limit", "emergency_exit": "market",
                "force_exit": "market", "force_entry": "market", "stoploss": "market",
                "stoploss_on_exchange": False, "stoploss_on_exchange_interval": 60,
            },
            "use_custom_stoploss": False,
            "timeframe": self.tf,
            "timeframe_ms": self.tf_min * 60000,
            "timeframe_min": self.tf_min,
            "exchange": self.exchange,
            "demo_trading": False,
            "strategy": spec["strategy"],
            "force_entry_enable": False,
            "exit_pricing": {"price_side": "other", "use_order_book": True, "order_book_top": 1},
            "entry_pricing": {
                "price_side": "other", "use_order_book": True, "price_last_balance": 0.0,
                "order_book_top": 1, "check_depth_of_market": {"enabled": False, "bids_to_ask_delta": 1},
            },
            "bot_name": self.name,
            "state": "running",
            "runmode": "dry_run" if self.dry else "live",
            "position_adjustment_enable": spec["dca_max"] > 0,
            "max_entry_position_adjustment": spec["dca_max"] if spec["dca_max"] else -1,
        }

    def logs(self):
        def build():
            rng = random.Random(f"{self.seed}:logs:{self.name}")
            t_end = self.now - 6
            t_start = self.now - 4 * 3600
            lines = []

            def add(ts, module, level, msg):
                lines.append([fmt_dt(int(ts)), ts * 1000.0 + rng.random(), module, level, msg])

            t = t_start
            while t < t_end:
                add(t + rng.uniform(0, 4), "freqtrade.worker", "INFO",
                    f"Bot heartbeat. PID={self.pid}, version='{BOT_VERSION}', state='RUNNING'")
                t += 300
            t = t_start + 40
            while t < t_end:
                add(t, "freqtrade.wallets", "INFO", "Wallets synced.")
                t += 600
            step = max(self.tf_min * 60, 300)
            t = (int(t_start) // step) * step + step + 3
            while t < t_end:
                add(t, "freqtrade.freqtradebot", "INFO", "Found no enter signals for whitelisted currencies. Trying again...")
                t += step
            for tr in self.all_trades:
                for i, e in enumerate(tr.entries):
                    if t_start <= e["ts"] <= t_end:
                        side = "Short" if tr.is_short else "Long"
                        if i == 0:
                            add(e["ts"], "freqtrade.freqtradebot", "INFO",
                                f"{side} signal found: about create a new trade for {tr.pair} with stake_amount: {e['margin']:.2f} ...")
                        else:
                            add(e["ts"], "freqtrade.freqtradebot", "INFO",
                                f"Position adjust: about to create a new order for {tr.pair} with stake_amount: {e['margin']:.2f} for Trade(id={tr.tid}, pair={tr.pair}, amount={tr.position(e['ts'])[0]:.5f}, is_short={tr.is_short}, leverage={self.lev}, open_rate={tr.position(e['ts'])[1]:.4f}, open_since={fmt_dt(tr.open_ts)}).")
                        add(e["ts"] + 2, "freqtrade.rpc.rpc_manager", "INFO",
                            f"Sending rpc message: {{'type': entry, 'trade_id': {tr.tid}, 'exchange': '{EXCHANGES[self.exchange]['name']}', 'pair': '{tr.pair}', 'open_rate': {e['price']:.4f}}}")
                if tr.exit_ts and t_start <= tr.exit_ts <= t_end:
                    add(tr.exit_ts, "freqtrade.freqtradebot", "INFO",
                        f"Exit for {tr.pair} detected. Reason: {tr.exit_reason}")
                    add(tr.exit_ts + 3, "freqtrade.rpc.rpc_manager", "INFO",
                        f"Sending rpc message: {{'type': exit, 'trade_id': {tr.tid}, 'pair': '{tr.pair}', 'profit_ratio': {tr.profit_ratio:.4f}, 'exit_reason': '{tr.exit_reason}'}}")
            warns = [
                ("freqtrade.exchange.common", "fetch_ohlcv() returned exception: \"ExchangeNotAvailable('Temporary connection issue')\". Retrying still for 2 times."),
                ("freqtrade.exchange.exchange", "Rate limit exceeded on fetch_tickers, backing off for 4.0s."),
                ("freqtrade.freqtradebot", "Order for {pair} not filled within the timeout, cancelling and retrying at a new price."),
                ("freqtrade.strategy.interface", "Spread for {pair} too wide (0.62%), skipping entry."),
            ]
            for _ in range(rng.randint(5, 9)):
                mod, msg = rng.choice(warns)
                pair = self.pairs[rng.randrange(len(self.pairs))]
                add(rng.uniform(t_start + 300, t_end - 60), mod, "WARNING", msg.format(pair=pair))
            if rng.random() < 0.4:
                pair = self.pairs[rng.randrange(len(self.pairs))]
                add(rng.uniform(t_start + 600, t_end - 600), "freqtrade.freqtradebot", "ERROR",
                    f"Unable to create trade for {pair}: Insufficient balance on exchange for the requested stake.")
            for _ in range(3):
                add(rng.uniform(t_start, t_end), "uvicorn.error", "INFO", "websocket connection open")
            lines.sort(key=lambda r: r[1])
            return lines

        return self.memo("logs", build)


# --------------------------------------------------------------------------------------
# Fleet
# --------------------------------------------------------------------------------------


class Fleet:
    def __init__(self, n, base_port, seed, now):
        self.now = now
        self.seed = seed
        self.market = Market(seed, now)
        self.bots = []
        for i, spec in enumerate(BOT_SPECS[:n]):
            self.bots.append(Bot(spec, base_port + i, self.market, seed, now))
        self.by_port = {b.port: b for b in self.bots}
        self._cache = {}

    def memo(self, key, fn):
        if key not in self._cache:
            self._cache[key] = fn()
        return self._cache[key]

    def status(self):
        now = self.now
        bots = []
        for b in self.bots:
            bots.append(
                {
                    "bot_id": b.name, "config_file": f"{b.name}.json", "exchange": b.exchange,
                    "trading_mode": b.mode, "strategy": b.spec["strategy"], "timeframe": b.tf,
                    "pairs_count": len(b.pairs) + 20, "state": "running",
                    "uptime_s": 86400 * 3 + b.pid % 5000, "last_heartbeat_ago_s": 2 + b.pid % 7,
                    "pid": b.pid, "api_port": b.port, "dry_run": b.dry,
                }
            )
        ex = sorted({b.exchange for b in self.bots})
        return {
            "daemon": {"uptime_s": 86400 * 9 + 1234, "socket_path": "/run/ftcache/ftcache.sock",
                       "active_connections": len(self.bots), "total_series": 640, "total_events": 18420},
            "bots": bots,
            "rate_limiters": {
                e: {"tokens_available": 71.0, "tokens_max": 100.0, "backoff_active": False,
                    "shed_count": 0, "backoff_count": 1 if e == "hyperliquid" else 0}
                for e in ex
            },
            "recent_events_count": {"bot_connect": len(self.bots), "rate_limit_429": 1, "backoff_start": 1},
        }

    def snapshot(self):
        bots = {}
        for b in self.bots:
            bots[b.name] = {
                "bot_name": b.name, "state": "running", "dry_run": b.dry, "exchange": b.exchange,
                "strategy": b.spec["strategy"], "stake_currency": b.stake_currency,
                "trading_mode": b.mode, "open_trade_count": len(b.open_trades),
                "max_open_trades": b.spec["max_open"], "closed_profit_abs": b.closed_profit(),
                "balance_total": b.balance_total(), "wallet_age_s": 4.0,
                "open_profit_abs": b.open_profit_now(), "age_s": 3.0 + b.pid % 5, "api_port": b.port,
            }
        return {"ok": True, "ts": self.now, "bot_count": len(bots), "bots": bots}

    def events(self):
        ev = []
        now = self.now
        rng = random.Random(f"{self.seed}:events")
        for i, b in enumerate(self.bots):
            ev.append({"ts": now - 86400 * 3 - i * 17, "event_type": "bot_connect", "bot_id": b.name,
                       "details": {"pid": b.pid, "exchange": b.exchange}})
        for k in range(3):
            t = now - rng.uniform(2, 20) * 3600
            ev.append({"ts": t, "event_type": "rate_limit_429", "bot_id": "hl_meanrev_dca",
                       "details": {"method": "fetch_ohlcv", "exchange": "hyperliquid"}})
            ev.append({"ts": t + 1, "event_type": "backoff_start", "bot_id": None,
                       "details": {"exchange": "hyperliquid", "duration_s": 30, "factor": 1.5}})
        ev.sort(key=lambda e: e["ts"], reverse=True)
        return {"events": ev}

    def overview(self, port):
        out = []
        for b in self.bots:
            realized = b.closed_trades

            def window(d):
                lo = self.now - d * DAY
                return sum(t.profit_abs for t in realized if t.close_ts >= lo)

            dirs = {t.is_short for t in b.all_trades}
            direction = "dual" if len(dirs) == 2 else ("short" if True in dirs else "long")
            if b.spec["direction"] != "both":
                direction = b.spec["direction"]
            first = min(t.open_ts for t in b.all_trades)
            last = max(t.open_ts for t in b.all_trades)
            out.append(
                {
                    "bot_name": b.name, "config_file": f"{b.name}.json", "dry_run": b.dry,
                    "strategy": b.spec["strategy"], "port": b.port, "is_self": b.port == port,
                    "db_ok": True, "direction": direction,
                    "capital": {"available_capital": b.capital, "capital_withdrawal": 0.0,
                                "realized_total": b.closed_profit(), "effective": b.capital + b.closed_profit()},
                    "pnl": {"realized_1d": window(1), "realized_7d": window(7), "realized_30d": window(30),
                            "realized_total": b.closed_profit()},
                    "trades": {"open_count": len(b.open_trades), "closed_count": len(b.closed_trades),
                               "count_30d": sum(1 for t in realized if t.close_ts >= self.now - 30 * DAY)},
                    "uptime": {"process_start": self.now - 86400 * 3, "first_trade": fmt_dt(first),
                               "last_trade": fmt_dt(last)},
                    "badges": {"frozen": False, "inert": False,
                               "leverage_values": [b.lev] if b.mode == "futures" else []},
                    "open_trades": [
                        {"trade_id": t.tid, "pair": t.pair, "is_short": t.is_short, "amount": t.position()[0],
                         "open_rate": t.position()[1], "stake_amount": t.position()[2],
                         "leverage": b.lev, "open_date": fmt_dt(t.open_ts)}
                        for t in b.open_trades
                    ],
                }
            )
        return {"generated_at": self.now, "bots": out}

    def reconciliation(self):
        coins = {}
        for b in self.bots:
            if b.exchange != "hyperliquid" or b.dry:
                continue
            for t in b.open_trades:
                c = coins.setdefault(t.coin, {"slices": [], "sum": 0.0, "mark": t.current_rate, "upnl": 0.0})
                amt = t.position()[0] * (-1 if t.is_short else 1)
                c["sum"] += amt
                c["upnl"] += t.profit_abs_at(t.current_rate)
                c["slices"].append(
                    {"bot_name": b.name, "port": b.port, "trade_id": t.tid, "pair": t.pair,
                     "signed_amount": amt, "open_rate": t.position()[1], "stake_amount": t.position()[2]}
                )
        out = []
        for coin, c in sorted(coins.items()):
            out.append(
                {"coin": coin, "db_sum": c["sum"], "on_chain": c["sum"], "diff": 0.0, "diff_notional": 0.0,
                 "mark_price": c["mark"], "on_chain_leverage": 2.0, "unrealized_pnl": c["upnl"],
                 "status": "ok", "slices": c["slices"], "phantom_candidate": None, "minority_slices": []}
            )
        return {"generated_at": self.now, "wallet": FAKE_WALLET,
                "live_bots": sum(1 for b in self.bots if not b.dry), "issues": 0, "coins": out}

    def fleet_profit_history(self, since, points):
        bots = []
        for b in self.bots:
            rows = [r for r in b.profit_history_rows() if r[0] > since]
            total = len(rows)
            if total > points:
                stride = total / points
                rows = [rows[int(i * stride)] for i in range(points)] + [rows[-1]]
            bots.append(
                {"bot_name": b.name, "port": b.port, "dry_run": b.dry, "strategy": b.spec["strategy"],
                 "state": "running", "length": len(rows), "total": total,
                 "last_ts": rows[-1][0] if rows else None, "data": rows}
            )
        return {"generated_at": self.now, "since": since, "points": points, "bot_count": len(bots),
                "truncated": False, "etag": f"demo-{self.now}-{points}", "bots": bots, "errors": {}}

    def rate_metrics(self, window, bucket_s):
        now = self.now
        rng = random.Random(f"{self.seed}:rate")
        n = max(min(int(window // bucket_s), 360), 1)
        timeline = []
        for i in range(n):
            ts = now - (n - i) * bucket_s
            total = int(rng.uniform(18, 46) * bucket_s / 10)
            cached = int(total * rng.uniform(0.62, 0.8))
            err = 1 if rng.random() < 0.03 else 0
            timeline.append(
                {"ts": ts, "total": total, "cached": cached, "direct": total - cached, "errors": err,
                 "errors_429": 0, "avg_latency_ms": rng.uniform(80, 190),
                 "by_method": {"fetch_ohlcv": int(total * 0.7), "fetch_tickers": int(total * 0.2),
                               "fetch_positions": total - int(total * 0.7) - int(total * 0.2)}}
            )
        tot = sum(b["total"] for b in timeline)
        cached = sum(b["cached"] for b in timeline)
        by_method = {
            "fetch_ohlcv": {"count": int(tot * 0.7), "cached": int(cached * 0.75), "direct": int(tot * 0.7) - int(cached * 0.75),
                            "errors": 2, "avg_latency_ms": 132.0, "p95_latency_ms": 310.0},
            "fetch_tickers": {"count": int(tot * 0.2), "cached": int(cached * 0.2), "direct": int(tot * 0.2) - int(cached * 0.2),
                              "errors": 0, "avg_latency_ms": 96.0, "p95_latency_ms": 180.0},
        }
        return {
            "exchange": "hyperliquid",
            "timeline": timeline,
            "current": {"tokens_available": 71.0, "tokens_max": 100.0, "refill_rate": 8.0,
                        "backoff_active": False, "backoff_factor": 1.0, "backoff_remaining_s": 0.0,
                        "queue_depths": {"HIGH": 0, "PRIME": 0, "NORMAL": 1}, "shed_count": 0,
                        "backoff_count": 3, "consecutive_backoffs": 0, "current_backoff_duration_s": 0,
                        "weight_mode": True, "weight_used_last_min": 412.0, "weight_budget_per_min": 1200,
                        "weight_utilization_pct": 34.3},
            "recent_429s": [{"ts": now - 5400, "method": "fetch_ohlcv", "exchange": "hyperliquid", "pair": "SOL/USDC:USDC"}],
            "summary": {"total": tot, "cached": cached, "direct": tot - cached, "errors": 3, "errors_429": 0,
                        "avg_latency_ms": 128.0, "p95_latency_ms": 296.0, "by_method": by_method},
            "ftcache_extended": {"requests_total": 184200, "cache_hits": 141300, "cache_partial": 6100,
                                 "cache_misses": 36800, "acquire_total": 38200, "tickers_requests": 9100,
                                 "tickers_cache_hits": 8800, "tickers_fetches": 300, "positions_puts": 5200,
                                 "positions_gets": 21300, "positions_cache_hits": 20500,
                                 "cache_hit_rate_pct": 76.7, "tickers_hit_rate_pct": 96.7,
                                 "positions_hit_rate_pct": 96.2},
            "ftpairlist": {"clients": len(self.bots), "gets": 8200, "hits": 7900, "puts": 310, "entries": 12,
                           "hit_rate_pct": 96.3},
            "exchange_rate_limit": {"rate_limit_ms": 50, "max_requests_per_min": 1200},
        }

    def cache_status(self):
        return {
            "ftcache": {
                "online": True, "uptime_s": 86400 * 9 + 1234, "active_clients": len(self.bots),
                "requests_total": 184200, "cache_hits": 141300, "cache_partial": 6100,
                "cache_misses": 36800, "hit_rate_pct": 76.7, "fetch_errors": 3, "series_count": 640,
                "pending_fetches": 0, "peak_pending": 14, "acquire_total": 38200,
                "tickers_requests": 9100, "tickers_cache_hits": 8800, "tickers_hit_rate_pct": 96.7,
                "tickers_fetches": 300, "positions_puts": 5200, "positions_gets": 21300,
                "positions_cache_hits": 20500, "positions_hit_rate_pct": 96.2, "total_connects": 41,
                "total_disconnects": 33, "peak_clients": len(self.bots), "short_lived_connections": 2,
                "shed_count": 0, "backoff_count": 3, "backoff_active": False, "backoff_remaining_s": 0.0,
                "consecutive_backoffs": 0, "current_backoff_duration_s": 0, "weight_mode": True,
                "weight_used_last_min": 412.0, "weight_budget_per_min": 1200, "weight_utilization_pct": 34.3,
            },
            "pairlist_cache": {"online": True, "uptime_s": 86400 * 9 + 1200, "active_clients": len(self.bots),
                               "entries": 12, "gets": 8200, "hits": 7900, "hit_rate_pct": 96.3, "puts": 310},
        }

    # demo-only data for the capture script (fake CoinGecko / FNG replies) -------------
    def gecko_simple_price(self, ids):
        out = {}
        for gid in ids:
            coin = GECKO_IDS.get(gid, "BTC")
            p = self.market.price(coin, self.now)
            p0 = self.market.price(coin, self.now - DAY)
            out[gid] = {"usd": p, "eur": p * 0.92, "usd_24h_change": (p / p0 - 1) * 100}
        return out

    def gecko_market_chart(self, gid, days):
        coin = GECKO_IDS.get(gid, "BTC")
        if days <= 1:
            step = 300
        elif days <= 30:
            step = 3600
        else:
            step = DAY
        n = int(days * DAY // step)
        pts = []
        for i in range(n + 1):
            ts = self.now - (n - i) * step
            pts.append([ts * 1000, self.market.price(coin, ts)])
        return {"prices": pts}


# --------------------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------------------

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
FLEET = None
DIST = None
VERBOSE = False
HITS = {}  # port -> set of routes answered (read by /__demo/hits)


def jdump(obj):
    return json.dumps(obj, separators=(",", ":")).encode()


class BaseHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "DemoFleet"

    def log_message(self, fmt, *args):
        if VERBOSE:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Max-Age", "86400")

    def send_bytes(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, obj, code=200):
        self.send_bytes(code, jdump(obj))

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw) if raw else {}
        except ValueError:
            return {}

    def not_found(self, method, path):
        sys.stderr.write(f"[404] {method} {path} (port {self.server.server_address[1]})\n")
        self.send_json({"detail": "Not Found"}, 404)


class BotHandler(BaseHandler):
    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")

    def do_PUT(self):
        self.handle_any("PUT")

    def do_DELETE(self):
        self.handle_any("DELETE")

    def handle_any(self, method):
        u = urlparse(self.path)
        path = u.path
        q = {k: v[-1] for k, v in parse_qs(u.query).items()}
        bot = FLEET.by_port[self.server.server_address[1]]
        HITS.setdefault(bot.port, set()).add(path)
        body = self.read_body() if method in ("POST", "PUT") else {}
        if path.startswith("/api/v1"):
            path = path[len("/api/v1"):] or "/"
        if path == "/message/ws" and self.headers.get("Upgrade", "").lower() == "websocket":
            return self.websocket()
        if method == "POST" and path == "/token/login":
            return self.send_json({"access_token": "demo-access", "refresh_token": "demo-refresh"})
        if method == "POST" and path == "/token/refresh":
            return self.send_json({"access_token": "demo-access"})
        try:
            res = self.route(bot, method, path, q, body)
        except Exception as exc:  # defensive: a demo server must never hang the UI
            sys.stderr.write(f"[500] {method} {path}: {exc!r}\n")
            return self.send_json({"detail": str(exc)}, 500)
        if res is None:
            return self.not_found(method, self.path)
        self.send_json(res)

    def route(self, bot, method, path, q, body):
        f = FLEET
        simple = {
            "/ping": lambda: {"status": "pong"},
            "/version": lambda: {"version": BOT_VERSION},
            "/ui_version": lambda: {"version": UI_VERSION},
            "/show_config": bot.show_config,
            "/profit": bot.profit,
            "/profit_all": bot.profit_all,
            "/balance": bot.balance,
            "/stats": bot.stats,
            "/performance": bot.performance,
            "/entries": lambda: bot.group_stats(lambda t: t.tag, "enter_tag"),
            "/exits": lambda: bot.group_stats(lambda t: t.exit_reason, "exit_reason"),
            "/mix_tags": lambda: bot.group_stats(lambda t: f"{t.tag} {t.exit_reason}", "mix_tag"),
            "/count": lambda: {
                "current": len(bot.open_trades), "max": bot.spec["max_open"],
                "total_stake": bot.used_margin(),
            },
            "/status": lambda: [bot.trade_dict(t) for t in sorted(bot.open_trades, key=lambda x: x.tid)],
            "/whitelist": lambda: {
                "whitelist": bot.pairs, "length": len(bot.pairs),
                "method": ["StaticPairList"] if bot.dry else ["VolumePairList", "AgeFilter"],
                "total_market_pairs": 180,
            },
            "/blacklist": lambda: {
                "blacklist": ["LUNA/.*", "FTT/.*"], "blacklist_expanded": [], "errors": {},
                "length": 2, "method": ["StaticPairList"],
            },
            "/locks": lambda: {"lock_count": 0, "locks": []},
            "/logs": lambda: self.logs(bot, q),
            "/sysinfo": lambda: self.sysinfo(),
            "/health": lambda: {
                "last_process": fmt_dt(f.now - 3), "last_process_ts": f.now - 3,
                "bot_start": fmt_dt(f.now - 3 * DAY), "bot_start_ts": f.now - 3 * DAY,
                "bot_startup": fmt_dt(f.now - 3 * DAY), "bot_startup_ts": f.now - 3 * DAY,
            },
            "/plot_config": lambda: {
                "main_plot": {"ema20": {"color": "#4aa3ff", "type": "line"}, "ema50": {"color": "#f4a940", "type": "line"}},
                "subplots": {"RSI": {"rsi": {"color": "#a78bfa", "type": "line"}}},
            },
            "/strategies": lambda: {"strategies": [bot.spec["strategy"]]},
            "/available_pairs": lambda: {
                "length": len(bot.pairs), "pairs": bot.pairs,
                "pair_interval": [[p, bot.tf] for p in bot.pairs],
            },
            "/exchanges": lambda: {"exchanges": []},
            "/profit_history": lambda: self.profit_history(bot, q),
            "/historic_balance": bot.historic_balance,
            "/volume_history": lambda: bot.volume_history(int(q.get("days", 90)), q.get("bucket", "1d")),
            "/cache_status": f.cache_status,
            "/rate_metrics": lambda: f.rate_metrics(int(q.get("window", 3600)), int(q.get("bucket_s", 10))),
            "/fleet/status": f.status,
            "/fleet/snapshot": f.snapshot,
            "/fleet/events": f.events,
            "/fleetview/overview": lambda: f.overview(bot.port),
            "/fleetview/reconciliation": f.reconciliation,
            "/fleetview/exposure": lambda: {"available": False},
            "/fleetview/profit_history": lambda: f.fleet_profit_history(
                int(q.get("since", 0) or 0), min(int(q.get("points", 300)), 2000)
            ),
        }
        if method == "GET" and path in simple:
            return simple[path]()
        if method == "GET" and path in ("/daily", "/weekly", "/monthly"):
            default = {"daily": 7, "weekly": 4, "monthly": 3}[path[1:]]
            return bot.period_profit(path[1:], int(q.get("timescale", default)))
        if method == "GET" and path == "/trades":
            limit = int(q.get("limit", 500))
            offset = int(q.get("offset", 0))
            allc = bot.closed_dicts()
            page = allc[offset: offset + limit]
            return {"trades": page, "trades_count": len(page), "offset": offset, "total_trades": len(allc)}
        if method == "GET" and path.startswith("/trade/"):
            tid = int(path.rsplit("/", 1)[1])
            for t in bot.all_trades:
                if t.tid == tid:
                    return bot.trade_dict(t)
            return None
        if method == "GET" and path == "/replay/seeded":
            return {
                "dry_run": bot.dry, "seeded": bot.dry, "backup_available": False,
                "info": {"timerange": "20260801-20261114", "pairs": len(bot.pairs)} if bot.dry else None,
                "dry_run_wallet": bot.capital,
            }
        if method == "GET" and path == "/replay":
            return {
                "status": "not_started", "running": False, "status_msg": "", "progress": 0.0,
                "step": "", "db_url": None, "result": None, "elapsed_s": None, "eta_s": None,
            }
        if method == "GET" and path == "/replay/queue":
            return {"ok": True, "cores": 8, "hyperopt_cores": 4, "capacity": 4,
                    "running": [], "paused": [], "queued": []}
        if method == "GET" and path.startswith("/strategy/"):
            name = path.rsplit("/", 1)[1]
            if name != bot.spec["strategy"]:
                return None
            code = (
                "from freqtrade.strategy import IStrategy\n\n\n"
                f"class {name}(IStrategy):\n"
                f"    timeframe = \"{bot.tf}\"\n"
                f"    stoploss = -{bot.spec['sl']}\n"
                "    minimal_roi = {\"0\": 0.06, \"240\": 0.03, \"720\": 0.012}\n\n"
                "    def populate_indicators(self, dataframe, metadata):\n"
                "        return dataframe\n"
            )
            return {"strategy": name, "timeframe": bot.tf, "code": code, "params": []}
        if path == "/pair_candles":
            args = body if method == "POST" else q
            pair = args.get("pair") or bot.pairs[0]
            return bot.candles(pair, args.get("timeframe") or bot.tf, args.get("limit") or 500)
        return None

    def logs(self, bot, q):
        limit = int(q.get("limit", 200) or 200)
        lines = bot.logs()
        sel = lines[-limit:] if limit else lines
        return {"log_count": len(sel), "logs": sel}

    def profit_history(self, bot, q):
        rows = bot.profit_history_rows()
        after = int(q.get("after", 0) or 0)
        if after:
            rows = [r for r in rows if r[0] > after]
        return {"currency": bot.stake_currency, "data": rows, "length": len(rows)}

    def sysinfo(self):
        ph = time.time() / 30.0
        cpu = [{"cpu": i, "pct": round(8 + 14 * (1 + math.sin(ph + i)), 1)} for i in range(8)]
        avg = round(sum(c["pct"] for c in cpu) / len(cpu), 1)
        return {
            "cpu_pct": [c["pct"] for c in cpu], "cpu_load": cpu,
            "cpu_load_avg": {"1m": 1.4, "5m": 1.3, "15m": 1.2}, "cpu_count": 8, "cpu_avg": avg,
            "ram_pct": 41.6,
        }

    # -- minimal WebSocket: handshake, then ignore client frames, answer ping/close ------
    def websocket(self):
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.close_connection = True
        sock = self.connection
        sock.settimeout(1.0)
        buf = b""
        while not STOP.is_set():
            try:
                chunk = sock.recv(4096)
            except socket.timeout:
                continue
            except OSError:
                return
            if not chunk:
                return
            buf += chunk
            while len(buf) >= 2:
                b1, b2 = buf[0], buf[1]
                opcode, masked, ln, pos = b1 & 0x0F, b2 & 0x80, b2 & 0x7F, 2
                if ln == 126:
                    if len(buf) < 4:
                        break
                    ln, pos = struct.unpack(">H", buf[2:4])[0], 4
                elif ln == 127:
                    if len(buf) < 10:
                        break
                    ln, pos = struct.unpack(">Q", buf[2:10])[0], 10
                need = pos + (4 if masked else 0) + ln
                if len(buf) < need:
                    break
                payload = buf[need - ln: need]
                if masked:
                    mask = buf[pos: pos + 4]
                    payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
                buf = buf[need:]
                if opcode == 8:
                    try:
                        sock.sendall(b"\x88\x00")
                    except OSError:
                        pass
                    return
                if opcode == 9:
                    try:
                        sock.sendall(bytes([0x8A, len(payload)]) + payload)
                    except OSError:
                        return


class StaticHandler(BaseHandler):
    def do_GET(self):
        u = urlparse(self.path)
        path = u.path
        q = {k: v[-1] for k, v in parse_qs(u.query).items()}
        if path in ("/ui_version", "/api/v1/ui_version"):
            return self.send_json({"version": UI_VERSION})
        if path.startswith("/__demo/"):
            return self.demo(path[len("/__demo/"):], q)
        rel = path.lstrip("/")
        full = os.path.realpath(os.path.join(DIST, rel))
        root = os.path.realpath(DIST)
        if not (full == root or full.startswith(root + os.sep)):
            return self.send_bytes(403, b"forbidden", "text/plain")
        if os.path.isfile(full):
            return self.serve_file(full)
        if rel.startswith("assets/") or os.path.splitext(rel)[1] not in ("", ".html"):
            return self.not_found("GET", self.path)
        return self.serve_file(os.path.join(DIST, "index.html"))  # SPA fallback

    def serve_file(self, full):
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as fh:
            data = fh.read()
        self.send_bytes(200, data, ctype)

    def demo(self, name, q):
        f = FLEET
        if name == "coingecko/simple_price":
            return self.send_json(f.gecko_simple_price([i for i in q.get("ids", "bitcoin").split(",") if i]))
        if name == "coingecko/market_chart":
            return self.send_json(f.gecko_market_chart(q.get("id", "bitcoin"), float(q.get("days", 30))))
        if name == "coingecko/global":
            return self.send_json({"data": {"market_cap_percentage": {"btc": 56.4, "eth": 12.8}}})
        if name == "fng":
            return self.send_json({"data": [{"value": "62", "value_classification": "Greed"}]})
        if name == "hits":
            # routes each bot has answered so far; lets capture.mjs wait until the UI has loaded every bot
            return self.send_json({str(port): sorted(paths) for port, paths in HITS.items()})
        if name == "fleet":
            return self.send_json(
                {"bots": [{"name": b.name, "port": b.port, "pairs": b.pairs} for b in f.bots], "now": f.now}
            )
        return self.not_found("GET", self.path)


class QuietServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 128


def main():
    global FLEET, DIST, VERBOSE
    ap = argparse.ArgumentParser(description="Synthetic Freqtrade fleet for FreqUI Ultimate")
    ap.add_argument("--bots", type=int, default=8, help="number of simulated bots (max %d)" % len(BOT_SPECS))
    ap.add_argument("--base-port", type=int, default=3051, help="port of the first bot")
    ap.add_argument("--ui-port", type=int, default=3050, help="port serving dist/")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--dist", default=None, help="folder of the built UI (default: <repo>/dist)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--summary", action="store_true", help="print per-bot figures and exit")
    ap.add_argument("-v", "--verbose", action="store_true", help="log every request")
    args = ap.parse_args()
    VERBOSE = args.verbose
    n = max(1, min(args.bots, len(BOT_SPECS)))
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    DIST = os.path.abspath(args.dist or os.path.join(root, "dist"))
    now = int(time.time())
    t0 = time.time()
    FLEET = Fleet(n, args.base_port, args.seed, now)
    if args.summary:
        for b in FLEET.bots:
            p = b.profit()
            print(
                f"{b.name:22s} port={b.port} closed={len(b.closed_trades):4d} open={len(b.open_trades)} "
                f"profit={p['profit_closed_coin']:9.1f} ({p['profit_closed_percent']:6.1f}%) "
                f"open_pnl={b.open_profit_now():8.1f} wr={p['winrate']:.2f} maxdd={p['max_drawdown']*100:5.1f}% "
                f"balance={b.balance_total():9.1f}"
            )
            for t in b.open_trades:
                print(f"    open {t.pair:18s} {'S' if t.is_short else 'L'} entries={len(t.entries)} "
                      f"ratio={t.profit_ratio_now*100:6.2f}%")
        return 0
    servers = []
    for b in FLEET.bots:
        servers.append(QuietServer((args.host, b.port), BotHandler))
    if os.path.isdir(DIST):
        servers.append(QuietServer((args.host, args.ui_port), StaticHandler))
    else:
        sys.stderr.write(f"warning: {DIST} not found, run `pnpm build` first (UI port disabled)\n")
    threads = [threading.Thread(target=s.serve_forever, kwargs={"poll_interval": 0.3}, daemon=True) for s in servers]

    def shutdown(*_):
        STOP.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)
    for t in threads:
        t.start()
    print(f"demo fleet ready in {time.time() - t0:.1f}s (seed {args.seed})")
    print(f"  UI:   http://{args.host}:{args.ui_port}/")
    for b in FLEET.bots:
        print(f"  bot:  http://{args.host}:{b.port}  {b.name}")
    sys.stdout.flush()
    while not STOP.wait(0.5):
        pass
    for s in servers:
        s.shutdown()
        s.server_close()
    print("demo fleet stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
