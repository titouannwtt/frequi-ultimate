import { expect, test } from '@playwright/test';

import { allowBotCors, botKey, hasRig, rig, seed, startGateway, stopGateway } from './rig';

/**
 * Direct-mode fallback (docs/redesign/03-gateway-architecture.md, section 9): the gateway stops
 * under the open page, the app keeps its data by talking to the bots itself, says so in the
 * connection pill, and comes back to the gateway when it is up again. This spec stops the rig's
 * gateway, so it runs alone, after the others (the `rig-disruptive` project of playwright.config).
 */
test.skip(!hasRig, 'needs the rig: pnpm e2e:rig');
test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test.afterAll(async () => {
  // Whatever happened, leave the gateway running
  await startGateway().catch(() => undefined);
});

test('the gateway stops: the app falls back to direct mode and keeps its data', async ({
  page,
  context,
  baseURL,
}) => {
  await seed(context);
  await allowBotCors(context, new URL(baseURL!).origin);
  await page.goto('/dashboard');
  const pill = page.locator('button.conn');
  await expect(pill).toHaveAttribute('data-kind', 'gateway');
  const live = rig().bots.filter((b) => b.live && !rig().down.includes(b.index));
  await expect(page.locator(`tr[data-bot-key="${botKey(live[0]!)}"]`)).toBeVisible();

  await stopGateway();

  // The socket is given 30 s to come back before the app leaves for the bots
  await expect(pill).toHaveAttribute('data-kind', 'direct', { timeout: 90_000 });
  await expect(pill).toContainText('Direct');
  // The fleet is still there, now read from the bots
  await expect(page.getByTestId('fleet-kpis')).toBeVisible();
  for (const b of live.slice(0, 3)) {
    await expect(page.locator(`tr[data-bot-key="${botKey(b)}"]`)).toBeVisible();
  }
  await expect(page.getByTestId('kpi-equity')).toContainText(/\d/);
});

test('direct mode alone: no gateway is ever asked', async ({ page, context, baseURL }) => {
  await seed(context, { mode: 'direct' });
  await allowBotCors(context, new URL(baseURL!).origin);
  const gateway = new URL(rig().gateway).origin;
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(gateway)) asked.push(r.url());
  });
  await page.goto('/dashboard');
  await expect(page.locator('button.conn')).toHaveAttribute('data-kind', 'direct');
  const b = rig().bots.find((x) => x.live && !rig().down.includes(x.index))!;
  await expect(page.locator(`tr[data-bot-key="${botKey(b)}"]`)).toBeVisible({ timeout: 60_000 });
  expect(asked).toEqual([]);
});

test('the gateway is back: the app returns to it', async ({ page, context, baseURL }) => {
  await seed(context);
  await allowBotCors(context, new URL(baseURL!).origin);
  await page.goto('/dashboard');
  await expect(page.locator('button.conn')).toHaveAttribute('data-kind', 'direct');
  await startGateway();
  // The app probes the gateway again every minute; "Probe now" in Settings does it at once
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByTestId('gw-probe').click();
  await expect(page.locator('button.conn')).toHaveAttribute('data-kind', 'gateway', {
    timeout: 90_000,
  });
});
