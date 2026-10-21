import { defineConfig } from '@playwright/test';
import mainConfig, { AUTH_FILE, WEB_URL } from '../playwright.config';

/*
 * One-off design review harness (docs/design/05-heuristic-evaluation.md). Not part of the e2e
 * suite. Reuses the e2e infrastructure: the root .env is loaded quietly by ../playwright.config,
 * the login session is the `setup` project's storage state (run `npx playwright test
 * --project=setup` from e2e/ first) and the servers are the suite's (reused when already up).
 *
 * Run from e2e/: npx playwright test -c design-review/playwright.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.review\.ts/,
  timeout: 0,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    storageState: AUTH_FILE,
    trace: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: mainConfig.webServer,
});
