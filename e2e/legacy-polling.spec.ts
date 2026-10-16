import { expect, test } from '@playwright/test';

import { allowBotCors, hasRig, rig, seed } from './rig';

/**
 * The legacy polling (every bot polled by the browser itself) belongs to the legacy tools only.
 * Behind the gateway, the Fleet page must not send a single request to a bot: those would come on
 * top of the gateway's own request budget, on the IP the bots share with the exchange.
 */
test.skip(!hasRig, 'needs the rig: pnpm e2e:rig');
test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
test.setTimeout(120_000);

test('no direct request to a bot on the Fleet page, even after a round trip through a tool', async ({
  page,
  context,
  baseURL,
}) => {
  await seed(context);
  await allowBotCors(context, new URL(baseURL!).origin);
  const ports = new Set(rig().bots.map((b) => b.port));
  let direct = 0;
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname === '127.0.0.1' && ports.has(Number(u.port)) && u.pathname.startsWith('/api')) {
      direct += 1;
    }
  });

  // The first visit of a legacy tool makes the dev server optimise its dependencies and reload
  // the page: do it once before counting
  await page.goto('/tools/backtest');
  await expect(page).toHaveURL(/\/tools\/backtest$/);
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(3000);
  direct = 0;

  await page.goto('/dashboard');
  await expect(page.locator('button.conn[data-kind="gateway"]')).toBeVisible();
  await expect(page.getByTestId('fleet-page')).toBeVisible();
  await page.waitForTimeout(3000);
  expect(direct, 'the Fleet page starts by reading the gateway only').toBe(0);

  // A legacy tool starts the browser's own polling of the bots
  await page.locator('button[data-nav="tools"]').click();
  await page.getByRole('menuitem', { name: 'Backtest' }).click();
  await expect(page).toHaveURL(/\/tools\/backtest$/);
  await expect.poll(() => direct, { timeout: 30_000 }).toBeGreaterThan(0);

  // Back on the Fleet: the polling stops and stays stopped (longer than the 10 s and 60 s ticks)
  await page.locator('button[data-nav="fleet"]').click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId('fleet-page')).toBeVisible();
  // Requests already in flight when the user left may still land
  await page.waitForTimeout(3000);
  const settled = direct;
  await page.waitForTimeout(25_000);
  expect(direct, 'no request from the browser to a bot while on the Fleet page').toBe(settled);
});
