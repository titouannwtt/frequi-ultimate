import { expect, test } from '@playwright/test';

import { botKey, hasRig, noHorizontalOverflow, rig, seed } from './rig';

/**
 * Bot page (`/bot/:botKey`) on the rig: header, positions, the docked trade drawer on a desktop
 * and the bottom sheet on a phone (docs/redesign/02-design.md, sections 3.2 and 6).
 */
test.skip(!hasRig, 'needs the rig: pnpm e2e:rig');
test.use({ locale: 'en-US' });

const liveBot = () => rig().bots.find((b) => b.live && b.index === 0)!;

test.describe('Bot page on a desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ context }) => {
    await seed(context);
  });

  test('shows the bot, its mode and its positions', async ({ page }) => {
    const bot = liveBot();
    await page.goto(`/bot/${botKey(bot)}`);
    const header = page.getByTestId('bot-header');
    await expect(header).toContainText(bot.name);
    await expect(header).toContainText(/live/i);
    // The positions are listed once, by the Positions tab: no second list beside the chart
    await expect(page.getByTestId('pair-navigator')).toHaveCount(0);
    await expect(page.getByTestId('bot-page').locator('tbody tr.act').first()).toBeVisible();
  });

  test('the header has one action and four figures; the rest is in the More menu', async ({
    page,
  }) => {
    await page.goto(`/bot/${botKey(liveBot())}`);
    const header = page.getByTestId('bot-header');
    await expect(header.locator('.bar [data-action]')).toHaveCount(2);
    await expect(header.locator('button[data-action="pause"]')).toBeVisible();
    await expect(header.locator('button[data-action="exitAll"]')).toHaveCount(0);
    await expect(header.locator('.kpi')).toHaveCount(4);
    await header.locator('button[data-action="more"]').click();
    const menu = page.getByRole('menu');
    for (const name of [/Reload the config/, /See the config/, /Forced entry/]) {
      await expect(menu.getByRole('menuitem', { name })).toBeVisible();
    }
    // Sensitive actions come last, under their own heading
    await expect(menu.getByText('Sensitive actions')).toBeVisible();
    const items = await menu.getByRole('menuitem').allInnerTexts();
    expect(items.slice(-2).map((t) => t.trim())).toEqual(['Exit all…', 'Stop the bot…']);
    // The port and the exchange moved here from the header line
    await expect(menu).toContainText(`port ${liveBot().port}`);
    await expect(header.getByTestId('bot-meta')).not.toContainText('port');
  });

  test('three tabs and a More menu, and the chart offers four timeframes', async ({ page }) => {
    await page.goto(`/bot/${botKey(liveBot())}`);
    const page_ = page.getByTestId('bot-page');
    await expect(page_.getByRole('tab')).toHaveText([/Positions/, /History/, /Performance/]);
    await page_.getByTestId('bot-tabs-more').click();
    await page.getByRole('menuitem', { name: 'Logs' }).click();
    await expect(page_.getByRole('tab', { selected: true })).toHaveText(/Logs/);
    await expect(page).toHaveURL(/tab=logs/);
    expect(
      await page_.getByRole('radiogroup', { name: 'Timeframe' }).getByRole('radio').count(),
    ).toBeLessThanOrEqual(5);
  });

  test('a position opens the trade drawer, docked, with its exit and add foot', async ({
    page,
  }) => {
    const bot = liveBot();
    await page.goto(`/bot/${botKey(bot)}`);
    await page.getByTestId('bot-page').locator('tbody tr.act').first().click();
    const drawer = page.getByTestId('trade-drawer');
    await expect(drawer).toBeVisible();
    // The drawer names the bot it acts on
    await expect(drawer.getByTestId('drawer-target')).toContainText(bot.name);
    await expect(drawer.locator('button[data-action="exit"]')).toBeVisible();
    await expect(drawer.locator('button[data-action="add"]')).toBeVisible();
    // Three sentences, each with its distance, and the top-up bar
    const body = page.getByTestId('trade-drawer-body');
    await expect(body.locator('[data-sentence="target"]')).toBeVisible();
    await expect(body.locator('[data-sentence="refill"]')).toBeVisible();
    await expect(body.locator('[data-sentence="liq"]')).toContainText(/Liquidation/);
    await expect(body.getByTestId('drawer-refills')).toContainText('Top-ups used');
    // The share to exit is chosen in the confirmation, not in the foot
    await expect(drawer.getByRole('radio')).toHaveCount(0);
  });

  test('the last bot opened is where the Bot tab leads', async ({ page }) => {
    const bot = liveBot();
    await page.goto(`/bot/${botKey(bot)}`);
    await page.locator('nav.nav button[data-nav="fleet"]').click();
    await expect(page.getByTestId('fleet-page')).toBeVisible();
    await page.locator('nav.nav button[data-nav="bot"]').click();
    await expect(page.getByTestId('bot-header')).toContainText(bot.name);
  });
});

test.describe('Bot page on a laptop (1280 x 720)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test.beforeEach(async ({ context }) => {
    await seed(context);
  });

  test('the RSI sub-chart stays on the page: the page scrolls rather than dropping it (B397)', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const sub = page.getByTestId('bot-page').getByTestId('candle-subhd').first();
    // The first candle request of a freshly started rig can wait for the gateway's first polls
    // (it then times out after 20 s): load the page again until the chart is there
    await expect(async () => {
      await page.goto(`/bot/${botKey(liveBot())}`);
      await expect(sub).toHaveCount(1, { timeout: 25_000 });
    }).toPass({ timeout: 120_000 });
    await expect(sub).toContainText(/RSI/);
    // "No room for 1 more": that sentence must not be needed
    await expect(page.getByTestId('bot-page')).not.toContainText(/No room for/);
    // The price pane is still a price pane, not a strip
    const plot = await page.getByTestId('bot-page').locator('.plot').first().boundingBox();
    expect(plot!.height).toBeGreaterThanOrEqual(298);
  });
});

test.describe('Bot page on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.skip(({ browserName }) => browserName !== 'chromium', 'isMobile is Chromium only');
  test.beforeEach(async ({ context }) => {
    await seed(context);
  });

  test('two action tiles and four figures in two columns, no overflow', async ({ page }) => {
    await page.goto(`/bot/${botKey(liveBot())}`);
    await expect(page.getByTestId('bot-page')).toBeVisible();
    const tiles = page.locator('.tiles .tile');
    await expect(tiles).toHaveCount(2);
    await expect(tiles.first()).toHaveAttribute('data-action', 'pause');
    await expect(tiles.last()).toHaveAttribute('data-action', 'more');
    await expect(page.getByTestId('bot-header').locator('.kpi')).toHaveCount(4);
    // "Exit all" stays at the foot of the page and in the More menu, never among the tiles
    await expect(page.locator('.tiles button[data-action="exitAll"]')).toHaveCount(0);
    await expect(page.getByTestId('sensitive-actions')).toBeAttached();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('the card says what the figure under the entry and the "1/1" are (B395)', async ({
    page,
  }) => {
    await page.goto(`/bot/${botKey(liveBot())}`);
    const card = page.locator('[data-trade-key]').first();
    await expect(card).toBeVisible();
    await expect(card.locator('.m2 .sub .sl')).toHaveText('Price');
    await expect(card.getByTestId('card-orders').locator('.sl')).toHaveText('Orders');
    await expect(card.getByTestId('card-orders').locator('.pips')).toHaveAttribute(
      'title',
      /\d+ of \d+ orders filled/,
    );
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('lists positions as cards and opens the drawer as a bottom sheet', async ({ page }) => {
    const bot = liveBot();
    await page.goto(`/bot/${botKey(bot)}`);
    await expect(page.getByTestId('bot-page')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    const card = page.locator('[data-trade-key]').first();
    await expect(card).toBeVisible();
    await card.click();
    const drawer = page.getByTestId('trade-drawer');
    await expect(drawer).toBeVisible();
    // The foot of the sheet holds the actions and stays inside the screen
    const exit = page.getByRole('dialog').locator('button[data-action="exit"]');
    await expect(exit).toBeVisible();
    // The sheet slides in: wait for it to settle, then check the button is fully on screen
    await expect
      .poll(async () => {
        const box = await exit.boundingBox();
        return box ? box.y + box.height : Infinity;
      })
      .toBeLessThanOrEqual(844);
    const box = (await exit.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
});
