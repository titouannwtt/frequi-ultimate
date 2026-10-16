import { expect, test, type Page } from '@playwright/test';

import { botKey, hasRig, noHorizontalOverflow, rig, seed } from './rig';

/**
 * Fleet (`/dashboard`) on the rig: 40 fake bots behind the real gateway, a desktop and a phone
 * viewport (docs/redesign/02-design.md, sections 2.3, 2.5 and 3.1).
 */
test.skip(!hasRig, 'needs the rig: pnpm e2e:rig');
test.use({ locale: 'en-US' });

const liveBots = () => rig().bots.filter((b) => b.live);

/** The list stops at eight bots: open the others, as a reader would. */
async function showEveryBot(page: Page) {
  const more = page.getByTestId('fleet-more-bots');
  if (await more.count()) await more.click();
}

test.describe('Fleet on a desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(async ({ context }) => {
    await seed(context);
  });

  test('reads the fleet from the gateway: pill, verdict, four figures, one row per live bot', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('fleet-page')).toBeVisible();
    await expect(page.locator('button.conn[data-kind="gateway"]')).toBeVisible();
    await expect(page.getByTestId('fleet-verdict')).toBeVisible();
    await expect(page.getByTestId('fleet-kpis')).toBeVisible();
    await expect(page.getByTestId('fleet-kpis').locator('.kpi')).toHaveCount(4);
    await expect(page.getByTestId('kpi-equity')).toBeVisible();
    await expect(page.getByTestId('kpi-30d')).toBeVisible();
    await expect(page.getByTestId('kpi-dd')).toBeVisible();
    await expect(page.getByTestId('kpi-margin')).toBeVisible();
    await showEveryBot(page);
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
    await showEveryBot(page);
    await expect(page.locator('tr[data-bot-key]')).toHaveCount(rig().bots.length);
    // The bot that never answers (still starting) raises an alert that names it, once the gateway
    // has given up on it (a few polls with backoff after the rig starts). The Fleet shows the
    // active alerts as cards; the whole history is behind the bell.
    const silent = rig().bots[rig().starting[0]!]!;
    await page.getByRole('button', { name: 'Alerts' }).click();
    const rail = page.getByTestId('alert-rail');
    await expect(rail).toContainText(silent.name, { timeout: 90_000 });
    await expect(rail).toContainText('Bot offline');
    // The rail of four tabs is not on the page any more: only in the bell
    await page.keyboard.press('Escape');
    await expect(rail).toHaveCount(0);
  });

  test('a long bot name stays inside its cell', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByLabel('Trading mode').getByRole('radio', { name: 'All' }).click();
    await showEveryBot(page);
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

  test('no placeholder word in a value slot, loading or loaded; the figures arrive', async ({
    page,
  }) => {
    const placeholder = /(?<![\w&])(n\/[ad]|unknown|not read yet|--)(?![\w])/i;
    await page.goto('/dashboard');
    await expect(page.getByTestId('fleet-kpis')).toBeVisible();
    // Whatever the moment: a figure, a spinner or an unavailable icon, never a word
    for (let i = 0; i < 4; i++) {
      expect(await page.getByTestId('fleet-kpis').locator('.v').allInnerTexts()).not.toContainEqual(
        expect.stringMatching(placeholder),
      );
      expect(await page.locator('tr[data-bot-key]').first().innerText()).not.toMatch(placeholder);
      await page.waitForTimeout(500);
    }
    // Once loaded, the open P&L (in the sub-line of the capital) is a signed figure (the fake
    // bots are priced), not an icon
    await expect(page.getByTestId('kpi-open')).toHaveText(/[+\u2212-]\d/, { timeout: 30_000 });
    await expect(page.getByTestId('kpi-open').locator('[data-state]')).toHaveCount(0);
  });

  test('the five positions to watch, in words, and the full table one click away', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    const list = page.getByTestId('watch-list');
    await expect(list.locator('li.row')).toHaveCount(5, { timeout: 30_000 });
    await expect(list.locator('li.row').first()).toContainText('Liquidation');
    // No exit button on a row: a click opens the position, where "Exit..." and its confirmation live
    await expect(list.locator('[data-action]')).toHaveCount(0);
    await list.locator('li.row').first().click();
    await expect(page.getByTestId('trade-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('positions-toggle').click();
    await expect(page.locator('.positions .tt')).toBeVisible();
    await expect(list).toHaveCount(0);
  });

  test('the capital curve fills its panel, and the risk is one word and four lines', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    const chart = page.locator('.equity [data-testid=equity-curve] > .chart.fill');
    await expect(chart).toBeVisible({ timeout: 30_000 });
    const body = await page.locator('.equity .pb').boundingBox();
    const box = await chart.boundingBox();
    expect(body && box).toBeTruthy();
    // The chart takes the room under the figures: its bottom meets the bottom of the panel
    expect(box!.height).toBeGreaterThan(150);
    expect(body!.y + body!.height - (box!.y + box!.height)).toBeLessThan(24);
    await expect(page.getByTestId('risk-level')).toBeVisible();
    await expect(page.locator('.risk dl.sum dt')).toHaveCount(4);
  });

  test('the bell opens the alert centre', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Alerts' }).click();
    const rail = page.getByTestId('alert-rail');
    await expect(rail).toBeVisible();
    for (const tab of ['Active', 'Acknowledged', 'Silenced', 'Events']) {
      await expect(rail.getByRole('tab', { name: new RegExp(tab) })).toBeVisible();
    }
  });

  test('"Columns" adds a column to the bots table', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('tr[data-bot-key]').first()).toBeVisible();
    await expect(page.locator('th', { hasText: 'Age' })).toHaveCount(0);
    await page.getByTestId('fleet-columns').click();
    await page.locator('.colmenu label', { hasText: 'Age' }).locator('input').check();
    await expect(page.locator('th', { hasText: 'Age' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore the default columns' }).click();
    await expect(page.locator('th', { hasText: 'Age' })).toHaveCount(0);
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

  test('the phone starts with the verdict, the 2 x 2 figures and the positions to watch', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('fleet-verdict')).toBeVisible();
    const tiles = page.getByTestId('fleet-kpis').locator('.kpi');
    await expect(tiles).toHaveCount(4);
    const boxes = await tiles.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y) };
      }),
    );
    // Two columns, two rows
    expect(new Set(boxes.map((b) => b.y)).size).toBe(2);
    expect(new Set(boxes.map((b) => b.x)).size).toBe(2);
    await expect(page.getByTestId('watch-list').locator('li.row')).toHaveCount(3, {
      timeout: 30_000,
    });
  });

  test('a position card has no exit button: a tap opens the drawer (L8)', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByTestId('positions-toggle').click();
    const cards = page.locator('.positions article.card[data-trade-key]');
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.positions [data-action="exit"]')).toHaveCount(0);
    await cards.first().click();
    await expect(page.getByTestId('trade-drawer')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('the controls of the page are at least 44 px high', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByTestId('positions-toggle')).toBeVisible({ timeout: 30_000 });
    for (const id of ['fleet-filter-toggle', 'positions-toggle', 'fleet-more-bots']) {
      const target = page.getByTestId(id);
      if ((await target.count()) === 0) continue;
      const box = await target.first().boundingBox();
      expect(box!.height, id).toBeGreaterThanOrEqual(44);
    }
  });

  test('the bottom bar reaches the Bot page', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('navigation').last().getByText('Bot', { exact: true }).click();
    await expect(page.getByTestId('bot-page')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
});
