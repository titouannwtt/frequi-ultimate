import { expect, test } from '@playwright/test';

import { botKey, hasRig, noHorizontalOverflow, rig, seed } from './rig';

/**
 * Fleet (`/dashboard`) on the rig: 40 fake bots behind the real gateway, a desktop and a phone
 * viewport (docs/redesign/02-design.md, sections 2.3, 2.5 and 3.1).
 */
test.skip(!hasRig, 'needs the rig: pnpm e2e:rig');
test.use({ locale: 'en-US' });

const liveBots = () => rig().bots.filter((b) => b.live);

test.describe('Fleet on a desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ context }) => {
    await seed(context);
  });

  test('reads the fleet from the gateway: pill, KPIs, one row per live bot', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('fleet-page')).toBeVisible();
    await expect(page.locator('button.conn[data-kind="gateway"]')).toBeVisible();
    await expect(page.getByTestId('fleet-kpis')).toBeVisible();
    await expect(page.getByTestId('kpi-equity')).toBeVisible();
    for (const b of liveBots()) {
      await expect(page.locator(`tr[data-bot-key="${botKey(b)}"]`)).toBeVisible();
    }
    // The default scope is Live: no dry bot in the table
    const dry = rig().bots.find((b) => !b.live)!;
    await expect(page.locator(`tr[data-bot-key="${botKey(dry)}"]`)).toHaveCount(0);
  });

  test('the All scope lists every bot and the offline one is flagged', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/dashboard');
    await page.getByLabel('Trading mode').getByRole('radio', { name: 'All' }).click();
    await expect(page.locator('tr[data-bot-key]')).toHaveCount(rig().bots.length);
    // The bot that never answers (still starting) raises an alert that names it, once the gateway
    // has given up on it (a few polls with backoff after the rig starts)
    const silent = rig().bots[rig().starting[0]!]!;
    const rail = page.getByTestId('alert-rail');
    await expect(rail).toContainText(silent.name, { timeout: 90_000 });
    await expect(rail).toContainText('Bot offline');
  });

  test('a long bot name stays inside its cell', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByLabel('Trading mode').getByRole('radio', { name: 'All' }).click();
    const long = rig().bots.find((b) => b.name.length > 40)!;
    const row = page.locator(`tr[data-bot-key="${botKey(long)}"]`);
    await expect(row).toBeVisible();
    const overflow = await row.evaluate(
      (tr) =>
        [...tr.querySelectorAll('td')].filter((td) => td.scrollWidth > td.clientWidth + 1).length,
    );
    expect(overflow).toBe(0);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('selecting a row opens the scope panel', async ({ page }) => {
    await page.goto('/dashboard');
    const b = liveBots()[0]!;
    await page.locator(`tr[data-bot-key="${botKey(b)}"]`).click();
    await expect(page.getByTestId('scope-panel')).toBeVisible();
  });
});

test.describe('Fleet on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test.skip(({ browserName }) => browserName !== 'chromium', 'isMobile is Chromium only');
  test.beforeEach(async ({ context }) => {
    await seed(context);
  });

  test('stacks the fleet, keeps the bottom bar and never scrolls sideways', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('fleet-page')).toBeVisible();
    await expect(page.getByTestId('fleet-kpis')).toBeVisible();
    const bar = page.getByRole('navigation').last();
    for (const name of ['Fleet', 'Bot', 'Charts', 'Journal']) {
      await expect(bar.getByText(name, { exact: true })).toBeVisible();
    }
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('the bottom bar reaches the Bot page', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('navigation').last().getByText('Bot', { exact: true }).click();
    await expect(page.getByTestId('bot-page')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
});
