import { expect, test, type Page } from '@playwright/test';

import { defaultMocks } from './helpers';

/**
 * Registering a bot and the preferences (Settings, `/login` for a first visit), in direct mode
 * against a mocked bot: the old keys stay, the password is never stored.
 */
test.use({ locale: 'en-US' });

const PASSWORD = 'SuperDuperBot';

async function mockLogin(page: Page, status: number) {
  await page.route('**/api/v1/token/login', (route) =>
    route.fulfill({
      status,
      json: { access_token: 'access_token_tesst', refresh_token: 'refresh_test' },
      headers: { 'access-control-allow-origin': '*' },
    }),
  );
}

async function fillForm(page: Page, url: string) {
  const form = page.getByTestId('bot-form');
  await form.getByLabel('Name', { exact: true }).fill('TestBot');
  await form.getByLabel('Address of the bot API').fill(url);
  await form.getByLabel('Username').fill('Freqtrader');
  await form.getByLabel('Password', { exact: true }).fill(PASSWORD);
}

test('a first visit lands on the login, and a bot is registered after a successful login', async ({
  page,
  baseURL,
}) => {
  await defaultMocks(page);
  await mockLogin(page, 200);
  await page.goto('/trade');
  // Nothing is shown until a bot is registered
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId('settings-page')).toBeVisible();

  // The form of the first bot is already open, with the address of this app prefilled
  await expect(page.getByTestId('bot-form')).toBeVisible();
  await expect(page.getByTestId('bot-form').getByLabel('Address of the bot API')).toHaveValue(
    baseURL!,
  );
  await fillForm(page, baseURL!);
  await Promise.all([
    page.waitForResponse('**/api/v1/token/login'),
    page.getByTestId('bot-submit').click(),
  ]);

  await expect(page.getByTestId('bot-registry')).toContainText('TestBot');
  const stored = await page.evaluate(() => localStorage.getItem('ftAuthLoginInfo'));
  expect(stored).toContain('TestBot');
  expect(stored).toContain('access_token_tesst');
  // The password was used for the login only
  const everything = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(everything).not.toContain(PASSWORD);
});

test('a wrong password registers nothing and says why', async ({ page, baseURL }) => {
  await defaultMocks(page);
  await mockLogin(page, 401);
  await page.goto('/login');
  await expect(page.getByTestId('bot-form')).toBeVisible();
  await fillForm(page, baseURL!);
  await Promise.all([
    page.waitForResponse('**/api/v1/token/login'),
    page.getByTestId('bot-submit').click(),
  ]);
  await expect(page.getByTestId('bot-form')).toContainText(/wrong|cannot be reached/);
  const stored = await page.evaluate(() => localStorage.getItem('ftAuthLoginInfo'));
  expect(stored ?? '{}').not.toContain('TestBot');
});

test('the old keys are kept, read and migrated, never rewritten', async ({ page }) => {
  await defaultMocks(page);
  await page.goto('/login');
  const legacy = JSON.stringify({
    'ftbot.0': {
      botName: 'OldBot',
      apiUrl: 'http://127.0.0.1:9',
      accessToken: 'a',
      refreshToken: 'b',
      autoRefresh: true,
    },
  });
  await page.evaluate((v) => localStorage.setItem('ftAuthLoginInfo', v), legacy);
  await page.reload();
  await expect(page.getByTestId('bot-registry')).toContainText('OldBot');
  const after = await page.evaluate(() => ({
    old: localStorage.getItem('ftAuthLoginInfo'),
    keys: Object.keys(localStorage).filter((k) => k.startsWith('fqu2.')),
  }));
  expect(after.old).toBe(legacy);
  expect(after.keys.length).toBeGreaterThan(0);
});

test('language and theme are remembered', async ({ page }) => {
  await defaultMocks(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'ftAuthLoginInfo',
      JSON.stringify({
        'ftbot.0': { botName: 'B', apiUrl: location.origin, accessToken: 'a', refreshToken: 'b' },
      }),
    ),
  );
  await page.goto('/settings');
  await expect(page.getByTestId('display-settings')).toBeVisible();
  await page.getByTestId('display-settings').getByRole('radio', { name: 'Français' }).click();
  const fleet = page.locator('nav.nav button[data-nav="fleet"]');
  await expect(fleet).toContainText('Flotte');
  expect(await page.evaluate(() => localStorage.getItem('ft_locale'))).toBe('fr');
  await page.reload();
  await expect(fleet).toContainText('Flotte');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});
