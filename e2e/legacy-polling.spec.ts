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

test('no direct bot connection on Fleet, Bot, Journal and Charts: no socket, no request (B192)', async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await seed(context);
  await allowBotCors(context, new URL(baseURL!).origin);
  const bots = rig().bots;
  const ports = new Set(bots.map((b) => b.port));
  const isBot = (url: string) => {
    const u = new URL(url);
    return u.hostname === '127.0.0.1' && ports.has(Number(u.port));
  };
  let requests = 0;
  const sockets = new Set<unknown>();
  let everOpened = 0;
  page.on('request', (r) => {
    if (isBot(r.url()) && new URL(r.url()).pathname.startsWith('/api')) requests += 1;
  });
  page.on('websocket', (ws) => {
    if (!isBot(ws.url())) return;
    everOpened += 1;
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
  });

  // The first visit of a legacy tool makes the dev server optimise its dependencies: do it once
  await page.goto('/tools/backtest');
  await expect(page).toHaveURL(/\/tools\/backtest$/);
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  await page.waitForTimeout(3000);

  const pages: Array<[string, string]> = [
    ['Fleet', 'fleet-page'],
    ['Bot', 'bot-page'],
    ['Journal', 'journal-page'],
    ['Charts', 'charts-page'],
  ];
  // A legacy tool first (it opens the browser's own polling), then every gateway page in turn by
  // the navigation of the app (no reload): the polling must be gone, with nothing left in flight
  // that reopens a socket
  for (const [label, testId] of pages) {
    await page.goto('/tools/backtest');
    await expect.poll(() => everOpened, { timeout: 30_000 }).toBeGreaterThan(0);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await expect(page.getByTestId(testId)).toBeVisible();
    await page.waitForTimeout(1500);
    const settledRequests = requests;
    const settledOpened = everOpened;
    expect(sockets.size, `${label}: no bot socket left open`).toBe(0);
    await page.waitForTimeout(12_000);
    expect(everOpened, `${label}: no bot socket opened`).toBe(settledOpened);
    expect(requests, `${label}: no request to a bot`).toBe(settledRequests);
    expect(sockets.size, `${label}: no bot socket open`).toBe(0);
  }
});
