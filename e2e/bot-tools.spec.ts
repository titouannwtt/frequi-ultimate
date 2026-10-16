import { expect, test } from '@playwright/test';

import { botKey, hasRig, recordedWrites, rig, seed } from './rig';

/**
 * Two tools that live in the tabs of the Bot page on the rig: the editable blacklist (tab
 * "Pairs and locks") and the config editor (tab "Config"). Both write to a bot, so both end in a
 * confirmation that names the bot; only fake bots receive anything.
 */
test.skip(!hasRig, 'needs the rig: pnpm e2e:rig');
test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);
// The first visit of a tab compiles it on a dev server, and the other specs load it in parallel
const SLOW = { timeout: 30_000 };

const liveBot = () => rig().bots.find((b) => b.live && b.index === 0)!;

test.beforeEach(async ({ context }) => {
  await seed(context);
});

test('adding a pair to the blacklist opens the live confirmation of this bot, and sends nothing yet', async ({
  page,
}) => {
  const bot = liveBot();
  const t0 = Date.now() - 50;
  await page.goto(`/bot/${botKey(bot)}?tab=pairs`);
  const panel = page.getByTestId('pairlist-panel');
  await expect(panel).toBeVisible(SLOW);
  // The lists come from the gateway: no "not loaded" notice
  await expect(panel.getByRole('heading', { name: /Blacklist/ })).toBeVisible(SLOW);
  await expect(panel.getByTestId('pl-error')).toHaveCount(0);
  await panel.getByTestId('pl-input').fill('DOGE/USDC:USDC');
  const dialog = page.getByTestId('confirm-dialog');
  // Actions wait for the first synchronisation of the connection: a click before that is refused
  // (and said so in a toast), so click again until the confirmation opens
  await expect(async () => {
    await panel.getByTestId('pl-add').click();
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  const target = dialog.getByTestId('dialog-target');
  await expect(target).toContainText(bot.name);
  await expect(target).toContainText(/live/i);
  await expect(dialog.getByRole('button', { name: /Hold to/ })).toBeVisible();
  await page.waitForTimeout(800);
  expect(await recordedWrites(t0)).toHaveLength(0);
});

test('the Config tab opens the config editor of this bot', async ({ page }) => {
  const bot = liveBot();
  await page.goto(`/bot/${botKey(bot)}?tab=config`);
  await page.getByTestId('bot-config-edit').click();
  const title = page.getByTestId('config-editor-title');
  await expect(title).toBeVisible(SLOW);
  await expect(title).toContainText(bot.name);
  await expect(page.getByTestId('config-editor-live')).toBeVisible();
});
