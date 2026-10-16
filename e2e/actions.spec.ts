import { expect, test, type Page } from '@playwright/test';

import { botKey, hasRig, recordedWrites, rig, seed, type RigBot } from './rig';

/**
 * The confirmation flow of real-money actions on the rig (docs/redesign/02-design.md, sections 8
 * and 11): a live exit asks for a 1 s hold, a release before the end sends nothing, a completed
 * hold sends exactly one request, to the bot the dialog names. Only fake bots receive anything.
 */
test.skip(!hasRig, 'needs the rig: pnpm e2e:rig');
test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });

const live = (): RigBot => rig().bots.find((b) => b.index === 0)!;
const dry = (): RigBot => rig().bots.find((b) => !b.live && b.index === 1)!;

// The specs of this file count the writes the fake bots recorded: one at a time
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ context }) => {
  await seed(context);
});

async function openExit(page: Page, bot: RigBot) {
  await page.goto(`/bot/${botKey(bot)}`);
  await page.getByTestId('bot-page').locator('tbody tr.act').first().click();
  const drawer = page.getByTestId('trade-drawer');
  await expect(drawer).toBeVisible();
  await drawer.locator('button[data-action="exit"]').click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('a live exit names the bot and the trade, and asks for a hold', async ({ page }) => {
  const bot = live();
  const dialog = await openExit(page, bot);
  const target = dialog.getByTestId('dialog-target');
  await expect(target).toContainText(bot.name);
  await expect(target).toContainText(botKey(bot));
  await expect(target).toContainText(/live/i);
  await expect(dialog.getByRole('button', { name: /Hold to exit/ })).toBeVisible();
  await expect(dialog.getByTestId('dialog-confirm')).toHaveCount(0);
});

test('releasing the hold early sends nothing', async ({ page }) => {
  const t0 = Date.now() - 50;
  const dialog = await openExit(page, live());
  const hold = dialog.getByRole('button', { name: /Hold to exit/ });
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.mouse.up();
  // The dialog stays open and explains the gesture
  await expect(dialog.locator('.hold-hint')).toContainText('1 second');
  await page.waitForTimeout(800);
  expect(await recordedWrites(t0)).toHaveLength(0);
});

test('a completed hold sends exactly one forceexit, to the named bot and trade', async ({
  page,
}) => {
  const bot = live();
  const t0 = Date.now() - 50;
  const dialog = await openExit(page, bot);
  const tradeId = Number(
    /trade #(\d+)/.exec(await dialog.getByTestId('dialog-target').innerText())?.[1],
  );
  expect(tradeId).toBeGreaterThan(0);
  const hold = dialog.getByRole('button', { name: /Hold to exit/ });
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1250);
  await page.mouse.up();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  // Wait past any retry the client could make: there is none
  await page.waitForTimeout(2500);
  const writes = await recordedWrites(t0);
  expect(writes).toHaveLength(1);
  expect(writes[0]!.bot).toBe(bot.index);
  expect(writes[0]!.write.method).toBe('POST');
  expect(writes[0]!.write.path).toBe('/forceexit');
  expect(Number(writes[0]!.write.body.tradeid)).toBe(tradeId);
});

test('the share to exit is chosen in the confirmation: 50 % sends one forceexit with half the amount', async ({
  page,
}) => {
  const bot = live();
  const t0 = Date.now() - 50;
  const dialog = await openExit(page, bot);
  // The drawer foot offers no share; the dialog opens on 100 %
  await expect(page.getByTestId('trade-drawer').getByRole('radio')).toHaveCount(0);
  await expect(dialog.getByRole('radio', { name: '100 %' })).toBeChecked();
  const tradeId = Number(
    /trade #(\d+)/.exec(await dialog.getByTestId('dialog-target').innerText())?.[1],
  );
  await dialog.getByRole('radio', { name: '50 %' }).click();
  await expect(dialog.getByTestId('dialog-qty-note')).toContainText('USDC');
  // Choosing a share sends nothing
  await page.waitForTimeout(500);
  expect(await recordedWrites(t0)).toHaveLength(0);
  const hold = dialog.getByRole('button', { name: /Hold to exit/ });
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1250);
  await page.mouse.up();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  await page.waitForTimeout(2500);
  const writes = await recordedWrites(t0);
  expect(writes).toHaveLength(1);
  expect(writes[0]!.bot).toBe(bot.index);
  expect(writes[0]!.write.path).toBe('/forceexit');
  expect(Number(writes[0]!.write.body.tradeid)).toBe(tradeId);
  // A partial exit carries an amount (the fake bots keep the body as the client sent it)
  expect(Number(writes[0]!.write.body.amount)).toBeGreaterThan(0);
});

test('a dry exit asks for a plain confirmation and sends once', async ({ page }) => {
  const bot = dry();
  const t0 = Date.now() - 50;
  await page.goto('/dashboard');
  await page.getByLabel('Trading mode').getByRole('radio', { name: 'Dry' }).click();
  await page.goto(`/bot/${botKey(bot)}`);
  await page.getByTestId('bot-page').locator('tbody tr.act').first().click();
  await page.getByTestId('trade-drawer').locator('button[data-action="exit"]').click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog.getByTestId('dialog-target')).toContainText(bot.name);
  await expect(dialog.getByRole('button', { name: /Hold to/ })).toHaveCount(0);
  await dialog.getByTestId('dialog-confirm').click();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  await page.waitForTimeout(1500);
  const writes = await recordedWrites(t0);
  expect(writes).toHaveLength(1);
  expect(writes[0]!.bot).toBe(bot.index);
  expect(writes[0]!.write.path).toBe('/forceexit');
});

test('"Exit all" on a live bot needs its name typed before the hold can start', async ({
  page,
}) => {
  const bot = live();
  const t0 = Date.now() - 50;
  await page.goto(`/bot/${botKey(bot)}`);
  // "Exit all" lives under "Sensitive actions" in the More menu, with the same confirmation
  await page.getByTestId('bot-header').locator('button[data-action="more"]').click();
  await page.getByRole('menuitem', { name: 'Exit all…' }).click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  const hold = dialog.getByRole('button', { name: /Hold to/ });
  await expect(hold).toHaveAttribute('aria-disabled', 'true');
  // Holding a disabled button does nothing
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();
  await dialog.getByLabel(/Type the bot name to confirm/).fill(bot.name);
  await expect(hold).not.toHaveAttribute('aria-disabled', 'true');
  // Cancel: nothing was sent
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(500);
  expect(await recordedWrites(t0)).toHaveLength(0);
});
