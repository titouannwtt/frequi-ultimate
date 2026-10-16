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
    await expect(page.getByTestId('pair-navigator')).toBeVisible();
    await expect(page.getByTestId('bot-page').locator('tbody tr.act').first()).toBeVisible();
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
    await expect(page.getByTestId('trade-drawer-body')).toContainText('DCA ladder');
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

test.describe('Bot page on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.skip(({ browserName }) => browserName !== 'chromium', 'isMobile is Chromium only');
  test.beforeEach(async ({ context }) => {
    await seed(context);
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
