import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Screenshots of the timer work (pause/resume, target, mini timer bar, timer sheet, sleep details)
 * from the developer-only `/dev/now`, `/dev/day` and `/dev/sheet` previews: throw-away local
 * databases, no sign-in, no API and no stored session. Own port (5178); the web server started
 * here is stopped by Playwright when the run ends.
 *
 * Run from tests/e2e/: npx playwright test -c design-review/timers-preview.config.ts
 * Output: docs/design/screenshots/timers-*.png (gitignored).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
export const PREVIEW_PORT = Number(process.env.TIMERS_PREVIEW_PORT ?? 5178);
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: '.',
  testMatch: /timers-preview\.review\.ts/,
  timeout: 600_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: PREVIEW_URL, trace: 'off', actionTimeout: 15_000, navigationTimeout: 30_000 },
  webServer: {
    command: `npm --prefix code/web run dev -- --port ${PREVIEW_PORT} --strictPort`,
    cwd: repoRoot,
    url: PREVIEW_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    // Dummy values: the preview routes never sign in or call a server.
    env: {
      VITE_API_BASE_URL: 'http://localhost:5299',
      VITE_OIDC_AUTHORITY: 'http://localhost:5299/realms/dev',
      VITE_OIDC_CLIENT_ID: 'dev-preview',
      VITE_OIDC_AUDIENCE: 'dev-preview',
    },
  },
});
