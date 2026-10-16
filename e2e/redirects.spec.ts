import { expect, test } from '@playwright/test';

import { defaultMocks, setLoginInfo } from './helpers';

/**
 * Every path of the old router keeps working and leads to its new home
 * (docs/redesign/02-design.md, section 2.1): nothing a user bookmarked ends in a 404. The bot of
 * these specs is the origin of the app itself, like a bot that serves the UI, so its key is
 * `local:<port of the page>`.
 */
test.use({ locale: 'en-US' });
// The first visit of a page compiles it on a dev server (the strategy editor is large)
test.setTimeout(60_000);
const NAV = { timeout: 30_000 };

test.beforeEach(async ({ page }) => {
  await defaultMocks(page);
  await setLoginInfo(page);
});

const port = (baseURL: string | undefined): string =>
  new URL(baseURL ?? 'http://localhost:3000').port;

test('/ leads to the fleet', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard$/, NAV);
});

test('/open_trades leads to the open positions of the fleet', async ({ page }) => {
  await page.goto('/open_trades');
  await expect(page).toHaveURL(/\/dashboard\?view=positions$/, NAV);
});

test('/trade leads to the Bot page of the stored bot, by alias, by name or by default', async ({
  page,
  baseURL,
}) => {
  const key = `local:${port(baseURL)}`;
  for (const url of ['/trade', '/trade?bot=ftbot.0', '/trade?bot=TestBot']) {
    await page.goto(url);
    await expect(page).toHaveURL(new RegExp(`/bot/${key}(\\?.*)?$`), NAV);
    await expect(page.getByTestId('bot-page')).toBeVisible();
  }
});

test('/balance and /pairlist lead to the matching tab of the Bot page', async ({
  page,
  baseURL,
}) => {
  const key = `local:${port(baseURL)}`;
  await page.goto('/balance');
  await expect(page).toHaveURL(new RegExp(`/bot/${key}\\?tab=`), NAV);
  await page.goto('/pairlist');
  await expect(page).toHaveURL(new RegExp(`/bot/${key}\\?tab=`), NAV);
});

const MOVED: Array<[string, RegExp]> = [
  ['/trade_history', /\/journal$/],
  ['/logs', /\/tools\/logs$/],
  ['/backtest', /\/tools\/backtest$/],
  ['/download_data', /\/tools\/download-data$/],
  ['/pairlist_config', /\/tools\/pairlist-config$/],
  ['/strategy-dev', /\/tools\/strategy-dev$/],
];
for (const [from, to] of MOVED) {
  test(`${from} leads to its new page`, async ({ page }) => {
    await page.goto(from);
    await expect(page).toHaveURL(to, NAV);
  });
}

test('the query string of a bookmark is kept', async ({ page }) => {
  await page.goto('/trade_history?pair=BTC%2FUSDT');
  await expect(page).toHaveURL(/\/journal\?pair=BTC(%2F|\/)USDT$/, NAV);
});

test('an unknown path shows the 404 page, not a blank screen', async ({ page }) => {
  await page.goto('/this/does/not/exist');
  await expect(page.getByTestId('not-found')).toContainText('Page not found');
  // ... with the way back
  await page.getByRole('button', { name: 'Back to the fleet' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, NAV);
  // An unknown tool is just as unknown
  await page.goto('/tools/nothing-here');
  await expect(page.getByTestId('not-found')).toBeVisible();
});
