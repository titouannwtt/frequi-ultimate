import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
/**
 * `pnpm e2e:rig` (scripts/e2e-rig) starts the dev server itself, on a free port of 3021..3029, next
 * to the fake bots and the gateway, and tells the specs where it is through FQ_E2E_BASE_URL and
 * where the rig description is through FQ_E2E_RIG (see e2e/rig.ts). Without them the specs that
 * need the rig are skipped and the others run against `pnpm run dev` on port 3000.
 */
const BASE_URL = process.env.FQ_E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 4,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['list'], ['html', { open: 'never' }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: BASE_URL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      // The Chromium of Playwright; FQ_E2E_CHANNEL=chrome runs the installed Chrome instead
      use: { ...devices['Desktop Chrome'], channel: process.env.FQ_E2E_CHANNEL },
      testIgnore: /gateway-stop\.spec\.ts/,
    },
    {
      // Stops the rig's gateway under the page: runs alone, once everything else is done
      name: 'rig-disruptive',
      use: { ...devices['Desktop Chrome'], channel: process.env.FQ_E2E_CHANNEL },
      testMatch: /gateway-stop\.spec\.ts/,
      dependencies: ['chromium'],
    },
    {
      name: 'msedge',
      use: { ...devices['Desktop Edge'], channel: 'msedge' }, // or "msedge-beta" or 'msedge-dev'
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: process.env.FQ_E2E_BASE_URL
    ? undefined
    : {
        command: !process.env.CI ? 'pnpm run dev' : 'pnpm run preview --port 3000',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
      },
});
