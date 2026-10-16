import { writeFileSync } from 'node:fs';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { allowBotCors, botKey, hasRig, openTrades, rig, seed, type RigOpenTrade } from './rig';

/**
 * What the Charts page draws about a trade (docs/redesign/02-design.md, section 3.3): where it
 * entered, every filled order, the gain now, the orders that wait and the closed trades of the
 * pair. The fake bots serve candles that have nothing to do with their trades, so the candles are
 * answered here from the trade itself; everything else comes from the rig.
 */
test.skip(!hasRig, 'needs the rig: pnpm e2e:rig');
test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
test.setTimeout(150_000);

const MIN = 60_000;

function tfMs(tf: string): number {
  const n = Number.parseInt(tf, 10);
  return n * ({ m: MIN, h: 60 * MIN, d: 1440 * MIN }[tf.slice(-1) as 'm' | 'h' | 'd'] ?? MIN);
}

/** Candles whose price goes through the entry price at the open date and ends at the current rate. */
function candlesFor(t: RigOpenTrade, tf: string, limit: number) {
  const step = tfMs(tf);
  const now = Date.now();
  const last = Math.floor(now / step) * step;
  const target = t.current_rate / t.open_rate - 1;
  const price = (ts: number) => {
    const wobble = 0.006 * Math.sin(ts / (step * 9)) + 0.003 * Math.sin(ts / (step * 3.7));
    const after = Math.max(
      0,
      Math.min(1, (ts - t.open_timestamp) / Math.max(1, now - t.open_timestamp)),
    );
    return (
      t.open_rate *
      (1 +
        (ts < t.open_timestamp
          ? 0.012 * (1 - Math.min(1, (t.open_timestamp - ts) / (60 * step)))
          : target * after) +
        wobble)
    );
  };
  const rows = Array.from({ length: limit }, (_, i) => {
    const ts = last - (limit - 1 - i) * step;
    const o = price(ts);
    const c = price(ts + step);
    return [
      new Date(ts).toISOString().slice(0, 19).replace('T', ' '),
      o,
      Math.max(o, c) * 1.0015,
      Math.min(o, c) * 0.9985,
      c,
      100 + (i % 7) * 10,
      50 + 20 * Math.sin(i / 8),
      ts,
    ];
  });
  return {
    strategy: 'FakeStrategy',
    pair: t.pair,
    timeframe: tf,
    timeframe_ms: step,
    columns: ['date', 'open', 'high', 'low', 'close', 'volume', 'rsi', '__date_ts'],
    data: rows,
    length: rows.length,
  };
}

/** Two trades of the pair already closed: a win and a loss, a few hours ago. */
function closedFor(t: RigOpenTrade) {
  const now = Date.now();
  const mk = (id: number, agoOpenH: number, agoCloseH: number, pct: number, reason: string) => {
    const open = t.open_rate * 1.01;
    const close = open * (1 + (t.is_short ? -pct : pct));
    return {
      trade_id: id,
      pair: t.pair,
      is_open: false,
      is_short: t.is_short,
      leverage: 2,
      open_timestamp: now - agoOpenH * 3_600_000,
      close_timestamp: now - agoCloseH * 3_600_000,
      open_date: new Date(now - agoOpenH * 3_600_000).toISOString(),
      close_date: new Date(now - agoCloseH * 3_600_000).toISOString(),
      open_rate: open,
      close_rate: close,
      amount: 1,
      stake_amount: 50,
      profit_abs: pct * 100,
      profit_ratio: pct * 2,
      exit_reason: reason,
      nr_of_successful_entries: 1,
    };
  };
  return [mk(901, 30, 26, 0.012, 'roi'), mk(902, 22, 16, -0.015, 'stop_loss')];
}

async function liveTrade(): Promise<{
  bot: ReturnType<typeof rig>['bots'][number];
  trade: RigOpenTrade;
}> {
  const bot = rig().bots.find((b) => b.live)!;
  const trade = (await openTrades(bot))[0]!;
  return { bot, trade };
}

async function shot(page: Page, name: string) {
  const dir = process.env.FQ_E2E_SHOT_DIR;
  if (!dir) return;
  writeFileSync(`${dir}/${name}.png`, await page.screenshot());
}

async function answerCandles(context: BrowserContext, t: RigOpenTrade) {
  // Through the gateway the candles come from `/bots/<key>/proxy/pair_candles`
  await context.route(/\/proxy\/pair_candles\?/, async (route) => {
    const u = new URL(route.request().url());
    const tf = u.searchParams.get('timeframe') ?? '15m';
    const limit = Number(u.searchParams.get('limit') ?? 500);
    await route.fulfill({ json: candlesFor(t, tf, limit) });
  });
}

test.describe('Charts overlays on the rig', () => {
  test('through the gateway: entry, filled orders and gain are on the chart', async ({
    page,
    context,
  }) => {
    const { bot, trade } = await liveTrade();
    await seed(context);
    await answerCandles(context, trade);
    await page.goto(
      `/charts?bot=${encodeURIComponent(botKey(bot))}&pair=${encodeURIComponent(trade.pair)}`,
    );
    const chart = page.getByTestId('candle-chart');
    await expect(chart).toBeVisible({ timeout: 90_000 });
    // The open position is framed, its ledger orders are filled markers, the gain is drawn
    await expect(chart).toHaveAttribute('data-framed', '1', { timeout: 60_000 });
    await expect(chart).not.toHaveAttribute('data-fills', '0', { timeout: 60_000 });
    await expect(chart).toHaveAttribute('data-gain', '1');
    // No candle of the rig is hidden: the entry date is inside the window, so no edge marker
    await expect(page.getByTestId('candle-entry-edge')).toHaveCount(0);
    // The overlays are switched from the Display menu, all on at first
    await page.getByTestId('charts-display').click();
    await expect(page.getByRole('switch', { name: 'Closed trades' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('switch', { name: 'Current gain' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('switch', { name: 'Pending orders' })).toBeVisible();
  });

  test('direct to the bot: pending orders, closed trades, the edge marker and the screenshot', async ({
    page,
    context,
    baseURL,
  }) => {
    const { bot, trade: real } = await liveTrade();
    // The same trade; the edge scenario below moves its open date back (the bot's answer is rewritten)
    const trade = { ...real };
    await seed(context, { mode: 'direct', only: [bot.index] });
    await allowBotCors(context, new URL(baseURL!).origin);
    const base = new RegExp(`^http://127\\.0\\.0\\.1:${bot.port}/api/v1/`);
    const cors = { 'access-control-allow-origin': new URL(baseURL!).origin };
    const open = trade.open_timestamp;
    const side = trade.is_short ? -1 : 1;
    const orders = [
      {
        ft_order_side: trade.is_short ? 'sell' : 'buy',
        ft_is_entry: true,
        status: 'closed',
        is_open: false,
        filled: 1,
        amount: 1,
        safe_price: trade.open_rate,
        price: trade.open_rate,
        cost: 50,
        order_filled_timestamp: open,
      },
      {
        ft_order_side: trade.is_short ? 'sell' : 'buy',
        ft_is_entry: true,
        status: 'closed',
        is_open: false,
        filled: 1,
        amount: 1,
        safe_price: trade.open_rate * (1 - 0.02 * side),
        price: trade.open_rate * (1 - 0.02 * side),
        cost: 50,
        order_filled_timestamp: open + 60 * MIN,
      },
      {
        ft_order_side: trade.is_short ? 'sell' : 'buy',
        ft_is_entry: true,
        status: 'closed',
        is_open: false,
        filled: 1,
        amount: 1,
        safe_price: trade.open_rate * (1 - 0.035 * side),
        price: trade.open_rate * (1 - 0.035 * side),
        cost: 50,
        order_filled_timestamp: open + 150 * MIN,
      },
      {
        ft_order_side: trade.is_short ? 'sell' : 'buy',
        ft_is_entry: true,
        status: 'open',
        is_open: true,
        filled: 0,
        amount: 1,
        price: trade.open_rate * (1 - 0.06 * side),
      },
      {
        ft_order_side: trade.is_short ? 'buy' : 'sell',
        ft_is_entry: false,
        status: 'open',
        is_open: true,
        filled: 0,
        amount: 3,
        price: trade.open_rate * (1 + 0.02 * side),
      },
      {
        ft_order_side: 'stoploss',
        ft_is_entry: false,
        status: 'open',
        is_open: true,
        amount: 3,
        stop_price: trade.open_rate * (1 - 0.08 * side),
      },
    ];
    await context.route(base, async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname.endsWith(`/trade/${trade.trade_id}`)) {
        return route.fulfill({ headers: cors, json: { trade_id: trade.trade_id, orders } });
      }
      if (u.pathname.endsWith('/pair_candles')) {
        const tf = u.searchParams.get('timeframe') ?? '15m';
        const limit = Number(u.searchParams.get('limit') ?? 500);
        return route.fulfill({ headers: cors, json: candlesFor(trade, tf, limit) });
      }
      if (u.pathname === '/api/v1/status') {
        const res = await route.fetch();
        const list = (await res.json()) as unknown;
        if (!Array.isArray(list)) return route.fulfill({ response: res, headers: cors });
        const mine = (list as RigOpenTrade[]).find((x) => x.trade_id === trade.trade_id);
        if (mine) {
          mine.open_timestamp = trade.open_timestamp;
          (mine as unknown as { open_date: string }).open_date = new Date(
            trade.open_timestamp,
          ).toISOString();
        }
        return route.fulfill({ headers: cors, json: list });
      }
      if (u.pathname.endsWith('/trades')) {
        const rows = closedFor(trade);
        return route.fulfill({
          headers: cors,
          json: { trades: rows, trades_count: rows.length, offset: 0, total_trades: rows.length },
        });
      }
      return route.fallback();
    });

    const url = `/charts?bot=${encodeURIComponent(botKey(bot))}&pair=${encodeURIComponent(trade.pair)}`;
    await page.goto(url);
    const chart = page.getByTestId('candle-chart');
    await expect(chart).toBeVisible({ timeout: 90_000 });
    await expect(chart).toHaveAttribute('data-fills', '3', { timeout: 60_000 });
    await expect(chart).toHaveAttribute('data-framed', '1');
    // DCA, take profit and stop wait: three lines
    await expect(chart).toHaveAttribute('data-pending', '3');
    await expect(chart).toHaveAttribute('data-closed', '2', { timeout: 60_000 });
    await expect(chart).toHaveAttribute('data-gain', '1');
    await page.waitForTimeout(800);
    await shot(page, 'chart-overlays');

    // A candle size that puts the entry far back: the edge marker says so and a click brings it back
    trade.open_timestamp = Date.now() - 12 * 60 * MIN;
    await page.goto(`${url}&tf=1m`);
    const edge = page.getByTestId('candle-entry-edge');
    await expect(edge).toBeVisible({ timeout: 60_000 });
    await expect(edge).toContainText(/entered .* ago/);
    await edge.click();
    await expect(edge).toHaveCount(0);
    await page.waitForTimeout(500);
    await shot(page, 'chart-overlays-edge');

    // The Display menu switches the drawings off, and the chart follows
    await page.getByTestId('charts-display').click();
    const closed = page.getByRole('switch', { name: 'Closed trades' });
    await closed.click();
    await expect(closed).toHaveAttribute('aria-checked', 'false');
    await expect(chart).toHaveAttribute('data-closed', '2');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('charts-display-menu')).toHaveCount(0);
  });
});
