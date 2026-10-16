import { expect, test } from '@playwright/test';

import { hasRig, seed } from './rig';

/** Charts and Journal on the rig (docs/redesign/02-design.md, sections 3.3 and 3.4). */
test.skip(!hasRig, 'needs the rig: pnpm e2e:rig');
test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ context }) => {
  await seed(context);
});

test.describe('Charts', () => {
  test('opens on the worst position, keeps its state in the URL and says when a bot has no candles', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/charts');
    await expect(page.getByTestId('charts-page')).toBeVisible();
    await expect(page.getByTestId('pair-navigator')).toBeVisible();
    // The rig's bots serve no candles: the chart says so instead of failing
    // (the gateway queues the relay behind the polling of the 40 bots: allow it time)
    await expect(page.getByTestId('chart-cell')).toContainText(/no candle/i, { timeout: 75_000 });

    await page.getByRole('radio', { name: '1h' }).click();
    await expect(page).toHaveURL(/tf=1h/);
    await page.getByRole('radio', { name: '2 cells' }).click();
    await expect(page).toHaveURL(/cells=2/);
    await expect(page.getByTestId('chart-cell')).toHaveCount(2);
    // The state survives a reload
    await page.reload();
    await expect(page.getByTestId('chart-cell')).toHaveCount(2);
    await expect(page).toHaveURL(/tf=1h/);
  });
});

test.describe('Journal', () => {
  test('totals on the filtered set, grouping and a CSV of the whole selection', async ({
    page,
  }) => {
    await page.goto('/journal');
    await expect(page.getByTestId('journal-page')).toBeVisible();
    const totals = page.getByTestId('journal-totals');
    await expect(totals).toBeVisible();
    await expect(page.getByTestId('jt-net')).toContainText(/USDC/);
    await expect(page.getByTestId('jt-winrate')).toContainText('%');
    await expect(page.getByTestId('group-head').first()).toBeVisible();

    // Grouping by bot replaces the day heads by bot heads
    const before = await page.getByTestId('group-head').first().innerText();
    await page.getByRole('radio', { name: 'By bot' }).first().click();
    await expect(page.getByTestId('group-head').first()).not.toHaveText(before);

    // The mode filter narrows the set: the number of trades changes
    const count = async () =>
      (await page.getByTestId('journal-totals').innerText()).match(/(\d[\d\s,.]*) trades/)?.[1];
    const live = await count();
    await page.getByTestId('jf-mode').getByRole('radio', { name: 'All' }).click();
    await expect.poll(count).not.toBe(live);

    // The export downloads a CSV (the gateway builds it from the whole set)
    await page.getByTestId('jf-export').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'CSV of the whole filtered set' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });
});
