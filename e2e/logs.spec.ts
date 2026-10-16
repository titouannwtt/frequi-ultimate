import { test, expect } from '@playwright/test';

import { setLoginInfo, defaultMocks } from './helpers';

test.use({ locale: 'en-US' });

test.describe('Logs', () => {
  test('Displays and refreshes the logs of a bot (direct mode, mocked bot)', async ({ page }) => {
    await defaultMocks(page);
    await setLoginInfo(page);
    await page.route('**/api/v1/logs*', (route) => {
      return route.fulfill({
        path: './e2e/testData/logs.json',
        headers: { 'access-control-allow-origin': '*' },
      });
    });

    const logs = page.waitForResponse('**/api/v1/logs*');
    await page.goto('/tools/logs');
    await logs;

    const stream = page.getByTestId('log-stream');
    await expect(stream).toBeVisible();
    // The default view is the errors of all bots: pick the bot and the Info level to read its lines
    await stream.getByRole('combobox', { name: 'Bot' }).selectOption({ index: 1 });
    await stream.getByRole('radio', { name: 'Info' }).click();
    await expect(stream.getByText('Checking exchange').first()).toBeVisible();
  });
});
