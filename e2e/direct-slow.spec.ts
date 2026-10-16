import { expect, test } from '@playwright/test';

import { allowBotCors, botKey, fakebot, hasRig, openTradeCount, rig, seed } from './rig';

/**
 * B230: direct mode on a slow fleet. The real fleet answered `/status` in seconds (a bot in an
 * exchange backoff) and some tokens had expired; the Fleet and Bot pages stayed on "positions
 * announced, not read yet" for ever. Here the bots of the rig take 5 s per call and half of
 * them have an expired access token: every position must still show up, and nothing but reads
 * (and the token refresh) may leave the browser.
 */
test.skip(!hasRig, 'needs the rig: pnpm e2e:rig');
test.use({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
test.setTimeout(150_000);

const answering = () =>
  rig().bots.filter(
    (b) => b.live && !rig().down.includes(b.index) && !rig().starting.includes(b.index),
  );

test.afterEach(async () => {
  for (const b of rig().bots) await fakebot({ cmd: 'mode', bot: b.index, mode: 'up' });
});

test('direct mode reads the positions of slow bots, some with an expired token', async ({
  page,
  context,
  baseURL,
}) => {
  await seed(context, { mode: 'direct' });
  await allowBotCors(context, new URL(baseURL!).origin);
  const live = answering();
  const open = await Promise.all(live.map((b) => openTradeCount(b)));
  const total = open.reduce((a, b) => a + b, 0);
  expect(total).toBeGreaterThan(0);
  // Every bot that answers takes 5 s per call, the dry ones too: they share the same browser
  const everyone = rig().bots.filter(
    (b) => !rig().down.includes(b.index) && !rig().starting.includes(b.index),
  );
  for (const b of everyone) await fakebot({ cmd: 'mode', bot: b.index, mode: 'slow', ms: 5_000 });
  // The tokens issued by the seed stop working: the first read of those bots is a 401
  for (const b of everyone.filter((_, i) => i % 2 === 0)) {
    await fakebot({ cmd: 'expire_tokens', bot: b.index });
  }
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && r.method() !== 'OPTIONS' && /\/api\/v1\//.test(r.url())) {
      writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  });

  await page.goto('/dashboard');
  const fleetPage = page.getByTestId('fleet-page');
  await expect(fleetPage).toBeVisible();
  await expect(page.locator('button.conn')).toHaveAttribute('data-kind', 'direct');
  // The Fleet shows the five positions to watch: the full table is one click away
  await page.getByTestId('positions-toggle').click({ timeout: 45_000 });
  await expect(fleetPage.locator('tbody tr.act')).toHaveCount(total, { timeout: 45_000 });
  await expect(fleetPage.locator('.awaiting')).toHaveCount(0);
  // The list of the bots stops at eight: open the others
  const more = page.getByTestId('fleet-more-bots');
  if (await more.count()) await more.click();
  for (const b of live) {
    await expect(fleetPage.locator(`tr[data-bot-key="${botKey(b)}"]`)).toBeVisible();
  }

  // The Bot page of one of them shows its positions too
  await page.goto(`/bot/${botKey(live[0]!)}`);
  await expect(page.getByTestId('bot-page').locator('tbody tr.act')).toHaveCount(open[0]!, {
    timeout: 45_000,
  });
  expect(writes.filter((w) => !w.endsWith('/token/refresh'))).toEqual([]);
});
