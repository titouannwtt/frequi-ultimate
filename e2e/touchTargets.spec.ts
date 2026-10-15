import { expect, test } from '@playwright/test';

/**
 * Touch targets and the trade drawer foot on a 390 px phone (docs/redesign/02-design.md, sections
 * 6.4 and 17), measured on the design system showcase: it renders the composites without a bot,
 * so nothing here can reach a real one.
 */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
test.skip(({ browserName }) => browserName !== 'chromium', 'isMobile is Chromium only');

test.beforeEach(async ({ page }) => {
  await page.goto('/__ds', { waitUntil: 'load' });
  await expect(page.getByTestId('ds-showcase')).toBeVisible();
});

// The controls the spec asks to be 44 x 44 for real (not only through a hit zone)
const TARGETS: Array<[string, string]> = [
  ['group fold chevron', 'button.chev'],
  ['logo', 'button.logo'],
  ['pair navigator tab', '.tabs button'],
  ['calendar "today"', 'button.today:not(.d)'],
  ['registry "add" link', 'button.one'],
];

for (const [name, selector] of TARGETS) {
  test(`${name} is at least 44 x 44 (B80)`, async ({ page }) => {
    const found = page.locator(selector);
    expect(await found.count()).toBeGreaterThan(0);
    for (const box of await found.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
    )) {
      expect(box.w, `${name} width`).toBeGreaterThanOrEqual(44);
      expect(box.h, `${name} height`).toBeGreaterThanOrEqual(44);
    }
  });
}

test('the trade drawer foot wraps instead of overflowing (B79)', async ({ page }) => {
  const drawers = page.locator('[data-testid^="trade-drawer"]');
  expect(await drawers.count()).toBeGreaterThan(0);
  const overflow = await drawers.evaluateAll((els) =>
    els.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.getAttribute('data-testid')),
  );
  expect(overflow).toEqual([]);
  // Every action button of the foot stays inside the panel
  const outside = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="trade-drawer"] [data-action]')]
      .filter((b) => {
        const panel = b.closest('[data-testid="trade-drawer"]')!.getBoundingClientRect();
        const r = b.getBoundingClientRect();
        return r.right > panel.right + 0.5 || r.left < panel.left - 0.5;
      })
      .map((b) => b.getAttribute('data-action')),
  );
  expect(outside).toEqual([]);
});
