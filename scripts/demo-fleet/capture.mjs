// Regenerates the README screenshots from the demo fleet.
//
//   node scripts/demo-fleet/capture.mjs <output-dir> [--probe] [--only=name1,name2] [--cdp=URL]
//
// Needs `python3 scripts/demo-fleet/server.py` running (UI on :3050, bots on :3051+).
// Uses Playwright (`@playwright/test`); set PLAYWRIGHT_BROWSERS_PATH if the browsers
// are not in the default location. No request ever leaves the machine: every external
// domain (CoinGecko, alternative.me, GitHub...) is answered locally.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'demo-screenshots');
const probe = args.includes('--probe');
const cdpUrl = (args.find((a) => a.startsWith('--cdp=')) ?? '').slice(6); // dev: reuse an open browser
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const UI = process.env.DEMO_UI ?? 'http://127.0.0.1:3050';

fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------

const fleet = await (await fetch(`${UI}/__demo/fleet`)).json();

const loginInfo = {};
fleet.bots.forEach((b, i) => {
  loginInfo[`ftbot.${i}`] = {
    botName: b.name,
    apiUrl: `http://127.0.0.1:${b.port}`,
    accessToken: 'demo-access',
    refreshToken: 'demo-refresh',
    autoRefresh: true,
    sortId: i,
  };
});

const problems = { pageErrors: [], consoleErrors: [], badResponses: [], external: [] };

async function fakeExternal(route) {
  const url = new URL(route.request().url());
  const host = url.hostname;
  problems.external.push(`${route.request().method()} ${host}${url.pathname}`);
  const json = (obj) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(obj),
    });
  const demo = async (p) => {
    const r = await fetch(`${UI}/__demo/${p}`);
    return json(await r.json());
  };
  if (host === 'api.coingecko.com') {
    if (url.pathname.endsWith('/simple/price')) {
      return demo(`coingecko/simple_price?ids=${url.searchParams.get('ids') ?? 'bitcoin'}`);
    }
    const mc = url.pathname.match(/\/coins\/([^/]+)\/market_chart/);
    if (mc) {
      return demo(`coingecko/market_chart?id=${mc[1]}&days=${url.searchParams.get('days') ?? 30}`);
    }
    if (url.pathname.endsWith('/global')) {
      return demo('coingecko/global');
    }
    return json({});
  }
  if (host === 'api.alternative.me') {
    return demo('fng');
  }
  if (host === 'api.github.com') {
    return json({ tag_name: 'v2.2.0', html_url: 'https://example.invalid/release' });
  }
  return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
}


const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch({ args: ['--force-color-profile=srgb'] });

async function newPage({ width = 1600, height = 1000, scale = 2 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    locale: 'en-US',
    colorScheme: 'dark',
  });
  await context.route(
    (url) => !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => fakeExternal(route),
  );
  // Connections to the demo bots, plus a little fleet organisation (groups, tags, columns)
  // so that the comparison table shows what the feature set looks like when it is used.
  const botIds = fleet.bots.map((_, i) => `ftbot.${i}`);
  const comparison = {
    visibleColumnIds: [
      'botName', 'trades', 'openProfit', 'closedProfit', 'profitCurrent',
      'maxDrawdown', 'balance', 'winLoss', 'monthlyProfit',
    ],
    botGroups: [
      { id: 'g-hl', name: 'Hyperliquid perps', icon: '⚡', collapsed: false, botIds: botIds.slice(0, 3) },
      { id: 'g-cex', name: 'Binance and Bybit', icon: '\u{1F3E6}', collapsed: false, botIds: botIds.slice(3, 6) },
    ],
    customTags: [
      { id: 't-mr', name: 'mean-reversion', color: '#3b82f6' },
      { id: 't-tr', name: 'trend', color: '#f59e0b' },
      { id: 't-ca', name: 'carry', color: '#10b981' },
    ],
    botCustomTags: { 'ftbot.0': ['t-mr'], 'ftbot.1': ['t-tr'], 'ftbot.2': ['t-mr'], 'ftbot.3': ['t-tr'], 'ftbot.5': ['t-tr'], 'ftbot.6': ['t-ca'] },
  };
  await context.addInitScript(
    ({ info, comparison }) => {
      if (location.origin.includes(':3050')) {
        localStorage.setItem('ftAuthLoginInfo', JSON.stringify(info));
        localStorage.setItem('ftSelectedBot', 'ftbot.0');
        localStorage.setItem('ft_locale', 'en');
        localStorage.setItem('ft_fit_screen_botComparison', 'true');
        if (!localStorage.getItem('ftBotComparison')) {
          localStorage.setItem('ftBotComparison', JSON.stringify(comparison));
        }
      }
    },
    { info: loginInfo, comparison },
  );
  const page = await context.newPage();
  page.on('crash', () => log('  page crashed'));
  page.on('close', () => log('  page closed'));
  page.on('pageerror', (e) => problems.pageErrors.push(`[${currentStep}] ${page.url()} ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      problems.consoleErrors.push(`${new URL(page.url()).pathname} ${m.text().slice(0, 200)}`);
    }
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (r.status() >= 400 && u.port !== '3050') {
      problems.badResponses.push(`${r.status()} ${r.request().method()} ${u.port}${u.pathname}`);
    }
  });
  return { context, page };
}

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

const results = [];
let currentStep = 'init';
let viewH = 1000; // viewport height, raised for the few popovers taller than the frame
let page;
let cdp;

async function setScale(s) {
  cdp ??= await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: viewH, deviceScaleFactor: s, mobile: false });
}

const want = (name) => only.length === 0 || only.includes(name);

/** Takes the shot at the highest scale that keeps the file under `max` bytes. */
async function save(name, shoot, { max = 600 * 1024, scales = [2, 1.6, 1.3, 1] } = {}) {
  let buf;
  let used = 0;
  for (const s of scales) {
    await setScale(s);
    await sleep(250);
    buf = await shoot(s);
    used = s;
    if (buf.length <= max) break;
  }
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, buf);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  results.push({ name, w, h, kb: Math.round(buf.length / 1024), scale: used });
  log(`  ${name}.png ${w}x${h} ${Math.round(buf.length / 1024)} KB (scale ${used})`);
  await setScale(2);
}

const W = (title) =>
  page.locator('.ft-widget').filter({ has: page.locator('.drag-header', { hasText: title }) });

async function awayMouse() {
  await page.mouse.move(2, 600);
  await sleep(500);
}

async function topOfPage() {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('*').forEach((e) => {
      if (e.scrollTop > 0 && e.id !== 'log-scroll') e.scrollTop = 0;
    });
  });
  await sleep(500);
}

/** Scrolls the page so that `loc` sits `margin` px below the top of the viewport. */
async function bring(loc, margin = 90) {
  await loc.scrollIntoViewIfNeeded();
  await loc.evaluate((el, m) => {
    let p = el.parentElement;
    const top = el.getBoundingClientRect().top;
    while (p) {
      if (p.scrollHeight > p.clientHeight + 4 && getComputedStyle(p).overflowY !== 'visible') {
        p.scrollTop += top - m;
        return;
      }
      p = p.parentElement;
    }
    window.scrollBy(0, top - m);
  }, margin);
  await sleep(500);
}

async function resumeLogs() {
  const b = page.getByRole('button', { name: 'Resume' });
  if (await b.first().isVisible().catch(() => false)) {
    await b.first().click().catch(() => {});
  }
}

/** Waits until the UI has loaded every bot (its slow tier reaches the quiet bots late). */
async function waitReady(timeoutMs = 420000) {
  const ports = fleet.bots.map((b) => String(b.port));
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hits = await (await fetch(`${UI}/__demo/hits`)).json();
    const served = ports.every((p) => (hits[p] ?? []).includes('/status') && (hits[p] ?? []).includes('/profit_all'));
    const filled = await W('Bot comparison')
      .evaluate((el) => {
        const rows = [...el.querySelectorAll('tbody tr')].filter((r) => r.querySelector('.bot-name-block'));
        return rows.length > 0 && rows.every((r) => (r.querySelectorAll('td')[3]?.innerText ?? '').trim().length > 0);
      })
      .catch(() => false);
    if (served && filled) {
      break;
    }
    await sleep(5000);
  }
  log(`  ready after ${Math.round((Date.now() - t0) / 1000)} s`);
  await sleep(8000);
}

/** Reaches an exposed method of the widget that owns the popover (some have no toolbar button). */
async function callExposed(name, anchor, nth = 0) {
  const handle = await anchor.elementHandle();
  return page.evaluate(
    ([n, el, k]) => {
      const seen = new Set();
      const found = [];
      const walk = (vn) => {
        if (!vn || typeof vn !== 'object' || seen.has(vn)) return null;
        seen.add(vn);
        if (vn.component) {
          const c = vn.component;
          if (c.exposed && typeof c.exposed[n] === 'function') found.push(c);
          walk(c.subTree);
        }
        if (Array.isArray(vn.children)) {
          for (const ch of vn.children) walk(ch);
        }
        if (vn.suspense) walk(vn.suspense.activeBranch);
        return null;
      };
      walk([...document.querySelectorAll('body *')].find((e) => e.__vue_app__)._vnode);
      const comp = found[k];
      if (!comp) return false;
      comp.exposed[n]({ currentTarget: el, target: el });
      return true;
    },
    [name, handle, nth],
  );
}

async function inViewport(loc, label) {
  const b = await loc.boundingBox();
  if (!b) return false;
  const ok = b.y >= -1 && b.y + b.height <= 1001 && b.x >= -1 && b.x + b.width <= 1601;
  if (!ok) log(`  warning: ${label} outside the frame ${JSON.stringify(b)}`);
  return ok;
}

async function guard(name, fn) {
  if (!want(name)) return;
  currentStep = name;
  try {
    await fn();
  } catch (e) {
    viewH = 1000;
    await setScale(2).catch(() => {});
    log(`  FAILED ${name}: ${e.message.split('\n')[0]}`);
    results.push({ name, failed: e.message.split('\n')[0] });
  }
}

// ---------------------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------------------

/** Toggles benchmark overlays of the Profit & benchmarks widget (menu behind the "+" button). */
async function toggleOverlays(w, names) {
  const plus = w.getByRole('button', { name: '+', exact: true });
  const item = (n) => w.locator('button', { hasText: new RegExp(`^\\s*${n}\\s*(ON)?\\s*$`) }).first();
  if (!(await item(names[0]).isVisible().catch(() => false))) await plus.evaluate((el) => el.click());
  await sleep(500);
  for (const n of names) {
    // the menu can be partly covered by the neighbouring widget, so click through the DOM
    await item(n).evaluate((el) => el.click());
    await sleep(900);
  }
  await page.locator('div.fixed.inset-0.z-40').first().evaluate((el) => el.click()); // click-away backdrop
  await sleep(500);
}

async function widgetShot(name, title, prepare) {
  await guard(name, async () => {
    const w = W(title);
    await bring(w, 60);
    if (prepare) await prepare(w);
    await awayMouse();
    await save(name, () => w.screenshot());
  });
}

async function popoverShot(name, trigger, { panel = '.p-popover', hover = true, prepare, tall = 1000 } = {}) {
  await guard(name, async () => {
    viewH = tall;
    await setScale(2);
    await page.keyboard.press('Escape');
    await awayMouse();
    if (prepare) await prepare();
    const target = typeof trigger === 'function' ? await trigger() : trigger;
    if (hover) {
      await target.scrollIntoViewIfNeeded();
      const b = await target.boundingBox();
      // aim near the top-left: a wrapped inline span has its centre between two lines
      await page.mouse.move(b.x + Math.min(b.width / 2, 10), b.y + Math.min(b.height / 2, 7), { steps: 4 });
    } else {
      await target.click();
    }
    await sleep(1800);
    const p = page.locator(panel).last();
    try {
      await p.waitFor({ state: 'visible', timeout: 6000 });
    } catch {
      // first hover can miss (lazy chunk, re-render): leave and come back once
      await page.mouse.move(2, 600);
      await sleep(800);
      const b2 = await target.boundingBox();
      await page.mouse.move(b2.x + Math.min(b2.width / 2, 10), b2.y + Math.min(b2.height / 2, 7), { steps: 4 });
      await sleep(1500);
      await p.waitFor({ state: 'visible', timeout: 10000 });
    }
    await inViewport(p, name);
    const pb = await p.boundingBox();
    if (pb && pb.y + pb.height > 998) {
      // taller than the frame: keep what is visible rather than a grey strip
      const clip = { x: Math.max(0, pb.x), y: Math.max(0, pb.y), width: Math.min(pb.width, 1600 - pb.x), height: 996 - pb.y };
      log(`  note: ${name} cropped to the frame`);
      await save(name, () => page.screenshot({ clip }));
    } else {
      await save(name, () => p.screenshot());
    }
    await page.mouse.move(2, 600);
    await page.keyboard.press('Escape');
    await sleep(600);
    viewH = 1000;
    await setScale(2);
  });
}

async function dashboardShots() {
  await page.goto(`${UI}/dashboard`);
  await W('Bot comparison').waitFor({ timeout: 60000 });
  if (!cdpUrl) await waitReady();

  await guard('dashboard-overview', async () => {
    await topOfPage();
    await resumeLogs();
    await awayMouse();
    // the context is created at DPR 2, so the 1x fallback needs the css scale option
    await save('dashboard-overview', (sc) => page.screenshot(sc >= 2 ? {} : { scale: 'css' }), { max: 1200 * 1024, scales: [2, 1] });
  });

  await widgetShot('widget-activity-timeline', 'Activity timeline');
  await widgetShot('widget-market-pulse', 'Market pulse');
  await widgetShot('widget-risk-overview', 'Risk overview');
  await widgetShot('widget-stress-test', 'Stress test', async (w) => {
    await w.locator('input[type=range]').evaluate((el) => {
      el.value = '-40';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(700);
  });
  await widgetShot('widget-profit-distribution', 'Profit distribution');
  await widgetShot('widget-log-console', 'Log console', async (w) => {
    await resumeLogs();
    await w.getByRole('button', { name: 'Filters' }).click();
    await sleep(800);
  });
  // close the filters panel again
  if (want('widget-log-console')) await W('Log console').getByRole('button', { name: 'Filters' }).click().catch(() => {});

  await widgetShot('widget-profit-benchmarks-combined', 'Profit & benchmarks', async (w) => {
    await w.getByRole('button', { name: 'Combined' }).click();
    await w.getByRole('button', { name: '90D', exact: true }).click();
    await toggleOverlays(w, ['BTC']);
    await sleep(2000);
  });
  await widgetShot('widget-profit-benchmarks-per-bot', 'Profit & benchmarks', async (w) => {
    await w.getByRole('button', { name: 'Per Bot' }).click();
    await w.getByRole('button', { name: '90D', exact: true }).click();
    await toggleOverlays(w, ['BTC', 'SOL', 'ETH']);
    await sleep(2000);
  });
  if (want('widget-profit-benchmarks-combined') || want('widget-profit-benchmarks-per-bot')) {
    await W('Profit & benchmarks').getByRole('button', { name: 'Combined' }).click().catch(() => {});
  }

  // Bot comparison toolbar popovers
  const bc = W('Bot comparison');
  const filtersBtn = bc.locator('button[title="Filters"]');
  await bring(bc, 60);
  await popoverShot('bot-comparison-filter', filtersBtn, { hover: false });
  await popoverShot('bot-comparison-groups', bc.locator('button[title="Bot Groups"]'), { hover: false });
  // Sort and alert settings have no toolbar button in the current dashboard: open them through
  // the methods the widget exposes, anchored on the Filters button.
  await popoverShot('bot-comparison-sort', async () => {
    await callExposed('showSortPopover', filtersBtn.first());
    return page.locator('.p-popover').last();
  }, { hover: false });
  await popoverShot('bot-comparison-alerts', async () => {
    await callExposed('showAlertsPopover', filtersBtn.first());
    return page.locator('.p-popover').last();
  }, { hover: false });
  await popoverShot('bot-comparison-columns', async () => {
    await callExposed('showColumnPopover', filtersBtn.first());
    return page.locator('.p-popover').last();
  }, { hover: false });

  // Bot comparison hover cards, all on the same bot row
  await bring(bc, 60);
  const row = bc.locator('tbody tr', { hasText: 'hl_meanrev_dca' }).first();
  const cell = (i) => row.locator('td').nth(i);
  const inner = (i) => cell(i).locator('div').first();
  const keepRowHigh = async () => bring(row, 70);
  await popoverShot('popover-bot-info', () => row.locator('.bot-name-block span', { hasText: 'hl_meanrev_dca' }).first(), { prepare: keepRowHigh });
  await popoverShot('popover-exchange-info', () => row.locator('text=Hyperliquid').first(), { prepare: keepRowHigh });
  await popoverShot('popover-open-profit', () => inner(3), { prepare: keepRowHigh });
  await popoverShot('popover-closed-profit', () => inner(4), { prepare: async () => bring(row, 48) });
  await popoverShot('popover-open-positions', () => inner(2), { prepare: keepRowHigh });
  await popoverShot('popover-win-loss', () => inner(8), { prepare: keepRowHigh });
  await popoverShot('popover-periodic-profit', async () => {
    // locate the column from its header: its index depends on the visible columns
    const idx = await bc.locator('thead th').evaluateAll((ths) => ths.findIndex((t) => /Monthly/i.test(t.innerText)));
    return cell(idx).locator('div').first();
  }, { prepare: keepRowHigh });

  // Per-trade hover cards (open and closed trades widgets)
  const open = W('Open trades');
  const closed = W('Closed trades');
  const trade = '#trade-popover-floating';
  const openRow = () => open.locator('tbody tr', { hasText: 'hl_meanrev_dca' }).filter({ hasText: /LINK|XRP|SOL/ }).first();
  const openCell = (i) => openRow().locator('td').nth(i);
  const tradePrep = async () => bring(openRow(), 90);
  await popoverShot('popover-trade-overview', () => openRow().locator('.cursor-help').first(), { panel: trade, prepare: tradePrep });
  await popoverShot('popover-price-levels', () => openCell(6).locator('span,div').first(), { panel: trade, prepare: tradePrep });
  await popoverShot('popover-trade-duration', () => openCell(11).locator('.cursor-help').first(), { panel: trade, prepare: tradePrep });
  await popoverShot('popover-dca-escalations', async () => {
      // prefer an unleveraged row: the popover averages margin over amount, which is only right at 1x
      const dca = open.locator('tbody tr', { has: page.locator('span.cursor-help:has(> span.text-purple-300)') });
      const flat = dca.filter({ hasText: /\b1x\b/ });
      const r = (await flat.count()) > 0 ? flat.first() : dca.first();
      return r.locator('span.cursor-help:has(> span.text-purple-300)').first();
    }, {
    panel: trade,
    prepare: async () => {
      await bring(open, 60);
      // the table is virtualised: filter on the unleveraged spot bot so its DCA row is rendered
      await open.getByPlaceholder('Filter by pair, bot, tag...').fill('binance_grid_eth');
      await sleep(800);
      if ((await open.locator('span.cursor-help:has(> span.text-purple-300)').count()) === 0) {
        await callExposed('showColumnPopover', open.locator('.drag-header').first(), 1);
        await sleep(600);
        await page.locator('.p-popover').last().locator('label', { hasText: /^\s*DCA\s*$/ }).first().click();
        await page.keyboard.press('Escape');
        await sleep(600);
      }
    },
  });
  await open.getByPlaceholder('Filter by pair, bot, tag...').fill('').catch(() => {});
  const closedRow = () => closed.locator('tbody tr').first();
  await popoverShot('popover-exit-reasons', () => closedRow().locator('span.cursor-help.font-bold', { hasText: /^\s*[a-z_]{3,}\s*$/ }).first(), {
    panel: trade,
    prepare: async () => bring(closedRow(), 90),
  });
}

async function logsShot() {
  await guard('logs-page-redesign', async () => {
    // client-side navigation keeps the stores warm; a full reload would restart the slow per-bot loading
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/logs'));
    await page.getByText('Hide heartbeat').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => /\b[1-9]\d* entries/.test(document.body.innerText), null, { timeout: 180000 });
    await sleep(3000);
    await awayMouse();
    await save('logs-page-redesign', (sc) => page.screenshot(sc >= 2 ? {} : { scale: 'css' }), { scales: [2, 1] });
  });
}

// ---------------------------------------------------------------------------------------
// Probe mode: load the main pages and list problems
// ---------------------------------------------------------------------------------------

async function runProbe() {
  for (const route of ['/dashboard', '/trade', '/logs']) {
    await page.goto(`${UI}${route}`);
    await sleep(25000);
    await page.screenshot({ path: path.join(outDir, `probe${route.replace('/', '-')}.png`) });
  }
}

if (cdpUrl) {
  page = browser.contexts()[0].pages()[0];
} else {
  ({ page } = await newPage());
}
if (probe) {
  await runProbe();
} else {
  log('dashboard');
  await dashboardShots();
  if (!only.length || only.includes('logs-page-redesign')) {
    log('logs');
    await logsShot();
  }
}

// ---------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------

await browser.close();
const uniq = (a) => [...new Set(a)];
const failed = results.filter((r) => r.failed);
log(`\n${results.length - failed.length} files written to ${outDir}, ${failed.length} failed`);
failed.forEach((r) => log('  failed:', r.name, r.failed));
log('page errors:', problems.pageErrors.length);
uniq(problems.pageErrors).forEach((e) => log('  ', e));
log('console errors:', problems.consoleErrors.length);
uniq(problems.consoleErrors).forEach((e) => log('  ', e));
log('4xx/5xx from bots:', problems.badResponses.length);
uniq(problems.badResponses).forEach((e) => log('  ', e));
log('external calls (all answered locally):', problems.external.length);
uniq(problems.external).forEach((e) => log('  ', e));
