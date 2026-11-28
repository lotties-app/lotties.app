import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Screenshots of the Insights Day tab (Day summary) from the `/dev/day-summary` preview:
 * throw-away local databases, no sign-in, no API, no stored session. Own dev server port (5241).
 *
 * Run from tests/e2e/: npx playwright test -c design-review/day-summary.config.ts
 * Output: docs/design/screenshots/day-summary-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
export const PREVIEW_PORT = Number(process.env.DAY_SUMMARY_PORT ?? 5241);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /day-summary\.review\.ts/,
  timeout: 0,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: PREVIEW_URL,
    trace: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: `npm --prefix code/web run dev -- --port ${PREVIEW_PORT} --strictPort${
      process.env.LAYOUT_VITE_CONFIG ? ` --config ${process.env.LAYOUT_VITE_CONFIG}` : ''
    }`,
    cwd: repoRoot,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_API_BASE_URL: 'http://localhost:5299',
      VITE_OIDC_AUTHORITY: 'http://localhost:5299/realms/dev',
      VITE_OIDC_CLIENT_ID: 'dev-preview',
      VITE_OIDC_AUDIENCE: 'dev-preview',
    },
  },
});
