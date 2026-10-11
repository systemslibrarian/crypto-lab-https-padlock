import { defineConfig, devices } from '@playwright/test'

/**
 * Everything runs against the production build served by `vite preview`, so
 * what passes here is what ships.
 *
 * PORT 4730 is unique to this lab across the fleet, checked against
 * tools/playwright-ports.json and every sibling clone's config before it was
 * taken, and NEVER the Vite default 4173. A shared port means
 * `reuseExistingServer` silently scans a different lab's preview -- and during
 * a mutation check it can scan an UNMUTATED checkout still running from an
 * earlier run, which reads as "the mutation survived" and sends someone to fix
 * a check that works.
 */
const PORT = 4730
const BASE = `http://localhost:${PORT}/crypto-lab-https-padlock/`

export default defineConfig({
  testDir: './e2e',
  // The claims and coverage projects parallelise; the a11y project does not.
  // Set per project below, because the two have opposite needs: claims tests
  // are independent page loads that gain ~4x from workers, while the a11y drive
  // is one long scan whose cost is CPU-bound and whose output is easier to read
  // in order. The observation sink was built for separate worker processes from
  // the start -- it appends one line at a time with O_APPEND for exactly this.
  fullyParallel: false,
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  // Playwright wipes outputDir at the start of a run, which would race
  // globalSetup's truncation of the observation sink. Keep them apart.
  outputDir: 'test-results/artifacts',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: BASE,
    colorScheme: 'dark', // dark is the only theme
  },
  projects: [
    {
      name: 'a11y',
      testMatch: /a11y\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Claims assert what the page SAYS and what it COMPUTES; neither varies by
    // browser, so one engine is the honest cost.
    {
      name: 'claims',
      testMatch: /claims\.spec\.ts/,
      fullyParallel: true,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'coverage',
      testMatch: /verdict-coverage\.spec\.ts/,
      fullyParallel: true,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Build BEFORE serving. `vite preview` serves whatever is already in
    // dist/, so without the build in front a run tests a stale bundle -- and a
    // build that FAILS leaves the previous good bundle in place, so the whole
    // suite passes green against source that no longer compiles. That silently
    // invalidates mutation checking, which is the only thing that proves a
    // test has teeth.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
