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
    // The chart answers one way or the other, never a blank or a crash: the fake bots serve a
    // curve, but the gateway queues the relay behind the polling of the 40 bots and a read that
    // is too slow ends as "no candle" (allow it time)
    await expect(page.getByTestId('chart-cell')).toContainText(/no candle|\bO \d/i, {
      timeout: 75_000,
    });

    // One button for the pair and its bot, four timeframes and "Other", and one Display menu
    await expect(page.getByTestId('charts-pair')).toContainText(/computed by/);
    await expect(page.getByRole('radio')).toHaveCount(4);
    await page.getByRole('radio', { name: '1 h' }).click();
    await expect(page).toHaveURL(/tf=1h/);
    await page.getByTestId('charts-tf-other').click();
    await page.getByRole('menuitem', { name: '30 min' }).click();
    await expect(page).toHaveURL(/tf=30m/);
    await page.getByRole('radio', { name: '1 h' }).click();
    await expect(page).toHaveURL(/tf=1h/);
    await page.getByTestId('charts-display').click();
    await page.getByRole('switch', { name: 'Two charts side by side' }).click();
    await expect(page).toHaveURL(/cells=2/);
    await page.keyboard.press('Escape');
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

    // The export lives in the "..." menu and downloads a CSV (the gateway builds it from the
    // whole set)
    await page.getByTestId('jf-more').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'CSV of the whole filtered set' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('four totals, the other figures one click away, filters in one sheet', async ({ page }) => {
    await page.goto('/journal');
    await expect(page.getByTestId('journal-page')).toBeVisible();
    // Net result, win rate, average win / loss, worst trade: nothing else until asked
    for (const id of ['jt-net', 'jt-winrate', 'jt-avg', 'jt-worst']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId('jt-factor')).toHaveCount(0);
    await page.getByTestId('jt-more').click();
    for (const id of ['jt-factor', 'jt-expectancy', 'jt-worstdd', 'jt-duration', 'jt-perday']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await page.getByTestId('jt-more').click();
    await expect(page.getByTestId('jt-factor')).toHaveCount(0);

    // Bots, side, reason and depth are behind "Filters": no chip while none is on
    await expect(page.getByTestId('jf-side')).toHaveCount(0);
    await expect(page.getByTestId('jf-filters')).toHaveText('Filters');
    const count = async () =>
      (await page.getByTestId('journal-totals').innerText()).match(/(\d[\d\s,.]*) trades/)?.[1];
    const all = await count();
    // B320: a change on the bar reaches the query (the period used to be ignored)
    await page.getByTestId('jf-period').getByRole('radio', { name: '30 d' }).click();
    await expect.poll(count).not.toBe(all);
    await page.getByTestId('jf-period').getByRole('radio', { name: '7 d' }).click();
    await expect.poll(count).toBe(all);
    // B322: the range dates open under the period control, not in the corner of the page
    await page.getByTestId('jf-period').getByRole('radio', { name: 'Range' }).click();
    const dates = page.getByRole('dialog', { name: 'Range' });
    await expect(dates).toBeVisible();
    const control = await page.getByTestId('jf-period').boundingBox();
    const box = await dates.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(control!.y + control!.height);
    await page.keyboard.press('Escape');
    await page.getByTestId('jf-period').getByRole('radio', { name: '7 d' }).click();
    await expect.poll(count).toBe(all);
    await page.getByTestId('jf-filters').click();
    await expect(page.getByTestId('jf-sheet')).toBeVisible();
    await page.getByTestId('jf-side-pick').getByRole('radio', { name: 'Short' }).click();
    await page.getByTestId('jf-sheet-done').click();
    // An active filter stays on the bar with its value and is counted on the button
    await expect(page.getByTestId('jf-side')).toContainText('Short');
    await expect(page.getByTestId('jf-filters')).toHaveText('Filters (1)');
    await expect.poll(count).not.toBe(all);
    await page
      .getByTestId('jf-side')
      .getByRole('button', { name: /Remove/i })
      .click();
    await expect(page.getByTestId('jf-side')).toHaveCount(0);
    await expect(page.getByTestId('jf-filters')).toHaveText('Filters');
  });

  test('the analysis holds the ranking and the calendar of the Fleet, and the view is in the URL', async ({
    page,
  }) => {
    await page.goto('/journal');
    await expect(page.getByTestId('journal-page')).toBeVisible();
    await page.getByTestId('jr-view').getByRole('tab', { name: 'Analysis' }).click();
    await expect(page).toHaveURL(/view=analysis/);
    await page.getByTestId('jr-an').getByRole('tab', { name: 'Ranking' }).click();
    await expect(page.getByTestId('leaderboard')).toBeVisible();
    await page.getByTestId('jr-an').getByRole('tab', { name: 'Calendar' }).click();
    await expect(page.getByTestId('pnl-calendar')).toBeVisible();
    await expect(page).toHaveURL(/an=calendar/);
    // A reload comes back to the same panel
    await page.reload();
    await expect(page.getByTestId('pnl-calendar')).toBeVisible();
    // The list is one click away
    await page.getByTestId('jr-view').getByRole('tab', { name: 'List' }).click();
    await expect(page.getByTestId('group-head').first()).toBeVisible();
  });
});

test.describe('Journal on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('nothing scrolls sideways, in the list and in the analysis', async ({ page }) => {
    const sideways = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    await page.goto('/journal');
    await expect(page.getByTestId('journal-totals')).toBeVisible();
    await expect(page.getByTestId('group-head').first()).toBeVisible();
    expect(await sideways()).toBeLessThanOrEqual(0);
    await page.goto('/journal?view=analysis&an=calendar');
    await expect(page.getByTestId('pnl-calendar')).toBeVisible();
    expect(await sideways()).toBeLessThanOrEqual(0);
  });
});
